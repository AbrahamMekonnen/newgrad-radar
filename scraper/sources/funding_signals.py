"""Funding Signals Aggregator.

Tracks recent funding rounds to identify hot hiring opportunities.
Companies that raised in the last 90 days are likely actively hiring.

Free data sources used:
- TechCrunch RSS feeds
- VentureBeat RSS
- The Information (limited)
- Company press releases
- Y Combinator blog
- a16z blog

Prioritizes Series A-C companies (growth stage = aggressive hiring).
"""

import re
import time
import hashlib
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass
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
    from utils.error_handler import with_retry, CheckpointManager
    INFRA_AVAILABLE = True
except ImportError:
    pass

# Initialize infrastructure components if available
_stealth_session: Optional['StealthSession'] = None
_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_checkpoint_manager: Optional['CheckpointManager'] = None

def _get_session() -> Optional['StealthSession']:
    """Get or create stealth session."""
    global _stealth_session
    if INFRA_AVAILABLE and _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=0.5,
            max_delay=2.0,
            requests_per_minute=30
        )
    return _stealth_session

def _get_cache() -> Optional['ResponseCache']:
    """Get or create response cache with long TTL for funding data."""
    global _cache
    if INFRA_AVAILABLE and _cache is None:
        # Funding data changes infrequently - cache for 6 hours
        _cache = ResponseCache(ttl=6 * 3600)
    return _cache

def _get_checkpoint_manager() -> Optional['CheckpointManager']:
    """Get or create checkpoint manager."""
    global _checkpoint_manager
    if INFRA_AVAILABLE and _checkpoint_manager is None:
        _checkpoint_manager = CheckpointManager()
    return _checkpoint_manager


# User agent for scraping (fallback when infra not available)
USER_AGENT = "NewGradRadar/1.0 (job aggregator for new grads)"

# Rate limiting between requests
RATE_LIMIT_DELAY = 0.5

# How far back to look for funding rounds (in days)
FUNDING_WINDOW_DAYS = 90


@dataclass
class FundingRound:
    """Represents a funding round announcement."""
    company_name: str
    amount: Optional[str]  # "$50M", "$100M", etc.
    round_type: Optional[str]  # "Series A", "Series B", "Seed", etc.
    date: datetime
    source_url: str
    investors: list[str]
    source: str  # "techcrunch", "venturebeat", etc.


# =============================================================================
# Known ATS mappings for funded companies
# Common career page patterns by company domain
# =============================================================================

COMMON_ATS_PATTERNS = {
    "greenhouse": "boards.greenhouse.io/{company}",
    "lever": "jobs.lever.co/{company}",
    "ashby": "jobs.ashbyhq.com/{company}",
    "workday": "{company}.wd1.myworkdayjobs.com",
}


# Pre-mapped funded companies to their career pages/ATS
# Updated as we discover them from funding news
FUNDED_COMPANY_CAREERS = {
    # AI/ML companies (frequently funded)
    "anthropic": {"ats": "greenhouse", "token": "anthropic", "careers_url": "https://boards.greenhouse.io/anthropic"},
    "openai": {"ats": "greenhouse", "token": "openai", "careers_url": "https://boards.greenhouse.io/openai"},
    "mistral": {"ats": "greenhouse", "token": "mistral", "careers_url": "https://boards.greenhouse.io/mistral"},
    "cohere": {"ats": "greenhouse", "token": "cohere", "careers_url": "https://boards.greenhouse.io/cohere"},
    "perplexity": {"ats": "greenhouse", "token": "perplexity", "careers_url": "https://boards.greenhouse.io/perplexity"},
    "anyscale": {"ats": "greenhouse", "token": "anyscale", "careers_url": "https://boards.greenhouse.io/anyscale"},
    "databricks": {"ats": "greenhouse", "token": "databricks", "careers_url": "https://boards.greenhouse.io/databricks"},
    "hugging face": {"ats": "greenhouse", "token": "huggingface", "careers_url": "https://boards.greenhouse.io/huggingface"},
    "runway": {"ats": "lever", "token": "runwayml", "careers_url": "https://jobs.lever.co/runwayml"},
    "character ai": {"ats": "greenhouse", "token": "character", "careers_url": "https://boards.greenhouse.io/character"},
    "together ai": {"ats": "greenhouse", "token": "togetherai", "careers_url": "https://boards.greenhouse.io/togetherai"},
    "groq": {"ats": "greenhouse", "token": "groq", "careers_url": "https://boards.greenhouse.io/groq"},
    "inflection": {"ats": "greenhouse", "token": "inflection", "careers_url": "https://boards.greenhouse.io/inflection"},
    "adept": {"ats": "greenhouse", "token": "adept-ai", "careers_url": "https://boards.greenhouse.io/adept-ai"},
    "stability ai": {"ats": "greenhouse", "token": "stability-ai", "careers_url": "https://boards.greenhouse.io/stability-ai"},
    "replicate": {"ats": "ashby", "token": "replicate", "careers_url": "https://jobs.ashbyhq.com/replicate"},
    "langchain": {"ats": "ashby", "token": "langchain", "careers_url": "https://jobs.ashbyhq.com/langchain"},
    "pinecone": {"ats": "greenhouse", "token": "pinecone", "careers_url": "https://boards.greenhouse.io/pinecone"},
    "weaviate": {"ats": "greenhouse", "token": "weaviate", "careers_url": "https://boards.greenhouse.io/weaviate"},
    "scale ai": {"ats": "greenhouse", "token": "scaleai", "careers_url": "https://boards.greenhouse.io/scaleai"},
    "weights & biases": {"ats": "greenhouse", "token": "wandb", "careers_url": "https://boards.greenhouse.io/wandb"},

    # Fintech
    "stripe": {"ats": "greenhouse", "token": "stripe", "careers_url": "https://boards.greenhouse.io/stripe"},
    "plaid": {"ats": "greenhouse", "token": "plaid", "careers_url": "https://boards.greenhouse.io/plaid"},
    "ramp": {"ats": "greenhouse", "token": "ramp", "careers_url": "https://boards.greenhouse.io/ramp"},
    "brex": {"ats": "greenhouse", "token": "brex", "careers_url": "https://boards.greenhouse.io/brex"},
    "mercury": {"ats": "greenhouse", "token": "mercury", "careers_url": "https://boards.greenhouse.io/mercury"},
    "affirm": {"ats": "greenhouse", "token": "affirm", "careers_url": "https://boards.greenhouse.io/affirm"},
    "chime": {"ats": "greenhouse", "token": "chime", "careers_url": "https://boards.greenhouse.io/chime"},
    "klarna": {"ats": "greenhouse", "token": "klarna", "careers_url": "https://boards.greenhouse.io/klarna"},

    # Infrastructure / Dev tools
    "vercel": {"ats": "greenhouse", "token": "vercel", "careers_url": "https://boards.greenhouse.io/vercel"},
    "supabase": {"ats": "ashby", "token": "supabase", "careers_url": "https://jobs.ashbyhq.com/supabase"},
    "planetscale": {"ats": "ashby", "token": "planetscale", "careers_url": "https://jobs.ashbyhq.com/planetscale"},
    "neon": {"ats": "ashby", "token": "neondatabase", "careers_url": "https://jobs.ashbyhq.com/neondatabase"},
    "retool": {"ats": "greenhouse", "token": "retool", "careers_url": "https://boards.greenhouse.io/retool"},
    "linear": {"ats": "greenhouse", "token": "linear", "careers_url": "https://boards.greenhouse.io/linear"},
    "notion": {"ats": "greenhouse", "token": "notion", "careers_url": "https://boards.greenhouse.io/notion"},
    "airtable": {"ats": "greenhouse", "token": "airtable", "careers_url": "https://boards.greenhouse.io/airtable"},
    "figma": {"ats": "greenhouse", "token": "figma", "careers_url": "https://boards.greenhouse.io/figma"},
    "miro": {"ats": "greenhouse", "token": "miro", "careers_url": "https://boards.greenhouse.io/miro"},

    # Other hot startups
    "discord": {"ats": "greenhouse", "token": "discord", "careers_url": "https://boards.greenhouse.io/discord"},
    "rippling": {"ats": "greenhouse", "token": "rippling", "careers_url": "https://boards.greenhouse.io/rippling"},
    "deel": {"ats": "ashby", "token": "deel", "careers_url": "https://jobs.ashbyhq.com/deel"},
    "vanta": {"ats": "greenhouse", "token": "vanta", "careers_url": "https://boards.greenhouse.io/vanta"},
    "lattice": {"ats": "greenhouse", "token": "lattice", "careers_url": "https://boards.greenhouse.io/lattice"},
}


def normalize_company_name(name: str) -> str:
    """Normalize company name for matching."""
    name = name.lower().strip()
    # Remove common suffixes
    for suffix in [", inc.", " inc.", ", inc", " inc", ", llc", " llc", ", ltd", " ltd", ".ai", ".io"]:
        name = name.replace(suffix, "")
    return name.strip()


def get_career_page_for_company(company_name: str) -> Optional[dict]:
    """Look up career page info for a funded company.

    Returns dict with keys: ats, token, careers_url
    Or None if not found.
    """
    normalized = normalize_company_name(company_name)

    # Direct lookup
    if normalized in FUNDED_COMPANY_CAREERS:
        return FUNDED_COMPANY_CAREERS[normalized]

    # Fuzzy match - check if company name is contained
    for known_name, info in FUNDED_COMPANY_CAREERS.items():
        if known_name in normalized or normalized in known_name:
            return info

    return None


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return text.strip()


def parse_rss_date(date_str: str) -> Optional[datetime]:
    """Parse various RSS date formats."""
    if not date_str:
        return None

    formats = [
        "%a, %d %b %Y %H:%M:%S %z",      # RFC 822 (standard RSS)
        "%a, %d %b %Y %H:%M:%S %Z",
        "%a, %d %b %Y %H:%M:%S GMT",
        "%Y-%m-%dT%H:%M:%S%z",           # ISO 8601
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]

    # Clean up timezone
    date_str = date_str.strip()
    date_str = re.sub(r"\+0000$", "+00:00", date_str)

    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except (ValueError, TypeError):
            continue

    return None


def extract_funding_info(text: str) -> tuple[Optional[str], Optional[str]]:
    """Extract funding amount and round type from text.

    Returns (amount, round_type) tuple.
    """
    amount = None
    round_type = None

    text_lower = text.lower()

    # Extract amount: $X million, $X billion, $XM, $XB
    amount_patterns = [
        r'\$(\d+(?:\.\d+)?)\s*(?:million|m\b)',
        r'\$(\d+(?:\.\d+)?)\s*(?:billion|b\b)',
        r'(\d+(?:\.\d+)?)\s*million\s*(?:dollar|usd|\$)',
        r'raises?\s*\$(\d+(?:\.\d+)?)([mb])?',
    ]

    for pattern in amount_patterns:
        match = re.search(pattern, text_lower)
        if match:
            num = match.group(1)
            # Check if billion
            if 'billion' in text_lower or (len(match.groups()) > 1 and match.group(2) == 'b'):
                amount = f"${num}B"
            else:
                amount = f"${num}M"
            break

    # Extract round type
    round_patterns = [
        (r'\bseed\s*(?:round|funding|investment)?\b', "Seed"),
        (r'\bpre[- ]?seed\b', "Pre-Seed"),
        (r'\bseries\s*a\b', "Series A"),
        (r'\bseries\s*b\b', "Series B"),
        (r'\bseries\s*c\b', "Series C"),
        (r'\bseries\s*d\b', "Series D"),
        (r'\bseries\s*e\b', "Series E"),
        (r'\bgrowth\s*(?:round|funding|equity)\b', "Growth"),
        (r'\bextension\b', "Extension"),
        (r'\bipo\b', "IPO"),
    ]

    for pattern, name in round_patterns:
        if re.search(pattern, text_lower):
            round_type = name
            break

    return amount, round_type


def extract_company_name(title: str, description: str = "") -> Optional[str]:
    """Extract company name from funding announcement title."""
    # Common patterns:
    # "Company raises $XM in Series A"
    # "Company secures $XM funding"
    # "Company closes $XM round"
    # "Company announces $XM Series B"

    patterns = [
        r'^([A-Z][A-Za-z0-9\.\s\-]+?)\s+(?:raises?|secures?|closes?|announces?|lands?|gets?|receives?|nabs?)',
        r'^([A-Z][A-Za-z0-9\.\s\-]+?)\s+(?:Series|Seed|funding)',
        r'^([A-Z][A-Za-z0-9\.\s\-]+?),?\s+(?:a|an|the)',
    ]

    for pattern in patterns:
        match = re.match(pattern, title)
        if match:
            name = match.group(1).strip()
            # Clean up
            name = re.sub(r'\s+$', '', name)
            if len(name) > 2 and len(name) < 50:
                return name

    return None


def is_growth_stage(round_type: Optional[str]) -> bool:
    """Check if funding round is growth stage (Series A-C).

    These companies are most likely to be aggressively hiring.
    """
    if not round_type:
        return True  # Unknown rounds could be growth stage

    growth_stages = ["Series A", "Series B", "Series C", "Growth"]
    return round_type in growth_stages


def is_within_window(date: datetime, days: int = FUNDING_WINDOW_DAYS) -> bool:
    """Check if date is within the funding window."""
    if not date:
        return False

    # Make date timezone-naive for comparison
    if date.tzinfo is not None:
        date = date.replace(tzinfo=None)

    cutoff = datetime.now() - timedelta(days=days)
    return date >= cutoff


# =============================================================================
# RSS Feed Sources
# =============================================================================

# Feed URLs verified live 2026-09. TechCrunch moved its funding feed from
# /category/funding/ (now 404) to the /tag/funding/ tag feed. Sifted and
# Crunchbase block server-side RSS fetches (403); VentureBeat rate-limits (429)
# but succeeds intermittently. Dead/blocked feeds fail per-feed and are skipped,
# so they never take down the scan.
RSS_FEEDS = {
    "techcrunch_funding": {
        "url": "https://techcrunch.com/tag/funding/feed/",
        "name": "TechCrunch Funding",
    },
    "techcrunch_startups": {
        "url": "https://techcrunch.com/category/startups/feed/",
        "name": "TechCrunch Startups",
    },
}


def _make_request(url: str, headers: dict, timeout: int = REQUEST_TIMEOUT) -> Optional[requests.Response]:
    """Make an HTTP request with infrastructure support if available."""
    cache = _get_cache()
    session = _get_session()

    # Try cache first
    if cache:
        cached = cache.get(url)
        if cached:
            # Create a mock response object from cached data
            class CachedResponse:
                def __init__(self, cached_resp):
                    self.content = cached_resp.content
                    self.text = cached_resp.content.decode('utf-8', errors='replace')
                    self.status_code = cached_resp.status_code
                    self.headers = cached_resp.headers
                def raise_for_status(self):
                    pass
            return CachedResponse(cached)

    # Make request with stealth session if available
    if session:
        if not session.before_request(timeout=30):
            print(f"Rate limited, skipping {url}")
            return None
        config = session.get_request_config(url)
        headers.update(config.get('headers', {}))

    response = requests.get(url, headers=headers, timeout=timeout)
    response.raise_for_status()

    # Cache the response
    if cache and response.status_code == 200:
        cache.set(url, response, ttl=6 * 3600)  # Cache for 6 hours

    # Record success for rate limiting
    if session:
        session.after_request(response.status_code)

    return response


def fetch_rss_feed(url: str) -> list[dict]:
    """Fetch and parse an RSS feed.

    Returns list of items with keys: title, link, description, pubDate
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/rss+xml, application/xml, text/xml",
    }

    items = []

    try:
        response = _make_request(url, headers)
        if response is None:
            return items

        # Parse XML
        root = ET.fromstring(response.content)

        # Handle both RSS and Atom formats
        # RSS: channel/item
        # Atom: entry

        # Try RSS format first
        for item in root.findall(".//item"):
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            description = item.findtext("description", "")
            pub_date = item.findtext("pubDate", "")

            items.append({
                "title": clean_html(title),
                "link": link,
                "description": clean_html(description),
                "pubDate": pub_date,
            })

        # Try Atom format
        if not items:
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            for entry in root.findall(".//atom:entry", ns):
                title = entry.findtext("atom:title", "", ns)
                link_elem = entry.find("atom:link", ns)
                link = link_elem.get("href", "") if link_elem is not None else ""
                summary = entry.findtext("atom:summary", "", ns)
                published = entry.findtext("atom:published", entry.findtext("atom:updated", "", ns), ns)

                items.append({
                    "title": clean_html(title),
                    "link": link,
                    "description": clean_html(summary),
                    "pubDate": published,
                })

        # Also try without namespace
        if not items:
            for entry in root.findall(".//entry"):
                title = entry.findtext("title", "")
                link_elem = entry.find("link")
                link = link_elem.get("href", "") if link_elem is not None else ""
                summary = entry.findtext("summary", entry.findtext("content", ""))
                published = entry.findtext("published", entry.findtext("updated", ""))

                items.append({
                    "title": clean_html(title),
                    "link": link,
                    "description": clean_html(summary),
                    "pubDate": published,
                })

    except requests.RequestException as e:
        print(f"Error fetching RSS feed {url}: {e}")
    except ET.ParseError as e:
        print(f"Error parsing RSS feed {url}: {e}")

    return items


def fetch_funding_from_rss() -> list[FundingRound]:
    """Fetch funding announcements from all RSS feeds.

    Returns list of FundingRound objects.
    """
    funding_rounds = []
    seen_urls = set()
    checkpoint_mgr = _get_checkpoint_manager()

    # Load checkpoint if available
    if checkpoint_mgr:
        checkpoint = checkpoint_mgr.load('funding_signals', 'rss_feeds')
        if checkpoint:
            seen_urls = set(checkpoint.progress.get('seen_urls', []))
            print(f"Resuming from checkpoint with {len(seen_urls)} previously seen URLs")

    for feed_id, feed_info in RSS_FEEDS.items():
        print(f"Fetching {feed_info['name']}...")

        items = fetch_rss_feed(feed_info["url"])

        for item in items:
            # Skip if we've seen this URL
            if item["link"] in seen_urls:
                continue
            seen_urls.add(item["link"])

            # Check if this is a funding announcement
            text = f"{item['title']} {item['description']}"
            funding_keywords = [
                "raises", "raised", "funding", "series", "seed",
                "million", "billion", "investment", "round",
                "secures", "closes", "announces", "lands",
            ]

            if not any(kw in text.lower() for kw in funding_keywords):
                continue

            # Extract company name
            company_name = extract_company_name(item["title"], item["description"])
            if not company_name:
                continue

            # Extract funding info
            amount, round_type = extract_funding_info(text)

            # Parse date
            pub_date = parse_rss_date(item["pubDate"])
            if not pub_date:
                pub_date = datetime.now()  # Default to now if can't parse

            # Check if within window
            if not is_within_window(pub_date):
                continue

            funding_rounds.append(FundingRound(
                company_name=company_name,
                amount=amount,
                round_type=round_type,
                date=pub_date,
                source_url=item["link"],
                investors=[],  # Could extract from description
                source=feed_id.split("_")[0],  # e.g., "techcrunch"
            ))

        # Save checkpoint after each feed
        if checkpoint_mgr:
            checkpoint_mgr.update_progress(
                scraper_id='funding_signals',
                source_name='rss_feeds',
                items_processed=len(funding_rounds),
                progress={'seen_urls': list(seen_urls)[-1000:]}  # Keep last 1000 URLs
            )

        # Rate limiting - use infrastructure if available, else basic delay
        if not INFRA_AVAILABLE:
            time.sleep(RATE_LIMIT_DELAY)

    print(f"Found {len(funding_rounds)} funding rounds from RSS feeds")
    return funding_rounds


# =============================================================================
# Crunchbase Alternatives (free data sources)
# =============================================================================

def fetch_yc_recent_companies() -> list[FundingRound]:
    """Fetch recently funded YC companies from public sources.

    Y Combinator companies are always good targets since they just raised.
    """
    funding_rounds = []
    cache = _get_cache()

    # YC's public company list (usually updated after each batch)
    urls = [
        "https://www.ycombinator.com/companies.json",  # May not be available
        "https://api.ycombinator.com/v0.1/companies",  # May require auth
    ]

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    for url in urls:
        try:
            # Check cache first
            cached_response = None
            if cache:
                cached = cache.get(url)
                if cached:
                    cached_response = cached

            if cached_response:
                data = __import__('json').loads(cached_response.content.decode('utf-8'))
            else:
                response = _make_request(url, headers)
                if response is None or response.status_code != 200:
                    continue
                data = __import__('json').loads(response.content.decode('utf-8'))

            companies = data if isinstance(data, list) else data.get("companies", [])

            # Get companies from recent batches (last 2 years)
            current_year = datetime.now().year
            recent_batches = [
                f"W{current_year}", f"S{current_year}",
                f"W{current_year-1}", f"S{current_year-1}",
            ]

            for company in companies:
                if not isinstance(company, dict):
                    continue

                batch = company.get("batch", "")
                if batch and batch not in recent_batches:
                    continue

                name = company.get("name", "")
                if not name:
                    continue

                funding_rounds.append(FundingRound(
                    company_name=name,
                    amount=None,  # YC standard is ~$500K
                    round_type="Seed",  # YC is seed-stage
                    date=datetime.now(),  # Approximation
                    source_url=company.get("url", f"https://www.ycombinator.com/companies/{name.lower().replace(' ', '-')}"),
                    investors=["Y Combinator"],
                    source="yc_batch",
                ))

            if funding_rounds:
                break

        except requests.RequestException as e:
            print(f"Error fetching YC companies from {url}: {e}")
        except ValueError:
            pass

    print(f"Found {len(funding_rounds)} YC companies")
    return funding_rounds


def fetch_github_awesome_funding() -> list[FundingRound]:
    """Fetch funding data from awesome lists on GitHub.

    There are community-maintained lists of recent funding rounds.
    """
    funding_rounds = []

    # These repos sometimes track funding
    awesome_lists = [
        "https://raw.githubusercontent.com/cjbarber/ToolsOfTheTrade/master/README.md",
    ]

    # Could parse markdown for company mentions but this is complex
    # Keeping this as a placeholder for future enhancement

    return funding_rounds


# =============================================================================
# Weekly Funding Scan
# =============================================================================

def run_weekly_funding_scan(
    prioritize_growth_stage: bool = True,
    include_yc: bool = True,
) -> list[dict]:
    """Run a weekly scan for funding announcements.

    Args:
        prioritize_growth_stage: If True, prioritize Series A-C companies
        include_yc: If True, include recent YC batch companies

    Returns:
        List of funded company dicts with career page info
    """
    print("=" * 60)
    print("Running weekly funding scan...")
    print("=" * 60)

    # Use monitoring if available
    if INFRA_AVAILABLE:
        ctx = monitor_scraper('funding_signals')
        ctx.__enter__()
    else:
        ctx = None

    try:
        all_rounds: list[FundingRound] = []

        # Fetch from RSS feeds
        rss_rounds = fetch_funding_from_rss()
        all_rounds.extend(rss_rounds)

        # Fetch YC companies
        if include_yc:
            yc_rounds = fetch_yc_recent_companies()
            all_rounds.extend(yc_rounds)

        # Deduplicate by company name
        seen_companies = set()
        unique_rounds = []
        for round in all_rounds:
            normalized = normalize_company_name(round.company_name)
            if normalized not in seen_companies:
                seen_companies.add(normalized)
                unique_rounds.append(round)

        # Sort by priority:
        # 1. Growth stage (Series A-C) first
        # 2. Then by date (most recent first)
        def sort_key(r: FundingRound) -> tuple:
            is_growth = is_growth_stage(r.round_type)
            # Make timezone-naive for comparison
            date = r.date
            if date.tzinfo is not None:
                date = date.replace(tzinfo=None)
            return (not is_growth, -date.timestamp())

        unique_rounds.sort(key=sort_key)

        # Build result with career page info
        results = []
        for round in unique_rounds:
            # Skip if not growth stage and we're prioritizing
            if prioritize_growth_stage and not is_growth_stage(round.round_type):
                continue

            career_info = get_career_page_for_company(round.company_name)

            result = {
                "company_name": round.company_name,
                "funding_amount": round.amount,
                "round_type": round.round_type,
                "funding_date": round.date.isoformat() if round.date else None,
                "source_url": round.source_url,
                "investors": round.investors,
                "source": round.source,
                "is_growth_stage": is_growth_stage(round.round_type),
                # Career page info (if known)
                "careers_url": career_info["careers_url"] if career_info else None,
                "ats_type": career_info["ats"] if career_info else None,
                "ats_token": career_info["token"] if career_info else None,
            }

            results.append(result)

        print(f"\nFound {len(results)} funded companies (growth stage prioritized)")

        # Print summary
        growth_count = sum(1 for r in results if r["is_growth_stage"])
        with_careers = sum(1 for r in results if r["careers_url"])
        print(f"  - Growth stage (Series A-C): {growth_count}")
        print(f"  - With known career pages: {with_careers}")

        # Record metrics if monitoring is available
        if ctx:
            ctx.record_questions(extracted=len(results), new=len(results))

        return results

    except Exception as e:
        if ctx:
            ctx.__exit__(type(e), e, e.__traceback__)
        raise
    finally:
        if ctx:
            ctx.__exit__(None, None, None)


def get_hot_hiring_companies(limit: int = 50) -> list[dict]:
    """Get companies most likely to be hiring based on recent funding.

    These are companies that:
    1. Raised in the last 90 days
    2. Are in growth stage (Series A-C)
    3. We have career page mappings for

    Returns companies sorted by hiring likelihood.
    """
    all_funded = run_weekly_funding_scan(
        prioritize_growth_stage=True,
        include_yc=True,
    )

    # Filter to only companies we can actually scrape
    scrapeable = [c for c in all_funded if c["careers_url"]]

    # Return top N
    return scrapeable[:limit]


def discover_career_page(company_name: str) -> Optional[str]:
    """Try to discover the career page for an unknown company.

    Attempts various common patterns:
    - {company}.com/careers
    - careers.{company}.com
    - boards.greenhouse.io/{company}
    - jobs.lever.co/{company}
    """
    slug = re.sub(r'[^a-z0-9]', '', company_name.lower())

    urls_to_try = [
        f"https://boards.greenhouse.io/{slug}",
        f"https://jobs.lever.co/{slug}",
        f"https://jobs.ashbyhq.com/{slug}",
        f"https://{slug}.com/careers",
        f"https://careers.{slug}.com",
        f"https://www.{slug}.com/careers",
    ]

    session = _get_session()
    headers = {"User-Agent": USER_AGENT}

    for url in urls_to_try:
        try:
            # Use stealth session if available
            if session:
                if not session.before_request(timeout=10):
                    continue
                config = session.get_request_config(url)
                headers.update(config.get('headers', {}))

            response = requests.head(url, headers=headers, timeout=5, allow_redirects=True)

            if session:
                session.after_request(response.status_code)

            if response.status_code == 200:
                return url
        except requests.RequestException:
            continue

    return None


# =============================================================================
# Export functions
# =============================================================================

def fetch_funding_signals(
    days: int = FUNDING_WINDOW_DAYS,
    growth_stage_only: bool = True,
) -> list[dict]:
    """Main entry point: fetch all funding signals.

    Args:
        days: How many days back to look
        growth_stage_only: Only include Series A-C companies

    Returns:
        List of funded company dicts
    """
    global FUNDING_WINDOW_DAYS
    old_window = FUNDING_WINDOW_DAYS
    FUNDING_WINDOW_DAYS = days

    try:
        results = run_weekly_funding_scan(
            prioritize_growth_stage=growth_stage_only,
            include_yc=True,
        )
        return results
    finally:
        FUNDING_WINDOW_DAYS = old_window


if __name__ == "__main__":
    # Run a test scan
    print("Testing funding signals aggregator...\n")

    companies = fetch_funding_signals(days=90, growth_stage_only=True)

    print("\n" + "=" * 60)
    print("HOT HIRING OPPORTUNITIES (Recently Funded)")
    print("=" * 60)

    for i, company in enumerate(companies[:20], 1):
        print(f"\n{i}. {company['company_name']}")
        if company['funding_amount']:
            print(f"   Raised: {company['funding_amount']} ({company['round_type'] or 'Unknown'})")
        if company['funding_date']:
            print(f"   Date: {company['funding_date'][:10]}")
        if company['careers_url']:
            print(f"   Careers: {company['careers_url']}")
        else:
            print("   Careers: Unknown (could crawl to find)")
