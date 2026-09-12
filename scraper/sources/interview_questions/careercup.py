"""CareerCup interview questions scraper.

Scrapes historical interview questions from CareerCup, including:
- Company-tagged questions
- Difficulty ratings
- Vote counts
- Answer hints

Also checks Wayback Machine for archived pages when needed.

CareerCup is less protected than modern sites, making it a good
source for historical FAANG interview question patterns.

Upgraded with:
- ResponseCache for HTTP caching (historical content)
- ValidationPipeline for data quality
- Enhanced topic detection
- Retry logic via infrastructure
"""

import re
import hashlib
import logging
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin, quote
import time

from .quant_finance import InterviewQuestion

# Import infrastructure utilities
try:
    from ...utils.cache import ResponseCache
    from ...utils.validation import ValidationPipeline
    from ...utils.error_handler import RetryManager, CheckpointManager
    HAS_INFRASTRUCTURE = True
except ImportError:
    HAS_INFRASTRUCTURE = False
    CheckpointManager = None

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and HAS_INFRASTRUCTURE and CheckpointManager:
        try:
            _checkpoint = CheckpointManager("careercup")
        except Exception:
            pass
    return _checkpoint
    ResponseCache = None
    ValidationPipeline = None
    RetryManager = None

# Production infrastructure imports
try:
    from ...utils.scraper_infra import (
        InfrastructureContext,
        validate_batch,
        get_stealth_headers,
        get_proxy_for_url,
        cached_request,
        wait_for_rate_limit as infra_wait_for_rate_limit,
    )
    INFRA_AVAILABLE = True
except ImportError:
    INFRA_AVAILABLE = False

logger = logging.getLogger(__name__)

# Base URLs
CAREERCUP_BASE = "https://www.careercup.com"
WAYBACK_API = "https://archive.org/wayback/available"
WAYBACK_CDX = "http://web.archive.org/cdx/search/cdx"

# Request settings
REQUEST_TIMEOUT = 30
RATE_LIMIT_DELAY = 1.5  # seconds between requests
MAX_PAGES = 50  # limit pagination to avoid overwhelming

# Global cache instance (TTL 7 days - historical content is static)
_response_cache: Optional['ResponseCache'] = None
_retry_manager: Optional['RetryManager'] = None


def _get_cache() -> Optional['ResponseCache']:
    """Get or initialize response cache."""
    global _response_cache
    if HAS_INFRASTRUCTURE and _response_cache is None:
        try:
            _response_cache = ResponseCache(ttl=604800)  # 7 days for historical content
            logger.info("ResponseCache initialized for CareerCup scraper")
        except Exception as e:
            logger.warning(f"Failed to initialize ResponseCache: {e}")
    return _response_cache


def _get_retry_manager() -> Optional['RetryManager']:
    """Get or initialize retry manager."""
    global _retry_manager
    if HAS_INFRASTRUCTURE and _retry_manager is None and RetryManager:
        try:
            _retry_manager = RetryManager(max_retries=3, base_delay=1.0, max_delay=10.0)
            logger.info("RetryManager initialized for CareerCup scraper")
        except Exception as e:
            logger.warning(f"Failed to initialize RetryManager: {e}")
    return _retry_manager

# Company name normalization
COMPANY_ALIASES = {
    "google": "Google",
    "amazon": "Amazon",
    "facebook": "Meta",
    "meta": "Meta",
    "microsoft": "Microsoft",
    "apple": "Apple",
    "netflix": "Netflix",
    "uber": "Uber",
    "airbnb": "Airbnb",
    "linkedin": "LinkedIn",
    "twitter": "Twitter",
    "x": "Twitter",
    "salesforce": "Salesforce",
    "oracle": "Oracle",
    "adobe": "Adobe",
    "stripe": "Stripe",
    "square": "Square",
    "block": "Square",
    "snap": "Snap",
    "snapchat": "Snap",
    "palantir": "Palantir",
    "databricks": "Databricks",
    "snowflake": "Snowflake",
    "coinbase": "Coinbase",
    "robinhood": "Robinhood",
    "doordash": "DoorDash",
    "instacart": "Instacart",
    "lyft": "Lyft",
    "dropbox": "Dropbox",
    "pinterest": "Pinterest",
    "reddit": "Reddit",
    "twitch": "Twitch",
    "spotify": "Spotify",
    "nvidia": "NVIDIA",
    "intel": "Intel",
    "qualcomm": "Qualcomm",
    "vmware": "VMware",
    "cisco": "Cisco",
    "ibm": "IBM",
    "bloomberg": "Bloomberg",
    "goldman sachs": "Goldman Sachs",
    "morgan stanley": "Morgan Stanley",
    "jpmorgan": "JPMorgan",
    "jp morgan": "JPMorgan",
    "citadel": "Citadel",
    "two sigma": "Two Sigma",
    "jane street": "Jane Street",
}

# Role patterns
ROLE_PATTERNS = {
    "swe": re.compile(r"\b(software\s+engineer|swe|sde)\b", re.I),
    "backend": re.compile(r"\b(backend|back[\-\s]?end)\b", re.I),
    "frontend": re.compile(r"\b(frontend|front[\-\s]?end)\b", re.I),
    "fullstack": re.compile(r"\b(full[\-\s]?stack)\b", re.I),
    "ml": re.compile(r"\b(machine\s+learning|ml|ai)\s*engineer\b", re.I),
    "data": re.compile(r"\b(data\s+engineer|data\s+scientist)\b", re.I),
    "devops": re.compile(r"\b(devops|sre|site\s+reliability)\b", re.I),
    "mobile": re.compile(r"\b(ios|android|mobile)\s*(engineer|developer)?\b", re.I),
}

# Question type patterns
QUESTION_TYPE_PATTERNS = {
    "system_design": re.compile(
        r"\b(design|architect|scale|distributed|system)\b.*\b(system|service|api|database|cache)\b",
        re.I,
    ),
    "behavioral": re.compile(
        r"\b(tell me|describe|situation|conflict|leadership|teamwork|challenge|failure|success)\b",
        re.I,
    ),
    "online_assessment": re.compile(
        r"\b(online\s+assessment|oa|hackerrank|codesignal|leetcode)\b",
        re.I,
    ),
}


def normalize_company(company: str) -> str:
    """Normalize company name to canonical form."""
    lower = company.lower().strip()
    return COMPANY_ALIASES.get(lower, company.title())


def extract_role(text: str) -> Optional[str]:
    """Extract role from question text."""
    for role, pattern in ROLE_PATTERNS.items():
        if pattern.search(text):
            return role
    return None


def classify_question_type(text: str) -> str:
    """Classify question into type based on content."""
    for qtype, pattern in QUESTION_TYPE_PATTERNS.items():
        if pattern.search(text):
            return qtype

    # Default to coding/technical if contains code-like patterns
    if re.search(r"\b(array|string|tree|graph|linked\s*list|sort|search|algorithm)\b", text, re.I):
        return "coding"

    return "technical"


def parse_difficulty(text: str) -> str:
    """Parse difficulty from CareerCup's rating text."""
    text_lower = text.lower()
    if "easy" in text_lower:
        return "easy"
    elif "medium" in text_lower or "moderate" in text_lower:
        return "medium"
    elif "hard" in text_lower or "difficult" in text_lower:
        return "hard"
    return "medium"  # Default to medium


def extract_topics(text: str) -> list[str]:
    """Extract coding topics from question text."""
    topics = []
    topic_patterns = [
        (r"\barray\b", "arrays"),
        (r"\bstring\b", "strings"),
        (r"\btree\b", "trees"),
        (r"\bbinary\s*tree\b", "binary-trees"),
        (r"\bgraph\b", "graphs"),
        (r"\blinked\s*list\b", "linked-lists"),
        (r"\bhash\s*(map|table|set)\b", "hash-tables"),
        (r"\bstack\b", "stacks"),
        (r"\bqueue\b", "queues"),
        (r"\bheap\b", "heaps"),
        (r"\bsort(ing)?\b", "sorting"),
        (r"\bsearch(ing)?\b", "searching"),
        (r"\bbinary\s*search\b", "binary-search"),
        (r"\bdynamic\s*programming\b", "dynamic-programming"),
        (r"\bdp\b", "dynamic-programming"),
        (r"\brecursion\b", "recursion"),
        (r"\bbacktrack(ing)?\b", "backtracking"),
        (r"\bgreedy\b", "greedy"),
        (r"\bbfs\b", "bfs"),
        (r"\bdfs\b", "dfs"),
        (r"\bbit\s*manipulat\b", "bit-manipulation"),
        (r"\bsql\b", "sql"),
        (r"\bdatabase\b", "databases"),
        (r"\bapi\b", "api-design"),
        (r"\boop\b", "oop"),
        (r"\bconcurrency\b", "concurrency"),
        (r"\bthread\b", "threading"),
        (r"\bmultithread\b", "threading"),
    ]

    for pattern, topic in topic_patterns:
        if re.search(pattern, text, re.I):
            if topic not in topics:
                topics.append(topic)

    return topics[:5]  # Limit to 5 topics


def generate_question_id(company: str, question_text: str) -> str:
    """Generate unique ID for a question."""
    content = f"{company}:{question_text[:200]}".lower()
    return f"careercup_{hashlib.md5(content.encode()).hexdigest()[:12]}"


def parse_interview_date(date_str: str) -> Optional[datetime]:
    """Parse date string from CareerCup."""
    if not date_str:
        return None

    # Common formats on CareerCup
    formats = [
        "%B %d, %Y",      # January 15, 2024
        "%b %d, %Y",      # Jan 15, 2024
        "%Y-%m-%d",       # 2024-01-15
        "%m/%d/%Y",       # 01/15/2024
    ]

    # Handle relative dates like "2 months ago"
    relative_match = re.match(r"(\d+)\s+(day|week|month|year)s?\s+ago", date_str, re.I)
    if relative_match:
        num = int(relative_match.group(1))
        unit = relative_match.group(2).lower()
        now = datetime.utcnow()
        if unit == "day":
            return now - timedelta(days=num)
        elif unit == "week":
            return now - timedelta(weeks=num)
        elif unit == "month":
            return now - timedelta(days=num * 30)
        elif unit == "year":
            return now - timedelta(days=num * 365)

    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue

    return None


def fetch_page(url: str, session: Optional[requests.Session] = None, use_cache: bool = True) -> Optional[str]:
    """Fetch a page with caching and retry logic."""
    sess = session or requests.Session()

    # Use production infrastructure if available
    if INFRA_AVAILABLE and use_cache:
        infra_wait_for_rate_limit("careercup.com")
        headers = get_stealth_headers(url)

        def _fetch(fetch_url: str) -> Optional[str]:
            proxies = get_proxy_for_url(fetch_url)
            for attempt in range(3):
                try:
                    response = sess.get(fetch_url, headers=headers, proxies=proxies, timeout=REQUEST_TIMEOUT)
                    response.raise_for_status()
                    return response.text
                except requests.RequestException as e:
                    logger.warning(f"Attempt {attempt + 1} failed for {fetch_url}: {e}")
                    if attempt < 2:
                        time.sleep(2 ** attempt)
            return None

        return cached_request(url, _fetch, ttl=604800)  # 7 day TTL

    # Fallback to original implementation
    cache = _get_cache() if use_cache else None

    # Check cache first
    if cache:
        cached = cache.get(url)
        if cached:
            logger.debug(f"Cache hit for {url}")
            return cached

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    for attempt in range(3):
        try:
            response = sess.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            html = response.text

            # Store in cache
            if cache:
                cache.set(url, html)
                logger.debug(f"Cached response for {url}")

            return html
        except requests.RequestException as e:
            logger.warning(f"Attempt {attempt + 1} failed for {url}: {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)

    return None


def check_wayback(url: str) -> Optional[str]:
    """Check Wayback Machine for archived version of URL."""
    try:
        response = requests.get(
            WAYBACK_API,
            params={"url": url},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()

        snapshot = data.get("archived_snapshots", {}).get("closest", {})
        if snapshot.get("available"):
            return snapshot.get("url")
    except Exception as e:
        print(f"  Wayback check failed: {e}")

    return None


def get_wayback_snapshots(url: str, months: int = 5) -> list[str]:
    """Get list of Wayback Machine snapshots for a URL from past N months."""
    cutoff = datetime.utcnow() - timedelta(days=months * 30)
    cutoff_str = cutoff.strftime("%Y%m%d")

    try:
        response = requests.get(
            WAYBACK_CDX,
            params={
                "url": url,
                "output": "json",
                "from": cutoff_str,
                "filter": "statuscode:200",
                "collapse": "digest",  # Dedupe by content
                "limit": 10,
            },
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()

        # First row is headers
        if len(data) > 1:
            snapshots = []
            for row in data[1:]:
                timestamp = row[1]
                original_url = row[2]
                wayback_url = f"http://web.archive.org/web/{timestamp}/{original_url}"
                snapshots.append(wayback_url)
            return snapshots
    except Exception as e:
        print(f"  Wayback CDX query failed: {e}")

    return []


def parse_question_page(html: str, url: str) -> Optional[InterviewQuestion]:
    """Parse a single question page."""
    soup = BeautifulSoup(html, "html.parser")

    # Find question container
    question_div = soup.find("div", class_="question")
    if not question_div:
        question_div = soup.find("div", id="question")
    if not question_div:
        return None

    # Extract question text
    question_text = question_div.get_text(strip=True)
    if not question_text or len(question_text) < 20:
        return None

    # Extract company from breadcrumb or page
    company = None
    company_link = soup.find("a", href=re.compile(r"/company/"))
    if company_link:
        company = company_link.get_text(strip=True)

    # Try meta tags if no company found
    if not company:
        meta_company = soup.find("meta", {"name": "company"})
        if meta_company:
            company = meta_company.get("content", "")

    # Default to extracting from question text
    if not company:
        # Look for "at [Company]" pattern
        at_match = re.search(r"\bat\s+([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)?)\b", question_text)
        if at_match:
            company = at_match.group(1)

    if not company:
        company = "Unknown"

    company = normalize_company(company)

    # Extract difficulty
    difficulty = None
    difficulty_elem = soup.find(class_="difficulty") or soup.find(string=re.compile(r"Difficulty:", re.I))
    if difficulty_elem:
        difficulty = parse_difficulty(str(difficulty_elem))

    # Extract votes/rating
    upvotes = 0
    votes_elem = soup.find(class_="votes") or soup.find(class_="rating")
    if votes_elem:
        vote_match = re.search(r"(\d+)", votes_elem.get_text())
        if vote_match:
            upvotes = int(vote_match.group(1))

    # Extract date
    interview_date = None
    date_elem = soup.find(class_="date") or soup.find(class_="time")
    if date_elem:
        interview_date = parse_interview_date(date_elem.get_text(strip=True))

    # Extract answer hint if available
    answer_hint = None
    answer_div = soup.find("div", class_="answer") or soup.find("div", id="answer")
    if answer_div:
        answer_text = answer_div.get_text(strip=True)
        if answer_text and len(answer_text) > 10:
            answer_hint = answer_text[:500]

    # Classify question
    question_type = classify_question_type(question_text)
    topics = extract_topics(question_text)
    role = extract_role(question_text) or "Software Engineer"

    # Format date as string
    date_str = interview_date.strftime("%Y-%m-%d") if interview_date else None

    return InterviewQuestion(
        id=generate_question_id(company, question_text),
        company=company,
        position=role,
        question_type=question_type,
        difficulty=difficulty or "medium",
        question_text=question_text[:2000],
        source="careercup",
        source_url=url,
        posted_date=date_str,
        tags=topics,
    )


def parse_question_list(html: str) -> list[str]:
    """Parse list page to get question URLs."""
    soup = BeautifulSoup(html, "html.parser")
    urls = []

    # Find question links
    for link in soup.find_all("a", href=re.compile(r"/question\?")):
        href = link.get("href")
        if href:
            full_url = urljoin(CAREERCUP_BASE, href)
            if full_url not in urls:
                urls.append(full_url)

    # Also check for /question/ pattern
    for link in soup.find_all("a", href=re.compile(r"/question/")):
        href = link.get("href")
        if href:
            full_url = urljoin(CAREERCUP_BASE, href)
            if full_url not in urls:
                urls.append(full_url)

    return urls


def _validate_questions(questions: List[InterviewQuestion]) -> List[InterviewQuestion]:
    """Validate questions using ValidationPipeline if available."""
    if not HAS_INFRASTRUCTURE or ValidationPipeline is None:
        return questions

    try:
        pipeline = ValidationPipeline(min_quality_score=0.3)
        validated = []

        for q in questions:
            q_dict = {
                "question_text": q.question_text,
                "company": q.company,
                "source": q.source,
                "source_url": q.source_url,
                "tags": q.tags,
            }

            result = pipeline.validate(q_dict)
            if result.is_valid:
                validated.append(q)
            else:
                logger.debug(f"Validation failed for: {q.question_text[:50]}")

        logger.info(f"Validation: {len(validated)}/{len(questions)} passed")
        return validated

    except Exception as e:
        logger.warning(f"Validation error, returning original: {e}")
        return questions


def scrape_careercup(
    companies: Optional[list[str]] = None,
    months: int = 5,
    max_questions: int = 500,
    use_wayback: bool = True,
    validate: bool = True,
    use_cache: bool = True,
) -> list[InterviewQuestion]:
    """Scrape interview questions from CareerCup.

    Args:
        companies: List of company names to filter (None = all)
        months: Only include questions from past N months
        max_questions: Maximum questions to return
        use_wayback: Whether to check Wayback Machine for archived pages
        validate: Run questions through ValidationPipeline
        use_cache: Use response caching (7 day TTL for historical content)

    Returns:
        List of InterviewQuestion objects
    """
    print(f"Starting CareerCup scrape (months={months}, max={max_questions})")

    session = requests.Session()
    questions: list[InterviewQuestion] = []
    seen_ids: set[str] = set()
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)

    # Build list of pages to scrape
    target_companies = companies or list(COMPANY_ALIASES.values())
    target_companies = list(set(target_companies))  # Dedupe

    for company in target_companies:
        if len(questions) >= max_questions:
            break

        print(f"\nScraping questions for: {company}")

        # CareerCup company URL pattern
        company_slug = company.lower().replace(" ", "-")
        company_url = f"{CAREERCUP_BASE}/company/{company_slug}"

        # Try direct page first
        html = fetch_page(company_url, session)

        # If not found, try Wayback
        if not html and use_wayback:
            print(f"  Page not found, checking Wayback Machine...")
            wayback_url = check_wayback(company_url)
            if wayback_url:
                print(f"  Found archived version: {wayback_url}")
                html = fetch_page(wayback_url, session)

        if not html:
            print(f"  No content found for {company}")
            time.sleep(RATE_LIMIT_DELAY)
            continue

        # Get question URLs from company page
        question_urls = parse_question_list(html)
        print(f"  Found {len(question_urls)} question links")

        # Also check Wayback for additional archived questions
        if use_wayback and len(question_urls) < 20:
            snapshots = get_wayback_snapshots(company_url, months)
            for snapshot_url in snapshots[:3]:  # Limit archived versions
                snapshot_html = fetch_page(snapshot_url, session)
                if snapshot_html:
                    archived_urls = parse_question_list(snapshot_html)
                    for url in archived_urls:
                        if url not in question_urls:
                            question_urls.append(url)
                time.sleep(RATE_LIMIT_DELAY)

        # Scrape individual questions
        for i, question_url in enumerate(question_urls):
            if len(questions) >= max_questions:
                break

            print(f"  Scraping question {i+1}/{len(question_urls)}: {question_url[:60]}...")

            question_html = fetch_page(question_url, session)
            if not question_html:
                time.sleep(RATE_LIMIT_DELAY)
                continue

            question = parse_question_page(question_html, question_url)

            if question and question.id not in seen_ids:
                # Filter by date if we have one
                if question.interview_date:
                    if question.interview_date < cutoff_date:
                        continue

                # Apply company filter
                if companies and question.company:
                    if not any(c.lower() in question.company.lower() for c in companies):
                        continue

                seen_ids.add(question.id)
                questions.append(question)
                print(f"    Added: {question.company} - {question.question_type.value}")

            time.sleep(RATE_LIMIT_DELAY)

        time.sleep(RATE_LIMIT_DELAY * 2)  # Extra delay between companies

    logger.info(f"CareerCup scrape complete: {len(questions)} questions found")

    # Validate if requested
    if validate:
        questions = _validate_questions(questions)

    return questions


def scrape_careercup_search(
    query: str,
    months: int = 5,
    max_results: int = 100,
) -> list[InterviewQuestion]:
    """Search CareerCup for specific question keywords.

    Args:
        query: Search query string
        months: Only include questions from past N months
        max_results: Maximum results to return

    Returns:
        List of InterviewQuestion objects
    """
    print(f"Searching CareerCup for: {query}")

    session = requests.Session()
    questions: list[InterviewQuestion] = []
    seen_ids: set[str] = set()

    # CareerCup search URL
    search_url = f"{CAREERCUP_BASE}/search"

    page = 1
    while len(questions) < max_results and page <= MAX_PAGES:
        params = {"query": query, "page": page}
        url = f"{search_url}?query={quote(query)}&page={page}"

        html = fetch_page(url, session)
        if not html:
            break

        question_urls = parse_question_list(html)
        if not question_urls:
            break

        print(f"  Page {page}: {len(question_urls)} results")

        for question_url in question_urls:
            if len(questions) >= max_results:
                break

            question_html = fetch_page(question_url, session)
            if not question_html:
                time.sleep(RATE_LIMIT_DELAY)
                continue

            question = parse_question_page(question_html, question_url)

            if question and question.id not in seen_ids:
                seen_ids.add(question.id)
                questions.append(question)

            time.sleep(RATE_LIMIT_DELAY)

        page += 1
        time.sleep(RATE_LIMIT_DELAY * 2)

    print(f"Search complete: {len(questions)} questions found")
    return questions


# Export for module use
__all__ = ["scrape_careercup", "scrape_careercup_search"]
