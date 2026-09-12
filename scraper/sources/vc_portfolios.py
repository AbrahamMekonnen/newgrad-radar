"""VC Portfolio Job Board scrapers.

Fetches jobs from venture capital portfolio job boards:
- a16z (Andreessen Horowitz): jobs.a16z.com
- Y Combinator: workatastartup.com
- First Round Capital: firstround.com/jobs
- Sequoia Capital: sequoiacap.com/arc

These boards feature exclusive startup jobs from top VC portfolios.
"""

import re
import requests
import time
from datetime import datetime
from typing import Optional
from html import unescape

from config import REQUEST_TIMEOUT


# =============================================================================
# Infrastructure imports with fallback
# =============================================================================
INFRA_AVAILABLE = False
try:
    from utils.anti_detection import StealthSession, create_stealth_session
    from utils.cache import ResponseCache, get_cache
    from utils.rate_limiter import AdaptiveRateLimiter, DomainThrottler
    from utils.monitoring import monitor_scraper
    from utils.error_handler import with_retry, RetryConfig, RetryManager
    INFRA_AVAILABLE = True
except ImportError:
    pass

# Initialize infrastructure components if available
_stealth_session: Optional['StealthSession'] = None
_cache: Optional['ResponseCache'] = None
_retry_manager: Optional['RetryManager'] = None

def _get_session() -> Optional['StealthSession']:
    """Get or create stealth session."""
    global _stealth_session
    if INFRA_AVAILABLE and _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=0.5,
            max_delay=3.0,
            requests_per_minute=20
        )
    return _stealth_session

def _get_cache() -> Optional['ResponseCache']:
    """Get or create response cache with moderate TTL for job data."""
    global _cache
    if INFRA_AVAILABLE and _cache is None:
        # Jobs update frequently - cache for 2 hours
        _cache = ResponseCache(ttl=2 * 3600)
    return _cache

def _get_retry_manager() -> Optional['RetryManager']:
    """Get or create retry manager."""
    global _retry_manager
    if INFRA_AVAILABLE and _retry_manager is None:
        _retry_manager = RetryManager(RetryConfig(
            max_retries=3,
            base_delay=2.0,
            max_delay=30.0
        ))
    return _retry_manager


# User agent for scraping (fallback when infra not available)
USER_AGENT = "NewGradRadar/1.0 (job aggregator for new grads)"

# Rate limiting between requests
RATE_LIMIT_DELAY = 0.5


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return text.strip()


def parse_date(date_str: Optional[str]) -> Optional[str]:
    """Parse various date formats to ISO format."""
    if not date_str:
        return None

    formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
        "%B %d, %Y",
        "%b %d, %Y",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            return dt.isoformat() + ("Z" if "Z" not in date_str else "")
        except (ValueError, TypeError):
            continue

    return None


def is_entry_level(title: str, description: str = "") -> bool:
    """Check if job appears to be entry-level/new grad friendly."""
    text = f"{title} {description}".lower()

    # Exclude senior positions
    senior_keywords = [
        "senior", "sr.", "sr ", "lead", "principal", "staff",
        "architect", "director", "manager", "head of", "vp ", "chief"
    ]
    for keyword in senior_keywords:
        if keyword in text:
            return False

    # Include if explicitly entry-level
    entry_keywords = ["junior", "jr.", "entry", "grad", "new grad", "associate"]
    for keyword in entry_keywords:
        if keyword in text:
            return True

    # Default to including if no seniority indicators
    return True


# =============================================================================
# Helper functions for requests with infrastructure
# =============================================================================

def _make_request(url: str, method: str = 'GET', headers: dict = None,
                  params: dict = None, json_data: dict = None,
                  timeout: int = REQUEST_TIMEOUT) -> Optional[requests.Response]:
    """Make an HTTP request with infrastructure support if available."""
    cache = _get_cache()
    session = _get_session()
    retry_mgr = _get_retry_manager()

    headers = headers or {}

    # Generate cache key
    cache_key = f"{method}:{url}:{str(params)}:{str(json_data)}"

    # Try cache first (only for GET requests)
    if cache and method.upper() == 'GET':
        cached = cache.get(cache_key)
        if cached:
            class CachedResponse:
                def __init__(self, cached_resp):
                    self.content = cached_resp.content
                    self.text = cached_resp.content.decode('utf-8', errors='replace')
                    self.status_code = cached_resp.status_code
                    self.headers = cached_resp.headers
                def raise_for_status(self):
                    pass
                def json(self):
                    import json
                    return json.loads(self.text)
            return CachedResponse(cached)

    # Apply stealth headers if available
    if session:
        if not session.before_request(timeout=30):
            return None
        config = session.get_request_config(url)
        for key, value in config.get('headers', {}).items():
            if key not in headers:  # Don't override explicit headers
                headers[key] = value

    def do_request():
        if method.upper() == 'GET':
            return requests.get(url, headers=headers, params=params, timeout=timeout)
        elif method.upper() == 'POST':
            return requests.post(url, headers=headers, params=params, json=json_data, timeout=timeout)
        else:
            return requests.request(method, url, headers=headers, params=params, json=json_data, timeout=timeout)

    try:
        if retry_mgr:
            response = retry_mgr.execute(do_request)
        else:
            response = do_request()

        response.raise_for_status()

        # Cache the response
        if cache and response.status_code == 200 and method.upper() == 'GET':
            cache.set(cache_key, response, ttl=2 * 3600)

        # Record success for rate limiting
        if session:
            session.after_request(response.status_code)

        return response

    except requests.RequestException as e:
        if session:
            session.after_request(getattr(e.response, 'status_code', 500) if hasattr(e, 'response') else 500)
        raise


# =============================================================================
# a16z (Andreessen Horowitz) - jobs.a16z.com
# =============================================================================

A16Z_API_URL = "https://jobs.a16z.com/api/jobs"


def fetch_a16z_jobs(filter_entry_level: bool = True) -> list[dict]:
    """Fetch jobs from a16z portfolio companies via jobs.a16z.com.

    Args:
        filter_entry_level: If True, filter to entry-level friendly positions

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    jobs = []
    page = 1
    max_pages = 20  # Safety limit

    try:
        while page <= max_pages:
            params = {
                "page": page,
                "limit": 50,
            }

            try:
                response = _make_request(
                    A16Z_API_URL,
                    method='GET',
                    headers=headers,
                    params=params
                )
            except requests.RequestException as e:
                if hasattr(e, 'response') and e.response is not None and e.response.status_code == 429:
                    print("a16z rate limited, backing off...")
                    time.sleep(RATE_LIMIT_DELAY * 5 if not INFRA_AVAILABLE else 1)
                    continue
                raise

            if response is None:
                print("a16z request skipped due to rate limiting")
                break

            data = response.json()

            # Handle different response formats
            job_list = data.get("jobs", data.get("data", data)) if isinstance(data, dict) else data

            if not job_list or not isinstance(job_list, list):
                break

            for job in job_list:
                if not isinstance(job, dict):
                    continue

                title = job.get("title", "")
                company = job.get("company", {})
                if isinstance(company, dict):
                    company_name = company.get("name", "Unknown")
                else:
                    company_name = str(company) if company else "Unknown"

                description = job.get("description", "")

                # Filter entry level if requested
                if filter_entry_level and not is_entry_level(title, description):
                    continue

                location = job.get("location", "")
                if isinstance(location, dict):
                    location = location.get("name", "")
                if isinstance(location, list):
                    location = ", ".join([l.get("name", str(l)) if isinstance(l, dict) else str(l) for l in location[:3]])

                job_id = job.get("id", job.get("slug", ""))
                job_url = job.get("url", job.get("apply_url", f"https://jobs.a16z.com/jobs/{job_id}"))

                jobs.append({
                    "company": company_name,
                    "title": title,
                    "location": location or "Remote",
                    "url": job_url,
                    "posted": parse_date(job.get("posted_at", job.get("created_at"))),
                    "source": "a16z",
                    "external_id": str(job_id),
                })

            # Check for pagination
            if len(job_list) < 50:
                break
            page += 1
            # Only sleep if infrastructure not available (it handles delays)
            if not INFRA_AVAILABLE:
                time.sleep(RATE_LIMIT_DELAY)

    except requests.RequestException as e:
        print(f"Error fetching a16z jobs: {e}")
    except ValueError as e:
        print(f"Error parsing a16z JSON: {e}")

    print(f"Fetched {len(jobs)} jobs from a16z")
    return jobs


# =============================================================================
# Y Combinator - workatastartup.com
# =============================================================================

YC_API_URL = "https://www.workatastartup.com/api/companies/search"
YC_JOBS_URL = "https://www.workatastartup.com/api/jobs"


def fetch_yc_jobs(filter_entry_level: bool = True) -> list[dict]:
    """Fetch jobs from Y Combinator portfolio via workatastartup.com.

    Args:
        filter_entry_level: If True, filter to entry-level friendly positions

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    jobs = []

    try:
        # YC uses a POST endpoint with filters
        # Try different query approaches
        search_params = {
            "query": "",
            "page": 1,
            "types": ["fulltime"],
            "roles": ["eng"],  # Engineering roles
        }

        try:
            response = _make_request(
                YC_API_URL,
                method='POST',
                headers=headers,
                json_data=search_params
            )
        except requests.RequestException:
            response = None

        # Fallback to GET if POST fails
        if response is None or response.status_code != 200:
            try:
                response = _make_request(
                    "https://www.workatastartup.com/companies.json",
                    method='GET',
                    headers=headers
                )
            except requests.RequestException:
                response = None

        if response is None:
            print("YC request failed or rate limited")
            return []

        data = response.json()

        # Parse response - could be companies with nested jobs or direct jobs
        companies = data.get("companies", data) if isinstance(data, dict) else data

        if isinstance(companies, list):
            for company in companies:
                if not isinstance(company, dict):
                    continue

                company_name = company.get("name", "Unknown")
                company_jobs = company.get("jobs", [])

                for job in company_jobs:
                    if not isinstance(job, dict):
                        continue

                    title = job.get("title", job.get("role", ""))
                    description = job.get("description", "")

                    if filter_entry_level and not is_entry_level(title, description):
                        continue

                    location = job.get("location", job.get("remote", ""))
                    if job.get("remote") == True:
                        location = f"Remote{', ' + location if location and location != True else ''}"

                    job_id = job.get("id", job.get("slug", ""))
                    job_url = job.get("url", f"https://www.workatastartup.com/jobs/{job_id}")

                    jobs.append({
                        "company": company_name,
                        "title": title,
                        "location": str(location) if location else "Remote",
                        "url": job_url,
                        "posted": parse_date(job.get("posted_at", job.get("created_at"))),
                        "source": "yc_workatastartup",
                        "external_id": str(job_id),
                    })

    except requests.RequestException as e:
        print(f"Error fetching YC jobs: {e}")
    except ValueError as e:
        print(f"Error parsing YC JSON: {e}")

    # Also try direct jobs endpoint
    try:
        response = _make_request(
            YC_JOBS_URL,
            method='GET',
            headers=headers,
            params={"role": "eng"}
        )

        if response is not None and response.status_code == 200:
            data = response.json()
            job_list = data.get("jobs", data) if isinstance(data, dict) else data

            if isinstance(job_list, list):
                for job in job_list:
                    if not isinstance(job, dict):
                        continue

                    title = job.get("title", "")
                    company_name = job.get("company", {}).get("name", job.get("company_name", "Unknown"))
                    description = job.get("description", "")

                    if filter_entry_level and not is_entry_level(title, description):
                        continue

                    job_id = str(job.get("id", ""))

                    # Check for duplicates
                    if any(j["external_id"] == job_id and j["source"] == "yc_workatastartup" for j in jobs):
                        continue

                    location = job.get("location", "")
                    if job.get("remote"):
                        location = f"Remote{', ' + location if location else ''}"

                    jobs.append({
                        "company": company_name,
                        "title": title,
                        "location": location or "Remote",
                        "url": job.get("url", f"https://www.workatastartup.com/jobs/{job_id}"),
                        "posted": parse_date(job.get("posted_at", job.get("created_at"))),
                        "source": "yc_workatastartup",
                        "external_id": job_id,
                    })

    except requests.RequestException:
        pass  # Already logged primary error
    except ValueError:
        pass

    print(f"Fetched {len(jobs)} jobs from YC Work at a Startup")
    return jobs


# =============================================================================
# First Round Capital - firstround.com/jobs
# =============================================================================

FIRSTROUND_URL = "https://firstround.com/jobs"
FIRSTROUND_API_URL = "https://jobs.firstround.com/api/jobs"


def fetch_firstround_jobs(filter_entry_level: bool = True) -> list[dict]:
    """Fetch jobs from First Round Capital portfolio.

    Args:
        filter_entry_level: If True, filter to entry-level friendly positions

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    jobs = []

    # Try JSON API first
    try:
        response = _make_request(
            FIRSTROUND_API_URL,
            method='GET',
            headers=headers
        )

        if response is not None and response.status_code == 200:
            data = response.json()
            job_list = data.get("jobs", data.get("data", data)) if isinstance(data, dict) else data

            if isinstance(job_list, list):
                for job in job_list:
                    if not isinstance(job, dict):
                        continue

                    title = job.get("title", "")
                    company_name = job.get("company", {})
                    if isinstance(company_name, dict):
                        company_name = company_name.get("name", "Unknown")
                    description = job.get("description", "")

                    if filter_entry_level and not is_entry_level(title, description):
                        continue

                    location = job.get("location", "")
                    if isinstance(location, dict):
                        location = location.get("name", "")
                    if isinstance(location, list):
                        location = ", ".join([l.get("name", str(l)) if isinstance(l, dict) else str(l) for l in location[:3]])

                    job_id = job.get("id", job.get("slug", ""))

                    jobs.append({
                        "company": str(company_name) if company_name else "Unknown",
                        "title": title,
                        "location": location or "Remote",
                        "url": job.get("url", f"https://firstround.com/jobs/{job_id}"),
                        "posted": parse_date(job.get("posted_at", job.get("created_at"))),
                        "source": "firstround",
                        "external_id": str(job_id),
                    })

                print(f"Fetched {len(jobs)} jobs from First Round Capital")
                return jobs

    except requests.RequestException as e:
        print(f"First Round API failed, trying HTML: {e}")
    except ValueError as e:
        print(f"First Round JSON parse error, trying HTML: {e}")

    # Fallback to HTML scraping
    try:
        from bs4 import BeautifulSoup

        response = _make_request(
            FIRSTROUND_URL,
            method='GET',
            headers={"User-Agent": USER_AGENT}
        )
        if response is None:
            raise requests.RequestException("Request failed or rate limited")

        soup = BeautifulSoup(response.text, "html.parser")

        # Find job listings - common patterns
        job_cards = soup.select("[class*='job'], [class*='listing'], [class*='position'], article")

        for idx, card in enumerate(job_cards):
            # Extract title
            title_elem = card.select_one("h2, h3, h4, [class*='title']")
            if not title_elem:
                continue

            title = clean_html(title_elem.get_text())
            if not title:
                continue

            # Extract company
            company_elem = card.select_one("[class*='company'], [class*='org']")
            company_name = clean_html(company_elem.get_text()) if company_elem else "Unknown"

            if filter_entry_level and not is_entry_level(title):
                continue

            # Extract location
            location_elem = card.select_one("[class*='location']")
            location = clean_html(location_elem.get_text()) if location_elem else "Remote"

            # Extract URL
            link = card.select_one("a[href]")
            job_url = link.get("href", "") if link else ""
            if job_url and not job_url.startswith("http"):
                job_url = f"https://firstround.com{job_url}"

            jobs.append({
                "company": company_name,
                "title": title,
                "location": location,
                "url": job_url or FIRSTROUND_URL,
                "posted": None,
                "source": "firstround",
                "external_id": f"firstround_{idx}",
            })

    except ImportError:
        print("BeautifulSoup not installed, skipping HTML scraping for First Round")
    except requests.RequestException as e:
        print(f"Error fetching First Round HTML: {e}")

    print(f"Fetched {len(jobs)} jobs from First Round Capital")
    return jobs


# =============================================================================
# Sequoia Capital - sequoiacap.com/arc (Sequoia Arc program)
# =============================================================================

SEQUOIA_ARC_URL = "https://www.sequoiacap.com/arc"
SEQUOIA_JOBS_API = "https://www.sequoiacap.com/api/jobs"


def fetch_sequoia_jobs(filter_entry_level: bool = True) -> list[dict]:
    """Fetch jobs from Sequoia Capital portfolio via Arc program.

    Args:
        filter_entry_level: If True, filter to entry-level friendly positions

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    jobs = []

    # Try JSON API first
    try:
        response = _make_request(
            SEQUOIA_JOBS_API,
            method='GET',
            headers=headers
        )

        if response is not None and response.status_code == 200:
            data = response.json()
            job_list = data.get("jobs", data.get("data", data.get("results", data))) if isinstance(data, dict) else data

            if isinstance(job_list, list):
                for job in job_list:
                    if not isinstance(job, dict):
                        continue

                    title = job.get("title", "")
                    company_name = job.get("company", {})
                    if isinstance(company_name, dict):
                        company_name = company_name.get("name", "Unknown")
                    description = job.get("description", "")

                    if filter_entry_level and not is_entry_level(title, description):
                        continue

                    location = job.get("location", "")
                    if isinstance(location, dict):
                        location = location.get("name", "")
                    if isinstance(location, list):
                        location = ", ".join([l.get("name", str(l)) if isinstance(l, dict) else str(l) for l in location[:3]])

                    job_id = job.get("id", job.get("slug", ""))

                    jobs.append({
                        "company": str(company_name) if company_name else "Unknown",
                        "title": title,
                        "location": location or "Remote",
                        "url": job.get("url", f"https://www.sequoiacap.com/arc/jobs/{job_id}"),
                        "posted": parse_date(job.get("posted_at", job.get("created_at"))),
                        "source": "sequoia_arc",
                        "external_id": str(job_id),
                    })

                print(f"Fetched {len(jobs)} jobs from Sequoia Arc")
                return jobs

    except requests.RequestException as e:
        print(f"Sequoia API failed, trying HTML: {e}")
    except ValueError as e:
        print(f"Sequoia JSON parse error, trying HTML: {e}")

    # Fallback to HTML scraping
    try:
        from bs4 import BeautifulSoup

        response = _make_request(
            SEQUOIA_ARC_URL,
            method='GET',
            headers={"User-Agent": USER_AGENT}
        )
        if response is None:
            raise requests.RequestException("Request failed or rate limited")

        soup = BeautifulSoup(response.text, "html.parser")

        # Find job listings
        job_cards = soup.select("[class*='job'], [class*='listing'], [class*='position'], [class*='card']")

        for idx, card in enumerate(job_cards):
            # Extract title
            title_elem = card.select_one("h2, h3, h4, [class*='title'], [class*='role']")
            if not title_elem:
                continue

            title = clean_html(title_elem.get_text())
            if not title or len(title) < 3:
                continue

            # Extract company
            company_elem = card.select_one("[class*='company'], [class*='org'], [class*='startup']")
            company_name = clean_html(company_elem.get_text()) if company_elem else "Sequoia Portfolio"

            if filter_entry_level and not is_entry_level(title):
                continue

            # Extract location
            location_elem = card.select_one("[class*='location'], [class*='loc']")
            location = clean_html(location_elem.get_text()) if location_elem else "Remote"

            # Extract URL
            link = card.select_one("a[href]")
            job_url = link.get("href", "") if link else ""
            if job_url and not job_url.startswith("http"):
                job_url = f"https://www.sequoiacap.com{job_url}"

            jobs.append({
                "company": company_name,
                "title": title,
                "location": location,
                "url": job_url or SEQUOIA_ARC_URL,
                "posted": None,
                "source": "sequoia_arc",
                "external_id": f"sequoia_{idx}",
            })

    except ImportError:
        print("BeautifulSoup not installed, skipping HTML scraping for Sequoia")
    except requests.RequestException as e:
        print(f"Error fetching Sequoia HTML: {e}")

    print(f"Fetched {len(jobs)} jobs from Sequoia Arc")
    return jobs


# =============================================================================
# Combined fetcher
# =============================================================================


def fetch_all_vc_jobs(filter_entry_level: bool = True) -> list[dict]:
    """Fetch jobs from all VC portfolio boards.

    Args:
        filter_entry_level: If True, filter to entry-level friendly positions

    Returns:
        List of all jobs from VC portfolio boards
    """
    all_jobs = []

    print("Fetching VC portfolio jobs...")

    # Use monitoring if available
    ctx = None
    if INFRA_AVAILABLE:
        ctx = monitor_scraper('vc_portfolios')
        ctx.__enter__()

    try:
        # Fetch from each source with rate limiting
        sources = [
            ("a16z", fetch_a16z_jobs),
            ("YC", fetch_yc_jobs),
            ("First Round", fetch_firstround_jobs),
            ("Sequoia", fetch_sequoia_jobs),
        ]

        for name, fetcher in sources:
            try:
                jobs = fetcher(filter_entry_level=filter_entry_level)
                all_jobs.extend(jobs)
                # Only sleep if infrastructure not available
                if not INFRA_AVAILABLE:
                    time.sleep(RATE_LIMIT_DELAY)
            except Exception as e:
                print(f"Error fetching {name} jobs: {e}")

        print(f"Total VC portfolio jobs: {len(all_jobs)}")

        # Record metrics
        if ctx:
            ctx.record_questions(extracted=len(all_jobs), new=len(all_jobs))

        return all_jobs

    except Exception as e:
        if ctx:
            ctx.__exit__(type(e), e, e.__traceback__)
        raise
    finally:
        if ctx:
            ctx.__exit__(None, None, None)
