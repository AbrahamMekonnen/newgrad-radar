#!/usr/bin/env python3
"""
NewGrad Radar - Job Scraper

Fetches new grad software engineering positions from multiple sources,
normalizes them, and writes to Supabase.

Usage:
    python radar.py           # Full run
    python radar.py --dry-run # Test without writing to database
"""

import argparse
import asyncio
import hashlib
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Callable, Optional

from companies import (
    COMPANIES, COMPANY_NAME_TO_SLUG, COMPANY_TOKEN_TO_SLUG,
    generate_company_slug, company_info_for,
)

# New infrastructure imports for production-grade scraping
try:
    from utils.anti_detection import create_stealth_session, StealthSession
    from utils.rate_limiter import DomainThrottler, get_throttler, Priority
    from utils.cache import ResponseCache, IncrementalScraper, get_cache
    from utils.error_handler import ScraperErrorHandler, CheckpointManager, RetryManager
    from utils.monitoring import monitor_scraper, MetricsCollector, get_metrics_collector
    INFRA_AVAILABLE = True
except ImportError as e:
    print(f"[WARN] Infrastructure modules not available: {e}")
    INFRA_AVAILABLE = False

# Global infrastructure instances (initialized in main)
_stealth_session: Optional['StealthSession'] = None
_throttler: Optional['DomainThrottler'] = None
_cache: Optional['ResponseCache'] = None
_error_handler: Optional['ScraperErrorHandler'] = None
_incremental: Optional['IncrementalScraper'] = None
from sources import (
    # Core ATS adapters
    simplify,
    greenhouse,
    lever,
    ashby,
    # Free job board APIs
    fetch_arbeitnow,
    fetch_remoteok,
    fetch_adzuna_simple,
    fetch_usajobs,
    fetch_hn_hiring,
    # Workday (Fortune 500)
    fetch_workday_all,
    WORKDAY_COMPANIES,
    # VC portfolio job boards
    fetch_all_vc_jobs,
    # Diversity conference sponsors
    fetch_all_conference_jobs,
    # Hackathon sponsors
    fetch_all_hackathon_sponsors,
    # Other ATS systems
    fetch_smartrecruiters,
    fetch_icims,
    fetch_jobvite,
    fetch_bamboohr,
    fetch_breezyhr,
    # GitHub community repos
    fetch_all_github_repos,
    # Bootcamp hiring partners
    fetch_all_bootcamp_partners,
    # H1B sponsor data
    add_sponsorship_flags,
    # Funding signals
    get_hot_hiring_companies,
    # Newsletter aggregators
    fetch_all_newsletter_jobs,
    # Deep crawler
    crawl_custom_companies,
)
from classifier import classify_jobs, detect_role_types
from db import upsert_jobs, mark_inactive, get_users_to_notify, get_client, cleanup_jobs, record_notified_jobs
from notify import notify_users, send_ntfy
from webpush import push_to_user
from email_notify import notify_user_by_email
from alerts import process_instant_alerts
from error_reporter import get_reporter
from recruiters import find_recruiters, RecruiterResult
from events import (
    check_for_event_triggers,
    get_event_triggered_companies,
    EventAlertSystem,
    get_upcoming_career_fairs,
    fetch_all_career_fair_companies,
)


def init_infrastructure(
    enable_cache: bool = True,
    enable_stealth: bool = True,
    enable_checkpoints: bool = True,
    checkpoint_dir: str = ".scraper_state",
) -> dict:
    """Initialize production-grade scraping infrastructure.

    Args:
        enable_cache: Enable response caching for incremental scraping
        enable_stealth: Enable anti-detection features
        enable_checkpoints: Enable checkpoint/resume capability
        checkpoint_dir: Directory for checkpoint files

    Returns:
        Dict with initialized components
    """
    global _stealth_session, _throttler, _cache, _error_handler, _incremental

    if not INFRA_AVAILABLE:
        print("[WARN] Infrastructure modules not available, running in basic mode")
        return {}

    components = {}

    # Initialize stealth session for anti-detection
    if enable_stealth:
        try:
            _stealth_session = create_stealth_session(
                min_delay=0.5,
                max_delay=2.0,
                requests_per_minute=30,
            )
            components["stealth_session"] = _stealth_session
            print("  Initialized: StealthSession (anti-detection)")
        except Exception as e:
            print(f"  [WARN] StealthSession init failed: {e}")

    # Initialize domain throttler for rate limiting
    try:
        _throttler = get_throttler()
        components["throttler"] = _throttler
        print("  Initialized: DomainThrottler (rate limiting)")
    except Exception as e:
        print(f"  [WARN] DomainThrottler init failed: {e}")

    # Initialize response cache for incremental scraping
    if enable_cache:
        try:
            _cache = get_cache()
            _incremental = IncrementalScraper("radar_main")
            components["cache"] = _cache
            components["incremental"] = _incremental
            print("  Initialized: ResponseCache + IncrementalScraper")
        except Exception as e:
            print(f"  [WARN] Cache init failed: {e}")

    # Initialize error handler with checkpoints
    if enable_checkpoints:
        try:
            os.makedirs(checkpoint_dir, exist_ok=True)
            _error_handler = ScraperErrorHandler(
                name="radar",
                checkpoint_dir=checkpoint_dir,
                max_retries=3,
                enable_dead_letter=True,
            )
            components["error_handler"] = _error_handler
            print("  Initialized: ScraperErrorHandler (checkpoints/retry)")
        except Exception as e:
            print(f"  [WARN] ErrorHandler init failed: {e}")

    return components


def shutdown_infrastructure():
    """Clean up infrastructure resources."""
    global _cache, _incremental, _error_handler

    if not INFRA_AVAILABLE:
        return

    # Save incremental state
    if _incremental:
        try:
            _incremental.save_state()
        except Exception:
            pass

    # Save checkpoint
    if _error_handler:
        try:
            _error_handler.save_checkpoint()
        except Exception:
            pass


def get_request_config(url: str) -> dict:
    """Get request configuration with stealth headers and rate limiting.

    Args:
        url: Target URL

    Returns:
        Dict with headers, timeout, proxies for requests
    """
    if not INFRA_AVAILABLE or not _stealth_session:
        return {"timeout": 30}

    # Apply rate limiting delay
    if _stealth_session.before_request():
        return _stealth_session.get_request_config(url)

    return {"timeout": 30}


def notify_tracked_company_users(new_jobs: list[dict], dry_run: bool = False) -> dict:
    """Send push and email notifications to users tracking companies with new jobs.

    Args:
        new_jobs: List of new job dicts
        dry_run: If True, don't actually send notifications

    Returns:
        Dict with push_sent and email_sent counts
    """
    result = {"push_sent": 0, "email_sent": 0}

    if not new_jobs:
        return result

    try:
        client = get_client()
    except Exception as e:
        print(f"  Could not connect to database: {e}")
        return result

    # Group jobs by company
    jobs_by_company: dict[str, list[dict]] = {}
    for job in new_jobs:
        slug = job["company_slug"]
        if slug not in jobs_by_company:
            jobs_by_company[slug] = []
        jobs_by_company[slug].append(job)

    # Track which users we've already emailed (to avoid duplicates)
    emailed_users: dict[str, list[dict]] = {}

    for company_slug, jobs in jobs_by_company.items():
        # Get users tracking this company
        query_result = client.table("user_lists").select(
            "user_id, notifications_enabled, filters, "
            "user_preferences!inner(ntfy_topic, push_enabled, email_enabled, role_filters)"
        ).eq("company_slug", company_slug).execute()

        # Also get user emails from auth.users via user_profiles
        user_emails = {}
        user_ids = [row["user_id"] for row in query_result.data or []]
        if user_ids:
            profiles = client.table("user_profiles").select("user_id, email").in_("user_id", user_ids).execute()
            for p in profiles.data or []:
                if p.get("email"):
                    user_emails[p["user_id"]] = p["email"]

        for row in query_result.data or []:
            user_id = row["user_id"]
            # Honour the per-company watchlist toggle: if the user turned
            # notifications OFF for this company, skip it entirely.
            if row.get("notifications_enabled") is False:
                continue
            prefs = row.get("user_preferences", {})
            # Per-company filters override the global role_filters.
            jf = row.get("filters") or {}
            role_filters = jf.get("roles") or jf.get("role_types") or prefs.get("role_filters") or []

            # Filter jobs by role if the user has filters
            matching_jobs = jobs
            if role_filters:
                matching_jobs = [
                    j for j in jobs
                    if any(r in role_filters for r in j.get("role_types", []))
                ]

            if not matching_jobs:
                continue

            company_name = jobs[0]["company_name"]

            # Push notification (ntfy + Web Push, independently)
            if prefs.get("push_enabled"):
                # Deep-link into the in-app filtered view so tapping shows THIS
                # company's job cards, not the generic board.
                app_url = (os.getenv("APP_URL") or "https://newgrad-radar.vercel.app").rstrip("/")
                url = f"{app_url}/?company={company_slug}"
                if len(matching_jobs) == 1:
                    job = matching_jobs[0]
                    title = f"New job at {company_name}"
                    message = f"{job['title']}\n{job['location']}"
                else:
                    title = f"{len(matching_jobs)} new jobs at {company_name}"
                    message = "\n".join(j["title"] for j in matching_jobs[:3])
                    if len(matching_jobs) > 3:
                        message += f"\n...and {len(matching_jobs) - 3} more"

                ntfy_topic = prefs.get("ntfy_topic")
                if dry_run:
                    print(f"    [DRY RUN] Push to user {user_id}: {title}")
                    result["push_sent"] += 1
                else:
                    sent_any = False
                    if ntfy_topic and send_ntfy(ntfy_topic, title, message, url=url, priority="high"):
                        sent_any = True
                    # Web Push to the user's installed PWA / browser devices,
                    # independent of whether they set up ntfy.
                    if push_to_user(client, user_id, title, message, url=url) > 0:
                        sent_any = True
                    if sent_any:
                        result["push_sent"] += 1
                    # Persist so these show under Applications -> Notified Jobs
                    # (Watchlist), returnable to apply later.
                    record_notified_jobs(user_id, [j["id"] for j in matching_jobs], "watchlist")

            # Email notification - collect jobs per user for digest
            if prefs.get("email_enabled"):
                user_email = user_emails.get(user_id)
                if user_email:
                    if user_id not in emailed_users:
                        emailed_users[user_id] = {"email": user_email, "jobs": []}
                    emailed_users[user_id]["jobs"].extend(matching_jobs)

    # Send digest emails (one per user with all their matched jobs)
    for user_id, data in emailed_users.items():
        user_email = data["email"]
        user_jobs = data["jobs"]

        # Dedupe jobs (same job could match multiple tracked companies)
        seen_ids = set()
        unique_jobs = []
        for job in user_jobs:
            if job["id"] not in seen_ids:
                seen_ids.add(job["id"])
                unique_jobs.append(job)

        if unique_jobs:
            if dry_run:
                print(f"    [DRY RUN] Email to {user_email}: {len(unique_jobs)} jobs")
                result["email_sent"] += 1
            else:
                if notify_user_by_email(user_email, unique_jobs):
                    result["email_sent"] += 1

    return result


def generate_job_id(company_slug: str, title: str, url: str) -> str:
    """Generate a stable job ID from company, title, and URL."""
    id_string = f"{company_slug}|{title}|{url}"
    return hashlib.md5(id_string.encode()).hexdigest()[:12]


def normalize_company(raw_company: str) -> str | None:
    """Normalize a company name to its slug.

    Args:
        raw_company: Raw company name from source

    Returns:
        Company slug if found, None otherwise
    """
    if not raw_company:
        return None

    raw_lower = raw_company.lower().strip()

    # Direct slug match
    if raw_lower in COMPANIES:
        return raw_lower

    # Name lookup
    if raw_lower in COMPANY_NAME_TO_SLUG:
        return COMPANY_NAME_TO_SLUG[raw_lower]

    # Token lookup (for ATS sources)
    if raw_lower in COMPANY_TOKEN_TO_SLUG:
        return COMPANY_TOKEN_TO_SLUG[raw_lower]

    # Try common variations
    variations = [
        raw_lower.replace(" ", "-"),
        raw_lower.replace(".", ""),
        raw_lower.replace(".", "-"),
        raw_lower.split()[0] if " " in raw_lower else None,
    ]

    for var in variations:
        if var and var in COMPANIES:
            return var
        if var and var in COMPANY_NAME_TO_SLUG:
            return COMPANY_NAME_TO_SLUG[var]

    # Untracked employer (bank, government agency, new startup...) — generate a
    # slug so its technical roles are still ingested. Non-tech roles are dropped
    # later by the classifier.
    return generate_company_slug(raw_company) or None


def normalize_location(raw_location) -> str:
    """Normalize location to a clean string."""
    if not raw_location:
        return "Remote"

    if isinstance(raw_location, list):
        if len(raw_location) == 0:
            return "Remote"
        if len(raw_location) == 1:
            return raw_location[0]
        # Multiple locations - join first few
        return ", ".join(raw_location[:3])

    return str(raw_location).strip() or "Remote"


def extract_discovery_sources(raw: dict) -> list[str]:
    """Extract discovery sources from raw job data.

    Args:
        raw: Raw job dict from source adapter

    Returns:
        List of discovery source tags
    """
    sources = []

    # Start with the primary source
    primary_source = raw.get("source", "")
    if primary_source:
        sources.append(primary_source)

    # Check source_url for additional source indicators
    source_url = (raw.get("source_url") or raw.get("url") or "").lower()

    # Conference indicators in URL
    conference_patterns = ["ghc", "gracehopper", "tapia", "nsbe", "shpe", "afrotech"]
    for pattern in conference_patterns:
        if pattern in source_url and "conference" not in sources:
            sources.append("conference")
            break

    # Hackathon indicators
    if "mlh" in source_url or "hackathon" in source_url:
        if "hackathon" not in sources:
            sources.append("hackathon")

    return sources


def extract_diversity_tags(raw: dict) -> list[str]:
    """Extract diversity-related tags from raw job data.

    Args:
        raw: Raw job dict from source adapter

    Returns:
        List of diversity tags
    """
    tags = []

    # Combine source and URL for checking
    source = (raw.get("source") or "").lower()
    source_url = (raw.get("source_url") or raw.get("url") or "").lower()
    check_text = f"{source} {source_url}"

    # Conference sponsor mappings
    conference_mappings = {
        "ghc": "ghc_sponsor",
        "gracehopper": "ghc_sponsor",
        "grace hopper": "ghc_sponsor",
        "tapia": "tapia_sponsor",
        "nsbe": "nsbe_sponsor",
        "shpe": "shpe_sponsor",
        "afrotech": "afrotech_sponsor",
    }

    for pattern, tag in conference_mappings.items():
        if pattern in check_text and tag not in tags:
            tags.append(tag)

    # Hackathon/MLH partner
    if "mlh" in check_text:
        tags.append("mlh_partner")

    return tags


def extract_work_modes(location: str) -> list[str]:
    """Extract work mode tags from location string.

    Args:
        location: Normalized location string

    Returns:
        List of work mode tags
    """
    modes = []
    location_lower = location.lower()

    # Check for remote
    if "remote" in location_lower:
        modes.append("remote")

    # Check for hybrid
    if "hybrid" in location_lower:
        modes.append("hybrid")

    # Check for flexible
    if "flexible" in location_lower:
        modes.append("flexible")

    # If has specific location but no remote/hybrid indicators, it's onsite
    # Skip if location is just "Remote" or empty
    has_specific_location = (
        location_lower not in ("remote", "", "anywhere")
        and any(c.isalpha() for c in location_lower)
    )

    if has_specific_location and "remote" not in modes and "hybrid" not in modes:
        # Check if there's a city/state pattern (not just "remote")
        if not location_lower.startswith("remote"):
            modes.append("onsite")

    # Default to onsite if nothing detected but has a location
    if not modes and has_specific_location:
        modes.append("onsite")

    return modes


def extract_badges(raw: dict, company_slug: str, company_info: dict) -> list[str]:
    """Extract badge tags for a job.

    Args:
        raw: Raw job dict from source adapter
        company_slug: Normalized company slug
        company_info: Company info dict from COMPANIES

    Returns:
        List of badge tags
    """
    badges = []

    source = (raw.get("source") or "").lower()

    # Exclusive sources get "hidden_gem" badge
    exclusive_sources = {
        "vc_portfolio", "vc_portfolios", "conference", "conferences",
        "hackathon", "hackathons", "newsletter", "newsletters", "github_repo", "github_repos"
    }
    if source in exclusive_sources:
        badges.append("hidden_gem")

    # YC companies get batch badge
    yc_batch = company_info.get("yc_batch")
    if yc_batch:
        badges.append(f"yc_{yc_batch.lower()}")

    # Recently funded companies get just_funded badge
    if company_info.get("recently_funded") or source == "hot_hiring":
        badges.append("just_funded")

    # High-paying badge from the salary we now scrape (>= $150k base). Kept in
    # sync with the "high_paying" smart filter threshold in the jobs page.
    try:
        if int(raw.get("salary_min") or 0) >= 150000:
            badges.append("high_paying")
    except (TypeError, ValueError):
        pass

    # Check if posted in last 24 hours
    posted = raw.get("posted")
    if posted:
        from datetime import datetime, timezone, timedelta
        try:
            if isinstance(posted, str):
                # Handle ISO format timestamps
                if "T" in posted:
                    posted_dt = datetime.fromisoformat(posted.replace("Z", "+00:00"))
                else:
                    posted_dt = datetime.strptime(posted, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            elif isinstance(posted, datetime):
                posted_dt = posted if posted.tzinfo else posted.replace(tzinfo=timezone.utc)
            else:
                posted_dt = None

            if posted_dt:
                now = datetime.now(timezone.utc)
                if now - posted_dt < timedelta(hours=24):
                    badges.append("new_listing")
        except (ValueError, TypeError):
            pass  # Skip if date parsing fails

    return badges


def is_generic_careers_url(url: str) -> bool:
    """True if the URL is a generic careers landing page rather than a specific
    job posting. Used to drop synthetic "Software Engineering at X" sponsor
    entries whose links go to a company's careers homepage, not the actual job.
    """
    import re
    u = (url or "").strip().rstrip("/")
    if not u:
        return True
    m = re.match(r"https?://([^/]+)(/.*)?$", u)
    if not m:
        return True
    domain = m.group(1).lower()
    path = m.group(2) or ""
    lower = u.lower()
    # Specific-posting markers -> NOT generic
    if any(k in lower for k in (
        "grnh.se/", "/jobs/", "/job/", "/postings/", "/apply", "/o/",
        "gh_jid=", "jobid=", "/careers/job", "/en-us/job",
    )):
        return False
    if re.search(r"\d{4,}", path):
        return False
    if len(path.strip("/")) >= 18:
        return False
    if path == "":
        return True
    if re.search(r"^/careers?/?$|^/jobs?/?$|^/en/?$|^/work-with-us/?$|^/company/careers/?$", path):
        return True
    if "myworkdayjobs.com" in domain and not re.search(r"\d", path):
        return True
    return False


def normalize_job(raw: dict, company_slug: str) -> dict:
    """Convert raw job to normalized format.

    Args:
        raw: Raw job dict from source adapter
        company_slug: Normalized company slug

    Returns:
        Normalized job dict ready for database
    """
    company_info = company_info_for(company_slug, raw.get("company"))

    # Handle both 'location' and 'locations' keys
    location = raw.get("location") or raw.get("locations", [])
    normalized_loc = normalize_location(location)

    # Generate stable ID
    job_id = generate_job_id(company_slug, raw["title"], raw["url"])

    # Detect role types from title
    role_types = detect_role_types(raw["title"])

    # Extract multi-dimensional tag arrays
    discovery_sources = extract_discovery_sources(raw)
    diversity_tags = extract_diversity_tags(raw)
    work_modes = extract_work_modes(normalized_loc)
    badges = extract_badges(raw, company_slug, company_info)

    return {
        "id": job_id,
        "company_slug": company_slug,
        "company_name": company_info["name"],
        "title": raw["title"],
        "location": normalized_loc,
        "url": raw["url"],
        "tier": company_info["tier"],
        "role_types": role_types,
        "source": raw["source"],
        "posted": raw.get("posted"),
        # New multi-dimensional tag arrays
        "discovery_sources": discovery_sources or [],
        "diversity_tags": diversity_tags or [],
        "work_modes": work_modes or [],
        "badges": badges or [],
        # Experience level fields (populated during classification)
        "experience_level": raw.get("experience_level"),
        "experience_confidence": raw.get("experience_confidence", 0.0),
        "experience_matched_patterns": raw.get("experience_matched_patterns", []),
        # Pass through description for experience level detection
        "description": raw.get("description", ""),
    }


def run_event_based_scraping(dry_run: bool = False) -> dict:
    """Run event-based scraping triggered by conferences, hackathons, demo days, and funding.

    This function checks for upcoming events and triggers priority scraping for:
    - Conference/hackathon sponsors (2 weeks before event)
    - YC companies (around Demo Day)
    - Recently funded companies (Series A-C)

    Args:
        dry_run: If True, don't execute actual scraping

    Returns:
        Summary dict with event counts and actions taken
    """
    print("\n--- Event-Based Scraping ---")

    # Quick check for any triggers
    trigger_status = check_for_event_triggers()

    if not trigger_status["has_triggers"]:
        print("  No event triggers active")
        return {"events": 0, "actions": 0}

    print(f"  Found {trigger_status['event_count']} active event(s)")
    print(f"  Event types: {', '.join(trigger_status['event_types'])}")

    if trigger_status["next_event"]:
        print(f"  Next event: {trigger_status['next_event'][:10]}")

    # Run the full event alert system
    system = EventAlertSystem(dry_run=dry_run)
    summary = system.run(days_ahead=14)

    return {
        "events": summary["events_detected"],
        "actions": summary["actions_triggered"],
        "results": summary.get("results", []),
    }


def run_source_parallel(
    source_name: str,
    fetch_fn: Callable[[], list[dict]],
    results: dict,
    errors: dict,
    metrics: Optional['MetricsCollector'] = None,
) -> None:
    """Run a source fetcher and store results (for use in thread pool).

    NEVER raises - all exceptions are caught and logged.
    The pipeline continues regardless of individual source failures.
    All errors are tracked in the global reporter for end-of-run summary.
    Uses infrastructure for retries, caching, and metrics.

    Args:
        source_name: Name of the source for logging
        fetch_fn: Function that returns list of jobs
        results: Shared dict to store results
        errors: Shared dict to store errors
        metrics: Optional metrics collector for tracking
    """
    reporter = get_reporter()
    start_time = datetime.now(timezone.utc)

    # Check if already completed in checkpoint (for resume)
    if _error_handler and _error_handler.is_completed(source_name):
        print(f"  [SKIP] {source_name}: already completed (resume mode)")
        results[source_name] = []
        return

    try:
        # Use retry manager if available
        if INFRA_AVAILABLE and _error_handler:
            retry_mgr = RetryManager(max_retries=3, base_delay=1.0, max_delay=30.0)
            jobs = retry_mgr.execute(fetch_fn)
        else:
            jobs = fetch_fn()

        # Handle None returns gracefully
        if jobs is None:
            jobs = []
        results[source_name] = jobs

        if jobs:
            reporter.add_success(source_name)

            # Track metrics
            if metrics:
                metrics.record_source_success(source_name, len(jobs))

            # Mark completed in checkpoint
            if _error_handler:
                _error_handler.mark_completed(source_name)

    except KeyboardInterrupt:
        raise  # Allow Ctrl+C
    except Exception as e:
        # Log but NEVER crash - pipeline must continue
        error_msg = f"{type(e).__name__}: {str(e)[:200]}"
        errors[source_name] = error_msg
        results[source_name] = []
        # A single source failing (often a flaky/blocked external site) is a
        # warning, not a run-fatal error: the pipeline still writes jobs from
        # the other sources. Keeping it non-critical avoids a red CI run.
        reporter.add_error(source_name, e, is_critical=False)
        print(f"  [WARN] {source_name} failed: {error_msg}")

        # Track error in metrics
        if metrics:
            metrics.record_source_error(source_name, error_msg)

        # Add to dead letter queue if available
        if _error_handler:
            _error_handler.add_to_dlq(source_name, str(e))

    finally:
        # Record timing
        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        if metrics:
            metrics.record_duration(source_name, elapsed)


def fetch_api_sources() -> list[dict]:
    """Fetch jobs from free API sources in parallel.

    Returns:
        List of raw job dicts from all API sources
    """
    print("\n--- Fetching Free API Sources ---")

    results = {}
    errors = {}

    # Define API source fetchers
    api_sources = {
        "arbeitnow": lambda: fetch_arbeitnow(remote_only=False, tech_only=True),
        "remoteok": lambda: fetch_remoteok(filter_entry_level=True),
        "adzuna": lambda: fetch_adzuna_simple("software engineer entry level"),
        "usajobs": lambda: fetch_usajobs(keywords="software developer"),
        "hn_hiring": lambda: fetch_hn_hiring(),
    }

    # Run in parallel with ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(run_source_parallel, name, fn, results, errors): name
            for name, fn in api_sources.items()
        }
        for future in as_completed(futures):
            source_name = futures[future]
            try:
                future.result()  # Raises if exception in thread
            except Exception as e:
                errors[source_name] = str(e)

    # Log results
    all_jobs = []
    for source, jobs in results.items():
        if jobs:
            print(f"  {source}: {len(jobs)} jobs")
            all_jobs.extend(jobs)
        elif source in errors:
            print(f"  {source}: ERROR - {errors[source]}")

    print(f"  Total from API sources: {len(all_jobs)}")
    return all_jobs


def fetch_ats_sources() -> list[dict]:
    """Fetch jobs from ATS systems (Greenhouse, Lever, Ashby, Workday, etc).

    Returns:
        List of raw job dicts from ATS sources
    """
    print("\n--- Fetching ATS Sources ---")
    all_jobs = []

    # SimplifyJobs (primary curated source)
    print("  Fetching SimplifyJobs...")
    try:
        simplify_jobs = simplify.fetch_simplify()
        print(f"    SimplifyJobs: {len(simplify_jobs)} jobs")
        all_jobs.extend(simplify_jobs)
    except Exception as e:
        print(f"    SimplifyJobs: ERROR - {e}")

    # Collect ATS fetch tasks for parallel execution
    ats_tasks = []

    # Greenhouse boards
    for slug, info in COMPANIES.items():
        if info.get("ats_type") == "greenhouse" and info.get("ats_token"):
            ats_tasks.append(("greenhouse", slug, info["ats_token"]))

    # Lever boards
    for slug, info in COMPANIES.items():
        if info.get("ats_type") == "lever" and info.get("ats_token"):
            ats_tasks.append(("lever", slug, info["ats_token"]))

    # Ashby boards
    for slug, info in COMPANIES.items():
        if info.get("ats_type") == "ashby" and info.get("ats_token"):
            ats_tasks.append(("ashby", slug, info["ats_token"]))

    # Run ATS fetches in parallel
    print(f"  Fetching {len(ats_tasks)} ATS boards in parallel...")
    ats_results = {}
    ats_errors = {}

    def fetch_ats_board(ats_type: str, slug: str, token: str):
        if ats_type == "greenhouse":
            # Fetch inline content (?content=true) so we capture salary text +
            # description in the same single request per board — this is what
            # populates the salary/sponsorship/work-mode filters for greenhouse.
            return greenhouse.fetch_greenhouse(token, slug, fetch_salary=True)
        elif ats_type == "lever":
            jobs = lever.fetch_lever(token)
            for job in jobs:
                job["company"] = slug
            return jobs
        elif ats_type == "ashby":
            return ashby.fetch_ashby(token, slug)
        return []

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {}
        for ats_type, slug, token in ats_tasks:
            key = f"{ats_type}:{slug}"
            future = executor.submit(fetch_ats_board, ats_type, slug, token)
            futures[future] = key

        for future in as_completed(futures):
            key = futures[future]
            try:
                jobs = future.result()
                if jobs:
                    ats_results[key] = jobs
            except Exception as e:
                ats_errors[key] = str(e)

    # Aggregate results
    greenhouse_count = 0
    lever_count = 0
    ashby_count = 0

    for key, jobs in ats_results.items():
        ats_type = key.split(":")[0]
        all_jobs.extend(jobs)
        if ats_type == "greenhouse":
            greenhouse_count += len(jobs)
        elif ats_type == "lever":
            lever_count += len(jobs)
        elif ats_type == "ashby":
            ashby_count += len(jobs)

    print(f"    Greenhouse: {greenhouse_count} jobs")
    print(f"    Lever: {lever_count} jobs")
    print(f"    Ashby: {ashby_count} jobs")

    if ats_errors:
        print(f"    Errors: {len(ats_errors)} boards failed")

    # Workday (Fortune 500 companies)
    print("  Fetching Workday boards...")
    try:
        workday_jobs = fetch_workday_all(limit_per_company=150)
        print(f"    Workday: {len(workday_jobs)} jobs")
        all_jobs.extend(workday_jobs)
    except Exception as e:
        print(f"    Workday: ERROR - {e}")

    print(f"  Total from ATS sources: {len(all_jobs)}")
    return all_jobs


def fetch_deep_crawler_sources() -> list[dict]:
    """Fetch jobs from deep crawler (custom career pages).

    Runs daily to catch jobs from companies without standard ATS.
    Limited to prevent overwhelming target sites.

    Returns:
        List of raw job dicts from deep crawling
    """
    print("\n--- Fetching Deep Crawler Sources ---")

    try:
        jobs = crawl_custom_companies()
        print(f"  Deep crawler: {len(jobs)} jobs")
        return jobs
    except Exception as e:
        print(f"  [WARN] Deep crawler failed: {e}")
        return []


def fetch_aggregator_sources() -> list[dict]:
    """Fetch jobs from VC portfolios, conferences, hackathons, newsletters.

    These sources aggregate jobs from companies that are likely hiring.

    Returns:
        List of raw job dicts from aggregator sources
    """
    print("\n--- Fetching Aggregator Sources ---")
    all_jobs = []
    results = {}
    errors = {}

    # Define aggregator source fetchers
    aggregator_sources = {
        "vc_portfolios": fetch_all_vc_jobs,
        "conferences": fetch_all_conference_jobs,
        "hackathons": fetch_all_hackathon_sponsors,
        "newsletters": fetch_all_newsletter_jobs,
        "github_repos": fetch_all_github_repos,
        "bootcamps": fetch_all_bootcamp_partners,
    }

    # Add deep crawler (runs daily, catches custom career pages)
    aggregator_sources["deep_crawler"] = crawl_custom_companies

    # Run in parallel
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(run_source_parallel, name, fn, results, errors): name
            for name, fn in aggregator_sources.items()
        }
        for future in as_completed(futures):
            source_name = futures[future]
            try:
                future.result()
            except Exception as e:
                errors[source_name] = str(e)

    # Log results
    for source, jobs in results.items():
        if jobs:
            print(f"  {source}: {len(jobs)} jobs")
            all_jobs.extend(jobs)
        elif source in errors:
            print(f"  {source}: ERROR - {errors[source]}")

    print(f"  Total from aggregator sources: {len(all_jobs)}")
    return all_jobs


def fetch_career_fair_sources() -> list[dict]:
    """Fetch jobs from upcoming career fair sponsors.

    Returns:
        List of raw job dicts from career fair sponsors
    """
    print("\n--- Fetching Career Fair Sponsors ---")

    upcoming = get_upcoming_career_fairs(days=30)
    if not upcoming:
        print("  No upcoming career fairs in next 30 days")
        return []

    print(f"  Found {len(upcoming)} upcoming career fairs")

    try:
        jobs = fetch_all_career_fair_companies()
        print(f"  Career fair sponsors: {len(jobs)} jobs")
        return jobs
    except Exception as e:
        print(f"  Career fair sponsors: ERROR - {e}")
        return []


def fetch_hot_hiring_sources() -> list[dict]:
    """Fetch jobs from recently funded companies (hot hiring signals).

    Returns:
        List of raw job dicts from recently funded companies
    """
    print("\n--- Fetching Hot Hiring Companies ---")

    try:
        hot_companies = get_hot_hiring_companies(days_back=30)
        if not hot_companies:
            print("  No recently funded companies found")
            return []

        print(f"  Found {len(hot_companies)} recently funded companies")

        # These come as company info, not jobs - we need to scrape their career pages
        jobs = []
        for company in hot_companies[:20]:  # Limit to top 20
            company_jobs = crawl_custom_companies([company])
            jobs.extend(company_jobs)

        print(f"  Hot hiring companies: {len(jobs)} jobs")
        return jobs
    except Exception as e:
        print(f"  Hot hiring companies: ERROR - {e}")
        return []


def deduplicate_jobs(jobs: list[dict]) -> list[dict]:
    """Deduplicate jobs across sources using title + company + location.

    Args:
        jobs: List of job dicts with 'title', 'company', 'location' keys

    Returns:
        Deduplicated list of jobs, preferring higher-quality sources
    """
    # Source priority (higher number = prefer this source)
    source_priority = {
        "simplify": 100,  # Best curated
        "greenhouse": 90,
        "lever": 90,
        "ashby": 90,
        "workday": 85,
        "vc_portfolios": 80,
        "conferences": 75,
        "hackathons": 75,
        "career_fairs": 75,
        "newsletters": 70,
        "github_repos": 70,
        "bootcamps": 65,
        "adzuna": 60,
        "remoteok": 60,
        "arbeitnow": 60,
        "usajobs": 55,
        "hn_hiring": 50,
        "hot_hiring": 50,
        "deep_crawl": 40,
    }

    def get_priority(job: dict) -> int:
        source = job.get("source", "").lower()
        return source_priority.get(source, 0)

    def make_key(job: dict) -> str:
        """Create dedup key from title + company + location."""
        title = (job.get("title") or "").lower().strip()
        company = (job.get("company") or "").lower().strip()
        location = (job.get("location") or "").lower().strip()
        # Normalize location variations
        location = location.replace("remote - ", "").replace("(remote)", "remote")
        return f"{title}|{company}|{location}"

    seen: dict[str, dict] = {}

    for job in jobs:
        key = make_key(job)
        if key not in seen:
            seen[key] = job
        else:
            # Keep higher priority source
            if get_priority(job) > get_priority(seen[key]):
                seen[key] = job

    return list(seen.values())


def fetch_all_jobs(
    dry_run: bool = False,
    include_api: bool = True,
    include_ats: bool = True,
    include_aggregators: bool = True,
    include_career_fairs: bool = True,
    include_hot_hiring: bool = False,  # Slower, disabled by default
) -> list[dict]:
    """Fetch jobs from all sources with parallel execution.

    Args:
        dry_run: If True, limit fetching for testing
        include_api: Fetch from free API sources (Arbeitnow, RemoteOK, etc)
        include_ats: Fetch from ATS systems (Greenhouse, Lever, Workday, etc)
        include_aggregators: Fetch from VC portfolios, conferences, newsletters
        include_career_fairs: Fetch from upcoming career fair sponsors
        include_hot_hiring: Fetch from recently funded companies (slower)

    Returns:
        List of raw job dicts, deduplicated across sources
    """
    all_jobs = []

    # Fetch from each source category
    if include_ats:
        all_jobs.extend(fetch_ats_sources())

    if include_api:
        all_jobs.extend(fetch_api_sources())

    if include_aggregators:
        all_jobs.extend(fetch_aggregator_sources())

    if include_career_fairs:
        all_jobs.extend(fetch_career_fair_sources())

    if include_hot_hiring:
        all_jobs.extend(fetch_hot_hiring_sources())

    # Deduplicate across all sources
    print(f"\n--- Deduplication ---")
    print(f"  Total before dedup: {len(all_jobs)}")
    deduped = deduplicate_jobs(all_jobs)
    print(f"  Total after dedup: {len(deduped)}")

    return deduped


def run_recruiter_enrichment(
    jobs: list[dict],
    recruiter_data_path: str | None,
    dry_run: bool = False,
) -> list[dict]:
    """Enrich jobs with recruiter email information.

    Args:
        jobs: List of classified job dicts
        recruiter_data_path: Path to JSON file with recruiter names by company
        dry_run: If True, skip actual verification

    Returns:
        Jobs with added recruiter info where available
    """
    from recruiters.enricher import enrich_jobs_with_recruiters, EnrichmentConfig

    # Load recruiter data
    recruiter_data = {}
    if recruiter_data_path:
        try:
            with open(recruiter_data_path, "r") as f:
                recruiter_data = json.load(f)
            print(f"  Loaded recruiter data for {len(recruiter_data)} companies")
        except Exception as e:
            print(f"  Warning: Could not load recruiter data: {e}")
            return jobs
    else:
        print("  No recruiter data file provided, skipping enrichment")
        return jobs

    if dry_run:
        print("  [DRY RUN] Skipping SMTP verification")
        # In dry run, just show what would be done
        for company_slug, names in recruiter_data.items():
            print(f"    Would verify {len(names)} recruiters for {company_slug}")
        return jobs

    # Configure for reasonable rate limiting
    config = EnrichmentConfig(
        smtp_timeout=10.0,
        delay_between_checks=0.5,
        max_patterns_to_try=8,
        stop_on_first_valid=True,
    )

    # Run enrichment
    enriched = enrich_jobs_with_recruiters(jobs, recruiter_data, config)

    # Summary
    jobs_with_recruiters = sum(1 for j in enriched if j.get("recruiters"))
    total_recruiters = sum(len(j.get("recruiters", [])) for j in enriched)
    print(f"  Found {total_recruiters} recruiters for {jobs_with_recruiters} jobs")

    return enriched


def process_and_save(raw_jobs: list[dict], args, dry_run: bool) -> tuple[int, int, list[dict], list[dict]]:
    """Normalize -> filter -> dedup -> classify -> upsert ONE batch of raw jobs.

    Saving per source-group (rather than all-at-end) means a timeout or crash
    mid-run keeps everything already fetched — no total loss. Upserts are
    idempotent (keyed by job id), so cross-group duplicates are harmless.

    Returns (new_count, updated_count, classified_jobs, newly_inserted_jobs).
    """
    normalized = []
    for job in raw_jobs:
        if not job.get("title") or not job.get("url"):
            continue
        if is_generic_careers_url(job.get("url", "")):
            continue
        company_slug = normalize_company(job.get("company", ""))
        # Accept ANY employer, not just curated companies. Non-technical roles
        # are filtered out downstream by classify_jobs()/is_technical_role().
        if company_slug:
            normalized.append(normalize_job(job, company_slug))

    # dedup by id within this batch (merge sources)
    seen: dict = {}
    for job in normalized:
        jid = job["id"]
        if jid not in seen:
            seen[jid] = job
        else:
            es = seen[jid].get("source", "")
            ns = job.get("source", "")
            if ns and ns not in es:
                seen[jid]["source"] = f"{es},{ns}"
    deduped = list(seen.values())
    if not deduped:
        return 0, 0, [], []

    classified = classify_jobs(deduped)
    if getattr(args, "add_h1b_flags", False):
        classified = add_sponsorship_flags(classified)
    if getattr(args, "enrich_recruiters", False):
        classified = run_recruiter_enrichment(classified, args.recruiter_data, dry_run)

    new_count, updated_count, newly_inserted = upsert_jobs(classified, dry_run)
    return new_count, updated_count, classified, newly_inserted


def main():
    parser = argparse.ArgumentParser(description="NewGrad Radar Job Scraper")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without writing to database or sending notifications"
    )
    parser.add_argument(
        "--skip-notify",
        action="store_true",
        help="Skip sending notifications"
    )
    parser.add_argument(
        "--enrich-recruiters",
        action="store_true",
        help="Find and verify recruiter emails for each company"
    )
    parser.add_argument(
        "--recruiter-data",
        type=str,
        default=None,
        help="Path to JSON file with recruiter names by company slug"
    )
    parser.add_argument(
        "--event-scrape",
        action="store_true",
        help="Run event-based scraping (conferences, hackathons, demo days, funding)"
    )
    parser.add_argument(
        "--event-only",
        action="store_true",
        help="Only run event-based scraping, skip regular job fetch"
    )
    # Source selection arguments
    parser.add_argument(
        "--skip-api",
        action="store_true",
        help="Skip free API sources (Arbeitnow, RemoteOK, Adzuna, USAJobs, HN)"
    )
    parser.add_argument(
        "--skip-ats",
        action="store_true",
        help="Skip ATS sources (Greenhouse, Lever, Ashby, Workday)"
    )
    parser.add_argument(
        "--skip-aggregators",
        action="store_true",
        help="Skip aggregator sources (VC portfolios, conferences, newsletters)"
    )
    parser.add_argument(
        "--skip-career-fairs",
        action="store_true",
        help="Skip career fair sponsor scraping"
    )
    parser.add_argument(
        "--include-hot-hiring",
        action="store_true",
        help="Include recently funded companies (slower, more thorough)"
    )
    parser.add_argument(
        "--add-h1b-flags",
        action="store_true",
        help="Add H1B sponsorship flags to jobs (helps international students)"
    )
    parser.add_argument(
        "--sources-only",
        type=str,
        default=None,
        help="Comma-separated list of sources to run (e.g., 'simplify,greenhouse,lever')"
    )
    # New infrastructure arguments
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from last checkpoint (skip completed sources)"
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Disable response caching"
    )
    parser.add_argument(
        "--no-stealth",
        action="store_true",
        help="Disable anti-detection features"
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Only fetch new items since last run"
    )
    args = parser.parse_args()

    dry_run = args.dry_run
    if dry_run:
        print("=== DRY RUN MODE ===\n")

    print(f"Starting job scrape at {datetime.now(timezone.utc).isoformat()}...")
    print(f"Tracking {len(COMPANIES)} companies\n")

    # Initialize production-grade infrastructure
    print("--- Initializing Infrastructure ---")
    infra_components = init_infrastructure(
        enable_cache=not args.no_cache,
        enable_stealth=not args.no_stealth,
        enable_checkpoints=True,
    )

    # Load checkpoint for resume mode
    if args.resume and _error_handler:
        checkpoint = _error_handler.load_checkpoint()
        if checkpoint:
            print(f"  Resuming from checkpoint: {checkpoint.get('completed_count', 0)} sources already done")

    # Initialize metrics collector
    metrics = None
    if INFRA_AVAILABLE:
        try:
            metrics = get_metrics_collector()
            metrics.start_run("radar")
            print("  Initialized: MetricsCollector")
        except Exception as e:
            print(f"  [WARN] MetricsCollector init failed: {e}")

    # 0. Event-based scraping (optional)
    event_summary = {"events": 0, "actions": 0}
    if args.event_scrape or args.event_only:
        event_summary = run_event_based_scraping(dry_run)
        print()

    # If event-only mode, skip regular scraping
    if args.event_only:
        print("\n" + "=" * 40)
        print("EVENT-ONLY MODE SUMMARY")
        print("=" * 40)
        print(f"Events detected: {event_summary['events']}")
        print(f"Actions triggered: {event_summary['actions']}")
        print("\nDone!")
        return 0

    # 1-5. Fetch each source GROUP and immediately process + save it, so a
    # timeout/crash mid-run never loses everything already fetched. mark_inactive
    # and cleanup run once at the end over the union of everything seen.
    new_count = 0
    updated_count = 0
    classified: list[dict] = []
    newly_inserted_jobs: list[dict] = []
    active_ids: set = set()
    groups_ok = True  # False if any enabled group failed -> skip mark_inactive

    def _process_group(label: str, jobs: list[dict]) -> None:
        nonlocal new_count, updated_count, groups_ok
        if not jobs:
            return
        print(f"\n--- Processing {label}: {len(jobs)} raw jobs ---")
        try:
            n, u, saved, inserted = process_and_save(jobs, args, dry_run)
        except Exception as e:
            print(f"  ERROR processing {label}: {e} (other groups already saved)")
            groups_ok = False
            return
        new_count += n
        updated_count += u
        classified.extend(saved)
        newly_inserted_jobs.extend(inserted)
        active_ids.update(j["id"] for j in saved)
        print(f"  {label}: saved {n} new, {u} updated (running total: {new_count} new)")

    if not args.skip_ats:
        _process_group("ATS sources", fetch_ats_sources())
    if not args.skip_api:
        _process_group("API sources", fetch_api_sources())
    if not args.skip_aggregators:
        _process_group("aggregator sources", fetch_aggregator_sources())
    if not args.skip_career_fairs:
        _process_group("career-fair sources", fetch_career_fair_sources())
    if args.include_hot_hiring:
        _process_group("hot-hiring sources", fetch_hot_hiring_sources())

    print(f"\nTotal saved: {new_count} new, {updated_count} updated across all groups")

    # Mark inactive jobs (union of everything seen this run). ONLY when every
    # enabled group succeeded — otherwise active_ids is incomplete and we'd
    # wrongly deactivate valid jobs from a group that failed to run.
    if groups_ok and active_ids:
        inactive_count = mark_inactive(active_ids, dry_run)
        if inactive_count > 0:
            print(f"Marked {inactive_count} jobs as inactive")
    else:
        print("Skipping mark-inactive (a source group failed; avoiding false deactivations)")

    # 5.5. Cleanup: enforce max job limit and remove old jobs
    print("\nRunning job cleanup...")
    cleanup_result = cleanup_jobs(dry_run)
    total_cleaned = cleanup_result["old_deactivated"] + cleanup_result["overflow_deactivated"]
    if total_cleaned > 0:
        print(f"  Total cleaned up: {total_cleaned}")
        if cleanup_result["deactivated_jobs"]:
            print("  Deactivated jobs:")
            for job_info in cleanup_result["deactivated_jobs"][:10]:  # Show first 10
                print(f"    - {job_info['company']}: {job_info['title']} ({job_info['reason']})")
            if len(cleanup_result["deactivated_jobs"]) > 10:
                print(f"    ... and {len(cleanup_result['deactivated_jobs']) - 10} more")

    # 6. Notify users about new jobs
    if not args.skip_notify and new_count > 0:
        print("\nSending notifications...")

        # Get the actual new jobs (not just count)
        # We need to compare against what was in DB before
        new_jobs = newly_inserted_jobs

        # Notify users tracking specific companies (My List)
        print("  Notifying tracked company users...")
        tracked_result = notify_tracked_company_users(new_jobs, dry_run)
        print(f"  Sent {tracked_result['push_sent']} push + {tracked_result['email_sent']} email notifications")

        # Process smart job alerts (instant delivery)
        print("  Processing smart job alerts...")
        alert_stats = process_instant_alerts(new_jobs, dry_run)
        if alert_stats["users_notified"] > 0:
            print(f"  Smart alerts: {alert_stats['push_sent']} push + {alert_stats['email_sent']} email to {alert_stats['users_notified']} users")

        # Notify users with scope='all'
        users_by_job = {}
        for job in new_jobs:
            if not dry_run:
                users_by_job[job["id"]] = get_users_to_notify(job)
            else:
                users_by_job[job["id"]] = []

        all_sent = notify_users(new_jobs, users_by_job, dry_run)
        print(f"  Sent {all_sent} 'all jobs' push notifications")
        total = tracked_result['push_sent'] + tracked_result['email_sent'] + all_sent
        print(f"  Total notifications: {total}")

    # Summary
    print("\n" + "=" * 40)
    print("SUMMARY")
    print("=" * 40)
    if args.event_scrape:
        print(f"Events detected: {event_summary['events']}")
        print(f"Event actions: {event_summary['actions']}")

    # Source breakdown
    source_counts: dict[str, int] = {}
    for job in classified:
        sources = job.get("source", "unknown").split(",")
        for source in sources:
            source = source.strip()
            source_counts[source] = source_counts.get(source, 0) + 1

    print(f"\nSource breakdown:")
    for source, count in sorted(source_counts.items(), key=lambda x: -x[1]):
        print(f"  {source}: {count}")

    print(f"\nPipeline stats:")
    print(f"  Total jobs fetched: {len(all_jobs)}")
    print(f"  Target company jobs: {len(normalized)}")
    print(f"  After dedup: {len(deduped)}")
    print(f"  New grad positions: {len(classified)}")
    print(f"  New jobs: {new_count}")
    print(f"  Updated jobs: {updated_count}")

    print(f"\nJob cleanup stats:")
    print(f"  Old jobs removed (>30 days): {cleanup_result['old_deactivated']}")
    print(f"  Overflow jobs rotated: {cleanup_result['overflow_deactivated']}")

    if args.add_h1b_flags:
        sponsors = sum(1 for j in classified if j.get("h1b_sponsor"))
        print(f"  H1B sponsors: {sponsors}")

    if dry_run:
        print("\n[DRY RUN] No changes were made to the database")

    # Report any errors that occurred during the run
    reporter = get_reporter()
    reporter.report(dry_run)

    # Report infrastructure metrics
    if metrics:
        try:
            metrics.end_run()
            print("\n--- Infrastructure Metrics ---")
            stats = metrics.get_stats()
            print(f"  Total sources: {stats.get('sources_attempted', 0)}")
            print(f"  Successful: {stats.get('sources_succeeded', 0)}")
            print(f"  Failed: {stats.get('sources_failed', 0)}")
            print(f"  Total duration: {stats.get('total_duration', 0):.1f}s")
            if stats.get('cache_hits'):
                print(f"  Cache hits: {stats.get('cache_hits', 0)}")
        except Exception as e:
            print(f"  [WARN] Could not report metrics: {e}")

    # Clean up infrastructure (save state)
    shutdown_infrastructure()

    # Clear checkpoint on successful completion (no critical errors)
    if not reporter.has_critical_errors() and _error_handler:
        try:
            _error_handler.clear_checkpoint()
            print("  Checkpoint cleared (successful run)")
        except Exception:
            pass

    # Return non-zero if critical errors occurred (for CI alerting)
    if reporter.has_critical_errors():
        print("\n[EXIT 1] Critical errors occurred - check logs above")
        return 1

    print("\nDone!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
