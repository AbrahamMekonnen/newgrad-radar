"""Adzuna Jobs API adapter.

Free tier: 1,000 calls/month
API docs: https://developer.adzuna.com/docs/search
Countries: us, gb, ca, au, de, fr, nl, in, br, mx, etc.

Uses production infrastructure from scraper_infra.py:
- get_stealth_headers() for anti-detection headers
- wait_for_rate_limit() for smart rate limiting before API calls
- cached_request() for efficient response caching
- validate_question() for data quality validation

Backward compatible: Falls back gracefully when infrastructure unavailable.
"""

import requests
from datetime import datetime
from typing import Optional, Callable
import sys
import os

# Add parent directory for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import REQUEST_TIMEOUT, ADZUNA_APP_ID, ADZUNA_APP_KEY

# Import production infrastructure from scraper_infra
try:
    from utils.scraper_infra import (
        get_stealth_headers,
        wait_for_rate_limit,
        cached_request,
        validate_question,
        get_validation_pipeline,
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
        import time
        time.sleep(1.0)  # Conservative 1s delay

    def cached_request(url: str, fetch_fn: Callable, ttl: int = 21600) -> Optional[str]:
        return fetch_fn(url)

    def validate_question(data: dict) -> tuple:
        return True, data, []

    def get_validation_pipeline(min_quality: float = 0.4):
        return None


# Default countries to search (can be expanded)
DEFAULT_COUNTRIES = ["us", "gb", "ca", "au", "de"]

# Domain for rate limiting
ADZUNA_DOMAIN = "api.adzuna.com"

# Cache TTL (30 minutes - API has monthly limits, so cache aggressively)
ADZUNA_CACHE_TTL = 1800


def parse_adzuna_date(date_str: Optional[str]) -> Optional[str]:
    """Parse Adzuna date format and return ISO format.

    Adzuna returns dates in format: 2024-01-15T12:00:00Z
    """
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return dt.isoformat()
    except (ValueError, AttributeError):
        return None


def _validate_job(job: dict) -> tuple[bool, dict]:
    """Validate a single job using production infrastructure.

    Uses validate_question() from scraper_infra for data quality checks.
    Falls back to pass-through validation when infrastructure unavailable.
    """
    if not INFRASTRUCTURE_AVAILABLE:
        return True, job

    try:
        is_valid, cleaned_data, errors = validate_question({
            'content': job.get('title', '') + ' ' + job.get('description', ''),
            'company': job.get('company', ''),
            'source': 'adzuna',
        })
        if is_valid:
            # Merge cleaned data
            job['company'] = cleaned_data.get('company', job.get('company', ''))
            return True, job
        return False, job
    except Exception:
        return True, job  # Pass through on error


def fetch_adzuna(
    countries: list[str] = None,
    category: str = "it-jobs",
    what: str = "software engineer graduate",
    results_per_page: int = 50,
    max_pages: int = 2,
) -> list[dict]:
    """Fetch jobs from Adzuna API with production infrastructure.

    Uses scraper_infra.py infrastructure:
    - wait_for_rate_limit() before each API call to respect rate limits
    - get_stealth_headers() for anti-detection headers
    - cached_request() for response caching (30 min TTL)
    - validate_question() for data quality validation

    Args:
        countries: List of country codes (us, gb, ca, au, de, fr, etc.)
        category: Job category filter (default: it-jobs)
        what: Search keywords (default: software engineer graduate)
        results_per_page: Number of results per page (max 50)
        max_pages: Maximum pages to fetch per country

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted,
        source, external_id, salary_min, salary_max, country
    """
    if not ADZUNA_APP_ID or not ADZUNA_APP_KEY:
        print("Warning: ADZUNA_APP_ID or ADZUNA_APP_KEY not set. Skipping Adzuna.")
        return []

    countries = countries or DEFAULT_COUNTRIES
    all_jobs = []
    total_valid = 0
    total_invalid = 0

    for country in countries:
        for page in range(1, max_pages + 1):
            jobs, valid, invalid = _fetch_adzuna_page(
                country=country,
                page=page,
                category=category,
                what=what,
                results_per_page=results_per_page,
            )

            if not jobs:
                break  # No more results for this country

            all_jobs.extend(jobs)
            total_valid += valid
            total_invalid += invalid

    print(f"Adzuna: fetched {len(all_jobs)} jobs across {len(countries)} countries "
          f"(valid: {total_valid}, invalid: {total_invalid})")
    return all_jobs


def _fetch_adzuna_page(
    country: str,
    page: int,
    category: str,
    what: str,
    results_per_page: int,
) -> tuple[list[dict], int, int]:
    """Fetch a single page of Adzuna results with production infrastructure.

    Uses scraper_infra.py:
    - wait_for_rate_limit() before API call
    - get_stealth_headers() for anti-detection
    - cached_request() for response caching

    Args:
        country: Country code (us, gb, etc.)
        page: Page number (1-indexed)
        category: Job category filter
        what: Search keywords
        results_per_page: Number of results per page

    Returns:
        Tuple of (jobs list, valid count, invalid count)
    """
    # Apply rate limiting before request
    wait_for_rate_limit(ADZUNA_DOMAIN)

    url = f"https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"

    params = {
        "app_id": ADZUNA_APP_ID,
        "app_key": ADZUNA_APP_KEY,
        "results_per_page": min(results_per_page, 50),  # API max is 50
        "what": what,
        "category": category,
        "content-type": "application/json",
    }

    # Build full URL with params for caching
    from urllib.parse import urlencode
    full_url = f"{url}?{urlencode(params)}"

    def fetch_fn(u: str) -> Optional[str]:
        """Fetch function for cached_request."""
        headers = get_stealth_headers(url)
        headers["Accept"] = "application/json"
        response = requests.get(u, headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.text

    try:
        response_text = cached_request(full_url, fetch_fn, ttl=ADZUNA_CACHE_TTL)
        if not response_text:
            return [], 0, 0

        import json
        data = json.loads(response_text)

    except requests.RequestException as e:
        print(f"Error fetching Adzuna {country} page {page}: {e}")
        return [], 0, 0
    except (ValueError, json.JSONDecodeError) as e:
        print(f"Error parsing Adzuna {country} JSON: {e}")
        return [], 0, 0

    jobs = []
    valid_count = 0
    invalid_count = 0

    for job in data.get("results", []):
        # Extract company info
        company_obj = job.get("company", {})
        company_name = company_obj.get("display_name", "") if isinstance(company_obj, dict) else ""

        # Extract location
        location_obj = job.get("location", {})
        if isinstance(location_obj, dict):
            # Build location string from available parts
            location_parts = []
            for key in ["display_name", "area"]:
                val = location_obj.get(key)
                if val:
                    if isinstance(val, list):
                        location_parts.extend(val)
                    else:
                        location_parts.append(val)
            location = ", ".join(location_parts[:2]) if location_parts else ""
        else:
            location = str(location_obj) if location_obj else ""

        # Extract salary info (may not always be present)
        salary_min = job.get("salary_min")
        salary_max = job.get("salary_max")

        job_data = {
            "company": company_name,
            "title": job.get("title", ""),
            "location": location,
            "url": job.get("redirect_url", ""),
            "posted": parse_adzuna_date(job.get("created")),
            "source": "adzuna",
            "external_id": str(job.get("id", "")),
            "salary_min": salary_min,
            "salary_max": salary_max,
            "country": country,
            "description": job.get("description", ""),
        }

        # Validate job
        is_valid, validated_job = _validate_job(job_data)
        if is_valid:
            jobs.append(validated_job)
            valid_count += 1
        else:
            invalid_count += 1

    return jobs, valid_count, invalid_count


def fetch_adzuna_simple(country: str = "us") -> list[dict]:
    """Simple fetch for a single country with default settings.

    Useful for testing or single-country searches.

    Args:
        country: Country code (us, gb, ca, au, de, etc.)

    Returns:
        List of job dicts
    """
    return fetch_adzuna(countries=[country], max_pages=1)
