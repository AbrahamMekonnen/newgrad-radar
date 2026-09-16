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

_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def apply_target_ok(ats: str, url: str, slug: str = "") -> bool:
    """True only if the URL points at a SPECIFIC job we can actually prepare —
    not a board-root, department page, or blog. This is what keeps
    form_unavailable noise (e.g. jobs.ashbyhq.com/<org> with no job id) out of
    the queue. Stress-testing showed these bad URLs are the real failure source.
    """
    ats = (ats or "").lower()
    url = url or ""
    if not url.startswith("http"):
        return False
    if ats == "workday":
        try:
            from workday_adapter import parse_url
            tok, jid = parse_url(url)
            return bool(tok and jid)
        except Exception:
            return False
    if ats in ("ashby", "lever"):
        return bool(_UUID_RE.search(url))           # both use UUID job ids
    if ats == "greenhouse":
        return bool(re.search(r"(gh_jid=\d{4,}|/jobs/\d{4,})", url))
    if ats == "smartrecruiters":
        return bool(re.search(r"/\d{6,}(?:[/?#]|$)", url))
    # generic ATS: need a non-trivial last path segment that isn't the org slug
    seg = [s for s in url.split("?")[0].rstrip("/").split("/") if s]
    jid = seg[-1] if seg else ""
    return bool(jid and jid.lower() != (slug or "").lower() and len(jid) >= 5
                and jid not in ("jobs", "careers", "apply", "search", "job"))


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
    # Skip jobs whose URL isn't a specific, preparable posting (board roots,
    # department pages, blog links) — they'd only become form_unavailable noise.
    fresh = [j for j in jobs if j["id"] not in existing]
    todo, skipped = [], 0
    for j in fresh:
        if apply_target_ok(j.get("ats_type"), j.get("apply_url") or j.get("url") or "", j.get("company_slug")):
            todo.append(j)
        else:
            skipped += 1
        if len(todo) >= cap_per_run:
            break
    if skipped:
        logger.info(f"  skipped {skipped} non-specific/unpreparable URLs")

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


def _queue_insert(client, user_id: str, j: dict) -> bool:
    try:
        client.table("autoapply_job_queue").insert({
            "user_id": user_id, "job_id": j["id"], "job_title": j.get("title"),
            "company_slug": j.get("company_slug"), "company_name": j.get("company_name"),
            "job_url": j.get("apply_url") or j.get("url"), "ats_type": j.get("ats_type"),
            "priority": 2, "status": "pending",
        }).execute()
        return True
    except Exception as e:
        if "23505" not in str(e):  # duplicate is fine
            logger.debug(f"enqueue failed {j.get('id')}: {e}")
        return False


def _passes_company_filters(job: dict, jf: dict) -> bool:
    """Apply the per-company watchlist job_filters (role/level), if any."""
    if not jf:
        return True
    roles = jf.get("roles") or jf.get("role_types")
    if roles and not (set(job.get("role_types") or []) & set(roles)):
        return False
    levels = jf.get("experience_levels")
    if levels and job.get("experience_level") not in levels and job.get("experience_level") is not None:
        return False
    return True


def enqueue_watchlist_for_user(client, user_id: str, cap_per_run: int = 30) -> int:
    """Company-driven auto-apply: for each watchlisted company the user turned
    auto-apply ON, queue that company's specific, preparable jobs into the SAME
    pipeline as the saved filters — so watchlist auto-apply lands in the
    /auto-apply inbox too (in sync), honouring per-company job_filters."""
    prof = (client.table("user_profiles").select("auto_apply_enabled")
            .eq("user_id", user_id).single().execute().data) or {}
    if not prof.get("auto_apply_enabled"):
        return 0
    lists = (client.table("user_lists").select("company_slug, filters")
             .eq("user_id", user_id).eq("auto_apply", True).execute().data) or []
    if not lists:
        return 0

    existing = set()
    for tbl in ("autoapply_job_queue", "application_logs"):
        try:
            rows = (client.table(tbl).select("job_id").eq("user_id", user_id).limit(5000).execute().data) or []
            existing |= {r["job_id"] for r in rows}
        except Exception:
            pass

    added = 0
    for entry in lists:
        slug, jf = entry.get("company_slug"), entry.get("filters") or {}
        jobs = (client.table("jobs")
                .select("id,title,company_slug,company_name,url,apply_url,ats_type,role_types,experience_level")
                .eq("company_slug", slug).eq("is_active", True).limit(200).execute().data) or []
        for j in jobs:
            if added >= cap_per_run:
                break
            if j["id"] in existing:
                continue
            if (j.get("ats_type") or "").lower() not in SUPPORTED:
                continue
            if not apply_target_ok(j.get("ats_type"), j.get("apply_url") or j.get("url") or "", slug):
                continue
            if not _passes_company_filters(j, jf):
                continue
            if _queue_insert(client, user_id, j):
                existing.add(j["id"])
                added += 1
    if added:
        logger.info(f"user {user_id[:8]}: watchlist queued {added}")
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
        rule_users, watch_users = [args.user], [args.user]
    else:
        # Filter-based auto-apply users (saved criteria).
        rrows = (client.table("user_profiles").select("user_id")
                 .eq("auto_apply_enabled", True).eq("auto_apply_rules_enabled", True)
                 .execute().data) or []
        rule_users = [r["user_id"] for r in rrows]
        # Company-based auto-apply users (any watchlist company with auto_apply on).
        wrows = (client.table("user_lists").select("user_id")
                 .eq("auto_apply", True).limit(10000).execute().data) or []
        watch_users = list({r["user_id"] for r in wrows})
    logger.info(f"{len(rule_users)} filter-based + {len(watch_users)} watchlist auto-apply user(s)")

    total = 0
    for uid in rule_users:
        try:
            total += enqueue_for_user(client, uid, cap_per_run=args.limit)
        except Exception as e:
            logger.warning(f"user {uid} (filters): {e}")
    for uid in watch_users:
        try:
            total += enqueue_watchlist_for_user(client, uid, cap_per_run=args.limit)
        except Exception as e:
            logger.warning(f"user {uid} (watchlist): {e}")
    logger.info(f"DONE: queued {total} applications")


if __name__ == "__main__":
    main()
