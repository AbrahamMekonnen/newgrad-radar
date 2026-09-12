"""Deep career page crawler for companies without standard ATS.

Discovers job listings by:
1. Checking common career page paths (/careers, /jobs, etc.)
2. Parsing sitemap.xml for job URLs
3. Finding hidden paths (/campus, /new-grad, /students, /internships)
4. Extracting job listings from discovered pages

Use this for companies with custom career sites (Meta, Google, Apple, Amazon, etc.)

Enhanced with production-grade infrastructure:
- StealthSession for anti-detection
- ProxyRotator for geo-diversity
- URLDeduplicator for efficiency
- CheckpointManager for resume capability
- CircuitBreaker per domain
- Unified scraper_infra module for stealth headers, rate limiting, proxies, and caching
"""

import re
import time
import requests
from urllib.parse import urljoin, urlparse, parse_qs
from datetime import datetime, timezone
from typing import Optional
from html.parser import HTMLParser
from xml.etree import ElementTree

from config import REQUEST_TIMEOUT

# =============================================================================
# Infrastructure Integration
# =============================================================================

INFRA_AVAILABLE = False
HAS_STEALTH = False
HAS_PROXY = False
HAS_DEDUP = False
HAS_ERROR_HANDLER = False
HAS_THROTTLER = False
HAS_CACHE = False
HAS_MONITORING = False

# Try importing infrastructure modules (with multiple fallback paths)
try:
    from scraper.utils.anti_detection import StealthSession, create_stealth_session
    HAS_STEALTH = True
    INFRA_AVAILABLE = True
except ImportError:
    try:
        from utils.anti_detection import StealthSession, create_stealth_session
        HAS_STEALTH = True
        INFRA_AVAILABLE = True
    except ImportError:
        pass

try:
    from scraper.utils.cache import ResponseCache, get_cache
    HAS_CACHE = True
except ImportError:
    try:
        from utils.cache import ResponseCache, get_cache
        HAS_CACHE = True
    except ImportError:
        pass

try:
    from scraper.utils.rate_limiter import DomainThrottler
    HAS_THROTTLER = True
except ImportError:
    try:
        from utils.rate_limiter import DomainThrottler
        HAS_THROTTLER = True
    except ImportError:
        pass

try:
    from scraper.utils.monitoring import monitor_scraper
    HAS_MONITORING = True
except ImportError:
    try:
        from utils.monitoring import monitor_scraper
        HAS_MONITORING = True
    except ImportError:
        pass

try:
    from scraper.utils.error_handler import CheckpointManager, RetryManager, RetryConfig
    HAS_ERROR_HANDLER = True
except ImportError:
    try:
        from utils.error_handler import CheckpointManager, RetryManager, RetryConfig
        HAS_ERROR_HANDLER = True
    except ImportError:
        pass

# Optional: proxy and dedup modules
try:
    from utils.proxy_manager import ProxyRotator, get_proxy_rotator
    HAS_PROXY = True
except ImportError:
    pass

try:
    from utils.queue import URLDeduplicator
    HAS_DEDUP = True
except ImportError:
    pass


# Infrastructure instances (lazy initialized)
_stealth_session: Optional['StealthSession'] = None
_cache: Optional['ResponseCache'] = None
_proxy_rotator: Optional['ProxyRotator'] = None
_url_dedup: Optional['URLDeduplicator'] = None
_checkpoint_mgr: Optional['CheckpointManager'] = None
_circuit_breakers: dict = {}  # domain -> CircuitBreaker
_throttler: Optional['DomainThrottler'] = None
_retry_mgr: Optional['RetryManager'] = None


def _init_infrastructure():
    """Initialize infrastructure components."""
    global _stealth_session, _cache, _proxy_rotator, _url_dedup, _checkpoint_mgr, _throttler, _retry_mgr

    if HAS_STEALTH and _stealth_session is None:
        _stealth_session = create_stealth_session(min_delay=0.3, max_delay=1.5, requests_per_minute=30)

    if HAS_CACHE and _cache is None:
        _cache = get_cache()

    if HAS_PROXY and _proxy_rotator is None:
        _proxy_rotator = get_proxy_rotator()

    if HAS_DEDUP and _url_dedup is None:
        _url_dedup = URLDeduplicator(use_bloom=True)

    if HAS_ERROR_HANDLER and _checkpoint_mgr is None:
        _checkpoint_mgr = CheckpointManager('deep_crawler')
        _retry_mgr = RetryManager(RetryConfig(max_retries=3, base_delay=1.0))

    if HAS_THROTTLER and _throttler is None:
        _throttler = DomainThrottler(default_delay=0.5)


class _CircuitBreaker:
    """Simple circuit breaker for domain-level fault tolerance."""
    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 60.0, name: str = ""):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.name = name
        self.failures = 0
        self.last_failure_time = 0.0
        self.state = "closed"

    def can_execute(self) -> bool:
        if self.state == "closed":
            return True
        if self.state == "open":
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = "half-open"
                return True
            return False
        return True  # half-open allows one request

    def record_success(self):
        self.failures = 0
        self.state = "closed"

    def record_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = "open"


def _get_circuit_breaker(domain: str) -> '_CircuitBreaker':
    """Get or create circuit breaker for domain."""
    if domain not in _circuit_breakers:
        _circuit_breakers[domain] = _CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=60.0,
            name=f"deep_crawler_{domain}"
        )
    return _circuit_breakers[domain]


# Legacy fallback headers
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Rate limiting - used as fallback when infrastructure not available
CRAWL_DELAY = 0.5

# Common career page paths to check
CAREER_PATHS = [
    "/careers",
    "/jobs",
    "/join",
    "/join-us",
    "/work-with-us",
    "/work",
    "/hiring",
    "/opportunities",
    "/employment",
    "/openings",
    "/positions",
    # Variations with trailing slash
    "/careers/",
    "/jobs/",
]

# Hidden paths for new grad / campus / student positions
HIDDEN_PATHS = [
    "/campus",
    "/campus-recruiting",
    "/campusrecruiting",
    "/new-grad",
    "/newgrad",
    "/new-grads",
    "/students",
    "/student",
    "/student-programs",
    "/university",
    "/university-recruiting",
    "/university-programs",
    "/internships",
    "/internship",
    "/interns",
    "/early-career",
    "/early-careers",
    "/earlycareer",
    "/emerging-talent",
    "/grad",
    "/grads",
    "/graduate",
    "/graduate-program",
    "/graduate-programs",
    "/entry-level",
    "/entrylevel",
    "/college",
    "/college-recruiting",
    "/fresh-grad",
    "/freshers",
    # Subdirectory variations
    "/careers/students",
    "/careers/campus",
    "/careers/new-grad",
    "/careers/university",
    "/careers/internships",
    "/careers/early-career",
    "/careers/entry-level",
    "/jobs/students",
    "/jobs/campus",
    "/jobs/new-grad",
    "/jobs/internships",
]

# URL patterns that suggest a job listing
JOB_URL_PATTERNS = [
    re.compile(r"/job[s]?/[a-zA-Z0-9\-]+", re.IGNORECASE),
    re.compile(r"/career[s]?/.*job", re.IGNORECASE),
    re.compile(r"/position[s]?/[a-zA-Z0-9\-]+", re.IGNORECASE),
    re.compile(r"/opening[s]?/[a-zA-Z0-9\-]+", re.IGNORECASE),
    re.compile(r"/opportunity/[a-zA-Z0-9\-]+", re.IGNORECASE),
    re.compile(r"/apply/[a-zA-Z0-9\-]+", re.IGNORECASE),
    re.compile(r"/posting/[a-zA-Z0-9\-]+", re.IGNORECASE),
    re.compile(r"/en-us/jobs/", re.IGNORECASE),  # Microsoft pattern
    re.compile(r"/search\?.*q=.*engineer", re.IGNORECASE),
]

# Keywords that indicate new grad / entry level in URL or title
NEWGRAD_KEYWORDS = [
    "new grad", "newgrad", "new-grad",
    "entry level", "entry-level", "entrylevel",
    "campus", "university", "college",
    "recent graduate", "recent-graduate",
    "junior", "associate",
    "intern", "internship",
    "graduate program", "graduate-program",
    "early career", "early-career",
    "fresh grad", "freshers",
    "student",
]

# Title patterns for extracting job info
TITLE_PATTERNS = [
    re.compile(r"<title[^>]*>([^<]+)</title>", re.IGNORECASE),
    re.compile(r'<h1[^>]*class="[^"]*job[^"]*"[^>]*>([^<]+)</h1>', re.IGNORECASE),
    re.compile(r'<h1[^>]*>([^<]+)</h1>', re.IGNORECASE),
]

# Location extraction patterns
LOCATION_PATTERNS = [
    re.compile(r"location[\"']?\s*:\s*[\"']([^\"']+)[\"']", re.IGNORECASE),
    re.compile(r'<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)</span>', re.IGNORECASE),
    re.compile(r"(?:Remote|On-?site|Hybrid)\s*[-|,]\s*([A-Z][a-z]+(?:,?\s+[A-Z]{2})?)", re.IGNORECASE),
]


class LinkExtractor(HTMLParser):
    """Extract links from HTML content."""

    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value:
                    self.links.append(value)


def normalize_url(base_url: str, href: str) -> Optional[str]:
    """Convert relative URL to absolute and validate."""
    if not href:
        return None

    # Skip non-http links
    if href.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None

    # Handle relative URLs
    absolute = urljoin(base_url, href)

    # Parse and validate
    parsed = urlparse(absolute)
    if parsed.scheme not in ("http", "https"):
        return None

    return absolute


def is_same_domain(url1: str, url2: str) -> bool:
    """Check if two URLs are from the same domain."""
    domain1 = urlparse(url1).netloc.lower().replace("www.", "")
    domain2 = urlparse(url2).netloc.lower().replace("www.", "")
    return domain1 == domain2


def fetch_page(url: str, timeout: int = REQUEST_TIMEOUT) -> Optional[str]:
    """Fetch a page and return its HTML content.

    Uses infrastructure when available:
    - ResponseCache for caching
    - StealthSession for anti-detection headers/fingerprints
    - ProxyRotator for geo-diversity
    - CircuitBreaker per domain for fault tolerance
    - DomainThrottler for intelligent rate limiting
    """
    _init_infrastructure()

    # Extract domain for circuit breaker
    domain = urlparse(url).netloc

    # Check circuit breaker
    circuit = _get_circuit_breaker(domain)
    if circuit and not circuit.can_execute():
        return None

    # Check cache first
    if HAS_CACHE and _cache:
        cached = _cache.get(url)
        if cached:
            content = cached.content
            if isinstance(content, bytes):
                return content.decode('utf-8', errors='replace')
            return content

    # Apply throttling
    if HAS_STEALTH and _stealth_session:
        _stealth_session.before_request()
    elif HAS_THROTTLER and _throttler:
        _throttler.acquire_sync(url)
    else:
        time.sleep(CRAWL_DELAY)

    try:
        # Build request config
        if HAS_STEALTH and _stealth_session:
            config = _stealth_session.get_request_config(url)
            headers = config.get('headers', REQUEST_HEADERS)
            req_timeout = config.get('timeout', timeout)
        else:
            headers = REQUEST_HEADERS
            req_timeout = timeout

        # Add proxy if available
        proxies = None
        if HAS_PROXY and _proxy_rotator:
            proxy = _proxy_rotator.get_proxy(url)
            if proxy:
                proxies = {'http': proxy, 'https': proxy}

        response = requests.get(
            url,
            headers=headers,
            timeout=req_timeout,
            allow_redirects=True,
            proxies=proxies,
        )
        response.raise_for_status()

        # Record success
        if circuit:
            circuit.record_success()
        if HAS_STEALTH and _stealth_session:
            _stealth_session.after_request(response.status_code)

        # Only accept HTML responses
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type and "application/xhtml" not in content_type:
            return None

        # Cache successful responses
        if HAS_CACHE and _cache:
            _cache.set(url, response, ttl=3600 * 6)  # 6 hour TTL

        return response.text

    except requests.RequestException as e:
        # Record failure
        if circuit:
            circuit.record_failure()
        if HAS_STEALTH and _stealth_session:
            _stealth_session.after_request(getattr(e.response, 'status_code', 500) if hasattr(e, 'response') else 500)
        return None


def fetch_sitemap(domain: str) -> list[str]:
    """Fetch and parse sitemap.xml for job-related URLs.

    Args:
        domain: The company domain (e.g., "google.com")

    Returns:
        List of job-related URLs found in the sitemap

    Uses infrastructure for anti-detection, caching, and proxies.
    """
    _init_infrastructure()

    sitemap_urls = [
        f"https://{domain}/sitemap.xml",
        f"https://www.{domain}/sitemap.xml",
        f"https://{domain}/sitemap_index.xml",
        f"https://www.{domain}/sitemap_index.xml",
        f"https://careers.{domain}/sitemap.xml",
        f"https://jobs.{domain}/sitemap.xml",
    ]

    job_urls = []

    for sitemap_url in sitemap_urls:
        try:
            # Check cache first
            if HAS_CACHE and _cache:
                cached = _cache.get(sitemap_url)
                if cached:
                    try:
                        root = ElementTree.fromstring(cached.content)
                        ns = {"ns": "http://www.sitemaps.org/schemas/sitemap/0.9"}
                        for loc in root.findall(".//ns:loc", ns):
                            url = loc.text
                            if url and is_job_url(url):
                                job_urls.append(url)
                        if job_urls:
                            return list(set(job_urls))
                    except Exception:
                        pass

            # Get headers from infrastructure
            if HAS_STEALTH and _stealth_session:
                config = _stealth_session.get_request_config(sitemap_url)
                headers = config.get('headers', REQUEST_HEADERS)
                _stealth_session.before_request()
            else:
                headers = REQUEST_HEADERS
                time.sleep(CRAWL_DELAY)

            # Get proxy from infrastructure
            proxies = None
            if HAS_PROXY and _proxy_rotator:
                proxy = _proxy_rotator.get_proxy(sitemap_url)
                if proxy:
                    proxies = {'http': proxy, 'https': proxy}

            response = requests.get(
                sitemap_url,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
                proxies=proxies,
            )

            if HAS_STEALTH and _stealth_session:
                _stealth_session.after_request(response.status_code)

            if response.status_code != 200:
                continue

            # Cache the sitemap
            if HAS_CACHE and _cache:
                _cache.set(sitemap_url, response, ttl=3600 * 24)  # 24 hour TTL for sitemaps

            # Parse XML
            root = ElementTree.fromstring(response.content)

            # Handle namespace
            ns = {"ns": "http://www.sitemaps.org/schemas/sitemap/0.9"}

            # Find all loc elements (URLs)
            for loc in root.findall(".//ns:loc", ns):
                url = loc.text
                if url and is_job_url(url):
                    job_urls.append(url)

            # If this is a sitemap index, fetch child sitemaps
            for sitemap_loc in root.findall(".//ns:sitemap/ns:loc", ns):
                child_url = sitemap_loc.text
                if child_url and any(kw in child_url.lower() for kw in ["job", "career", "position"]):
                    try:
                        child_response = requests.get(
                            child_url,
                            headers=REQUEST_HEADERS,
                            timeout=REQUEST_TIMEOUT,
                        )
                        if child_response.status_code == 200:
                            child_root = ElementTree.fromstring(child_response.content)
                            for loc in child_root.findall(".//ns:loc", ns):
                                url = loc.text
                                if url and is_job_url(url):
                                    job_urls.append(url)
                    except Exception:
                        continue

            if job_urls:
                break  # Found what we need

        except Exception:
            continue

    return list(set(job_urls))


def is_job_url(url: str) -> bool:
    """Check if a URL appears to be a job listing."""
    url_lower = url.lower()

    # Check URL patterns
    for pattern in JOB_URL_PATTERNS:
        if pattern.search(url):
            return True

    # Check for job-related keywords in URL
    job_keywords = ["job", "career", "position", "opening", "vacancy", "hiring", "employment"]
    return any(kw in url_lower for kw in job_keywords)


def is_newgrad_job(url: str, title: str = "") -> bool:
    """Check if a job appears to be new grad / entry level friendly."""
    text = f"{url} {title}".lower()
    return any(kw in text for kw in NEWGRAD_KEYWORDS)


def extract_links(html: str, base_url: str) -> list[str]:
    """Extract all links from HTML content."""
    parser = LinkExtractor()
    try:
        parser.feed(html)
    except Exception:
        return []

    urls = []
    for href in parser.links:
        absolute = normalize_url(base_url, href)
        if absolute:
            urls.append(absolute)

    return urls


def extract_job_info(html: str, url: str) -> dict:
    """Extract job information from a job listing page."""
    info = {
        "title": "",
        "location": "",
        "description": "",
    }

    # Extract title
    for pattern in TITLE_PATTERNS:
        match = pattern.search(html)
        if match:
            title = match.group(1).strip()
            # Clean up title
            title = re.sub(r"\s+", " ", title)
            title = re.sub(r"\s*[|\-]\s*.*$", "", title)  # Remove site name suffix
            if len(title) > 5 and len(title) < 200:
                info["title"] = title
                break

    # Extract location
    for pattern in LOCATION_PATTERNS:
        match = pattern.search(html)
        if match:
            info["location"] = match.group(1).strip()
            break

    return info


def discover_career_pages(domain: str) -> list[str]:
    """Discover all career-related pages for a domain.

    Args:
        domain: The company domain (e.g., "apple.com")

    Returns:
        List of discovered career page URLs
    """
    discovered = []
    checked = set()

    # Build base URLs to check
    base_urls = [
        f"https://{domain}",
        f"https://www.{domain}",
        f"https://careers.{domain}",
        f"https://jobs.{domain}",
    ]

    # Check common career paths
    for base in base_urls:
        for path in CAREER_PATHS:
            url = base + path
            if url in checked:
                continue
            checked.add(url)

            html = fetch_page(url)
            if html:
                discovered.append(url)
                print(f"  Found career page: {url}")
                # Throttling handled inside fetch_page
                break  # Found career page for this base, move on

    # Check hidden paths for new grad positions
    for base in base_urls:
        for path in HIDDEN_PATHS:
            url = base + path
            if url in checked:
                continue
            checked.add(url)

            html = fetch_page(url)
            if html:
                discovered.append(url)
                print(f"  Found hidden path: {url}")
                # Throttling handled inside fetch_page

    return discovered


def crawl_career_page(url: str, depth: int = 2) -> list[str]:
    """Crawl a career page to find job listing URLs.

    Uses infrastructure:
    - URLDeduplicator for cross-session deduplication
    - Throttling handled by fetch_page

    Args:
        url: The career page URL to crawl
        depth: How many levels deep to crawl (default 2)

    Returns:
        List of job listing URLs found
    """
    _init_infrastructure()

    job_urls = []
    visited = {url}
    to_visit = [(url, 0)]

    while to_visit:
        current_url, current_depth = to_visit.pop(0)

        if current_depth > depth:
            continue

        # Skip if already seen in this or previous sessions
        if HAS_DEDUP and _url_dedup and _url_dedup.is_duplicate(current_url):
            continue

        html = fetch_page(current_url)
        if not html:
            continue

        # Mark as seen
        if HAS_DEDUP and _url_dedup:
            _url_dedup.add(current_url)

        # Throttling now handled inside fetch_page

        # Extract all links
        links = extract_links(html, current_url)

        for link in links:
            if link in visited:
                continue

            # Only follow links on the same domain
            if not is_same_domain(link, url):
                continue

            visited.add(link)

            # Check if this is a job listing URL
            if is_job_url(link):
                job_urls.append(link)

                # If this might be new grad, prioritize it
                if is_newgrad_job(link):
                    print(f"  Found potential new grad job: {link}")

            # Queue for further crawling if not too deep
            elif current_depth < depth:
                # Only queue pages that look relevant
                link_lower = link.lower()
                if any(kw in link_lower for kw in ["job", "career", "team", "department", "role", "position"]):
                    to_visit.append((link, current_depth + 1))

    return list(set(job_urls))


def extract_jobs_from_urls(job_urls: list[str], company_slug: str) -> list[dict]:
    """Extract job information from a list of job URLs.

    Args:
        job_urls: List of job listing URLs
        company_slug: The company identifier

    Returns:
        List of job dicts
    """
    jobs = []
    seen_urls = set()

    for url in job_urls:
        if url in seen_urls:
            continue
        seen_urls.add(url)

        html = fetch_page(url)
        if not html:
            continue

        # Throttling handled inside fetch_page
        info = extract_job_info(html, url)

        # Skip if we couldn't extract a title
        if not info["title"]:
            # Try to extract from URL
            path = urlparse(url).path
            parts = [p for p in path.split("/") if p and len(p) > 2]
            if parts:
                info["title"] = parts[-1].replace("-", " ").replace("_", " ").title()

        if not info["title"]:
            continue

        # Generate a unique external ID from the URL
        external_id = url.split("/")[-1] or url.split("/")[-2]
        external_id = re.sub(r"[^a-zA-Z0-9]", "_", external_id)[:50]

        jobs.append({
            "company": company_slug,
            "title": info["title"],
            "location": info["location"],
            "url": url,
            "posted": datetime.now(timezone.utc).isoformat(),
            "source": "deep_crawler",
            "external_id": f"dc_{external_id}",
            "is_newgrad": is_newgrad_job(url, info["title"]),
        })

    return jobs


def deep_crawl(domain: str, company_slug: str = None, resume: bool = True) -> list[dict]:
    """Deep crawl a company domain to find all job listings.

    This is the main entry point for the deep crawler. It:
    1. Checks common career page paths
    2. Parses sitemap.xml for job URLs
    3. Finds hidden paths (campus, new-grad, etc.)
    4. Crawls discovered pages to find job listings
    5. Extracts job information from listing pages

    Enhanced with:
    - ResponseCache for efficiency
    - URLDeduplicator for cross-session deduplication
    - CheckpointManager for resume capability
    - CircuitBreaker per domain
    - Monitoring for metrics

    Args:
        domain: The company domain (e.g., "apple.com", "google.com")
        company_slug: Optional company slug for results (defaults to domain)
        resume: Whether to resume from checkpoint (default True)

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    _init_infrastructure()

    company_slug = company_slug or domain.replace(".", "-")

    # Use monitoring if available
    if HAS_MONITORING:
        ctx = monitor_scraper(f"deep_crawler_{domain}")
    else:
        ctx = None

    print(f"Deep crawling {domain}...")

    try:
        if ctx:
            ctx.__enter__()

        # Check circuit breaker for domain
        circuit = _get_circuit_breaker(domain)
        if circuit and not circuit.can_execute():
            print(f"  Circuit breaker OPEN for {domain}, skipping")
            return []

        # Load checkpoint if resuming
        checkpoint_key = f"deep_crawl_{domain}"
        completed_urls = set()
        if resume and _checkpoint_mgr:
            state = _checkpoint_mgr.load_state()
            if checkpoint_key in state:
                completed_urls = set(state[checkpoint_key].get('completed_urls', []))
                print(f"  Resuming from checkpoint ({len(completed_urls)} URLs already processed)")

        all_job_urls = set()

        # Step 1: Discover career pages
        print("  Discovering career pages...")
        career_pages = discover_career_pages(domain)
        print(f"  Found {len(career_pages)} career page(s)")

        # Step 2: Fetch sitemap
        print("  Checking sitemap.xml...")
        sitemap_urls = fetch_sitemap(domain)
        all_job_urls.update(sitemap_urls)
        print(f"  Found {len(sitemap_urls)} URLs in sitemap")

        # Step 3: Crawl each career page
        for career_page in career_pages:
            # Skip if already processed in previous run
            if career_page in completed_urls:
                print(f"  Skipping {career_page} (already processed)")
                continue

            print(f"  Crawling {career_page}...")
            found_urls = crawl_career_page(career_page, depth=2)
            all_job_urls.update(found_urls)
            print(f"  Found {len(found_urls)} job URLs")

            # Save checkpoint after each career page
            if _checkpoint_mgr:
                completed_urls.add(career_page)
                _checkpoint_mgr.save_checkpoint({checkpoint_key: {'completed_urls': list(completed_urls)}})

        # Step 4: Filter to just job listings and deduplicate
        job_urls = [url for url in all_job_urls if is_job_url(url)]

        # Use URLDeduplicator if available
        if HAS_DEDUP and _url_dedup:
            original_count = len(job_urls)
            job_urls = [url for url in job_urls if not _url_dedup.is_duplicate(url)]
            for url in job_urls:
                _url_dedup.add(url)
            deduped = original_count - len(job_urls)
            if deduped > 0:
                print(f"  Deduplicated {deduped} URLs across sessions")

        print(f"  Total unique job URLs: {len(job_urls)}")

        # Step 5: Extract job information
        # Limit to prevent excessive crawling
        max_jobs = 100
        if len(job_urls) > max_jobs:
            # Prioritize new grad jobs
            newgrad_urls = [u for u in job_urls if is_newgrad_job(u)]
            other_urls = [u for u in job_urls if not is_newgrad_job(u)]
            job_urls = newgrad_urls[:max_jobs//2] + other_urls[:max_jobs//2]
            print(f"  Limited to {len(job_urls)} jobs (prioritizing new grad)")

        print(f"  Extracting job details from {len(job_urls)} URLs...")
        jobs = extract_jobs_from_urls(job_urls, company_slug)

        # Record metrics if monitoring available
        if ctx:
            ctx.record_questions(extracted=len(jobs), new=len(jobs))

        print(f"  Extracted {len(jobs)} jobs from {domain}")
        return jobs

    finally:
        if ctx:
            ctx.__exit__(None, None, None)


def fetch_deep_crawl(domain: str, company_slug: str = None) -> list[dict]:
    """Alias for deep_crawl to match other source naming convention."""
    return deep_crawl(domain, company_slug)


# Convenience functions for specific companies
def crawl_custom_companies(max_companies: int = 10, max_jobs_per_company: int = 50) -> list[dict]:
    """Crawl all companies with custom ATS (no standard API).

    Runs daily with sensible limits to avoid timeouts.
    Never crashes - individual company failures are logged and skipped.

    Args:
        max_companies: Max companies to crawl per run (prevents timeouts)
        max_jobs_per_company: Max jobs to extract per company

    Returns:
        Combined list of jobs from all custom companies
    """
    # Import here to avoid circular dependency
    try:
        from companies import get_companies_by_ats
    except ImportError:
        print("  [WARN] Could not import companies module")
        return []

    try:
        custom_companies = get_companies_by_ats("custom")
    except Exception as e:
        print(f"  [WARN] Could not get custom companies: {e}")
        return []

    all_jobs = []

    # Map of company slugs to their domains
    COMPANY_DOMAINS = {
        "meta": "meta.com",
        "apple": "apple.com",
        "amazon": "amazon.jobs",  # Amazon uses amazon.jobs
        "google": "careers.google.com",  # Google careers subdomain
        "microsoft": "careers.microsoft.com",
        "midjourney": "midjourney.com",
    }

    crawled = 0
    for slug, info in custom_companies.items():
        if crawled >= max_companies:
            print(f"  Deep crawler: reached limit of {max_companies} companies")
            break

        domain = COMPANY_DOMAINS.get(slug)
        if domain:
            try:
                jobs = deep_crawl(domain, slug)
                # Limit jobs per company
                if len(jobs) > max_jobs_per_company:
                    jobs = jobs[:max_jobs_per_company]
                all_jobs.extend(jobs)
                crawled += 1
            except KeyboardInterrupt:
                raise
            except Exception as e:
                # Never crash - log and continue to next company
                print(f"  [WARN] Error crawling {slug}: {type(e).__name__}: {e}")
                continue

    return all_jobs


def cleanup_infrastructure():
    """Cleanup infrastructure resources."""
    global _stealth_session, _proxy_rotator, _url_dedup, _checkpoint_mgr, _circuit_breakers, _throttler, _retry_mgr

    if _url_dedup:
        try:
            _url_dedup.save()
        except Exception:
            pass

    _stealth_session = None
    _proxy_rotator = None
    _url_dedup = None
    _checkpoint_mgr = None
    _circuit_breakers = {}
    _throttler = None
    _retry_mgr = None


def get_infrastructure_status() -> dict:
    """Get status of infrastructure components."""
    _init_infrastructure()
    return {
        'infra_available': INFRA_AVAILABLE,
        'stealth_session': HAS_STEALTH and _stealth_session is not None,
        'cache': HAS_CACHE and _cache is not None,
        'proxy_rotator': HAS_PROXY and _proxy_rotator is not None,
        'url_deduplicator': HAS_DEDUP and _url_dedup is not None,
        'checkpoint_manager': HAS_ERROR_HANDLER and _checkpoint_mgr is not None,
        'domain_throttler': HAS_THROTTLER and _throttler is not None,
        'monitoring': HAS_MONITORING,
        'circuit_breakers': len(_circuit_breakers),
    }


# Quick test function
if __name__ == "__main__":
    # Test with a smaller domain
    print("Testing deep crawler...")
    print(f"Infrastructure status: {get_infrastructure_status()}")
    # jobs = deep_crawl("example.com", "example")
    # print(f"Found {len(jobs)} jobs")
    # for job in jobs[:5]:
    #     print(f"  - {job['title']} ({job['location']})")
