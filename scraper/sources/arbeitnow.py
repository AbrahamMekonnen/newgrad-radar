"""Arbeitnow Job Board API adapter.

Free API, no auth required. Returns tech jobs with EU/UK focus.
API docs: https://www.arbeitnow.com/api/job-board-api

Uses production infrastructure from scraper_infra.py:
- get_stealth_headers() for anti-detection headers
- wait_for_rate_limit() for smart rate limiting before API calls
- cached_request() for efficient response caching (1 hour TTL)
- get_proxy_for_url() for EU geo-targeting (optional)

Backward compatible: Falls back gracefully when infrastructure unavailable.
"""

import json
import requests
import time
from datetime import datetime
from typing import Optional, Callable
import sys
import os

# Add parent path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import REQUEST_TIMEOUT

# Import production infrastructure from scraper_infra
try:
    from utils.scraper_infra import (
        get_stealth_headers,
        wait_for_rate_limit,
        cached_request,
        get_proxy_for_url,
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
        time.sleep(0.5)  # API is generous

    def cached_request(url: str, fetch_fn: Callable, ttl: int = 3600) -> Optional[str]:
        return fetch_fn(url)

    def get_proxy_for_url(url: str) -> Optional[dict]:
        return None

# Domain for rate limiting
ARBEITNOW_DOMAIN = "www.arbeitnow.com"

# Cache TTL - 1 hour
ARBEITNOW_CACHE_TTL = 3600


# Tech-related tags to filter for
TECH_TAGS = {
    "software", "engineering", "developer", "python", "javascript", "typescript",
    "java", "golang", "rust", "c++", "react", "node", "backend", "frontend",
    "fullstack", "full-stack", "devops", "sre", "data", "machine learning",
    "ml", "ai", "cloud", "aws", "gcp", "azure", "kubernetes", "docker",
    "infrastructure", "platform", "mobile", "ios", "android", "web",
    "api", "microservices", "database", "sql", "nosql", "security",
}


def parse_timestamp(ts: Optional[str]) -> Optional[str]:
    """Parse Arbeitnow timestamp and return ISO format.

    Arbeitnow returns timestamps in ISO format or Unix timestamp.
    """
    if not ts:
        return None
    try:
        # Try ISO format first
        if isinstance(ts, str):
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.isoformat()
        # Handle Unix timestamp
        if isinstance(ts, (int, float)):
            dt = datetime.fromtimestamp(ts)
            return dt.isoformat()
    except (ValueError, AttributeError, OSError):
        pass
    return None


def is_tech_job(job: dict) -> bool:
    """Check if job is tech-related based on title and tags."""
    title = job.get("title", "").lower()
    tags = job.get("tags", [])

    # Check title for tech keywords
    for keyword in TECH_TAGS:
        if keyword in title:
            return True

    # Check tags
    if isinstance(tags, list):
        for tag in tags:
            if isinstance(tag, str) and tag.lower() in TECH_TAGS:
                return True

    return False


def _fetch_arbeitnow_page(url: str) -> Optional[dict]:
    """Fetch a single page from Arbeitnow API with production infrastructure.

    Uses scraper_infra.py:
    - wait_for_rate_limit() before each request
    - get_stealth_headers() for anti-detection
    - cached_request() for response caching
    - get_proxy_for_url() for EU geo-targeting

    Args:
        url: Full URL with page parameter

    Returns:
        Parsed JSON response as dict, or None on error
    """
    # Apply rate limiting before request
    wait_for_rate_limit(ARBEITNOW_DOMAIN)

    def fetch_fn(u: str) -> Optional[str]:
        """Fetch function for cached_request."""
        headers = get_stealth_headers(url)
        headers["Accept"] = "application/json"

        # Get EU proxy if available
        proxies = get_proxy_for_url(url)

        response = requests.get(
            u,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            proxies=proxies
        )
        response.raise_for_status()
        return response.text

    try:
        response_text = cached_request(url, fetch_fn, ttl=ARBEITNOW_CACHE_TTL)
        if not response_text:
            return None

        return json.loads(response_text)

    except requests.RequestException as e:
        print(f"Error fetching Arbeitnow: {e}")
        return None
    except (ValueError, json.JSONDecodeError) as e:
        print(f"Error parsing Arbeitnow JSON: {e}")
        return None


def fetch_arbeitnow(
    remote_only: bool = True,
    tech_only: bool = True,
    page: int = 1,
    max_pages: int = 5
) -> list[dict]:
    """Fetch jobs from Arbeitnow API with production infrastructure.

    Arbeitnow focuses on EU/UK jobs, making it good for international coverage.

    Uses production infrastructure from scraper_infra.py:
    - wait_for_rate_limit() for smart rate limiting before API calls
    - get_stealth_headers() for anti-detection headers
    - cached_request() for response caching (1 hour TTL)
    - get_proxy_for_url() for EU geo-targeting

    Args:
        remote_only: Only return remote jobs (default True)
        tech_only: Only return tech-related jobs (default True)
        page: Starting page number (default 1)
        max_pages: Maximum pages to fetch (default 5)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted,
        source, external_id, remote, tags
    """
    all_jobs = []

    for current_page in range(page, page + max_pages):
        url = f"https://www.arbeitnow.com/api/job-board-api?page={current_page}"

        data = _fetch_arbeitnow_page(url)
        if not data:
            break

        jobs_data = data.get("data", [])
        if not jobs_data:
            # No more jobs, stop paginating
            break

        for job in jobs_data:
            # Filter remote jobs if requested
            is_remote = job.get("remote", False)
            if remote_only and not is_remote:
                continue

            # Filter tech jobs if requested
            if tech_only and not is_tech_job(job):
                continue

            # Extract tags as list
            tags = job.get("tags", [])
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(",") if t.strip()]

            # Build location string
            location = job.get("location", "")
            if is_remote:
                location = f"{location} (Remote)" if location else "Remote"

            all_jobs.append({
                "company": job.get("company_name", ""),
                "title": job.get("title", ""),
                "location": location,
                "url": job.get("url", ""),
                "posted": parse_timestamp(job.get("created_at")),
                "source": "arbeitnow",
                "external_id": str(job.get("slug", "")),
                "remote": is_remote,
                "tags": tags,
            })

    print(f"Arbeitnow: fetched {len(all_jobs)} jobs")
    return all_jobs
