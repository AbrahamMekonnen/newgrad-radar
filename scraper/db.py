"""Supabase database operations."""

import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from supabase import create_client, Client

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY


# Job rotation constants
MAX_ACTIVE_JOBS = 500  # Maximum number of active jobs to keep
PRIORITY_DAYS = 7  # Jobs newer than this are protected from rotation
MAX_AGE_DAYS = 30  # Jobs older than this are always deactivated


_client: Optional[Client] = None


def get_client() -> Client:
    """Get or create Supabase client."""
    global _client
    if _client is None:
        if not SUPABASE_SERVICE_KEY:
            raise ValueError("SUPABASE_SERVICE_KEY environment variable not set")
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


def merge_arrays(existing: list | None, new: list | None) -> list:
    """Merge two arrays, removing duplicates while preserving order.

    Args:
        existing: Existing array from database (may be None)
        new: New array to merge in (may be None)

    Returns:
        Merged array with unique values
    """
    existing = existing or []
    new = new or []

    # Use dict to preserve order while removing duplicates
    seen = {}
    for item in existing:
        if item and item not in seen:
            seen[item] = True
    for item in new:
        if item and item not in seen:
            seen[item] = True

    return list(seen.keys())


def upsert_jobs(jobs: list[dict], dry_run: bool = False) -> tuple[int, int]:
    """Insert or update jobs.

    Args:
        jobs: List of normalized job dicts with id, company_slug, title, etc.
        dry_run: If True, don't actually write to database

    Returns:
        Tuple of (new_count, updated_count)
    """
    if not jobs:
        return 0, 0

    if dry_run:
        # In dry run mode, just count what would be new
        # We can't check existing without connecting
        return len(jobs), 0

    client = get_client()

    # Get existing jobs with their array columns for merging
    try:
        existing = client.table("jobs").select(
            "id, discovery_sources, diversity_tags, work_modes, badges"
        ).execute()
        existing_data = {row["id"]: row for row in existing.data}
        existing_ids = set(existing_data.keys())
    except Exception as e:
        print(f"Error fetching existing jobs: {e}")
        existing_ids = set()
        existing_data = {}

    new_jobs = [j for j in jobs if j["id"] not in existing_ids]
    update_jobs = [j for j in jobs if j["id"] in existing_ids]

    new_count = 0
    updated_count = 0

    # Insert new jobs
    if new_jobs:
        try:
            # Prepare job data for insert
            insert_data = []
            for job in new_jobs:
                insert_data.append({
                    "id": job["id"],
                    "company_slug": job["company_slug"],
                    "company_name": job["company_name"],
                    "title": job["title"],
                    "location": job["location"],
                    "url": job["url"],
                    "apply_url": job.get("apply_url"),  # Direct application URL
                    "tier": job["tier"],
                    "role_types": job.get("role_types") or [],
                    "source": job["source"],
                    "posted_at": job.get("posted"),
                    "is_active": True,
                    # New multi-dimensional tag arrays
                    "discovery_sources": job.get("discovery_sources") or [],
                    "diversity_tags": job.get("diversity_tags") or [],
                    "work_modes": job.get("work_modes") or [],
                    "badges": job.get("badges") or [],
                    # Experience level classification
                    "experience_level": job.get("experience_level"),
                    "experience_confidence": job.get("experience_confidence", 0.0),
                    "experience_matched_patterns": job.get("experience_matched_patterns") or [],
                })
            client.table("jobs").insert(insert_data).execute()
            new_count = len(new_jobs)
        except Exception as e:
            print(f"Error inserting jobs: {e}")

    # Update existing jobs (mark as still active + merge arrays)
    for job in update_jobs:
        try:
            existing_job = existing_data.get(job["id"], {})

            # Merge arrays: combine existing with new, removing duplicates
            merged_discovery = merge_arrays(
                existing_job.get("discovery_sources"),
                job.get("discovery_sources")
            )
            merged_diversity = merge_arrays(
                existing_job.get("diversity_tags"),
                job.get("diversity_tags")
            )
            merged_work_modes = merge_arrays(
                existing_job.get("work_modes"),
                job.get("work_modes")
            )
            merged_badges = merge_arrays(
                existing_job.get("badges"),
                job.get("badges")
            )

            update_data = {
                "is_active": True,
                "discovery_sources": merged_discovery,
                "diversity_tags": merged_diversity,
                "work_modes": merged_work_modes,
                "badges": merged_badges,
                # Update apply_url if available
                "apply_url": job.get("apply_url"),
                # Update experience level if we have a new classification
                "experience_level": job.get("experience_level"),
                "experience_confidence": job.get("experience_confidence", 0.0),
                "experience_matched_patterns": job.get("experience_matched_patterns") or [],
            }

            client.table("jobs").update(update_data).eq("id", job["id"]).execute()
            updated_count += 1
        except Exception as e:
            print(f"Error updating job {job['id']}: {e}")

    return new_count, updated_count


def mark_inactive(active_ids: set[str], dry_run: bool = False) -> int:
    """Mark jobs not in active_ids as inactive.

    Args:
        active_ids: Set of job IDs that are currently active
        dry_run: If True, don't actually update database

    Returns:
        Number of jobs marked inactive
    """
    if dry_run:
        return 0

    client = get_client()

    try:
        # Get IDs of jobs that should be marked inactive
        result = client.table("jobs").select("id").eq("is_active", True).execute()
        all_active = {row["id"] for row in result.data}
        to_deactivate = all_active - active_ids

        if to_deactivate:
            # Update in batches to avoid query size limits
            for job_id in to_deactivate:
                client.table("jobs").update({
                    "is_active": False,
                }).eq("id", job_id).execute()

        return len(to_deactivate)
    except Exception as e:
        print(f"Error marking jobs inactive: {e}")
        return 0


def get_users_to_notify(job: dict) -> list[dict]:
    """Get users who should be notified about this job.

    Args:
        job: The job dict to find matching users for

    Returns:
        List of user preference dicts
    """
    client = get_client()
    users = []

    try:
        # Get users with notify_scope = 'all'
        result = client.table("user_preferences").select("*").eq("notify_scope", "all").execute()
        users.extend(result.data)

        # Get users tracking this specific company
        result = client.table("user_lists").select(
            "user_id, user_preferences(*)"
        ).eq("company_slug", job["company_slug"]).execute()

        for row in result.data:
            if row.get("user_preferences"):
                users.append(row["user_preferences"])

    except Exception as e:
        print(f"Error fetching users to notify: {e}")

    return users


def cleanup_jobs(dry_run: bool = False) -> dict:
    """Clean up old jobs and enforce max active job limit.

    Prioritizes keeping newer jobs over older ones:
    1. Always deactivate jobs older than MAX_AGE_DAYS (30 days)
    2. If still over MAX_ACTIVE_JOBS limit, deactivate oldest jobs
       but protect jobs within PRIORITY_DAYS (7 days)

    Args:
        dry_run: If True, don't actually update database

    Returns:
        Dict with cleanup stats:
        - old_deactivated: Jobs deactivated due to age > 30 days
        - overflow_deactivated: Jobs deactivated due to exceeding limit
        - deactivated_jobs: List of deactivated job details for logging
    """
    result = {
        "old_deactivated": 0,
        "overflow_deactivated": 0,
        "deactivated_jobs": [],
    }

    if dry_run:
        print("  [DRY RUN] Skipping job cleanup")
        return result

    client = get_client()
    now = datetime.now(timezone.utc)
    cutoff_old = now - timedelta(days=MAX_AGE_DAYS)
    cutoff_priority = now - timedelta(days=PRIORITY_DAYS)

    try:
        # Step 1: Get all active jobs with their posted dates
        active_result = client.table("jobs").select(
            "id, title, company_name, posted_at"
        ).eq("is_active", True).execute()

        active_jobs = active_result.data
        print(f"  Current active jobs: {len(active_jobs)}")

        # Step 2: Deactivate jobs older than MAX_AGE_DAYS
        old_job_ids = []
        for job in active_jobs:
            posted_at = job.get("posted_at")
            if posted_at:
                try:
                    if isinstance(posted_at, str):
                        posted_dt = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
                    else:
                        posted_dt = posted_at if posted_at.tzinfo else posted_at.replace(tzinfo=timezone.utc)

                    if posted_dt < cutoff_old:
                        old_job_ids.append(job["id"])
                        result["deactivated_jobs"].append({
                            "id": job["id"],
                            "title": job["title"],
                            "company": job["company_name"],
                            "reason": f"older than {MAX_AGE_DAYS} days",
                        })
                except (ValueError, TypeError):
                    pass  # Skip jobs with invalid dates

        # Deactivate old jobs
        for job_id in old_job_ids:
            client.table("jobs").update({"is_active": False}).eq("id", job_id).execute()

        result["old_deactivated"] = len(old_job_ids)
        if old_job_ids:
            print(f"  Deactivated {len(old_job_ids)} jobs older than {MAX_AGE_DAYS} days")

        # Step 3: Check if still over limit after removing old jobs
        remaining_active = [j for j in active_jobs if j["id"] not in old_job_ids]
        current_count = len(remaining_active)

        if current_count <= MAX_ACTIVE_JOBS:
            print(f"  Active job count ({current_count}) within limit ({MAX_ACTIVE_JOBS})")
            return result

        # Step 4: Need to deactivate more jobs to stay under limit
        overflow = current_count - MAX_ACTIVE_JOBS
        print(f"  Over limit by {overflow} jobs, rotating oldest non-priority jobs")

        # Sort remaining jobs by posted date (oldest first), excluding priority jobs
        def get_posted_datetime(job):
            posted_at = job.get("posted_at")
            if not posted_at:
                # Jobs without a date are considered old
                return datetime.min.replace(tzinfo=timezone.utc)
            try:
                if isinstance(posted_at, str):
                    return datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
                return posted_at if posted_at.tzinfo else posted_at.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                return datetime.min.replace(tzinfo=timezone.utc)

        # Separate priority jobs (< 7 days old) from non-priority
        priority_jobs = []
        non_priority_jobs = []

        for job in remaining_active:
            posted_dt = get_posted_datetime(job)
            if posted_dt >= cutoff_priority:
                priority_jobs.append(job)
            else:
                non_priority_jobs.append(job)

        print(f"  Priority jobs (< {PRIORITY_DAYS} days): {len(priority_jobs)}")
        print(f"  Non-priority jobs: {len(non_priority_jobs)}")

        # Sort non-priority by age (oldest first)
        non_priority_jobs.sort(key=get_posted_datetime)

        # Deactivate oldest non-priority jobs to get under limit
        to_deactivate = non_priority_jobs[:overflow]

        for job in to_deactivate:
            client.table("jobs").update({"is_active": False}).eq("id", job["id"]).execute()
            result["deactivated_jobs"].append({
                "id": job["id"],
                "title": job["title"],
                "company": job["company_name"],
                "reason": "exceeded max active limit (oldest rotated out)",
            })

        result["overflow_deactivated"] = len(to_deactivate)
        print(f"  Rotated out {len(to_deactivate)} oldest jobs to stay under limit")

        # If we couldn't deactivate enough (all non-priority jobs used), warn
        if len(to_deactivate) < overflow:
            shortfall = overflow - len(to_deactivate)
            print(f"  WARNING: Still {shortfall} over limit (all remaining are priority jobs)")

    except Exception as e:
        print(f"  Error during job cleanup: {e}")

    return result
