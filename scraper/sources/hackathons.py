"""Hackathon sponsor scrapers for discovering new grad-friendly companies.

Hackathon sponsors actively recruit new grads and interns. This module scrapes:
- MLH (Major League Hacking) partner companies
- Devpost company sponsors
- Major hackathon sponsor pages (HackMIT, TreeHacks, PennApps)
"""

import re
import requests
import time
from typing import Optional
from urllib.parse import urljoin, urlparse
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
                return CachedResponse(cached.content, cached.status_code)

        # Use stealth session
        if accept_json:
            config = _stealth_session.get_request_config(url)
            req_headers = config.get('headers', {})
            req_headers['Accept'] = 'application/json'
        else:
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
        default_headers = {
            "User-Agent": "Mozilla/5.0 (compatible; JobRadar/1.0; +https://github.com)",
        }
        if accept_json:
            default_headers["Accept"] = "application/json"
        if headers:
            default_headers.update(headers)
        time.sleep(RATE_LIMIT_DELAY)
        return requests.get(url, headers=default_headers, timeout=timeout)

# Known ATS mappings for common hackathon sponsors
# Maps company name (lowercase) to ATS info
KNOWN_SPONSOR_ATS = {
    # MLH Partners
    "github": {"ats_type": "greenhouse", "ats_token": "github", "careers_url": "https://github.com/about/careers"},
    "microsoft": {"ats_type": "custom", "ats_token": None, "careers_url": "https://careers.microsoft.com"},
    "google": {"ats_type": "custom", "ats_token": None, "careers_url": "https://careers.google.com"},
    "meta": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.metacareers.com"},
    "amazon": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.amazon.jobs"},
    "aws": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.amazon.jobs/en/teams/amazon-web-services"},
    "digitalocean": {"ats_type": "greenhouse", "ats_token": "digitalocean", "careers_url": "https://www.digitalocean.com/careers"},
    "twilio": {"ats_type": "greenhouse", "ats_token": "twilio", "careers_url": "https://www.twilio.com/company/jobs"},
    "mongodb": {"ats_type": "greenhouse", "ats_token": "mongodb", "careers_url": "https://www.mongodb.com/careers"},
    "cockroach labs": {"ats_type": "greenhouse", "ats_token": "cockroachlabs", "careers_url": "https://www.cockroachlabs.com/careers"},
    "cockroachlabs": {"ats_type": "greenhouse", "ats_token": "cockroachlabs", "careers_url": "https://www.cockroachlabs.com/careers"},
    "wolfram": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.wolfram.com/company/careers"},
    "balsamiq": {"ats_type": "custom", "ats_token": None, "careers_url": "https://balsamiq.com/company/jobs"},
    "auth0": {"ats_type": "greenhouse", "ats_token": "auth0", "careers_url": "https://auth0.com/careers"},
    "stripe": {"ats_type": "greenhouse", "ats_token": "stripe", "careers_url": "https://stripe.com/jobs"},
    "figma": {"ats_type": "greenhouse", "ats_token": "figma", "careers_url": "https://www.figma.com/careers"},
    "notion": {"ats_type": "greenhouse", "ats_token": "notion", "careers_url": "https://www.notion.so/careers"},
    "vercel": {"ats_type": "greenhouse", "ats_token": "vercel", "careers_url": "https://vercel.com/careers"},
    "cloudflare": {"ats_type": "greenhouse", "ats_token": "cloudflare", "careers_url": "https://www.cloudflare.com/careers"},
    "databricks": {"ats_type": "greenhouse", "ats_token": "databricks", "careers_url": "https://www.databricks.com/company/careers"},
    "datadog": {"ats_type": "greenhouse", "ats_token": "datadog", "careers_url": "https://www.datadoghq.com/careers"},
    "elastic": {"ats_type": "greenhouse", "ats_token": "elastic", "careers_url": "https://www.elastic.co/careers"},
    "postman": {"ats_type": "greenhouse", "ats_token": "postman", "careers_url": "https://www.postman.com/company/careers"},
    "retool": {"ats_type": "greenhouse", "ats_token": "retool", "careers_url": "https://retool.com/careers"},
    "supabase": {"ats_type": "ashby", "ats_token": "supabase", "careers_url": "https://supabase.com/careers"},
    "netlify": {"ats_type": "greenhouse", "ats_token": "netlify", "careers_url": "https://www.netlify.com/careers"},
    "hashicorp": {"ats_type": "greenhouse", "ats_token": "hashicorp", "careers_url": "https://www.hashicorp.com/careers"},
    "confluent": {"ats_type": "greenhouse", "ats_token": "confluent", "careers_url": "https://www.confluent.io/careers"},
    "snyk": {"ats_type": "greenhouse", "ats_token": "snyk", "careers_url": "https://snyk.io/careers"},
    "sentry": {"ats_type": "lever", "ats_token": "sentry", "careers_url": "https://sentry.io/careers"},
    "newrelic": {"ats_type": "greenhouse", "ats_token": "newrelic", "careers_url": "https://newrelic.com/about/careers"},
    "new relic": {"ats_type": "greenhouse", "ats_token": "newrelic", "careers_url": "https://newrelic.com/about/careers"},
    "splunk": {"ats_type": "greenhouse", "ats_token": "splunk", "careers_url": "https://www.splunk.com/en_us/careers.html"},
    "dropbox": {"ats_type": "greenhouse", "ats_token": "dropbox", "careers_url": "https://www.dropbox.com/jobs"},
    "airbnb": {"ats_type": "greenhouse", "ats_token": "airbnb", "careers_url": "https://careers.airbnb.com"},
    "doordash": {"ats_type": "greenhouse", "ats_token": "doordash", "careers_url": "https://careers.doordash.com"},
    "instacart": {"ats_type": "greenhouse", "ats_token": "instacart", "careers_url": "https://instacart.careers"},
    "lyft": {"ats_type": "greenhouse", "ats_token": "lyft", "careers_url": "https://www.lyft.com/careers"},
    "uber": {"ats_type": "greenhouse", "ats_token": "uber", "careers_url": "https://www.uber.com/us/en/careers"},
    "discord": {"ats_type": "greenhouse", "ats_token": "discord", "careers_url": "https://discord.com/careers"},
    "reddit": {"ats_type": "greenhouse", "ats_token": "reddit", "careers_url": "https://www.redditinc.com/careers"},
    "spotify": {"ats_type": "greenhouse", "ats_token": "spotify", "careers_url": "https://www.lifeatspotify.com/jobs"},
    "snap": {"ats_type": "greenhouse", "ats_token": "snap", "careers_url": "https://careers.snap.com"},
    "snapchat": {"ats_type": "greenhouse", "ats_token": "snap", "careers_url": "https://careers.snap.com"},
    "pinterest": {"ats_type": "greenhouse", "ats_token": "pinterest", "careers_url": "https://www.pinterestcareers.com"},
    "coinbase": {"ats_type": "greenhouse", "ats_token": "coinbase", "careers_url": "https://www.coinbase.com/careers"},
    "robinhood": {"ats_type": "greenhouse", "ats_token": "robinhood", "careers_url": "https://robinhood.com/us/en/careers"},
    "plaid": {"ats_type": "greenhouse", "ats_token": "plaid", "careers_url": "https://plaid.com/careers"},
    "affirm": {"ats_type": "greenhouse", "ats_token": "affirm", "careers_url": "https://www.affirm.com/careers"},
    "brex": {"ats_type": "greenhouse", "ats_token": "brex", "careers_url": "https://www.brex.com/careers"},
    "ramp": {"ats_type": "greenhouse", "ats_token": "ramp", "careers_url": "https://ramp.com/careers"},
    "mercury": {"ats_type": "greenhouse", "ats_token": "mercury", "careers_url": "https://mercury.com/jobs"},
    "scale ai": {"ats_type": "greenhouse", "ats_token": "scaleai", "careers_url": "https://scale.com/careers"},
    "anthropic": {"ats_type": "greenhouse", "ats_token": "anthropic", "careers_url": "https://www.anthropic.com/careers"},
    "openai": {"ats_type": "greenhouse", "ats_token": "openai", "careers_url": "https://openai.com/careers"},
    "cohere": {"ats_type": "greenhouse", "ats_token": "cohere", "careers_url": "https://cohere.com/careers"},
    "hugging face": {"ats_type": "greenhouse", "ats_token": "huggingface", "careers_url": "https://huggingface.co/jobs"},
    "huggingface": {"ats_type": "greenhouse", "ats_token": "huggingface", "careers_url": "https://huggingface.co/jobs"},
    "weights & biases": {"ats_type": "greenhouse", "ats_token": "wandb", "careers_url": "https://wandb.ai/site/careers"},
    "wandb": {"ats_type": "greenhouse", "ats_token": "wandb", "careers_url": "https://wandb.ai/site/careers"},
    "anyscale": {"ats_type": "greenhouse", "ats_token": "anyscale", "careers_url": "https://www.anyscale.com/careers"},
    "modal": {"ats_type": "greenhouse", "ats_token": "modal-labs", "careers_url": "https://modal.com/careers"},
    "linear": {"ats_type": "greenhouse", "ats_token": "linear", "careers_url": "https://linear.app/careers"},
    "loom": {"ats_type": "greenhouse", "ats_token": "loom", "careers_url": "https://www.loom.com/careers"},
    "miro": {"ats_type": "greenhouse", "ats_token": "miro", "careers_url": "https://miro.com/careers"},
    "asana": {"ats_type": "greenhouse", "ats_token": "asana", "careers_url": "https://asana.com/jobs"},
    "airtable": {"ats_type": "greenhouse", "ats_token": "airtable", "careers_url": "https://airtable.com/careers"},
    "webflow": {"ats_type": "greenhouse", "ats_token": "webflow", "careers_url": "https://webflow.com/careers"},
    "canva": {"ats_type": "greenhouse", "ats_token": "canva", "careers_url": "https://www.canva.com/careers"},
    "grammarly": {"ats_type": "greenhouse", "ats_token": "grammarly", "careers_url": "https://www.grammarly.com/jobs"},
    "zapier": {"ats_type": "greenhouse", "ats_token": "zapier", "careers_url": "https://zapier.com/jobs"},
    "plivo": {"ats_type": "lever", "ats_token": "plivo", "careers_url": "https://www.plivo.com/careers"},
    "vonage": {"ats_type": "greenhouse", "ats_token": "vonage", "careers_url": "https://www.vonage.com/careers"},
    "sendgrid": {"ats_type": "greenhouse", "ats_token": "sendgrid", "careers_url": "https://sendgrid.com/careers"},
    "mailchimp": {"ats_type": "greenhouse", "ats_token": "mailchimp", "careers_url": "https://mailchimp.com/jobs"},
    "klaviyo": {"ats_type": "greenhouse", "ats_token": "klaviyo", "careers_url": "https://www.klaviyo.com/careers"},
    "segment": {"ats_type": "greenhouse", "ats_token": "segment", "careers_url": "https://segment.com/careers"},
    "amplitude": {"ats_type": "greenhouse", "ats_token": "amplitude", "careers_url": "https://amplitude.com/careers"},
    "mixpanel": {"ats_type": "greenhouse", "ats_token": "mixpanel", "careers_url": "https://mixpanel.com/jobs"},
    "pagerduty": {"ats_type": "greenhouse", "ats_token": "pagerduty", "careers_url": "https://www.pagerduty.com/careers"},
    "palantir": {"ats_type": "greenhouse", "ats_token": "palantir", "careers_url": "https://www.palantir.com/careers"},
    "snowflake": {"ats_type": "workday", "ats_token": None, "careers_url": "https://careers.snowflake.com"},
    "salesforce": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.salesforce.com/company/careers"},
    "oracle": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.oracle.com/careers"},
    "ibm": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.ibm.com/careers"},
    "cisco": {"ats_type": "workday", "ats_token": None, "careers_url": "https://jobs.cisco.com"},
    "intel": {"ats_type": "workday", "ats_token": None, "careers_url": "https://jobs.intel.com"},
    "nvidia": {"ats_type": "workday", "ats_token": None, "careers_url": "https://www.nvidia.com/en-us/about-nvidia/careers"},
    "amd": {"ats_type": "workday", "ats_token": None, "careers_url": "https://www.amd.com/en/careers"},
    "qualcomm": {"ats_type": "workday", "ats_token": None, "careers_url": "https://www.qualcomm.com/company/careers"},
    "bloomberg": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.bloomberg.com/careers"},
    "citadel": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.citadel.com/careers"},
    "two sigma": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.twosigma.com/careers"},
    "jane street": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.janestreet.com/join-jane-street"},
    "hrt": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.hudsonrivertrading.com/careers"},
    "hudson river trading": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.hudsonrivertrading.com/careers"},
    "capital one": {"ats_type": "workday", "ats_token": None, "careers_url": "https://www.capitalonecareers.com"},
    "jpmorgan": {"ats_type": "custom", "ats_token": None, "careers_url": "https://careers.jpmorgan.com"},
    "jp morgan": {"ats_type": "custom", "ats_token": None, "careers_url": "https://careers.jpmorgan.com"},
    "goldman sachs": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.goldmansachs.com/careers"},
    "morgan stanley": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.morganstanley.com/careers"},
    "deshaw": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.deshaw.com/careers"},
    "d.e. shaw": {"ats_type": "custom", "ats_token": None, "careers_url": "https://www.deshaw.com/careers"},
}

# Regex patterns for extracting sponsor info
URL_PATTERN = re.compile(r"https?://[^\s<>\"'\)]+", re.IGNORECASE)
CAREERS_KEYWORDS = ["careers", "jobs", "hiring", "join", "work", "employment", "openings"]


def clean_company_name(name: str) -> str:
    """Normalize company name for lookup."""
    # Remove common suffixes
    name = re.sub(r"\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?)\s*$", "", name, flags=re.IGNORECASE)
    # Remove trailing whitespace and special chars
    name = re.sub(r"[^\w\s&\.\-]", "", name).strip()
    return name


def get_ats_info(company_name: str) -> Optional[dict]:
    """Look up ATS info for a company.

    Args:
        company_name: The company name to look up

    Returns:
        Dict with ats_type, ats_token, careers_url or None if unknown
    """
    # Normalize name for lookup
    normalized = clean_company_name(company_name).lower()

    # Direct lookup
    if normalized in KNOWN_SPONSOR_ATS:
        return KNOWN_SPONSOR_ATS[normalized]

    # Try removing common words
    for word in ["inc", "labs", "technologies", "software", "ai"]:
        stripped = normalized.replace(word, "").strip()
        if stripped in KNOWN_SPONSOR_ATS:
            return KNOWN_SPONSOR_ATS[stripped]

    return None


def infer_careers_url(company_name: str, company_url: Optional[str] = None) -> str:
    """Try to infer a company's careers page URL.

    Args:
        company_name: The company name
        company_url: Optional company website URL

    Returns:
        Best guess at careers URL
    """
    # First check known mappings
    ats_info = get_ats_info(company_name)
    if ats_info:
        return ats_info["careers_url"]

    # If we have a company URL, try common patterns
    if company_url:
        base = company_url.rstrip("/")
        domain = urlparse(base).netloc
        # Return most common careers path
        return f"https://{domain}/careers"

    # Last resort: try to construct from company name
    slug = re.sub(r"[^\w]", "", company_name.lower())
    return f"https://www.{slug}.com/careers"


def fetch_mlh_sponsors() -> list[dict]:
    """Fetch current season MLH (Major League Hacking) sponsors.

    MLH partners are tech companies that actively recruit from hackathons.

    Returns:
        List of sponsor dicts with: name, careers_url, ats_type, ats_token, source
    """
    sponsors = []

    # MLH partners page
    mlh_urls = [
        "https://mlh.io/partners",
        "https://mlh.io/sponsors",
    ]

    for mlh_url in mlh_urls:
        try:
            response = _make_request(mlh_url)
            if response is None or response.status_code != 200:
                continue

            html = response.text

            # Parse sponsor names from image alt text and links
            # MLH typically uses <img alt="Company Name"> or <a href="...">Company</a>
            sponsor_patterns = [
                re.compile(r'<img[^>]*alt="([^"]+)"[^>]*class="[^"]*sponsor[^"]*"', re.IGNORECASE),
                re.compile(r'<img[^>]*class="[^"]*sponsor[^"]*"[^>]*alt="([^"]+)"', re.IGNORECASE),
                re.compile(r'class="[^"]*partner[^"]*"[^>]*>([^<]+)<', re.IGNORECASE),
                re.compile(r'<a[^>]*href="[^"]*"[^>]*>([A-Za-z][A-Za-z0-9\s&\.]+)</a>', re.IGNORECASE),
            ]

            found_names = set()
            for pattern in sponsor_patterns:
                matches = pattern.findall(html)
                for name in matches:
                    name = clean_company_name(unescape(name))
                    if len(name) > 2 and len(name) < 50:
                        found_names.add(name)

            for name in found_names:
                ats_info = get_ats_info(name)
                sponsors.append({
                    "name": name,
                    "careers_url": infer_careers_url(name),
                    "ats_type": ats_info["ats_type"] if ats_info else None,
                    "ats_token": ats_info["ats_token"] if ats_info else None,
                    "source": "mlh",
                })

        except requests.RequestException as e:
            print(f"Error fetching MLH sponsors from {mlh_url}: {e}")
            continue

    # Add well-known MLH partners that may not be scraped dynamically
    known_mlh_partners = [
        "GitHub", "Microsoft", "Google Cloud", "Amazon Web Services",
        "DigitalOcean", "Twilio", "MongoDB", "Wolfram", "Auth0",
        "Cockroach Labs", "Balsamiq", "Voiceflow", "Echo3D",
    ]

    existing_names = {s["name"].lower() for s in sponsors}
    for name in known_mlh_partners:
        if name.lower() not in existing_names:
            ats_info = get_ats_info(name)
            sponsors.append({
                "name": name,
                "careers_url": infer_careers_url(name),
                "ats_type": ats_info["ats_type"] if ats_info else None,
                "ats_token": ats_info["ats_token"] if ats_info else None,
                "source": "mlh",
            })

    print(f"Found {len(sponsors)} MLH sponsors")
    return sponsors


def fetch_devpost_companies() -> list[dict]:
    """Fetch companies hosting or sponsoring hackathons on Devpost.

    These companies are actively recruiting through hackathon sponsorships.

    Returns:
        List of sponsor dicts with: name, careers_url, ats_type, ats_token, source
    """
    sponsors = []

    # Devpost hackathons API
    devpost_urls = [
        "https://devpost.com/api/hackathons?status=open",
        "https://devpost.com/api/hackathons?status=upcoming",
    ]

    for api_url in devpost_urls:
        try:
            response = _make_request(api_url, accept_json=True)

            if response is None or response.status_code != 200:
                continue

            data = response.json()
            hackathons = data.get("hackathons", [])

            for hackathon in hackathons:
                # Extract organization/sponsor info
                org_name = hackathon.get("organization_name", "")
                if org_name and len(org_name) > 2:
                    org_name = clean_company_name(org_name)
                    ats_info = get_ats_info(org_name)
                    sponsors.append({
                        "name": org_name,
                        "careers_url": infer_careers_url(org_name),
                        "ats_type": ats_info["ats_type"] if ats_info else None,
                        "ats_token": ats_info["ats_token"] if ats_info else None,
                        "source": "devpost",
                    })

        except requests.RequestException as e:
            print(f"Error fetching Devpost hackathons from {api_url}: {e}")
            continue
        except ValueError as e:
            print(f"Error parsing Devpost JSON: {e}")
            continue

    # Fallback: scrape the main hackathons page
    try:
        response = _make_request("https://devpost.com/hackathons")

        if response is not None and response.status_code == 200:
            html = response.text

            # Look for sponsor/organizer names
            org_patterns = [
                re.compile(r'data-organization-name="([^"]+)"', re.IGNORECASE),
                re.compile(r'class="[^"]*sponsor[^"]*"[^>]*>([^<]+)<', re.IGNORECASE),
                re.compile(r'<span[^>]*class="[^"]*host[^"]*"[^>]*>([^<]+)<', re.IGNORECASE),
            ]

            existing_names = {s["name"].lower() for s in sponsors}
            for pattern in org_patterns:
                matches = pattern.findall(html)
                for name in matches:
                    name = clean_company_name(unescape(name))
                    if len(name) > 2 and len(name) < 50 and name.lower() not in existing_names:
                        ats_info = get_ats_info(name)
                        sponsors.append({
                            "name": name,
                            "careers_url": infer_careers_url(name),
                            "ats_type": ats_info["ats_type"] if ats_info else None,
                            "ats_token": ats_info["ats_token"] if ats_info else None,
                            "source": "devpost",
                        })
                        existing_names.add(name.lower())

    except requests.RequestException as e:
        print(f"Error scraping Devpost hackathons page: {e}")

    # Deduplicate by name
    seen = set()
    unique_sponsors = []
    for sponsor in sponsors:
        key = sponsor["name"].lower()
        if key not in seen:
            seen.add(key)
            unique_sponsors.append(sponsor)

    print(f"Found {len(unique_sponsors)} Devpost companies")
    return unique_sponsors


def fetch_major_hackathon_sponsors() -> list[dict]:
    """Fetch sponsors from major university hackathons.

    Top hackathons like HackMIT, TreeHacks, and PennApps attract the best
    companies recruiting new grads.

    Returns:
        List of sponsor dicts with: name, careers_url, ats_type, ats_token, source
    """
    sponsors = []

    # Major hackathon sponsor pages
    hackathon_pages = {
        "hackmit": [
            "https://hackmit.org",
            "https://hackmit.org/sponsors",
        ],
        "treehacks": [
            "https://www.treehacks.com",
            "https://www.treehacks.com/sponsors",
        ],
        "pennapps": [
            "https://pennapps.com",
            "https://pennapps.com/sponsors",
        ],
        "calhacks": [
            "https://www.calhacks.io",
            "https://calhacks.io/sponsors",
        ],
        "hackthe6ix": [
            "https://hackthe6ix.com",
        ],
        "hackgt": [
            "https://hack.gt",
            "https://2024.hack.gt",
        ],
        "lahacks": [
            "https://lahacks.com",
        ],
        "boilermake": [
            "https://boilermake.org",
        ],
    }

    for hackathon, urls in hackathon_pages.items():
        for url in urls:
            try:
                response = _make_request(url)

                if response is None or response.status_code != 200:
                    continue

                html = response.text

                # Extract sponsor names from various patterns
                sponsor_patterns = [
                    # Image alt text
                    re.compile(r'<img[^>]*alt="([^"]+)"[^>]*>', re.IGNORECASE),
                    # Sponsor section headers
                    re.compile(r'class="[^"]*sponsor[^"]*"[^>]*>[^<]*<[^>]*>([^<]+)<', re.IGNORECASE),
                    # Link text within sponsor divs
                    re.compile(r'sponsor[^>]*>.*?<a[^>]*>([^<]+)</a>', re.IGNORECASE | re.DOTALL),
                    # Company name data attributes
                    re.compile(r'data-(?:company|sponsor|partner)-name="([^"]+)"', re.IGNORECASE),
                ]

                found_names = set()
                for pattern in sponsor_patterns:
                    matches = pattern.findall(html)
                    for name in matches:
                        name = clean_company_name(unescape(name))
                        # Filter out generic text
                        if len(name) > 2 and len(name) < 50:
                            # Skip common non-company terms
                            skip_words = ["logo", "sponsor", "partner", "image", "button", "link",
                                          "close", "menu", "nav", "footer", "header", "submit"]
                            if not any(w in name.lower() for w in skip_words):
                                found_names.add(name)

                for name in found_names:
                    ats_info = get_ats_info(name)
                    sponsors.append({
                        "name": name,
                        "careers_url": infer_careers_url(name),
                        "ats_type": ats_info["ats_type"] if ats_info else None,
                        "ats_token": ats_info["ats_token"] if ats_info else None,
                        "source": f"hackathon_{hackathon}",
                    })

            except requests.RequestException as e:
                print(f"Error fetching {hackathon} sponsors from {url}: {e}")
                continue

    # Add well-known hackathon sponsors that commonly appear
    known_hackathon_sponsors = [
        ("Stripe", "hackmit"),
        ("Jane Street", "hackmit"),
        ("Citadel", "hackmit"),
        ("Two Sigma", "hackmit"),
        ("Bloomberg", "hackmit"),
        ("Capital One", "hackmit"),
        ("Google", "treehacks"),
        ("Meta", "treehacks"),
        ("Apple", "treehacks"),
        ("Databricks", "treehacks"),
        ("OpenAI", "treehacks"),
        ("Anthropic", "treehacks"),
        ("Figma", "pennapps"),
        ("Notion", "pennapps"),
        ("Vercel", "pennapps"),
        ("MongoDB", "pennapps"),
        ("Palantir", "calhacks"),
        ("Scale AI", "calhacks"),
        ("Cloudflare", "calhacks"),
    ]

    existing_names = {s["name"].lower() for s in sponsors}
    for name, hackathon in known_hackathon_sponsors:
        if name.lower() not in existing_names:
            ats_info = get_ats_info(name)
            sponsors.append({
                "name": name,
                "careers_url": infer_careers_url(name),
                "ats_type": ats_info["ats_type"] if ats_info else None,
                "ats_token": ats_info["ats_token"] if ats_info else None,
                "source": f"hackathon_{hackathon}",
            })
            existing_names.add(name.lower())

    # Deduplicate by name
    seen = set()
    unique_sponsors = []
    for sponsor in sponsors:
        key = sponsor["name"].lower()
        if key not in seen:
            seen.add(key)
            unique_sponsors.append(sponsor)

    print(f"Found {len(unique_sponsors)} major hackathon sponsors")
    return unique_sponsors


def fetch_all_hackathon_sponsors() -> list[dict]:
    """Fetch sponsors from all hackathon sources.

    Combines MLH, Devpost, and major hackathons into one deduplicated list.

    Returns:
        List of unique sponsor dicts with: name, careers_url, ats_type, ats_token, sources
    """
    # Use monitoring if available
    if INFRA_AVAILABLE:
        ctx = monitor_scraper("hackathon_sponsors")
    else:
        ctx = None

    try:
        if ctx:
            ctx.__enter__()

        all_sponsors = {}

        # Collect from all sources
        for sponsor in fetch_mlh_sponsors():
            key = sponsor["name"].lower()
            if key not in all_sponsors:
                all_sponsors[key] = {
                    **sponsor,
                    "sources": [sponsor["source"]],
                }
            else:
                if sponsor["source"] not in all_sponsors[key]["sources"]:
                    all_sponsors[key]["sources"].append(sponsor["source"])

        for sponsor in fetch_devpost_companies():
            key = sponsor["name"].lower()
            if key not in all_sponsors:
                all_sponsors[key] = {
                    **sponsor,
                    "sources": [sponsor["source"]],
                }
            else:
                if sponsor["source"] not in all_sponsors[key]["sources"]:
                    all_sponsors[key]["sources"].append(sponsor["source"])

        for sponsor in fetch_major_hackathon_sponsors():
            key = sponsor["name"].lower()
            if key not in all_sponsors:
                all_sponsors[key] = {
                    **sponsor,
                    "sources": [sponsor["source"]],
                }
            else:
                if sponsor["source"] not in all_sponsors[key]["sources"]:
                    all_sponsors[key]["sources"].append(sponsor["source"])

        result = list(all_sponsors.values())

        # Sort by number of sources (more sources = more active recruiter)
        result.sort(key=lambda x: len(x.get("sources", [])), reverse=True)

        # Record metrics if monitoring available
        if ctx:
            ctx.record_questions(extracted=len(result), new=len(result))

        print(f"Total unique hackathon sponsors: {len(result)}")
        return result

    finally:
        if ctx:
            ctx.__exit__(None, None, None)


def get_greenhouse_sponsors() -> list[dict]:
    """Get hackathon sponsors that use Greenhouse ATS.

    Returns:
        List of sponsors with Greenhouse ATS, ready for job scraping
    """
    all_sponsors = fetch_all_hackathon_sponsors()
    return [s for s in all_sponsors if s.get("ats_type") == "greenhouse" and s.get("ats_token")]


def get_lever_sponsors() -> list[dict]:
    """Get hackathon sponsors that use Lever ATS.

    Returns:
        List of sponsors with Lever ATS, ready for job scraping
    """
    all_sponsors = fetch_all_hackathon_sponsors()
    return [s for s in all_sponsors if s.get("ats_type") == "lever" and s.get("ats_token")]


def get_ashby_sponsors() -> list[dict]:
    """Get hackathon sponsors that use Ashby ATS.

    Returns:
        List of sponsors with Ashby ATS, ready for job scraping
    """
    all_sponsors = fetch_all_hackathon_sponsors()
    return [s for s in all_sponsors if s.get("ats_type") == "ashby" and s.get("ats_token")]


if __name__ == "__main__":
    # Test the scrapers
    print("=" * 60)
    print("Testing Hackathon Sponsor Scrapers")
    print("=" * 60)

    print("\n--- MLH Sponsors ---")
    mlh = fetch_mlh_sponsors()
    for s in mlh[:5]:
        print(f"  {s['name']}: {s['ats_type']} ({s['careers_url']})")

    print("\n--- Devpost Companies ---")
    devpost = fetch_devpost_companies()
    for s in devpost[:5]:
        print(f"  {s['name']}: {s['ats_type']} ({s['careers_url']})")

    print("\n--- Major Hackathon Sponsors ---")
    major = fetch_major_hackathon_sponsors()
    for s in major[:5]:
        print(f"  {s['name']}: {s['ats_type']} ({s['source']})")

    print("\n--- Greenhouse Sponsors (ready for scraping) ---")
    gh = get_greenhouse_sponsors()
    for s in gh[:10]:
        print(f"  {s['name']}: {s['ats_token']}")

    print("\n--- Summary ---")
    all_sponsors = fetch_all_hackathon_sponsors()
    print(f"Total unique sponsors: {len(all_sponsors)}")
    print(f"With Greenhouse: {len([s for s in all_sponsors if s.get('ats_type') == 'greenhouse'])}")
    print(f"With Lever: {len([s for s in all_sponsors if s.get('ats_type') == 'lever'])}")
    print(f"With Ashby: {len([s for s in all_sponsors if s.get('ats_type') == 'ashby'])}")
    print(f"Unknown ATS: {len([s for s in all_sponsors if not s.get('ats_type')])}")
