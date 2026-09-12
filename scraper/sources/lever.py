"""Lever ATS API adapter.

Free API, no auth required.
Rate limit: 2 requests/second
API docs: https://github.com/lever/postings-api

Upgraded with production scraping infrastructure:
- Anti-detection (stealth headers, timing jitter)
- Smart rate limiting (adaptive, domain-specific)
- Response caching (6hr TTL)
- Retry with exponential backoff
- Monitoring and metrics

Uses unified infrastructure from scraper_infra.py when available.
"""

import re
import requests
from datetime import datetime, timezone
from html import unescape
from typing import Optional, Tuple, Dict, Any
import logging

from config import REQUEST_TIMEOUT, LEVER_RATE_LIMIT_DELAY

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
    from scraper.utils.rate_limiter import AdaptiveRateLimiter, DomainThrottler, get_throttler
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
        from utils.rate_limiter import AdaptiveRateLimiter, DomainThrottler, get_throttler
        INFRA_AVAILABLE = True
    except ImportError:
        pass

# Alias used throughout this module (kept in sync with INFRA_AVAILABLE)
HAS_INFRASTRUCTURE = INFRA_AVAILABLE


def wait_for_rate_limit(domain: str = "") -> None:
    """Best-effort per-request pacing fallback (stealth session handles the
    real throttling when infrastructure is available)."""
    import time
    time.sleep(0.4)


def get_stealth_headers(url: str = "") -> dict:
    """Return browser-like request headers (fallback used by _get_headers)."""
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
    }


logger = logging.getLogger(__name__)

# Initialize infrastructure components
_stealth_session = None
_cache = None
_retry_manager = None
_metrics = None
_ua_rotator = None
_timing = None
_throttler = None


def _init_infrastructure():
    """Lazy initialization of legacy infrastructure components."""
    global _stealth_session, _cache, _retry_manager, _metrics, _ua_rotator, _timing, _throttler

    # Only initialize legacy components if unified infra is not available
    if not HAS_INFRASTRUCTURE:
        return

    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=0.5,
            max_delay=1.5,
            requests_per_minute=120  # Lever allows 2 req/s
        )

    if _cache is None:
        _cache = get_cache()

    if _retry_manager is None:
        _retry_manager = RetryManager(RetryConfig(
            max_retries=3,
            base_delay=1.0,
            max_delay=30.0,
        ))

    if _ua_rotator is None:
        _ua_rotator = UserAgentRotator()

    if _timing is None:
        # Lever has 2 req/s limit, so min delay of 0.5s
        _timing = TimingJitter(min_delay=0.5, max_delay=1.5)

    if _throttler is None:
        try:
            _throttler = get_throttler()
        except Exception:
            pass

    if _metrics is None:
        _metrics = MetricsCollector()


def _get_headers() -> Dict[str, str]:
    """Get stealth headers for requests."""
    # Prefer unified infrastructure
    if INFRA_AVAILABLE:
        headers = get_stealth_headers("https://api.lever.co")
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


def _rate_limit_wait():
    """Wait according to rate limiting strategy."""
    _init_infrastructure()

    # Prefer unified infrastructure
    if INFRA_AVAILABLE:
        wait_for_rate_limit("api.lever.co")
    elif HAS_INFRASTRUCTURE and _stealth_session:
        _stealth_session.before_request()
    elif HAS_INFRASTRUCTURE and _throttler:
        # Use adaptive throttler for lever.co domain
        _throttler.acquire_sync('https://api.lever.co')
    elif HAS_INFRASTRUCTURE and _timing:
        _timing.wait()
    else:
        # Fallback to config-based delay
        import time
        time.sleep(LEVER_RATE_LIMIT_DELAY)


def _make_request(url: str, cache_key: Optional[str] = None) -> Optional[Any]:
    """Make a request with caching, retry, rate limiting, and anti-detection."""
    _init_infrastructure()

    # Check cache first (legacy infrastructure)
    if HAS_INFRASTRUCTURE and _cache and cache_key:
        cached = _cache.get(url)
        if cached:
            logger.debug(f"Cache hit for {cache_key}")
            return cached.content if hasattr(cached, 'content') else cached

    # Respect rate limits
    _rate_limit_wait()

    headers = _get_headers()

    def do_request():
        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.json()

    # Execute with retry (legacy infrastructure)
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


def parse_timestamp_ms(ts: Optional[int]) -> Optional[str]:
    """Convert Unix timestamp (milliseconds) to ISO format."""
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
    except (ValueError, OSError):
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

    single_patterns = [r'\$(\d{3}),?(\d{3})', r'\$(\d{2,3})k']
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


def fetch_lever(company_slug: str) -> list[dict]:
    """Fetch jobs from a Lever board.

    Args:
        company_slug: The Lever company slug (e.g., "netflix", "replit")

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id, salary_min, salary_max
    """
    _init_infrastructure()

    # Use monitoring context manager if available
    if INFRA_AVAILABLE:
        with monitor_scraper(f'lever_{company_slug}') as ctx:
            return _fetch_lever_impl(company_slug, ctx)
    else:
        return _fetch_lever_impl(company_slug, None)


def _fetch_lever_impl(company_slug: str, ctx) -> list[dict]:
    """Internal implementation of fetch_lever."""
    url = f"https://api.lever.co/v0/postings/{company_slug}"
    cache_key = f"lever_{company_slug}"

    # Record request if monitoring context available
    if ctx:
        ctx.record_request(success=True)

    data = _make_request(url, cache_key)

    if data is None:
        if ctx:
            ctx.record_request(success=False)
        return []

    # Lever returns array directly, not wrapped in object
    if not isinstance(data, list):
        logger.warning(f"Unexpected Lever response format for {company_slug}")
        return []

    jobs = []
    for job in data:
        categories = job.get("categories", {})
        location = categories.get("location", "") if isinstance(categories, dict) else ""

        job_url = job.get("hostedUrl", "")
        apply_url = job.get("applyUrl", "") or (f"{job_url.rstrip('/')}/apply" if job_url else "")

        salary_min, salary_max = None, None
        description = job.get("descriptionPlain", "") or job.get("description", "")
        if description:
            text = strip_html(description) if "<" in description else description
            salary_min, salary_max = parse_salary_from_text(text)

        if not salary_min:
            lists = job.get("lists", [])
            for lst in lists:
                content = lst.get("content", "")
                if content:
                    text = strip_html(content) if "<" in content else content
                    salary_min, salary_max = parse_salary_from_text(text)
                    if salary_min:
                        break

        jobs.append({
            "company": company_slug,
            "title": job.get("text", ""),
            "location": location,
            "url": job_url,
            "apply_url": apply_url,
            "posted": parse_timestamp_ms(job.get("createdAt")),
            "source": "lever",
            "external_id": job.get("id", ""),
            "salary_min": salary_min,
            "salary_max": salary_max,
        })

    # Record jobs found via monitoring
    if ctx:
        ctx.record_questions(extracted=len(jobs), new=len(jobs))

    logger.info(f"Fetched {len(jobs)} jobs from Lever board '{company_slug}'")
    return jobs
