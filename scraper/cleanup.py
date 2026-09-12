"""Database cleanup - delete old jobs to stay within Supabase free tier."""

from datetime import datetime, timedelta
from db import get_client


def cleanup_old_jobs(days: int = 30, dry_run: bool = False) -> dict:
    """Delete jobs older than specified days.

    Args:
        days: Delete jobs older than this many days (default 30)
        dry_run: If True, just count without deleting

    Returns:
        dict with counts of deleted items
    """
    client = get_client()
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

    results = {
        "jobs_deleted": 0,
        "saved_jobs_orphaned": 0,
        "applications_orphaned": 0,
        "dry_run": dry_run,
        "cutoff_date": cutoff[:10],
    }

    # Count jobs to delete
    count_result = client.table("jobs").select("id", count="exact").lt("posted", cutoff).execute()
    job_count = count_result.count or 0

    if dry_run:
        results["jobs_deleted"] = job_count
        print(f"[DRY RUN] Would delete {job_count} jobs older than {days} days")
        return results

    if job_count == 0:
        print(f"No jobs older than {days} days to delete")
        return results

    # Get IDs of jobs to delete
    old_jobs = client.table("jobs").select("id").lt("posted", cutoff).execute()
    old_job_ids = [j["id"] for j in old_jobs.data]

    # Delete in batches to avoid timeouts
    batch_size = 100
    deleted = 0

    for i in range(0, len(old_job_ids), batch_size):
        batch = old_job_ids[i:i + batch_size]

        # Delete related saved_jobs first (foreign key)
        saved_result = client.table("saved_jobs").delete().in_("job_id", batch).execute()
        results["saved_jobs_orphaned"] += len(saved_result.data) if saved_result.data else 0

        # Delete related application_logs
        app_result = client.table("application_logs").delete().in_("job_id", batch).execute()
        results["applications_orphaned"] += len(app_result.data) if app_result.data else 0

        # Delete the jobs
        job_result = client.table("jobs").delete().in_("id", batch).execute()
        deleted += len(job_result.data) if job_result.data else 0

        print(f"Deleted batch {i // batch_size + 1}: {len(batch)} jobs")

    results["jobs_deleted"] = deleted
    print(f"Cleanup complete: {deleted} jobs deleted")

    return results


def cleanup_inactive_jobs(days: int = 14, dry_run: bool = False) -> dict:
    """Delete jobs marked inactive for more than specified days.

    Jobs are marked inactive when they're no longer found on career pages.

    Args:
        days: Delete inactive jobs older than this many days
        dry_run: If True, just count without deleting

    Returns:
        dict with counts
    """
    client = get_client()
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

    # Count inactive jobs
    count_result = client.table("jobs").select("id", count="exact").eq("is_active", False).lt("updated_at", cutoff).execute()
    job_count = count_result.count or 0

    if dry_run:
        print(f"[DRY RUN] Would delete {job_count} inactive jobs")
        return {"inactive_deleted": job_count, "dry_run": True}

    if job_count == 0:
        print("No old inactive jobs to delete")
        return {"inactive_deleted": 0}

    # Get and delete
    old_inactive = client.table("jobs").select("id").eq("is_active", False).lt("updated_at", cutoff).execute()
    ids = [j["id"] for j in old_inactive.data]

    # Delete related records first
    client.table("saved_jobs").delete().in_("job_id", ids).execute()
    client.table("application_logs").delete().in_("job_id", ids).execute()

    # Delete jobs
    client.table("jobs").delete().in_("id", ids).execute()

    print(f"Deleted {len(ids)} inactive jobs")
    return {"inactive_deleted": len(ids)}


def get_storage_stats() -> dict:
    """Get current database storage usage estimates."""
    client = get_client()

    stats = {}

    # Count rows in each table
    tables = ["jobs", "saved_jobs", "user_profiles", "application_logs", "recruiters", "user_lists"]

    for table in tables:
        try:
            result = client.table(table).select("id", count="exact").execute()
            stats[table] = result.count or 0
        except Exception as e:
            stats[table] = f"error: {e}"

    # Estimate sizes (rough averages)
    size_estimates = {
        "jobs": 500,  # bytes per row
        "saved_jobs": 50,
        "user_profiles": 200,
        "application_logs": 150,
        "recruiters": 300,
        "user_lists": 100,
    }

    total_bytes = 0
    for table, count in stats.items():
        if isinstance(count, int):
            total_bytes += count * size_estimates.get(table, 100)

    stats["estimated_mb"] = round(total_bytes / (1024 * 1024), 2)
    stats["free_tier_mb"] = 500
    stats["usage_percent"] = round((total_bytes / (1024 * 1024)) / 500 * 100, 1)

    return stats


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Database cleanup utilities")
    parser.add_argument("--dry-run", action="store_true", help="Preview without deleting")
    parser.add_argument("--days", type=int, default=30, help="Delete jobs older than N days")
    parser.add_argument("--stats", action="store_true", help="Show storage stats only")
    parser.add_argument("--inactive", action="store_true", help="Clean up inactive jobs")

    args = parser.parse_args()

    if args.stats:
        stats = get_storage_stats()
        print("\n=== Storage Stats ===")
        for key, value in stats.items():
            print(f"  {key}: {value}")
    elif args.inactive:
        cleanup_inactive_jobs(days=args.days, dry_run=args.dry_run)
    else:
        cleanup_old_jobs(days=args.days, dry_run=args.dry_run)
