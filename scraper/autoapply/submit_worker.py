"""Submit worker — sends prepared applications the user has queued (Apply click).

Only fires on rows the user explicitly moved to 'submit_requested' AND whose
form has no captcha. Captcha-gated jobs are returned to 'prepared' with a note
so they stay a one-tap-open in the inbox. NEVER bypasses a captcha.

    python -m autoapply.submit_worker --limit 25            # real submit
    python -m autoapply.submit_worker --limit 25 --dry-run  # safe: never posts
"""
from __future__ import annotations

import os
import sys
import argparse
import logging
import datetime as dt
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("submit_worker")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))  # scraper/

from prepare import SUPPORTED                       # noqa: E402
from prepare_worker import _load_env, _ats_job_id, build_profile  # noqa: E402
from submit import submit_application               # noqa: E402


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _submit_one(client, COMPANIES, r: dict, profile, dry_run: bool) -> str:
    """Submit one queued row and write the outcome back. Returns the status."""
    fields = r.get("prepared_data") or []
    job = (client.table("jobs").select("id,url,apply_url,company_slug,company_name,ats_type")
           .eq("id", r["job_id"]).single().execute().data) or {}
    ats = (job.get("ats_type") or "").lower()
    token = (COMPANIES.get(job.get("company_slug")) or {}).get("ats_token")
    jid = _ats_job_id(job.get("apply_url") or job.get("url") or "")
    apply_url = job.get("apply_url") or job.get("url") or ""

    if ats not in SUPPORTED or not token or not jid:
        _write(client, r["id"], "prepared",
               {"status": "unsupported", "detail": f"{ats}: missing token/id", "at": _now()})
        return "unsupported"

    result = submit_application(ats, token, str(jid), apply_url, fields,
                               resume_url=getattr(profile, "resume_url", ""), dry_run=dry_run)
    st = result.get("status")
    # 'submitted' leaves the inbox; anything else returns to 'prepared' with a note
    # (needs_captcha / incomplete / submit_failed / dry_run) so the user can act.
    new_status = "submitted" if st == "submitted" else "prepared"
    patch = {"submit_log": result}
    if st == "submitted":
        patch["submitted_at"] = _now()
    _write(client, r["id"], new_status, result, patch)

    # Mirror real outcomes onto the Applications page (application_logs). Only a
    # true submit or a genuine failure is logged; needs_captcha stays a one-tap
    # action in the inbox (it wasn't submitted), so it isn't logged as applied.
    if st == "submitted":
        _log_application(client, r["user_id"], r["job_id"], ats, "submitted", None, _now())
    elif st in ("submit_failed", "incomplete"):
        _log_application(client, r["user_id"], r["job_id"], ats, "failed",
                         result.get("detail", "submit failed"), None)

    logger.info(f"  {job.get('company_name')}: {st} ({result.get('detail','')[:60]})")
    return st


def _log_application(client, user_id, job_id, ats_type, status, error_message, submitted_at):
    """Upsert an application_logs row so the Applications page reflects the result."""
    try:
        existing = (client.table("application_logs").select("id")
                    .eq("user_id", user_id).eq("job_id", job_id).limit(1).execute().data)
        row = {"status": status, "ats_type": ats_type, "error_message": error_message,
               "submitted_at": submitted_at}
        if existing:
            client.table("application_logs").update(row).eq("id", existing[0]["id"]).execute()
        else:
            row.update({"user_id": user_id, "job_id": job_id})
            client.table("application_logs").insert(row).execute()
    except Exception as e:
        logger.warning(f"  application_logs upsert failed for {job_id}: {e}")


def _write(client, row_id, status, log, extra: dict | None = None):
    patch = {"status": status, "submit_log": log}
    if extra:
        patch.update(extra)
    client.table("autoapply_job_queue").update(patch).eq("id", row_id).execute()


def process_submits(limit: int, workers: int = 6, dry_run: bool = True) -> dict:
    from supabase import create_client
    from companies import COMPANIES
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    try:
        client.rpc("requeue_stale_submit", {"p_minutes": 15}).execute()
        rows = client.rpc("claim_autoapply_submit", {"p_limit": limit}).execute().data or []
        claimed = True
    except Exception:
        rows = (client.table("autoapply_job_queue").select("*")
                .eq("status", "submit_requested").limit(limit).execute().data) or []
        claimed = False
    logger.info(f"{len(rows)} to submit ({workers} parallel, "
                f"{'claimed' if claimed else 'unclaimed'}{', DRY-RUN' if dry_run else ''})")

    prof_cache = {uid: build_profile(client, uid) for uid in {r["user_id"] for r in rows}}
    tally: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_submit_one, client, COMPANIES, r, prof_cache[r["user_id"]], dry_run): r
                for r in rows}
        for fut in as_completed(futs):
            try:
                st = fut.result()
            except Exception as e:
                st = "error"
                row = futs[fut]
                detail = f"{type(e).__name__}: {str(e)[:200]}"
                logger.warning(f"  row {row.get('id')} failed: {detail}")
                try:
                    _write(client, row["id"], "prepared",
                           {"status": "submit_failed", "detail": detail, "at": _now()})
                except Exception as write_error:
                    logger.warning(f"  could not release submit row {row.get('id')}: {write_error}")
            tally[st] = tally.get(st, 0) + 1
    logger.info(f"DONE: {tally}")
    return tally


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true",
                    help="detect captcha + build payload but never POST")
    args = ap.parse_args()
    process_submits(args.limit, args.workers, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
