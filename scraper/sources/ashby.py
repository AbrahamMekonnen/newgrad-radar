"""Ashby ATS API adapter.

Free API, no auth required.
Similar to Greenhouse/Lever.

Upgraded to use production infrastructure:
- StealthSession for anti-detection
- ResponseCache for caching
- RetryManager for automatic retries
- Unified scraper_infra module for stealth headers, rate limiting, and caching
"""

from datetime import datetime
from typing import Optional, List, Dict, Any

try:
    import requests
except ImportError:
    requests = None

from config import REQUEST_TIMEOUT

# Infrastructure availability flag
INFRA_AVAILABLE = False

# Import production infrastructure utilities
try:
    from scraper.utils.anti_detection import StealthSession, create_stealth_session, UserAgentRotator
    from scraper.utils.cache import ResponseCache, get_cache
    from scraper.utils.error_handler import RetryManager, RetryConfig
    from scraper.utils.monitoring import MetricsCollector, monitor_scraper
    from scraper.utils.rate_limiter import get_throttler
    INFRA_AVAILABLE = True
except ImportError:
    try:
        # Fallback to relative imports when running from scraper directory
        from utils.anti_detection import StealthSession, create_stealth_session, UserAgentRotator
        from utils.cache import ResponseCache, get_cache
        from utils.error_handler import RetryManager, RetryConfig
        from utils.monitoring import MetricsCollector, monitor_scraper
        from utils.rate_limiter import get_throttler
        INFRA_AVAILABLE = True
    except ImportError:
        pass


class AshbyScraper:
    """Enhanced Ashby scraper with stealth and caching.

    Uses production infrastructure when available for anti-detection,
    caching, retry logic, and monitoring.
    """

    def __init__(self, use_stealth: bool = True, use_cache: bool = True):
        self.use_stealth = use_stealth and INFRA_AVAILABLE
        self.use_cache = use_cache and INFRA_AVAILABLE

        if self.use_stealth:
            self.stealth = create_stealth_session(
                min_delay=0.5,
                max_delay=2.0,
                requests_per_minute=30  # Ashby is more lenient
            )
        else:
            self.stealth = None

        if self.use_cache:
            self.cache = get_cache()
        else:
            self.cache = None

        if INFRA_AVAILABLE:
            self.retry = RetryManager(RetryConfig(max_retries=3, base_delay=1.0))
        else:
            self.retry = None

    def _get_headers(self) -> Dict[str, str]:
        """Get request headers with stealth user agent."""
        if self.stealth:
            config = self.stealth.get_request_config("https://api.ashbyhq.com")
            headers = config.get('headers', {})
            headers["Accept"] = "application/json"
            return headers

        # Basic fallback headers
        return {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }

    def _apply_rate_limit(self) -> None:
        """Apply rate limiting via stealth session."""
        if self.stealth:
            self.stealth.before_request()

    def _parse_iso(self, ts: Optional[str]) -> Optional[str]:
        """Parse ISO timestamp and return ISO format."""
        if not ts:
            return None
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.isoformat()
        except (ValueError, AttributeError):
            return None

    def fetch(self, board_token: str, company_slug: str = None) -> List[Dict[str, Any]]:
        """Fetch jobs from an Ashby board with infrastructure support."""
        # Use monitoring context manager if available
        if INFRA_AVAILABLE:
            with monitor_scraper(f'ashby_{board_token}') as ctx:
                return self._fetch_impl(board_token, company_slug, ctx)
        else:
            return self._fetch_impl(board_token, company_slug, None)

    def _fetch_impl(self, board_token: str, company_slug: str, ctx) -> List[Dict[str, Any]]:
        """Internal implementation of fetch."""
        if not requests:
            print("requests module not available")
            return []

        url = f"https://api.ashbyhq.com/posting-api/job-board/{board_token}"

        # Check cache
        cache_key = f"ashby:{board_token}"
        if self.cache:
            cached = self.cache.get(url)
            if cached:
                return cached.content if hasattr(cached, 'content') else cached

        # Record request if monitoring context available
        if ctx:
            ctx.record_request(success=True)

        headers = self._get_headers()
        self._apply_rate_limit()

        def _do_request():
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            return response.json()

        try:
            if self.retry:
                data = self.retry.execute(_do_request)
            else:
                data = _do_request()

            if self.stealth:
                self.stealth.after_request(200)

        except requests.RequestException as e:
            print(f"Error fetching Ashby {board_token}: {e}")
            if self.stealth:
                self.stealth.after_request(getattr(e.response, 'status_code', 500) if hasattr(e, 'response') else 500)
            if ctx:
                ctx.record_request(success=False)
            return []
        except Exception as e:
            print(f"Error parsing Ashby {board_token} JSON: {e}")
            if ctx:
                ctx.record_request(success=False)
            return []

        jobs = []
        for job in data.get("jobs", []):
            location = job.get("location", "")
            if isinstance(location, dict):
                location = location.get("name", "")

            job_url = job.get("jobUrl", "")
            apply_url = job.get("applyUrl", "") or job_url

            jobs.append({
                "company": company_slug or board_token,
                "title": job.get("title", ""),
                "location": location,
                "url": job_url,
                "apply_url": apply_url,
                "posted": self._parse_iso(job.get("publishedAt")),
                "source": "ashby",
                "external_id": job.get("id", ""),
            })

        # Cache results
        if self.cache and jobs:
            self.cache.set(url, {'content': jobs, 'status_code': 200, 'headers': {}})

        # Record jobs found via monitoring
        if ctx:
            ctx.record_questions(extracted=len(jobs), new=len(jobs))

        return jobs


# Global scraper instance
_scraper: Optional[AshbyScraper] = None


def get_scraper() -> AshbyScraper:
    """Get or create global scraper instance."""
    global _scraper
    if _scraper is None:
        _scraper = AshbyScraper()
    return _scraper


# ============================================================================
# Legacy API (backward compatible)
# ============================================================================

def parse_iso(ts: Optional[str]) -> Optional[str]:
    """Parse ISO timestamp and return ISO format."""
    return AshbyScraper()._parse_iso(ts)


def fetch_ashby(board_token: str, company_slug: str = None) -> List[Dict]:
    """Fetch jobs from an Ashby board (legacy API).

    Args:
        board_token: The Ashby board token (e.g., "elevenlabs", "langchain")
        company_slug: Optional company slug for the result (defaults to board_token)

    Returns:
        List of raw job dicts with keys: company, title, location, url, posted, source, external_id
    """
    return get_scraper().fetch(board_token, company_slug)
