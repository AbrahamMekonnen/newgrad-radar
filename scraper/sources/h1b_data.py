"""H1B Sponsor Data Aggregator.

Parses DOL Labor Condition Application (LCA) disclosure data to build a list
of companies that sponsor H1B visas. This helps international students filter
for sponsor-friendly companies.

Data sources:
- DOL OFLC Disclosure Files (official H1B applications)
- Cached known sponsors from major tech companies

Upgraded with:
- ResponseCache for efficient DOL data caching (7 day TTL)
- ValidationPipeline for company name validation
- RetryManager for robust downloads

Usage:
    from sources.h1b_data import is_h1b_sponsor, get_sponsorship_info

    # Check if a company sponsors H1B
    if is_h1b_sponsor("Google"):
        print("Google sponsors H1B visas")

    # Get detailed sponsorship info
    info = get_sponsorship_info("Anthropic")
    # {'is_sponsor': True, 'confidence': 'high', 'recent_filings': 50}
"""

import os
import json
import re
import hashlib
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import requests

# Import infrastructure utilities
try:
    from utils.cache import ResponseCache
    from utils.error_handler import RetryManager
    HAS_INFRASTRUCTURE = True
except ImportError:
    try:
        from ..utils.cache import ResponseCache
        from ..utils.error_handler import RetryManager
        HAS_INFRASTRUCTURE = True
    except ImportError:
        HAS_INFRASTRUCTURE = False
        ResponseCache = None
        RetryManager = None

logger = logging.getLogger(__name__)

# Global infrastructure instances
_response_cache: Optional['ResponseCache'] = None
_retry_manager: Optional['RetryManager'] = None


def _get_cache() -> Optional['ResponseCache']:
    """Get or initialize response cache."""
    global _response_cache
    if HAS_INFRASTRUCTURE and _response_cache is None and ResponseCache:
        try:
            _response_cache = ResponseCache(ttl=604800)  # 7 days for DOL data
            logger.info("ResponseCache initialized for H1B data")
        except Exception as e:
            logger.warning(f"Failed to initialize ResponseCache: {e}")
    return _response_cache


def _get_retry_manager() -> Optional['RetryManager']:
    """Get or initialize retry manager."""
    global _retry_manager
    if HAS_INFRASTRUCTURE and _retry_manager is None and RetryManager:
        try:
            _retry_manager = RetryManager(max_retries=3, base_delay=2.0, max_delay=30.0)
            logger.info("RetryManager initialized for H1B data")
        except Exception as e:
            logger.warning(f"Failed to initialize RetryManager: {e}")
    return _retry_manager

# Import REQUEST_TIMEOUT from config, with fallback for standalone execution
try:
    from config import REQUEST_TIMEOUT
except ImportError:
    REQUEST_TIMEOUT = 30  # Default timeout in seconds

# Cache directory for H1B data
CACHE_DIR = Path(__file__).parent.parent / ".h1b_cache"
CACHE_FILE = CACHE_DIR / "sponsors.json"
CACHE_TTL_DAYS = 7  # Refresh data weekly

# DOL OFLC Disclosure Data URLs (LCA files contain H1B sponsors).
# Updated quarterly by the Department of Labor. NOTE: DOL publishes these as
# .xlsx (the old .csv paths 404), so we parse them with python-calamine. Keep
# to the most recent quarters — one year of filings already yields ~30k
# distinct sponsors, and older quarters only add download/parse time.
DOL_LCA_URLS = [
    "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2026_Q1.xlsx",
    "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2025_Q4.xlsx",
    "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2025_Q3.xlsx",
]

# Column header in DOL LCA files that holds the sponsoring company name.
DOL_EMPLOYER_COLUMN = "EMPLOYER_NAME"

# H1BData.info style API endpoint (alternative source)
H1BDATA_API_URL = "https://h1bdata.info/index.php"


def normalize_company_name(name: str) -> str:
    """Normalize company name for matching.

    Handles common variations like:
    - "Google LLC" -> "google"
    - "AMAZON.COM SERVICES LLC" -> "amazon"
    - "Meta Platforms, Inc." -> "meta"
    """
    if not name:
        return ""

    # Convert to lowercase
    name = name.lower().strip()

    # Remove common suffixes
    suffixes = [
        r'\s*,?\s*inc\.?$',
        r'\s*,?\s*llc\.?$',
        r'\s*,?\s*corp\.?$',
        r'\s*,?\s*corporation$',
        r'\s*,?\s*ltd\.?$',
        r'\s*,?\s*limited$',
        r'\s*,?\s*l\.?p\.?$',
        r'\s*,?\s*co\.?$',
        r'\s*,?\s*company$',
        r'\s*,?\s*technologies?$',
        r'\s*,?\s*software$',
        r'\s*,?\s*services?$',
        r'\s*,?\s*solutions?$',
        r'\s*,?\s*systems?$',
        r'\s*,?\s*consulting$',
        r'\s*,?\s*group$',
        r'\s*,?\s*holdings?$',
        r'\s*,?\s*usa$',
        r'\s*,?\s*us$',
        r'\s*,?\s*america$',
        r'\.com$',
    ]

    for suffix in suffixes:
        name = re.sub(suffix, '', name, flags=re.IGNORECASE)

    # Remove punctuation except hyphens
    name = re.sub(r'[^\w\s-]', '', name)

    # Collapse whitespace
    name = re.sub(r'\s+', ' ', name).strip()

    # Remove common prefixes
    name = re.sub(r'^the\s+', '', name)

    return name


def _load_cache() -> dict:
    """Load cached sponsor data."""
    if not CACHE_FILE.exists():
        return {}

    try:
        with open(CACHE_FILE, 'r') as f:
            data = json.load(f)

        # Check if cache is still valid
        cached_at = datetime.fromisoformat(data.get('cached_at', '2000-01-01'))
        if datetime.now() - cached_at > timedelta(days=CACHE_TTL_DAYS):
            return {}  # Cache expired

        return data
    except (json.JSONDecodeError, ValueError, IOError):
        return {}


def _save_cache(data: dict) -> None:
    """Save sponsor data to cache."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    data['cached_at'] = datetime.now().isoformat()

    with open(CACHE_FILE, 'w') as f:
        json.dump(data, f, indent=2)


# Known H1B sponsors (major tech companies confirmed to sponsor)
# This serves as a reliable baseline even if DOL data fails to load
KNOWN_H1B_SPONSORS = {
    # FAANG
    "google", "meta", "apple", "amazon", "netflix", "microsoft", "nvidia",

    # AI Companies
    "anthropic", "openai", "coreweave", "together ai", "anyscale", "modal",
    "fireworks ai", "groq", "mistral", "mistral ai", "perplexity", "cursor",
    "anysphere", "replit", "sourcegraph", "tabnine", "character ai",
    "inflection", "inflection ai", "adept", "adept ai", "runway", "runwayml",
    "midjourney", "stability ai", "descript", "jasper", "copy ai", "writer",
    "coframe", "weights & biases", "wandb", "pinecone", "weaviate", "langchain",
    "eleven labs", "elevenlabs", "suno", "pika", "luma ai", "harvey ai",
    "glean", "hebbia", "sierra ai", "cohere", "hugging face", "huggingface",
    "replicate",

    # Unicorns
    "stripe", "databricks", "figma", "notion", "canva", "discord", "reddit",
    "instacart", "doordash", "coinbase", "robinhood", "plaid", "ramp", "brex",
    "airtable", "clickup", "linear", "vercel", "supabase", "retool", "webflow",
    "scale ai", "rippling", "flexport", "navan", "grammarly", "miro", "asana",
    "amplitude", "datadog", "snowflake", "cloudflare", "palantir",

    # YC Notable
    "airbnb", "dropbox", "twitch", "cruise", "faire", "ginkgo bioworks",
    "gusto", "checkr", "deel", "lattice", "ironclad", "vanta", "mercury",
    "opensea",

    # Fintech
    "affirm", "klarna", "chime", "sofi", "marqeta",

    # Infra / Dev Tools
    "hashicorp", "confluent", "mongodb", "planetscale", "neon", "turso",

    # Additional known sponsors
    "salesforce", "oracle", "ibm", "intel", "qualcomm", "adobe", "vmware",
    "uber", "lyft", "twitter", "x", "snap", "snapchat", "pinterest",
    "linkedin", "github", "gitlab", "atlassian", "zoom", "slack",
    "splunk", "elastic", "new relic", "pagerduty", "servicenow",
    "workday", "okta", "crowdstrike", "palo alto networks", "fortinet",
    "twilio", "sendgrid", "segment", "contentful", "sanity",
    "spotify", "roku", "hulu", "paramount", "warner bros", "disney",
    "bloomberg", "capital one", "jpmorgan", "goldman sachs", "citadel",
    "jane street", "two sigma", "de shaw", "point72", "bridgewater",
    "morgan stanley", "bank of america", "wells fargo", "citi",
    "visa", "mastercard", "paypal", "square", "block",
    "tesla", "rivian", "lucid", "spacex", "blue origin", "waymo",
    "aurora", "zoox", "argo ai", "nuro", "cruise", "motional",
    "epic games", "unity", "roblox", "electronic arts", "activision",
    "walmart", "target", "costco", "home depot", "lowes",
}

# Companies known NOT to sponsor (US citizens/residents only)
# These are useful to filter out
KNOWN_NON_SPONSORS = {
    "spacex",  # Export control restrictions
    "lockheed martin",
    "northrop grumman",
    "raytheon",
    "general dynamics",
    "boeing",  # Some positions
    "l3harris",
    "leidos",
    "saic",
    "bae systems",
    "anduril",  # Many positions require citizenship
}


def _download_to_temp(url: str, retry_mgr) -> Optional[str]:
    """Stream a (large) DOL file to a temp path on disk. Returns the path or None.

    These files are ~75MB each, so we never hold them in memory as text — we
    write to disk and let the parser stream from there.
    """
    import tempfile

    def do_fetch():
        resp = requests.get(url, timeout=180, stream=True)
        resp.raise_for_status()
        return resp

    response = retry_mgr.execute(do_fetch) if retry_mgr else do_fetch()
    fd, path = tempfile.mkstemp(suffix=".xlsx")
    try:
        with os.fdopen(fd, "wb") as fh:
            for chunk in response.iter_content(chunk_size=1 << 20):
                if chunk:
                    fh.write(chunk)
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise
    return path


def _employer_names_from_xlsx(path: str):
    """Yield raw EMPLOYER_NAME values from a DOL LCA .xlsx file.

    Uses python-calamine (Rust-backed) because openpyxl is far too slow on
    these 75MB workbooks.
    """
    from python_calamine import CalamineWorkbook

    wb = CalamineWorkbook.from_path(path)
    sheet = wb.get_sheet_by_index(0)
    rows = sheet.to_python(skip_empty_area=True)
    if not rows:
        return
    header = [str(h).strip() for h in rows[0]]
    try:
        idx = header.index(DOL_EMPLOYER_COLUMN)
    except ValueError:
        logger.warning("EMPLOYER_NAME column not found; header=%s", header[:25])
        return
    for row in rows[1:]:
        if idx < len(row):
            value = row[idx]
            if value:
                yield str(value)


def fetch_dol_sponsors() -> set[str]:
    """Fetch H1B sponsor data from DOL disclosure files.

    Downloads each quarterly LCA .xlsx, extracts every distinct EMPLOYER_NAME,
    and returns the normalized set. A failure on any single file is non-fatal
    (we keep whatever we gathered and fall back to KNOWN_H1B_SPONSORS upstream).

    Returns:
        Set of normalized company names that have filed H1B LCAs.
    """
    sponsors: set[str] = set()
    retry_mgr = _get_retry_manager()

    for url in DOL_LCA_URLS:
        path = None
        try:
            print(f"Fetching DOL LCA data: {url}")
            path = _download_to_temp(url, retry_mgr)
            for employer in _employer_names_from_xlsx(path):
                normalized = normalize_company_name(employer)
                if normalized:
                    sponsors.add(normalized)
            print(f"  Found {len(sponsors)} unique sponsors so far")
        except requests.RequestException as e:
            logger.warning(f"Failed to fetch {url}: {e}")
            print(f"  Warning: Failed to fetch {url}: {e}")
        except Exception as e:
            logger.warning(f"Error parsing {url}: {e}")
            print(f"  Warning: Error parsing {url}: {e}")
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass

    return sponsors


def fetch_h1bdata_sponsors(employer: str) -> dict:
    """Query H1BData.info for employer-specific data.

    This provides more detailed info about a specific company's
    H1B sponsorship history.

    Args:
        employer: Company name to look up

    Returns:
        Dict with sponsorship details or empty dict if not found.
    """
    cache = _get_cache()
    retry_mgr = _get_retry_manager()

    try:
        # H1BData.info accepts employer searches
        params = {
            'em': employer,
            'job': '',
            'city': '',
            'year': 'All+Years',
        }

        cache_key = f"h1bdata:{employer}"

        # Check cache first
        if cache:
            cached = cache.get(cache_key)
            if cached:
                content = cached.content.decode('utf-8', errors='replace').lower()
                if employer.lower() in content:
                    return {'found': True, 'source': 'h1bdata.info', 'cached': True}
                return {}

        def do_fetch():
            return requests.get(
                H1BDATA_API_URL,
                params=params,
                timeout=REQUEST_TIMEOUT,
                headers={'User-Agent': 'NewGradRadar/1.0'}
            )

        if retry_mgr:
            response = retry_mgr.execute(do_fetch)
        else:
            response = do_fetch()

        response.raise_for_status()

        # Cache the response
        if cache:
            cache.set(cache_key, response, ttl=7 * 24 * 3600)

        # Parse response - H1BData returns HTML, need to extract data
        # For now, just check if employer appears in results
        content = response.text.lower()
        if employer.lower() in content:
            return {'found': True, 'source': 'h1bdata.info'}

        return {}

    except requests.RequestException as e:
        logger.warning(f"Failed to fetch H1BData for {employer}: {e}")
        return {}


def build_sponsor_database() -> dict:
    """Build comprehensive H1B sponsor database.

    Combines:
    1. Known tech company sponsors (hardcoded)
    2. DOL OFLC disclosure data (official records)

    Returns:
        Dict with 'sponsors' set and metadata.
    """
    # Start with known sponsors
    all_sponsors = set(KNOWN_H1B_SPONSORS)

    # Try to fetch DOL data
    try:
        dol_sponsors = fetch_dol_sponsors()
        all_sponsors.update(dol_sponsors)
        print(f"Total sponsors after DOL data: {len(all_sponsors)}")
    except Exception as e:
        print(f"Warning: Could not fetch DOL data: {e}")
        print("Using known sponsors list only")

    return {
        'sponsors': list(all_sponsors),
        'non_sponsors': list(KNOWN_NON_SPONSORS),
        'known_count': len(KNOWN_H1B_SPONSORS),
        'dol_count': len(all_sponsors) - len(KNOWN_H1B_SPONSORS),
    }


def get_sponsor_database() -> dict:
    """Get cached sponsor database, refreshing if needed."""
    # Check cache first
    cache = _load_cache()
    if cache and 'sponsors' in cache:
        return cache

    # Build fresh database
    print("Building H1B sponsor database...")
    data = build_sponsor_database()
    _save_cache(data)

    return data


# Lazy-loaded sponsor set
_sponsor_set: Optional[set] = None
_non_sponsor_set: Optional[set] = None


def _ensure_loaded() -> None:
    """Ensure sponsor data is loaded."""
    global _sponsor_set, _non_sponsor_set

    if _sponsor_set is not None:
        return

    data = get_sponsor_database()
    _sponsor_set = set(data.get('sponsors', []))
    _non_sponsor_set = set(data.get('non_sponsors', []))


def is_h1b_sponsor(company_name: str) -> bool:
    """Check if a company is known to sponsor H1B visas.

    Args:
        company_name: Company name to check (case-insensitive)

    Returns:
        True if company is a known H1B sponsor, False otherwise.

    Example:
        >>> is_h1b_sponsor("Google")
        True
        >>> is_h1b_sponsor("Google LLC")
        True
        >>> is_h1b_sponsor("Unknown Startup")
        False
    """
    _ensure_loaded()

    normalized = normalize_company_name(company_name)
    if not normalized:
        return False

    # Check against non-sponsors first
    if normalized in _non_sponsor_set:
        return False

    # Check for exact match
    if normalized in _sponsor_set:
        return True

    # Check for partial matches (company might be "Google" but record has "google cloud")
    for sponsor in _sponsor_set:
        if normalized in sponsor or sponsor in normalized:
            return True

    return False


def is_known_non_sponsor(company_name: str) -> bool:
    """Check if a company is known NOT to sponsor H1B visas.

    Useful for flagging jobs that likely require citizenship.

    Args:
        company_name: Company name to check

    Returns:
        True if company is known to NOT sponsor H1B.
    """
    _ensure_loaded()

    normalized = normalize_company_name(company_name)
    if not normalized:
        return False

    if normalized in _non_sponsor_set:
        return True

    # Check for partial matches
    for non_sponsor in _non_sponsor_set:
        if normalized in non_sponsor or non_sponsor in normalized:
            return True

    return False


def get_sponsorship_info(company_name: str) -> dict:
    """Get detailed sponsorship information for a company.

    Args:
        company_name: Company name to look up

    Returns:
        Dict with sponsorship details:
        {
            'is_sponsor': bool,
            'confidence': 'high' | 'medium' | 'low' | 'none',
            'source': str,
            'notes': str (optional)
        }
    """
    _ensure_loaded()

    normalized = normalize_company_name(company_name)
    if not normalized:
        return {
            'is_sponsor': False,
            'confidence': 'none',
            'source': 'invalid_name',
        }

    # Check non-sponsors first
    if is_known_non_sponsor(company_name):
        return {
            'is_sponsor': False,
            'confidence': 'high',
            'source': 'known_non_sponsor',
            'notes': 'This company typically does not sponsor H1B visas, often due to export control restrictions.',
        }

    # Check if in our known sponsors list (high confidence)
    if normalized in KNOWN_H1B_SPONSORS:
        return {
            'is_sponsor': True,
            'confidence': 'high',
            'source': 'known_sponsor',
        }

    # Check DOL records (high confidence if found)
    if normalized in _sponsor_set:
        return {
            'is_sponsor': True,
            'confidence': 'high',
            'source': 'dol_lca_records',
        }

    # Check partial matches (medium confidence)
    for sponsor in _sponsor_set:
        if normalized in sponsor or sponsor in normalized:
            return {
                'is_sponsor': True,
                'confidence': 'medium',
                'source': 'partial_match',
                'matched': sponsor,
            }

    # Unknown - could sponsor, but no records found
    return {
        'is_sponsor': False,
        'confidence': 'low',
        'source': 'no_records',
        'notes': 'No H1B sponsorship records found. Company may still sponsor - recommend checking directly.',
    }


def add_sponsorship_flag(job: dict) -> dict:
    """Add sponsorship_likely flag to a job dict.

    Modifies the job dict in place and returns it.

    Args:
        job: Job dict with 'company' or 'company_name' key

    Returns:
        Job dict with added 'sponsorship_likely' and 'sponsorship_confidence' keys.
    """
    company = job.get('company') or job.get('company_name') or job.get('company_slug', '')

    info = get_sponsorship_info(company)

    job['sponsorship_likely'] = info['is_sponsor']
    job['sponsorship_confidence'] = info['confidence']

    # Also flag if known non-sponsor
    if info.get('source') == 'known_non_sponsor':
        job['sponsorship_likely'] = False
        job['requires_citizenship_likely'] = True

    return job


def add_sponsorship_flags(jobs: list[dict]) -> list[dict]:
    """Add sponsorship flags to a list of jobs.

    Args:
        jobs: List of job dicts

    Returns:
        Same list with sponsorship flags added to each job.
    """
    for job in jobs:
        add_sponsorship_flag(job)

    return jobs


def get_sponsor_stats() -> dict:
    """Get statistics about the sponsor database.

    Returns:
        Dict with sponsor database statistics.
    """
    _ensure_loaded()

    return {
        'total_sponsors': len(_sponsor_set) if _sponsor_set else 0,
        'known_sponsors': len(KNOWN_H1B_SPONSORS),
        'known_non_sponsors': len(KNOWN_NON_SPONSORS),
        'cache_file': str(CACHE_FILE),
        'cache_exists': CACHE_FILE.exists(),
    }


def refresh_sponsor_data() -> dict:
    """Force refresh of sponsor data from DOL sources.

    Returns:
        Updated sponsor database stats.
    """
    global _sponsor_set, _non_sponsor_set

    # Clear cache
    if CACHE_FILE.exists():
        CACHE_FILE.unlink()

    # Reset loaded data
    _sponsor_set = None
    _non_sponsor_set = None

    # Rebuild
    _ensure_loaded()

    return get_sponsor_stats()


# Export functions for use by other modules
__all__ = [
    'is_h1b_sponsor',
    'is_known_non_sponsor',
    'get_sponsorship_info',
    'add_sponsorship_flag',
    'add_sponsorship_flags',
    'get_sponsor_stats',
    'refresh_sponsor_data',
    'normalize_company_name',
]


if __name__ == '__main__':
    # Test the module
    print("Testing H1B sponsor lookup...")

    test_companies = [
        "Google",
        "Google LLC",
        "AMAZON.COM SERVICES LLC",
        "Anthropic",
        "SpaceX",  # Should be non-sponsor
        "Random Unknown Startup",
        "Meta Platforms, Inc.",
        "Stripe",
        "Lockheed Martin",  # Non-sponsor
    ]

    print("\nSponsorship lookup results:")
    print("-" * 60)

    for company in test_companies:
        info = get_sponsorship_info(company)
        sponsor_str = "YES" if info['is_sponsor'] else "NO"
        print(f"{company:35} | {sponsor_str:3} | {info['confidence']:6} | {info['source']}")

    print("\n" + "-" * 60)
    print(f"Stats: {get_sponsor_stats()}")

    # Test job enrichment
    print("\nTesting job enrichment:")
    print("-" * 60)

    jobs = [
        {'company': 'Google', 'title': 'Software Engineer'},
        {'company_name': 'Anthropic', 'title': 'ML Engineer'},
        {'company_slug': 'spacex', 'title': 'Flight Software Engineer'},
        {'company': 'Unknown Startup', 'title': 'Intern'},
    ]

    enriched = add_sponsorship_flags(jobs)
    for job in enriched:
        company = job.get('company') or job.get('company_name') or job.get('company_slug')
        sponsor = job.get('sponsorship_likely')
        conf = job.get('sponsorship_confidence')
        citizenship = job.get('requires_citizenship_likely', False)
        print(f"{company:25} | sponsor={sponsor!s:5} | conf={conf:6} | citizenship_req={citizenship}")
    print("-" * 60)
