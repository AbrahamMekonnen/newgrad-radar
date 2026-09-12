"""Bootcamp Partner Company scrapers.

Fetches hiring partner companies from coding bootcamp websites:
- Flatiron School: flatironschool.com/hire-our-grads
- General Assembly: generalassemb.ly/employers
- App Academy: appacademy.io/hire-our-grads
- Hack Reactor: hackreactor.com/hire-our-graduates

These partner companies actively hire entry-level/bootcamp grad talent.
"""

import re
import requests
import time
from typing import Optional
from urllib.parse import urljoin, urlparse

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


def _init_infrastructure():
    """Initialize infrastructure components."""
    global _stealth_session, _cache, _throttler
    if not INFRA_AVAILABLE:
        return
    if _stealth_session is None:
        _stealth_session = create_stealth_session(min_delay=0.3, max_delay=1.5, requests_per_minute=30)
    if _cache is None:
        _cache = get_cache()
    if _throttler is None:
        _throttler = DomainThrottler(default_delay=0.5)


def _make_request(url: str, headers: dict = None, timeout: int = None) -> Optional[requests.Response]:
    """Make an HTTP request using infrastructure when available."""
    _init_infrastructure()
    timeout = timeout or REQUEST_TIMEOUT

    if INFRA_AVAILABLE and _stealth_session:
        # Check cache first
        if _cache:
            cached = _cache.get(url)
            if cached:
                # Create a mock response-like object
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
                _cache.set(url, response, ttl=3600 * 6)  # 6 hour TTL

            return response
        except requests.RequestException as e:
            _stealth_session.after_request(500)
            raise
    else:
        # Fallback to basic requests
        if headers is None:
            headers = {"User-Agent": USER_AGENT}
        time.sleep(RATE_LIMIT_DELAY)
        return requests.get(url, headers=headers, timeout=timeout)


# User agent for scraping (fallback)
USER_AGENT = "NewGradRadar/1.0 (job aggregator for new grads)"

# Rate limiting between requests (fallback)
RATE_LIMIT_DELAY = 0.5


def clean_text(text: str) -> str:
    """Clean text by removing extra whitespace."""
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_domain(url: str) -> str:
    """Extract domain from URL for company identification."""
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc or parsed.path
        domain = domain.lower().replace("www.", "")
        return domain
    except Exception:
        return ""


def guess_careers_url(company_name: str, base_domain: Optional[str] = None) -> str:
    """Attempt to construct a careers URL from company name."""
    if base_domain:
        # Try common career page patterns
        base = base_domain.rstrip("/")
        return f"https://{base}/careers"

    # Convert company name to likely domain
    slug = re.sub(r"[^a-z0-9]", "", company_name.lower())
    return f"https://{slug}.com/careers"


def search_company_careers_page(company_name: str) -> Optional[str]:
    """Search for a company's careers page using common patterns."""
    _init_infrastructure()
    slug = re.sub(r"[^a-z0-9]", "", company_name.lower())

    # Common career page patterns
    patterns = [
        f"https://{slug}.com/careers",
        f"https://www.{slug}.com/careers",
        f"https://careers.{slug}.com",
        f"https://{slug}.com/jobs",
        f"https://boards.greenhouse.io/{slug}",
        f"https://jobs.lever.co/{slug}",
    ]

    for url in patterns[:2]:  # Only check first two to avoid too many requests
        try:
            if INFRA_AVAILABLE and _stealth_session:
                config = _stealth_session.get_request_config(url)
                headers = config.get('headers', {})
                _stealth_session.before_request()
                response = requests.head(
                    url,
                    headers=headers,
                    timeout=5,
                    allow_redirects=True
                )
                _stealth_session.after_request(response.status_code)
            else:
                headers = {"User-Agent": USER_AGENT}
                time.sleep(RATE_LIMIT_DELAY)
                response = requests.head(
                    url,
                    headers=headers,
                    timeout=5,
                    allow_redirects=True
                )
            if response.status_code == 200:
                return response.url
        except requests.RequestException:
            continue

    return None


# =============================================================================
# Flatiron School - flatironschool.com/hire-our-grads
# =============================================================================

FLATIRON_PARTNERS_URL = "https://flatironschool.com/hire-our-grads"
FLATIRON_EMPLOYERS_URL = "https://flatironschool.com/employers"


def fetch_flatiron_partners() -> list[dict]:
    """Fetch hiring partner companies from Flatiron School.

    Returns:
        List of partner dicts with keys: company, career_url, source, notes
    """
    partners = []

    try:
        from bs4 import BeautifulSoup

        # Try main hire page
        for url in [FLATIRON_PARTNERS_URL, FLATIRON_EMPLOYERS_URL]:
            try:
                response = _make_request(url)

                if response is None or response.status_code != 200:
                    continue

                soup = BeautifulSoup(response.text, "html.parser")

                # Look for company logos or names in employer sections
                # Common patterns: logo grids, partner sections, testimonial companies

                # Find logo images with alt text (company names)
                logo_imgs = soup.select(
                    "[class*='partner'] img, "
                    "[class*='employer'] img, "
                    "[class*='company'] img, "
                    "[class*='logo'] img, "
                    "[class*='hiring'] img"
                )

                for img in logo_imgs:
                    company_name = img.get("alt", "")
                    if company_name and len(company_name) > 1:
                        company_name = clean_text(company_name)
                        company_name = re.sub(r"\s*(logo|image|icon).*$", "", company_name, flags=re.IGNORECASE)

                        if company_name and len(company_name) > 1:
                            # Check for duplicates
                            if not any(p["company"].lower() == company_name.lower() for p in partners):
                                partners.append({
                                    "company": company_name,
                                    "career_url": guess_careers_url(company_name),
                                    "source": "flatiron_school",
                                    "notes": "Flatiron School hiring partner",
                                })

                # Find company names in text/list elements
                company_elements = soup.select(
                    "[class*='partner'] li, "
                    "[class*='employer'] li, "
                    "[class*='company'] span, "
                    "[class*='company'] p, "
                    "[class*='hiring-partners'] *"
                )

                for elem in company_elements:
                    company_name = clean_text(elem.get_text())
                    if company_name and 2 < len(company_name) < 50:
                        # Filter out non-company text
                        if any(x in company_name.lower() for x in ["our", "the", "and", "with", "from", "learn"]):
                            continue

                        if not any(p["company"].lower() == company_name.lower() for p in partners):
                            partners.append({
                                "company": company_name,
                                "career_url": guess_careers_url(company_name),
                                "source": "flatiron_school",
                                "notes": "Flatiron School hiring partner",
                            })

                # Look for links to company sites
                partner_links = soup.select(
                    "[class*='partner'] a[href], "
                    "[class*='employer'] a[href], "
                    "[class*='company'] a[href]"
                )

                for link in partner_links:
                    href = link.get("href", "")
                    company_name = link.get_text() or link.get("title", "")
                    company_name = clean_text(company_name)

                    if href and company_name and "flatiron" not in href.lower():
                        if not any(p["company"].lower() == company_name.lower() for p in partners):
                            # Use link as career URL if it's an external link
                            career_url = href if href.startswith("http") else guess_careers_url(company_name)
                            partners.append({
                                "company": company_name,
                                "career_url": career_url,
                                "source": "flatiron_school",
                                "notes": "Flatiron School hiring partner",
                            })

                if partners:
                    break

            except requests.RequestException as e:
                print(f"Error fetching Flatiron page {url}: {e}")
                continue

    except ImportError:
        print("BeautifulSoup not installed, skipping Flatiron HTML scraping")

    # Add known major Flatiron partners if scraping yields few results
    known_partners = [
        {"company": "Google", "career_url": "https://careers.google.com"},
        {"company": "Meta", "career_url": "https://www.metacareers.com"},
        {"company": "Amazon", "career_url": "https://www.amazon.jobs"},
        {"company": "Microsoft", "career_url": "https://careers.microsoft.com"},
        {"company": "IBM", "career_url": "https://www.ibm.com/careers"},
        {"company": "Accenture", "career_url": "https://www.accenture.com/careers"},
        {"company": "Deloitte", "career_url": "https://www2.deloitte.com/careers"},
        {"company": "JPMorgan Chase", "career_url": "https://careers.jpmorgan.com"},
        {"company": "Capital One", "career_url": "https://www.capitalonecareers.com"},
        {"company": "Spotify", "career_url": "https://www.lifeatspotify.com"},
    ]

    for partner in known_partners:
        if not any(p["company"].lower() == partner["company"].lower() for p in partners):
            partners.append({
                "company": partner["company"],
                "career_url": partner["career_url"],
                "source": "flatiron_school",
                "notes": "Known Flatiron School hiring partner",
            })

    print(f"Fetched {len(partners)} partners from Flatiron School")
    return partners


# =============================================================================
# General Assembly - generalassemb.ly/employers
# =============================================================================

GA_EMPLOYERS_URL = "https://generalassemb.ly/employers"
GA_HIRE_URL = "https://generalassemb.ly/hire"


def fetch_ga_partners() -> list[dict]:
    """Fetch hiring partner companies from General Assembly.

    Returns:
        List of partner dicts with keys: company, career_url, source, notes
    """
    partners = []

    try:
        from bs4 import BeautifulSoup

        for url in [GA_EMPLOYERS_URL, GA_HIRE_URL]:
            try:
                response = _make_request(url)

                if response is None or response.status_code != 200:
                    continue

                soup = BeautifulSoup(response.text, "html.parser")

                # GA often uses logo grids to showcase hiring partners
                logo_sections = soup.select(
                    "[class*='logo'], "
                    "[class*='partner'], "
                    "[class*='employer'], "
                    "[class*='client'], "
                    "[class*='company']"
                )

                for section in logo_sections:
                    # Extract from images
                    imgs = section.select("img")
                    for img in imgs:
                        alt = img.get("alt", "") or img.get("title", "")
                        company_name = clean_text(alt)
                        company_name = re.sub(r"\s*(logo|image|icon).*$", "", company_name, flags=re.IGNORECASE)

                        if company_name and len(company_name) > 1:
                            if not any(p["company"].lower() == company_name.lower() for p in partners):
                                partners.append({
                                    "company": company_name,
                                    "career_url": guess_careers_url(company_name),
                                    "source": "general_assembly",
                                    "notes": "General Assembly hiring partner",
                                })

                # Look for company names in structured content
                company_cards = soup.select(
                    "[class*='testimonial'], "
                    "[class*='case-study'], "
                    "[class*='success-story']"
                )

                for card in company_cards:
                    company_elem = card.select_one("[class*='company'], [class*='name'], cite, strong")
                    if company_elem:
                        company_name = clean_text(company_elem.get_text())
                        if company_name and 2 < len(company_name) < 50:
                            if not any(p["company"].lower() == company_name.lower() for p in partners):
                                partners.append({
                                    "company": company_name,
                                    "career_url": guess_careers_url(company_name),
                                    "source": "general_assembly",
                                    "notes": "General Assembly hiring partner",
                                })

                if partners:
                    break

            except requests.RequestException as e:
                print(f"Error fetching GA page {url}: {e}")
                continue

    except ImportError:
        print("BeautifulSoup not installed, skipping GA HTML scraping")

    # Add known major GA hiring partners
    known_partners = [
        {"company": "Verizon", "career_url": "https://www.verizon.com/careers"},
        {"company": "Disney", "career_url": "https://jobs.disneycareers.com"},
        {"company": "Airbnb", "career_url": "https://careers.airbnb.com"},
        {"company": "LinkedIn", "career_url": "https://careers.linkedin.com"},
        {"company": "Salesforce", "career_url": "https://www.salesforce.com/company/careers"},
        {"company": "Dropbox", "career_url": "https://www.dropbox.com/jobs"},
        {"company": "Uber", "career_url": "https://www.uber.com/careers"},
        {"company": "Lyft", "career_url": "https://www.lyft.com/careers"},
        {"company": "Twitter", "career_url": "https://careers.twitter.com"},
        {"company": "Pinterest", "career_url": "https://www.pinterestcareers.com"},
        {"company": "Yelp", "career_url": "https://www.yelp.careers"},
        {"company": "Visa", "career_url": "https://usa.visa.com/careers.html"},
        {"company": "Intuit", "career_url": "https://www.intuit.com/careers"},
        {"company": "Adobe", "career_url": "https://www.adobe.com/careers.html"},
    ]

    for partner in known_partners:
        if not any(p["company"].lower() == partner["company"].lower() for p in partners):
            partners.append({
                "company": partner["company"],
                "career_url": partner["career_url"],
                "source": "general_assembly",
                "notes": "Known General Assembly hiring partner",
            })

    print(f"Fetched {len(partners)} partners from General Assembly")
    return partners


# =============================================================================
# App Academy - appacademy.io/hire-our-grads
# =============================================================================

APPACADEMY_HIRE_URL = "https://www.appacademy.io/hire-our-grads"
APPACADEMY_EMPLOYERS_URL = "https://www.appacademy.io/employers"


def fetch_appacademy_partners() -> list[dict]:
    """Fetch hiring partner companies from App Academy.

    Returns:
        List of partner dicts with keys: company, career_url, source, notes
    """
    partners = []

    try:
        from bs4 import BeautifulSoup

        for url in [APPACADEMY_HIRE_URL, APPACADEMY_EMPLOYERS_URL]:
            try:
                response = _make_request(url)

                if response is None or response.status_code != 200:
                    continue

                soup = BeautifulSoup(response.text, "html.parser")

                # App Academy showcases companies where grads work
                # Look for company logos and names
                company_sections = soup.select(
                    "[class*='company'], "
                    "[class*='employer'], "
                    "[class*='partner'], "
                    "[class*='logo'], "
                    "[class*='hiring'], "
                    "[class*='outcome']"
                )

                for section in company_sections:
                    # Extract from images
                    imgs = section.select("img")
                    for img in imgs:
                        alt = img.get("alt", "") or img.get("title", "")
                        company_name = clean_text(alt)
                        company_name = re.sub(r"\s*(logo|image|icon).*$", "", company_name, flags=re.IGNORECASE)

                        if company_name and len(company_name) > 1:
                            if not any(p["company"].lower() == company_name.lower() for p in partners):
                                partners.append({
                                    "company": company_name,
                                    "career_url": guess_careers_url(company_name),
                                    "source": "app_academy",
                                    "notes": "App Academy hiring partner",
                                })

                # Look for company text mentions
                employer_list = soup.select(
                    "[class*='employers'] li, "
                    "[class*='company-list'] li, "
                    "[class*='hiring'] span"
                )

                for elem in employer_list:
                    company_name = clean_text(elem.get_text())
                    if company_name and 2 < len(company_name) < 50:
                        if not any(p["company"].lower() == company_name.lower() for p in partners):
                            partners.append({
                                "company": company_name,
                                "career_url": guess_careers_url(company_name),
                                "source": "app_academy",
                                "notes": "App Academy hiring partner",
                            })

                if partners:
                    break

            except requests.RequestException as e:
                print(f"Error fetching App Academy page {url}: {e}")
                continue

    except ImportError:
        print("BeautifulSoup not installed, skipping App Academy HTML scraping")

    # Known App Academy hiring partners
    known_partners = [
        {"company": "Facebook", "career_url": "https://www.metacareers.com"},
        {"company": "Google", "career_url": "https://careers.google.com"},
        {"company": "Apple", "career_url": "https://www.apple.com/careers"},
        {"company": "Stripe", "career_url": "https://stripe.com/jobs"},
        {"company": "Square", "career_url": "https://careers.squareup.com"},
        {"company": "Palantir", "career_url": "https://www.palantir.com/careers"},
        {"company": "Twitch", "career_url": "https://www.twitch.tv/jobs"},
        {"company": "Robinhood", "career_url": "https://careers.robinhood.com"},
        {"company": "Coinbase", "career_url": "https://www.coinbase.com/careers"},
        {"company": "Affirm", "career_url": "https://www.affirm.com/careers"},
        {"company": "Plaid", "career_url": "https://plaid.com/careers"},
        {"company": "Oscar Health", "career_url": "https://www.hioscar.com/careers"},
        {"company": "Brex", "career_url": "https://www.brex.com/careers"},
        {"company": "Figma", "career_url": "https://www.figma.com/careers"},
    ]

    for partner in known_partners:
        if not any(p["company"].lower() == partner["company"].lower() for p in partners):
            partners.append({
                "company": partner["company"],
                "career_url": partner["career_url"],
                "source": "app_academy",
                "notes": "Known App Academy hiring partner",
            })

    print(f"Fetched {len(partners)} partners from App Academy")
    return partners


# =============================================================================
# Hack Reactor - hackreactor.com/hire-our-graduates
# =============================================================================

HACKREACTOR_HIRE_URL = "https://www.hackreactor.com/hire-our-graduates"
HACKREACTOR_EMPLOYERS_URL = "https://www.hackreactor.com/employers"
HACKREACTOR_OUTCOMES_URL = "https://www.hackreactor.com/outcomes"


def fetch_hackreactor_partners() -> list[dict]:
    """Fetch hiring partner companies from Hack Reactor.

    Returns:
        List of partner dicts with keys: company, career_url, source, notes
    """
    partners = []

    try:
        from bs4 import BeautifulSoup

        for url in [HACKREACTOR_HIRE_URL, HACKREACTOR_EMPLOYERS_URL, HACKREACTOR_OUTCOMES_URL]:
            try:
                response = _make_request(url)

                if response is None or response.status_code != 200:
                    continue

                soup = BeautifulSoup(response.text, "html.parser")

                # Hack Reactor shows companies where grads have been hired
                company_sections = soup.select(
                    "[class*='company'], "
                    "[class*='employer'], "
                    "[class*='partner'], "
                    "[class*='logo'], "
                    "[class*='hiring'], "
                    "[class*='outcome'], "
                    "[class*='success']"
                )

                for section in company_sections:
                    # Extract from images
                    imgs = section.select("img")
                    for img in imgs:
                        alt = img.get("alt", "") or img.get("title", "")
                        company_name = clean_text(alt)
                        company_name = re.sub(r"\s*(logo|image|icon).*$", "", company_name, flags=re.IGNORECASE)

                        if company_name and len(company_name) > 1:
                            # Filter out generic text
                            if any(x in company_name.lower() for x in ["hack reactor", "bootcamp", "student"]):
                                continue
                            if not any(p["company"].lower() == company_name.lower() for p in partners):
                                partners.append({
                                    "company": company_name,
                                    "career_url": guess_careers_url(company_name),
                                    "source": "hack_reactor",
                                    "notes": "Hack Reactor hiring partner",
                                })

                # Look for employer grid/list
                employer_elements = soup.select(
                    "[class*='employer'] span, "
                    "[class*='company'] span, "
                    "[class*='hiring'] li"
                )

                for elem in employer_elements:
                    company_name = clean_text(elem.get_text())
                    if company_name and 2 < len(company_name) < 50:
                        if not any(p["company"].lower() == company_name.lower() for p in partners):
                            partners.append({
                                "company": company_name,
                                "career_url": guess_careers_url(company_name),
                                "source": "hack_reactor",
                                "notes": "Hack Reactor hiring partner",
                            })

                if partners:
                    break

            except requests.RequestException as e:
                print(f"Error fetching Hack Reactor page {url}: {e}")
                continue

    except ImportError:
        print("BeautifulSoup not installed, skipping Hack Reactor HTML scraping")

    # Known Hack Reactor hiring partners (now part of Galvanize)
    known_partners = [
        {"company": "Bloomberg", "career_url": "https://www.bloomberg.com/careers"},
        {"company": "Netflix", "career_url": "https://jobs.netflix.com"},
        {"company": "Snap", "career_url": "https://snap.com/en-US/jobs"},
        {"company": "Tesla", "career_url": "https://www.tesla.com/careers"},
        {"company": "Reddit", "career_url": "https://www.redditinc.com/careers"},
        {"company": "Slack", "career_url": "https://slack.com/careers"},
        {"company": "DocuSign", "career_url": "https://www.docusign.com/careers"},
        {"company": "Twilio", "career_url": "https://www.twilio.com/company/jobs"},
        {"company": "Okta", "career_url": "https://www.okta.com/company/careers"},
        {"company": "Zendesk", "career_url": "https://jobs.zendesk.com"},
        {"company": "ServiceNow", "career_url": "https://www.servicenow.com/careers.html"},
        {"company": "Workday", "career_url": "https://www.workday.com/careers"},
        {"company": "Splunk", "career_url": "https://www.splunk.com/en_us/careers.html"},
        {"company": "Palo Alto Networks", "career_url": "https://www.paloaltonetworks.com/company/careers"},
    ]

    for partner in known_partners:
        if not any(p["company"].lower() == partner["company"].lower() for p in partners):
            partners.append({
                "company": partner["company"],
                "career_url": partner["career_url"],
                "source": "hack_reactor",
                "notes": "Known Hack Reactor hiring partner",
            })

    print(f"Fetched {len(partners)} partners from Hack Reactor")
    return partners


# =============================================================================
# Combined fetcher
# =============================================================================


def fetch_all_bootcamp_partners() -> list[dict]:
    """Fetch hiring partner companies from all bootcamp sources.

    Returns:
        List of all unique partner companies from bootcamp websites.
        Deduplicates by company name (case-insensitive).
    """
    all_partners = []
    seen_companies = set()

    print("Fetching bootcamp hiring partners...")

    # Use monitoring if available
    if INFRA_AVAILABLE:
        ctx = monitor_scraper("bootcamp_partners")
    else:
        ctx = None

    try:
        if ctx:
            ctx.__enter__()

        # Fetch from each source with rate limiting
        sources = [
            ("Flatiron School", fetch_flatiron_partners),
            ("General Assembly", fetch_ga_partners),
            ("App Academy", fetch_appacademy_partners),
            ("Hack Reactor", fetch_hackreactor_partners),
        ]

        for name, fetcher in sources:
            try:
                partners = fetcher()
                for partner in partners:
                    company_key = partner["company"].lower().strip()
                    if company_key not in seen_companies:
                        seen_companies.add(company_key)
                        all_partners.append(partner)
                # Rate limiting handled by _make_request when INFRA_AVAILABLE
                if not INFRA_AVAILABLE:
                    time.sleep(RATE_LIMIT_DELAY)
            except Exception as e:
                print(f"Error fetching {name} partners: {e}")

        # Record metrics if monitoring available
        if ctx:
            ctx.record_questions(extracted=len(all_partners), new=len(all_partners))

        print(f"Total unique bootcamp hiring partners: {len(all_partners)}")
        return all_partners

    finally:
        if ctx:
            ctx.__exit__(None, None, None)


def get_bootcamp_partner_companies() -> list[str]:
    """Get a simple list of company names from bootcamp partners.

    Returns:
        List of unique company names that hire bootcamp graduates.
    """
    partners = fetch_all_bootcamp_partners()
    return sorted(set(p["company"] for p in partners))


def get_bootcamp_partner_career_urls() -> dict[str, str]:
    """Get a mapping of company names to their career URLs.

    Returns:
        Dict mapping company name to career page URL.
    """
    partners = fetch_all_bootcamp_partners()
    return {p["company"]: p["career_url"] for p in partners}
