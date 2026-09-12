"""TakeUForward (Striver) DSA sheet scraper.

Scrapes takeuforward.org for Striver's DSA sheets which map problems to
companies that ask them. Extracts problem names, company tags, difficulty,
topics, and solution links.

This is one of the most popular free interview prep resources, especially
in India, with 50k+ Telegram community members.

Uses production infrastructure:
- StealthSession for anti-detection
- ResponseCache for caching (24h TTL - static DSA content)
- AdaptiveRateLimiter for gentle rate limiting
- text_parser for robust company detection
- Monitoring for metrics tracking
"""

import re
import hashlib
import logging
import time
import sys
import os
from datetime import datetime
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
            _checkpoint = CheckpointManager("takeuforward")
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

# Import InterviewQuestion from local module
try:
    from .quant_finance import InterviewQuestion
except ImportError:
    # Define a minimal InterviewQuestion if import fails
    from dataclasses import dataclass, field
    from typing import List, Optional

    @dataclass
    class InterviewQuestion:
        id: str
        company: str
        position: str
        question_type: str
        difficulty: str
        question_text: str
        source: str
        source_url: str
        posted_date: Optional[str] = None
        tags: List[str] = field(default_factory=list)

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

logger = logging.getLogger(__name__)

# Base URLs for TakeUForward resources
TAKEUFORWARD_BASE = "https://takeuforward.org"
STRIVERS_SDE_SHEET = f"{TAKEUFORWARD_BASE}/strivers-sde-sheet-top-coding-interview-problems/"
STRIVERS_A2Z_SHEET = f"{TAKEUFORWARD_BASE}/strivers-a2z-dsa-course-sheet-2/"
STRIVERS_79_SHEET = f"{TAKEUFORWARD_BASE}/strivers-79-last-moment-dsa-sheet-ace-interviews/"

# Request settings
REQUEST_TIMEOUT = 30
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# Company name normalization
COMPANY_ALIASES = {
    "amazon": "Amazon",
    "google": "Google",
    "microsoft": "Microsoft",
    "meta": "Meta",
    "facebook": "Meta",
    "apple": "Apple",
    "netflix": "Netflix",
    "flipkart": "Flipkart",
    "uber": "Uber",
    "adobe": "Adobe",
    "linkedin": "LinkedIn",
    "salesforce": "Salesforce",
    "oracle": "Oracle",
    "goldman": "Goldman Sachs",
    "goldmansachs": "Goldman Sachs",
    "morgan": "Morgan Stanley",
    "morganstanley": "Morgan Stanley",
    "deshaw": "D.E. Shaw",
    "samsung": "Samsung",
    "intuit": "Intuit",
    "walmart": "Walmart",
    "paypal": "PayPal",
    "visa": "Visa",
    "mastercard": "Mastercard",
    "twitter": "Twitter",
    "snap": "Snap",
    "airbnb": "Airbnb",
    "lyft": "Lyft",
    "stripe": "Stripe",
    "bytedance": "ByteDance",
    "tiktok": "ByteDance",
    "atlassian": "Atlassian",
}

# Topic normalization
TOPIC_ALIASES = {
    "array": "Arrays",
    "arrays": "Arrays",
    "string": "Strings",
    "strings": "Strings",
    "linkedlist": "Linked List",
    "linked list": "Linked List",
    "stack": "Stack",
    "queue": "Queue",
    "tree": "Trees",
    "trees": "Trees",
    "bst": "Binary Search Tree",
    "binary search tree": "Binary Search Tree",
    "binary search": "Binary Search",
    "binarysearch": "Binary Search",
    "heap": "Heap",
    "priority queue": "Heap",
    "graph": "Graphs",
    "graphs": "Graphs",
    "dp": "Dynamic Programming",
    "dynamic programming": "Dynamic Programming",
    "greedy": "Greedy",
    "recursion": "Recursion",
    "backtracking": "Backtracking",
    "bit manipulation": "Bit Manipulation",
    "bit": "Bit Manipulation",
    "math": "Math",
    "maths": "Math",
    "sorting": "Sorting",
    "searching": "Searching",
    "two pointer": "Two Pointers",
    "two pointers": "Two Pointers",
    "sliding window": "Sliding Window",
    "trie": "Trie",
    "segment tree": "Segment Tree",
    "hashing": "Hashing",
    "hash": "Hashing",
}


def normalize_company(company: str) -> str:
    """Normalize company name to standard form."""
    lower = company.lower().strip()
    return COMPANY_ALIASES.get(lower, company.title())


def normalize_topic(topic: str) -> str:
    """Normalize topic name to standard form."""
    lower = topic.lower().strip()
    return TOPIC_ALIASES.get(lower, topic.title())


def map_difficulty(text: str) -> str:
    """Map difficulty text to standard form."""
    lower = text.lower()
    if "easy" in lower:
        return "easy"
    elif "medium" in lower:
        return "medium"
    elif "hard" in lower:
        return "hard"
    return "medium"  # default


def generate_question_id(problem_name: str, source: str) -> str:
    """Generate unique ID for a question."""
    content = f"{source}:{problem_name}"
    return hashlib.md5(content.encode()).hexdigest()[:16]


# Use longer TTL for TakeUForward - static DSA content (24 hours)
TUF_CACHE_TTL = 3600 * 24

# Global infrastructure instances
_response_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_stealth_session: Optional['StealthSession'] = None


def _get_cache() -> Optional['ResponseCache']:
    """Get or initialize response cache with longer TTL for static content."""
    global _response_cache
    if INFRA_AVAILABLE and _response_cache is None:
        try:
            _response_cache = ResponseCache(ttl=TUF_CACHE_TTL)
            logger.debug("ResponseCache initialized for TakeUForward scraper (24h TTL)")
        except Exception as e:
            logger.warning(f"Failed to initialize ResponseCache: {e}")
    return _response_cache


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or initialize rate limiter - be gentle with TakeUForward."""
    global _rate_limiter
    if INFRA_AVAILABLE and _rate_limiter is None:
        try:
            _rate_limiter = AdaptiveRateLimiter(
                base_delay=2.0,       # Start with 2s delay
                min_delay=1.5,        # Never go below 1.5s
                max_delay=10.0,       # Max 10s on errors
                target_response_time=3.0,
                jitter_factor=0.2,
            )
            logger.debug("AdaptiveRateLimiter initialized for TakeUForward scraper")
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
            logger.debug("StealthSession initialized for TakeUForward scraper")
        except Exception as e:
            logger.warning(f"Failed to initialize stealth session: {e}")
    return _stealth_session


def fetch_page(url: str, use_cache: bool = True) -> Optional[BeautifulSoup]:
    """Fetch and parse a page with caching, rate limiting, and stealth headers.

    Uses:
    - ResponseCache for caching (24h TTL)
    - AdaptiveRateLimiter for gentle rate limiting
    - StealthSession for anti-detection headers

    Args:
        url: URL to fetch
        use_cache: Whether to use response cache (default True for static content)

    Returns:
        BeautifulSoup object or None on error
    """
    if requests is None or BeautifulSoup is None:
        logger.error("requests or BeautifulSoup module not available")
        return None

    cache = _get_cache() if use_cache else None
    rate_limiter = _get_rate_limiter()
    stealth = _get_stealth_session()

    # Check cache first
    if cache:
        cached = cache.get(url)
        if cached:
            logger.debug(f"Cache hit for {url}")
            content = cached.content if hasattr(cached, 'content') else cached
            if isinstance(content, bytes):
                content = content.decode('utf-8')
            return BeautifulSoup(content, "html.parser")

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
        headers = {"User-Agent": USER_AGENT}

    start_time = time.time()
    try:
        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        response_time = time.time() - start_time

        # Update rate limiter
        if rate_limiter:
            if response.ok:
                rate_limiter.record_success(response_time)
            else:
                rate_limiter.record_failure(is_rate_limit=(response.status_code == 429))

        response.raise_for_status()
        html = response.text

        # Store in cache
        if cache:
            cache.set(url, response)
            logger.debug(f"Cached response for {url}")

        return BeautifulSoup(html, "html.parser")
    except requests.RequestException as e:
        if rate_limiter:
            rate_limiter.record_failure()
        logger.error(f"Error fetching {url}: {e}")
        return None


def parse_sde_sheet(soup: BeautifulSoup) -> List[InterviewQuestion]:
    """Parse Striver's SDE Sheet page.

    The SDE sheet has 191 problems organized by topic (Day 1-30).
    Each problem has:
    - Problem name
    - Link to solution article
    - Company tags (in the linked article)
    - Difficulty
    - Topic category
    """
    questions = []

    current_topic = "General"

    # Find all headers that indicate topics
    for element in soup.find_all(["h2", "h3", "h4"]):
        text = element.get_text(strip=True)
        # Day headers like "Day 1: Arrays"
        day_match = re.search(r"Day\s*\d+[:\s-]+(.+)", text, re.IGNORECASE)
        if day_match:
            topic_text = day_match.group(1).strip()
            current_topic = normalize_topic(topic_text)

    # Find all problem links
    for link in soup.find_all("a", href=True):
        href = link.get("href", "")
        text = link.get_text(strip=True)

        # Skip navigation/non-problem links
        if not text or len(text) < 3:
            continue
        if any(skip in text.lower() for skip in ["read more", "view all", "next", "prev", "menu"]):
            continue

        # Check if this looks like a problem link (to takeuforward.org article)
        if TAKEUFORWARD_BASE in href or "takeuforward" in href:
            # This is likely a problem
            problem_name = text
            solution_url = href if href.startswith("http") else urljoin(TAKEUFORWARD_BASE, href)

            # Try to extract topic from URL or context
            url_topic = None
            url_lower = href.lower()
            for key, value in TOPIC_ALIASES.items():
                if key in url_lower:
                    url_topic = value
                    break

            question = InterviewQuestion(
                id=generate_question_id(problem_name, "takeuforward"),
                company="Multiple",  # TUF problems are asked by many companies
                position="Software Engineer",
                question_type="coding",
                difficulty="medium",  # Default, can be enriched
                question_text=problem_name,
                source="takeuforward",
                source_url=solution_url,
                posted_date=datetime.utcnow().strftime("%Y-%m-%d"),
                tags=[url_topic or current_topic, "DSA", "Striver"],
            )
            questions.append(question)

    return questions


def parse_problem_article(url: str) -> dict:
    """Parse a single problem article to extract details.

    Returns dict with:
    - difficulty: Easy/Medium/Hard
    - companies: List of company names
    - topics: List of topics
    - answer_hint: Brief solution approach
    """
    soup = fetch_page(url)
    if not soup:
        return {}

    result = {
        "difficulty": "medium",
        "companies": [],
        "topics": [],
        "answer_hint": None,
    }

    # Look for difficulty indicators
    text_content = soup.get_text().lower()
    if "easy" in text_content[:500]:
        result["difficulty"] = "easy"
    elif "hard" in text_content[:500]:
        result["difficulty"] = "hard"
    elif "medium" in text_content[:500]:
        result["difficulty"] = "medium"

    # Look for company tags - often in a section like "Asked in: Amazon, Google, Microsoft"
    company_section = re.search(
        r"(?:asked\s+(?:in|by)|companies?)[:\s]+([^.]+)",
        soup.get_text(),
        re.IGNORECASE
    )
    if company_section:
        companies_text = company_section.group(1)
        # Split by common delimiters
        for company in re.split(r"[,\s&]+", companies_text):
            company = company.strip()
            if len(company) > 2:
                normalized = normalize_company(company)
                if normalized not in result["companies"]:
                    result["companies"].append(normalized)

    # Look for topic tags
    topic_tags = soup.find_all(class_=re.compile(r"tag|topic|category", re.IGNORECASE))
    for tag in topic_tags:
        topic_text = tag.get_text(strip=True)
        if len(topic_text) > 2 and len(topic_text) < 30:
            result["topics"].append(normalize_topic(topic_text))

    # Extract solution approach hint (first paragraph after "Approach" heading)
    approach_section = soup.find(string=re.compile(r"approach|solution", re.IGNORECASE))
    if approach_section:
        parent = approach_section.find_parent()
        if parent:
            next_p = parent.find_next_sibling("p")
            if next_p:
                hint = next_p.get_text(strip=True)[:500]
                result["answer_hint"] = hint

    return result


def scrape_striver_sde_sheet() -> List[InterviewQuestion]:
    """Scrape Striver's SDE Sheet (191 problems).

    Returns list of InterviewQuestion objects.
    """
    print("Fetching Striver's SDE Sheet...")
    soup = fetch_page(STRIVERS_SDE_SHEET)
    if not soup:
        print("Failed to fetch SDE sheet page")
        return []

    questions = parse_sde_sheet(soup)
    print(f"Found {len(questions)} problems in SDE sheet")

    return questions


def scrape_striver_a2z_sheet() -> List[InterviewQuestion]:
    """Scrape Striver's A2Z DSA Course Sheet (455 problems).

    More comprehensive than SDE sheet, organized by topic.
    """
    print("Fetching Striver's A2Z Sheet...")
    soup = fetch_page(STRIVERS_A2Z_SHEET)
    if not soup:
        print("Failed to fetch A2Z sheet page")
        return []

    questions = parse_sde_sheet(soup)  # Same parsing logic
    print(f"Found {len(questions)} problems in A2Z sheet")

    return questions


def scrape_striver_79_sheet() -> List[InterviewQuestion]:
    """Scrape Striver's 79 Last Moment Sheet (79 essential problems).

    Condensed sheet for last-minute interview prep.
    """
    print("Fetching Striver's 79 Sheet...")
    soup = fetch_page(STRIVERS_79_SHEET)
    if not soup:
        print("Failed to fetch 79 sheet page")
        return []

    questions = parse_sde_sheet(soup)  # Same parsing logic
    print(f"Found {len(questions)} problems in 79 sheet")

    return questions


def enrich_questions_with_details(
    questions: List[InterviewQuestion],
    max_fetch: int = 50,
) -> List[InterviewQuestion]:
    """Fetch individual problem pages to get company tags and difficulty.

    Args:
        questions: List of questions to enrich
        max_fetch: Maximum number of pages to fetch (to avoid rate limiting)

    Returns:
        Enriched question list
    """
    print(f"Enriching up to {max_fetch} problems with company/difficulty data...")

    for i, q in enumerate(questions[:max_fetch]):
        if not q.source_url:
            continue

        print(f"  [{i+1}/{max_fetch}] Fetching details for: {q.question_text[:50]}...")
        details = parse_problem_article(q.source_url)

        if details.get("difficulty"):
            q.difficulty = details["difficulty"]
        if details.get("companies"):
            q.company = ", ".join(details["companies"][:3])
        if details.get("topics"):
            q.tags.extend(details["topics"])
            q.tags = list(set(q.tags))  # Dedupe

    return questions


# DSA Topic patterns for enhanced tagging
DSA_TOPIC_PATTERNS = {
    "arrays": [r"\barray\b", r"\bsubarray\b", r"\bsub-array\b"],
    "strings": [r"\bstring\b", r"\bpalindrome\b", r"\banagram\b"],
    "linked_list": [r"\blinked[\s-]?list\b", r"\bll\b", r"\breverse\s+list\b"],
    "binary_tree": [r"\bbinary[\s-]?tree\b", r"\btree[\s-]?traversal\b", r"\bbst\b"],
    "graphs": [r"\bgraph\b", r"\bbfs\b", r"\bdfs\b", r"\bshortest[\s-]?path\b"],
    "dynamic_programming": [r"\bdp\b", r"\bdynamic[\s-]?programming\b", r"\bmemoization\b"],
    "recursion": [r"\brecurs\w+\b", r"\bbacktrack\w+\b"],
    "binary_search": [r"\bbinary[\s-]?search\b", r"\bbisect\b"],
    "two_pointers": [r"\btwo[\s-]?pointer\b", r"\b2[\s-]?pointer\b"],
    "sliding_window": [r"\bsliding[\s-]?window\b", r"\bwindow\b"],
    "stack": [r"\bstack\b", r"\bmonotonic\b", r"\bnext[\s-]?greater\b"],
    "heap": [r"\bheap\b", r"\bpriority[\s-]?queue\b", r"\btop[\s-]?k\b"],
    "greedy": [r"\bgreedy\b", r"\binterval\b", r"\bsched\w+\b"],
    "bit_manipulation": [r"\bbit\b", r"\bxor\b", r"\band\b.*\bor\b"],
    "math": [r"\bgcd\b", r"\blcm\b", r"\bprime\b", r"\bfactorial\b"],
    "sorting": [r"\bsort\b", r"\bmerge\b", r"\bquick\w*sort\b"],
    "hashing": [r"\bhash\w*\b", r"\bfrequency\b", r"\bcount\b"],
    "trie": [r"\btrie\b", r"\bprefix[\s-]?tree\b"],
    "segment_tree": [r"\bsegment[\s-]?tree\b", r"\bfenwick\b", r"\bbit[\s-]?tree\b"],
}


def detect_dsa_topics(text: str) -> List[str]:
    """Detect DSA topics from problem name/description."""
    topics = []
    text_lower = text.lower()

    for topic, patterns in DSA_TOPIC_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                if topic not in topics:
                    topics.append(topic)
                break  # One match per topic is enough

    return topics


def _validate_questions(questions: List[InterviewQuestion]) -> List[InterviewQuestion]:
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

        logger.info(f"Validation: {len(validated)}/{len(questions)} questions passed")
        return validated

    except Exception as e:
        logger.warning(f"Validation failed, returning original: {e}")
        return questions


def scrape_takeuforward(
    include_a2z: bool = True,
    include_79: bool = True,
    enrich: bool = False,
    max_enrich: int = 50,
    validate: bool = True,
    use_cache: bool = True,
) -> List[InterviewQuestion]:
    """Main entry point: scrape all TakeUForward resources.

    Uses production infrastructure:
    - StealthSession for anti-detection
    - ResponseCache for caching (24h TTL - static DSA content)
    - AdaptiveRateLimiter for gentle rate limiting
    - text_parser for robust company detection
    - Monitoring for metrics tracking

    Args:
        include_a2z: Include the A2Z sheet (455 problems)
        include_79: Include the 79 sheet (79 problems)
        enrich: Fetch individual problem pages for company tags
        max_enrich: Max problems to enrich (rate limit protection)
        validate: Run questions through text_parser validation
        use_cache: Use response caching (recommended for static content)

    Returns:
        List of InterviewQuestion objects
    """
    # Use monitoring context if available
    monitoring_ctx = None
    if INFRA_AVAILABLE:
        try:
            monitoring_ctx = monitor_scraper('takeuforward')
            monitoring_ctx.__enter__()
        except Exception as e:
            logger.warning(f"Failed to start monitoring: {e}")

    all_questions: List[InterviewQuestion] = []
    seen_ids: set = set()

    # Always include SDE sheet
    sde_questions = scrape_striver_sde_sheet()
    for q in sde_questions:
        if q.id not in seen_ids:
            # Enhance with DSA topic detection
            detected_topics = detect_dsa_topics(q.question_text)
            if detected_topics:
                q.tags = list(set(q.tags + detected_topics))
            all_questions.append(q)
            seen_ids.add(q.id)

    if include_a2z:
        a2z_questions = scrape_striver_a2z_sheet()
        for q in a2z_questions:
            if q.id not in seen_ids:
                detected_topics = detect_dsa_topics(q.question_text)
                if detected_topics:
                    q.tags = list(set(q.tags + detected_topics))
                all_questions.append(q)
                seen_ids.add(q.id)

    if include_79:
        sheet_79_questions = scrape_striver_79_sheet()
        for q in sheet_79_questions:
            if q.id not in seen_ids:
                detected_topics = detect_dsa_topics(q.question_text)
                if detected_topics:
                    q.tags = list(set(q.tags + detected_topics))
                all_questions.append(q)
                seen_ids.add(q.id)

    logger.info(f"Total unique problems: {len(all_questions)}")
    print(f"Total unique problems: {len(all_questions)}")

    if enrich:
        all_questions = enrich_questions_with_details(all_questions, max_enrich)

    # Validate if requested
    if validate:
        all_questions = _validate_questions(all_questions)

    # Record metrics and close monitoring
    if monitoring_ctx:
        try:
            monitoring_ctx.record_questions(
                extracted=len(all_questions),
                new=len(all_questions),
                duplicate=0,
            )
            monitoring_ctx.__exit__(None, None, None)
        except Exception as e:
            logger.warning(f"Failed to close monitoring: {e}")

    return all_questions


# CLI for testing
if __name__ == "__main__":
    import json

    questions = scrape_takeuforward(
        include_a2z=False,  # Just SDE sheet for quick test
        include_79=True,
        enrich=False,  # Skip enrichment for speed
    )

    print(f"\nScraped {len(questions)} questions")

    # Print sample
    for q in questions[:5]:
        print(f"\n{q.question_text}")
        print(f"  Tags: {q.tags}")
        print(f"  URL: {q.source_url}")
        print(f"  Difficulty: {q.difficulty}")
