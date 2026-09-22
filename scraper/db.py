"""Supabase database operations."""

import os
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from supabase import create_client, Client

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY


# ---------------------------------------------------------------------------
# US-only location filtering
# ---------------------------------------------------------------------------
# The app targets US jobs, but sources return worldwide postings (Bengaluru,
# London, Tokyo, Singapore...). We keep a job if its location shows a US signal
# OR is ambiguous (Remote/Hybrid/blank — likely US on these boards), and drop
# it only when it shows a foreign signal with no US signal. Multi-location
# postings that include a US site are kept.

_US_STATE_ABBR = (
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS "
    "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC"
).split()
_US_STATE_NAMES = [
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
    "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
    "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
    "washington", "west virginia", "wisconsin", "wyoming",
]
_US_CITIES = [
    "san francisco", "new york", "seattle", "austin", "boston", "chicago",
    "los angeles", "mountain view", "sunnyvale", "palo alto", "cupertino",
    "menlo park", "san jose", "san diego", "denver", "atlanta", "dallas",
    "houston", "washington dc", "washington, d.c", "bellevue", "redmond",
    "cambridge, ma", "san mateo", "santa clara", "irvine", "pittsburgh",
    "philadelphia", "phoenix", "portland, or", "nyc", "bay area", "silicon valley",
]
_US_TOKENS = [
    "united states", "u.s.a", "u.s.", " usa", "usa ", "(usa)", ", us", " us)",
    "remote us", "remote - us", "remote, us", "remote-us", "remote (us",
    "onsite us", "us remote",
]

_FOREIGN_TOKENS = [
    # India
    "india", "bengaluru", "bangalore", "gurugram", "gurgaon", "hyderabad",
    "pune", "mumbai", "new delhi", "noida", "chennai", "kolkata", "ahmedabad",
    # UK / Ireland
    "united kingdom", "london", "u.k", "(uk)", ", uk", "england", "scotland",
    "edinburgh", "manchester", "ireland", "dublin",
    # Canada
    "canada", "toronto", "vancouver", "montreal", "ontario", "waterloo, on",
    "ottawa", "calgary",
    # Europe
    "france", "paris", "germany", "berlin", "munich", "netherlands",
    "amsterdam", "spain", "madrid", "barcelona", "italy", "poland", "warsaw",
    "krakow", "sweden", "stockholm", "switzerland", "zurich", "portugal",
    "lisbon", "romania", "bucharest", "austria", "vienna", "belgium",
    "brussels", "denmark", "copenhagen", "finland", "helsinki", "norway",
    "oslo", "czech", "prague", "hungary", "budapest", "greece", "athens",
    # Middle East / Africa
    "united arab emirates", "dubai", "abu dhabi", "israel", "tel aviv",
    "egypt", "cairo", "nigeria", "lagos", "south africa", "kenya", "nairobi",
    # APAC
    "singapore", "japan", "tokyo", "china", "shanghai", "beijing", "shenzhen",
    "hong kong", "korea", "seoul", "taiwan", "taipei", "australia", "sydney",
    "melbourne", "new zealand", "auckland", "thailand", "bangkok", "malaysia",
    "kuala lumpur", "vietnam", "hanoi", "ho chi minh", "indonesia", "jakarta",
    "philippines", "manila", "pakistan", "karachi", "lahore", "bangladesh",
    "turkey", "istanbul",
    # LATAM
    "brazil", "sao paulo", "mexico", "mexico city", "argentina", "buenos aires",
    "colombia", "bogota", "chile", "santiago", "peru", "lima", "costa rica",
]

_US_ABBR_RE = re.compile(r",\s*(" + "|".join(_US_STATE_ABBR) + r")\b")


def _has_us_signal(t: str) -> bool:
    if _US_ABBR_RE.search(t):
        return True
    if any(tok in t for tok in _US_TOKENS):
        return True
    if any(name in t for name in _US_STATE_NAMES):
        return True
    if any(city in t for city in _US_CITIES):
        return True
    return False


def _has_foreign_signal(t: str) -> bool:
    return any(tok in t for tok in _FOREIGN_TOKENS)


def is_us_location(location: Optional[str]) -> bool:
    """True if a job location is US-based (or ambiguous), False if clearly foreign."""
    if not location or not location.strip():
        return True  # ambiguous/blank — keep (US-focused boards)
    t = " " + location.lower() + " "
    if _has_us_signal(t):
        return True  # US signal wins even in mixed "SF, CA | London" postings
    if _has_foreign_signal(t):
        return False
    return True  # ambiguous (Remote / Hybrid / Distributed) — keep


# ---------------------------------------------------------------------------
# Experience-level classification from job title (deterministic, no LLM)
# ---------------------------------------------------------------------------
# A title-derived level is authoritative: "Senior/Staff/Manager/Lead" is never
# a new-grad role, so we tag it and exclude it from the New Grad filter. Generic
# titles ("Software Engineer") stay whatever the scraper set (often null).
_LVL_PRINCIPAL = re.compile(
    r"\b(principal|distinguished|fellow)\b", re.IGNORECASE)
_LVL_STAFF = re.compile(
    r"\b(staff|architect|director|vp|"
    r"vice\s+president|head\s+of|l[6-9]|level\s*[6-9])\b", re.IGNORECASE)
_LVL_SENIOR = re.compile(
    r"\b(senior|sr\.?|lead|manager|mgr|l5|level\s*5|iii|iv|"
    r"([6-9]|1[0-9])\+?\s*years)\b", re.IGNORECASE)
_LVL_MID = re.compile(r"\b(mid[\s-]*level|ii|[3-5]\+?\s*years)\b", re.IGNORECASE)
# Interns are their own audience now — classify them distinctly, not as new_grad.
_LVL_INTERN = re.compile(r"\b(intern(ship)?|co[\s-]*op|apprentice(ship)?|summer\s*20\d\d)\b",
                         re.IGNORECASE)
_LVL_NEWGRAD = re.compile(
    r"\b(new\s*grad(uate)?|new\s*college\s*grad|early\s*career|"
    r"university\s*grad|campus|recent\s*grad(uate)?|"
    r"grad\s*(20)?2[4-9]|0[\s-]*2\s*years|l3|level\s*3|sde\s*[i1]\b|"
    r"software\s*engineer\s*[i1]\b)\b", re.IGNORECASE)
# "Entry level" / "Associate" roles are distinct from an explicit New Grad
# posting; checked AFTER new-grad so a title carrying both still reads new_grad.
_LVL_ENTRY = re.compile(r"\b(entry[\s-]*level|associate)\b", re.IGNORECASE)
_LVL_JUNIOR = re.compile(r"\b(junior|jr\.?)\b", re.IGNORECASE)


def classify_experience_from_title(title: Optional[str]) -> Optional[str]:
    """Return a seniority level from a job title, or None if no clear signal.

    Senior/staff signals win over everything (a title can't be both senior and
    new-grad). Only returns a value when the title is unambiguous.
    """
    if not title:
        return None
    t = title
    if _LVL_PRINCIPAL.search(t):
        return "principal"
    if _LVL_STAFF.search(t):
        return "staff"
    if _LVL_SENIOR.search(t):
        return "senior"
    if _LVL_INTERN.search(t):
        return "intern"
    if _LVL_NEWGRAD.search(t):
        return "new_grad"
    if _LVL_ENTRY.search(t):
        return "entry_level"
    if _LVL_JUNIOR.search(t):
        return "junior"
    if _LVL_MID.search(t):
        return "mid"
    return None


# Job rotation constants
MAX_ACTIVE_JOBS = 8000  # Maximum number of active jobs to keep (all experience levels)
PRIORITY_DAYS = 7  # Jobs newer than this are protected from rotation
MAX_AGE_DAYS = 30  # Jobs older than this are always deactivated


_client: Optional[Client] = None


def detect_ats_type(url: str, source: str = "") -> Optional[str]:
    """Infer the ATS platform for a job from its URL (falling back to source).

    Powers the "Auto Apply" support check in the UI. Returns None when the URL
    is a generic careers page with no recognizable ATS."""
    u = (url or "").lower()
    patterns = [
        ("greenhouse", ["greenhouse.io", "boards.greenhouse", "job-boards.greenhouse", "grnh.se", "gh_jid="]),
        ("lever", ["lever.co", "jobs.lever"]),
        ("ashby", ["ashbyhq.com", "jobs.ashby", "ashby_jid="]),
        ("workday", ["myworkdayjobs.com", ".wd1.", ".wd2.", ".wd3.", ".wd5."]),
        ("smartrecruiters", ["smartrecruiters.com"]),
        ("jobvite", ["jobvite.com"]),
        ("icims", ["icims.com"]),
        ("bamboohr", ["bamboohr.com"]),
        ("breezyhr", ["breezy.hr"]),
        ("jazzhr", ["applytojob.com", "jazz.co"]),
        ("recruitee", ["recruitee.com"]),
        ("taleo", ["taleo.net"]),
    ]
    for ats, needles in patterns:
        if any(n in u for n in needles):
            return ats
    # Fall back to the scraper source when it is itself an ATS name
    src = (source or "").lower()
    known = {"greenhouse", "lever", "ashby", "workday"}
    if src in known:
        return src
    return None


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


def upsert_jobs(jobs: list[dict], dry_run: bool = False) -> tuple[int, int, list[dict]]:
    """Insert or update jobs.

    Args:
        jobs: List of normalized job dicts with id, company_slug, title, etc.
        dry_run: If True, don't actually write to database

    Returns:
        Tuple of (new_count, updated_count, newly_inserted_jobs)
    """
    if not jobs:
        return 0, 0, []

    # US-only: drop postings that are clearly outside the US before writing.
    before = len(jobs)
    jobs = [j for j in jobs if is_us_location(j.get("location"))]
    dropped = before - len(jobs)
    if dropped:
        print(f"  Filtered out {dropped} non-US jobs ({len(jobs)} US jobs remain)")
    if not jobs:
        return 0, 0, []

    if dry_run:
        # In dry run mode, just count what would be new
        # We can't check existing without connecting
        return len(jobs), 0, list(jobs)

    client = get_client()

    # Get existing jobs with their array columns for merging.
    # PostgREST caps a single response at 1000 rows, so paginate to get ALL
    # existing ids — otherwise unseen rows get treated as new and the insert
    # fails on duplicate primary keys.
    existing_data = {}
    try:
        page_size = 1000
        offset = 0
        while True:
            resp = client.table("jobs").select(
                "id, discovery_sources, diversity_tags, work_modes, badges"
            ).range(offset, offset + page_size - 1).execute()
            rows = resp.data or []
            for row in rows:
                existing_data[row["id"]] = row
            if len(rows) < page_size:
                break
            offset += page_size
        existing_ids = set(existing_data.keys())
    except Exception as e:
        print(f"Error fetching existing jobs: {e}")
        existing_ids = set()
        existing_data = {}

    new_count = 0
    updated_count = 0

    # Build one record per job. Existing jobs get their array fields merged
    # with what we already have; everything is written via a single chunked
    # upsert (insert-or-update on the primary key) — far faster than a
    # per-row update loop and correct even with thousands of jobs.
    records = []
    for job in jobs:
        existing_job = existing_data.get(job["id"])
        if existing_job is not None:
            discovery = merge_arrays(existing_job.get("discovery_sources"), job.get("discovery_sources"))
            diversity = merge_arrays(existing_job.get("diversity_tags"), job.get("diversity_tags"))
            work_modes = merge_arrays(existing_job.get("work_modes"), job.get("work_modes"))
            badges = merge_arrays(existing_job.get("badges"), job.get("badges"))
            updated_count += 1
        else:
            discovery = job.get("discovery_sources") or []
            diversity = job.get("diversity_tags") or []
            work_modes = job.get("work_modes") or []
            badges = job.get("badges") or []
            new_count += 1

        records.append({
            "id": job["id"],
            "company_slug": job["company_slug"],
            "company_name": job["company_name"],
            "title": job["title"],
            "location": job["location"],
            "url": job["url"],
            "apply_url": job.get("apply_url"),
            "tier": job["tier"],
            "role_types": job.get("role_types") or [],
            "source": job["source"],
            "posted": job.get("posted"),
            "is_active": True,
            "ats_type": detect_ats_type(job.get("url", ""), job.get("source", "")),
            "discovery_sources": discovery,
            "diversity_tags": diversity,
            "work_modes": work_modes,
            "badges": badges,
            # A clear title signal (Senior/Staff/Manager/New Grad/...) overrides;
            # otherwise keep whatever the scraper/classifier set.
            "experience_level": classify_experience_from_title(job.get("title")) or job.get("experience_level"),
            # Pass through structured fields the sources extract. These were
            # previously DROPPED here, which is why salary/sponsorship/funding
            # filters were always empty even though the scrapers populated them.
            # Only include keys that are present so we never overwrite an
            # existing value with None on update.
            **{k: job[k] for k in (
                "salary_min", "salary_max", "salary_text",
                "sponsorship_status", "funding_stage", "deadline",
                # Persist the description so downstream enrichment (salary,
                # sponsorship, work mode, deadlines) can reuse it instead of
                # re-fetching + discarding it every run.
                "description",
            ) if job.get(k) is not None},
        })

    # Register every company first: jobs.company_slug has a FK to companies.slug,
    # so an untracked employer (bank, government agency, new startup) must exist
    # in the companies table or its job insert is rejected. Upsert on slug with
    # merge semantics, so curated rows keep their logo_url/careers_url.
    company_rows = {}
    for record in records:
        slug = record["company_slug"]
        if slug and slug not in company_rows:
            company_rows[slug] = {
                "slug": slug,
                "name": record.get("company_name") or slug,
                "tier": record.get("tier") or "other",
            }
    comp_list = list(company_rows.values())
    for i in range(0, len(comp_list), 500):
        try:
            client.table("companies").upsert(comp_list[i:i + 500], on_conflict="slug").execute()
        except Exception as ce:
            print(f"Error upserting companies chunk {i // 500}: {ce}")

    candidate_new_ids = {record["id"] for record in records if record["id"] not in existing_ids}
    successful_ids: set[str] = set()
    CHUNK = 500
    for i in range(0, len(records), CHUNK):
        chunk = records[i:i + CHUNK]
        try:
            client.table("jobs").upsert(chunk, on_conflict="id").execute()
            successful_ids.update(record["id"] for record in chunk)
        except Exception as ce:
            print(f"Error upserting jobs chunk {i // CHUNK}: {ce}")

    successful_new_ids = successful_ids & candidate_new_ids
    successful_updated_ids = successful_ids - candidate_new_ids
    newly_inserted = [job for job in jobs if job["id"] in successful_new_ids]
    return len(successful_new_ids), len(successful_updated_ids), newly_inserted


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
        # Step 1: Get all active jobs with their posted dates. PostgREST caps a
        # response at 1000 rows, so paginate — otherwise rotation/age-out only
        # ever sees the first 1000 active jobs.
        active_jobs = []
        _off = 0
        while True:
            _batch = client.table("jobs").select(
                "id, title, company_name, posted"
            ).eq("is_active", True).range(_off, _off + 999).execute().data
            if not _batch:
                break
            active_jobs.extend(_batch)
            if len(_batch) < 1000:
                break
            _off += 1000
        print(f"  Current active jobs: {len(active_jobs)}")

        # Step 2: Deactivate jobs older than MAX_AGE_DAYS
        old_job_ids = []
        for job in active_jobs:
            posted_at = job.get("posted")
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
            posted_at = job.get("posted")
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
