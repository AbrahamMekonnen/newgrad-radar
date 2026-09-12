"""GitHub New-Grad Repositories aggregator.

Parses job entries from curated community-maintained GitHub repos:
- SimplifyJobs/New-Grad-Positions (README.md)
- pittcsc/New-Grad-Positions
- zapplyjobs/New-Grad-Software-Engineering-Jobs-2026

These repos maintain markdown tables with company info, updated daily by the community.

Upgraded with:
- ResponseCache for README content caching (1hr TTL - repos update frequently)
- RetryManager for robust fetching
"""

import re
import requests
import hashlib
import logging
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse, urljoin

from config import REQUEST_TIMEOUT

# Import infrastructure utilities
try:
    from utils.cache import ResponseCache
    from utils.error_handler import RetryManager, RetryConfig
    from utils.anti_detection import StealthSession, create_stealth_session
    from utils.rate_limiter import AdaptiveRateLimiter
    from utils.monitoring import monitor_scraper
    HAS_INFRASTRUCTURE = True
except ImportError:
    try:
        from ..utils.cache import ResponseCache
        from ..utils.error_handler import RetryManager, RetryConfig
        from ..utils.anti_detection import StealthSession, create_stealth_session
        from ..utils.rate_limiter import AdaptiveRateLimiter
        from ..utils.monitoring import monitor_scraper
        HAS_INFRASTRUCTURE = True
    except ImportError:
        HAS_INFRASTRUCTURE = False
        ResponseCache = None
        RetryManager = None
        RetryConfig = None
        StealthSession = None
        create_stealth_session = None
        AdaptiveRateLimiter = None
        monitor_scraper = None

logger = logging.getLogger(__name__)

# Global infrastructure instances
_response_cache: Optional['ResponseCache'] = None
_retry_manager: Optional['RetryManager'] = None
_stealth_session: Optional['StealthSession'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None


def _get_cache() -> Optional['ResponseCache']:
    """Get or initialize response cache."""
    global _response_cache
    if HAS_INFRASTRUCTURE and _response_cache is None and ResponseCache:
        try:
            _response_cache = ResponseCache(ttl=3600)  # 1 hour - repos update frequently
            logger.info("ResponseCache initialized for GitHub repos")
        except Exception as e:
            logger.warning(f"Failed to initialize ResponseCache: {e}")
    return _response_cache


def _get_retry_manager() -> Optional['RetryManager']:
    """Get or initialize retry manager."""
    global _retry_manager
    if HAS_INFRASTRUCTURE and _retry_manager is None and RetryManager:
        try:
            _retry_manager = RetryManager(RetryConfig(
                max_retries=3,
                base_delay=1.0,
                max_delay=15.0
            ))
            logger.info("RetryManager initialized for GitHub repos")
        except Exception as e:
            logger.warning(f"Failed to initialize RetryManager: {e}")
    return _retry_manager


def _get_session() -> Optional['StealthSession']:
    """Get or initialize stealth session."""
    global _stealth_session
    if HAS_INFRASTRUCTURE and _stealth_session is None and create_stealth_session:
        try:
            _stealth_session = create_stealth_session(
                min_delay=0.3,
                max_delay=1.5,
                requests_per_minute=60  # GitHub raw content is generous
            )
            logger.info("StealthSession initialized for GitHub repos")
        except Exception as e:
            logger.warning(f"Failed to initialize StealthSession: {e}")
    return _stealth_session


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or initialize rate limiter."""
    global _rate_limiter
    if HAS_INFRASTRUCTURE and _rate_limiter is None and AdaptiveRateLimiter:
        try:
            _rate_limiter = AdaptiveRateLimiter(
                base_delay=0.5,
                min_delay=0.2,
                max_delay=10.0,
                target_response_time=1.0
            )
            logger.info("AdaptiveRateLimiter initialized for GitHub repos")
        except Exception as e:
            logger.warning(f"Failed to initialize AdaptiveRateLimiter: {e}")
    return _rate_limiter


# GitHub raw content URLs for new-grad repos
GITHUB_REPOS = {
    "simplify": {
        "name": "SimplifyJobs/New-Grad-Positions",
        "readme_url": "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
        "base_url": "https://github.com/SimplifyJobs/New-Grad-Positions",
    },
    "pittcsc": {
        "name": "pittcsc/New-Grad-Positions",
        "readme_url": "https://raw.githubusercontent.com/pittcsc/New-Grad-Positions/main/README.md",
        # Fallback to master branch
        "readme_url_fallback": "https://raw.githubusercontent.com/pittcsc/New-Grad-Positions/master/README.md",
        "base_url": "https://github.com/pittcsc/New-Grad-Positions",
    },
    "zapplyjobs": {
        "name": "zapplyjobs/New-Grad-Software-Engineering-Jobs-2026",
        "readme_url": "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Software-Engineering-Jobs-2026/main/README.md",
        "readme_url_fallback": "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Software-Engineering-Jobs-2026/master/README.md",
        "base_url": "https://github.com/zapplyjobs/New-Grad-Software-Engineering-Jobs-2026",
    },
}

# Request headers to appear as a legitimate client
REQUEST_HEADERS = {
    "User-Agent": "NewGradRadar/1.0 (job aggregator for new graduates)",
    "Accept": "text/plain, text/markdown, */*",
}


def generate_job_id(company: str, title: str, url: str) -> str:
    """Generate a unique ID for a job to enable deduplication."""
    # Normalize inputs
    normalized = f"{company.lower().strip()}|{title.lower().strip()}|{url.lower().strip()}"
    return hashlib.md5(normalized.encode()).hexdigest()[:16]


def extract_link_text_and_url(cell: str) -> tuple[str, Optional[str]]:
    """Extract link text and URL from a markdown cell.

    Handles formats like:
    - [Company Name](https://example.com)
    - **[Company Name](url)** (bold)
    - Just plain text
    - Multiple links (returns first)

    Returns:
        Tuple of (text, url) where url may be None
    """
    # Strip leading/trailing whitespace
    cell = cell.strip()

    # Remove bold markers
    cell = re.sub(r'\*\*', '', cell)

    # Match markdown link pattern
    link_pattern = r'\[([^\]]+)\]\(([^)]+)\)'
    match = re.search(link_pattern, cell)

    if match:
        return match.group(1).strip(), match.group(2).strip()

    # No link found, return plain text
    return cell, None


def extract_locations_from_cell(cell: str) -> list[str]:
    """Extract locations from a markdown cell.

    Handles formats like:
    - "New York, NY"
    - "Remote"
    - "San Francisco, CA / Remote"
    - "Multiple locations"
    - "<details>..." collapsed sections
    """
    # Clean the cell
    cell = cell.strip()

    # Remove <details> blocks (some repos use these for long location lists)
    cell = re.sub(r'<details>.*?</details>', '', cell, flags=re.DOTALL)

    # Remove HTML tags
    cell = re.sub(r'<[^>]+>', '', cell)

    # If empty after cleaning
    if not cell or cell == '-':
        return []

    # Split on common delimiters
    locations = []
    # Split on | / , but keep "City, State" together
    parts = re.split(r'\s*[|/]\s*', cell)

    for part in parts:
        part = part.strip()
        if part and part != '-':
            locations.append(part)

    return locations if locations else [cell]


def is_closed_job(row: str) -> bool:
    """Check if a job entry is marked as closed."""
    closed_indicators = [
        "~~",  # Strikethrough
        "closed",
        "filled",
        "no longer",
        "expired",
        "unavailable",
    ]
    lower_row = row.lower()
    return any(indicator in lower_row for indicator in closed_indicators)


def parse_date_from_text(text: str) -> Optional[str]:
    """Try to parse a date from various formats."""
    if not text:
        return None

    # Common date formats in these repos
    formats = [
        "%b %d",          # "Jan 15"
        "%B %d",          # "January 15"
        "%m/%d",          # "01/15"
        "%m/%d/%Y",       # "01/15/2024"
        "%m/%d/%y",       # "01/15/24"
        "%Y-%m-%d",       # "2024-01-15"
        "%d %b %Y",       # "15 Jan 2024"
    ]

    # Current year for relative dates
    current_year = datetime.now().year

    for fmt in formats:
        try:
            dt = datetime.strptime(text.strip(), fmt)
            # If year not in format, assume current year
            if dt.year == 1900:
                dt = dt.replace(year=current_year)
            return dt.isoformat() + "Z"
        except ValueError:
            continue

    return None


def parse_markdown_table(content: str, source_name: str) -> list[dict]:
    """Parse a markdown table and extract job entries.

    Handles various table formats found in new-grad repos:
    - | Company | Location | Link | Date |
    - | Company | Title | Location | Link |
    - With or without header row
    - With emoji indicators
    """
    jobs = []

    # Split into lines
    lines = content.split('\n')

    # Find table rows (lines starting with |)
    in_table = False
    header_cols = []

    for line in lines:
        line = line.strip()

        # Skip empty lines
        if not line:
            in_table = False
            continue

        # Detect table row
        if line.startswith('|'):
            # Parse the row
            cells = [c.strip() for c in line.split('|')]
            # Remove empty first/last cells from split
            cells = [c for c in cells if c or c == '']

            # Check if this is a separator row (|---|---|...)
            if all(re.match(r'^[-:]+$', c) for c in cells if c):
                continue

            # Check if this looks like a header row
            header_keywords = ['company', 'name', 'location', 'link', 'date', 'notes', 'role', 'title', 'position']
            is_header = any(kw in ' '.join(cells).lower() for kw in header_keywords)

            if not in_table or is_header:
                # This might be a header row
                header_cols = [c.lower().strip() for c in cells]
                in_table = True
                if is_header:
                    continue

            # Skip closed jobs
            if is_closed_job(line):
                continue

            # Parse as data row
            job = parse_table_row(cells, header_cols, source_name)
            if job:
                jobs.append(job)

    return jobs


def parse_table_row(cells: list[str], headers: list[str], source_name: str) -> Optional[dict]:
    """Parse a single table row into a job entry.

    Adapts to different column layouts based on headers.
    """
    if len(cells) < 2:
        return None

    job = {
        "company": "",
        "title": "",
        "locations": [],
        "url": "",
        "posted": None,
        "source": f"github_{source_name}",
    }

    # Map headers to indices
    header_map = {}
    for i, h in enumerate(headers):
        h_lower = h.lower()
        if 'company' in h_lower or 'name' in h_lower:
            header_map['company'] = i
        elif 'role' in h_lower or 'title' in h_lower or 'position' in h_lower:
            header_map['title'] = i
        elif 'location' in h_lower:
            header_map['location'] = i
        elif 'link' in h_lower or 'apply' in h_lower or 'url' in h_lower:
            header_map['link'] = i
        elif 'date' in h_lower or 'posted' in h_lower or 'added' in h_lower:
            header_map['date'] = i
        elif 'notes' in h_lower:
            header_map['notes'] = i

    # If no headers detected, use common layout assumptions
    if not header_map:
        # Common format: Company | Location | Link | Date | Notes
        # or: Company | Role | Location | Link
        if len(cells) >= 1:
            header_map['company'] = 0
        if len(cells) >= 2:
            # Check if second column looks like a URL or title
            text, url = extract_link_text_and_url(cells[1])
            if url:
                header_map['link'] = 1
            else:
                # Could be location or title
                if any(kw in text.lower() for kw in ['engineer', 'developer', 'swe', 'intern']):
                    header_map['title'] = 1
                else:
                    header_map['location'] = 1
        if len(cells) >= 3:
            header_map['location'] = 2 if 'location' not in header_map else header_map.get('location')
        if len(cells) >= 4:
            header_map['link'] = 3 if 'link' not in header_map else header_map.get('link')

    # Extract company
    if 'company' in header_map and header_map['company'] < len(cells):
        text, url = extract_link_text_and_url(cells[header_map['company']])
        job['company'] = text
        if url and not job['url']:
            job['url'] = url

    # Extract title/role
    if 'title' in header_map and header_map['title'] < len(cells):
        text, url = extract_link_text_and_url(cells[header_map['title']])
        job['title'] = text
        if url and not job['url']:
            job['url'] = url

    # Extract location
    if 'location' in header_map and header_map['location'] < len(cells):
        job['locations'] = extract_locations_from_cell(cells[header_map['location']])

    # Extract link
    if 'link' in header_map and header_map['link'] < len(cells):
        text, url = extract_link_text_and_url(cells[header_map['link']])
        if url:
            job['url'] = url
        elif text and text.startswith('http'):
            job['url'] = text

    # Extract date
    if 'date' in header_map and header_map['date'] < len(cells):
        job['posted'] = parse_date_from_text(cells[header_map['date']])

    # Default title if not found
    if not job['title']:
        job['title'] = "New Grad Software Engineer"

    # Skip if no company name
    if not job['company']:
        return None

    # Generate dedup ID
    job['dedup_id'] = generate_job_id(job['company'], job['title'], job['url'])

    return job


def fetch_readme(repo_config: dict) -> Optional[str]:
    """Fetch README content from a GitHub repo."""
    urls_to_try = [repo_config['readme_url']]
    if 'readme_url_fallback' in repo_config:
        urls_to_try.append(repo_config['readme_url_fallback'])

    cache = _get_cache()
    retry_mgr = _get_retry_manager()
    session = _get_session()
    rate_limiter = _get_rate_limiter()

    for url in urls_to_try:
        try:
            # Check cache first
            if cache:
                cached = cache.get(url)
                if cached:
                    logger.info(f"Using cached README for {url}")
                    return cached.content.decode('utf-8', errors='replace')

            # Apply rate limiting
            if session:
                if not session.before_request(timeout=30):
                    logger.warning(f"Rate limited, skipping {url}")
                    continue

            # Get headers with stealth if available
            headers = dict(REQUEST_HEADERS)
            if session:
                config = session.get_request_config(url)
                for key, value in config.get('headers', {}).items():
                    if key not in headers:
                        headers[key] = value

            # Fetch with retry if available
            def do_fetch():
                return requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)

            if retry_mgr:
                response = retry_mgr.execute(do_fetch)
            else:
                response = do_fetch()

            # Record success for rate limiting
            if session:
                session.after_request(response.status_code)

            if response.status_code == 200:
                # Cache the response
                if cache:
                    cache.set(url, response, ttl=3600)

                return response.text

        except requests.RequestException as e:
            logger.warning(f"Error fetching {url}: {e}")
            print(f"Error fetching {url}: {e}")
            if session:
                session.after_request(500)
            continue

    return None


def fetch_github_repo(repo_key: str) -> list[dict]:
    """Fetch and parse jobs from a single GitHub repo.

    Args:
        repo_key: Key from GITHUB_REPOS dict ('simplify', 'pittcsc', 'zapplyjobs')

    Returns:
        List of job dicts
    """
    if repo_key not in GITHUB_REPOS:
        print(f"Unknown repo key: {repo_key}")
        return []

    repo_config = GITHUB_REPOS[repo_key]

    content = fetch_readme(repo_config)
    if not content:
        print(f"Could not fetch README from {repo_config['name']}")
        return []

    jobs = parse_markdown_table(content, repo_key)
    print(f"Found {len(jobs)} jobs from {repo_config['name']}")

    return jobs


def fetch_github_repos(repos: Optional[list[str]] = None) -> list[dict]:
    """Fetch jobs from multiple GitHub repos with deduplication.

    Args:
        repos: List of repo keys to fetch. If None, fetches all.

    Returns:
        Deduplicated list of job dicts
    """
    if repos is None:
        repos = list(GITHUB_REPOS.keys())

    # Use monitoring if available
    ctx = None
    if HAS_INFRASTRUCTURE and monitor_scraper:
        try:
            ctx = monitor_scraper('github_repos')
            ctx.__enter__()
        except Exception as e:
            logger.warning(f"Failed to start monitoring: {e}")
            ctx = None

    try:
        all_jobs = []
        seen_ids = set()

        for repo_key in repos:
            jobs = fetch_github_repo(repo_key)

            for job in jobs:
                dedup_id = job.get('dedup_id', '')
                if dedup_id and dedup_id not in seen_ids:
                    seen_ids.add(dedup_id)
                    all_jobs.append(job)
                elif not dedup_id:
                    # No dedup ID, include anyway
                    all_jobs.append(job)

        print(f"Total: {len(all_jobs)} unique jobs across {len(repos)} repos")

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


def fetch_all_github_repos() -> list[dict]:
    """Fetch jobs from all configured GitHub repos.

    Convenience function that fetches and deduplicates across all repos.
    """
    return fetch_github_repos()


# Specific repo fetchers for granular control
def fetch_simplify_readme() -> list[dict]:
    """Fetch jobs from SimplifyJobs README (not the JSON API)."""
    return fetch_github_repo('simplify')


def fetch_pittcsc() -> list[dict]:
    """Fetch jobs from pittcsc/New-Grad-Positions."""
    return fetch_github_repo('pittcsc')


def fetch_zapplyjobs() -> list[dict]:
    """Fetch jobs from zapplyjobs/New-Grad-Software-Engineering-Jobs-2026."""
    return fetch_github_repo('zapplyjobs')


if __name__ == "__main__":
    # Test the aggregator
    import json

    print("Testing GitHub repos aggregator...")
    print("=" * 50)

    jobs = fetch_all_github_repos()

    print("\nSample jobs:")
    for job in jobs[:5]:
        print(json.dumps(job, indent=2))
