"""Newsletter job aggregators.

Fetches curated job listings from tech newsletters that often feature
exclusive opportunities not found on major aggregators.

Sources:
- TLDR Jobs (jobs.tldr.tech): Daily tech newsletter job board
- DiversifyTech (diversifytech.com): Curated jobs for underrepresented groups

These newsletters have human-curated job listings that often include:
- Startup positions before they hit major boards
- Remote-friendly roles
- Entry-level/new grad positions
- Companies with strong DEI initiatives
"""

import re
import requests
import time
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import Optional
from html import unescape

from config import REQUEST_TIMEOUT

# Try to import RSS parser (optional, for feeds that provide RSS)
try:
    from utils.rss_parser import parse_rss_feed, RSSItem
    HAS_RSS_PARSER = True
except ImportError:
    HAS_RSS_PARSER = False

# =============================================================================
# Infrastructure Integration
# =============================================================================

INFRA_AVAILABLE = False
try:
    from scraper.utils.anti_detection import StealthSession, create_stealth_session
    from scraper.utils.cache import ResponseCache, get_cache
    from scraper.utils.rate_limiter import AdaptiveRateLimiter, DomainThrottler
    from scraper.utils.monitoring import monitor_scraper
    from scraper.utils.error_handler import with_retry, RetryConfig, RetryManager
    INFRA_AVAILABLE = True
except ImportError:
    try:
        from utils.anti_detection import StealthSession, create_stealth_session
        from utils.cache import ResponseCache, get_cache
        from utils.rate_limiter import AdaptiveRateLimiter, DomainThrottler
        from utils.monitoring import monitor_scraper
        from utils.error_handler import with_retry, RetryConfig, RetryManager
        INFRA_AVAILABLE = True
    except ImportError:
        pass

# Infrastructure instances (lazy initialized)
_stealth_session: Optional['StealthSession'] = None
_cache: Optional['ResponseCache'] = None
_throttler: Optional['DomainThrottler'] = None


def _init_infrastructure():
    """Initialize infrastructure components."""
    global _stealth_session, _cache, _throttler
    if not INFRA_AVAILABLE:
        return
    if _stealth_session is None:
        _stealth_session = create_stealth_session(min_delay=0.5, max_delay=2.0, requests_per_minute=25)
    if _cache is None:
        _cache = get_cache()
    if _throttler is None:
        _throttler = DomainThrottler(default_delay=1.0)


def _make_request(url: str, headers: dict = None, timeout: int = None, accept_json: bool = False) -> Optional[requests.Response]:
    """Make an HTTP request using infrastructure when available."""
    _init_infrastructure()
    timeout = timeout or REQUEST_TIMEOUT

    if INFRA_AVAILABLE and _stealth_session:
        # Check cache first
        if _cache:
            cached = _cache.get(url)
            if cached:
                class CachedResponse:
                    def __init__(self, content, status_code):
                        self.content = content
                        self.text = content.decode('utf-8', errors='replace') if isinstance(content, bytes) else content
                        self.status_code = status_code
                    def json(self):
                        import json
                        return json.loads(self.text)
                    def raise_for_status(self):
                        if self.status_code >= 400:
                            raise requests.HTTPError(f"HTTP {self.status_code}")
                return CachedResponse(cached.content, cached.status_code)

        # Use stealth session
        config = _stealth_session.get_request_config(url)
        req_headers = config.get('headers', {})
        if accept_json:
            req_headers['Accept'] = 'application/json'
        if headers:
            req_headers.update(headers)

        # Apply rate limiting
        _stealth_session.before_request()

        try:
            response = requests.get(url, headers=req_headers, timeout=timeout)
            _stealth_session.after_request(response.status_code)

            # Cache successful responses
            if _cache and response.status_code == 200:
                _cache.set(url, response, ttl=3600 * 6)

            return response
        except requests.RequestException as e:
            _stealth_session.after_request(500)
            raise
    else:
        # Fallback to basic requests
        default_headers = {"User-Agent": USER_AGENT}
        if accept_json:
            default_headers["Accept"] = "application/json"
        if headers:
            default_headers.update(headers)
        time.sleep(RATE_LIMIT_DELAY)
        return requests.get(url, headers=default_headers, timeout=timeout)


# Rate limiting (fallback)
RATE_LIMIT_DELAY = 1.0  # seconds between requests

# User agent for requests (fallback)
USER_AGENT = "NewGradRadar/1.0 (job aggregator for new grads)"

# Entry-level keywords (for filtering)
ENTRY_LEVEL_KEYWORDS = [
    "junior", "jr.", "jr ", "entry", "new grad", "new-grad", "newgrad",
    "associate", "graduate", "early career", "0-2 years", "1-2 years",
    "0-1 years", "recent grad", "university grad",
]

# Senior keywords to exclude
SENIOR_KEYWORDS = [
    "senior", "sr.", "sr ", "lead", "principal", "staff", "architect",
    "director", "manager", "head of", "vp ", "vice president",
    "10+ years", "8+ years", "7+ years", "6+ years", "5+ years",
]

# Software engineering role keywords
SWE_KEYWORDS = [
    "software", "engineer", "developer", "swe", "sde", "programmer",
    "frontend", "front-end", "backend", "back-end", "fullstack", "full-stack",
    "devops", "platform", "infrastructure", "ml engineer", "machine learning",
    "data engineer", "mobile", "ios", "android", "web developer",
]


def is_entry_level(title: str, description: str = "") -> bool:
    """Check if a job appears to be entry-level friendly.

    Args:
        title: Job title
        description: Optional job description

    Returns:
        True if the job appears entry-level friendly
    """
    combined = f"{title} {description}".lower()

    # Explicit senior roles are excluded
    for keyword in SENIOR_KEYWORDS:
        if keyword in combined:
            return False

    # If explicitly marked entry-level, include
    for keyword in ENTRY_LEVEL_KEYWORDS:
        if keyword in combined:
            return True

    # Otherwise, include if no seniority indicators (might be open to new grads)
    return True


def is_swe_role(title: str) -> bool:
    """Check if a job is a software engineering role.

    Args:
        title: Job title

    Returns:
        True if the job is a software engineering role
    """
    title_lower = title.lower()
    return any(kw in title_lower for kw in SWE_KEYWORDS)


def clean_text(text: str) -> str:
    """Clean HTML and normalize text."""
    if not text:
        return ""
    text = unescape(text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_location(text: str) -> str:
    """Extract location from job text.

    Looks for common location patterns like "Remote", "NYC", etc.
    """
    text_lower = text.lower()

    # Check for remote
    if "remote" in text_lower:
        # Check for specific remote restrictions
        remote_patterns = [
            r"remote\s*[\(\[]?(us|usa|united states)[\)\]]?",
            r"remote\s*[\(\[]?(eu|europe)[\)\]]?",
            r"remote\s*[\(\[]?worldwide[\)\]]?",
            r"remote\s*[\(\[]?anywhere[\)\]]?",
        ]
        for pattern in remote_patterns:
            match = re.search(pattern, text_lower)
            if match:
                return match.group(0).title()
        return "Remote"

    # Common tech hubs
    locations = [
        "San Francisco", "SF", "New York", "NYC", "Seattle", "Austin",
        "Boston", "Los Angeles", "LA", "Chicago", "Denver", "Atlanta",
        "London", "Berlin", "Toronto", "Vancouver", "Singapore",
    ]

    for loc in locations:
        if loc.lower() in text_lower:
            return loc

    return ""


# =============================================================================
# TLDR Jobs (jobs.tldr.tech)
# =============================================================================

TLDR_BASE_URL = "https://jobs.tldr.tech"
TLDR_API_URL = "https://jobs.tldr.tech/api/jobs"
TLDR_FEED_URL = "https://jobs.tldr.tech/feed.xml"


def fetch_tldr_jobs_api() -> list[dict]:
    """Fetch jobs from TLDR Jobs API.

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    # Try the API endpoint first
    params = {
        "category": "engineering",  # Focus on engineering jobs
        "limit": 100,
    }

    try:
        # Build URL with params
        param_str = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{TLDR_API_URL}?{param_str}"
        response = _make_request(url, accept_json=True)
        if response is None:
            return []
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as e:
        print(f"Error fetching TLDR Jobs API: {e}")
        return []
    except ValueError as e:
        print(f"Error parsing TLDR Jobs JSON: {e}")
        return []

    jobs = []

    # Handle different response formats
    job_list = data.get("jobs", data) if isinstance(data, dict) else data

    for job in job_list:
        if not isinstance(job, dict):
            continue

        title = job.get("title", "")
        company = job.get("company", {})
        company_name = company.get("name", "") if isinstance(company, dict) else str(company)

        if not title or not company_name:
            continue

        # Filter for SWE roles and entry-level
        if not is_swe_role(title):
            continue

        description = job.get("description", "")
        if not is_entry_level(title, description):
            continue

        location = job.get("location", "")
        if not location:
            location = extract_location(description)

        jobs.append({
            "company": company_name,
            "title": title,
            "location": location or "Remote",
            "url": job.get("url", job.get("apply_url", "")),
            "posted": job.get("posted_at", job.get("created_at")),
            "source": "tldr_jobs",
            "external_id": str(job.get("id", "")),
        })

    return jobs


def fetch_tldr_jobs_scrape() -> list[dict]:
    """Scrape jobs from TLDR Jobs website.

    Fallback if API is unavailable. Scrapes the main job listing page.

    Returns:
        List of job dicts
    """
    try:
        response = _make_request(TLDR_BASE_URL)
        if response is None:
            return []
        response.raise_for_status()
        html = response.text
    except requests.RequestException as e:
        print(f"Error fetching TLDR Jobs page: {e}")
        return []

    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception as e:
        print(f"Error parsing TLDR Jobs HTML: {e}")
        return []

    jobs = []

    # Find job listings - TLDR uses various div structures
    job_cards = soup.find_all("div", class_=re.compile(r"job|listing|card", re.I))

    for card in job_cards:
        # Extract title
        title_elem = card.find(["h2", "h3", "a"], class_=re.compile(r"title|name", re.I))
        if not title_elem:
            title_elem = card.find(["h2", "h3"])
        title = clean_text(title_elem.get_text()) if title_elem else ""

        if not title:
            continue

        # Filter for SWE and entry-level
        if not is_swe_role(title):
            continue

        # Extract company
        company_elem = card.find(class_=re.compile(r"company|org", re.I))
        company = clean_text(company_elem.get_text()) if company_elem else ""

        if not company:
            continue

        # Extract URL
        link = card.find("a", href=True)
        url = link.get("href", "") if link else ""
        if url and not url.startswith("http"):
            url = f"{TLDR_BASE_URL}{url}"

        # Extract location
        location_elem = card.find(class_=re.compile(r"location|place", re.I))
        location = clean_text(location_elem.get_text()) if location_elem else ""

        card_text = card.get_text()
        if not is_entry_level(title, card_text):
            continue

        if not location:
            location = extract_location(card_text)

        jobs.append({
            "company": company,
            "title": title,
            "location": location or "Remote",
            "url": url,
            "posted": None,  # Hard to extract from scrape
            "source": "tldr_jobs",
            "external_id": url.split("/")[-1] if url else "",
        })

    return jobs


def fetch_tldr_jobs_rss() -> list[dict]:
    """Fetch jobs from TLDR Jobs RSS feed.

    Returns:
        List of job dicts
    """
    if not HAS_RSS_PARSER:
        return []

    feed = parse_rss_feed(TLDR_FEED_URL)
    if not feed:
        return []

    jobs = []

    for item in feed.items:
        title = item.title

        if not is_swe_role(title):
            continue

        if not is_entry_level(title, item.description):
            continue

        # Try to extract company from title (often "Title at Company")
        company = ""
        if " at " in title:
            parts = title.rsplit(" at ", 1)
            title = parts[0].strip()
            company = parts[1].strip()
        elif " - " in title:
            parts = title.split(" - ", 1)
            title = parts[0].strip()
            company = parts[1].strip()

        location = extract_location(item.description)

        jobs.append({
            "company": company or "Unknown",
            "title": title,
            "location": location or "Remote",
            "url": item.link,
            "posted": item.pub_date,
            "source": "tldr_jobs",
            "external_id": item.guid or item.link,
        })

    return jobs


def fetch_tldr_jobs() -> list[dict]:
    """Fetch jobs from TLDR Jobs using best available method.

    Tries API first, falls back to RSS, then scraping.

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    print("Fetching TLDR Jobs...")

    # Try API first
    jobs = fetch_tldr_jobs_api()
    if jobs:
        print(f"  TLDR Jobs API: {len(jobs)} jobs")
        return jobs

    # Try RSS feed
    jobs = fetch_tldr_jobs_rss()
    if jobs:
        print(f"  TLDR Jobs RSS: {len(jobs)} jobs")
        return jobs

    # Fall back to scraping (rate limiting handled by _make_request)
    jobs = fetch_tldr_jobs_scrape()
    print(f"  TLDR Jobs scrape: {len(jobs)} jobs")

    return jobs


# =============================================================================
# DiversifyTech (diversifytech.com)
# =============================================================================

DIVERSIFY_BASE_URL = "https://www.diversifytech.com"
DIVERSIFY_JOBS_URL = "https://www.diversifytech.com/job-board"
DIVERSIFY_API_URL = "https://www.diversifytech.com/api/jobs"
DIVERSIFY_RSS_URL = "https://www.diversifytech.com/feed.xml"


def fetch_diversify_tech_api() -> list[dict]:
    """Fetch jobs from DiversifyTech API.

    Returns:
        List of job dicts
    """
    try:
        response = _make_request(DIVERSIFY_API_URL, accept_json=True)
        if response is None:
            return []
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as e:
        print(f"Error fetching DiversifyTech API: {e}")
        return []
    except ValueError as e:
        print(f"Error parsing DiversifyTech JSON: {e}")
        return []

    jobs = []

    job_list = data.get("jobs", data) if isinstance(data, dict) else data

    for job in job_list:
        if not isinstance(job, dict):
            continue

        title = job.get("title", "")
        company = job.get("company", job.get("company_name", ""))

        if not title or not company:
            continue

        # Filter for SWE roles and entry-level
        if not is_swe_role(title):
            continue

        description = job.get("description", "")
        if not is_entry_level(title, description):
            continue

        location = job.get("location", "")
        if not location:
            location = extract_location(description)

        jobs.append({
            "company": company,
            "title": title,
            "location": location or "Remote",
            "url": job.get("url", job.get("apply_url", "")),
            "posted": job.get("posted_at", job.get("created_at", job.get("date"))),
            "source": "diversify_tech",
            "external_id": str(job.get("id", "")),
        })

    return jobs


def fetch_diversify_tech_scrape() -> list[dict]:
    """Scrape jobs from DiversifyTech website.

    Returns:
        List of job dicts
    """
    try:
        response = _make_request(DIVERSIFY_JOBS_URL)
        if response is None:
            return []
        response.raise_for_status()
        html = response.text
    except requests.RequestException as e:
        print(f"Error fetching DiversifyTech page: {e}")
        return []

    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception as e:
        print(f"Error parsing DiversifyTech HTML: {e}")
        return []

    jobs = []

    # DiversifyTech job listings structure
    job_cards = soup.find_all("div", class_=re.compile(r"job|listing|card|opportunity", re.I))

    # Also try article tags
    if not job_cards:
        job_cards = soup.find_all("article")

    # Try common job board patterns
    if not job_cards:
        job_cards = soup.find_all("li", class_=re.compile(r"job", re.I))

    for card in job_cards:
        # Extract title
        title_elem = (
            card.find(["h2", "h3", "h4"], class_=re.compile(r"title|name|heading", re.I)) or
            card.find(["h2", "h3", "h4"]) or
            card.find("a", class_=re.compile(r"title", re.I))
        )
        title = clean_text(title_elem.get_text()) if title_elem else ""

        if not title or len(title) < 3:
            continue

        # Filter for SWE and entry-level
        if not is_swe_role(title):
            continue

        # Extract company
        company_elem = (
            card.find(class_=re.compile(r"company|employer|org", re.I)) or
            card.find("span", class_=re.compile(r"name", re.I))
        )
        company = clean_text(company_elem.get_text()) if company_elem else ""

        if not company:
            # Try to find company in card structure
            spans = card.find_all("span")
            for span in spans:
                text = clean_text(span.get_text())
                if text and len(text) > 2 and text != title:
                    company = text
                    break

        if not company:
            continue

        # Extract URL
        link = card.find("a", href=True)
        url = link.get("href", "") if link else ""
        if url and not url.startswith("http"):
            url = f"{DIVERSIFY_BASE_URL}{url}"

        # Extract location
        location_elem = card.find(class_=re.compile(r"location|place|remote", re.I))
        location = clean_text(location_elem.get_text()) if location_elem else ""

        card_text = card.get_text()
        if not is_entry_level(title, card_text):
            continue

        if not location:
            location = extract_location(card_text)

        # Generate external ID from URL or title
        external_id = ""
        if url:
            external_id = url.split("/")[-1] or url.split("/")[-2]
        if not external_id:
            external_id = f"{company}-{title}".lower().replace(" ", "-")[:50]

        jobs.append({
            "company": company,
            "title": title,
            "location": location or "Remote",
            "url": url,
            "posted": None,
            "source": "diversify_tech",
            "external_id": external_id,
        })

    return jobs


def fetch_diversify_tech_rss() -> list[dict]:
    """Fetch jobs from DiversifyTech RSS feed.

    Returns:
        List of job dicts
    """
    if not HAS_RSS_PARSER:
        return []

    feed = parse_rss_feed(DIVERSIFY_RSS_URL)
    if not feed:
        return []

    jobs = []

    for item in feed.items:
        # DiversifyTech RSS might include non-job content
        title = item.title

        if not is_swe_role(title):
            continue

        if not is_entry_level(title, item.description):
            continue

        # Extract company from title or description
        company = ""
        if " at " in title:
            parts = title.rsplit(" at ", 1)
            title = parts[0].strip()
            company = parts[1].strip()
        elif " - " in title:
            parts = title.split(" - ", 1)
            title = parts[0].strip()
            company = parts[1].strip()

        if not company:
            # Try to find company in description
            desc_lower = item.description.lower()
            company_match = re.search(r"company:\s*([^,\n]+)", desc_lower)
            if company_match:
                company = company_match.group(1).strip()

        location = extract_location(item.description)

        jobs.append({
            "company": company or "Unknown",
            "title": title,
            "location": location or "Remote",
            "url": item.link,
            "posted": item.pub_date,
            "source": "diversify_tech",
            "external_id": item.guid or item.link,
        })

    return jobs


def fetch_diversify_tech() -> list[dict]:
    """Fetch jobs from DiversifyTech using best available method.

    Tries API first, falls back to RSS, then scraping.

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    print("Fetching DiversifyTech...")

    # Try API first
    jobs = fetch_diversify_tech_api()
    if jobs:
        print(f"  DiversifyTech API: {len(jobs)} jobs")
        return jobs

    # Try RSS feed
    jobs = fetch_diversify_tech_rss()
    if jobs:
        print(f"  DiversifyTech RSS: {len(jobs)} jobs")
        return jobs

    # Fall back to scraping (rate limiting handled by _make_request)
    jobs = fetch_diversify_tech_scrape()
    print(f"  DiversifyTech scrape: {len(jobs)} jobs")

    return jobs


# =============================================================================
# Additional Newsletter Sources (RSS-based)
# =============================================================================

# List of newsletter RSS feeds with job listings
NEWSLETTER_FEEDS = [
    {
        "name": "Techmeme Jobs",
        "url": "https://www.techmeme.com/feed.xml",
        "category": "tech",
    },
    {
        "name": "Hacker News Jobs",
        "url": "https://hnrss.org/jobs",
        "category": "tech",
    },
    {
        "name": "Remote OK",
        "url": "https://remoteok.com/remote-jobs.rss",
        "category": "remote",
    },
]


def fetch_newsletter_rss(feed_config: dict) -> list[dict]:
    """Fetch jobs from a newsletter RSS feed.

    Args:
        feed_config: Dict with name, url, and category

    Returns:
        List of job dicts
    """
    if not HAS_RSS_PARSER:
        return []

    feed = parse_rss_feed(feed_config["url"])
    if not feed:
        return []

    jobs = []
    source_name = feed_config["name"].lower().replace(" ", "_")

    for item in feed.items:
        title = item.title

        # Filter for SWE roles
        if not is_swe_role(title):
            continue

        if not is_entry_level(title, item.description):
            continue

        # Parse company from title
        company = ""
        if " at " in title:
            parts = title.rsplit(" at ", 1)
            title = parts[0].strip()
            company = parts[1].strip()
        elif " - " in title:
            parts = title.split(" - ", 1)
            title = parts[0].strip()
            company = parts[1].strip()
        elif " | " in title:
            parts = title.split(" | ", 1)
            title = parts[0].strip()
            company = parts[1].strip()

        location = extract_location(item.description)

        jobs.append({
            "company": company or "Unknown",
            "title": title,
            "location": location or "Remote",
            "url": item.link,
            "posted": item.pub_date,
            "source": source_name,
            "external_id": item.guid or item.link,
        })

    return jobs


def fetch_all_newsletter_rss() -> list[dict]:
    """Fetch jobs from all configured newsletter RSS feeds.

    Returns:
        Combined list of job dicts from all feeds
    """
    if not HAS_RSS_PARSER:
        print("RSS parser not available, skipping newsletter feeds")
        return []

    all_jobs = []

    for feed_config in NEWSLETTER_FEEDS:
        print(f"Fetching {feed_config['name']}...")
        jobs = fetch_newsletter_rss(feed_config)
        print(f"  Found {len(jobs)} jobs")
        all_jobs.extend(jobs)
        time.sleep(RATE_LIMIT_DELAY)

    return all_jobs


# =============================================================================
# Main Entry Points
# =============================================================================

def fetch_all_newsletter_jobs() -> list[dict]:
    """Fetch jobs from all newsletter sources.

    This is the main entry point for newsletter job aggregation.
    Combines TLDR Jobs, DiversifyTech, and RSS-based newsletters.

    Returns:
        Combined list of job dicts from all newsletter sources
    """
    # Use monitoring if available
    if INFRA_AVAILABLE:
        ctx = monitor_scraper("newsletter_jobs")
    else:
        ctx = None

    try:
        if ctx:
            ctx.__enter__()

        all_jobs = []

        # Primary newsletter sources (rate limiting handled by _make_request)
        tldr_jobs = fetch_tldr_jobs()
        all_jobs.extend(tldr_jobs)

        diversify_jobs = fetch_diversify_tech()
        all_jobs.extend(diversify_jobs)

        # Additional RSS-based newsletters
        rss_jobs = fetch_all_newsletter_rss()
        all_jobs.extend(rss_jobs)

        # Record metrics if monitoring available
        if ctx:
            ctx.record_questions(extracted=len(all_jobs), new=len(all_jobs))

        print(f"\nTotal newsletter jobs: {len(all_jobs)}")
        return all_jobs

    finally:
        if ctx:
            ctx.__exit__(None, None, None)


# Alias for consistent naming
fetch_newsletters = fetch_all_newsletter_jobs


if __name__ == "__main__":
    # Test the newsletter sources
    import json

    print("=" * 60)
    print("Newsletter Job Aggregator Test")
    print("=" * 60)

    jobs = fetch_all_newsletter_jobs()

    print(f"\nTotal jobs found: {len(jobs)}")

    # Group by source
    by_source: dict[str, list] = {}
    for job in jobs:
        source = job["source"]
        if source not in by_source:
            by_source[source] = []
        by_source[source].append(job)

    print("\nBy source:")
    for source, source_jobs in by_source.items():
        print(f"  {source}: {len(source_jobs)}")

    # Sample output
    if jobs:
        print("\nSample jobs:")
        for job in jobs[:5]:
            print(f"  - {job['title']} at {job['company']} ({job['source']})")
