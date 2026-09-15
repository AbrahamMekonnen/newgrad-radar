"""Filter-based standing auto-apply: expand each user's saved criteria into
matching active jobs and queue them for preparation.

The user picks filters once (roles, levels, locations, tiers, sources,
sponsorship, salary, keyword include/exclude — the same filters as the jobs
page). This finds every new matching job and enqueues it into
autoapply_job_queue; prepare_worker then fills it. Company-driven auto-apply
(watchlist / user_lists.auto_apply) is handled separately and left untouched.

    python -m autoapply.rules --limit 50           # all enabled users
    python -m autoapply.rules --user <uuid>
"""
from __future__ import annotations

import os
import re
import sys
import argparse
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("autoapply_rules")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

# Only these ATSes can actually be prepared today (Greenhouse/Lever).
from prepare import SUPPORTED  # noqa: E402

_US_HINTS = ("united states", "usa", " us", "u.s", "remote", ", ca", ", ny", ", tx",
             ", wa", ", ma", ", il", "new york", "san francisco", "seattle", "austin")


def _load_env() -> None:
    for p in (HERE.parent / ".env", HERE.parent.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def matching_jobs(client, rule: dict, cap: int = 500) -> list[dict]:
    """Return active, supported jobs matching the rule's filters."""
    f = rule or {}
    q = (client.table("jobs")
         .select("id,title,company_slug,company_name,url,apply_url,ats_type,experience_level,role_types,tier,sponsorship_status,salary_min,location")
         .eq("is_active", True).neq("is_job", False)
         .in_("ats_type", list(SUPPORTED)))

    if f.get("tiers"):
        q = q.in_("tier", f["tiers"])
    if f.get("experience_levels"):
        lvls = ",".join(f["experience_levels"])
        q = q.or_(f"experience_level.in.({lvls}),experience_level.is.null")
    if f.get("roles"):
        q = q.overlaps("role_types", f["roles"])
    if f.get("sponsorship") == "sponsors":
        q = q.eq("sponsorship_status", "offers_sponsorship")
    if f.get("salary_min"):
        q = q.gte("salary_min", int(f["salary_min"]))

    rows = q.limit(cap).execute().data or []

    # Post-filter the things PostgREST can't do cleanly: keyword include/exclude,
    # US-only, and free-text location.
    kw = [k.lower() for k in (f.get("keywords") or [])]
    excl = [k.lower() for k in (f.get("exclude_keywords") or [])]
    us_only = "us_only" in (f.get("locations") or []) or f.get("us_only")
    out = []
    for j in rows:
        t = (j.get("title") or "").lower()
        if kw and not any(k in t for k in kw):
            continue
        if excl and any(k in t for k in excl):
            continue
        if us_only:
            loc = (j.get("location") or "").lower()
            if loc and not any(h in loc for h in _US_HINTS):
                continue
        out.append(j)
    return out


def enqueue_for_user(client, user_id: str, cap_per_run: int = 30) -> int:
    prof = (client.table("user_profiles")
            .select("auto_apply_enabled,auto_apply_rules_enabled,auto_apply_filters")
            .eq("user_id", user_id).single().execute().data) or {}
    if not (prof.get("auto_apply_enabled") and prof.get("auto_apply_rules_enabled")):
        return 0
    rule = prof.get("auto_apply_filters") or {}
    if not rule:
        return 0

    jobs = matching_jobs(client, rule)
    # skip jobs already queued or applied for this user
    existing = set()
    for tbl, col in (("autoapply_job_queue", "job_id"), ("application_logs", "job_id")):
        try:
            rows = (client.table(tbl).select(col).eq("user_id", user_id).limit(5000).execute().data) or []
            existing |= {r[col] for r in rows}
        except Exception:
            pass
    todo = [j for j in jobs if j["id"] not in existing][:cap_per_run]

    added = 0
    for j in todo:
        try:
            client.table("autoapply_job_queue").insert({
                "user_id": user_id, "job_id": j["id"], "job_title": j.get("title"),
                "company_slug": j.get("company_slug"), "company_name": j.get("company_name"),
                "job_url": j.get("apply_url") or j.get("url"), "ats_type": j.get("ats_type"),
                "priority": 3, "status": "pending",
            }).execute()
            added += 1
        except Exception as e:
            if "23505" not in str(e):  # duplicate is fine
                logger.debug(f"enqueue failed {j['id']}: {e}")
    logger.info(f"user {user_id[:8]}: {len(jobs)} match, {added} newly queued")
    return added


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", help="single user id")
    ap.add_argument("--limit", type=int, default=30, help="max jobs to queue per user per run")
    args = ap.parse_args()

    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    if args.user:
        users = [args.user]
    else:
        rows = (client.table("user_profiles").select("user_id")
                .eq("auto_apply_enabled", True).eq("auto_apply_rules_enabled", True)
                .execute().data) or []
        users = [r["user_id"] for r in rows]
    logger.info(f"{len(users)} user(s) with filter-based auto-apply enabled")

    total = 0
    for uid in users:
        try:
            total += enqueue_for_user(client, uid, cap_per_run=args.limit)
        except Exception as e:
            logger.warning(f"user {uid}: {e}")
    logger.info(f"DONE: queued {total} applications across {len(users)} users")


if __name__ == "__main__":
    main()
