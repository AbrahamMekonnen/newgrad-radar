"""Reddit interview questions scraper.

Scrapes interview experiences and OA questions from:
- r/csMajors (OA megathreads, interview experiences)
- r/cscareerquestions (interview discussions)
- r/leetcode (company-tagged problems)

Uses Reddit's public JSON API (no auth required for public posts).
For higher rate limits, use PRAW with credentials.

Filters to last 4-5 months of posts.

UPGRADED: Uses production infrastructure for:
- Stealth headers (anti-detection)
- Rate limiting (adaptive throttling - slower for Reddit)
- Response caching (TTL-based HTTP cache)
- Monitoring (metrics and health tracking)
"""

import re
import time
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from html import unescape

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


@dataclass
class InterviewQuestion:
    """Structured interview question data."""
    id: str
    company: str
    role: str  # SWE, Data Science, PM, etc.
    question_type: str  # technical, behavioral, system_design, oa
    question_text: str
    difficulty: Optional[str]  # easy, medium, hard
    source: str  # reddit, leetcode, etc.
    source_url: str
    subreddit: str
    interview_date: Optional[str]  # When the interview occurred
    scraped_at: str  # When we scraped it
    upvotes: int
    num_comments: int
    tags: List[str]  # Additional tags like round type


# Reddit API endpoints
REDDIT_BASE_URL = "https://www.reddit.com"
USER_AGENT = "NewGradRadar/1.0 (Interview Question Scraper)"

# Domain for rate limiting
REDDIT_DOMAIN = "reddit.com"

# Cache TTL for Reddit posts (2 hours - posts can get new comments)
REDDIT_CACHE_TTL = 3600 * 2

# Target subreddits with their focus
SUBREDDITS = {
    "csMajors": {
        "focus": ["oa", "online_assessment", "interview"],
        "flairs": ["Interview Experience", "OA", "Interview Questions"],
    },
    "cscareerquestions": {
        "focus": ["interview", "experience", "rejected", "offer"],
        "flairs": ["Interview Experience", "Interview Discussion"],
    },
    "leetcode": {
        "focus": ["interview", "company", "asked"],
        "flairs": ["Interview Question", "Company"],
    },
}

# Company name patterns - major tech companies
MAJOR_COMPANIES = [
    "google", "meta", "facebook", "amazon", "apple", "microsoft", "netflix",
    "nvidia", "tesla", "uber", "lyft", "airbnb", "stripe", "coinbase",
    "robinhood", "databricks", "snowflake", "palantir", "salesforce", "adobe",
    "linkedin", "twitter", "x corp", "tiktok", "bytedance", "oracle", "ibm",
    "intel", "amd", "qualcomm", "cisco", "vmware", "splunk", "atlassian",
    "slack", "dropbox", "spotify", "snap", "pinterest", "reddit", "doordash",
    "instacart", "grubhub", "affirm", "plaid", "chime", "sofi", "square",
    "block", "paypal", "venmo", "intuit", "workday", "servicenow", "twilio",
    "cloudflare", "datadog", "elastic", "mongodb", "redis", "confluent",
    "hashicorp", "github", "gitlab", "vercel", "netlify", "supabase",
    "jane street", "citadel", "two sigma", "de shaw", "jump trading",
    "hudson river trading", "hrt", "optiver", "imc", "drw", "akuna",
    "capital one", "jpmorgan", "goldman sachs", "morgan stanley", "blackrock",
    "bloomberg", "deloitte", "mckinsey", "bcg", "bain", "accenture",
    "roblox", "epic games", "riot games", "activision", "blizzard", "ea",
    "waymo", "cruise", "aurora", "zoox", "argo", "nuro", "comma.ai",
    "openai", "anthropic", "deepmind", "cohere", "hugging face", "scale ai",
    "figma", "notion", "airtable", "asana", "monday", "canva", "miro",
    "shopify", "squarespace", "wix", "webflow", "contentful", "sanity",
]

# Compile regex patterns for company detection
COMPANY_PATTERNS = {
    company: re.compile(rf"\b{re.escape(company)}\b", re.IGNORECASE)
    for company in MAJOR_COMPANIES
}

# Role patterns
ROLE_PATTERNS = {
    "swe": re.compile(r"\b(swe|software\s*engineer|sde|software\s*developer)\b", re.I),
    "frontend": re.compile(r"\b(frontend|front[\-\s]?end|ui\s*engineer)\b", re.I),
    "backend": re.compile(r"\b(backend|back[\-\s]?end|server\s*engineer)\b", re.I),
    "fullstack": re.compile(r"\b(fullstack|full[\-\s]?stack)\b", re.I),
    "ml": re.compile(r"\b(ml|machine\s*learning|ai\s*engineer|data\s*scientist)\b", re.I),
    "data": re.compile(r"\b(data\s*engineer|de|analytics\s*engineer)\b", re.I),
    "mobile": re.compile(r"\b(mobile|ios|android|react\s*native|flutter)\b", re.I),
    "devops": re.compile(r"\b(devops|sre|site\s*reliability|platform\s*engineer)\b", re.I),
    "security": re.compile(r"\b(security|infosec|appsec|penetration)\b", re.I),
    "pm": re.compile(r"\b(pm|product\s*manager|apm|product\s*management)\b", re.I),
    "quant": re.compile(r"\b(quant|quantitative|trading|hft)\b", re.I),
}

# Question type patterns
QUESTION_TYPE_PATTERNS = {
    "oa": re.compile(r"\b(oa|online\s*assessment|hackerrank|codesignal|codility|hirevue)\b", re.I),
    "system_design": re.compile(r"\b(system\s*design|design\s*a|architecture|scale|distributed)\b", re.I),
    "behavioral": re.compile(r"\b(behavioral|bq|tell\s*me\s*about|leadership\s*principle|lp|star\s*method)\b", re.I),
    "technical": re.compile(r"\b(coding|leetcode|algorithm|data\s*structure|dsa|lc\s*\d+)\b", re.I),
}

# Difficulty patterns
DIFFICULTY_PATTERNS = {
    "easy": re.compile(r"\b(easy|simple|straightforward|basic)\b", re.I),
    "medium": re.compile(r"\b(medium|moderate|mid|standard)\b", re.I),
    "hard": re.compile(r"\b(hard|difficult|challenging|tricky|complex)\b", re.I),
}

# Round patterns
ROUND_PATTERNS = [
    re.compile(r"\b(phone\s*screen|phone\s*interview|recruiter\s*call)\b", re.I),
    re.compile(r"\b(technical\s*screen|tech\s*screen|coding\s*screen)\b", re.I),
    re.compile(r"\b(onsite|on[\-\s]?site|virtual\s*onsite)\b", re.I),
    re.compile(r"\b(final\s*round|final\s*interview|team\s*match)\b", re.I),
    re.compile(r"\b(hiring\s*manager|hm\s*interview)\b", re.I),
    re.compile(r"\b(round\s*\d+|r\d+)\b", re.I),
]

# Date patterns for extracting interview dates
DATE_PATTERNS = [
    re.compile(r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b", re.I),
    re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"),
    re.compile(r"\b(last\s+week|yesterday|today|this\s+week|last\s+month)\b", re.I),
]


def clean_text(text: str) -> str:
    """Clean Reddit post/comment text."""
    if not text:
        return ""
    # Decode HTML entities
    text = unescape(text)
    # Remove markdown links, keep text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    # Remove excessive whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def extract_companies(text: str) -> List[str]:
    """Extract company names from text."""
    companies = []
    text_lower = text.lower()

    for company, pattern in COMPANY_PATTERNS.items():
        if pattern.search(text):
            # Normalize company name
            normalized = company.title()
            if normalized not in companies:
                companies.append(normalized)

    return companies[:5]  # Limit to 5 companies per post


def extract_role(text: str) -> str:
    """Extract role type from text."""
    for role, pattern in ROLE_PATTERNS.items():
        if pattern.search(text):
            return role
    return "swe"  # Default to SWE


def extract_question_type(text: str) -> str:
    """Extract question type from text."""
    for qtype, pattern in QUESTION_TYPE_PATTERNS.items():
        if pattern.search(text):
            return qtype
    return "technical"  # Default to technical


def extract_difficulty(text: str) -> Optional[str]:
    """Extract difficulty level from text."""
    for difficulty, pattern in DIFFICULTY_PATTERNS.items():
        if pattern.search(text):
            return difficulty
    return None


def extract_rounds(text: str) -> List[str]:
    """Extract interview round tags from text."""
    rounds = []
    for pattern in ROUND_PATTERNS:
        matches = pattern.findall(text)
        for match in matches:
            if isinstance(match, tuple):
                match = match[0]
            normalized = match.lower().strip()
            if normalized not in rounds:
                rounds.append(normalized)
    return rounds


def extract_interview_date(text: str, post_date: datetime) -> Optional[str]:
    """Try to extract when the interview occurred."""
    text_lower = text.lower()

    # Check for relative dates
    if "yesterday" in text_lower or "today" in text_lower:
        return post_date.strftime("%Y-%m")
    if "last week" in text_lower or "this week" in text_lower:
        return post_date.strftime("%Y-%m")
    if "last month" in text_lower:
        last_month = post_date - timedelta(days=30)
        return last_month.strftime("%Y-%m")

    # Check for explicit month/year
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(0)

    # Default to post month
    return post_date.strftime("%Y-%m")


def is_interview_post(title: str, selftext: str, flair: str = "") -> bool:
    """Check if a post is about interviews/OAs."""
    combined = f"{title} {selftext} {flair}".lower()

    # Must mention interview-related keywords
    interview_keywords = [
        "interview", "oa", "online assessment", "coding test", "technical screen",
        "phone screen", "onsite", "offer", "rejected", "got the job", "failed",
        "passed", "hackerrank", "codesignal", "leetcode", "coding challenge",
        "hiring process", "application", "applied"
    ]

    if not any(kw in combined for kw in interview_keywords):
        return False

    # Should be about tech roles
    tech_keywords = [
        "swe", "software", "engineer", "developer", "coding", "programming",
        "cs", "computer science", "tech", "faang", "big tech", "startup"
    ]

    return any(kw in combined for kw in tech_keywords)


def extract_questions_from_text(text: str) -> List[str]:
    """Extract specific interview questions from text."""
    questions = []

    # Look for question patterns
    question_indicators = [
        r"(?:asked|gave|got|received|had)\s+(?:me|us|a)?\s*(?:to|:)?\s*[\"']?([^.!?\n]{20,200})\??[\"']?",
        r"(?:question|problem|challenge)\s*(?:was|:)\s*[\"']?([^.!?\n]{20,200})[\"']?",
        r"(?:LC|leetcode)\s*#?\s*(\d+)",
        r"[\"']([^\"']{20,200}\?)[\"']",
    ]

    for pattern_str in question_indicators:
        pattern = re.compile(pattern_str, re.I)
        matches = pattern.findall(text)
        for match in matches:
            clean = clean_text(match)
            if len(clean) > 20 and clean not in questions:
                questions.append(clean[:500])

    # If no explicit questions found, try to extract key sentences
    if not questions:
        sentences = re.split(r'[.!?]\s+', text)
        for sentence in sentences:
            sentence = sentence.strip()
            # Look for sentences that describe problems
            if any(kw in sentence.lower() for kw in [
                "implement", "design", "find", "given", "write", "create",
                "optimize", "solve", "calculate", "determine", "return"
            ]) and 20 < len(sentence) < 500:
                questions.append(clean_text(sentence))
                if len(questions) >= 5:
                    break

    return questions[:10]  # Limit to 10 questions per post


# Session singletons for stealth requests
_stealth_session: Optional['StealthSession'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_cache: Optional['ResponseCache'] = None


def _get_stealth_session() -> Optional['StealthSession']:
    """Get or create a stealth session."""
    global _stealth_session
    if _stealth_session is None and INFRA_AVAILABLE:
        _stealth_session = create_stealth_session(
            session_id='reddit_interviews',
            min_delay=1.0,  # Reddit requires slower rate
            max_delay=5.0,
            requests_per_minute=30  # Reddit is strict
        )
    return _stealth_session


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or create rate limiter."""
    global _rate_limiter
    if _rate_limiter is None and INFRA_AVAILABLE:
        _rate_limiter = AdaptiveRateLimiter(
            base_delay=1.0,  # Reddit needs slower rate
            min_delay=0.5,
            max_delay=10.0,
            target_response_time=1.0
        )
    return _rate_limiter


def _get_response_cache() -> Optional['ResponseCache']:
    """Get or create response cache."""
    global _cache
    if _cache is None and INFRA_AVAILABLE:
        _cache = get_cache()
    return _cache


# --- Reddit OAuth (optional but recommended) ---
# Reddit's public .json endpoints now return HTML; the authenticated
# oauth.reddit.com API still returns JSON. A free "script" app at
# https://www.reddit.com/prefs/apps gives a client id/secret; no user login is
# needed for read-only client_credentials.
_reddit_token_cache = {"token": None, "expires_at": 0.0}


def _get_reddit_token() -> Optional[str]:
    """Return an app-only OAuth bearer token, or None if creds aren't set.

    Tries, in order, the two app-only grants that need NO account password:
    - installed_client (for an "installed app" type)
    - client_credentials (for a confidential "web app" type)
    A "script" app cannot do app-only auth (it needs the password grant), so
    for a no-password setup create an "installed app" at /prefs/apps.
    """
    import os
    cid = os.environ.get("REDDIT_CLIENT_ID")
    csecret = os.environ.get("REDDIT_CLIENT_SECRET") or ""
    if not cid or requests is None:
        return None
    if _reddit_token_cache["token"] and _reddit_token_cache["expires_at"] > time.time() + 60:
        return _reddit_token_cache["token"]
    device_id = os.environ.get("REDDIT_DEVICE_ID", "newgrad_radar_device_0001")
    grants = [
        {"grant_type": "https://oauth.reddit.com/grants/installed_client",
         "device_id": device_id},
        {"grant_type": "client_credentials", "scope": "read"},
    ]
    for data in grants:
        try:
            resp = requests.post(
                "https://www.reddit.com/api/v1/access_token",
                auth=(cid, csecret),
                data=data,
                headers={"User-Agent": USER_AGENT},
                timeout=REQUEST_TIMEOUT,
            )
        except Exception as e:
            print(f"Reddit OAuth error: {e}")
            continue
        if resp.status_code == 200:
            j = resp.json()
            _reddit_token_cache["token"] = j.get("access_token")
            _reddit_token_cache["expires_at"] = time.time() + int(j.get("expires_in", 3600))
            return _reddit_token_cache["token"]
    print("Reddit OAuth failed (all app-only grants) — is this an 'installed app'?")
    return None


def _make_reddit_request(url: str, params: dict = None) -> dict | None:
    """Make HTTP request with infrastructure support.

    Uses production infrastructure:
    - StealthSession for anti-detection headers
    - AdaptiveRateLimiter for throttling (slower for Reddit)
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

    # Apply rate limiting (Reddit requires slower rate)
    if rate_limiter:
        rate_limiter.wait_sync()
    elif INFRA_AVAILABLE:
        time.sleep(1.0)
    else:
        time.sleep(1.0)  # Reddit needs slower rate

    # Get headers - Reddit needs specific User-Agent
    if session:
        headers = session.header_randomizer.get_api_headers()
    else:
        headers = {
            "Accept": "application/json",
        }
    # Always use our Reddit-specific User-Agent
    headers["User-Agent"] = USER_AGENT

    # Prefer the authenticated API when credentials are configured — the public
    # .json endpoints now return HTML, but oauth.reddit.com still returns JSON.
    token = _get_reddit_token()
    if token:
        url = url.replace("https://www.reddit.com", "https://oauth.reddit.com")
        headers["Authorization"] = f"Bearer {token}"

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
            cache.set(full_url, response, ttl=REDDIT_CACHE_TTL)

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


def fetch_subreddit_posts(
    subreddit: str,
    time_filter: str = "month",
    limit: int = 100,
    after: str = None
) -> List[Dict]:
    """Fetch posts from a subreddit using Reddit's JSON API.

    Uses production infrastructure for rate limiting, caching, and stealth headers.
    Falls back to basic requests if infrastructure unavailable.

    Args:
        subreddit: Name of subreddit
        time_filter: 'hour', 'day', 'week', 'month', 'year', 'all'
        limit: Number of posts per request (max 100)
        after: Pagination cursor

    Returns:
        List of post data dicts
    """
    url = f"{REDDIT_BASE_URL}/r/{subreddit}/search.json"

    # Search for interview-related posts
    config = SUBREDDITS.get(subreddit, {})
    keywords = config.get("focus", ["interview"])
    query = " OR ".join(keywords)

    params = {
        "q": query,
        "restrict_sr": "on",
        "sort": "new",
        "t": time_filter,
        "limit": min(limit, 100),
    }

    if after:
        params["after"] = after

    data = _make_reddit_request(url, params)
    if not data:
        return []

    return data.get("data", {}).get("children", [])


def fetch_post_comments(post_id: str, subreddit: str, limit: int = 50) -> List[Dict]:
    """Fetch comments from a post.

    Uses production infrastructure for rate limiting, caching, and stealth headers.
    Falls back to basic requests if infrastructure unavailable.

    Args:
        post_id: Reddit post ID (without t3_ prefix)
        subreddit: Subreddit name
        limit: Max comments to fetch

    Returns:
        List of comment data dicts
    """
    url = f"{REDDIT_BASE_URL}/r/{subreddit}/comments/{post_id}.json"

    params = {
        "limit": limit,
        "depth": 3,
        "sort": "top",
    }

    data = _make_reddit_request(url, params)
    if not data:
        return []

    # Comments are in the second element (Reddit returns [post, comments])
    if isinstance(data, list) and len(data) >= 2:
        comments = data[1].get("data", {}).get("children", [])
        return [c for c in comments if c.get("kind") == "t1"]

    return []


def parse_post(post_data: Dict, subreddit: str) -> List[InterviewQuestion]:
    """Parse a Reddit post into interview questions.

    Args:
        post_data: Raw post data from Reddit API
        subreddit: Source subreddit

    Returns:
        List of InterviewQuestion objects
    """
    questions = []

    data = post_data.get("data", {})

    title = data.get("title", "")
    selftext = data.get("selftext", "")
    flair = data.get("link_flair_text", "") or ""
    post_id = data.get("id", "")
    created_utc = data.get("created_utc", 0)
    upvotes = data.get("ups", 0)
    num_comments = data.get("num_comments", 0)
    permalink = data.get("permalink", "")

    # Skip if not interview-related
    if not is_interview_post(title, selftext, flair):
        return []

    # Extract metadata
    full_text = f"{title}\n\n{selftext}"
    companies = extract_companies(full_text)

    if not companies:
        # Try to extract from title more aggressively
        title_words = title.split()
        for word in title_words:
            clean_word = re.sub(r'[^\w]', '', word)
            if len(clean_word) > 2:
                for company in MAJOR_COMPANIES:
                    if clean_word.lower() == company.lower():
                        companies.append(company.title())
                        break

    # If still no company, try flair
    if not companies and flair:
        for company in MAJOR_COMPANIES:
            if company.lower() in flair.lower():
                companies.append(company.title())

    # Default to "Unknown" if no company found
    if not companies:
        companies = ["Unknown"]

    role = extract_role(full_text)
    question_type = extract_question_type(full_text)
    difficulty = extract_difficulty(full_text)
    rounds = extract_rounds(full_text)

    post_date = datetime.fromtimestamp(created_utc)
    interview_date = extract_interview_date(full_text, post_date)

    # Extract actual questions from text
    extracted_questions = extract_questions_from_text(selftext)

    # Create question objects
    if extracted_questions:
        # Multiple specific questions found
        for i, q_text in enumerate(extracted_questions):
            for company in companies[:2]:  # Limit company combinations
                questions.append(InterviewQuestion(
                    id=f"reddit_{post_id}_{i}",
                    company=company,
                    role=role,
                    question_type=question_type,
                    question_text=q_text,
                    difficulty=difficulty,
                    source="reddit",
                    source_url=f"https://reddit.com{permalink}",
                    subreddit=subreddit,
                    interview_date=interview_date,
                    scraped_at=datetime.utcnow().isoformat(),
                    upvotes=upvotes,
                    num_comments=num_comments,
                    tags=rounds,
                ))
    else:
        # No specific questions, use title as summary
        for company in companies[:2]:
            questions.append(InterviewQuestion(
                id=f"reddit_{post_id}",
                company=company,
                role=role,
                question_type=question_type,
                question_text=clean_text(title)[:500],
                difficulty=difficulty,
                source="reddit",
                source_url=f"https://reddit.com{permalink}",
                subreddit=subreddit,
                interview_date=interview_date,
                scraped_at=datetime.utcnow().isoformat(),
                upvotes=upvotes,
                num_comments=num_comments,
                tags=rounds,
            ))

    return questions


def parse_comment(comment_data: Dict, post_url: str, subreddit: str) -> List[InterviewQuestion]:
    """Parse a comment for interview questions.

    Args:
        comment_data: Raw comment data
        post_url: URL of parent post
        subreddit: Source subreddit

    Returns:
        List of InterviewQuestion objects
    """
    questions = []

    data = comment_data.get("data", {})
    body = data.get("body", "")
    comment_id = data.get("id", "")
    created_utc = data.get("created_utc", 0)
    upvotes = data.get("ups", 0)

    # Skip short or deleted comments
    if len(body) < 50 or body in ["[deleted]", "[removed]"]:
        return []

    # Must be interview-related
    if not is_interview_post("", body, ""):
        return []

    companies = extract_companies(body)
    if not companies:
        companies = ["Unknown"]

    role = extract_role(body)
    question_type = extract_question_type(body)
    difficulty = extract_difficulty(body)
    rounds = extract_rounds(body)

    comment_date = datetime.fromtimestamp(created_utc)
    interview_date = extract_interview_date(body, comment_date)

    extracted_questions = extract_questions_from_text(body)

    if extracted_questions:
        for i, q_text in enumerate(extracted_questions):
            for company in companies[:2]:
                questions.append(InterviewQuestion(
                    id=f"reddit_comment_{comment_id}_{i}",
                    company=company,
                    role=role,
                    question_type=question_type,
                    question_text=q_text,
                    difficulty=difficulty,
                    source="reddit",
                    source_url=f"{post_url}#{comment_id}",
                    subreddit=subreddit,
                    interview_date=interview_date,
                    scraped_at=datetime.utcnow().isoformat(),
                    upvotes=upvotes,
                    num_comments=0,
                    tags=rounds,
                ))

    return questions


def scrape_reddit(
    months: int = 5,
    include_comments: bool = True,
    min_upvotes: int = 5
) -> List[Dict[str, Any]]:
    """Scrape Reddit for interview questions.

    Uses production infrastructure for caching/rate limiting.
    Optionally uses monitoring context if available.

    Args:
        months: Number of months to look back (default 5)
        include_comments: Whether to also scrape comments
        min_upvotes: Minimum upvotes to include

    Returns:
        List of interview question dicts
    """
    # Use monitoring context if available
    if INFRA_AVAILABLE:
        with monitor_scraper('reddit_interviews') as ctx:
            return _scrape_reddit_impl(months, include_comments, min_upvotes, ctx)
    else:
        return _scrape_reddit_impl(months, include_comments, min_upvotes, None)


def _scrape_reddit_impl(
    months: int,
    include_comments: bool,
    min_upvotes: int,
    ctx
) -> List[Dict[str, Any]]:
    """Implementation with optional monitoring context."""
    all_questions: List[InterviewQuestion] = []

    # Calculate cutoff date
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)

    print(f"Scraping Reddit interview questions from last {months} months")
    print(f"Cutoff date: {cutoff_date.strftime('%Y-%m-%d')}")

    for subreddit in SUBREDDITS.keys():
        print(f"\nScraping r/{subreddit}...")

        # Fetch posts
        # Use multiple time filters to get more coverage
        time_filters = ["month"] * min(months, 3) + ["year"] if months > 3 else ["month"]

        seen_ids = set()

        for time_filter in ["month", "year"]:
            after = None
            page = 0
            max_pages = 10  # Limit pagination

            while page < max_pages:
                posts = fetch_subreddit_posts(
                    subreddit,
                    time_filter=time_filter,
                    limit=100,
                    after=after
                )

                if not posts:
                    break

                print(f"  Fetched {len(posts)} posts (page {page + 1})")

                for post in posts:
                    data = post.get("data", {})
                    post_id = data.get("id", "")

                    # Skip duplicates
                    if post_id in seen_ids:
                        continue
                    seen_ids.add(post_id)

                    # Check date
                    created_utc = data.get("created_utc", 0)
                    post_date = datetime.fromtimestamp(created_utc)
                    if post_date < cutoff_date:
                        continue

                    # Check upvotes
                    if data.get("ups", 0) < min_upvotes:
                        continue

                    # Parse post
                    questions = parse_post(post, subreddit)
                    all_questions.extend(questions)

                    # Optionally fetch and parse comments
                    if include_comments and data.get("num_comments", 0) > 5:
                        comments = fetch_post_comments(post_id, subreddit)
                        for comment in comments:
                            permalink = data.get("permalink", "")
                            comment_questions = parse_comment(
                                comment,
                                f"https://reddit.com{permalink}",
                                subreddit
                            )
                            all_questions.extend(comment_questions)

                # Get next page cursor
                last_post = posts[-1] if posts else None
                if last_post:
                    after = f"t3_{last_post['data']['id']}"
                else:
                    break

                page += 1

        print(f"  Total questions from r/{subreddit}: {len([q for q in all_questions if q.subreddit == subreddit])}")

    # Deduplicate by question text
    seen_texts = set()
    unique_questions = []
    for q in all_questions:
        text_key = f"{q.company}:{q.question_text[:100]}"
        if text_key not in seen_texts:
            seen_texts.add(text_key)
            unique_questions.append(q)

    print(f"\nTotal unique questions: {len(unique_questions)}")

    # Record metrics
    if ctx:
        ctx.record_questions(
            extracted=len(all_questions),
            new=len(unique_questions),
            duplicate=len(all_questions) - len(unique_questions)
        )

    # Convert to dicts for JSON serialization
    return [asdict(q) for q in unique_questions]


def fetch_reddit_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Alias for scrape_reddit with default parameters.

    Args:
        months: Number of months to look back

    Returns:
        List of interview question dicts
    """
    return scrape_reddit(months=months, include_comments=True, min_upvotes=3)


if __name__ == "__main__":
    # Test the scraper
    questions = scrape_reddit(months=2, include_comments=False, min_upvotes=10)

    print("\n--- Sample Questions ---")
    for q in questions[:10]:
        print(f"\n[{q['company']}] {q['role']} - {q['question_type']}")
        print(f"  Q: {q['question_text'][:100]}...")
        print(f"  Source: {q['source_url']}")
        print(f"  Upvotes: {q['upvotes']}, Difficulty: {q['difficulty']}")
