"""Queue processor using the fast prepare() engine (replaces the browser-use worker).

Flow: user swipes -> row in autoapply_job_queue (status 'pending') -> this worker
builds the user's Profile, prepares the application (deterministic + AI drafts),
and stores it back on the row as 'prepared' for the user to review + submit in
their own browser. No CAPTCHA bypass; submission is human-in-the-loop.

    python -m autoapply.prepare_worker --limit 25
"""
from __future__ import annotations

import os
import re
import sys
import argparse
import logging
import datetime as dt
from pathlib import Path
from urllib.parse import urlparse, parse_qs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("prepare_worker")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))  # scraper/

import greenhouse_adapter as gh          # noqa: E402
from prepare import prepare_application, SUPPORTED  # noqa: E402


def _load_env() -> None:
    for p in (HERE.parent / ".env", HERE.parent.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _ats_job_id(url: str):
    q = parse_qs(urlparse(url).query)
    if "gh_jid" in q:
        return q["gh_jid"][0]
    segs = [s for s in urlparse(url).path.split("/") if s]
    # lever/ashby: last uuid segment; greenhouse custom domains: gh_jid handled above
    return segs[-1] if segs else None


def build_profile(client, user_id: str) -> gh.Profile:
    """Assemble the Profile from user_profiles (+ story bank) for the LLM drafts."""
    row = (client.table("user_profiles").select("*").eq("user_id", user_id)
           .single().execute().data) or {}
    prof = gh.Profile(
        first_name=row.get("first_name") or "", last_name=row.get("last_name") or "",
        email=row.get("email") or "", phone=row.get("phone") or "",
        location=row.get("location") or "", linkedin_url=row.get("linkedin_url") or "",
        github_url=row.get("github_url") or "", portfolio_url=row.get("portfolio_url") or "",
        resume_url=row.get("resume_url") or "",
        work_authorized=(None if row.get("work_authorization") is None
                         else row.get("work_authorization") != "need_sponsorship"),
        require_sponsorship=row.get("require_sponsorship"),
        years_experience=str(row.get("years_experience") or ""),
        start_date=row.get("start_date") or "", salary_expectation=str(row.get("salary_expectation") or ""),
        willing_to_relocate=row.get("willing_to_relocate"),
        custom_answers=row.get("custom_answers") or {},
    )
    # story bank -> background for AI (best-effort; table may not exist)
    try:
        stories = (client.table("user_story_bank").select("prompt,answer")
                   .eq("user_id", user_id).limit(10).execute().data) or []
        prof.story_bank = {s.get("prompt", ""): s.get("answer", "") for s in stories if s.get("answer")}
    except Exception:
        prof.story_bank = {}
    # Ground AI drafts in the applicant's real resume. Extract from the PDF once
    # and cache it back so we only parse it a single time per user.
    prof.resume_text = row.get("resume_text") or ""
    if not prof.resume_text and prof.resume_url:
        try:
            from resume_text import extract_resume_text
            txt = extract_resume_text(prof.resume_url)
            if txt:
                prof.resume_text = txt
                try:
                    client.table("user_profiles").update({"resume_text": txt}).eq("user_id", user_id).execute()
                except Exception as e:
                    logger.debug(f"resume_text cache write skipped: {e}")  # column may be pre-migration
        except Exception as e:
            logger.warning(f"resume text extraction failed: {e}")
    return prof


def _prepare_one(client, COMPANIES, r: dict, profile) -> bool:
    """Prepare a single queued application and write it back. Returns True on success."""
    job = (client.table("jobs").select("id,url,apply_url,company_slug,company_name,title,ats_type")
           .eq("id", r["job_id"]).single().execute().data)
    if not job:
        return False
    ats = (job.get("ats_type") or "").lower()
    url = job.get("apply_url") or job.get("url") or ""
    if ats == "workday":
        # Workday URLs are self-contained (tenant/site/job path), so derive the
        # token + job id from the URL instead of relying on COMPANIES.
        from workday_adapter import parse_url as _wd_parse
        token, jid = _wd_parse(url)
    else:
        token = (COMPANIES.get(job["company_slug"]) or {}).get("ats_token")
        jid = _ats_job_id(url)
    if ats not in SUPPORTED or not token or not jid:
        client.table("autoapply_job_queue").update({"status": "unsupported"}).eq("id", r["id"]).execute()
        return False
    prepared = prepare_application({
        "ats_type": ats, "ats_token": token, "ats_job_id": jid,
        "company_name": job.get("company_name", ""), "job_title": job.get("title", ""),
    }, profile)
    # Store the real prepare status so 'form_unavailable' / 'form_fetch_failed'
    # are diagnosable and stay OUT of the inbox (which shows only 'prepared').
    pstatus = prepared.get("status")
    client.table("autoapply_job_queue").update({
        "status": "prepared" if pstatus == "prepared" else pstatus,
        "prepared_data": prepared.get("fields"), "ready_pct": prepared.get("ready_pct"),
        "needs_user": prepared.get("needs_user"),
        "prepared_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }).eq("id", r["id"]).execute()
    logger.info(f"  {job.get('company_name')}: {prepared.get('ready_pct')}% ready "
                f"({prepared.get('ai_drafted_count')} AI-drafted)")
    return prepared.get("status") == "prepared"


def process_queue(limit: int, workers: int = 8) -> int:
    """Prepare pending applications IN PARALLEL (each is an independent form fetch
    + ~1 LLM call, so concurrency is a big speedup)."""
    from supabase import create_client
    from companies import COMPANIES
    from concurrent.futures import ThreadPoolExecutor, as_completed
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    # Atomically CLAIM a batch (status pending -> processing) so many workers can
    # run in parallel across users without ever double-processing the same job.
    # Falls back to a plain select if the claim RPC isn't installed yet.
    try:
        client.rpc("requeue_stale_autoapply", {"p_minutes": 30}).execute()  # reap crashed workers
        rows = client.rpc("claim_autoapply_jobs", {"p_limit": limit}).execute().data or []
        claimed = True
    except Exception:
        rows = (client.table("autoapply_job_queue").select("*")
                .eq("status", "pending").order("priority").limit(limit).execute().data) or []
        claimed = False
    logger.info(f"{len(rows)} applications to prepare ({workers} in parallel, "
                f"{'claimed' if claimed else 'unclaimed — run migration 041 for multi-worker'})")

    # Build each user's profile once, up front (thread-safe: no shared mutation).
    prof_cache = {uid: build_profile(client, uid) for uid in {r["user_id"] for r in rows}}

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_prepare_one, client, COMPANIES, r, prof_cache[r["user_id"]]): r for r in rows}
        for fut in as_completed(futs):
            try:
                if fut.result():
                    done += 1
            except Exception as e:
                logger.warning(f"  queue row {futs[fut].get('id')} failed: {e}")
    logger.info(f"DONE: prepared {done}/{len(rows)}")
    return done


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=25)
    args = ap.parse_args()
    process_queue(args.limit)


if __name__ == "__main__":
    main()
