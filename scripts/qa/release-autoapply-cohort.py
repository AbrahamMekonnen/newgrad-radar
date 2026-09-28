"""Select and optionally release one auditable ATS auto-apply cohort.

Dry-run by default. Use --release only after the matching extension version is
live. The selector uses the active user's saved auto-apply filters, excludes
durable submission receipts, rejects duplicate company/title pairs, and only
releases queue rows that already have prepared data.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

# The production classifier historically labels every unrecognized title as
# ``swe``.  That is useful for board discovery but unsafe for an irreversible
# submission campaign: mechanical, electrical, sales and support roles can all
# arrive tagged as SWE.  Require affirmative software evidence here.
_SWE_TITLE = re.compile(
    r"\b(software|developer|programmer|sde|full[ -]?stack|front[ -]?end|"
    r"back[ -]?end|mobile|android|ios|site reliability|sre|devops|"
    r"platform engineer|infrastructure engineer|cloud engineer|data engineer|"
    r"machine learning|ml engineer|ai engineer|research engineer|"
    r"security engineer|application engineer|systems engineer)\b", re.I)
_NON_SWE_TITLE = re.compile(
    r"\b(mechanical|electrical|hardware|avionics|manufacturing|civil|water|"
    r"wastewater|rf|supplier|sourcing|product design|sales|customer|solutions|"
    r"support|technician|marketing|grc|risk management|sensor placement|"
    r"integration and test|mission integration|video content|designer|"
    r"developer engagement|product application|software installation)\b", re.I)
_LEVEL_SIGNAL = re.compile(
    r"\b(intern(?:ship)?|new[ -]?grad|entry[ -]?level|junior|associate|"
    r"early career|university grad|recent grad|graduate)\b", re.I)
_EDUCATION_MISMATCH = re.compile(r"\b(phd|doctoral|doctorate)\b", re.I)


def load_env() -> None:
    for path in (ROOT / ".env.local", ROOT / "scraper" / ".env"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def normalized(value: object) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(value or "").lower()))


def matches(job: dict, filters: dict) -> bool:
    title = normalized(job.get("title"))
    excluded = [normalized(v) for v in filters.get("exclude_keywords", [])]
    required = [normalized(v) for v in filters.get("keywords", [])]
    if excluded and any(term in title for term in excluded):
        return False
    if required and not any(term in title for term in required):
        return False
    roles = set(filters.get("roles") or [])
    if roles and not roles.intersection(job.get("role_types") or []):
        return False
    if "swe" in roles:
        raw_title = str(job.get("title") or "")
        if not _SWE_TITLE.search(raw_title) or _NON_SWE_TITLE.search(raw_title):
            return False
        if _EDUCATION_MISMATCH.search(raw_title):
            return False
    levels = set(filters.get("experience_levels") or [])
    level = job.get("experience_level")
    if levels:
        if level and level not in levels:
            return False
        # Unknown seniority is not safe enough for an irreversible campaign.
        # Accept it only when the title itself has an allowed junior signal.
        if not level and not _LEVEL_SIGNAL.search(str(job.get("title") or "")):
            return False
    if filters.get("us_only"):
        location = normalized(job.get("location"))
        us_hints = ("united states", "remote", " ca", " ny", " tx", " wa", " ma", " il",
                    "new york", "san francisco", "seattle", "austin")
        if location and not any(hint.strip() in location for hint in us_hints):
            return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ats", default="greenhouse")
    parser.add_argument("--size", type=int, default=50)
    parser.add_argument("--release", action="store_true")
    args = parser.parse_args()
    load_env()

    from supabase import create_client
    client = create_client(
        os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.environ["SUPABASE_URL"],
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"],
    )
    devices = (client.table("autoapply_browser_devices").select("user_id,last_seen_at")
               .not_.is_("last_seen_at", "null").order("last_seen_at", desc=True)
               .limit(1).execute().data or [])
    if not devices:
        raise SystemExit("No active paired browser device")
    user_id = devices[0]["user_id"]
    profile = (client.table("user_profiles")
               .select("auto_apply_filters,auto_apply_enabled,auto_submit")
               .eq("user_id", user_id).single().execute().data or {})
    if not profile.get("auto_apply_enabled") or not profile.get("auto_submit"):
        raise SystemExit("Auto-Apply and Auto-Submit must both be enabled")
    filters = profile.get("auto_apply_filters") or {}

    queue = (client.table("autoapply_job_queue")
             .select("id,job_id,job_title,company_name,status,prepared_data,created_at")
             .eq("user_id", user_id).eq("ats_type", args.ats)
             .in_("status", ["prepared", "waiting_for_browser", "waiting_for_user"])
             .order("created_at").limit(1000).execute().data or [])
    receipts = (client.table("autoapply_submission_receipts").select("job_id")
                .eq("user_id", user_id).execute().data or [])
    submitted = {row["job_id"] for row in receipts}
    job_ids = [row["job_id"] for row in queue if row["job_id"] not in submitted]
    jobs = {}
    for start in range(0, len(job_ids), 100):
        rows = (client.table("jobs")
                .select("id,title,company_name,role_types,experience_level,location,is_active")
                .in_("id", job_ids[start:start + 100]).eq("is_active", True).execute().data or [])
        jobs.update({row["id"]: row for row in rows})

    cohort, seen = [], set()
    for row in queue:
        job = jobs.get(row["job_id"])
        if not job or not row.get("prepared_data") or not matches(job, filters):
            continue
        key = (normalized(job.get("company_name")), normalized(job.get("title")))
        if key in seen:
            continue
        seen.add(key)
        cohort.append({
            "queue_id": row["id"], "job_id": row["job_id"],
            "company": job.get("company_name"), "title": job.get("title"),
            "level": job.get("experience_level"), "location": job.get("location"),
        })
        if len(cohort) >= args.size:
            break

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = ROOT / ".qa" / f"submission-cohort-{args.ats}-{stamp}.json"
    report.parent.mkdir(exist_ok=True)
    report.write_text(json.dumps({"ats": args.ats, "requested": args.size,
                                  "selected": len(cohort), "released": args.release,
                                  "jobs": cohort}, indent=2), encoding="utf-8")

    if args.release:
        if len(cohort) != args.size:
            raise SystemExit(f"Refusing partial release: selected {len(cohort)} of {args.size}")
        selected = {row["queue_id"] for row in cohort}
        # Keep unclaimed work from other ATSes out of this campaign while
        # preserving active leases and tabs that are waiting for user input.
        unclaimed = (client.table("autoapply_job_queue").select("id")
                     .eq("user_id", user_id)
                     .in_("status", ["submit_requested", "waiting_for_browser"])
                     .limit(5000).execute().data or [])
        for row in unclaimed:
            if row["id"] not in selected:
                client.table("autoapply_job_queue").update({
                    "status": "prepared", "browser_stage": "paused_for_isolated_campaign",
                }).eq("id", row["id"]).execute()
        for row in cohort:
            client.table("autoapply_job_queue").update({
                "status": "waiting_for_browser", "execution_channel": "user_browser",
                "authorization_source": "standing_rule", "browser_stage": "cohort_released",
                "priority": 0,
            }).eq("id", row["queue_id"]).execute()

    print(json.dumps({"report": str(report), "selected": len(cohort),
                      "released": args.release}, indent=2))


if __name__ == "__main__":
    main()
