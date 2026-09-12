"""SimplifyJobs GitHub source adapter.

Fetches jobs from the SimplifyJobs New-Grad-Positions repo.
This is the best curated source with ~20k new grad positions, updated daily.

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

from config import SIMPLIFY_URL, REQUEST_TIMEOUT

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
            min_delay=0.1,
            max_delay=0.5,
            requests_per_minute=60  # GitHub raw is generous
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
            base_delay=0.2,
            min_delay=0.1,
            max_delay=5.0,
            error_penalty_multiplier=2.0,
        )
    return _rate_limiter


def parse_timestamp(ts: Optional[int]) -> Optional[str]:
    """Convert Unix timestamp (seconds) to ISO format."""
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except (ValueError, OSError):
        return None


def fetch_simplify(use_cache: bool = True) -> list[dict]:
    """Fetch all jobs from SimplifyJobs GitHub repo.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - ResponseCache for response caching (30 min TTL)
    - AdaptiveRateLimiter for smart rate limiting
    - monitor_scraper for metrics tracking

    Args:
        use_cache: Whether to use response caching (default True)

    Returns:
        List of raw job dicts with keys: company, title, locations, url, posted, source
    """
    if INFRA_AVAILABLE:
        with monitor_scraper('simplify') as ctx:
            return _fetch_simplify_impl(use_cache, ctx)
    else:
        return _fetch_simplify_impl(use_cache, None)


def _fetch_simplify_impl(use_cache: bool, ctx) -> list[dict]:
    """Implementation with optional monitoring context."""
    import json

    session = _get_stealth_session()
    cache = _get_cache() if use_cache else None
    rate_limiter = _get_rate_limiter()

    cache_key = "simplify_jobs"
    SIMPLIFY_CACHE_TTL = 1800  # 30 minutes - updates frequently

    # Check cache first
    if cache:
        cached = cache.get(cache_key)
        if cached:
            logger.debug("Cache hit for SimplifyJobs")
            try:
                content = cached.content if hasattr(cached, 'content') else cached
                if isinstance(content, bytes):
                    content = content.decode('utf-8')
                data = json.loads(content)
            except (json.JSONDecodeError, AttributeError):
                data = None

            if data:
                jobs = []
                for item in data:
                    if not item.get("active", True):
                        continue
                    locations = item.get("locations", [])
                    if isinstance(locations, str):
                        locations = [locations]
                    jobs.append({
                        "company": item.get("company_name", ""),
                        "title": item.get("title", ""),
                        "locations": locations,
                        "url": item.get("url", ""),
                        "posted": parse_timestamp(item.get("date_posted")),
                        "source": "simplify",
                    })
                return jobs

    # Apply rate limiting with stealth session
    if session:
        if not session.before_request():
            time.sleep(0.1)
    elif rate_limiter:
        rate_limiter.wait_sync()

    # Build headers
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "NewGradRadar/1.0",
    }
    timeout = REQUEST_TIMEOUT

    if session:
        config = session.get_request_config(SIMPLIFY_URL)
        request_headers = config.get('headers', request_headers)
        request_headers["Accept"] = "application/json"
        timeout = config.get('timeout', REQUEST_TIMEOUT)

    start_time = time.time()
    try:
        response = requests.get(SIMPLIFY_URL, headers=request_headers, timeout=timeout)
        response_time = time.time() - start_time

        # Record in stealth session
        if session:
            session.after_request(response.status_code)

        response.raise_for_status()
        data = response.json()

        # Record success
        if rate_limiter:
            rate_limiter.record_success(response_time)
        if ctx:
            ctx.record_request(success=True, bytes_downloaded=len(response.content))

        # Cache the raw response
        if cache:
            cache.set(cache_key, {'content': json.dumps(data).encode(), 'status_code': 200, 'headers': {}}, ttl=SIMPLIFY_CACHE_TTL)
            logger.debug("Cached SimplifyJobs response")

    except requests.RequestException as e:
        logger.error(f"Error fetching SimplifyJobs: {e}")
        if session:
            session.after_request(500)
        if rate_limiter:
            rate_limiter.record_failure(is_rate_limit='429' in str(e))
        if ctx:
            ctx.record_request(success=False)
        return []
    except ValueError as e:
        logger.error(f"Error parsing SimplifyJobs JSON: {e}")
        return []

    jobs = []
    for item in data:
        # Skip inactive listings
        if not item.get("active", True):
            continue

        # Extract locations - can be a list or single value
        locations = item.get("locations", [])
        if isinstance(locations, str):
            locations = [locations]

        jobs.append({
            "company": item.get("company_name", ""),
            "title": item.get("title", ""),
            "locations": locations,
            "url": item.get("url", ""),
            "posted": parse_timestamp(item.get("date_posted")),
            "source": "simplify",
        })

    # Record metrics
    if ctx:
        ctx.record_questions(extracted=len(jobs), new=len(jobs), duplicate=0)

    logger.info(f"SimplifyJobs: fetched {len(jobs)} jobs")
    return jobs
