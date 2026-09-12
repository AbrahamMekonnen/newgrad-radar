"""Dev.to Interview Questions Scraper.

Fetches interview experiences and questions from Dev.to articles.
Uses the public Dev.to API (no auth required for reading).

API docs: https://developers.forem.com/api/v1

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


# Dev.to API endpoint
DEVTO_API_URL = "https://dev.to/api/articles"

# Major tech companies for detection
MAJOR_COMPANIES = [
    "google", "meta", "facebook", "amazon", "apple", "microsoft", "netflix",
    "uber", "lyft", "airbnb", "stripe", "coinbase", "robinhood", "doordash",
    "instacart", "dropbox", "slack", "twitter", "x", "linkedin", "salesforce",
    "oracle", "adobe", "nvidia", "intel", "amd", "qualcomm", "cisco", "vmware",
    "palantir", "snowflake", "databricks", "datadog", "cloudflare", "twilio",
    "square", "block", "paypal", "shopify", "spotify", "tiktok", "bytedance",
    "snap", "pinterest", "reddit", "discord", "zoom", "atlassian", "figma",
    "notion", "canva", "asana", "monday", "hubspot", "zendesk", "servicenow",
    "workday", "splunk", "elastic", "mongodb", "confluent", "hashicorp",
    "vercel", "supabase", "planetscale", "neon", "railway", "render",
    "goldman sachs", "morgan stanley", "jpmorgan", "citadel", "two sigma",
    "jane street", "de shaw", "renaissance", "bridgewater", "blackrock",
    "capital one", "american express", "visa", "mastercard", "bloomberg",
    "plaid", "affirm", "klarna", "chime", "sofi", "brex", "ramp",
    "openai", "anthropic", "cohere", "stability", "midjourney", "hugging face",
]

# Role patterns for classification
ROLE_PATTERNS = {
    "swe": re.compile(r"\b(software\s+engineer(?:ing)?|swe|sde|developer)\b", re.I),
    "frontend": re.compile(r"\b(frontend|front[\-\s]?end|react|vue|angular)\b", re.I),
    "backend": re.compile(r"\b(backend|back[\-\s]?end|api|server[\-\s]?side)\b", re.I),
    "fullstack": re.compile(r"\b(full[\-\s]?stack|full\s+stack)\b", re.I),
    "ml": re.compile(r"\b(ml|machine\s+learning|ai|data\s+scien|deep\s+learning)\b", re.I),
    "data": re.compile(r"\b(data\s+engineer|etl|data\s+pipeline|analytics)\b", re.I),
    "devops": re.compile(r"\b(devops|sre|site\s+reliability|infrastructure)\b", re.I),
    "mobile": re.compile(r"\b(mobile|ios|android|swift|kotlin|flutter|react\s+native)\b", re.I),
    "security": re.compile(r"\b(security|cybersecurity|appsec|infosec)\b", re.I),
}

# Question type patterns
QUESTION_TYPE_PATTERNS = {
    "technical": re.compile(r"\b(coding|algorithm|data\s+structure|leetcode|hackerrank|system\s+design|technical)\b", re.I),
    "behavioral": re.compile(r"\b(behavioral|star\s+method|tell\s+me\s+about|leadership|conflict|challenge)\b", re.I),
    "system_design": re.compile(r"\b(system\s+design|design\s+a|scalability|architecture|distributed)\b", re.I),
    "oa": re.compile(r"\b(online\s+assessment|oa|take[\-\s]?home|coding\s+test|hackerrank|codesignal)\b", re.I),
}

# Interview keyword patterns for filtering articles
INTERVIEW_KEYWORDS = [
    "interview", "interviewed", "interviewing",
    "got hired", "got the job", "offer", "rejected",
    "coding round", "technical round", "onsite",
    "phone screen", "recruiter call", "final round",
    "oa", "online assessment", "take home",
    "system design", "behavioral", "leetcode",
    "faang", "big tech", "big n",
]

# Patterns to extract actual questions from text
QUESTION_EXTRACTION_PATTERNS = [
    re.compile(r"(?:they\s+asked|was\s+asked|got\s+asked|the\s+question\s+was)[:\s]+[\"']?(.+?)[\"']?(?:\.|$)", re.I),
    re.compile(r"(?:question|problem)[:\s]+[\"']?(.+?)[\"']?(?:\.|$)", re.I),
    re.compile(r"(?:implement|design|build|create|write)[:\s]+(.+?)(?:\.|$)", re.I),
    re.compile(r"leetcode\s+(?:problem\s+)?#?\d+[:\s]*(.+?)(?:\.|$)", re.I),
]


class InterviewQuestion(TypedDict):
    """Structured interview question data."""
    id: str
    company: str
    role_type: str
    question_type: str
    question_text: str
    source_url: str
    source_title: str
    published_at: str
    difficulty: Optional[str]
    tags: list[str]


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def detect_company(text: str) -> Optional[str]:
    """Detect company name from article text."""
    text_lower = text.lower()

    for company in MAJOR_COMPANIES:
        if company in text_lower:
            # Return properly capitalized version
            return company.title() if " " not in company else company.upper() if len(company) <= 3 else company.title()

    # Try to find company patterns like "at [Company]" or "[Company] interview"
    company_patterns = [
        re.compile(r"interview(?:ed)?\s+(?:at|with|for)\s+([A-Z][a-zA-Z0-9\s&\.\-]+?)(?:\s+for|\s+as|,|\.|$)", re.I),
        re.compile(r"([A-Z][a-zA-Z0-9\s&\.\-]+?)\s+interview", re.I),
        re.compile(r"hired\s+(?:at|by)\s+([A-Z][a-zA-Z0-9\s&\.\-]+?)(?:\s|,|\.|$)", re.I),
        re.compile(r"offer\s+from\s+([A-Z][a-zA-Z0-9\s&\.\-]+?)(?:\s|,|\.|$)", re.I),
    ]

    for pattern in company_patterns:
        match = pattern.search(text)
        if match:
            company = match.group(1).strip()
            if 2 < len(company) < 50:
                return company

    return None


def detect_role_type(text: str) -> str:
    """Detect role type from article text."""
    for role, pattern in ROLE_PATTERNS.items():
        if pattern.search(text):
            return role
    return "swe"  # Default to general SWE


def detect_question_type(text: str) -> str:
    """Detect question type from text."""
    for q_type, pattern in QUESTION_TYPE_PATTERNS.items():
        if pattern.search(text):
            return q_type
    return "technical"  # Default to technical


def extract_questions(text: str) -> list[str]:
    """Extract interview questions from article text."""
    questions = []

    for pattern in QUESTION_EXTRACTION_PATTERNS:
        matches = pattern.findall(text)
        for match in matches:
            q = match.strip()
            if 10 < len(q) < 500:
                questions.append(q)

    # Also look for bullet points or numbered lists that might be questions
    list_pattern = re.compile(r"(?:^|\n)\s*(?:\d+\.|[\-\*])\s*(.+?)(?:\n|$)", re.M)
    list_items = list_pattern.findall(text)
    for item in list_items:
        item = item.strip()
        # Check if it looks like a question or task
        if any(kw in item.lower() for kw in ["implement", "design", "explain", "what", "how", "why", "describe"]):
            if 10 < len(item) < 500 and item not in questions:
                questions.append(item)

    return questions[:10]  # Limit to 10 questions per article


def is_interview_article(article: dict) -> bool:
    """Check if article is about interviews."""
    title = article.get("title", "").lower()
    description = article.get("description", "").lower()
    tags = [t.lower() for t in article.get("tag_list", [])]

    # Check tags first
    interview_tags = ["interview", "career", "jobs", "hiring", "faang", "leetcode", "coding"]
    if any(tag in interview_tags for tag in tags):
        return True

    # Check title and description
    combined = f"{title} {description}"
    return any(kw in combined for kw in INTERVIEW_KEYWORDS)


# Session singletons for stealth requests
_stealth_session: Optional['StealthSession'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_cache: Optional['ResponseCache'] = None


def _get_stealth_session() -> Optional['StealthSession']:
    """Get or create a stealth session."""
    global _stealth_session
    if _stealth_session is None and INFRA_AVAILABLE:
        _stealth_session = create_stealth_session(
            session_id='devto_interviews',
            min_delay=0.3,  # Dev.to is relatively generous
            max_delay=3.0,
            requests_per_minute=40
        )
    return _stealth_session


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or create rate limiter."""
    global _rate_limiter
    if _rate_limiter is None and INFRA_AVAILABLE:
        _rate_limiter = AdaptiveRateLimiter(
            base_delay=0.5,
            min_delay=0.2,
            max_delay=5.0,
            target_response_time=0.8
        )
    return _rate_limiter


def _get_response_cache() -> Optional['ResponseCache']:
    """Get or create response cache."""
    global _cache
    if _cache is None and INFRA_AVAILABLE:
        _cache = get_cache()
    return _cache


# Cache TTL for Dev.to articles (6 hours - articles change slowly)
DEVTO_CACHE_TTL = 3600 * 6


def _get_request_headers() -> dict:
    """Get request headers for Dev.to API.

    Uses stealth session if available for anti-detection headers.
    """
    session = _get_stealth_session()
    if session:
        headers = session.header_randomizer.get_api_headers()
        return headers

    return {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }


def _apply_rate_limit() -> None:
    """Apply rate limiting for Dev.to API requests.

    Uses adaptive rate limiter if available.
    """
    rate_limiter = _get_rate_limiter()
    if rate_limiter:
        rate_limiter.wait_sync()
    elif INFRA_AVAILABLE:
        time.sleep(0.5)
    else:
        # Simple fallback delay
        time.sleep(0.5)


def fetch_devto_articles(tag: str = "interview", months: int = 5, per_page: int = 100) -> list[dict]:
    """Fetch articles from Dev.to API.

    Args:
        tag: Tag to filter by
        months: Number of months to look back
        per_page: Articles per page (max 100)

    Returns:
        List of article dicts

    Uses production infrastructure for stealth headers, rate limiting, and caching.
    """
    if requests is None:
        print("requests module not available")
        return []

    cutoff_date = datetime.now() - timedelta(days=months * 30)
    all_articles = []
    page = 1
    max_pages = 10  # Limit to prevent infinite loops

    headers = _get_request_headers()
    cache = _get_response_cache()
    rate_limiter = _get_rate_limiter()

    while page <= max_pages:
        params = {
            "tag": tag,
            "per_page": per_page,
            "page": page,
            "state": "all",
        }

        # Build cache key
        from urllib.parse import urlencode
        full_url = f"{DEVTO_API_URL}?{urlencode(params)}"

        # Check cache first
        if cache:
            cached = cache.get(full_url)
            if cached:
                try:
                    import json
                    articles = json.loads(cached.content.decode('utf-8'))
                    if articles:
                        for article in articles:
                            published = article.get("published_at", "")
                            if published:
                                try:
                                    pub_date = datetime.fromisoformat(published.replace("Z", "+00:00"))
                                    if pub_date.replace(tzinfo=None) < cutoff_date:
                                        return all_articles
                                except ValueError:
                                    pass
                            all_articles.append(article)
                        page += 1
                        continue
                except (ValueError, json.JSONDecodeError):
                    pass

        # Apply rate limiting before request
        _apply_rate_limit()

        start_time = time.time()
        try:
            response = requests.get(
                DEVTO_API_URL,
                params=params,
                headers=headers,
                timeout=REQUEST_TIMEOUT
            )
            response.raise_for_status()
            response_time = time.time() - start_time
            articles = response.json()

            # Record success
            if rate_limiter:
                rate_limiter.record_success(response_time)

            # Cache the response
            if cache:
                cache.set(full_url, response, ttl=DEVTO_CACHE_TTL)

        except requests.RequestException as e:
            print(f"Error fetching Dev.to articles (page {page}): {e}")
            if rate_limiter:
                is_rate_limit = '429' in str(e) or 'rate' in str(e).lower()
                rate_limiter.record_failure(is_rate_limit)
            break
        except ValueError as e:
            print(f"Error parsing Dev.to JSON: {e}")
            break

        if not articles:
            break

        # Filter by date
        for article in articles:
            published = article.get("published_at", "")
            if published:
                try:
                    pub_date = datetime.fromisoformat(published.replace("Z", "+00:00"))
                    if pub_date.replace(tzinfo=None) < cutoff_date:
                        # Articles are sorted by date, so we can stop
                        return all_articles
                except ValueError:
                    pass

            all_articles.append(article)

        page += 1

    return all_articles


def fetch_article_body(article_id: int) -> Optional[str]:
    """Fetch full article body markdown.

    Args:
        article_id: Dev.to article ID

    Returns:
        Article body markdown or None

    Uses production infrastructure for caching, stealth headers, and rate limiting.
    """
    if requests is None:
        return None

    url = f"{DEVTO_API_URL}/{article_id}"
    cache = _get_response_cache()
    rate_limiter = _get_rate_limiter()
    headers = _get_request_headers()

    # Check cache first
    if cache:
        cached = cache.get(url)
        if cached:
            try:
                import json
                data = json.loads(cached.content.decode('utf-8'))
                return data.get("body_markdown", "")
            except (ValueError, json.JSONDecodeError):
                pass

    # Apply rate limiting
    _apply_rate_limit()

    start_time = time.time()
    try:
        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        response_time = time.time() - start_time
        data = response.json()

        # Record success
        if rate_limiter:
            rate_limiter.record_success(response_time)

        # Cache the response
        if cache:
            cache.set(url, response, ttl=DEVTO_CACHE_TTL)

        return data.get("body_markdown", "")

    except requests.RequestException as e:
        print(f"Error fetching article {article_id}: {e}")
        if rate_limiter:
            is_rate_limit = '429' in str(e) or 'rate' in str(e).lower()
            rate_limiter.record_failure(is_rate_limit)
        return None
    except ValueError:
        return None


def parse_article_for_questions(article: dict) -> list[InterviewQuestion]:
    """Parse a single article for interview questions.

    Args:
        article: Article dict from Dev.to API

    Returns:
        List of extracted interview questions
    """
    questions = []

    # Get full body if needed
    body = article.get("body_markdown")
    if not body:
        body = fetch_article_body(article.get("id"))

    if not body:
        return []

    # Clean the body
    clean_body = clean_html(body)
    title = article.get("title", "")
    combined_text = f"{title}\n{clean_body}"

    # Detect company
    company = detect_company(combined_text)
    if not company:
        company = "Unknown"

    # Detect role and question types
    role_type = detect_role_type(combined_text)
    question_type = detect_question_type(combined_text)

    # Extract questions
    extracted = extract_questions(clean_body)

    if not extracted:
        # If no specific questions found, use the article as a general experience
        extracted = [f"Interview experience at {company}"]

    # Build question objects
    for i, q_text in enumerate(extracted):
        question: InterviewQuestion = {
            "id": f"devto_{article.get('id')}_{i}",
            "company": company,
            "role_type": role_type,
            "question_type": question_type,
            "question_text": q_text,
            "source_url": article.get("url", ""),
            "source_title": title,
            "published_at": article.get("published_at", ""),
            "difficulty": None,  # Could be detected from context
            "tags": article.get("tag_list", []),
        }
        questions.append(question)

    return questions


def scrape_devto(months: int = 5, max_articles: int = 200) -> list[InterviewQuestion]:
    """Main scraper function for Dev.to interview content.

    Uses production infrastructure for caching/rate limiting.
    Optionally uses monitoring context if available.

    Args:
        months: Number of months to look back (default 5)
        max_articles: Maximum articles to process

    Returns:
        List of InterviewQuestion dicts
    """
    # Use monitoring context if available
    if INFRA_AVAILABLE:
        with monitor_scraper('devto_interviews') as ctx:
            return _scrape_devto_impl(months, max_articles, ctx)
    else:
        return _scrape_devto_impl(months, max_articles, None)


def _scrape_devto_impl(months: int, max_articles: int, ctx) -> list[InterviewQuestion]:
    """Implementation with optional monitoring context."""
    print(f"Scraping Dev.to for interview articles from last {months} months...")

    all_questions: list[InterviewQuestion] = []

    # Search multiple relevant tags
    tags_to_search = [
        "interview", "career", "jobs", "leetcode",
        "codinginterview", "faang", "softwareengineering"
    ]

    seen_articles: set[int] = set()

    for tag in tags_to_search:
        print(f"  Searching tag: #{tag}")
        articles = fetch_devto_articles(tag=tag, months=months)

        for article in articles:
            article_id = article.get("id")
            if article_id in seen_articles:
                continue
            seen_articles.add(article_id)

            if len(seen_articles) > max_articles:
                break

            # Check if it's actually about interviews
            if not is_interview_article(article):
                continue

            # Parse for questions
            questions = parse_article_for_questions(article)
            all_questions.extend(questions)

            if questions:
                print(f"    Found {len(questions)} questions in: {article.get('title', '')[:50]}...")

        if len(seen_articles) > max_articles:
            break

    print(f"Total interview questions extracted: {len(all_questions)}")

    # Deduplicate by question text
    unique_questions: list[InterviewQuestion] = []
    seen_texts: set[str] = set()

    for q in all_questions:
        text_key = q["question_text"].lower().strip()
        if text_key not in seen_texts:
            seen_texts.add(text_key)
            unique_questions.append(q)

    print(f"Unique questions after dedup: {len(unique_questions)}")

    # Record metrics
    if ctx:
        ctx.record_questions(
            extracted=len(all_questions),
            new=len(unique_questions),
            duplicate=len(all_questions) - len(unique_questions)
        )

    return unique_questions


def fetch_devto_interviews(months: int = 5) -> list[InterviewQuestion]:
    """Alias for consistent naming with other sources."""
    return scrape_devto(months=months)


def get_infrastructure_status() -> dict:
    """Get status of infrastructure components for Dev.to scraper."""
    return {
        'infra_available': INFRA_AVAILABLE,
        'stealth_session': _get_stealth_session() is not None,
        'rate_limiter': _get_rate_limiter() is not None,
        'cache': _get_response_cache() is not None,
    }


if __name__ == "__main__":
    # Test the scraper
    questions = scrape_devto(months=2, max_articles=50)

    print("\n--- Sample Questions ---")
    for q in questions[:5]:
        print(f"\nCompany: {q['company']}")
        print(f"Role: {q['role_type']}")
        print(f"Type: {q['question_type']}")
        print(f"Question: {q['question_text'][:100]}...")
        print(f"Source: {q['source_url']}")
