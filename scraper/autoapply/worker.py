"""Background worker for auto-apply processing."""

import asyncio
import os
import signal
import sys
from datetime import datetime

from supabase import create_client, Client

from agent import process_pending_applications, fetch_user_profile


POLL_INTERVAL = int(os.environ.get("AUTOAPPLY_POLL_INTERVAL", 60))
HEADLESS = os.environ.get("AUTOAPPLY_HEADLESS", "true").lower() == "true"

running = True


def get_supabase_client() -> Client:
    """Get Supabase client."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(url, key)


def fetch_users_with_pending_applications() -> list[str]:
    """Get user IDs with pending applications who have auto-apply enabled."""
    client = get_supabase_client()

    result = client.table("application_logs").select(
        "user_id, user_profiles!inner(auto_apply_enabled)"
    ).eq("status", "pending").execute()

    user_ids = set()
    for row in result.data or []:
        profile = row.get("user_profiles", {})
        if profile.get("auto_apply_enabled"):
            user_ids.add(row["user_id"])

    return list(user_ids)


def fetch_auto_apply_jobs() -> list[dict]:
    """Fetch jobs that should be auto-applied to based on company settings."""
    client = get_supabase_client()

    result = client.table("user_lists").select(
        "user_id, company_slug, companies!inner(name), user_profiles!inner(auto_apply_enabled, auto_apply_all_jobs)"
    ).eq("auto_apply", True).execute()

    jobs_to_apply = []

    for row in result.data or []:
        user_id = row["user_id"]
        company_slug = row["company_slug"]
        profile = row.get("user_profiles", {})

        if not profile.get("auto_apply_enabled"):
            continue

        active_jobs = client.table("jobs").select("id, url, title").eq(
            "company_slug", company_slug
        ).eq("is_active", True).execute()

        for job in active_jobs.data or []:
            existing = client.table("application_logs").select("id").eq(
                "user_id", user_id
            ).eq("job_id", job["id"]).execute()

            if not existing.data:
                jobs_to_apply.append({
                    "user_id": user_id,
                    "job_id": job["id"],
                    "job_url": job["url"],
                    "job_title": job["title"],
                    "company_name": row.get("companies", {}).get("name", company_slug),
                })

    return jobs_to_apply


def create_pending_applications(jobs: list[dict]):
    """Create pending application records for auto-apply jobs."""
    client = get_supabase_client()

    for job in jobs:
        try:
            client.table("application_logs").insert({
                "user_id": job["user_id"],
                "job_id": job["job_id"],
                "status": "pending",
                "ats_type": "auto",
            }).execute()
            print(f"  Created pending application: {job['company_name']} - {job['job_title']}")
        except Exception as e:
            print(f"  Error creating application: {e}")


async def process_all_pending():
    """Process all pending applications."""
    user_ids = fetch_users_with_pending_applications()

    if not user_ids:
        return 0

    print(f"Processing applications for {len(user_ids)} users...")

    total_processed = 0
    for user_id in user_ids:
        try:
            results = await process_pending_applications(user_id, headless=HEADLESS)
            for r in results:
                if r.get("success"):
                    print(f"  OK: {r.get('company')} - {r.get('title')}")
                    total_processed += 1
                elif r.get("error"):
                    print(f"  FAIL: {r.get('company')} - {r.get('error')}")
        except Exception as e:
            print(f"  Error processing user {user_id}: {e}")

    return total_processed


async def worker_loop():
    """Main worker loop."""
    global running

    print(f"Auto-apply worker started (poll interval: {POLL_INTERVAL}s, headless: {HEADLESS})")

    while running:
        try:
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            print(f"\n[{now}] Checking for work...")

            auto_jobs = fetch_auto_apply_jobs()
            if auto_jobs:
                print(f"  Found {len(auto_jobs)} new jobs to auto-apply")
                create_pending_applications(auto_jobs)

            processed = await process_all_pending()
            print(f"  Processed {processed} applications")

        except Exception as e:
            print(f"  Worker error: {e}")

        if running:
            await asyncio.sleep(POLL_INTERVAL)


def signal_handler(sig, frame):
    """Handle shutdown signals."""
    global running
    print("\nShutting down worker...")
    running = False


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    print("=" * 50)
    print("NewGrad Radar Auto-Apply Worker")
    print("=" * 50)

    try:
        get_supabase_client()
        print("Database connection OK")
    except Exception as e:
        print(f"Database connection failed: {e}")
        sys.exit(1)

    asyncio.run(worker_loop())
