"""Hacker News Interview Questions Scraper.

Fetches interview experiences and questions from HN using Algolia API.
Targets: "Ask HN interview", interview experiences, company-specific threads.
Filters to last 4-5 months for recency.

API docs: https://hn.algolia.com/api

UPGRADED: Uses production infrastructure for:
- Stealth headers (anti-detection)
- Rate limiting (adaptive throttling)
- Response caching (TTL-based HTTP cache)
- Monitoring (metrics and health tracking)
"""

import re
import time
from datetime import datetime, timedelta
from typing import Optional, TypedDict
from html import unescape
from dataclasses import dataclass, asdict

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

# Algolia HN API endpoints
ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search"
ALGOLIA_SEARCH_BY_DATE_URL = "https://hn.algolia.com/api/v1/search_by_date"
ALGOLIA_ITEM_URL = "https://hn.algolia.com/api/v1/items"

# Domain for rate limiting
HN_DOMAIN = "hn.algolia.com"

# Cache TTL for interview posts (4 hours - posts don't change often)
HN_CACHE_TTL = 3600 * 4

# Time filter: 5 months ago in Unix timestamp
MONTHS_LOOKBACK = 5


class InterviewQuestion(TypedDict):
    """Structured interview question data."""
    id: str
    company: str
    role: Optional[str]
    question_type: str  # 'technical', 'behavioral', 'system_design', 'oa', 'general'
    question_text: str
    context: str  # Additional context from the post
    source_url: str
    posted_date: str
    difficulty: Optional[str]
    author: str
    upvotes: int
    source: str  # 'hackernews'


@dataclass
class ParsedInterview:
    """Parsed interview experience."""
    company: str
    role: Optional[str]
    questions: list[str]
    question_types: list[str]
    context: str
    difficulty: Optional[str]
    interview_date: Optional[str]


# Major tech companies to detect
MAJOR_COMPANIES = [
    "google", "meta", "facebook", "amazon", "apple", "microsoft", "netflix",
    "uber", "lyft", "airbnb", "stripe", "coinbase", "dropbox", "twitter", "x",
    "linkedin", "salesforce", "adobe", "oracle", "nvidia", "intel", "amd",
    "tesla", "spacex", "palantir", "snowflake", "databricks", "datadog",
    "mongodb", "elastic", "cloudflare", "twilio", "okta", "zendesk",
    "shopify", "square", "block", "robinhood", "plaid", "chime", "sofi",
    "doordash", "instacart", "grubhub", "postmates", "gopuff",
    "snap", "pinterest", "reddit", "discord", "slack", "zoom", "figma",
    "notion", "asana", "monday", "atlassian", "jira", "confluence",
    "github", "gitlab", "bitbucket", "vercel", "netlify", "heroku",
    "aws", "gcp", "azure", "ibm", "vmware", "dell", "hp", "cisco",
    "jane street", "citadel", "two sigma", "de shaw", "hrt", "jump trading",
    "bloomberg", "goldman", "jpmorgan", "morgan stanley", "capital one",
    "bytedance", "tiktok", "alibaba", "tencent", "baidu", "huawei",
    "samsung", "sony", "lg", "panasonic", "nintendo",
    "spotify", "netflix", "hulu", "disney", "warner", "paramount",
    "openai", "anthropic", "deepmind", "cohere", "stability", "midjourney",
    "roblox", "epic", "ea", "activision", "riot", "valve", "unity",
    "waymo", "cruise", "aurora", "nuro", "zoox", "argo",
]

# Role patterns
ROLE_PATTERNS = {
    "swe": re.compile(r"\b(software\s+engineer(?:ing)?|swe|sde|developer)\b", re.I),
    "frontend": re.compile(r"\b(frontend|front[\-\s]?end)\b", re.I),
    "backend": re.compile(r"\b(backend|back[\-\s]?end)\b", re.I),
    "fullstack": re.compile(r"\b(full[\-\s]?stack)\b", re.I),
    "ml": re.compile(r"\b(machine\s+learning|ml|ai|data\s+scientist)\b", re.I),
    "data": re.compile(r"\b(data\s+engineer|de)\b", re.I),
    "infra": re.compile(r"\b(infrastructure|platform|sre|devops|cloud)\b", re.I),
    "mobile": re.compile(r"\b(mobile|ios|android|react\s+native|flutter)\b", re.I),
    "security": re.compile(r"\b(security|infosec|appsec)\b", re.I),
    "pm": re.compile(r"\b(product\s+manager|pm|apm)\b", re.I),
    "quant": re.compile(r"\b(quant|quantitative|trader|trading)\b", re.I),
}

# Question type patterns
QUESTION_TYPE_PATTERNS = {
    "technical": re.compile(
        r"\b(coding|algorithm|data\s+structure|leetcode|hackerrank|implement|write\s+code|"
        r"binary\s+tree|linked\s+list|array|hash|sort|search|dynamic\s+programming|"
        r"recursion|graph|bfs|dfs|two\s+pointer|sliding\s+window)\b", re.I
    ),
    "system_design": re.compile(
        r"\b(system\s+design|design\s+a|architecture|scalability|distributed|"
        r"microservice|api\s+design|database\s+design|load\s+balancer|cache|"
        r"design\s+twitter|design\s+uber|design\s+instagram|high\s+level\s+design)\b", re.I
    ),
    "behavioral": re.compile(
        r"\b(behavioral|tell\s+me\s+about|describe\s+a\s+time|leadership|conflict|"
        r"challenge|failure|success|teamwork|communication|star\s+method|"
        r"why\s+this\s+company|why\s+do\s+you\s+want|greatest\s+strength|weakness)\b", re.I
    ),
    "oa": re.compile(
        r"\b(online\s+assessment|oa|take[\-\s]?home|coding\s+challenge|"
        r"hackerrank\s+test|codesignal|codility|hirevue)\b", re.I
    ),
}

# Interview-related search queries
SEARCH_QUERIES = [
    "Ask HN interview",
    "interview experience",
    "technical interview",
    "coding interview",
    "system design interview",
    "onsite interview",
    "phone screen",
    "interview questions",
    "interview process",
    "got an offer",
    "rejected after interview",
    "failed interview",
    "passed interview",
]


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<p>", "\n\n", text)
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return text.strip()


def get_timestamp_months_ago(months: int) -> int:
    """Get Unix timestamp for N months ago."""
    cutoff = datetime.now() - timedelta(days=months * 30)
    return int(cutoff.timestamp())


def extract_company(text: str) -> Optional[str]:
    """Extract company name from interview post."""
    text_lower = text.lower()

    # Check for explicit company mentions
    for company in MAJOR_COMPANIES:
        # Look for company name with context
        patterns = [
            rf"\b{company}\s+interview",
            rf"interview\s+(?:at|with|for)\s+{company}",
            rf"interviewed\s+(?:at|with|for)\s+{company}",
            rf"{company}\s+(?:onsite|phone|virtual|coding)",
            rf"got\s+(?:an\s+)?offer\s+(?:from|at)\s+{company}",
            rf"rejected\s+(?:by|from|at)\s+{company}",
        ]
        for pattern in patterns:
            if re.search(pattern, text_lower):
                # Return proper case version
                return company.title() if company != "x" else company.upper()

    # Try to extract from "at [Company]" pattern
    at_pattern = re.search(
        r"interview(?:ed|ing)?\s+(?:at|with|for)\s+([A-Z][A-Za-z0-9\s&\-\.]+?)(?:\.|,|\s+and|\s+for|\s+as|\s*$)",
        text, re.I
    )
    if at_pattern:
        company = at_pattern.group(1).strip()
        if 2 < len(company) < 50:
            return company

    return None


def extract_role(text: str) -> Optional[str]:
    """Extract role type from interview post."""
    for role_type, pattern in ROLE_PATTERNS.items():
        if pattern.search(text):
            return role_type
    return None


def extract_question_type(text: str) -> str:
    """Determine the type of interview question."""
    for q_type, pattern in QUESTION_TYPE_PATTERNS.items():
        if pattern.search(text):
            return q_type
    return "general"


def extract_questions(text: str) -> list[tuple[str, str]]:
    """Extract individual interview questions from text.

    Returns list of (question_text, question_type) tuples.
    """
    questions = []

    # Pattern for questions (lines ending with ?)
    question_marks = re.findall(r"([^.!?\n]{10,}?\?)", text)
    for q in question_marks:
        q = q.strip()
        if len(q) > 15 and len(q) < 500:
            q_type = extract_question_type(q)
            questions.append((q, q_type))

    # Pattern for "asked me to" statements
    asked_patterns = re.findall(
        r"(?:asked|told|wanted)\s+(?:me|us|candidates?)\s+to\s+([^.!?\n]{10,}?)(?:\.|!|\n|$)",
        text, re.I
    )
    for q in asked_patterns:
        q = q.strip()
        if len(q) > 15 and len(q) < 500:
            q_type = extract_question_type(q)
            questions.append((f"Asked to: {q}", q_type))

    # Pattern for quoted content (often actual questions)
    quotes = re.findall(r'"([^"]{15,})"', text)
    quotes += re.findall(r"'([^']{15,})'", text)
    for q in quotes:
        q = q.strip()
        if len(q) > 15 and len(q) < 500:
            q_type = extract_question_type(q)
            questions.append((q, q_type))

    # Pattern for problem descriptions
    problem_patterns = re.findall(
        r"(?:problem|question|task)(?:\s+was)?[:\s]+([^.!?\n]{20,}?)(?:\.|!|\n|$)",
        text, re.I
    )
    for q in problem_patterns:
        q = q.strip()
        if len(q) > 20 and len(q) < 500:
            q_type = extract_question_type(q)
            questions.append((f"Problem: {q}", q_type))

    # Deduplicate while preserving order
    seen = set()
    unique_questions = []
    for q, q_type in questions:
        q_lower = q.lower()
        if q_lower not in seen:
            seen.add(q_lower)
            unique_questions.append((q, q_type))

    return unique_questions


def extract_difficulty(text: str) -> Optional[str]:
    """Extract difficulty level from interview post."""
    text_lower = text.lower()

    if any(w in text_lower for w in ["easy", "simple", "straightforward", "basic"]):
        return "easy"
    if any(w in text_lower for w in ["hard", "difficult", "challenging", "tough", "brutal"]):
        return "hard"
    if any(w in text_lower for w in ["medium", "moderate", "average", "standard"]):
        return "medium"

    # Leetcode difficulty mentions
    if "leetcode easy" in text_lower:
        return "easy"
    if "leetcode medium" in text_lower:
        return "medium"
    if "leetcode hard" in text_lower:
        return "hard"

    return None


def is_interview_related(text: str) -> bool:
    """Check if text is about interviews."""
    text_lower = text.lower()

    interview_keywords = [
        "interview", "interviewer", "interviewed", "interviewing",
        "onsite", "phone screen", "coding round", "technical round",
        "behavioral round", "system design round", "hiring manager",
        "recruiter call", "offer", "rejection", "got the job",
        "failed", "passed", "oa", "online assessment", "take home",
    ]

    return any(kw in text_lower for kw in interview_keywords)


# Session singletons for stealth requests
_stealth_session: Optional['StealthSession'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_cache: Optional['ResponseCache'] = None


def _get_stealth_session() -> Optional['StealthSession']:
    """Get or create a stealth session."""
    global _stealth_session
    if _stealth_session is None and INFRA_AVAILABLE:
        _stealth_session = create_stealth_session(
            session_id='hn_interviews',
            min_delay=0.1,
            max_delay=2.0,
            requests_per_minute=60
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


def _make_hn_request(url: str, params: dict = None) -> dict | None:
    """Make HTTP request with infrastructure support.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - AdaptiveRateLimiter for throttling
    - ResponseCache for caching

    Falls back to basic requests if infrastructure unavailable.
    """
    if requests is None:
        print("requests module not available")
        return None

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
            try:
                import json
                return json.loads(cached.content.decode('utf-8'))
            except (ValueError, json.JSONDecodeError):
                pass

    # Apply rate limiting
    if rate_limiter:
        rate_limiter.wait_sync()
    elif INFRA_AVAILABLE:
        time.sleep(0.1)
    else:
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
        response = requests.get(url, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
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
        print(f"Error fetching {url}: {e}")
        if rate_limiter:
            is_rate_limit = '429' in str(e) or 'rate' in str(e).lower()
            rate_limiter.record_failure(is_rate_limit)
        return None
    except ValueError as e:
        print(f"Error parsing JSON from {url}: {e}")
        return None


def fetch_interview_posts(query: str, months: int = MONTHS_LOOKBACK) -> list[dict]:
    """Fetch posts matching query from last N months.

    Uses production infrastructure for rate limiting, caching, and stealth headers.
    Falls back to basic requests if infrastructure unavailable.

    Args:
        query: Search query
        months: Months to look back

    Returns:
        List of HN items (stories and comments)
    """
    timestamp_cutoff = get_timestamp_months_ago(months)

    params = {
        "query": query,
        "tags": "(story,comment)",  # Search both stories and comments
        "numericFilters": f"created_at_i>{timestamp_cutoff}",
        "hitsPerPage": 200,
    }

    all_hits = []

    # Get first page
    data = _make_hn_request(ALGOLIA_SEARCH_BY_DATE_URL, params)
    if not data:
        return all_hits

    hits = data.get("hits", [])
    all_hits.extend(hits)

    # Get more pages if available (up to 3 pages = 600 results)
    nb_pages = min(data.get("nbPages", 1), 3)

    for page in range(1, nb_pages):
        params["page"] = page
        page_data = _make_hn_request(ALGOLIA_SEARCH_BY_DATE_URL, params)
        if page_data:
            all_hits.extend(page_data.get("hits", []))

    return all_hits


def parse_hit_to_questions(hit: dict) -> list[InterviewQuestion]:
    """Parse a single HN hit into interview questions.

    Args:
        hit: Algolia search result hit

    Returns:
        List of InterviewQuestion dicts
    """
    questions = []

    # Get text content
    text = hit.get("story_text") or hit.get("comment_text") or ""
    if not text:
        return questions

    clean_text = clean_html(text)

    # Skip if too short or not interview related
    if len(clean_text) < 50 or not is_interview_related(clean_text):
        return questions

    # Extract metadata
    company = extract_company(clean_text)
    role = extract_role(clean_text)
    difficulty = extract_difficulty(clean_text)

    # Extract questions from text
    extracted_questions = extract_questions(clean_text)

    # If we found specific questions, create entries for each
    if extracted_questions:
        for q_text, q_type in extracted_questions:
            question = InterviewQuestion(
                id=f"hn_{hit.get('objectID')}_{hash(q_text) % 10000}",
                company=company or "Unknown",
                role=role,
                question_type=q_type,
                question_text=q_text,
                context=clean_text[:500] if len(clean_text) > 500 else clean_text,
                source_url=f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
                posted_date=hit.get("created_at", ""),
                difficulty=difficulty,
                author=hit.get("author", "anonymous"),
                upvotes=hit.get("points", 0) or 0,
                source="hackernews",
            )
            questions.append(question)
    else:
        # No specific questions found, but it's interview-related
        # Create a general entry with the experience
        overall_type = extract_question_type(clean_text)
        question = InterviewQuestion(
            id=f"hn_{hit.get('objectID')}",
            company=company or "Unknown",
            role=role,
            question_type=overall_type,
            question_text=clean_text[:300] + "..." if len(clean_text) > 300 else clean_text,
            context=clean_text[:500] if len(clean_text) > 500 else clean_text,
            source_url=f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
            posted_date=hit.get("created_at", ""),
            difficulty=difficulty,
            author=hit.get("author", "anonymous"),
            upvotes=hit.get("points", 0) or 0,
            source="hackernews",
        )
        questions.append(question)

    return questions


def scrape_hackernews(
    months: int = MONTHS_LOOKBACK,
    companies: Optional[list[str]] = None,
    roles: Optional[list[str]] = None,
) -> list[InterviewQuestion]:
    """Scrape Hacker News for interview questions.

    Uses production infrastructure for caching/rate limiting.
    Optionally uses monitoring context if available.

    Args:
        months: Number of months to look back (default 5)
        companies: Optional list of companies to filter for
        roles: Optional list of roles to filter for

    Returns:
        List of InterviewQuestion dicts
    """
    # Use monitoring context if available
    if INFRA_AVAILABLE:
        with monitor_scraper('hn_interviews') as ctx:
            return _scrape_hackernews_impl(months, companies, roles, ctx)
    else:
        return _scrape_hackernews_impl(months, companies, roles, None)


def _scrape_hackernews_impl(
    months: int,
    companies: Optional[list[str]],
    roles: Optional[list[str]],
    ctx
) -> list[InterviewQuestion]:
    """Implementation with optional monitoring context."""
    all_questions: list[InterviewQuestion] = []
    seen_ids: set[str] = set()

    print(f"Scraping HN interviews from last {months} months...")

    # Run all search queries
    for query in SEARCH_QUERIES:
        print(f"  Searching: '{query}'")
        hits = fetch_interview_posts(query, months)
        print(f"    Found {len(hits)} results")

        for hit in hits:
            questions = parse_hit_to_questions(hit)
            for q in questions:
                if q["id"] not in seen_ids:
                    seen_ids.add(q["id"])
                    all_questions.append(q)

    # Search company-specific queries for major companies
    company_search_list = companies or MAJOR_COMPANIES[:30]  # Top 30 companies
    for company in company_search_list:
        query = f"{company} interview"
        print(f"  Searching: '{query}'")
        hits = fetch_interview_posts(query, months)
        print(f"    Found {len(hits)} results")

        for hit in hits:
            questions = parse_hit_to_questions(hit)
            for q in questions:
                if q["id"] not in seen_ids:
                    seen_ids.add(q["id"])
                    all_questions.append(q)

    print(f"Total unique interview questions from HN: {len(all_questions)}")

    # Record metrics
    if ctx:
        ctx.record_questions(
            extracted=len(all_questions),
            new=len(all_questions),
            duplicate=0
        )

    # Filter by company if specified
    if companies:
        companies_lower = [c.lower() for c in companies]
        all_questions = [
            q for q in all_questions
            if q["company"].lower() in companies_lower
        ]
        print(f"After company filter: {len(all_questions)}")

    # Filter by role if specified
    if roles:
        roles_lower = [r.lower() for r in roles]
        all_questions = [
            q for q in all_questions
            if q["role"] and q["role"].lower() in roles_lower
        ]
        print(f"After role filter: {len(all_questions)}")

    # Sort by date (newest first) then by upvotes
    all_questions.sort(
        key=lambda x: (x["posted_date"], x["upvotes"]),
        reverse=True
    )

    return all_questions


def fetch_hn_interviews(months: int = MONTHS_LOOKBACK) -> list[InterviewQuestion]:
    """Alias for scrape_hackernews for consistent naming."""
    return scrape_hackernews(months)


if __name__ == "__main__":
    # Test the scraper
    questions = scrape_hackernews(months=2)

    print("\n--- Sample Results ---")
    for q in questions[:10]:
        print(f"\nCompany: {q['company']}")
        print(f"Role: {q['role']}")
        print(f"Type: {q['question_type']}")
        print(f"Question: {q['question_text'][:100]}...")
        print(f"URL: {q['source_url']}")
        print(f"Date: {q['posted_date']}")
