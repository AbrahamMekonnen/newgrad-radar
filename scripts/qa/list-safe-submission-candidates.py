"""Read-only selection of strict-match live-submission candidates."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COHORT = Path(__file__).with_name("release-autoapply-cohort.py")
SPEC = importlib.util.spec_from_file_location("cohort", COHORT)
gate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(gate)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ats", default="greenhouse")
    ap.add_argument("--size", type=int, default=50)
    args = ap.parse_args()
    gate.load_env()
    from supabase import create_client
    client = create_client(
        os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.environ["SUPABASE_URL"],
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"],
    )
    devices = (client.table("autoapply_browser_devices").select("user_id,last_seen_at")
               .not_.is_("last_seen_at", "null").order("last_seen_at", desc=True)
               .limit(1).execute().data or [])
    if not devices:
        raise SystemExit("No paired browser user")
    user_id = devices[0]["user_id"]
    profile = (client.table("user_profiles").select("auto_apply_filters")
               .eq("user_id", user_id).single().execute().data or {})
    filters = profile.get("auto_apply_filters") or {}
    receipts = (client.table("autoapply_submission_receipts").select("job_id")
                .eq("user_id", user_id).execute().data or [])
    submitted = {r["job_id"] for r in receipts}
    queue = (client.table("autoapply_job_queue")
             .select("id,job_id,status,authorization_source,prepared_data")
             .eq("user_id", user_id).limit(10000).execute().data or [])
    queued = {r["job_id"]: r for r in queue}
    jobs = (client.table("jobs")
            .select("id,title,company_slug,company_name,url,apply_url,ats_type,role_types,experience_level,location,is_active")
            .eq("is_active", True).eq("ats_type", args.ats).limit(5000).execute().data or [])
    candidates, seen = [], set()
    for job in jobs:
        if job["id"] in submitted or not gate.matches(job, filters):
            continue
        key = (gate.normalized(job.get("company_name")), gate.normalized(job.get("title")))
        if key in seen:
            continue
        seen.add(key)
        row = queued.get(job["id"]) or {}
        candidates.append({
            "job_id": job["id"], "queue_id": row.get("id"),
            "company": job.get("company_name"), "title": job.get("title"),
            "level": job.get("experience_level"), "location": job.get("location"),
            "queue_status": row.get("status"),
            "authorization_source": row.get("authorization_source"),
            "prepared": bool(row.get("prepared_data")),
        })
    candidates.sort(key=lambda j: (
        {"new_grad": 0, "intern": 1, "junior": 2}.get(j.get("level"), 3),
        gate.normalized(j.get("company")), gate.normalized(j.get("title"))))
    selected = candidates[:args.size]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = ROOT / ".qa" / f"safe-candidates-{args.ats}-{stamp}.json"
    report.parent.mkdir(exist_ok=True)
    report.write_text(json.dumps({"ats": args.ats, "requested": args.size,
                                  "available": len(candidates), "jobs": selected}, indent=2),
                      encoding="utf-8")
    print(json.dumps({"report": str(report), "available": len(candidates),
                      "selected": len(selected),
                      "already_authorized_prepared": sum(
                          bool(j["queue_id"] and j["prepared"] and j["authorization_source"] in ("standing_rule", "direct_click"))
                          for j in selected)}, indent=2))


if __name__ == "__main__":
    main()
