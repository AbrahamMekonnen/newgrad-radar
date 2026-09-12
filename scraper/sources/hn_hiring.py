"""Hacker News Who's Hiring thread parser.

Fetches job postings from monthly "Ask HN: Who is hiring?" threads.
Uses the Algolia Search API (no auth required).

API docs: https://hn.algolia.com/api

UPGRADED: Uses production infrastructure for:
- Stealth headers (anti-detection)
- Rate limiting (adaptive throttling)
- Response caching (TTL-based HTTP cache)
- Monitoring (metrics and health tracking)
"""

import re
import logging
import time
from datetime import datetime, timedelta
from typing import Optional
from html import unescape

try:
    import requests
except ImportError:
    requests = None

# Infrastructure availability flag
INFRA_AVAILABLE = False
try:
    from scraper.utils.anti_detection import StealthSession, create_stealth_session
    from scraper.utils.cache import ResponseCache, get_cache, cached_request
    from scraper.utils.rate_limiter import AdaptiveRateLimiter, get_throttler
    from scraper.utils.monitoring import monitor_scraper
    INFRA_AVAILABLE = True
except ImportError:
    pass

try:
    from config import REQUEST_TIMEOUT
except ImportError:
    REQUEST_TIMEOUT = 30

logger = logging.getLogger(__name__)

# Algolia HN API endpoints
ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date"
ALGOLIA_ITEM_URL = "https://hn.algolia.com/api/v1/items"

# Cache settings - HN threads don't change often
HN_CACHE_TTL = 3600 * 2  # 2 hours for thread list
HN_COMMENT_CACHE_TTL = 3600 * 6  # 6 hours for comments (static after posting)

# Domain for rate limiting
HN_DOMAIN = "hn.algolia.com"


# Regex patterns for parsing job posts
COMPANY_PATTERN = re.compile(
    r"^([A-Za-z0-9][A-Za-z0-9\s\.\-&]+?)(?:\s*[\|\-\(\[]|<p>|\s+https?://)",
    re.IGNORECASE
)

URL_PATTERN = re.compile(
    r"https?://[^\s<>\"\')]+",
    re.IGNORECASE
)

LOCATION_PATTERNS = [
    re.compile(r"\b((?:fully\s+)?remote(?:\s+(?:only|friendly|ok|US|EU|worldwide|anywhere))?)\b", re.IGNORECASE),
    re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2,})\b"),
    re.compile(r"\b(San Francisco|SF|NYC|New York|Seattle|Austin|Boston|LA|Los Angeles|Chicago|Denver|London|Berlin|Toronto|Vancouver)\b", re.IGNORECASE),
]

ROLE_PATTERNS = [
    re.compile(r"\b(software\s+engineer(?:ing)?)\b", re.IGNORECASE),
    re.compile(r"\b(swe|sde)\b", re.IGNORECASE),
    re.compile(r"\b(frontend|front[\-\s]?end)\s*(?:engineer|developer)?\b", re.IGNORECASE),
    re.compile(r"\b(backend|back[\-\s]?end)\s*(?:engineer|developer)?\b", re.IGNORECASE),
    re.compile(r"\b(full[\-\s]?stack)\s*(?:engineer|developer)?\b", re.IGNORECASE),
    re.compile(r"\b(ml|machine\s+learning)\s*engineer\b", re.IGNORECASE),
    re.compile(r"\b(data\s+engineer)\b", re.IGNORECASE),
    re.compile(r"\b(platform\s+engineer)\b", re.IGNORECASE),
    re.compile(r"\b(infrastructure\s+engineer)\b", re.IGNORECASE),
    re.compile(r"\b(devops\s+engineer)\b", re.IGNORECASE),
]

REMOTE_PATTERNS = [
    re.compile(r"\bremote\b", re.IGNORECASE),
    re.compile(r"\bwfh\b", re.IGNORECASE),
    re.compile(r"\bwork\s+from\s+home\b", re.IGNORECASE),
    re.compile(r"\bdistributed\b", re.IGNORECASE),
]


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<p>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return text.strip()


def extract_company(text: str) -> str:
    """Extract company name from job post."""
    first_line = text.split("\n")[0].strip()

    match = COMPANY_PATTERN.match(first_line)
    if match:
        company = match.group(1).strip()
        company = re.sub(r"[\s\-\|,]+$", "", company)
        if len(company) > 2 and len(company) < 100:
            return company

    for sep in ["|", " - ", " -- ", "(", "["]:
        if sep in first_line:
            company = first_line.split(sep)[0].strip()
            if len(company) > 2 and len(company) < 100:
                return company

    words = first_line.split()[:5]
    return " ".join(words) if words else "Unknown"


def extract_url(text: str) -> Optional[str]:
    """Extract the most relevant URL from job post."""
    urls = URL_PATTERN.findall(text)
    if not urls:
        return None

    for url in urls:
        lower = url.lower()
        if any(kw in lower for kw in ["jobs", "careers", "apply", "greenhouse", "lever", "ashby", "workday"]):
            return url.rstrip(".,;:)")

    return urls[0].rstrip(".,;:)")


def extract_location(text: str) -> str:
    """Extract location from job post."""
    locations = []

    for pattern in LOCATION_PATTERNS:
        matches = pattern.findall(text)
        for match in matches:
            loc = match.strip()
            if loc and loc.lower() not in [l.lower() for l in locations]:
                locations.append(loc)

    if locations:
        return ", ".join(locations[:3])

    return ""


def extract_role(text: str) -> Optional[str]:
    """Extract role title from job post."""
    for pattern in ROLE_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1).strip()
    return None


def is_remote(text: str) -> bool:
    """Check if job offers remote work."""
    for pattern in REMOTE_PATTERNS:
        if pattern.search(text):
            return True
    return False


def is_likely_job_post(text: str) -> bool:
    """Filter out non-job comments (replies, meta discussion)."""
    if len(text) < 100:
        return False

    hiring_keywords = [
        "hiring", "engineer", "developer", "looking for", "join us",
        "apply", "position", "role", "team", "stack", "salary", "compensation"
    ]

    text_lower = text.lower()
    return any(kw in text_lower for kw in hiring_keywords)


# Session singleton for stealth requests
_stealth_session: Optional['StealthSession'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_cache: Optional['ResponseCache'] = None


def _get_stealth_session() -> Optional['StealthSession']:
    """Get or create a stealth session."""
    global _stealth_session
    if _stealth_session is None and INFRA_AVAILABLE:
        _stealth_session = create_stealth_session(
            session_id='hn_hiring',
            min_delay=0.1,  # Algolia is fast
            max_delay=2.0,
            requests_per_minute=60  # Generous rate for Algolia
        )
    return _stealth_session


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or create rate limiter."""
    global _rate_limiter
    if _rate_limiter is None and INFRA_AVAILABLE:
        _rate_limiter = AdaptiveRateLimiter(
            base_delay=0.1,
            min_delay=0.05,
            max_delay=5.0,
            target_response_time=0.5
        )
    return _rate_limiter


def _get_response_cache() -> Optional['ResponseCache']:
    """Get or create response cache."""
    global _cache
    if _cache is None and INFRA_AVAILABLE:
        _cache = get_cache()
    return _cache


def _make_request(url: str, params: dict = None, timeout: int = None) -> Optional[dict]:
    """Make HTTP request with caching, rate limiting, and stealth headers.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - AdaptiveRateLimiter for throttling
    - ResponseCache for caching

    Falls back to basic requests if infrastructure unavailable.
    """
    if requests is None:
        logger.error("requests module not available")
        return None

    timeout = timeout or REQUEST_TIMEOUT
    cache = _get_response_cache()
    rate_limiter = _get_rate_limiter()
    session = _get_stealth_session()

    # Build full URL with params for cache key
    full_url = url
    if params:
        from urllib.parse import urlencode
        full_url = f"{url}?{urlencode(params)}"

    # Check cache first
    if cache:
        cached = cache.get(full_url)
        if cached:
            logger.debug(f"Cache hit for {url}")
            try:
                import json
                return json.loads(cached.content.decode('utf-8'))
            except (ValueError, json.JSONDecodeError):
                pass

    # Apply rate limiting
    if rate_limiter:
        rate_limiter.wait_sync()
    elif INFRA_AVAILABLE:
        # Fallback to basic delay
        time.sleep(0.1)
    else:
        # No infrastructure, use basic delay
        time.sleep(0.5)

    # Get headers
    if session:
        headers = session.header_randomizer.get_api_headers()
    else:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        }

    # Make request
    start_time = time.time()
    try:
        response = requests.get(url, params=params, headers=headers, timeout=timeout)
        response.raise_for_status()
        response_time = time.time() - start_time

        # Record success with rate limiter
        if rate_limiter:
            rate_limiter.record_success(response_time)

        # Cache the response
        if cache:
            cache.set(full_url, response, ttl=HN_CACHE_TTL)

        return response.json()

    except requests.RequestException as e:
        logger.error(f"Error fetching {url}: {e}")
        if rate_limiter:
            is_rate_limit = '429' in str(e) or 'rate' in str(e).lower()
            rate_limiter.record_failure(is_rate_limit)
        return None
    except ValueError as e:
        logger.error(f"Error parsing JSON from {url}: {e}")
        return None


def fetch_who_is_hiring_threads(months: int = 3) -> list[dict]:
    """Find recent Who is hiring threads with caching."""
    params = {
        "query": "Ask HN: Who is hiring",
        "tags": "story,author_whoishiring",
        "hitsPerPage": months + 2,
    }

    data = _make_request(ALGOLIA_SEARCH_URL, params=params)
    if not data:
        return []

    threads = []
    for hit in data.get("hits", []):
        title = hit.get("title", "")
        if "who is hiring" in title.lower() and "wants to be hired" not in title.lower():
            threads.append({
                "id": hit.get("objectID"),
                "title": title,
                "created_at": hit.get("created_at"),
            })

    return threads[:months]


def fetch_thread_comments(thread_id: str) -> list[dict]:
    """Fetch all top-level comments from a thread with caching."""
    url = f"{ALGOLIA_ITEM_URL}/{thread_id}"

    data = _make_request(url, timeout=REQUEST_TIMEOUT * 2)
    if not data:
        return []

    return data.get("children", [])


def parse_job_comment(comment: dict, thread_date: str) -> Optional[dict]:
    """Parse a single comment into a job posting."""
    text = comment.get("text", "")
    if not text:
        return None

    clean_text = clean_html(text)

    if not is_likely_job_post(clean_text):
        return None

    company = extract_company(clean_text)
    if company == "Unknown" or len(company) < 2:
        return None

    url = extract_url(clean_text)
    location = extract_location(clean_text)
    role = extract_role(clean_text)
    remote = is_remote(clean_text)

    if role:
        title = f"{role} at {company}"
    else:
        title = f"Engineering at {company}"

    if remote and "remote" not in location.lower():
        location = f"Remote, {location}" if location else "Remote"

    return {
        "company": company,
        "title": title,
        "location": location,
        "url": url or f"https://news.ycombinator.com/item?id={comment.get('id', '')}",
        "posted": thread_date,
        "source": "hn_hiring",
        "external_id": str(comment.get("id", "")),
        "remote": remote,
    }


def fetch_hn_hiring(months: int = 3) -> list[dict]:
    """Fetch jobs from recent Who is hiring threads.

    Uses production infrastructure for caching/rate limiting.
    Optionally uses monitoring context if available.
    """
    # Use monitoring context if available
    if INFRA_AVAILABLE:
        with monitor_scraper('hn_hiring') as ctx:
            return _fetch_hn_hiring_impl(months, ctx)
    else:
        return _fetch_hn_hiring_impl(months, None)


def _fetch_hn_hiring_impl(months: int, ctx) -> list[dict]:
    """Implementation with optional monitoring context."""
    threads = fetch_who_is_hiring_threads(months)
    if not threads:
        logger.warning("No Who is hiring threads found")
        return []

    logger.info(f"Found {len(threads)} Who is hiring threads")

    all_jobs = []
    total_comments = 0

    for thread in threads:
        thread_id = thread["id"]
        thread_date = thread.get("created_at", "")

        logger.info(f"Parsing thread: {thread['title']}")

        comments = fetch_thread_comments(thread_id)
        total_comments += len(comments)
        logger.info(f"  Found {len(comments)} top-level comments")

        if ctx:
            ctx.record_request(success=True, bytes_downloaded=len(str(comments)))

        thread_jobs = 0
        for comment in comments:
            job = parse_job_comment(comment, thread_date)
            if job:
                all_jobs.append(job)
                thread_jobs += 1

        logger.info(f"  Extracted {thread_jobs} jobs")

    # Record metrics
    if ctx:
        ctx.record_questions(
            extracted=len(all_jobs),
            new=len(all_jobs),
            duplicate=0
        )

    logger.info(f"Total jobs from HN: {len(all_jobs)}")
    return all_jobs


def fetch_hackernews_hiring(months: int = 3) -> list[dict]:
    """Alias for fetch_hn_hiring for consistent naming."""
    return fetch_hn_hiring(months)


# Export for CLI
if __name__ == "__main__":
    import json
    jobs = fetch_hn_hiring(months=2)
    print(json.dumps(jobs[:5], indent=2))
    print(f"\nTotal: {len(jobs)} jobs")
