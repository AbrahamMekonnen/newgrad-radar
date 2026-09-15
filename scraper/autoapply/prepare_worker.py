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
    prof.resume_text = row.get("resume_text") or ""
    return prof


def process_queue(limit: int) -> int:
    from supabase import create_client
    from companies import COMPANIES
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    rows = (client.table("autoapply_job_queue").select("*")
            .eq("status", "pending").order("priority").limit(limit).execute().data) or []
    logger.info(f"{len(rows)} pending applications to prepare")

    prof_cache: dict = {}
    done = 0
    for r in rows:
        try:
            job = (client.table("jobs").select("id,url,apply_url,company_slug,company_name,title,ats_type")
                   .eq("id", r["job_id"]).single().execute().data)
            if not job:
                continue
            ats = (job.get("ats_type") or "").lower()
            token = (COMPANIES.get(job["company_slug"]) or {}).get("ats_token")
            jid = _ats_job_id(job.get("apply_url") or job.get("url") or "")
            if ats not in SUPPORTED or not token or not jid:
                client.table("autoapply_job_queue").update(
                    {"status": "unsupported"}).eq("id", r["id"]).execute()
                continue

            profile = prof_cache.get(r["user_id"]) or build_profile(client, r["user_id"])
            prof_cache[r["user_id"]] = profile

            prepared = prepare_application({
                "ats_type": ats, "ats_token": token, "ats_job_id": jid,
                "company_name": job.get("company_name", ""), "job_title": job.get("title", ""),
            }, profile)

            client.table("autoapply_job_queue").update({
                "status": "prepared" if prepared.get("status") == "prepared" else "failed",
                "prepared_data": prepared.get("fields"),
                "ready_pct": prepared.get("ready_pct"),
                "needs_user": prepared.get("needs_user"),
                "prepared_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }).eq("id", r["id"]).execute()
            logger.info(f"  {job.get('company_name')}: {prepared.get('ready_pct')}% ready "
                        f"({prepared.get('ai_drafted_count')} AI-drafted)")
            done += 1
        except Exception as e:
            logger.warning(f"  queue row {r.get('id')} failed: {e}")
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
