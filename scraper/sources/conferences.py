"""Diversity Conference Job Board scrapers.

Scrapes sponsor/exhibitor lists and job postings from major diversity conferences:
- GHC (Grace Hopper Celebration) - ghc.anitab.org
- NSBE (National Society of Black Engineers) - career.nsbe.org
- SHPE (Society of Hispanic Professional Engineers) - jobs.shpe.org
- AfroTech - afrotech.com/career-fair

These conference sponsors are actively hiring diverse talent and often
have dedicated new grad programs.
"""

import re
import requests
import time
from datetime import datetime
from typing import Optional
from html import unescape

from config import REQUEST_TIMEOUT

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

# Fallback rate limiting
RATE_LIMIT_DELAY = 1.0


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


def _make_request(url: str, headers: dict = None, timeout: int = None) -> Optional[requests.Response]:
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
                return CachedResponse(cached.content, cached.status_code)

        # Use stealth session
        config = _stealth_session.get_request_config(url)
        req_headers = config.get('headers', {})
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
        if headers is None:
            headers = dict(HEADERS)
        time.sleep(RATE_LIMIT_DELAY)
        return requests.get(url, headers=headers, timeout=timeout)


# Common career page URL patterns for sponsor companies
CAREERS_URL_PATTERNS = [
    "/careers",
    "/jobs",
    "/join-us",
    "/work-with-us",
    "/about/careers",
    "/company/careers",
]

# Common ATS domains that indicate a careers page
ATS_DOMAINS = [
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "workday.com",
    "icims.com",
    "smartrecruiters.com",
    "jobvite.com",
    "ultipro.com",
    "myworkdayjobs.com",
    "taleo.net",
    "brassring.com",
    "successfactors.com",
    "applicantpro.com",
]

# User agent for requests (fallback)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_company_name(text: str) -> str:
    """Clean and normalize company name."""
    # Remove common suffixes
    text = re.sub(r",?\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|Co\.?)$", "", text, flags=re.IGNORECASE)
    return text.strip()


def guess_careers_url(company_name: str, company_url: Optional[str] = None) -> Optional[str]:
    """Try to find a company's careers page URL.

    Args:
        company_name: Company name to search for
        company_url: Known company URL to append /careers to

    Returns:
        Best guess at careers URL or None
    """
    _init_infrastructure()

    if company_url:
        # Try common career page paths
        base_url = company_url.rstrip("/")
        for path in CAREERS_URL_PATTERNS:
            careers_url = f"{base_url}{path}"
            try:
                if INFRA_AVAILABLE and _stealth_session:
                    config = _stealth_session.get_request_config(careers_url)
                    headers = config.get('headers', {})
                    _stealth_session.before_request()
                    response = requests.head(
                        careers_url,
                        headers=headers,
                        timeout=5,
                        allow_redirects=True
                    )
                    _stealth_session.after_request(response.status_code)
                else:
                    time.sleep(RATE_LIMIT_DELAY)
                    response = requests.head(
                        careers_url,
                        headers=HEADERS,
                        timeout=5,
                        allow_redirects=True
                    )
                if response.status_code == 200:
                    return careers_url
            except requests.RequestException:
                continue

    return None


def fetch_ghc_sponsors() -> list[dict]:
    """Fetch sponsor companies from Grace Hopper Celebration.

    GHC is one of the largest gatherings of women technologists.
    Sponsors actively recruit at the conference and often have
    dedicated diversity hiring programs.

    Returns:
        List of sponsor dicts with keys: company, careers_url, source, sponsor_level
    """
    sponsors = []

    # GHC sponsor page URL
    url = "https://ghc.anitab.org/attend/sponsor-list/"

    try:
        response = _make_request(url)
        if response is None:
            return _get_ghc_fallback_sponsors()
        response.raise_for_status()
        html = response.text
    except requests.RequestException as e:
        print(f"Error fetching GHC sponsors: {e}")
        # Return known top sponsors as fallback
        return _get_ghc_fallback_sponsors()

    # Parse sponsor names from HTML
    # GHC typically lists sponsors in tiers: Platinum, Gold, Silver, etc.
    sponsor_patterns = [
        # Match sponsor divs/sections
        re.compile(r'<(?:div|li|span)[^>]*class="[^"]*sponsor[^"]*"[^>]*>([^<]+)<', re.IGNORECASE),
        # Match image alt text (sponsor logos)
        re.compile(r'<img[^>]*alt="([^"]+)"[^>]*class="[^"]*sponsor[^"]*"', re.IGNORECASE),
        re.compile(r'<img[^>]*class="[^"]*sponsor[^"]*"[^>]*alt="([^"]+)"', re.IGNORECASE),
        # Match links with sponsor company names
        re.compile(r'<a[^>]*href="(https?://[^"]+)"[^>]*>([^<]+)</a>', re.IGNORECASE),
    ]

    found_companies = set()

    for pattern in sponsor_patterns:
        matches = pattern.findall(html)
        for match in matches:
            if isinstance(match, tuple):
                # Link pattern returns (url, name)
                company_url, company_name = match
            else:
                company_name = match
                company_url = None

            company_name = clean_html(company_name)
            company_name = extract_company_name(company_name)

            # Filter out non-company text
            if len(company_name) < 2 or len(company_name) > 100:
                continue
            if company_name.lower() in {"sponsor", "sponsors", "partner", "partners", "logo"}:
                continue

            if company_name not in found_companies:
                found_companies.add(company_name)
                sponsors.append({
                    "company": company_name,
                    "careers_url": company_url,
                    "source": "ghc_sponsors",
                    "sponsor_level": "unknown",
                })

    if not sponsors:
        # Fallback to known sponsors
        return _get_ghc_fallback_sponsors()

    print(f"Found {len(sponsors)} GHC sponsors")
    return sponsors


def _get_ghc_fallback_sponsors() -> list[dict]:
    """Return known GHC sponsors as fallback."""
    known_sponsors = [
        ("Google", "https://careers.google.com"),
        ("Microsoft", "https://careers.microsoft.com"),
        ("Amazon", "https://www.amazon.jobs"),
        ("Meta", "https://www.metacareers.com"),
        ("Apple", "https://jobs.apple.com"),
        ("Netflix", "https://jobs.netflix.com"),
        ("Salesforce", "https://careers.salesforce.com"),
        ("Adobe", "https://careers.adobe.com"),
        ("Intuit", "https://careers.intuit.com"),
        ("Bloomberg", "https://careers.bloomberg.com"),
        ("Goldman Sachs", "https://www.goldmansachs.com/careers"),
        ("JPMorgan Chase", "https://careers.jpmorgan.com"),
        ("Capital One", "https://www.capitalonecareers.com"),
        ("Stripe", "https://stripe.com/jobs"),
        ("Airbnb", "https://careers.airbnb.com"),
        ("Uber", "https://www.uber.com/careers"),
        ("Lyft", "https://www.lyft.com/careers"),
        ("Twitter", "https://careers.twitter.com"),
        ("LinkedIn", "https://careers.linkedin.com"),
        ("Snap Inc", "https://careers.snap.com"),
        ("Intel", "https://jobs.intel.com"),
        ("Nvidia", "https://nvidia.wd5.myworkdayjobs.com"),
        ("Qualcomm", "https://careers.qualcomm.com"),
        ("IBM", "https://careers.ibm.com"),
        ("Oracle", "https://careers.oracle.com"),
        ("Cisco", "https://jobs.cisco.com"),
        ("VMware", "https://careers.vmware.com"),
        ("ServiceNow", "https://careers.servicenow.com"),
        ("Atlassian", "https://www.atlassian.com/company/careers"),
        ("Databricks", "https://www.databricks.com/company/careers"),
        ("Snowflake", "https://careers.snowflake.com"),
        ("Palantir", "https://www.palantir.com/careers"),
        ("Twilio", "https://www.twilio.com/company/jobs"),
        ("MongoDB", "https://www.mongodb.com/careers"),
        ("Elastic", "https://www.elastic.co/careers"),
        ("Splunk", "https://www.splunk.com/careers"),
        ("DocuSign", "https://careers.docusign.com"),
        ("Okta", "https://www.okta.com/company/careers"),
        ("Zendesk", "https://www.zendesk.com/jobs"),
        ("HubSpot", "https://www.hubspot.com/careers"),
    ]

    return [
        {
            "company": company,
            "careers_url": url,
            "source": "ghc_sponsors",
            "sponsor_level": "known",
        }
        for company, url in known_sponsors
    ]


def fetch_nsbe_jobs() -> list[dict]:
    """Fetch jobs from NSBE (National Society of Black Engineers) career board.

    NSBE is the largest student-governed organization serving
    Black engineering students. Their career board features
    companies committed to diversity hiring.

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    jobs = []

    # NSBE career board base URL
    base_url = "https://career.nsbe.org"

    try:
        # Main jobs page
        response = _make_request(f"{base_url}/jobs")
        if response is None:
            return _get_nsbe_fallback_sponsors()
        response.raise_for_status()
        html = response.text
    except requests.RequestException as e:
        print(f"Error fetching NSBE jobs: {e}")
        return _get_nsbe_fallback_sponsors()

    # Parse job listings from HTML
    # NSBE uses a job board platform, jobs are usually in list/card format
    job_patterns = [
        # Match job cards/items
        re.compile(
            r'<a[^>]*href="(/jobs/[^"]+)"[^>]*>.*?'
            r'<(?:h\d|span)[^>]*class="[^"]*(?:title|job-title)[^"]*"[^>]*>([^<]+)</.*?'
            r'<(?:span|div)[^>]*class="[^"]*company[^"]*"[^>]*>([^<]+)<',
            re.DOTALL | re.IGNORECASE
        ),
        # Simpler pattern for job links
        re.compile(
            r'<a[^>]*href="(/jobs/\d+[^"]*)"[^>]*title="([^"]+)"',
            re.IGNORECASE
        ),
    ]

    found_jobs = set()

    for pattern in job_patterns:
        matches = pattern.findall(html)
        for match in matches:
            if len(match) >= 2:
                job_url = match[0]
                title = clean_html(match[1])
                company = clean_html(match[2]) if len(match) > 2 else ""

                if not job_url.startswith("http"):
                    job_url = f"{base_url}{job_url}"

                # Extract job ID from URL
                job_id_match = re.search(r'/jobs/(\d+)', job_url)
                job_id = job_id_match.group(1) if job_id_match else job_url

                if job_id not in found_jobs:
                    found_jobs.add(job_id)
                    jobs.append({
                        "company": company or "Unknown",
                        "title": title,
                        "location": "",
                        "url": job_url,
                        "posted": datetime.now().isoformat(),
                        "source": "nsbe_jobs",
                        "external_id": f"nsbe_{job_id}",
                        "remote": False,
                    })

    if not jobs:
        # Return fallback sponsors instead
        return _get_nsbe_fallback_sponsors()

    print(f"Found {len(jobs)} NSBE jobs")
    return jobs


def _get_nsbe_fallback_sponsors() -> list[dict]:
    """Return known NSBE sponsors/employers as fallback."""
    known_employers = [
        ("ExxonMobil", "https://corporate.exxonmobil.com/careers"),
        ("Chevron", "https://careers.chevron.com"),
        ("Shell", "https://www.shell.com/careers"),
        ("Lockheed Martin", "https://www.lockheedmartinjobs.com"),
        ("Boeing", "https://jobs.boeing.com"),
        ("Northrop Grumman", "https://www.northropgrumman.com/careers"),
        ("Raytheon", "https://careers.rtx.com"),
        ("General Dynamics", "https://www.gd.com/careers"),
        ("L3Harris", "https://careers.l3harris.com"),
        ("BAE Systems", "https://jobs.baesystems.com"),
        ("General Motors", "https://search-careers.gm.com"),
        ("Ford", "https://corporate.ford.com/careers"),
        ("Caterpillar", "https://careers.caterpillar.com"),
        ("Cummins", "https://www.cummins.com/careers"),
        ("3M", "https://www.3m.com/3M/en_US/careers-us"),
        ("Procter & Gamble", "https://www.pgcareers.com"),
        ("Johnson & Johnson", "https://www.careers.jnj.com"),
        ("Merck", "https://jobs.merck.com"),
        ("Pfizer", "https://careers.pfizer.com"),
        ("Dow", "https://careers.dow.com"),
        ("DuPont", "https://careers.dupont.com"),
        ("Texas Instruments", "https://careers.ti.com"),
        ("Applied Materials", "https://www.appliedmaterials.com/company/careers"),
        ("Micron", "https://www.micron.com/careers"),
        ("National Instruments", "https://www.ni.com/careers"),
    ]

    return [
        {
            "company": company,
            "title": f"Software Engineering at {company}",
            "location": "",
            "url": url,
            "posted": datetime.now().isoformat(),
            "source": "nsbe_sponsors",
            "external_id": f"nsbe_{company.lower().replace(' ', '_')}",
            "remote": False,
        }
        for company, url in known_employers
    ]


def fetch_shpe_jobs() -> list[dict]:
    """Fetch jobs from SHPE (Society of Hispanic Professional Engineers) job board.

    SHPE is the largest Hispanic STEM organization in the US.
    Their job board features opportunities from companies
    actively recruiting Hispanic engineers.

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    jobs = []

    # SHPE jobs board URL
    base_url = "https://jobs.shpe.org"

    try:
        response = _make_request(f"{base_url}/jobs")
        if response is None:
            return _get_shpe_fallback_sponsors()
        response.raise_for_status()
        html = response.text
    except requests.RequestException as e:
        print(f"Error fetching SHPE jobs: {e}")
        return _get_shpe_fallback_sponsors()

    # Parse job listings
    job_patterns = [
        # Common job board patterns
        re.compile(
            r'<a[^>]*href="(/jobs/[^"]+)"[^>]*>.*?'
            r'<(?:h\d|span|div)[^>]*>([^<]+)</.*?'
            r'company[^>]*>([^<]+)<',
            re.DOTALL | re.IGNORECASE
        ),
        # Link pattern
        re.compile(
            r'<a[^>]*href="(/jobs/[^"]+)"[^>]*>([^<]+)</a>',
            re.IGNORECASE
        ),
    ]

    found_jobs = set()

    for pattern in job_patterns:
        matches = pattern.findall(html)
        for match in matches:
            if len(match) >= 2:
                job_url = match[0]
                title = clean_html(match[1])
                company = clean_html(match[2]) if len(match) > 2 else ""

                if not job_url.startswith("http"):
                    job_url = f"{base_url}{job_url}"

                job_id_match = re.search(r'/jobs/(\d+)', job_url)
                job_id = job_id_match.group(1) if job_id_match else job_url

                if job_id not in found_jobs:
                    found_jobs.add(job_id)
                    jobs.append({
                        "company": company or "Unknown",
                        "title": title,
                        "location": "",
                        "url": job_url,
                        "posted": datetime.now().isoformat(),
                        "source": "shpe_jobs",
                        "external_id": f"shpe_{job_id}",
                        "remote": False,
                    })

    if not jobs:
        return _get_shpe_fallback_sponsors()

    print(f"Found {len(jobs)} SHPE jobs")
    return jobs


def _get_shpe_fallback_sponsors() -> list[dict]:
    """Return known SHPE sponsors/employers as fallback."""
    known_employers = [
        ("Microsoft", "https://careers.microsoft.com"),
        ("Google", "https://careers.google.com"),
        ("Meta", "https://www.metacareers.com"),
        ("Apple", "https://jobs.apple.com"),
        ("Amazon", "https://www.amazon.jobs"),
        ("Intel", "https://jobs.intel.com"),
        ("Qualcomm", "https://careers.qualcomm.com"),
        ("Cisco", "https://jobs.cisco.com"),
        ("Tesla", "https://www.tesla.com/careers"),
        ("SpaceX", "https://www.spacex.com/careers"),
        ("Lockheed Martin", "https://www.lockheedmartinjobs.com"),
        ("Boeing", "https://jobs.boeing.com"),
        ("Raytheon", "https://careers.rtx.com"),
        ("NASA", "https://nasajobs.nasa.gov"),
        ("JPL", "https://www.jpl.nasa.gov/careers"),
        ("Sandia National Labs", "https://www.sandia.gov/careers"),
        ("Los Alamos National Lab", "https://www.lanl.gov/careers"),
        ("NVIDIA", "https://nvidia.wd5.myworkdayjobs.com"),
        ("AMD", "https://careers.amd.com"),
        ("Texas Instruments", "https://careers.ti.com"),
        ("Broadcom", "https://www.broadcom.com/company/careers"),
        ("Analog Devices", "https://careers.analog.com"),
        ("Deloitte", "https://www2.deloitte.com/us/en/careers"),
        ("Accenture", "https://www.accenture.com/us-en/careers"),
        ("McKinsey", "https://www.mckinsey.com/careers"),
    ]

    return [
        {
            "company": company,
            "title": f"Software Engineering at {company}",
            "location": "",
            "url": url,
            "posted": datetime.now().isoformat(),
            "source": "shpe_sponsors",
            "external_id": f"shpe_{company.lower().replace(' ', '_')}",
            "remote": False,
        }
        for company, url in known_employers
    ]


def fetch_afrotech_jobs() -> list[dict]:
    """Fetch jobs from AfroTech career fair.

    AfroTech is a large tech conference for Black professionals.
    Their career fair features top tech companies actively
    recruiting Black engineers and technologists.

    Returns:
        List of job dicts with keys: company, title, location, url, posted, source, external_id
    """
    jobs = []

    # AfroTech career page
    url = "https://afrotech.com/career-fair"

    try:
        response = _make_request(url)
        if response is None:
            return _get_afrotech_fallback_sponsors()
        response.raise_for_status()
        html = response.text
    except requests.RequestException as e:
        print(f"Error fetching AfroTech jobs: {e}")
        return _get_afrotech_fallback_sponsors()

    # Parse exhibitor/company listings
    company_patterns = [
        # Company cards/listings
        re.compile(
            r'<(?:div|article)[^>]*class="[^"]*(?:company|exhibitor|sponsor)[^"]*"[^>]*>.*?'
            r'<(?:h\d|span|a)[^>]*>([^<]+)</.*?'
            r'(?:href="(https?://[^"]+)")?',
            re.DOTALL | re.IGNORECASE
        ),
        # Company logos with links
        re.compile(
            r'<a[^>]*href="(https?://[^"]+)"[^>]*>.*?'
            r'<img[^>]*alt="([^"]+)"[^>]*>',
            re.DOTALL | re.IGNORECASE
        ),
        # Simple company name extraction
        re.compile(
            r'data-company="([^"]+)"',
            re.IGNORECASE
        ),
    ]

    found_companies = set()

    for pattern in company_patterns:
        matches = pattern.findall(html)
        for match in matches:
            if isinstance(match, tuple):
                if len(match) >= 2:
                    company_name = match[1] if match[0].startswith("http") else match[0]
                    company_url = match[0] if match[0].startswith("http") else None
                else:
                    company_name = match[0]
                    company_url = None
            else:
                company_name = match
                company_url = None

            company_name = clean_html(company_name)
            company_name = extract_company_name(company_name)

            if len(company_name) < 2 or len(company_name) > 100:
                continue

            if company_name not in found_companies:
                found_companies.add(company_name)
                jobs.append({
                    "company": company_name,
                    "title": f"Software Engineering at {company_name}",
                    "location": "",
                    "url": company_url or f"https://afrotech.com/career-fair",
                    "posted": datetime.now().isoformat(),
                    "source": "afrotech_careers",
                    "external_id": f"afrotech_{company_name.lower().replace(' ', '_')}",
                    "remote": False,
                })

    if not jobs:
        return _get_afrotech_fallback_sponsors()

    print(f"Found {len(jobs)} AfroTech exhibitors")
    return jobs


def _get_afrotech_fallback_sponsors() -> list[dict]:
    """Return known AfroTech sponsors/exhibitors as fallback."""
    known_exhibitors = [
        ("Google", "https://careers.google.com"),
        ("Microsoft", "https://careers.microsoft.com"),
        ("Meta", "https://www.metacareers.com"),
        ("Amazon", "https://www.amazon.jobs"),
        ("Apple", "https://jobs.apple.com"),
        ("Netflix", "https://jobs.netflix.com"),
        ("Spotify", "https://www.lifeatspotify.com"),
        ("Twitter", "https://careers.twitter.com"),
        ("Block", "https://block.xyz/careers"),
        ("Stripe", "https://stripe.com/jobs"),
        ("Airbnb", "https://careers.airbnb.com"),
        ("Uber", "https://www.uber.com/careers"),
        ("Lyft", "https://www.lyft.com/careers"),
        ("DoorDash", "https://careers.doordash.com"),
        ("Instacart", "https://instacart.careers"),
        ("Robinhood", "https://careers.robinhood.com"),
        ("Coinbase", "https://www.coinbase.com/careers"),
        ("Figma", "https://www.figma.com/careers"),
        ("Notion", "https://www.notion.so/careers"),
        ("Slack", "https://slack.com/careers"),
        ("Zoom", "https://careers.zoom.us"),
        ("Salesforce", "https://careers.salesforce.com"),
        ("Adobe", "https://careers.adobe.com"),
        ("Intuit", "https://careers.intuit.com"),
        ("PayPal", "https://careers.paypal.com"),
        ("Visa", "https://usa.visa.com/careers"),
        ("Mastercard", "https://www.mastercard.us/en-us/careers"),
        ("Goldman Sachs", "https://www.goldmansachs.com/careers"),
        ("JPMorgan Chase", "https://careers.jpmorgan.com"),
        ("Morgan Stanley", "https://www.morganstanley.com/careers"),
        ("BlackRock", "https://careers.blackrock.com"),
        ("Citadel", "https://www.citadel.com/careers"),
        ("Two Sigma", "https://www.twosigma.com/careers"),
        ("Dropbox", "https://www.dropbox.com/jobs"),
        ("Box", "https://www.box.com/careers"),
        ("Asana", "https://asana.com/jobs"),
        ("Airtable", "https://airtable.com/careers"),
        ("Canva", "https://www.canva.com/careers"),
        ("Reddit", "https://www.redditinc.com/careers"),
        ("Pinterest", "https://www.pinterestcareers.com"),
    ]

    return [
        {
            "company": company,
            "title": f"Software Engineering at {company}",
            "location": "",
            "url": url,
            "posted": datetime.now().isoformat(),
            "source": "afrotech_sponsors",
            "external_id": f"afrotech_{company.lower().replace(' ', '_')}",
            "remote": False,
        }
        for company, url in known_exhibitors
    ]


def fetch_all_conference_jobs() -> list[dict]:
    """Fetch jobs/sponsors from all diversity conferences.

    Combines results from GHC, NSBE, SHPE, and AfroTech.

    Returns:
        Combined list of jobs/sponsors from all conferences
    """
    # Use monitoring if available
    if INFRA_AVAILABLE:
        ctx = monitor_scraper("conference_jobs")
    else:
        ctx = None

    try:
        if ctx:
            ctx.__enter__()

        all_jobs = []

        print("Fetching GHC sponsors...")
        ghc_sponsors = fetch_ghc_sponsors()
        # Convert sponsors to job-like format
        for sponsor in ghc_sponsors:
            all_jobs.append({
                "company": sponsor["company"],
                "title": f"Software Engineering at {sponsor['company']}",
                "location": "",
                "url": sponsor.get("careers_url") or f"https://www.google.com/search?q={sponsor['company']}+careers",
                "posted": datetime.now().isoformat(),
                "source": sponsor["source"],
                "external_id": f"ghc_{sponsor['company'].lower().replace(' ', '_')}",
                "remote": False,
            })

        print("Fetching NSBE jobs...")
        nsbe_jobs = fetch_nsbe_jobs()
        all_jobs.extend(nsbe_jobs)

        print("Fetching SHPE jobs...")
        shpe_jobs = fetch_shpe_jobs()
        all_jobs.extend(shpe_jobs)

        print("Fetching AfroTech jobs...")
        afrotech_jobs = fetch_afrotech_jobs()
        all_jobs.extend(afrotech_jobs)

        # Deduplicate by company name
        seen_companies = set()
        unique_jobs = []
        for job in all_jobs:
            company_key = job["company"].lower().strip()
            if company_key not in seen_companies:
                seen_companies.add(company_key)
                unique_jobs.append(job)

        # Record metrics if monitoring available
        if ctx:
            ctx.record_questions(extracted=len(unique_jobs), new=len(unique_jobs))

        print(f"Total unique conference jobs/sponsors: {len(unique_jobs)}")
        return unique_jobs

    finally:
        if ctx:
            ctx.__exit__(None, None, None)
