"""RemoteOK API adapter.

Free API, no auth required. Returns remote jobs from remoteok.com.
API docs: https://remoteok.com/api

Uses production infrastructure from scraper_infra.py:
- get_stealth_headers() for anti-detection headers with rotating User-Agent
- wait_for_rate_limit() for smart rate limiting before API calls
- cached_request() for efficient response caching (1 hour TTL)

Backward compatible: Falls back gracefully when infrastructure unavailable.
"""

import json
import time
import logging
from datetime import datetime
from typing import Optional, Callable

try:
    import requests
except ImportError:
    requests = None

# Import infrastructure modules
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import production infrastructure from scraper_infra
try:
    from utils.scraper_infra import (
        get_stealth_headers,
        wait_for_rate_limit,
        cached_request,
    )
    INFRASTRUCTURE_AVAILABLE = True
except ImportError:
    # Fallback: define stub functions for backward compatibility
    INFRASTRUCTURE_AVAILABLE = False

    def get_stealth_headers(url: str = "") -> dict:
        return {
            "User-Agent": "NewGradRadar/1.0 (job aggregator for new grads)",
            "Accept": "application/json",
        }

    def wait_for_rate_limit(domain: str):
        time.sleep(1.0)  # RemoteOK recommends 1 request per second max

    def cached_request(url: str, fetch_fn: Callable, ttl: int = 3600) -> Optional[str]:
        return fetch_fn(url)

try:
    from config import REQUEST_TIMEOUT
except ImportError:
    REQUEST_TIMEOUT = 30

logger = logging.getLogger(__name__)

# RemoteOK API endpoint with software/engineering tags
REMOTEOK_API_URL = "https://remoteok.com/api"

# Tags to filter for software engineering jobs
SOFTWARE_TAGS = "dev,engineer,software,developer,programming,backend,frontend,fullstack"

# Cache settings - RemoteOK updates frequently but not real-time
REMOTEOK_CACHE_TTL = 3600  # 1 hour cache

# Domain for rate limiting
REMOTEOK_DOMAIN = "remoteok.com"


def parse_timestamp(ts: Optional[int]) -> Optional[str]:
    """Convert Unix timestamp to ISO format."""
    if not ts:
        return None
    try:
        return datetime.utcfromtimestamp(ts).isoformat() + "Z"
    except (ValueError, OSError, TypeError):
        return None


def parse_date_string(date_str: Optional[str]) -> Optional[str]:
    """Parse date string in various formats."""
    if not date_str:
        return None

    formats = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.isoformat() + ("Z" if "Z" not in date_str and "+" not in date_str else "")
        except (ValueError, TypeError):
            continue

    return None


def is_entry_level(job: dict) -> bool:
    """Check if job appears to be entry-level/new grad friendly."""
    title = job.get("position", "").lower()
    description = job.get("description", "").lower() if job.get("description") else ""
    tags = [t.lower() for t in job.get("tags", [])] if job.get("tags") else []

    senior_keywords = ["senior", "sr.", "lead", "principal", "staff", "architect", "director", "manager", "head of"]
    for keyword in senior_keywords:
        if keyword in title:
            return False

    entry_keywords = ["junior", "jr.", "entry", "grad", "new grad", "associate", "intern"]
    for keyword in entry_keywords:
        if keyword in title or keyword in description:
            return True
        if keyword in tags:
            return True

    return True


def normalize_location(job: dict) -> str:
    """Extract and normalize location from job data."""
    location = job.get("location", "")

    if not location or location.lower() in ["", "worldwide", "anywhere"]:
        return "Remote"

    return f"Remote - {location}"


def extract_tags(job: dict) -> list[str]:
    """Extract relevant tags from job data."""
    tags = job.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    return tags if tags else []


def _make_request(url: str) -> Optional[list]:
    """Make HTTP request with production infrastructure.

    Uses scraper_infra.py:
    - wait_for_rate_limit() before each request
    - get_stealth_headers() for anti-detection with rotating User-Agent
    - cached_request() for response caching

    Args:
        url: URL to fetch

    Returns:
        Parsed JSON response as list, or None on error
    """
    if requests is None:
        logger.error("requests module not available")
        return None

    # Apply rate limiting before request
    wait_for_rate_limit(REMOTEOK_DOMAIN)

    def fetch_fn(u: str) -> Optional[str]:
        """Fetch function for cached_request."""
        # Get stealth headers with rotating User-Agent
        request_headers = get_stealth_headers(url)
        request_headers["Accept"] = "application/json"

        response = requests.get(u, headers=request_headers, timeout=REQUEST_TIMEOUT)

        # Handle rate limiting with retry
        if response.status_code == 429:
            logger.warning("RemoteOK rate limited, backing off...")
            time.sleep(5.0)
            response = requests.get(u, headers=request_headers, timeout=REQUEST_TIMEOUT)

        response.raise_for_status()
        return response.text

    try:
        response_text = cached_request(url, fetch_fn, ttl=REMOTEOK_CACHE_TTL)
        if not response_text:
            return None

        data = json.loads(response_text)
        logger.debug("RemoteOK API request successful")
        return data

    except requests.RequestException as e:
        logger.error(f"Error fetching RemoteOK: {e}")
        return None
    except (ValueError, json.JSONDecodeError) as e:
        logger.error(f"Error parsing RemoteOK JSON: {e}")
        return None


def fetch_remoteok(filter_entry_level: bool = True) -> list[dict]:
    """Fetch software engineering jobs from RemoteOK.

    Uses production infrastructure from scraper_infra.py:
    - wait_for_rate_limit() before API call (1 req/sec limit)
    - get_stealth_headers() for anti-detection headers
    - cached_request() for response caching (1 hour TTL)

    Args:
        filter_entry_level: If True, filter out senior positions (default True)

    Returns:
        List of job dicts with keys: company, title, location, url, posted,
        source, external_id, tags
    """
    url = f"{REMOTEOK_API_URL}?tags={SOFTWARE_TAGS}"

    data = _make_request(url)
    if not data:
        return []

    jobs = []
    skipped_senior = 0

    # First item in response is a legal/metadata object, skip it
    job_list = data[1:] if len(data) > 0 and isinstance(data[0], dict) and "legal" in data[0] else data

    for job in job_list:
        if not isinstance(job, dict):
            continue

        if not job.get("id") or not job.get("position"):
            continue

        # Filter for entry-level if requested
        if filter_entry_level and not is_entry_level(job):
            skipped_senior += 1
            continue

        # Parse the posted date
        posted = None
        if job.get("epoch"):
            posted = parse_timestamp(int(job.get("epoch")))
        elif job.get("date"):
            posted = parse_date_string(job.get("date"))

        jobs.append({
            "company": job.get("company", ""),
            "title": job.get("position", ""),
            "location": normalize_location(job),
            "url": job.get("url", f"https://remoteok.com/remote-jobs/{job.get('id')}"),
            "posted": posted,
            "source": "remoteok",
            "external_id": str(job.get("id", "")),
            "tags": extract_tags(job),
        })

    logger.info(f"RemoteOK: {len(jobs)} jobs fetched ({skipped_senior} senior positions skipped)")
    return jobs


# Export for CLI
if __name__ == "__main__":
    import json
    jobs = fetch_remoteok(filter_entry_level=True)
    print(json.dumps(jobs[:5], indent=2))
    print(f"\nTotal: {len(jobs)} jobs")
