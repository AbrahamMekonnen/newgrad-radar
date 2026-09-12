#!/usr/bin/env python3
"""
Historical Hiring Patterns Analysis

Analyzes job lifecycle events to identify hiring patterns and generate predictions.
Run daily after the main scraper to update aggregations and predictions.

Usage:
    python analyze_patterns.py           # Full analysis run
    python analyze_patterns.py --dry-run # Preview without database writes
    python analyze_patterns.py --stats   # Show current stats only
"""

import argparse
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Optional
import json
import statistics

from db import get_client


def record_lifecycle_event(
    job_id: str,
    company_slug: str,
    event_type: str,
    job_data: Optional[dict] = None,
    scraper_run_id: Optional[str] = None,
    days_open: Optional[int] = None,
) -> Optional[str]:
    """Insert a job lifecycle event into the database.

    Args:
        job_id: Unique job identifier
        company_slug: Company slug (e.g., 'anthropic')
        event_type: One of 'opened', 'closed', 'reactivated', 'updated'
        job_data: Optional dict with title, role_types, location
        scraper_run_id: Optional UUID of the scraper run that triggered this
        days_open: Days the job was open (for closed/reactivated events)

    Returns:
        UUID of the created event, or None on failure
    """
    client = get_client()

    event_data = {
        "job_id": job_id,
        "company_slug": company_slug,
        "event_type": event_type,
        "event_time": datetime.now(timezone.utc).isoformat(),
    }

    if job_data:
        if "title" in job_data:
            event_data["title"] = job_data["title"]
        if "role_types" in job_data:
            event_data["role_types"] = job_data["role_types"]
        if "location" in job_data:
            event_data["location"] = job_data["location"]

    if scraper_run_id:
        event_data["scraper_run_id"] = scraper_run_id

    if days_open is not None:
        event_data["days_open"] = days_open

    try:
        result = client.table("job_lifecycle_events").insert(event_data).execute()
        if result.data:
            return result.data[0]["id"]
        return None
    except Exception as e:
        print(f"  [WARN] Failed to record lifecycle event: {e}")
        return None


def aggregate_monthly_patterns(dry_run: bool = False) -> dict:
    """Aggregate job lifecycle events into monthly hiring patterns.

    Queries job_lifecycle_events from past 2 years, groups by company/year/month,
    and upserts into hiring_seasons table.

    Args:
        dry_run: If True, calculate but don't write to database

    Returns:
        Summary dict with counts
    """
    client = get_client()
    two_years_ago = (datetime.now(timezone.utc) - timedelta(days=730)).isoformat()

    # Fetch lifecycle events from past 2 years
    try:
        result = client.table("job_lifecycle_events").select(
            "id, job_id, company_slug, event_type, event_time, title, role_types, days_open"
        ).gte("event_time", two_years_ago).execute()

        events = result.data or []
        print(f"  Found {len(events)} lifecycle events in past 2 years")
    except Exception as e:
        print(f"  [ERROR] Failed to fetch lifecycle events: {e}")
        return {"error": str(e), "updated": 0}

    if not events:
        return {"updated": 0, "message": "No events to aggregate"}

    # Group by (company_slug, year, month)
    aggregations = defaultdict(lambda: {
        "roles_opened": 0,
        "roles_closed": 0,
        "unique_titles": set(),
        "role_types_opened": set(),
        "days_open_list": [],
    })

    for event in events:
        event_time = datetime.fromisoformat(event["event_time"].replace("Z", "+00:00"))
        key = (event["company_slug"], event_time.year, event_time.month)

        if event["event_type"] == "opened":
            aggregations[key]["roles_opened"] += 1
            if event.get("title"):
                aggregations[key]["unique_titles"].add(event["title"])
            if event.get("role_types"):
                for rt in event["role_types"]:
                    aggregations[key]["role_types_opened"].add(rt)
        elif event["event_type"] == "closed":
            aggregations[key]["roles_closed"] += 1
            if event.get("days_open") is not None:
                aggregations[key]["days_open_list"].append(event["days_open"])
        elif event["event_type"] == "reactivated":
            aggregations[key]["roles_opened"] += 1  # Count as new opening

    # Fetch previous year data for YoY calculation
    prev_year_data = {}
    try:
        prev_result = client.table("hiring_seasons").select(
            "company_slug, year, month, roles_opened"
        ).execute()
        for row in prev_result.data or []:
            prev_key = (row["company_slug"], row["year"], row["month"])
            prev_year_data[prev_key] = row["roles_opened"]
    except Exception as e:
        print(f"  [WARN] Could not fetch previous year data for YoY: {e}")

    # Prepare upsert data
    upsert_data = []
    for (company_slug, year, month), agg in aggregations.items():
        avg_days = None
        if agg["days_open_list"]:
            avg_days = round(statistics.mean(agg["days_open_list"]), 2)

        # Calculate YoY change
        yoy_change = None
        prev_key = (company_slug, year - 1, month)
        if prev_key in prev_year_data and prev_year_data[prev_key] > 0:
            prev_count = prev_year_data[prev_key]
            yoy_change = round(((agg["roles_opened"] - prev_count) / prev_count) * 100, 2)

        upsert_data.append({
            "company_slug": company_slug,
            "year": year,
            "month": month,
            "roles_opened": agg["roles_opened"],
            "unique_titles": list(agg["unique_titles"]),
            "role_types_opened": list(agg["role_types_opened"]),
            "roles_closed": agg["roles_closed"],
            "avg_days_open": avg_days,
            "net_new_roles": agg["roles_opened"] - agg["roles_closed"],
            "yoy_change_pct": yoy_change,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    print(f"  Aggregated {len(upsert_data)} company-month combinations")

    if dry_run:
        print(f"  [DRY RUN] Would upsert {len(upsert_data)} hiring_seasons records")
        return {"dry_run": True, "would_update": len(upsert_data)}

    # Upsert to hiring_seasons
    updated = 0
    try:
        # Batch upsert
        for record in upsert_data:
            client.table("hiring_seasons").upsert(
                record,
                on_conflict="company_slug,year,month"
            ).execute()
            updated += 1
    except Exception as e:
        print(f"  [ERROR] Failed to upsert hiring_seasons: {e}")
        return {"error": str(e), "updated": updated}

    print(f"  Updated {updated} hiring_seasons records")
    return {"updated": updated}


def calculate_company_stats(dry_run: bool = False) -> dict:
    """Calculate annual company hiring statistics.

    Queries hiring_seasons, calculates stats per company per year, and
    upserts into company_hiring_stats.

    Args:
        dry_run: If True, calculate but don't write to database

    Returns:
        Summary dict with counts
    """
    client = get_client()

    # Fetch all hiring_seasons data
    try:
        result = client.table("hiring_seasons").select("*").execute()
        seasons = result.data or []
        print(f"  Found {len(seasons)} hiring_seasons records")
    except Exception as e:
        print(f"  [ERROR] Failed to fetch hiring_seasons: {e}")
        return {"error": str(e), "updated": 0}

    if not seasons:
        return {"updated": 0, "message": "No seasons data to aggregate"}

    # Group by (company_slug, year)
    company_years = defaultdict(list)
    for season in seasons:
        key = (season["company_slug"], season["year"])
        company_years[key].append(season)

    # Calculate stats for each company-year
    stats_data = []
    for (company_slug, year), months in company_years.items():
        # Find peak hiring month
        peak_month = max(months, key=lambda m: m.get("roles_opened", 0))
        peak_hiring_month = peak_month["month"] if peak_month.get("roles_opened", 0) > 0 else None

        # Calculate total roles
        total_roles = sum(m.get("roles_opened", 0) for m in months)

        # Calculate average posting duration
        days_list = [m["avg_days_open"] for m in months if m.get("avg_days_open") is not None]
        avg_duration = round(statistics.mean(days_list), 2) if days_list else None

        # Aggregate role type breakdown
        role_type_counts = defaultdict(int)
        for month in months:
            for rt in month.get("role_types_opened", []):
                role_type_counts[rt] += 1
        role_type_breakdown = dict(role_type_counts)

        # Determine hiring velocity
        # - aggressive: hiring every month with high numbers
        # - steady: consistent but moderate hiring
        # - burst: concentrated in few months
        # - inactive: little to no hiring
        hiring_months = sum(1 for m in months if m.get("roles_opened", 0) > 0)
        avg_monthly = total_roles / 12 if total_roles > 0 else 0

        if total_roles == 0:
            velocity = "inactive"
        elif hiring_months >= 9 and avg_monthly >= 3:
            velocity = "aggressive"
        elif hiring_months >= 6:
            velocity = "steady"
        elif hiring_months >= 1:
            velocity = "burst"
        else:
            velocity = "inactive"

        # Find predicted hiring window (months with above-average hiring)
        sorted_months = sorted(months, key=lambda m: m.get("roles_opened", 0), reverse=True)
        active_months = [m["month"] for m in sorted_months[:3] if m.get("roles_opened", 0) > 0]
        predicted_start = min(active_months) if active_months else None
        predicted_end = max(active_months) if active_months else None

        stats_data.append({
            "company_slug": company_slug,
            "year": year,
            "total_roles_posted": total_roles,
            "total_new_grad_roles": total_roles,  # Assume all are new grad for now
            "peak_hiring_month": peak_hiring_month,
            "avg_posting_duration_days": avg_duration,
            "role_type_breakdown": json.dumps(role_type_breakdown),
            "location_breakdown": json.dumps({}),  # Not yet tracked at this level
            "predicted_start_month": predicted_start,
            "predicted_end_month": predicted_end,
            "hiring_velocity": velocity,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    print(f"  Calculated stats for {len(stats_data)} company-year combinations")

    if dry_run:
        print(f"  [DRY RUN] Would upsert {len(stats_data)} company_hiring_stats records")
        # Show velocity distribution
        velocity_dist = defaultdict(int)
        for s in stats_data:
            velocity_dist[s["hiring_velocity"]] += 1
        print(f"  Velocity distribution: {dict(velocity_dist)}")
        return {"dry_run": True, "would_update": len(stats_data)}

    # Upsert to company_hiring_stats
    updated = 0
    try:
        for record in stats_data:
            client.table("company_hiring_stats").upsert(
                record,
                on_conflict="company_slug,year"
            ).execute()
            updated += 1
    except Exception as e:
        print(f"  [ERROR] Failed to upsert company_hiring_stats: {e}")
        return {"error": str(e), "updated": updated}

    print(f"  Updated {updated} company_hiring_stats records")
    return {"updated": updated}


def generate_predictions(dry_run: bool = False) -> dict:
    """Generate hiring predictions for the next 6 months.

    Queries companies with 2+ years of data, predicts future hiring based
    on historical monthly averages.

    Args:
        dry_run: If True, calculate but don't write to database

    Returns:
        Summary dict with counts
    """
    client = get_client()
    now = datetime.now(timezone.utc)
    current_year = now.year
    current_month = now.month

    # Fetch companies with multiple years of data
    try:
        result = client.table("hiring_seasons").select(
            "company_slug, year, month, roles_opened, role_types_opened"
        ).execute()
        seasons = result.data or []
    except Exception as e:
        print(f"  [ERROR] Failed to fetch hiring_seasons: {e}")
        return {"error": str(e), "predictions": 0}

    if not seasons:
        return {"predictions": 0, "message": "No historical data for predictions"}

    # Group by company
    company_data = defaultdict(list)
    for season in seasons:
        company_data[season["company_slug"]].append(season)

    # Filter to companies with 2+ years of data
    qualified_companies = {
        slug: data for slug, data in company_data.items()
        if len(set(s["year"] for s in data)) >= 2
    }

    print(f"  Found {len(qualified_companies)} companies with 2+ years of data")

    if not qualified_companies:
        return {"predictions": 0, "message": "No companies with sufficient historical data"}

    # Generate predictions for next 6 months
    predictions = []
    for company_slug, history in qualified_companies.items():
        # Group by month across years
        monthly_history = defaultdict(list)
        for h in history:
            monthly_history[h["month"]].append({
                "roles": h["roles_opened"],
                "role_types": h.get("role_types_opened", []),
                "year": h["year"],
            })

        # Predict next 6 months
        for i in range(1, 7):
            pred_month = (current_month + i - 1) % 12 + 1
            pred_year = current_year if (current_month + i) <= 12 else current_year + 1

            month_data = monthly_history.get(pred_month, [])
            if not month_data:
                continue

            # Calculate expected roles (average of historical data)
            roles_list = [d["roles"] for d in month_data]
            expected_roles = round(statistics.mean(roles_list))

            # Calculate confidence based on data consistency
            # More years of data and lower variance = higher confidence
            years_of_data = len(month_data)
            variance = statistics.variance(roles_list) if len(roles_list) > 1 else 0
            max_roles = max(roles_list) if roles_list else 1

            # Confidence formula: base on years and normalized variance
            base_confidence = min(0.3 * years_of_data, 0.6)  # Max 0.6 from years
            variance_penalty = min(variance / (max_roles ** 2), 0.4) if max_roles > 0 else 0
            confidence = round(base_confidence + 0.4 - variance_penalty, 3)
            confidence = max(0.1, min(0.95, confidence))  # Clamp to [0.1, 0.95]

            # Aggregate expected role types
            all_role_types = []
            for d in month_data:
                all_role_types.extend(d.get("role_types", []))
            expected_role_types = list(set(all_role_types))

            predictions.append({
                "company_slug": company_slug,
                "predicted_month": pred_month,
                "predicted_year": pred_year,
                "confidence": confidence,
                "expected_role_types": expected_role_types,
                "expected_role_count": expected_roles,
                "based_on_years": years_of_data,
                "pattern_type": "historical_avg",
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            })

    print(f"  Generated {len(predictions)} predictions for next 6 months")

    if dry_run:
        print(f"  [DRY RUN] Would upsert {len(predictions)} prediction records")
        # Show confidence distribution
        high_conf = sum(1 for p in predictions if p["confidence"] >= 0.7)
        med_conf = sum(1 for p in predictions if 0.4 <= p["confidence"] < 0.7)
        low_conf = sum(1 for p in predictions if p["confidence"] < 0.4)
        print(f"  Confidence distribution: high={high_conf}, medium={med_conf}, low={low_conf}")
        return {"dry_run": True, "would_create": len(predictions)}

    # Upsert predictions (delete old ones for same period first)
    created = 0
    try:
        # Delete existing predictions for the same future months
        for i in range(1, 7):
            pred_month = (current_month + i - 1) % 12 + 1
            pred_year = current_year if (current_month + i) <= 12 else current_year + 1
            client.table("hiring_predictions").delete().eq(
                "predicted_year", pred_year
            ).eq("predicted_month", pred_month).is_("was_accurate", "null").execute()

        # Insert new predictions
        for pred in predictions:
            client.table("hiring_predictions").insert(pred).execute()
            created += 1
    except Exception as e:
        print(f"  [ERROR] Failed to upsert predictions: {e}")
        return {"error": str(e), "predictions": created}

    print(f"  Created {created} prediction records")
    return {"predictions": created}


def update_job_lifecycle_tracking(
    new_job_ids: set[str],
    updated_job_ids: set[str],
    deactivated_job_ids: set[str],
    jobs_by_id: dict[str, dict],
    scraper_run_id: Optional[str] = None,
) -> dict:
    """Track job lifecycle events from a scraper run.

    Call this after upsert_jobs and mark_inactive to record all events.

    Args:
        new_job_ids: Set of job IDs that were newly created
        updated_job_ids: Set of job IDs that were updated (re-seen)
        deactivated_job_ids: Set of job IDs that were marked inactive
        jobs_by_id: Dict mapping job_id to job data dict
        scraper_run_id: Optional UUID of the scraper run

    Returns:
        Summary dict with event counts
    """
    client = get_client()
    events_created = {
        "opened": 0,
        "closed": 0,
        "reactivated": 0,
    }

    # Record 'opened' events for new jobs
    for job_id in new_job_ids:
        job = jobs_by_id.get(job_id, {})
        event_id = record_lifecycle_event(
            job_id=job_id,
            company_slug=job.get("company_slug", "unknown"),
            event_type="opened",
            job_data=job,
            scraper_run_id=scraper_run_id,
        )
        if event_id:
            events_created["opened"] += 1

    # Check for reactivated jobs (previously inactive, now active again)
    if updated_job_ids:
        try:
            # Get jobs that were inactive but are now being updated
            result = client.table("jobs").select(
                "id, company_slug, title, role_types, location, first_seen_at"
            ).in_("id", list(updated_job_ids)).eq("is_active", False).execute()

            for job in result.data or []:
                # Calculate days since first seen
                days_open = None
                if job.get("first_seen_at"):
                    first_seen = datetime.fromisoformat(
                        job["first_seen_at"].replace("Z", "+00:00")
                    )
                    days_open = (datetime.now(timezone.utc) - first_seen).days

                event_id = record_lifecycle_event(
                    job_id=job["id"],
                    company_slug=job["company_slug"],
                    event_type="reactivated",
                    job_data={
                        "title": job.get("title"),
                        "role_types": job.get("role_types", []),
                        "location": job.get("location"),
                    },
                    scraper_run_id=scraper_run_id,
                    days_open=days_open,
                )
                if event_id:
                    events_created["reactivated"] += 1
        except Exception as e:
            print(f"  [WARN] Failed to check for reactivated jobs: {e}")

    # Record 'closed' events for deactivated jobs
    if deactivated_job_ids:
        try:
            # Get job details for deactivated jobs
            result = client.table("jobs").select(
                "id, company_slug, title, role_types, location, first_seen_at"
            ).in_("id", list(deactivated_job_ids)).execute()

            for job in result.data or []:
                # Calculate days open
                days_open = None
                if job.get("first_seen_at"):
                    first_seen = datetime.fromisoformat(
                        job["first_seen_at"].replace("Z", "+00:00")
                    )
                    days_open = (datetime.now(timezone.utc) - first_seen).days

                event_id = record_lifecycle_event(
                    job_id=job["id"],
                    company_slug=job["company_slug"],
                    event_type="closed",
                    job_data={
                        "title": job.get("title"),
                        "role_types": job.get("role_types", []),
                        "location": job.get("location"),
                    },
                    scraper_run_id=scraper_run_id,
                    days_open=days_open,
                )
                if event_id:
                    events_created["closed"] += 1
        except Exception as e:
            print(f"  [WARN] Failed to record closed events: {e}")

    print(f"  Recorded events: {events_created['opened']} opened, "
          f"{events_created['closed']} closed, {events_created['reactivated']} reactivated")

    return events_created


def verify_prediction_accuracy() -> dict:
    """Check past predictions against actual data and update was_accurate field.

    Returns:
        Summary of verified predictions
    """
    client = get_client()
    now = datetime.now(timezone.utc)
    current_year = now.year
    current_month = now.month

    # Find predictions for past months that haven't been verified
    try:
        result = client.table("hiring_predictions").select("*").is_(
            "was_accurate", "null"
        ).execute()

        unverified = []
        for pred in result.data or []:
            pred_year = pred["predicted_year"]
            pred_month = pred["predicted_month"]
            # Only verify if the month has passed
            if pred_year < current_year or (pred_year == current_year and pred_month < current_month):
                unverified.append(pred)

        print(f"  Found {len(unverified)} unverified past predictions")
    except Exception as e:
        print(f"  [ERROR] Failed to fetch unverified predictions: {e}")
        return {"error": str(e), "verified": 0}

    if not unverified:
        return {"verified": 0, "message": "No predictions to verify"}

    # Get actual data for those months
    verified = 0
    for pred in unverified:
        try:
            actual = client.table("hiring_seasons").select(
                "roles_opened"
            ).eq("company_slug", pred["company_slug"]).eq(
                "year", pred["predicted_year"]
            ).eq("month", pred["predicted_month"]).execute()

            if actual.data:
                actual_roles = actual.data[0]["roles_opened"]
                expected_roles = pred.get("expected_role_count", 0) or 0

                # Consider accurate if within 50% of prediction or both are zero
                if expected_roles == 0 and actual_roles == 0:
                    was_accurate = True
                elif expected_roles > 0:
                    error_pct = abs(actual_roles - expected_roles) / expected_roles
                    was_accurate = error_pct <= 0.5
                else:
                    was_accurate = actual_roles <= 2  # Expected 0, got 0-2 is okay

                client.table("hiring_predictions").update({
                    "was_accurate": was_accurate,
                    "actual_roles": actual_roles,
                    "updated_at": now.isoformat(),
                }).eq("id", pred["id"]).execute()

                verified += 1
        except Exception as e:
            print(f"  [WARN] Failed to verify prediction {pred['id']}: {e}")

    print(f"  Verified {verified} predictions")
    return {"verified": verified}


def get_pattern_stats() -> dict:
    """Get current hiring pattern analysis statistics."""
    client = get_client()
    stats = {}

    tables = [
        ("job_lifecycle_events", "id"),
        ("hiring_seasons", "id"),
        ("company_hiring_stats", "id"),
        ("hiring_predictions", "id"),
    ]

    for table, id_col in tables:
        try:
            result = client.table(table).select(id_col, count="exact").execute()
            stats[table] = result.count or 0
        except Exception as e:
            stats[table] = f"error: {e}"

    # Get recent prediction accuracy
    try:
        result = client.table("hiring_predictions").select(
            "was_accurate"
        ).not_.is_("was_accurate", "null").execute()

        if result.data:
            accurate = sum(1 for r in result.data if r["was_accurate"])
            total = len(result.data)
            stats["prediction_accuracy"] = f"{accurate}/{total} ({round(accurate/total*100, 1)}%)"
        else:
            stats["prediction_accuracy"] = "No verified predictions yet"
    except Exception as e:
        stats["prediction_accuracy"] = f"error: {e}"

    # Get velocity distribution
    try:
        result = client.table("company_hiring_stats").select("hiring_velocity").execute()
        if result.data:
            velocity_dist = defaultdict(int)
            for row in result.data:
                velocity_dist[row["hiring_velocity"] or "unknown"] += 1
            stats["velocity_distribution"] = dict(velocity_dist)
    except Exception as e:
        stats["velocity_distribution"] = f"error: {e}"

    return stats


def run_full_analysis(dry_run: bool = False) -> dict:
    """Run all aggregations in sequence.

    Args:
        dry_run: If True, preview without writing to database

    Returns:
        Combined summary of all operations
    """
    print("=" * 50)
    print("HIRING PATTERNS ANALYSIS")
    print("=" * 50)
    print(f"Start time: {datetime.now(timezone.utc).isoformat()}")
    print(f"Dry run: {dry_run}")
    print()

    results = {}

    # Step 1: Aggregate monthly patterns
    print("Step 1: Aggregating monthly patterns...")
    results["monthly_patterns"] = aggregate_monthly_patterns(dry_run)
    print()

    # Step 2: Calculate company stats
    print("Step 2: Calculating company stats...")
    results["company_stats"] = calculate_company_stats(dry_run)
    print()

    # Step 3: Generate predictions
    print("Step 3: Generating predictions...")
    results["predictions"] = generate_predictions(dry_run)
    print()

    # Step 4: Verify past predictions (only if not dry run)
    if not dry_run:
        print("Step 4: Verifying past predictions...")
        results["verification"] = verify_prediction_accuracy()
    else:
        results["verification"] = {"skipped": True, "reason": "dry_run"}
    print()

    # Summary
    print("=" * 50)
    print("SUMMARY")
    print("=" * 50)
    for step, result in results.items():
        print(f"  {step}: {result}")

    print(f"\nCompleted at: {datetime.now(timezone.utc).isoformat()}")

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Historical Hiring Patterns Analysis"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview without writing to database"
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show current statistics only"
    )
    parser.add_argument(
        "--monthly-only",
        action="store_true",
        help="Only run monthly aggregation"
    )
    parser.add_argument(
        "--predictions-only",
        action="store_true",
        help="Only generate predictions"
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Only verify past predictions"
    )

    args = parser.parse_args()

    if args.stats:
        stats = get_pattern_stats()
        print("\n=== Hiring Pattern Analysis Stats ===")
        for key, value in stats.items():
            print(f"  {key}: {value}")
        return 0

    if args.monthly_only:
        result = aggregate_monthly_patterns(args.dry_run)
        print(f"Result: {result}")
        return 0

    if args.predictions_only:
        result = generate_predictions(args.dry_run)
        print(f"Result: {result}")
        return 0

    if args.verify_only:
        result = verify_prediction_accuracy()
        print(f"Result: {result}")
        return 0

    # Run full analysis
    results = run_full_analysis(args.dry_run)

    # Return non-zero if any errors
    has_errors = any("error" in str(r) for r in results.values())
    return 1 if has_errors else 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
