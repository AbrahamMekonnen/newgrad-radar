"""USAJobs API adapter.

Federal government job board API.
API docs: https://developer.usajobs.gov/
Requires free API key registration at https://developer.usajobs.gov/APIRequest/Index

Uses production infrastructure from scraper_infra.py:
- get_stealth_headers() for anti-detection headers
- wait_for_rate_limit() for smart rate limiting before API calls
- cached_request() for efficient response caching (1 hour TTL)
- validate_question() for data quality validation

Backward compatible: Falls back gracefully when infrastructure unavailable.
"""

import requests
import time
from datetime import datetime
from typing import Optional, Callable
import sys
import os

# Add parent directory for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import REQUEST_TIMEOUT, USAJOBS_API_KEY, USAJOBS_EMAIL

# Import production infrastructure from scraper_infra
try:
    from utils.scraper_infra import (
        get_stealth_headers,
        wait_for_rate_limit,
        cached_request,
        validate_question,
    )
    INFRASTRUCTURE_AVAILABLE = True
except ImportError:
    # Fallback: define stub functions for backward compatibility
    INFRASTRUCTURE_AVAILABLE = False

    def get_stealth_headers(url: str = "") -> dict:
        return {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        }

    def wait_for_rate_limit(domain: str):
        time.sleep(0.5)  # USAJobs API is generous

    def cached_request(url: str, fetch_fn: Callable, ttl: int = 3600) -> Optional[str]:
        return fetch_fn(url)

    def validate_question(data: dict) -> tuple:
        return True, data, []

# USAJobs API configuration
USAJOBS_BASE_URL = "https://data.usajobs.gov/api/search"

# Entry-level GS grades for new graduates
ENTRY_LEVEL_GRADES = ["05", "06", "07", "08", "09"]

# Domain for rate limiting
USAJOBS_DOMAIN = "data.usajobs.gov"

# Cache TTL - 1 hour
USAJOBS_CACHE_TTL = 3600


def parse_usajobs_date(date_str: Optional[str]) -> Optional[str]:
    """Parse USAJobs date format to ISO format.

    USAJobs uses format like '2026-09-10T00:00:00Z' or '2026-09-10'
    """
    if not date_str:
        return None
    try:
        # Try full ISO format first
        if "T" in date_str:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(date_str)
        return dt.isoformat()
    except (ValueError, AttributeError):
        return None


def is_entry_level(job: dict) -> bool:
    """Check if job is entry-level based on GS grade.

    Looks for GS-5 through GS-9 in the job details.
    """
    job_grade = job.get("JobGrade", [])
    if isinstance(job_grade, list):
        for grade in job_grade:
            code = grade.get("Code", "")
            if code in ENTRY_LEVEL_GRADES:
                return True

    # Also check PositionRemuneration for pay grade hints
    remuneration = job.get("PositionRemuneration", [])
    if isinstance(remuneration, list):
        for pay in remuneration:
            description = pay.get("Description", "")
            # Check for GS-5 through GS-9 in description
            for grade in ENTRY_LEVEL_GRADES:
                if f"GS-{int(grade)}" in description or f"GS {int(grade)}" in description:
                    return True

    return False


def extract_locations(location_data: list) -> str:
    """Extract location string from USAJobs location array.

    Returns comma-separated list of locations or 'Remote' if telework eligible.
    """
    if not location_data or not isinstance(location_data, list):
        return ""

    locations = []
    for loc in location_data[:3]:  # Limit to first 3 locations
        city = loc.get("CityName", "")
        state = loc.get("CountrySubDivisionCode", "")
        if city and state:
            locations.append(f"{city}, {state}")
        elif city:
            locations.append(city)

    return "; ".join(locations) if locations else ""


def _validate_job(job: dict) -> tuple[bool, dict]:
    """Validate a single job using production infrastructure.

    Uses validate_question() from scraper_infra for data quality checks.
    Falls back to basic validation when infrastructure unavailable.
    """
    # Basic required fields check
    if not job.get('title') or not job.get('company'):
        return False, job

    # Basic title validation - skip clearly non-tech roles
    title_lower = job.get('title', '').lower()
    skip_keywords = ['janitor', 'custodian', 'food service', 'cook', 'housekeeper']
    for keyword in skip_keywords:
        if keyword in title_lower:
            return False, job

    # NOTE: do NOT run validate_question() here — that validator is built for
    # interview-question text and rejects ordinary job titles, which zeroed out
    # every USAJobs row. A job with a title, a company, and no excluded keyword
    # is valid.
    return True, job


def fetch_usajobs(
    keywords: str = "software engineer",
    hiring_path: str = "public",
    results_per_page: int = 100,
    entry_level_only: bool = True,
) -> list[dict]:
    """Fetch jobs from USAJobs API with production infrastructure.

    Uses production infrastructure from scraper_infra.py:
    - wait_for_rate_limit() for smart rate limiting before API calls
    - get_stealth_headers() for anti-detection headers
    - cached_request() for response caching (1 hour TTL)
    - validate_question() for data quality validation

    Args:
        keywords: Search keywords (default: software engineer)
        hiring_path: Hiring path filter (public, student, etc.)
        results_per_page: Number of results per request (max 500)
        entry_level_only: If True, filter to GS-5 through GS-9 grades

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted,
        source, external_id
    """
    if not USAJOBS_API_KEY:
        print("Warning: USAJOBS_API_KEY not set. Skipping USAJobs fetch.")
        return []

    # Apply rate limiting before request
    wait_for_rate_limit(USAJOBS_DOMAIN)

    params = {
        "Keyword": keywords,
        "HiringPath": hiring_path,
        "ResultsPerPage": results_per_page,
    }

    # Optionally filter by grade range for entry-level positions
    if entry_level_only:
        params["PayGradeLow"] = "05"
        params["PayGradeHigh"] = "09"

    # Build full URL with params for caching
    from urllib.parse import urlencode
    full_url = f"{USAJOBS_BASE_URL}?{urlencode(params)}"

    def fetch_fn(url: str) -> Optional[str]:
        """Fetch function for cached_request."""
        # USAJobs requires specific auth headers - get stealth headers first
        headers = get_stealth_headers(url)

        # Override with required USAJobs auth headers
        headers.update({
            "Authorization-Key": USAJOBS_API_KEY,
            "User-Agent": USAJOBS_EMAIL or "newgrad-radar-bot",
            "Host": "data.usajobs.gov",
            "Accept": "application/json",
        })

        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.text

    try:
        response_text = cached_request(full_url, fetch_fn, ttl=USAJOBS_CACHE_TTL)
        if not response_text:
            return []

        import json
        data = json.loads(response_text)

    except requests.RequestException as e:
        print(f"Error fetching USAJobs: {e}")
        return []
    except (ValueError, json.JSONDecodeError) as e:
        print(f"Error parsing USAJobs JSON: {e}")
        return []

    jobs = []
    valid_count = 0
    invalid_count = 0

    search_result = data.get("SearchResult", {})
    search_items = search_result.get("SearchResultItems", [])

    for item in search_items:
        job = item.get("MatchedObjectDescriptor", {})

        # NOTE: no secondary is_entry_level() filter here. When entry_level_only
        # is set we already pass PayGradeLow/High=05/09 to the API, which is
        # authoritative. The old local check read a grade number that isn't in
        # the search payload (JobGrade only carries the pay-plan Code, e.g.
        # "GS"), so it silently rejected every row.

        # Extract position details
        position_id = job.get("PositionID", "")
        position_title = job.get("PositionTitle", "")
        org_name = job.get("OrganizationName", "")
        department = job.get("DepartmentName", "")

        # Prefer organization name, fall back to department
        company = org_name or department or "US Federal Government"

        # Get locations
        position_location = job.get("PositionLocation", [])
        location = extract_locations(position_location)

        # Check for remote/telework
        user_area = job.get("UserArea", {})
        details = user_area.get("Details", {})
        # TeleworkEligible is a bool in the API (older docs implied a string),
        # so normalize before comparing.
        telework = details.get("TeleworkEligible", False)
        is_telework = telework is True or (isinstance(telework, str) and telework.lower() == "yes")
        if is_telework and not location:
            location = "Remote Eligible"

        # Get apply URL
        apply_uri = job.get("ApplyURI", [])
        apply_url = apply_uri[0] if apply_uri else job.get("PositionURI", "")

        # Get posting date
        publication_start = job.get("PublicationStartDate", "")

        job_data = {
            "company": company,
            "title": position_title,
            "location": location,
            "url": apply_url,
            "posted": parse_usajobs_date(publication_start),
            "source": "usajobs",
            "external_id": position_id,
        }

        # Validate job using production infrastructure
        is_valid, validated_job = _validate_job(job_data)
        if is_valid:
            jobs.append(validated_job)
            valid_count += 1
        else:
            invalid_count += 1

    print(f"USAJobs: fetched {len(jobs)} jobs (valid: {valid_count}, invalid: {invalid_count})")
    return jobs
