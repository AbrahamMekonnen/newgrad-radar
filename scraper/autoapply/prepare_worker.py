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
import time
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
    """Assemble the complete reusable application profile and learned answers."""
    row = (client.table("user_profiles").select("*").eq("user_id", user_id)
           .single().execute().data) or {}
    custom = dict(row.get("custom_answers") or {})
    authorization = row.get("work_authorization") or ""

    explicit_sponsorship = row.get("require_sponsorship")
    if explicit_sponsorship is None:
        if authorization in ("us_citizen", "permanent_resident"):
            explicit_sponsorship = False
        elif authorization in ("visa_holder", "student_visa", "need_sponsorship"):
            explicit_sponsorship = True

    location = row.get("location") or ""
    location_parts = [part.strip() for part in location.split(",")]
    city = custom.get("city") or (location_parts[0] if location_parts else "")
    state = custom.get("state") or (location_parts[1] if len(location_parts) > 1 else "")

    prof = gh.Profile(
        first_name=row.get("first_name") or "", last_name=row.get("last_name") or "",
        email=row.get("email") or "", phone=row.get("phone") or "",
        location=location, city=city, state=state,
        zip_code=str(custom.get("zip_code") or ""),
        country=str(custom.get("country") or "United States"),
        linkedin_url=row.get("linkedin_url") or "",
        github_url=row.get("github_url") or "", portfolio_url=row.get("portfolio_url") or "",
        resume_url=row.get("resume_url") or "",
        work_authorization=authorization,
        work_authorized=(None if not authorization else authorization != "need_sponsorship"),
        require_sponsorship=explicit_sponsorship,
        is_us_citizen=(True if authorization == "us_citizen"
                       else False if authorization in ("permanent_resident", "visa_holder", "student_visa")
                       else None),
        citizenship=str(custom.get("citizenship") or
                        ("United States" if authorization == "us_citizen" else "")),
        years_experience=str(row.get("years_experience") or ""),
        start_date=row.get("start_date") or "",
        salary_expectation=str(row.get("salary_expectation") or ""),
        willing_to_relocate=row.get("willing_to_relocate"),
        how_heard=str(custom.get("source") or custom.get("how_heard") or "Company website"),
        is_adult=bool(custom.get("is_adult", True)),
        custom_answers=custom,
        auto_submit=bool(row.get("auto_submit", False)),
    )

    try:
        generated = (client.table("answer_bank")
                     .select("question_category,answer_text,word_count_target")
                     .eq("user_id", user_id).order("created_at", desc=True)
                     .limit(200).execute().data) or []
        for answer in generated:
            value = answer.get("answer_text")
            category = answer.get("question_category")
            if value and category:
                prof.custom_answers.setdefault(category, value)
    except Exception:
        pass

    try:
        stories = (client.table("user_story_bank").select("*")
                   .eq("user_id", user_id).limit(10).execute().data) or []
        prof.story_bank = {}
        for story in stories:
            title = story.get("title") or story.get("story_type") or "Story"
            actions = story.get("action") or story.get("actions") or ""
            results = story.get("result") or story.get("results") or ""
            if isinstance(actions, list):
                actions = "; ".join(str(item) for item in actions)
            if isinstance(results, list):
                results = "; ".join(
                    str(item.get("description") or item) if isinstance(item, dict) else str(item)
                    for item in results
                )
            parts = [story.get("situation"), story.get("task"), actions, results]
            answer = " ".join(str(part).strip() for part in parts if part)
            if answer:
                prof.story_bank[str(title)] = answer
    except Exception:
        prof.story_bank = {}

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
                    logger.debug(f"resume_text cache write skipped: {e}")
        except Exception as e:
            logger.warning(f"resume text extraction failed: {e}")
    return prof


def _finish(client, row_id, status, reason, ats, extra=None):
    """Write a terminal outcome + telemetry for one queued row. Best-effort: a DB
    hiccup here must never propagate and take down the rest of the batch."""
    log = {"status": status, "reason": reason, "ats": ats,
           "at": dt.datetime.now(dt.timezone.utc).isoformat()}
    patch = {"status": status, "prepare_log": log}
    if extra:
        patch.update(extra)
    try:
        client.table("autoapply_job_queue").update(patch).eq("id", row_id).execute()
    except Exception as e:
        # The prepare_log column may not exist yet (pre-migration 044). Retry
        # WITHOUT it so the row always gets a real status and is never stuck.
        try:
            patch.pop("prepare_log", None)
            client.table("autoapply_job_queue").update(patch).eq("id", row_id).execute()
        except Exception as e2:
            logger.warning(f"  status write failed for {row_id}: {e2}")


def _prepare_one(client, COMPANIES, r: dict, profile) -> bool:
    """Prepare a single queued application and write it back. FULLY ISOLATED: any
    failure is captured on THIS row (status + prepare_log) and never raises, so
    one bad job can't affect the rest of the batch — even other jobs on the same
    ATS. Every row always ends with a recorded outcome we can query at scale."""
    ats = "?"
    try:
        resp = (client.table("jobs").select("id,url,apply_url,company_slug,company_name,title,ats_type")
                .eq("id", r["job_id"]).limit(1).execute())
        job = (resp.data or [None])[0] if resp else None
        if not job:
            _finish(client, r["id"], "job_missing", "job row not found", ats)
            return False
        ats = (job.get("ats_type") or "").lower()
        url = job.get("apply_url") or job.get("url") or ""
        if ats == "workday":
            # Workday URLs are self-contained (tenant/site/job path).
            from workday_adapter import parse_url as _wd_parse
            token, jid = _wd_parse(url)
        else:
            token = (COMPANIES.get(job["company_slug"]) or {}).get("ats_token")
            jid = _ats_job_id(url)
        if ats not in SUPPORTED:
            _finish(client, r["id"], "unsupported", f"{ats} not supported", ats)
            return False
        if not token or not jid:
            _finish(client, r["id"], "unsupported", "missing ats token or job id", ats)
            return False

        prepared = prepare_application({
            "ats_type": ats, "ats_token": token, "ats_job_id": jid,
            "company_name": job.get("company_name", ""), "job_title": job.get("title", ""),
        }, profile)
        pstatus = prepared.get("status")
        # 'form_unavailable' / 'form_fetch_failed' keep their real status so they
        # stay OUT of the inbox (which shows only 'prepared') and are diagnosable.
        needs_user = prepared.get("needs_user") or []
        complete = pstatus == "prepared" and not needs_user and prepared.get("ready_pct") == 100
        submit_after_prepare = bool((r.get("answers") or {}).get("submit_after_prepare"))
        final_status = "submit_requested" if complete and (profile.auto_submit or submit_after_prepare) else (
            "prepared" if pstatus == "prepared" else pstatus
        )
        _finish(client, r["id"], final_status,
                prepared.get("error") or prepared.get("message") or "ok", ats,
                extra={"prepared_data": prepared.get("fields"),
                       "ready_pct": prepared.get("ready_pct"),
                       "needs_user": needs_user,
                       "prepared_at": dt.datetime.now(dt.timezone.utc).isoformat()})
        logger.info(f"  {job.get('company_name')}: {pstatus} "
                    f"{prepared.get('ready_pct') if pstatus=='prepared' else ''}")
        return pstatus == "prepared"
    except Exception as e:
        # Never let one job's crash escape into the batch. Record it and move on.
        logger.warning(f"  prepare crashed for row {r.get('id')}: {e}")
        _finish(client, r["id"], "error", f"{type(e).__name__}: {str(e)[:200]}", ats)
        return False


def _prepare_with_retries(client, companies, row: dict, profile, attempts: int = 3) -> bool:
    """Retry transient fetch/network failures while preserving terminal form outcomes."""
    for attempt in range(1, attempts + 1):
        if _prepare_one(client, companies, row, profile):
            return True
        try:
            state = (client.table("autoapply_job_queue").select("status")
                     .eq("id", row["id"]).single().execute().data or {}).get("status")
        except Exception:
            state = "error"
        if state not in ("error", "form_fetch_failed") or attempt == attempts:
            return False
        delay = 2 ** (attempt - 1)
        logger.warning(f"  retrying row {row.get('id')} after {state} ({attempt}/{attempts})")
        time.sleep(delay)
    return False

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
        futs = {ex.submit(_prepare_with_retries, client, COMPANIES, r, prof_cache[r["user_id"]]): r for r in rows}
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
