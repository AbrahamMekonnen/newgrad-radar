"""Other ATS (Applicant Tracking Systems) adapters.

Covers the long tail of ATS systems:
- SmartRecruiters: careers.smartrecruiters.com/{company}
- iCIMS: careers-{company}.icims.com
- Jobvite: jobs.jobvite.com/{company}
- BambooHR: {company}.bamboohr.com/jobs
- BreezyHR: {company}.breezy.hr
- JazzHR: {company}.applytojob.com
- Recruitee: {company}.recruitee.com

Uses production infrastructure:
- StealthSession for anti-detection (header randomization, timing)
- ResponseCache for caching API responses
- AdaptiveRateLimiter for smart rate limiting
- monitor_scraper for tracking metrics
"""

import requests
import time
import logging
from datetime import datetime, timezone
from typing import Optional
import re

from config import REQUEST_TIMEOUT

# Import production infrastructure with fallback
try:
    from utils.anti_detection import StealthSession, create_stealth_session
    from utils.cache import ResponseCache, get_cache
    from utils.rate_limiter import AdaptiveRateLimiter
    from utils.monitoring import monitor_scraper
    INFRA_AVAILABLE = True
except ImportError:
    INFRA_AVAILABLE = False

logger = logging.getLogger(__name__)

# Cache TTL - 6 hours for ATS data
ATS_CACHE_TTL = 21600

# Infrastructure singletons
_stealth_session: Optional['StealthSession'] = None
_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None


def _get_stealth_session() -> Optional['StealthSession']:
    """Get or create stealth session for anti-detection."""
    global _stealth_session
    if not INFRA_AVAILABLE:
        return None
    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=0.5,
            max_delay=2.0,
            requests_per_minute=30  # Be polite to ATS systems
        )
    return _stealth_session


def _get_cache() -> Optional['ResponseCache']:
    """Get or create response cache."""
    global _cache
    if not INFRA_AVAILABLE:
        return None
    if _cache is None:
        _cache = get_cache()
    return _cache


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or create rate limiter."""
    global _rate_limiter
    if not INFRA_AVAILABLE:
        return None
    if _rate_limiter is None:
        _rate_limiter = AdaptiveRateLimiter(
            base_delay=1.0,
            min_delay=0.5,
            max_delay=15.0,
            error_penalty_multiplier=2.5,
        )
    return _rate_limiter


def _make_ats_request(url: str, params: dict = None, headers: dict = None) -> Optional[dict]:
    """Make HTTP request with production infrastructure.

    Uses:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching
    - AdaptiveRateLimiter for smart rate limiting

    Args:
        url: URL to fetch
        params: Optional query parameters
        headers: Optional additional headers

    Returns:
        Parsed JSON response as dict, or None on error
    """
    import json

    session = _get_stealth_session()
    cache = _get_cache()
    rate_limiter = _get_rate_limiter()

    # Build cache key
    cache_key = f"{url}:{json.dumps(params or {}, sort_keys=True)}"

    # Check cache first
    if cache:
        cached = cache.get(cache_key)
        if cached:
            try:
                content = cached.content if hasattr(cached, 'content') else cached
                if isinstance(content, bytes):
                    content = content.decode('utf-8')
                return json.loads(content)
            except (json.JSONDecodeError, AttributeError):
                pass

    # Apply rate limiting with stealth session
    if session:
        if not session.before_request():
            time.sleep(0.5)
    elif rate_limiter:
        rate_limiter.wait_sync()

    # Build headers
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; JobRadar/1.0)",
    }
    timeout = REQUEST_TIMEOUT

    if session:
        config = session.get_request_config(url)
        request_headers = config.get('headers', request_headers)
        request_headers["Accept"] = "application/json"
        timeout = config.get('timeout', REQUEST_TIMEOUT)

    # Merge additional headers
    if headers:
        request_headers.update(headers)

    start_time = time.time()
    try:
        response = requests.get(url, params=params, headers=request_headers, timeout=timeout)
        response_time = time.time() - start_time

        # Record in stealth session
        if session:
            session.after_request(response.status_code)

        response.raise_for_status()

        # Record success
        if rate_limiter:
            rate_limiter.record_success(response_time)

        data = response.json()

        # Cache the response
        if cache:
            cache.set(cache_key, response, ttl=ATS_CACHE_TTL)

        return data

    except requests.RequestException as e:
        logger.error(f"Error fetching {url}: {e}")
        if session:
            session.after_request(500)
        if rate_limiter:
            rate_limiter.record_failure(is_rate_limit='429' in str(e))
        return None
    except ValueError as e:
        logger.error(f"Error parsing JSON from {url}: {e}")
        return None


def parse_iso(ts: Optional[str]) -> Optional[str]:
    """Parse ISO timestamp and return ISO format."""
    if not ts:
        return None
    try:
        # Handle various ISO formats
        ts = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts)
        return dt.isoformat()
    except (ValueError, AttributeError):
        return None


def parse_timestamp_ms(ts: Optional[int]) -> Optional[str]:
    """Convert Unix timestamp (milliseconds) to ISO format."""
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
    except (ValueError, OSError):
        return None


def parse_date_string(date_str: Optional[str]) -> Optional[str]:
    """Parse common date formats and return ISO format."""
    if not date_str:
        return None

    formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%d/%m/%Y",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return None


# -----------------------------------------------------------------------------
# SmartRecruiters
# API: https://careers.smartrecruiters.com/{company}/api/jobs
# Public JSON API, no auth required.
# -----------------------------------------------------------------------------

def fetch_smartrecruiters(company_id: str, company_slug: str = None) -> list[dict]:
    """Fetch jobs from a SmartRecruiters career site.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching (6 hour TTL)
    - AdaptiveRateLimiter for smart rate limiting

    Args:
        company_id: The SmartRecruiters company ID (e.g., "visa", "bosch")
        company_slug: Optional company slug for the result (defaults to company_id)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id
    """
    url = f"https://careers.smartrecruiters.com/{company_id}/api/jobs"

    jobs = []
    offset = 0
    limit = 100  # SmartRecruiters default limit

    while True:
        params = {"offset": offset, "limit": limit}
        data = _make_ats_request(url, params=params)

        if not data:
            break

        content = data.get("content", [])
        if not content:
            break

        for job in content:
            # Extract location from the location object
            location_obj = job.get("location", {})
            location_parts = []
            if location_obj.get("city"):
                location_parts.append(location_obj["city"])
            if location_obj.get("region"):
                location_parts.append(location_obj["region"])
            if location_obj.get("country"):
                location_parts.append(location_obj["country"])
            location = ", ".join(location_parts) if location_parts else location_obj.get("name", "")

            # Build the job URL
            job_id = job.get("id", "")
            job_url = f"https://careers.smartrecruiters.com/{company_id}/{job_id}"
            if job.get("ref"):
                job_url = f"https://careers.smartrecruiters.com/{company_id}/{job.get('ref')}"

            jobs.append({
                "company": company_slug or company_id,
                "title": job.get("name", ""),
                "location": location,
                "url": job_url,
                "apply_url": job_url,  # SmartRecruiters embeds form on job page
                "posted": parse_iso(job.get("releasedDate")),
                "source": "smartrecruiters",
                "external_id": str(job_id),
            })

        # Check if there are more pages
        total_found = data.get("totalFound", 0)
        offset += limit
        if offset >= total_found:
            break

    logger.info(f"SmartRecruiters {company_id}: fetched {len(jobs)} jobs")
    return jobs


# -----------------------------------------------------------------------------
# iCIMS
# URL pattern: https://careers-{company}.icims.com/jobs/search
# Uses a JSON API endpoint with mode=job&includeAll=1
# -----------------------------------------------------------------------------

def fetch_icims(company_id: str, company_slug: str = None) -> list[dict]:
    """Fetch jobs from an iCIMS career site.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching (6 hour TTL)
    - AdaptiveRateLimiter for smart rate limiting

    Args:
        company_id: The iCIMS company ID (e.g., "adobe", "nvidia")
        company_slug: Optional company slug for the result (defaults to company_id)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id
    """
    base_url = f"https://careers-{company_id}.icims.com"
    api_url = f"{base_url}/jobs/search"

    params = {
        "mode": "job",
        "iis": "Company",
        "includeAll": "1",
    }

    data = _make_ats_request(api_url, params=params)
    if not data:
        return []

    jobs = []
    job_list = data.get("jobs", data.get("jobsList", []))

    for job in job_list:
        job_id = job.get("id") or job.get("jobId") or job.get("requisitionId", "")

        # Build location string
        location_parts = []
        if job.get("city"):
            location_parts.append(job["city"])
        if job.get("state"):
            location_parts.append(job["state"])
        if job.get("country"):
            location_parts.append(job["country"])
        location = ", ".join(location_parts) if location_parts else job.get("location", "")

        # Job URL format varies by company
        job_url = job.get("url") or job.get("applyUrl") or f"{base_url}/jobs/{job_id}/job"

        # iCIMS apply URL is usually the same or has /apply suffix
        apply_url = job.get("applyUrl") or job_url

        jobs.append({
            "company": company_slug or company_id,
            "title": job.get("title") or job.get("jobTitle", ""),
            "location": location,
            "url": job_url,
            "apply_url": apply_url,
            "posted": parse_date_string(job.get("postedDate") or job.get("datePosted")),
            "source": "icims",
            "external_id": str(job_id),
        })

    logger.info(f"iCIMS {company_id}: fetched {len(jobs)} jobs")
    return jobs


# -----------------------------------------------------------------------------
# Jobvite
# URL pattern: https://jobs.jobvite.com/companyID/jobs
# Has a JSON API at /api/jobs
# -----------------------------------------------------------------------------

def fetch_jobvite(company_id: str, company_slug: str = None) -> list[dict]:
    """Fetch jobs from a Jobvite career site.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching (6 hour TTL)
    - AdaptiveRateLimiter for smart rate limiting

    Args:
        company_id: The Jobvite company ID (e.g., "twitch", "roku")
        company_slug: Optional company slug for the result (defaults to company_id)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id
    """
    base_url = f"https://jobs.jobvite.com/{company_id}"
    api_url = f"{base_url}/api/jobs"

    params = {
        "c": company_id,
        "sc": "0",  # Start count
        "p": "50",  # Page size
        "ty": "1",  # Type
        "sort": "-postDate",
    }

    data = _make_ats_request(api_url, params=params)
    if not data:
        return []

    jobs = []
    job_list = data.get("jobs", data.get("requisitions", []))

    for job in job_list:
        job_id = job.get("id") or job.get("reqId") or job.get("eId", "")

        # Location handling
        location = job.get("location", "")
        if isinstance(location, dict):
            location_parts = []
            if location.get("city"):
                location_parts.append(location["city"])
            if location.get("state"):
                location_parts.append(location["state"])
            if location.get("country"):
                location_parts.append(location["country"])
            location = ", ".join(location_parts)

        # Build job URL - prefer detail URL for viewing
        job_url = job.get("detailUrl") or f"{base_url}/jobs/{job_id}"
        if not job_url.startswith("http"):
            job_url = f"https://jobs.jobvite.com{job_url}"

        # Jobvite apply URL is separate from detail URL
        apply_url = job.get("applyUrl") or job_url
        if not apply_url.startswith("http"):
            apply_url = f"https://jobs.jobvite.com{apply_url}"

        jobs.append({
            "company": company_slug or company_id,
            "title": job.get("title") or job.get("briefDescription", ""),
            "location": location,
            "url": job_url,
            "apply_url": apply_url,
            "posted": parse_date_string(job.get("postDate") or job.get("dateCreated")),
            "source": "jobvite",
            "external_id": str(job_id),
        })

    logger.info(f"Jobvite {company_id}: fetched {len(jobs)} jobs")
    return jobs


# -----------------------------------------------------------------------------
# BambooHR
# URL pattern: https://{company}.bamboohr.com/careers/list
# Returns JSON with job listings
# -----------------------------------------------------------------------------

def fetch_bamboohr(company_id: str, company_slug: str = None) -> list[dict]:
    """Fetch jobs from a BambooHR career site.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching (6 hour TTL)
    - AdaptiveRateLimiter for smart rate limiting

    Args:
        company_id: The BambooHR company subdomain (e.g., "gitlab", "zapier")
        company_slug: Optional company slug for the result (defaults to company_id)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id
    """
    base_url = f"https://{company_id}.bamboohr.com"
    api_url = f"{base_url}/careers/list"

    data = _make_ats_request(api_url)
    if not data:
        return []

    jobs = []
    job_list = data.get("result", [])

    for job in job_list:
        job_id = job.get("id", "")

        # BambooHR location is usually a simple string or nested
        location = job.get("location", {})
        if isinstance(location, dict):
            location_parts = []
            if location.get("city"):
                location_parts.append(location["city"])
            if location.get("state"):
                location_parts.append(location["state"])
            if location.get("country"):
                location_parts.append(location["country"])
            location = ", ".join(location_parts)
        elif not location:
            location = job.get("locationName", "")

        # Department info (useful for filtering)
        department = job.get("department", {})
        dept_name = department.get("label", "") if isinstance(department, dict) else str(department)

        # Job URL - BambooHR embeds application form on job page
        job_url = f"{base_url}/careers/{job_id}"

        jobs.append({
            "company": company_slug or company_id,
            "title": job.get("jobOpeningName", ""),
            "location": location,
            "url": job_url,
            "apply_url": job_url,  # BambooHR embeds form on job page
            "posted": parse_iso(job.get("dateCreated") or job.get("openDate")),
            "source": "bamboohr",
            "external_id": str(job_id),
            # Include department in metadata if present
            "department": dept_name,
        })

    logger.info(f"BambooHR {company_id}: fetched {len(jobs)} jobs")
    return jobs


# -----------------------------------------------------------------------------
# Breezy HR
# URL pattern: {company}.breezy.hr
# Has a simple API endpoint
# -----------------------------------------------------------------------------

def fetch_breezyhr(company_id: str, company_slug: str = None) -> list[dict]:
    """Fetch jobs from a Breezy HR career site.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching (6 hour TTL)
    - AdaptiveRateLimiter for smart rate limiting

    Args:
        company_id: The Breezy HR company subdomain
        company_slug: Optional company slug for the result (defaults to company_id)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id
    """
    base_url = f"https://{company_id}.breezy.hr"
    api_url = f"{base_url}/json"

    data = _make_ats_request(api_url)
    if not data:
        return []

    jobs = []

    for job in data:
        job_id = job.get("id", "")

        # Location handling
        location_obj = job.get("location", {})
        if isinstance(location_obj, dict):
            location_parts = []
            if location_obj.get("city"):
                location_parts.append(location_obj["city"])
            if location_obj.get("state", {}).get("name"):
                location_parts.append(location_obj["state"]["name"])
            if location_obj.get("country", {}).get("name"):
                location_parts.append(location_obj["country"]["name"])
            location = ", ".join(location_parts)
        else:
            location = str(location_obj) if location_obj else ""

        # Build job URL - Breezy HR embeds application on job page
        friendly_id = job.get("friendly_id", job_id)
        job_url = f"{base_url}/p/{friendly_id}"

        jobs.append({
            "company": company_slug or company_id,
            "title": job.get("name", ""),
            "location": location,
            "url": job_url,
            "apply_url": job_url,  # Breezy HR embeds form on job page
            "posted": parse_iso(job.get("published_date")),
            "source": "breezyhr",
            "external_id": str(job_id),
        })

    logger.info(f"BreezyHR {company_id}: fetched {len(jobs)} jobs")
    return jobs


# -----------------------------------------------------------------------------
# JazzHR (formerly Resumator)
# URL pattern: {company}.applytojob.com/apply
# -----------------------------------------------------------------------------

def fetch_jazzhr(company_id: str, company_slug: str = None) -> list[dict]:
    """Fetch jobs from a JazzHR/Resumator career site.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching (6 hour TTL)
    - AdaptiveRateLimiter for smart rate limiting

    Args:
        company_id: The JazzHR company board key
        company_slug: Optional company slug for the result (defaults to company_id)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id
    """
    api_url = f"https://app.jazz.co/api/hip/v1/jobs/{company_id}"

    data = _make_ats_request(api_url)
    if not data:
        return []

    jobs = []
    job_list = data.get("jobs", [])

    for job in job_list:
        job_id = job.get("id", "")

        # Location
        location_parts = []
        if job.get("city"):
            location_parts.append(job["city"])
        if job.get("state"):
            location_parts.append(job["state"])
        if job.get("country"):
            location_parts.append(job["country"])
        location = ", ".join(location_parts)

        # Job URL - JazzHR uses applytojob.com which is already the application page
        board_code = job.get("board_code", company_id)
        job_url = f"https://{board_code}.applytojob.com/apply/{job_id}"

        jobs.append({
            "company": company_slug or company_id,
            "title": job.get("title", ""),
            "location": location,
            "url": job_url,
            "apply_url": job_url,  # JazzHR URL is already the application page
            "posted": parse_date_string(job.get("original_open_date")),
            "source": "jazzhr",
            "external_id": str(job_id),
        })

    logger.info(f"JazzHR {company_id}: fetched {len(jobs)} jobs")
    return jobs


# -----------------------------------------------------------------------------
# Recruitee
# URL pattern: {company}.recruitee.com
# Has a public JSON API
# -----------------------------------------------------------------------------

def fetch_recruitee(company_id: str, company_slug: str = None) -> list[dict]:
    """Fetch jobs from a Recruitee career site.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching (6 hour TTL)
    - AdaptiveRateLimiter for smart rate limiting

    Args:
        company_id: The Recruitee company subdomain
        company_slug: Optional company slug for the result (defaults to company_id)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id
    """
    api_url = f"https://{company_id}.recruitee.com/api/offers"

    data = _make_ats_request(api_url)
    if not data:
        return []

    jobs = []
    job_list = data.get("offers", [])

    for job in job_list:
        job_id = job.get("id", "")

        # Location
        location = job.get("location", "")
        if job.get("city"):
            location = job["city"]
        if job.get("country"):
            location = f"{location}, {job['country']}" if location else job["country"]

        # Job URL - use the careers_url or construct it
        job_url = job.get("careers_url") or f"https://{company_id}.recruitee.com/o/{job.get('slug', job_id)}"

        jobs.append({
            "company": company_slug or company_id,
            "title": job.get("title", ""),
            "location": location,
            "url": job_url,
            "apply_url": job_url,  # Recruitee embeds form on job page
            "posted": parse_iso(job.get("published_at")),
            "source": "recruitee",
            "external_id": str(job_id),
        })

    logger.info(f"Recruitee {company_id}: fetched {len(jobs)} jobs")
    return jobs
