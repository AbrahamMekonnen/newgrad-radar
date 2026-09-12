"""WikiJob UK Interview Questions Scraper.

Scrapes wikijob.co.uk for interview questions database.
Good coverage of UK companies + global firms with UK offices.

Site structure:
- Main questions page: wikijob.co.uk/interview-advice/interview-questions
- Individual question pages: wikijob.co.uk/interview-advice/interview-questions/{slug}
- Topic pages: competency-based, case-study, technical, etc.

Infrastructure:
- StealthSession for anti-detection
- ResponseCache for efficient re-scraping
- GeoProxySelector for UK geo-targeting
- UniversalDateParser for UK date formats
"""

import re
import hashlib
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from urllib.parse import urljoin
import time
import warnings
import sys
import os

# Add parent paths for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Infrastructure imports with INFRA_AVAILABLE flag pattern
HAS_INFRASTRUCTURE = False
_proxy_pool = None

try:
    from utils.anti_detection import create_stealth_session, StealthSession, get_stealth_headers
    from utils.cache import ResponseCache, get_cache
    from utils.proxy_manager import GeoProxySelector, ProxyPool, GeoRegion, ProxyRotator
    from utils.date_parser import UniversalDateParser, parse_date
    from utils.text_parser import detect_all_companies_robust
    from utils.monitoring import monitor_scraper
    HAS_INFRASTRUCTURE = True
except ImportError:
    try:
        # Fallback for relative imports when used as module
        from ...utils.anti_detection import create_stealth_session, StealthSession, get_stealth_headers
        from ...utils.cache import ResponseCache, get_cache
        from ...utils.proxy_manager import GeoProxySelector, ProxyPool, GeoRegion, ProxyRotator
        from ...utils.date_parser import UniversalDateParser, parse_date
        from ...utils.text_parser import detect_all_companies_robust
        from ...utils.monitoring import monitor_scraper
        from ...utils.error_handler import CheckpointManager
        HAS_INFRASTRUCTURE = True
    except ImportError:
        print("[wikijob] Infrastructure modules not available, using basic mode")
        CheckpointManager = None

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and HAS_INFRASTRUCTURE:
        try:
            _checkpoint = CheckpointManager("wikijob")
        except Exception:
            pass
    return _checkpoint

# Suppress SSL warnings when using verify=False
warnings.filterwarnings("ignore", category=requests.packages.urllib3.exceptions.InsecureRequestWarning)


BASE_URL = "https://www.wikijob.co.uk"
QUESTIONS_URL = f"{BASE_URL}/interview-advice/interview-questions"

REQUEST_TIMEOUT = 30
RATE_LIMIT_DELAY = 1.0  # seconds between requests

# Initialize infrastructure
_stealth_session: Optional['StealthSession'] = None
_response_cache: Optional['ResponseCache'] = None
_geo_proxy: Optional['GeoProxySelector'] = None
_date_parser: Optional['UniversalDateParser'] = None


def _init_infrastructure():
    """Initialize infrastructure components for UK scraping."""
    global _stealth_session, _response_cache, _geo_proxy, _date_parser, _proxy_pool

    if not HAS_INFRASTRUCTURE:
        return

    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=0.8,
            max_delay=2.0,
            requests_per_minute=30
        )

    if _response_cache is None:
        _response_cache = get_cache()

    if _proxy_pool is None:
        _proxy_pool = ProxyPool()
        _geo_proxy = GeoProxySelector(_proxy_pool)

    if _date_parser is None:
        _date_parser = UniversalDateParser()


@dataclass
class InterviewQuestion:
    """Represents a single interview question."""
    id: str
    company: str
    position: str
    question_type: str
    difficulty: str
    question_text: str
    source: str
    source_url: str
    posted_date: Optional[str]
    tags: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Question type patterns
QUESTION_TYPE_MAP = {
    "competency": "behavioral",
    "behavioral": "behavioral",
    "situational": "behavioral",
    "technical": "technical",
    "coding": "coding",
    "case-study": "system_design",
    "case study": "system_design",
    "problem-solving": "technical",
    "strength-based": "behavioral",
    "motivational": "behavioral",
    "it-interview": "technical",
}

# Common role mappings
ROLE_PATTERNS = {
    r"software\s*(engineer|developer)": "Software Engineer",
    r"(backend|back-end)\s*engineer": "Backend Engineer",
    r"(frontend|front-end)\s*engineer": "Frontend Engineer",
    r"full[\s-]?stack": "Full Stack Engineer",
    r"data\s*(scientist|engineer|analyst)": "Data Engineer",
    r"machine\s*learning": "ML Engineer",
    r"devops": "DevOps Engineer",
    r"cloud\s*engineer": "Cloud Engineer",
    r"analyst": "Analyst",
    r"product\s*manager": "Product Manager",
    r"consultant": "Consultant",
    r"graduate": "Graduate",
    r"intern": "Intern",
    r"\bit\b": "IT Professional",
}


def _generate_id(source: str, question: str) -> str:
    """Generate unique ID for a question."""
    content = f"wikijob:{source}:{question[:100]}"
    return hashlib.md5(content.encode()).hexdigest()[:16]


def _extract_role_from_text(text: str) -> str:
    """Extract role from question context."""
    text_lower = text.lower()
    for pattern, role in ROLE_PATTERNS.items():
        if re.search(pattern, text_lower):
            return role
    return "General"


def _infer_difficulty(question: str) -> str:
    """Infer difficulty from question complexity."""
    question_lower = question.lower()

    hard_indicators = [
        "complex", "challenging", "difficult", "senior", "lead",
        "architect", "design a system", "scale", "millions",
        "case study", "technical deep",
    ]
    easy_indicators = [
        "tell me about yourself", "why do you want", "strength", "weakness",
        "introduce yourself", "describe yourself", "basic",
    ]

    if any(ind in question_lower for ind in hard_indicators):
        return "hard"
    if any(ind in question_lower for ind in easy_indicators):
        return "easy"
    return "medium"


def _infer_question_type(url: str, title: str, content: str = "") -> str:
    """Infer question type from URL slug and content."""
    url_lower = url.lower()
    title_lower = title.lower()
    combined = f"{url_lower} {title_lower} {content.lower()}"

    # Check URL/title patterns
    for key, qtype in QUESTION_TYPE_MAP.items():
        if key in combined:
            return qtype

    # Infer from content
    technical_indicators = [
        "code", "algorithm", "data structure", "complexity",
        "implement", "design", "architecture", "database",
        "api", "system", "technical", "programming", "it interview",
    ]
    behavioral_indicators = [
        "tell me about a time", "describe a situation",
        "how would you handle", "give an example",
        "what would you do", "why do you want",
        "strength", "weakness", "teamwork", "conflict",
    ]

    if any(ind in combined for ind in technical_indicators):
        return "technical"
    if any(ind in combined for ind in behavioral_indicators):
        return "behavioral"

    return "behavioral"  # Default for WikiJob


def _get_soup(url: str, verify_ssl: bool = False, use_cache: bool = True) -> Optional[BeautifulSoup]:
    """Fetch URL and return BeautifulSoup object.

    Uses infrastructure when available:
    - StealthSession for anti-detection headers
    - ResponseCache for efficient re-scraping
    - GeoProxySelector for UK geo-targeting
    """
    _init_infrastructure()

    # Check cache first
    if use_cache and _response_cache and HAS_INFRASTRUCTURE:
        cached = _response_cache.get(url)
        if cached:
            content = cached.content.decode() if hasattr(cached, 'content') and isinstance(cached.content, bytes) else str(cached)
            return BeautifulSoup(content, "html.parser")

    try:
        # Use stealth session if available
        if _stealth_session and HAS_INFRASTRUCTURE:
            config = _stealth_session.get_request_config(url)
            headers = config.get('headers', {})
            headers["Accept-Language"] = "en-GB,en;q=0.9"

            # Get proxy for UK if available
            proxies = None
            if _geo_proxy:
                proxy = _geo_proxy.select_proxy(url)
                if proxy:
                    proxies = proxy.proxy_dict

            # Rate limit check
            if not _stealth_session.before_request():
                time.sleep(1.0)

            response = requests.get(
                url,
                headers=headers,
                timeout=config.get('timeout', REQUEST_TIMEOUT),
                verify=verify_ssl,
                proxies=proxies,
            )
            _stealth_session.after_request(response.status_code)
        else:
            # Fallback to basic headers
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-GB,en;q=0.9",
                "Connection": "keep-alive",
            }
            response = requests.get(
                url,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
                verify=verify_ssl,
            )

        response.raise_for_status()

        # Cache the response
        if use_cache and _response_cache and HAS_INFRASTRUCTURE:
            _response_cache.set(url, response)

        return BeautifulSoup(response.text, "html.parser")
    except requests.RequestException as e:
        print(f"Error fetching {url}: {e}")
        return None


def _is_valid_interview_question(text: str) -> bool:
    """Check if text looks like a valid interview question."""
    text_lower = text.lower()

    # Exclude non-interview content
    exclude_patterns = [
        "bitcoin", "crypto", "invest", "advertisement", "trading",
        "cookie", "privacy policy", "subscribe", "newsletter",
        "click here", "download", "sign up", "read more",
        "share this", "follow us", "copyright", "forex", "stock market",
        "real estate", "affiliate", "earn money", "passive income",
        "unenlightened", "universal answers", "employers don't want",
        "research the job", "answers that", "avoid saying",
    ]
    if any(p in text_lower for p in exclude_patterns):
        return False

    # Must contain interview-related context
    interview_context = [
        "interview", "job", "position", "role", "company", "employer",
        "candidate", "hire", "work", "career", "strength", "weakness",
        "experience", "skill", "team", "manager", "colleague",
        "challenge", "achieve", "accomplish", "conflict", "deadline",
    ]

    # Must look like a question or question prompt
    question_indicators = [
        "?", "tell me", "describe", "explain", "what ", "how ",
        "why ", "give an example", "can you", "would you",
        "have you", "do you", "are you", "were you",
    ]

    has_question_form = any(ind in text_lower for ind in question_indicators)
    has_interview_context = any(ctx in text_lower for ctx in interview_context)

    # Require both question form AND interview context for headings
    # (list items in interview question pages are more trusted)
    return has_question_form and (has_interview_context or "?" in text)


def _extract_questions_from_page(soup: BeautifulSoup, url: str) -> List[str]:
    """Extract individual question texts from a page."""
    questions = []

    # Find question lists (ol, ul)
    for lst in soup.find_all(["ol", "ul"]):
        for li in lst.find_all("li", recursive=False):
            text = li.get_text(strip=True)
            # Filter to actual questions
            if text and len(text) > 15 and len(text) < 500:
                if _is_valid_interview_question(text):
                    questions.append(text)

    # Find headings that are questions (h2, h3, h4)
    for heading in soup.find_all(["h2", "h3", "h4"]):
        text = heading.get_text(strip=True)
        if text and len(text) > 15 and len(text) < 300:
            if _is_valid_interview_question(text):
                questions.append(text)

    # Find numbered paragraphs (1. Question, 2. Question)
    for p in soup.find_all("p"):
        text = p.get_text(strip=True)
        numbered_match = re.match(r"^(\d+[\.\)]\s*)(.+\?)", text)
        if numbered_match:
            question = numbered_match.group(2).strip()
            if len(question) > 15 and _is_valid_interview_question(question):
                questions.append(question)

    # Clean up and deduplicate
    cleaned = []
    for q in questions:
        # Remove "empty" artifacts from HTML
        q = re.sub(r"empty+", " ", q)
        # Remove extra whitespace
        q = re.sub(r"\s+", " ", q).strip()
        # Skip if too short after cleanup
        if len(q) > 15:
            cleaned.append(q)

    return list(set(cleaned))


def fetch_question_pages() -> List[Dict]:
    """Fetch list of question pages from WikiJob."""
    print("Fetching WikiJob question pages...")
    soup = _get_soup(QUESTIONS_URL)
    if not soup:
        return []

    pages = []
    seen_slugs = set()

    # Find all links to individual question pages
    links = soup.find_all("a", href=re.compile(r"/interview-advice/interview-questions/[^/]+$"))

    for link in links:
        href = link.get("href", "")
        slug = href.split("/")[-1]

        # Skip duplicates and generic pages
        if slug in seen_slugs:
            continue
        if slug in ["", "interview-questions"]:
            continue

        title = link.get_text(strip=True)
        if title and len(title) > 3:
            pages.append({
                "title": title,
                "url": urljoin(BASE_URL, href),
                "slug": slug,
            })
            seen_slugs.add(slug)

    print(f"Found {len(pages)} question pages on WikiJob")
    return pages


def scrape_question_page(page: Dict) -> List[InterviewQuestion]:
    """Scrape a single question page for interview questions.

    Args:
        page: Dict with title, url, slug

    Returns:
        List of InterviewQuestion objects
    """
    questions = []

    soup = _get_soup(page["url"])
    if not soup:
        return questions

    # Get the main page title/question
    main_title = page["title"]

    # Extract all questions from the page
    question_texts = _extract_questions_from_page(soup, page["url"])

    # Determine question type and tags from the page
    q_type = _infer_question_type(page["url"], main_title, "")
    tags = [page["slug"].replace("-", "_")]

    # Add the main page title as a question if it looks like one
    if "?" in main_title:
        q = InterviewQuestion(
            id=_generate_id(page["slug"], main_title),
            company="",  # WikiJob doesn't organize by company
            position=_extract_role_from_text(main_title),
            question_type=q_type,
            difficulty=_infer_difficulty(main_title),
            question_text=main_title,
            source="wikijob_uk",
            source_url=page["url"],
            posted_date=None,
            tags=tags,
        )
        questions.append(q)

    # Add other questions found on the page
    for text in question_texts:
        # Skip if same as main title
        if text.lower() == main_title.lower():
            continue

        q = InterviewQuestion(
            id=_generate_id(page["slug"], text),
            company="",
            position=_extract_role_from_text(text),
            question_type=_infer_question_type("", text, ""),
            difficulty=_infer_difficulty(text),
            question_text=text,
            source="wikijob_uk",
            source_url=page["url"],
            posted_date=None,
            tags=tags,
        )
        questions.append(q)

    return questions


def scrapeWikiJob(
    max_pages: int = 100,
    months_back: int = 5,
) -> List[InterviewQuestion]:
    """Main entry point: scrape WikiJob UK for interview questions.

    Args:
        max_pages: Maximum number of question pages to scrape
        months_back: Not used (WikiJob doesn't have dates), kept for API consistency

    Returns:
        List of InterviewQuestion objects
    """
    all_questions = []
    seen_ids = set()

    print(f"Starting WikiJob UK scrape (max {max_pages} pages)")

    # 1. Fetch question page list
    pages = fetch_question_pages()

    # 2. Scrape each page (with rate limiting)
    pages_to_scrape = pages[:max_pages]

    for i, page in enumerate(pages_to_scrape):
        print(f"[{i+1}/{len(pages_to_scrape)}] Scraping: {page['title'][:50]}...")

        page_questions = scrape_question_page(page)

        for q in page_questions:
            if q.id not in seen_ids:
                all_questions.append(q)
                seen_ids.add(q.id)

        if page_questions:
            print(f"  Found {len(page_questions)} questions")

        time.sleep(RATE_LIMIT_DELAY)

    print(f"\nTotal WikiJob questions scraped: {len(all_questions)}")
    return all_questions


# Alias for consistency
def scrape_wikijob_uk(**kwargs) -> List[InterviewQuestion]:
    """Alias for scrapeWikiJob."""
    return scrapeWikiJob(**kwargs)
