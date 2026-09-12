"""Greenhouse ATS API adapter.

Free API, no auth required. Returns all jobs for a company board.
API docs: https://developers.greenhouse.io/job-board.html

Upgraded with production scraping infrastructure:
- Anti-detection (stealth headers, timing jitter)
- Response caching (6hr TTL)
- Retry with exponential backoff
- Monitoring and metrics

Uses unified infrastructure from scraper_infra.py when available.
"""

import re
import requests
from datetime import datetime
from typing import Optional, Tuple, Dict, Any
from html import unescape
import logging

from config import REQUEST_TIMEOUT

# Infrastructure availability flag
INFRA_AVAILABLE = False

# Import production infrastructure utilities
try:
    from scraper.utils.anti_detection import (
        StealthSession,
        create_stealth_session,
        UserAgentRotator,
        TimingJitter,
    )
    from scraper.utils.cache import ResponseCache, get_cache
    from scraper.utils.error_handler import RetryManager, RetryConfig, with_retry
    from scraper.utils.monitoring import MetricsCollector, monitor_scraper
    from scraper.utils.rate_limiter import AdaptiveRateLimiter, get_throttler
    INFRA_AVAILABLE = True
except ImportError:
    try:
        # Fallback to relative imports when running from scraper directory
        from utils.anti_detection import (
            StealthSession,
            create_stealth_session,
            UserAgentRotator,
            TimingJitter,
        )
        from utils.cache import ResponseCache, get_cache
        from utils.error_handler import RetryManager, RetryConfig, with_retry
        from utils.monitoring import MetricsCollector, monitor_scraper
        from utils.rate_limiter import AdaptiveRateLimiter, get_throttler
        INFRA_AVAILABLE = True
    except ImportError:
        pass

logger = logging.getLogger(__name__)

# Initialize infrastructure components
_stealth_session = None
_cache = None
_retry_manager = None
_metrics = None
_ua_rotator = None
_timing = None


def _init_infrastructure():
    """Lazy initialization of legacy infrastructure components."""
    global _stealth_session, _cache, _retry_manager, _metrics, _ua_rotator, _timing

    # Only initialize legacy components if INFRA_AVAILABLE is False
    # (unified infrastructure handles everything when available)
    if not HAS_INFRASTRUCTURE:
        return

    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=0.5,
            max_delay=2.0,
            requests_per_minute=30
        )

    if _cache is None:
        _cache = get_cache()

    if _retry_manager is None:
        try:
            from scraper.utils.error_handler import RetryConfig
        except ImportError:
            from utils.error_handler import RetryConfig
        _retry_manager = RetryManager(RetryConfig(
            max_retries=3,
            base_delay=1.0,
            max_delay=30.0,
        ))

    if _ua_rotator is None:
        _ua_rotator = UserAgentRotator()

    if _timing is None:
        _timing = TimingJitter(min_delay=0.5, max_delay=2.0)

    if _metrics is None:
        _metrics = MetricsCollector()


def _get_headers() -> Dict[str, str]:
    """Get stealth headers for requests."""
    # Prefer unified infrastructure
    if INFRA_AVAILABLE:
        headers = get_stealth_headers("https://boards-api.greenhouse.io")
        headers['Accept'] = 'application/json'
        return headers
    # Fallback to legacy infrastructure
    if HAS_INFRASTRUCTURE and _ua_rotator:
        return {
            'User-Agent': _ua_rotator.get(),
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
        }
    return {'Accept': 'application/json'}


def _make_request(url: str, cache_key: Optional[str] = None) -> Optional[dict]:
    """Make a request with caching, retry, and anti-detection."""
    _init_infrastructure()

    # Check cache first
    if HAS_INFRASTRUCTURE and _cache and cache_key:
        cached = _cache.get(url)
        if cached:
            logger.debug(f"Cache hit for {cache_key}")
            return cached.content if hasattr(cached, 'content') else cached

    # Rate limiting - prefer unified infrastructure
    if INFRA_AVAILABLE:
        wait_for_rate_limit("boards-api.greenhouse.io")
    elif HAS_INFRASTRUCTURE and _stealth_session:
        # Fallback to legacy stealth session
        _stealth_session.before_request()

    headers = _get_headers()

    def do_request():
        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.json()

    # Execute with retry (use legacy retry manager if available)
    if HAS_INFRASTRUCTURE and _retry_manager:
        try:
            data = _retry_manager.execute(do_request)
        except Exception as e:
            logger.error(f"Request failed after retries: {e}")
            if HAS_INFRASTRUCTURE and _stealth_session:
                _stealth_session.after_request(500)
            return None
    else:
        try:
            data = do_request()
        except Exception as e:
            logger.error(f"Request failed: {e}")
            return None

    # Record success for rate limiter (legacy infrastructure)
    if HAS_INFRASTRUCTURE and _stealth_session:
        _stealth_session.after_request(200)

    # Cache the result (legacy infrastructure)
    if HAS_INFRASTRUCTURE and _cache and cache_key and data:
        _cache.set(url, {'content': data, 'status_code': 200, 'headers': {}})

    return data


def parse_iso(ts: Optional[str]) -> Optional[str]:
    """Parse ISO timestamp and return ISO format."""
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.isoformat()
    except (ValueError, AttributeError):
        return None


def strip_html(html: str) -> str:
    """Remove HTML tags and decode entities."""
    if not html:
        return ""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = unescape(text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def parse_salary_from_text(text: str) -> Tuple[Optional[int], Optional[int]]:
    """Extract salary range from job description text."""
    if not text:
        return None, None

    text_clean = text.lower().replace(',', '')

    patterns = [
        r'\$(\d{2,3}),?(\d{3})?\s*[-–to]+\s*\$?(\d{2,3}),?(\d{3})?',
        r'\$(\d{2,3})k\s*[-–to]+\s*\$?(\d{2,3})k',
        r'(\d{2,3})k\s*[-–to]+\s*(\d{2,3})k',
    ]

    for pattern in patterns:
        match = re.search(pattern, text_clean)
        if match:
            groups = [g for g in match.groups() if g]
            if len(groups) >= 2:
                try:
                    min_val = int(groups[0])
                    max_val = int(groups[-1]) if len(groups) > 1 else min_val

                    if min_val < 1000:
                        min_val *= 1000
                    if max_val < 1000:
                        max_val *= 1000

                    if 40000 <= min_val <= 500000 and 40000 <= max_val <= 500000:
                        return min_val, max_val
                except (ValueError, IndexError):
                    continue

    single_patterns = [
        r'\$(\d{3}),?(\d{3})',
        r'\$(\d{2,3})k',
    ]

    for pattern in single_patterns:
        match = re.search(pattern, text_clean)
        if match:
            try:
                val = int(match.group(1))
                if val < 1000:
                    val *= 1000
                if 40000 <= val <= 500000:
                    return val, val
            except (ValueError, IndexError):
                continue

    return None, None


def fetch_job_details(board_token: str, job_id: str) -> dict:
    """Fetch full job details including description."""
    url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{job_id}"
    cache_key = f"greenhouse_job_{board_token}_{job_id}"

    result = _make_request(url, cache_key)
    return result if result else {}


def fetch_greenhouse(board_token: str, company_slug: str = None, fetch_salary: bool = True) -> list[dict]:
    """Fetch jobs from a Greenhouse board.

    Args:
        board_token: The Greenhouse board token (e.g., "anthropic", "openai")
        company_slug: Optional company slug for the result (defaults to board_token)
        fetch_salary: If True, fetches job details to extract salary (slower but more data)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id, salary_min, salary_max
    """
    _init_infrastructure()

    # Use monitoring context manager if available
    if INFRA_AVAILABLE:
        with monitor_scraper(f'greenhouse_{board_token}') as ctx:
            return _fetch_greenhouse_impl(board_token, company_slug, fetch_salary, ctx)
    else:
        return _fetch_greenhouse_impl(board_token, company_slug, fetch_salary, None)


def _fetch_greenhouse_impl(board_token: str, company_slug: str, fetch_salary: bool, ctx) -> list[dict]:
    """Internal implementation of fetch_greenhouse."""
    url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs"
    cache_key = f"greenhouse_board_{board_token}"

    # Record request if monitoring context available
    if ctx:
        ctx.record_request(success=True)

    data = _make_request(url, cache_key)

    if not data:
        if ctx:
            ctx.record_request(success=False)
        return []

    jobs = []
    for job in data.get("jobs", []):
        location = job.get("location", {})
        if isinstance(location, dict):
            location = location.get("name", "")

        job_url = job.get("absolute_url", "")
        job_id = str(job.get("id", ""))

        apply_url = f"{job_url}#app" if job_url and "#app" not in job_url else job_url

        salary_min, salary_max = None, None

        if fetch_salary and job_id:
            details = fetch_job_details(board_token, job_id)
            content = details.get("content", "")
            if content:
                text = strip_html(content)
                salary_min, salary_max = parse_salary_from_text(text)

        jobs.append({
            "company": company_slug or board_token,
            "title": job.get("title", ""),
            "location": location,
            "url": job_url,
            "apply_url": apply_url,
            "posted": parse_iso(job.get("updated_at")),
            "source": "greenhouse",
            "external_id": job_id,
            "salary_min": salary_min,
            "salary_max": salary_max,
        })

    # Record jobs found via monitoring
    if ctx:
        ctx.record_questions(extracted=len(jobs), new=len(jobs))

    logger.info(f"Fetched {len(jobs)} jobs from Greenhouse board '{board_token}'")
    return jobs
