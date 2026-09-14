"""LeetCode Discuss Interview Experience Scraper.

Scrapes interview experiences from LeetCode's Discuss forum using their GraphQL API.
Focuses on company-tagged posts from the last 4-5 months.

Uses production infrastructure:
- StealthSession for anti-detection
- AdaptiveRateLimiter with 3-5s delays (LeetCode is rate-limit heavy)
- ResponseCache for GraphQL response caching (6h TTL)
- text_parser for robust company detection and question extraction
- Monitoring for metrics tracking

Note: Some data (company frequency, premium discuss posts) requires LeetCode Premium.
This scraper extracts publicly accessible content only.
"""

import re
import os
import ssl
import urllib3
import time
import logging
from datetime import datetime, timedelta
from typing import Optional, TypedDict
from html import unescape

# Fallback to basic requests if infrastructure not available
try:
    import requests
except ImportError:
    requests = None

# Infrastructure imports
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# Import infrastructure utilities with INFRA_AVAILABLE flag pattern
INFRA_AVAILABLE = False
try:
    from utils.anti_detection import StealthSession, create_stealth_session
    from utils.cache import ResponseCache, get_cache
    from utils.rate_limiter import AdaptiveRateLimiter
    from utils.text_parser import detect_all_companies_robust, extract_interview_questions
    from utils.monitoring import monitor_scraper
    INFRA_AVAILABLE = True
except ImportError:
    # Define fallback classes to prevent errors
    class AdaptiveRateLimiter:
        def __init__(self, **kwargs): pass
        def wait_sync(self): time.sleep(4.0)
        def record_success(self, t): pass
        def record_failure(self, **kwargs): pass
        def get_delay(self): return 4.0

    class ResponseCache:
        def __init__(self, **kwargs): pass
        def get(self, key): return None
        def set(self, key, value): pass

logger = logging.getLogger(__name__)

# Disable SSL warnings for environments with proxy issues
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Set to True if you have SSL/proxy issues (corporate networks, VPNs)
DISABLE_SSL_VERIFY = os.environ.get("DISABLE_SSL_VERIFY", "true").lower() == "true"

# Use longer TTL for LeetCode - discussion content changes slowly (6 hours)
LC_CACHE_TTL = 3600 * 6

# =============================================================================
# Infrastructure Setup
# =============================================================================

# Global infrastructure instances
_rate_limiter: Optional[AdaptiveRateLimiter] = None
_response_cache: Optional[ResponseCache] = None
_stealth_session: Optional['StealthSession'] = None


def _get_rate_limiter() -> AdaptiveRateLimiter:
    """Get or initialize rate limiter - LeetCode is rate-limit heavy."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = AdaptiveRateLimiter(
            base_delay=1.5,        # LeetCode GraphQL tolerates ~1-2s comfortably
            min_delay=1.0,         # floor
            max_delay=30.0,        # Max 30s on errors
            target_response_time=2.0,
            error_penalty_multiplier=2.5,  # Aggressive backoff on errors (429)
            jitter_factor=0.25,    # 25% jitter
        )
        logger.debug("AdaptiveRateLimiter initialized for LeetCode scraper")
    return _rate_limiter


def _get_cache() -> Optional[ResponseCache]:
    """Get or initialize response cache."""
    global _response_cache
    if _response_cache is None and INFRA_AVAILABLE:
        try:
            _response_cache = ResponseCache(ttl=LC_CACHE_TTL)
            logger.debug("ResponseCache initialized for LeetCode scraper (6h TTL)")
        except Exception as e:
            logger.warning(f"Failed to initialize cache: {e}")
    return _response_cache


def _get_stealth_session() -> Optional['StealthSession']:
    """Disabled: LeetCode's GraphQL endpoint returns EMPTY bodies for the
    stealth session's header fingerprint (verified — simple browser headers
    return 200 + JSON reliably, stealth headers return char-0 empty). We rely
    on the AdaptiveRateLimiter for pacing and plain browser headers instead.
    """
    return None


def get_session():
    """Get a session with proper headers for requests."""
    if requests is None:
        return None

    session = requests.Session()
    session.verify = not DISABLE_SSL_VERIFY
    return session


def wait_for_rate_limit():
    """Wait according to adaptive rate limiter."""
    rate_limiter = _get_rate_limiter()
    if rate_limiter:
        rate_limiter.wait_sync()
    else:
        time.sleep(4.0)  # Fallback delay


def check_circuit_breaker() -> bool:
    """Check if we should allow requests. Always returns True since we use adaptive rate limiting."""
    return True


# LeetCode GraphQL endpoint
LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql"

# Request timeout in seconds
REQUEST_TIMEOUT = 30

# How many months back to scrape
MONTHS_BACK = 5


class InterviewQuestion(TypedDict):
    """Structure for an interview question/experience."""
    company: str
    position: str
    questions: list[str]
    difficulty: str
    date: str
    source: str
    external_id: str
    url: str
    location: Optional[str]
    offer_received: Optional[bool]
    interview_rounds: Optional[int]
    raw_content: str


# GraphQL query to fetch discuss posts with interview tag
DISCUSS_POSTS_QUERY = """
query categoryTopicList($categories: [String!]!, $first: Int!, $orderBy: TopicSortingOption, $skip: Int) {
    categoryTopicList(categories: $categories, orderBy: $orderBy, first: $first, skip: $skip) {
        totalNum
        edges {
            cursor
            node {
                id
                title
                commentCount
                viewCount
            }
        }
    }
}
"""

# GraphQL query to fetch single topic details
TOPIC_DETAIL_QUERY = """
query topic($topicId: Int!) {
    topic(id: $topicId) {
        id
        title
        post {
            id
            content
            creationDate
        }
        tags
    }
}
"""

# Company name patterns to extract
COMPANY_PATTERNS = [
    # "Google Interview Experience" or "Meta | SWE Interview"
    re.compile(r"^([A-Za-z0-9][A-Za-z0-9\s\.\-&]+?)(?:\s*[\|\-\(\[]|\s+Interview|\s+SWE|\s+Software)", re.IGNORECASE),
    # "Interview at Google" or "My experience at Meta"
    re.compile(r"(?:interview|experience|offer)\s+(?:at|with|from)\s+([A-Za-z0-9][A-Za-z0-9\s\.\-&]+?)(?:\s*[\|\-\(\[]|$)", re.IGNORECASE),
]

# Position/role patterns
POSITION_PATTERNS = [
    re.compile(r"\b(SWE|Software Engineer(?:ing)?|SDE|Software Developer)\b", re.IGNORECASE),
    re.compile(r"\b(Frontend|Front[\-\s]?end)\s*(?:Engineer|Developer)?\b", re.IGNORECASE),
    re.compile(r"\b(Backend|Back[\-\s]?end)\s*(?:Engineer|Developer)?\b", re.IGNORECASE),
    re.compile(r"\b(Full[\-\s]?Stack)\s*(?:Engineer|Developer)?\b", re.IGNORECASE),
    re.compile(r"\b(ML|Machine Learning)\s*Engineer\b", re.IGNORECASE),
    re.compile(r"\b(Data\s*(?:Engineer|Scientist))\b", re.IGNORECASE),
    re.compile(r"\b(New\s*Grad|Entry[\-\s]?Level|Junior)\b", re.IGNORECASE),
    re.compile(r"\b(Intern(?:ship)?)\b", re.IGNORECASE),
]

# Difficulty indicators
DIFFICULTY_PATTERNS = {
    "easy": re.compile(r"\b(easy|straightforward|simple|basic)\b", re.IGNORECASE),
    "medium": re.compile(r"\b(medium|moderate|standard|typical)\b", re.IGNORECASE),
    "hard": re.compile(r"\b(hard|difficult|challenging|tough)\b", re.IGNORECASE),
}

# Question extraction patterns
QUESTION_PATTERNS = [
    # Numbered questions: "1. Two Sum", "Q1:", "Question 1:"
    re.compile(r"(?:^|\n)\s*(?:Q?\.?\s*)?(\d+)\s*[\.:\)]\s*(.+?)(?=\n|$)", re.MULTILINE),
    # Bullet points with LeetCode problem names
    re.compile(r"(?:^|\n)\s*[\-\*•]\s*(.+?(?:sum|array|string|tree|graph|dp|linked|hash|binary|search|sort).+?)(?=\n|$)", re.IGNORECASE | re.MULTILINE),
    # "Asked me to solve X" patterns
    re.compile(r"(?:asked|given|solve|implement|code|write)\s+(?:me\s+)?(?:to\s+)?(.+?(?:problem|question|algorithm|data structure).+?)(?=\.|,|\n|$)", re.IGNORECASE),
]

# Common LeetCode problem names to identify
LEETCODE_PROBLEMS = [
    "Two Sum", "Reverse Linked List", "Binary Search", "Merge Intervals",
    "Valid Parentheses", "Maximum Subarray", "LRU Cache", "Meeting Rooms",
    "Number of Islands", "Course Schedule", "Word Break", "Coin Change",
    "Longest Substring", "3Sum", "Product of Array", "Rotate Array",
    "Min Stack", "Valid Anagram", "Group Anagrams", "Top K Frequent",
    "Clone Graph", "Pacific Atlantic", "Longest Consecutive", "Alien Dictionary",
    "Graph Valid Tree", "Word Ladder", "Serialize Binary Tree", "Design Twitter",
    "Find Median", "Sliding Window", "Trapping Rain Water", "Container With Most Water",
]


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<p>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return text.strip()


def extract_company(title: str, content: str) -> str:
    """Extract company name from title or content."""
    # Known companies list - check these first (most reliable)
    known_companies = [
        "Google", "Meta", "Facebook", "Amazon", "Apple", "Microsoft", "Netflix",
        "Uber", "Airbnb", "Stripe", "Coinbase", "LinkedIn", "Twitter", "X",
        "Snap", "ByteDance", "TikTok", "Dropbox", "Salesforce", "Adobe", "Oracle",
        "IBM", "Intel", "Nvidia", "Qualcomm", "PayPal", "Square", "Block",
        "Robinhood", "Doordash", "Instacart", "Lyft", "Pinterest", "Reddit",
        "Spotify", "Zoom", "Slack", "Atlassian", "Databricks", "Snowflake",
        "Palantir", "Citadel", "Jane Street", "Two Sigma", "DE Shaw", "Goldman",
        "Morgan Stanley", "JPMorgan", "Bloomberg", "Capital One", "Visa",
        "Walmart", "Target", "Expedia", "Booking", "Wayfair", "Zillow", "Redfin",
        "Twilio", "Cloudflare", "Datadog", "MongoDB", "Elastic", "HashiCorp",
        "Rippling", "Figma", "Notion", "Canva", "Discord", "Roblox", "Epic",
        "Cruise", "Waymo", "Aurora", "Rivian", "Tesla", "SpaceX", "Anduril",
        "OpenAI", "Anthropic", "Scale", "Hugging Face", "Cohere",
    ]

    # Check known companies first (handles "Meta E4" → "Meta")
    title_lower = title.lower()
    for company in known_companies:
        if company.lower() in title_lower:
            return company

    # Also check content
    content_lower = content.lower()
    for company in known_companies:
        if company.lower() in content_lower:
            return company

    # Fall back to pattern matching for unknown companies
    for pattern in COMPANY_PATTERNS:
        match = pattern.search(title)
        if match:
            company = match.group(1).strip()
            company = re.sub(r"[\s\-\|,]+$", "", company)
            # Filter out non-company patterns
            skip_words = ["interview", "experience", "reject", "offer", "phone", "onsite", "need", "information"]
            if any(w in company.lower() for w in skip_words):
                continue
            if 2 < len(company) < 50:
                return company

    # Check content first line
    first_line = content.split("\n")[0][:200]
    for pattern in COMPANY_PATTERNS:
        match = pattern.search(first_line)
        if match:
            company = match.group(1).strip()
            company = re.sub(r"[\s\-\|,]+$", "", company)
            skip_words = ["interview", "experience", "reject", "offer", "phone", "onsite", "need", "information"]
            if any(w in company.lower() for w in skip_words):
                continue
            if 2 < len(company) < 50:
                return company

    return "Unknown"


def extract_position(title: str, content: str) -> str:
    """Extract position/role from title or content."""
    combined = f"{title}\n{content[:500]}"

    for pattern in POSITION_PATTERNS:
        match = pattern.search(combined)
        if match:
            return match.group(1).strip()

    return "Software Engineer"


def extract_difficulty(content: str) -> str:
    """Estimate interview difficulty from content."""
    content_lower = content.lower()

    # Count difficulty indicators
    scores = {
        "easy": len(DIFFICULTY_PATTERNS["easy"].findall(content_lower)),
        "medium": len(DIFFICULTY_PATTERNS["medium"].findall(content_lower)),
        "hard": len(DIFFICULTY_PATTERNS["hard"].findall(content_lower)),
    }

    # Return highest scoring, default to medium
    if scores["hard"] > scores["medium"] and scores["hard"] > scores["easy"]:
        return "hard"
    elif scores["easy"] > scores["medium"] and scores["easy"] > scores["hard"]:
        return "easy"
    return "medium"


def extract_questions(content: str) -> list[str]:
    """Extract interview questions from content."""
    questions = []

    # Look for numbered questions
    numbered = re.findall(r"(?:^|\n)\s*\d+[\.:\)]\s*(.+?)(?=\n|$)", content, re.MULTILINE)
    for q in numbered:
        q = q.strip()
        if len(q) > 10 and len(q) < 200:
            questions.append(q)

    # Look for LeetCode problem mentions
    for problem in LEETCODE_PROBLEMS:
        if problem.lower() in content.lower():
            if problem not in questions:
                questions.append(problem)

    # Look for "Asked X" patterns
    asked_patterns = re.findall(
        r"(?:asked|given|had to solve|coding question was)\s+(?:me\s+)?(?:to\s+)?([^\.]+?)(?:\.|,|$)",
        content,
        re.IGNORECASE
    )
    for q in asked_patterns:
        q = q.strip()
        if 10 < len(q) < 200 and q not in questions:
            questions.append(q)

    return questions[:10]  # Limit to 10 questions


def extract_offer_status(content: str) -> Optional[bool]:
    """Determine if offer was received."""
    content_lower = content.lower()

    offer_positive = [
        "got the offer", "received offer", "accepted offer", "got an offer",
        "received the offer", "offer accepted", "got hired", "i accepted",
    ]
    offer_negative = [
        "rejected", "no offer", "didn't get", "didn't receive", "failed",
        "didn't pass", "ghosted", "declined me", "turned down",
    ]

    for phrase in offer_positive:
        if phrase in content_lower:
            return True

    for phrase in offer_negative:
        if phrase in content_lower:
            return False

    return None


def extract_rounds(content: str) -> Optional[int]:
    """Extract number of interview rounds."""
    patterns = [
        r"(\d+)\s*(?:rounds?|interviews?|stages?)",
        r"(?:round|interview|stage)\s*(\d+)",
        r"(\d+)\s*(?:phone|onsite|virtual|technical)",
    ]

    for pattern in patterns:
        matches = re.findall(pattern, content, re.IGNORECASE)
        if matches:
            nums = [int(m) for m in matches if int(m) <= 10]
            if nums:
                return max(nums)

    return None


def is_valid_interview_post(title: str, content: str) -> bool:
    """Filter out non-interview posts."""
    combined = f"{title}\n{content}".lower()

    # Must mention interview-related keywords
    interview_keywords = [
        "interview", "onsite", "phone screen", "offer", "rejected",
        "hiring", "coding round", "technical round", "behavioral",
        "system design", "online assessment", "oa", "final round",
    ]

    if not any(kw in combined for kw in interview_keywords):
        return False

    # Must be reasonably long
    if len(content) < 200:
        return False

    # Filter out "I'm preparing for" posts (not actual experiences)
    prep_only = ["how do i prepare", "tips for", "how to prepare", "any advice"]
    if any(phrase in combined for phrase in prep_only) and "experience" not in combined:
        return False

    return True


def fetch_discuss_posts(
    category: str = "interview-experience",
    skip: int = 0,
    limit: int = 50,
    query: str = ""
) -> dict:
    """Fetch discussion posts from LeetCode with full infrastructure support.

    Uses:
    - ResponseCache for efficiency (6h TTL)
    - AdaptiveRateLimiter for rate limiting (3-5s delays)
    - StealthSession for anti-detection headers

    Args:
        category: Discussion category slug
        skip: Number of posts to skip (pagination)
        limit: Number of posts to fetch
        query: Search query string

    Returns:
        API response dict with edges and totalNum
    """
    # Check circuit breaker first
    if not check_circuit_breaker():
        return {}

    cache = _get_cache()
    rate_limiter = _get_rate_limiter()
    stealth = _get_stealth_session()

    # Generate cache key
    cache_key = f"leetcode_discuss:{category}:{skip}:{limit}:{query}"

    # Check cache first
    if cache:
        cached = cache.get(cache_key)
        if cached:
            logger.debug(f"Cache hit for {cache_key}")
            content = cached.content if hasattr(cached, 'content') else cached
            if isinstance(content, bytes):
                import json
                return json.loads(content)
            return content

    payload = {
        "query": DISCUSS_POSTS_QUERY,
        "variables": {
            "categories": [category],
            "skip": skip,
            "first": limit,
            "orderBy": "newest_to_oldest",
        }
    }

    # Wait for rate limit
    wait_for_rate_limit()

    start_time = time.time()
    try:
        session = get_session()
        if session is None:
            logger.error("requests module not available")
            return {}

        # Use stealth headers if available, else fallback
        if stealth:
            config = stealth.get_request_config(LEETCODE_GRAPHQL_URL)
            headers = config['headers']
            headers.update({
                "Content-Type": "application/json",
                "Origin": "https://leetcode.com",
                "Referer": "https://leetcode.com/discuss/interview-experience",
                "Accept": "application/json",
            })
        else:
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Origin": "https://leetcode.com",
                "Referer": "https://leetcode.com/discuss/interview-experience",
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.9",
            }

        response = session.post(
            LEETCODE_GRAPHQL_URL,
            json=payload,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            verify=not DISABLE_SSL_VERIFY
        )

        response_time = time.time() - start_time

        # Check for rate limiting
        if response.status_code == 429:
            if rate_limiter:
                rate_limiter.record_failure(is_rate_limit=True)
            logger.warning("LeetCode rate limit hit (429)")
            return {}

        response.raise_for_status()
        data = response.json()
        result = data.get("data", {}).get("categoryTopicList", {})

        # Record success
        if rate_limiter:
            rate_limiter.record_success(response_time)

        # Cache the result
        if cache:
            import json as json_module
            cache.set(cache_key, {'content': json_module.dumps(result).encode('utf-8'), 'status_code': 200, 'headers': {}})
            logger.debug(f"Cached response for {cache_key}")

        return result

    except requests.RequestException as e:
        if rate_limiter:
            rate_limiter.record_failure()
        logger.error(f"Error fetching LeetCode discuss posts: {e}")
        return {}
    except ValueError as e:
        logger.error(f"Error parsing LeetCode response: {e}")
        return {}


def fetch_topic_detail(topic_id: int) -> dict:
    """Fetch full details of a discussion topic with infrastructure support.

    Uses:
    - ResponseCache for caching (6h TTL)
    - AdaptiveRateLimiter for rate limiting
    - StealthSession for anti-detection headers

    Args:
        topic_id: The topic ID to fetch

    Returns:
        Topic dict with title, content, tags
    """
    # Check circuit breaker first
    if not check_circuit_breaker():
        return {}

    cache = _get_cache()
    rate_limiter = _get_rate_limiter()
    stealth = _get_stealth_session()

    # Check cache
    cache_key = f"leetcode_topic:{topic_id}"
    if cache:
        cached = cache.get(cache_key)
        if cached:
            content = cached.content if hasattr(cached, 'content') else cached
            if isinstance(content, bytes):
                import json
                return json.loads(content)
            return content

    payload = {
        "query": TOPIC_DETAIL_QUERY,
        "variables": {
            "topicId": topic_id
        }
    }

    # Wait for rate limit
    wait_for_rate_limit()

    start_time = time.time()
    try:
        session = get_session()
        if session is None:
            logger.error("requests module not available")
            return {}

        # Use stealth headers if available, else fallback
        if stealth:
            config = stealth.get_request_config(LEETCODE_GRAPHQL_URL)
            headers = config['headers']
            headers.update({
                "Content-Type": "application/json",
                "Origin": "https://leetcode.com",
                "Referer": f"https://leetcode.com/discuss/interview-experience/{topic_id}",
                "Accept": "application/json",
            })
        else:
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Origin": "https://leetcode.com",
                "Referer": f"https://leetcode.com/discuss/interview-experience/{topic_id}",
                "Accept": "application/json",
            }

        response = session.post(
            LEETCODE_GRAPHQL_URL,
            json=payload,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            verify=not DISABLE_SSL_VERIFY
        )

        response_time = time.time() - start_time

        if response.status_code == 429:
            if rate_limiter:
                rate_limiter.record_failure(is_rate_limit=True)
            logger.warning(f"Rate limit hit fetching topic {topic_id}")
            return {}

        response.raise_for_status()
        data = response.json()
        result = data.get("data", {}).get("topic", {})

        # Record success
        if rate_limiter:
            rate_limiter.record_success(response_time)

        # Cache result
        if cache:
            import json as json_module
            cache.set(cache_key, {'content': json_module.dumps(result).encode('utf-8'), 'status_code': 200, 'headers': {}})

        return result

    except requests.RequestException as e:
        if rate_limiter:
            rate_limiter.record_failure()
        logger.error(f"Error fetching topic {topic_id}: {e}")
        return {}
    except ValueError as e:
        logger.error(f"Error parsing topic {topic_id}: {e}")
        return {}


def parse_topic_to_interview(topic: dict) -> Optional[InterviewQuestion]:
    """Parse a topic dict into an InterviewQuestion.

    Args:
        topic: Topic dict from API

    Returns:
        InterviewQuestion or None if invalid
    """
    if not topic:
        return None

    topic_id = topic.get("id")
    title = topic.get("title", "")
    post = topic.get("post", {})
    content = clean_html(post.get("content", ""))
    creation_date = post.get("creationDate")
    # Tags are now a list of strings, not objects
    tags = topic.get("tags", []) or []

    # Validate it's an interview post
    if not is_valid_interview_post(title, content):
        return None

    # Note: Date filtering is done in the main scrape loop, not here
    # This allows more flexible control over date ranges

    # Extract fields
    company = extract_company(title, content)
    if company == "Unknown":
        # Try to get company from tags
        company_tags = [t for t in tags if t.lower() not in ["interview", "experience", "swe"]]
        if company_tags:
            company = company_tags[0]

    if company == "Unknown":
        return None

    position = extract_position(title, content)
    difficulty = extract_difficulty(content)
    questions = extract_questions(content)
    offer = extract_offer_status(content)
    rounds = extract_rounds(content)

    # Format date
    date_str = ""
    if creation_date:
        try:
            date_str = datetime.fromtimestamp(creation_date).strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            date_str = datetime.now().strftime("%Y-%m-%d")

    return InterviewQuestion(
        company=company,
        position=position,
        questions=questions,
        difficulty=difficulty,
        date=date_str,
        source="leetcode_discuss",
        external_id=str(topic_id),
        url=f"https://leetcode.com/discuss/interview-experience/{topic_id}",
        location=None,  # LeetCode doesn't typically include location
        offer_received=offer,
        interview_rounds=rounds,
        raw_content=content[:2000],  # Keep truncated content for reference
    )


def scrape_leetcode_discuss(
    max_posts: int = 500,
    company_filter: Optional[str] = None,
    months_back: int = MONTHS_BACK,
) -> list[InterviewQuestion]:
    """Scrape interview experiences from LeetCode Discuss with full infrastructure.

    Uses production infrastructure:
    - StealthSession for anti-detection
    - ResponseCache for caching (6h TTL)
    - AdaptiveRateLimiter for rate limiting (3-5s delays)
    - text_parser for robust company detection
    - Monitoring for metrics tracking

    Args:
        max_posts: Maximum number of posts to fetch
        company_filter: Optional company name to filter by
        months_back: How many months back to scrape

    Returns:
        List of validated InterviewQuestion dicts
    """
    global MONTHS_BACK
    MONTHS_BACK = months_back

    # Use monitoring context if available
    monitoring_ctx = None
    if INFRA_AVAILABLE:
        try:
            monitoring_ctx = monitor_scraper('leetcode_discuss')
            monitoring_ctx.__enter__()
        except Exception as e:
            logger.warning(f"Failed to start monitoring: {e}")

    logger.info(f"Scraping LeetCode Discuss (last {months_back} months)...")
    print(f"Scraping LeetCode Discuss (last {months_back} months)...")

    results: list[InterviewQuestion] = []
    skip = 0
    batch_size = 50
    empty_batches = 0
    max_empty = 3  # Stop after 3 consecutive batches with no valid posts
    total_fetched = 0
    duplicates = 0
    invalid = 0

    while len(results) < max_posts and empty_batches < max_empty:
        # Check circuit breaker before batch
        if not check_circuit_breaker():
            logger.warning("Circuit breaker open, stopping scrape")
            break

        print(f"  Fetching posts {skip} to {skip + batch_size}...")

        # Build query
        query = company_filter if company_filter else ""

        # Fetch batch
        response = fetch_discuss_posts(
            category="interview-experience",
            skip=skip,
            limit=batch_size,
            query=query,
        )

        edges = response.get("edges", [])
        if not edges:
            print("  No more posts found")
            break

        batch_valid = 0
        old_posts_count = 0

        for edge in edges:
            node = edge.get("node", {})
            topic_id = node.get("id")
            title = node.get("title", "")

            # Skip pinned how-to posts
            if "how to write" in title.lower():
                continue

            total_fetched += 1

            # Fetch full topic (list query doesn't include post data)
            topic = fetch_topic_detail(int(topic_id))
            if not topic:
                continue

            # Check date from topic detail
            post = topic.get("post", {})
            creation_date = post.get("creationDate")

            if creation_date:
                try:
                    post_date = datetime.fromtimestamp(creation_date)
                    cutoff = datetime.now() - timedelta(days=months_back * 30)
                    if post_date < cutoff:
                        old_posts_count += 1
                        # Allow some old posts before stopping (in case of non-chronological results)
                        if old_posts_count >= 10:
                            print(f"  Found {old_posts_count} posts older than {months_back} months, stopping")
                            empty_batches = max_empty  # Force exit
                            break
                        continue
                except (ValueError, TypeError):
                    pass

            interview = parse_topic_to_interview(topic)

            if interview:
                # Apply company filter if specified
                if company_filter and company_filter.lower() not in interview["company"].lower():
                    continue

                # Use text_parser for enhanced company detection if available
                if INFRA_AVAILABLE:
                    try:
                        text_for_company = interview.get('raw_content', '') + ' ' + interview.get('company', '')
                        companies = detect_all_companies_robust(text_for_company)
                        if companies:
                            interview['company'] = companies[0].normalized.replace('_', ' ').title()
                    except Exception:
                        pass

                results.append(interview)
                batch_valid += 1
                print(f"    + {interview['company']} - {interview['position']}")

                if len(results) >= max_posts:
                    break

        if batch_valid == 0:
            empty_batches += 1
        else:
            empty_batches = 0

        skip += batch_size

    # Log final stats
    logger.info(f"LeetCode scrape complete: {len(results)} valid, {invalid} invalid, {total_fetched} fetched")
    print(f"Scraped {len(results)} interview experiences from LeetCode (fetched {total_fetched}, {invalid} invalid)")

    # Record metrics and close monitoring
    if monitoring_ctx:
        try:
            monitoring_ctx.record_questions(
                extracted=total_fetched,
                new=len(results),
                duplicate=duplicates,
                invalid=invalid,
            )
            monitoring_ctx.__exit__(None, None, None)
        except Exception as e:
            logger.warning(f"Failed to close monitoring: {e}")

    return results


def scrape_leetcode_by_company(company: str, months_back: int = MONTHS_BACK) -> list[InterviewQuestion]:
    """Scrape interview experiences for a specific company.

    Args:
        company: Company name to search for
        months_back: How many months back to scrape

    Returns:
        List of InterviewQuestion dicts
    """
    return scrape_leetcode_discuss(
        max_posts=100,
        company_filter=company,
        months_back=months_back,
    )


if __name__ == "__main__":
    # Test scraping
    interviews = scrape_leetcode_discuss(max_posts=20, months_back=5)

    print("\n" + "=" * 60)
    print(f"Found {len(interviews)} interview experiences")
    print("=" * 60)

    for interview in interviews[:5]:
        print(f"\nCompany: {interview['company']}")
        print(f"Position: {interview['position']}")
        print(f"Difficulty: {interview['difficulty']}")
        print(f"Date: {interview['date']}")
        print(f"Offer: {interview['offer_received']}")
        print(f"Rounds: {interview['interview_rounds']}")
        print(f"Questions ({len(interview['questions'])}):")
        for q in interview['questions'][:3]:
            print(f"  - {q}")
        print(f"URL: {interview['url']}")
