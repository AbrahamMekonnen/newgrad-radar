"""CodeStudio (Coding Ninjas) interview questions scraper.

Scrapes company-specific coding problems from codingninjas.com/codestudio.
They maintain a curated list of problems tagged by company.

Uses production infrastructure:
- StealthSession for anti-detection
- ResponseCache for HTTP caching (12h TTL - content changes slowly)
- AdaptiveRateLimiter for gentle rate limiting
- text_parser for robust company detection
- Monitoring for metrics tracking
"""

import hashlib
import logging
import re
import time
import sys
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin

# Add parent directories for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

# Import infrastructure utilities with INFRA_AVAILABLE flag pattern
INFRA_AVAILABLE = False
try:
    from utils.anti_detection import StealthSession, create_stealth_session
    from utils.cache import ResponseCache, get_cache
    from utils.rate_limiter import AdaptiveRateLimiter
    from utils.text_parser import detect_all_companies_robust, extract_interview_questions
    from utils.monitoring import monitor_scraper
    from utils.error_handler import CheckpointManager
    INFRA_AVAILABLE = True
except ImportError:
    CheckpointManager = None

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE and CheckpointManager:
        try:
            _checkpoint = CheckpointManager("codestudio")
        except Exception:
            pass
    return _checkpoint

# Fallback imports
try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    requests = None
    BeautifulSoup = None

# Legacy flag for backward compatibility
HAS_INFRASTRUCTURE = INFRA_AVAILABLE

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


class QuestionType(Enum):
    TECHNICAL = "technical"
    BEHAVIORAL = "behavioral"
    SYSTEM_DESIGN = "system_design"
    CODING = "coding"
    OA = "online_assessment"


class Difficulty(Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


@dataclass
class InterviewQuestion:
    """Represents a single interview question."""

    id: str
    question_text: str
    question_type: QuestionType
    difficulty: Optional[Difficulty] = None
    company: Optional[str] = None
    role: Optional[str] = None
    topics: list[str] = field(default_factory=list)
    source: str = ""
    source_url: Optional[str] = None
    interview_date: Optional[datetime] = None
    scraped_at: datetime = field(default_factory=datetime.utcnow)
    answer_hint: Optional[str] = None
    upvotes: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "question_text": self.question_text,
            "question_type": self.question_type.value,
            "difficulty": self.difficulty.value if self.difficulty else None,
            "company": self.company,
            "role": self.role,
            "topics": self.topics,
            "source": self.source,
            "source_url": self.source_url,
            "interview_date": self.interview_date.isoformat() if self.interview_date else None,
            "scraped_at": self.scraped_at.isoformat(),
            "answer_hint": self.answer_hint,
            "upvotes": self.upvotes,
        }

logger = logging.getLogger(__name__)

CODESTUDIO_BASE_URL = "https://www.codingninjas.com/studio"
CODESTUDIO_API_URL = "https://api.codingninjas.com/api/v4"

# Use longer TTL for CodeStudio - DSA content changes slowly (12 hours)
CS_CACHE_TTL = 3600 * 12

# Global infrastructure instances
_response_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_stealth_session: Optional['StealthSession'] = None


def _get_cache() -> Optional['ResponseCache']:
    """Get or initialize response cache with longer TTL for slow-changing content."""
    global _response_cache
    if INFRA_AVAILABLE and _response_cache is None:
        try:
            _response_cache = ResponseCache(ttl=CS_CACHE_TTL)
            logger.debug("ResponseCache initialized for CodeStudio scraper (12h TTL)")
        except Exception as e:
            logger.warning(f"Failed to initialize ResponseCache: {e}")
    return _response_cache


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or initialize rate limiter - be gentle with CodeStudio."""
    global _rate_limiter
    if INFRA_AVAILABLE and _rate_limiter is None:
        try:
            _rate_limiter = AdaptiveRateLimiter(
                base_delay=2.0,       # Start with 2s delay
                min_delay=1.5,        # Never go below 1.5s
                max_delay=15.0,       # Max 15s on errors
                target_response_time=3.0,
                jitter_factor=0.2,
            )
            logger.debug("AdaptiveRateLimiter initialized for CodeStudio scraper")
        except Exception as e:
            logger.warning(f"Failed to initialize rate limiter: {e}")
    return _rate_limiter


def _get_stealth_session() -> Optional['StealthSession']:
    """Get or initialize stealth session for anti-detection."""
    global _stealth_session
    if INFRA_AVAILABLE and _stealth_session is None:
        try:
            _stealth_session = create_stealth_session(
                min_delay=1.5,
                max_delay=4.0,
                requests_per_minute=20,  # Gentle rate
            )
            logger.debug("StealthSession initialized for CodeStudio scraper")
        except Exception as e:
            logger.warning(f"Failed to initialize stealth session: {e}")
    return _stealth_session


# Legacy function for backward compatibility
def _get_throttler():
    """Legacy function - returns rate limiter."""
    return _get_rate_limiter()


# DSA Topic patterns
DSA_TOPICS = {
    "arrays": ["array", "subarray", "matrix"],
    "strings": ["string", "palindrome", "anagram"],
    "linked_list": ["linked list", "linkedlist", "ll"],
    "binary_tree": ["tree", "bst", "binary tree"],
    "graphs": ["graph", "bfs", "dfs", "shortest path"],
    "dynamic_programming": ["dp", "dynamic programming", "memoization"],
    "recursion": ["recursion", "backtracking"],
    "binary_search": ["binary search"],
    "two_pointers": ["two pointer", "two pointers"],
    "sliding_window": ["sliding window"],
    "stack": ["stack", "monotonic"],
    "heap": ["heap", "priority queue"],
    "greedy": ["greedy"],
    "bit_manipulation": ["bit", "xor"],
    "sorting": ["sort", "merge sort", "quick sort"],
    "hashing": ["hash", "frequency"],
}


def detect_topics_from_text(text: str) -> List[str]:
    """Detect DSA topics from problem text."""
    text_lower = text.lower()
    detected = []

    for topic, keywords in DSA_TOPICS.items():
        for keyword in keywords:
            if keyword in text_lower:
                detected.append(topic)
                break

    return detected

COMPANY_SLUGS = [
    "google", "amazon", "microsoft", "facebook", "apple", "netflix",
    "uber", "airbnb", "linkedin", "twitter", "stripe", "coinbase",
    "oracle", "adobe", "salesforce", "paypal", "intuit", "nvidia",
    "vmware", "cisco", "intel", "qualcomm", "amd", "samsung",
    "flipkart", "swiggy", "zomato", "razorpay", "phonepe", "paytm",
    "ola", "meesho", "cred", "dream11", "byju", "unacademy",
    "tcs", "infosys", "wipro", "hcl", "cognizant", "accenture",
    "goldman-sachs", "morgan-stanley", "jpmorgan", "barclays",
    "de-shaw", "tower-research", "citadel", "two-sigma",
]

DIFFICULTY_MAP = {
    "easy": Difficulty.EASY,
    "medium": Difficulty.MEDIUM,
    "moderate": Difficulty.MEDIUM,
    "hard": Difficulty.HARD,
    "ninja": Difficulty.HARD,
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json, text/html",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.codingninjas.com/",
}


def _generate_id(company: str, problem_name: str) -> str:
    """Generate unique ID for a question."""
    raw = f"codestudio:{company}:{problem_name}".lower()
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _parse_difficulty(text: str) -> Optional[Difficulty]:
    """Parse difficulty from text."""
    if not text:
        return None
    text_lower = text.lower().strip()
    for key, val in DIFFICULTY_MAP.items():
        if key in text_lower:
            return val
    return None


def _parse_topics(topic_elements: list) -> list[str]:
    """Extract topic tags from elements."""
    topics = []
    for elem in topic_elements:
        topic = elem.get_text(strip=True) if hasattr(elem, "get_text") else str(elem)
        if topic and len(topic) > 1:
            topics.append(topic)
    return topics


def _fetch_company_problems_api(company: str, session: requests.Session) -> list[dict]:
    """Try to fetch problems via API endpoint with caching.

    Uses:
    - ResponseCache for caching (12h TTL)
    - AdaptiveRateLimiter for gentle rate limiting
    - StealthSession for anti-detection headers
    """
    import json

    api_url = f"{CODESTUDIO_API_URL}/public/library/problems"
    cache_key = f"codestudio_api_{company}"

    cache = _get_cache()
    rate_limiter = _get_rate_limiter()
    stealth = _get_stealth_session()

    # Check cache first
    if cache:
        cached = cache.get(cache_key)
        if cached:
            logger.debug(f"Cache hit for CodeStudio API: {company}")
            try:
                content = cached.content if hasattr(cached, 'content') else cached
                if isinstance(content, bytes):
                    content = content.decode('utf-8')
                return json.loads(content)
            except Exception:
                pass

    # Apply rate limiting
    if rate_limiter:
        rate_limiter.wait_sync()
    else:
        time.sleep(2.0)

    # Use stealth headers if available
    if stealth:
        config = stealth.get_request_config(api_url)
        headers = config['headers']
        headers.update({"Accept": "application/json"})
    else:
        headers = HEADERS.copy()

    start_time = time.time()
    try:
        params = {
            "company": company,
            "page": 1,
            "pageSize": 100,
        }

        response = session.get(api_url, params=params, headers=headers, timeout=15)
        response_time = time.time() - start_time

        # Update rate limiter
        if rate_limiter:
            if response.ok:
                rate_limiter.record_success(response_time)
            else:
                rate_limiter.record_failure(is_rate_limit=(response.status_code == 429))

        if response.status_code == 200:
            data = response.json()
            problems = data.get("data", {}).get("problems", [])

            # Cache the result
            if cache and problems:
                cache.set(cache_key, {'content': json.dumps(problems).encode('utf-8'), 'status_code': 200, 'headers': {}})
                logger.debug(f"Cached API response for {company}")

            return problems
    except Exception as e:
        if rate_limiter:
            rate_limiter.record_failure()
        logger.debug(f"API fetch failed for {company}: {e}")
    return []


def _fetch_company_problems_html(company: str, session: requests.Session) -> list[dict]:
    """Fallback: scrape problems via HTML.

    Uses:
    - AdaptiveRateLimiter for gentle rate limiting
    - StealthSession for anti-detection headers
    """
    problems = []
    rate_limiter = _get_rate_limiter()
    stealth = _get_stealth_session()

    urls_to_try = [
        f"{CODESTUDIO_BASE_URL}/problem-lists/{company}-interview-questions",
        f"{CODESTUDIO_BASE_URL}/company/{company}",
        f"https://www.codingninjas.com/codestudio/problem-lists/{company}-interview",
    ]

    for url in urls_to_try:
        try:
            # Apply rate limiting
            if rate_limiter:
                rate_limiter.wait_sync()
            else:
                time.sleep(2.0)

            # Use stealth headers if available
            if stealth:
                config = stealth.get_request_config(url)
                headers = config['headers']
            else:
                headers = HEADERS.copy()

            start_time = time.time()
            response = session.get(url, headers=headers, timeout=15)
            response_time = time.time() - start_time

            # Update rate limiter
            if rate_limiter:
                if response.ok:
                    rate_limiter.record_success(response_time)
                else:
                    rate_limiter.record_failure(is_rate_limit=(response.status_code == 429))

            if response.status_code != 200:
                continue

            soup = BeautifulSoup(response.text, "html.parser")

            problem_cards = soup.select(".problem-card, .question-card, [class*='problem-item']")
            if not problem_cards:
                problem_cards = soup.select("a[href*='/problems/']")

            for card in problem_cards:
                problem = {}

                title_elem = card.select_one(".problem-title, .title, h3, h4")
                if title_elem:
                    problem["name"] = title_elem.get_text(strip=True)
                elif card.name == "a":
                    problem["name"] = card.get_text(strip=True)

                link = card.get("href") or card.select_one("a")
                if link:
                    href = link if isinstance(link, str) else link.get("href", "")
                    problem["url"] = urljoin(CODESTUDIO_BASE_URL, href)

                diff_elem = card.select_one(".difficulty, [class*='difficulty']")
                if diff_elem:
                    problem["difficulty"] = diff_elem.get_text(strip=True)

                topic_elems = card.select(".tag, .topic, [class*='tag']")
                problem["topics"] = _parse_topics(topic_elems)

                if problem.get("name"):
                    problems.append(problem)

            if problems:
                break

        except Exception as e:
            logger.debug(f"HTML scrape failed for {url}: {e}")
            continue

    return problems


def _fetch_problem_details(problem_url: str, session: requests.Session) -> dict:
    """Fetch additional details for a specific problem."""
    details = {}

    try:
        # Use production infrastructure if available
        if INFRA_AVAILABLE:
            infra_wait_for_rate_limit("codingninjas.com")
            headers = get_stealth_headers(problem_url)
            proxies = get_proxy_for_url(problem_url)
            response = session.get(problem_url, headers=headers, proxies=proxies, timeout=15)
        else:
            response = session.get(problem_url, headers=HEADERS, timeout=15)

        if response.status_code != 200:
            return details

        soup = BeautifulSoup(response.text, "html.parser")

        desc_elem = soup.select_one(".problem-statement, .description, [class*='statement']")
        if desc_elem:
            details["description"] = desc_elem.get_text(strip=True)[:500]

        companies = soup.select(".company-tag, [class*='company']")
        details["companies"] = [c.get_text(strip=True) for c in companies if c.get_text(strip=True)]

        topic_elems = soup.select(".topic-tag, .tag, [class*='topic']")
        details["topics"] = _parse_topics(topic_elems)

        diff_elem = soup.select_one(".difficulty-level, [class*='difficulty']")
        if diff_elem:
            details["difficulty"] = diff_elem.get_text(strip=True)

    except Exception as e:
        logger.debug(f"Failed to fetch problem details from {problem_url}: {e}")

    return details


def _validate_questions(questions: list) -> list:
    """Validate questions using text_parser for company detection."""
    if not INFRA_AVAILABLE:
        return questions

    try:
        validated = []
        for q in questions:
            try:
                # Use robust company detection from text_parser
                text_for_company = q.question_text + ' ' + (q.company or '')
                companies = detect_all_companies_robust(text_for_company)
                if companies:
                    q.company = companies[0].normalized.replace('_', ' ').title()
                validated.append(q)
            except Exception:
                validated.append(q)

        logger.info(f"Validation: {len(validated)}/{len(questions)} passed")
        return validated

    except Exception as e:
        logger.warning(f"Validation error, returning original: {e}")
        return questions


def scrape_codestudio(
    companies: Optional[list[str]] = None,
    months_back: int = 5,
    fetch_details: bool = False,
    rate_limit_seconds: float = 1.0,
    validate: bool = True,
    use_cache: bool = True,
) -> list[InterviewQuestion]:
    """
    Scrape interview questions from CodeStudio.

    Uses production infrastructure:
    - StealthSession for anti-detection
    - ResponseCache for caching (12h TTL - content changes slowly)
    - AdaptiveRateLimiter for gentle rate limiting
    - text_parser for robust company detection
    - Monitoring for metrics tracking

    Args:
        companies: List of company slugs to scrape. Defaults to COMPANY_SLUGS.
        months_back: How many months of data to consider (for filtering).
        fetch_details: Whether to fetch individual problem pages for more details.
        rate_limit_seconds: Delay between requests.
        validate: Run questions through text_parser validation.
        use_cache: Use response caching.

    Returns:
        List of InterviewQuestion objects.
    """
    if requests is None:
        logger.error("requests module not available")
        return []

    if companies is None:
        companies = COMPANY_SLUGS

    # Use monitoring context if available
    monitoring_ctx = None
    if INFRA_AVAILABLE:
        try:
            monitoring_ctx = monitor_scraper('codestudio')
            monitoring_ctx.__enter__()
        except Exception as e:
            logger.warning(f"Failed to start monitoring: {e}")

    questions = []
    seen_ids = set()
    cutoff_date = datetime.utcnow() - timedelta(days=months_back * 30)

    session = requests.Session()
    session.headers.update(HEADERS)

    rate_limiter = _get_rate_limiter()

    logger.info(f"Scraping CodeStudio for {len(companies)} companies...")
    print(f"Scraping CodeStudio for {len(companies)} companies...")

    for company in companies:
        logger.debug(f"Scraping company: {company}")

        problems = _fetch_company_problems_api(company, session)

        if not problems:
            problems = _fetch_company_problems_html(company, session)

        for prob in problems:
            try:
                name = prob.get("name") or prob.get("title", "")
                if not name:
                    continue

                q_id = _generate_id(company, name)
                if q_id in seen_ids:
                    continue
                seen_ids.add(q_id)

                url = prob.get("url", "")
                difficulty = _parse_difficulty(prob.get("difficulty", ""))
                topics = prob.get("topics", [])
                description = prob.get("description", "")

                # Auto-detect topics from problem name
                detected_topics = detect_topics_from_text(name)
                topics = list(set(topics + detected_topics))

                if fetch_details and url and not description:
                    if rate_limiter:
                        rate_limiter.wait_sync()
                    else:
                        time.sleep(rate_limit_seconds)

                    details = _fetch_problem_details(url, session)
                    if details.get("description"):
                        description = details["description"]
                    if details.get("topics"):
                        topics = list(set(topics + details["topics"]))
                    if details.get("difficulty") and not difficulty:
                        difficulty = _parse_difficulty(details["difficulty"])

                question = InterviewQuestion(
                    id=q_id,
                    question_text=f"{name}\n\n{description}" if description else name,
                    question_type=QuestionType.CODING,
                    difficulty=difficulty,
                    company=company.replace("-", " ").title(),
                    role="Software Engineer",
                    topics=topics[:10],
                    source="codestudio",
                    source_url=url or f"{CODESTUDIO_BASE_URL}/company/{company}",
                    scraped_at=datetime.utcnow(),
                )

                questions.append(question)

            except Exception as e:
                logger.warning(f"Failed to parse problem: {e}")
                continue

        # Use rate limiter if available, else manual delay
        if rate_limiter:
            rate_limiter.wait_sync()
        else:
            time.sleep(rate_limit_seconds)

    logger.info(f"Scraped {len(questions)} questions from CodeStudio")
    print(f"Scraped {len(questions)} questions from CodeStudio")

    # Validate if requested
    if validate:
        questions = _validate_questions(questions)

    # Record metrics and close monitoring
    if monitoring_ctx:
        try:
            monitoring_ctx.record_questions(
                extracted=len(questions),
                new=len(questions),
                duplicate=0,
            )
            monitoring_ctx.__exit__(None, None, None)
        except Exception as e:
            logger.warning(f"Failed to close monitoring: {e}")

    return questions


def scrape_codestudio_by_topic(
    topics: list[str],
    rate_limit_seconds: float = 1.0,
) -> list[InterviewQuestion]:
    """
    Scrape questions by topic (arrays, trees, dp, etc.).

    Args:
        topics: List of topic slugs.
        rate_limit_seconds: Delay between requests.

    Returns:
        List of InterviewQuestion objects.
    """
    questions = []
    seen_ids = set()

    session = requests.Session()
    session.headers.update(HEADERS)

    for topic in topics:
        try:
            url = f"{CODESTUDIO_BASE_URL}/problem-lists/{topic}"
            response = session.get(url, headers=HEADERS, timeout=15)

            if response.status_code != 200:
                continue

            soup = BeautifulSoup(response.text, "html.parser")
            problem_links = soup.select("a[href*='/problems/']")

            for link in problem_links:
                name = link.get_text(strip=True)
                if not name:
                    continue

                q_id = _generate_id(topic, name)
                if q_id in seen_ids:
                    continue
                seen_ids.add(q_id)

                href = link.get("href", "")

                question = InterviewQuestion(
                    id=q_id,
                    question_text=name,
                    question_type=QuestionType.CODING,
                    topics=[topic],
                    source="codestudio",
                    source_url=urljoin(CODESTUDIO_BASE_URL, href),
                    scraped_at=datetime.utcnow(),
                )
                questions.append(question)

            time.sleep(rate_limit_seconds)

        except Exception as e:
            logger.warning(f"Failed to scrape topic {topic}: {e}")
            continue

    return questions


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    results = scrape_codestudio(
        companies=["google", "amazon", "microsoft"],
        months_back=5,
        fetch_details=False,
    )

    print(f"\nFound {len(results)} questions:")
    for q in results[:10]:
        print(f"  - [{q.company}] {q.question_text[:60]}... ({q.difficulty})")
