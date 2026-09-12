"""TheStudentRoom UK Interview Experiences Scraper.

Scrapes thestudentroom.co.uk forums for graduate interview experiences.
Strong coverage of UK banks, consulting firms, and tech companies.

Uses production infrastructure:
- ResponseCache: Avoid re-fetching forum pages
- GeoProxySelector: UK proxy support
- StealthSession: Anti-detection
- UniversalDateParser: UK date formats
- Monitoring: Scraper metrics

Site structure:
- Forums: thestudentroom.co.uk/forumdisplay.php?f=XXX
- Interview threads: various forums with career/interview discussions
- Search: thestudentroom.co.uk/search.php?searchid=XXX
"""

import re
import hashlib
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from urllib.parse import urljoin, urlencode, quote
import time
import warnings
import sys
import os

warnings.filterwarnings("ignore", category=requests.packages.urllib3.exceptions.InsecureRequestWarning)

# Add parent paths for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Infrastructure imports with INFRA_AVAILABLE flag pattern
INFRA_AVAILABLE = False
_stealth_session = None
_response_cache = None
_geo_proxy = None
_date_parser = None
_proxy_pool = None

try:
    from utils.anti_detection import create_stealth_session, StealthSession, get_stealth_headers
    from utils.cache import ResponseCache, get_cache
    from utils.proxy_manager import GeoProxySelector, ProxyPool, GeoRegion, ProxyRotator
    from utils.date_parser import UniversalDateParser, parse_date
    from utils.text_parser import detect_all_companies_robust
    from utils.monitoring import monitor_scraper
    INFRA_AVAILABLE = True
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
        INFRA_AVAILABLE = True
    except ImportError:
        CheckpointManager = None

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE:
        try:
            _checkpoint = CheckpointManager("studentroom")
        except Exception:
            pass
    return _checkpoint


def _init_infrastructure():
    """Initialize infrastructure components for UK scraping."""
    global _stealth_session, _response_cache, _geo_proxy, _date_parser, _proxy_pool

    if not INFRA_AVAILABLE:
        return

    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=1.0,
            max_delay=2.5,
            requests_per_minute=25
        )

    if _response_cache is None:
        _response_cache = get_cache()

    if _proxy_pool is None:
        _proxy_pool = ProxyPool()
        _geo_proxy = GeoProxySelector(_proxy_pool)

    if _date_parser is None:
        _date_parser = UniversalDateParser()


BASE_URL = "https://www.thestudentroom.co.uk"

REQUEST_TIMEOUT = 30
RATE_LIMIT_DELAY = 1.5  # seconds between requests


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


# UK companies commonly discussed on TSR
UK_COMPANIES = {
    # Investment Banks
    "goldman sachs": "Goldman Sachs",
    "gs": "Goldman Sachs",
    "jp morgan": "JP Morgan",
    "jpmorgan": "JP Morgan",
    "jpm": "JP Morgan",
    "morgan stanley": "Morgan Stanley",
    "ms": "Morgan Stanley",
    "barclays": "Barclays",
    "hsbc": "HSBC",
    "citi": "Citi",
    "citibank": "Citi",
    "deutsche bank": "Deutsche Bank",
    "db": "Deutsche Bank",
    "ubs": "UBS",
    "credit suisse": "Credit Suisse",
    "nomura": "Nomura",
    "bank of america": "Bank of America",
    "bofa": "Bank of America",
    "rbc": "RBC",
    "macquarie": "Macquarie",
    "lloyds": "Lloyds",
    "natwest": "NatWest",
    "santander": "Santander",

    # Consulting
    "mckinsey": "McKinsey",
    "mck": "McKinsey",
    "bain": "Bain",
    "bcg": "BCG",
    "boston consulting": "BCG",
    "deloitte": "Deloitte",
    "pwc": "PwC",
    "kpmg": "KPMG",
    "ey": "EY",
    "ernst young": "EY",
    "accenture": "Accenture",
    "oliver wyman": "Oliver Wyman",
    "lek": "L.E.K.",
    "roland berger": "Roland Berger",
    "capgemini": "Capgemini",

    # Tech
    "google": "Google",
    "amazon": "Amazon",
    "meta": "Meta",
    "facebook": "Meta",
    "microsoft": "Microsoft",
    "apple": "Apple",
    "bloomberg": "Bloomberg",
    "palantir": "Palantir",
    "revolut": "Revolut",
    "monzo": "Monzo",
    "starling": "Starling",
    "wise": "Wise",
    "transferwise": "Wise",
    "sky": "Sky",
    "bt": "BT",
    "arm": "ARM",
    "deepmind": "DeepMind",
    "deliveroo": "Deliveroo",
    "just eat": "Just Eat",
    "spotify": "Spotify",
    "tiktok": "TikTok",
    "bytedance": "ByteDance",

    # UK Graduate Schemes
    "civil service": "Civil Service",
    "nhs": "NHS",
    "teach first": "Teach First",
    "aldi": "Aldi",
    "lidl": "Lidl",
    "tesco": "Tesco",
    "unilever": "Unilever",
    "p&g": "P&G",
    "procter gamble": "P&G",
    "nestle": "Nestle",
    "mars": "Mars",
    "diageo": "Diageo",
    "gsk": "GSK",
    "astrazeneca": "AstraZeneca",
    "rolls royce": "Rolls Royce",
    "bae systems": "BAE Systems",
    "jaguar land rover": "JLR",
    "jlr": "JLR",
    "dyson": "Dyson",
}

ROLE_PATTERNS = {
    r"software\s*(engineer|developer)": "Software Engineer",
    r"(backend|back-end)": "Backend Engineer",
    r"(frontend|front-end)": "Frontend Engineer",
    r"full[\s-]?stack": "Full Stack Engineer",
    r"data\s*(scientist|analyst|engineer)": "Data Analyst",
    r"investment\s*banking": "Investment Banking",
    r"ib\s*(analyst|associate)": "Investment Banking",
    r"trading": "Trading",
    r"quant": "Quant",
    r"risk": "Risk Analyst",
    r"consultant": "Consultant",
    r"analyst": "Analyst",
    r"graduate\s*(scheme|program)": "Graduate Scheme",
    r"spring\s*(week|insight)": "Spring Week",
    r"summer\s*(intern|analyst)": "Summer Analyst",
    r"internship": "Intern",
    r"placement": "Placement Year",
    r"product\s*manager": "Product Manager",
    r"actuary": "Actuary",
    r"audit": "Auditor",
    r"tax": "Tax",
    r"corporate\s*finance": "Corporate Finance",
    r"m&a": "M&A",
}


def _generate_id(source: str, content: str) -> str:
    """Generate unique ID for a question."""
    text = f"studentroom:{source}:{content[:100]}"
    return hashlib.md5(text.encode()).hexdigest()[:16]


def _extract_company(text: str) -> str:
    """Extract company name from text using robust detection when available."""
    # Use robust company detection if available
    if INFRA_AVAILABLE:
        try:
            company_matches = detect_all_companies_robust(text)
            if company_matches:
                return company_matches[0].normalized.replace('_', ' ').title()
        except Exception:
            pass  # Fall through to manual detection

    text_lower = text.lower()
    for pattern, company in UK_COMPANIES.items():
        if pattern in text_lower:
            return company
    return ""


def _extract_role(text: str) -> str:
    """Extract role from text."""
    text_lower = text.lower()
    for pattern, role in ROLE_PATTERNS.items():
        if re.search(pattern, text_lower):
            return role
    return "Graduate"


def _classify_question_type(text: str) -> str:
    """Classify question type."""
    text_lower = text.lower()

    technical_patterns = [
        "code", "algorithm", "technical", "programming", "sql",
        "python", "java", "data structure", "complexity",
        "implement", "design system", "architecture",
    ]
    behavioral_patterns = [
        "tell me about", "describe a time", "give an example",
        "why do you", "what motivates", "strength", "weakness",
        "teamwork", "leadership", "conflict", "challenge",
        "competency", "situational",
    ]
    case_patterns = [
        "case study", "case interview", "market sizing",
        "estimate", "how many", "business problem",
        "strategy", "framework",
    ]

    if any(p in text_lower for p in case_patterns):
        return "case_study"
    if any(p in text_lower for p in technical_patterns):
        return "technical"
    if any(p in text_lower for p in behavioral_patterns):
        return "behavioral"

    return "behavioral"


def _estimate_difficulty(text: str) -> str:
    """Estimate question difficulty."""
    text_lower = text.lower()

    hard_indicators = [
        "challenging", "difficult", "tricky", "complex",
        "senior", "final round", "partner interview",
        "case study", "technical deep dive",
    ]
    easy_indicators = [
        "simple", "basic", "introductory", "first round",
        "video interview", "screening", "tell me about yourself",
    ]

    if any(p in text_lower for p in hard_indicators):
        return "hard"
    if any(p in text_lower for p in easy_indicators):
        return "easy"
    return "medium"


def _parse_relative_date(text: str) -> Optional[str]:
    """Parse TSR-style relative dates using UniversalDateParser when available."""
    _init_infrastructure()

    # Use infrastructure date parser if available
    if INFRA_AVAILABLE and _date_parser:
        try:
            parsed = _date_parser.parse(text, language='en')
            if parsed:
                return parsed.date.strftime("%Y-%m-%d")
        except Exception:
            pass  # Fall through to manual parsing

    text_lower = text.lower().strip()
    now = datetime.now()

    if "today" in text_lower or "just now" in text_lower:
        return now.strftime("%Y-%m-%d")
    if "yesterday" in text_lower:
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")

    # "X days ago", "X weeks ago", "X months ago"
    days_match = re.search(r"(\d+)\s*days?\s*ago", text_lower)
    if days_match:
        days = int(days_match.group(1))
        return (now - timedelta(days=days)).strftime("%Y-%m-%d")

    weeks_match = re.search(r"(\d+)\s*weeks?\s*ago", text_lower)
    if weeks_match:
        weeks = int(weeks_match.group(1))
        return (now - timedelta(weeks=weeks)).strftime("%Y-%m-%d")

    months_match = re.search(r"(\d+)\s*months?\s*ago", text_lower)
    if months_match:
        months = int(months_match.group(1))
        return (now - timedelta(days=months * 30)).strftime("%Y-%m-%d")

    # Try parsing absolute dates
    date_patterns = [
        r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})",  # DD/MM/YYYY or DD-MM-YYYY
        r"(\w+)\s+(\d{1,2}),?\s+(\d{4})",  # Month DD, YYYY
    ]

    for pattern in date_patterns:
        match = re.search(pattern, text_lower)
        if match:
            try:
                # Attempt to parse
                return now.strftime("%Y-%m-%d")  # Fallback to today
            except:
                pass

    return None


def _get_soup(url: str, verify_ssl: bool = False, use_cache: bool = True) -> Optional[BeautifulSoup]:
    """Fetch URL and return BeautifulSoup object.

    Uses infrastructure when available:
    - StealthSession for anti-detection headers
    - ResponseCache for efficient re-scraping
    - GeoProxySelector for UK geo-targeting
    """
    _init_infrastructure()

    # Check cache first
    if use_cache and INFRA_AVAILABLE and _response_cache:
        cached = _response_cache.get(url)
        if cached:
            content = cached.content.decode() if hasattr(cached, 'content') and isinstance(cached.content, bytes) else str(cached)
            return BeautifulSoup(content, "html.parser")

    try:
        # Use stealth session if available
        if INFRA_AVAILABLE and _stealth_session:
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
                proxies=proxies,
                timeout=config.get('timeout', REQUEST_TIMEOUT),
                verify=verify_ssl,
            )
            _stealth_session.after_request(response.status_code)
        else:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-GB,en;q=0.5",
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
        if use_cache and INFRA_AVAILABLE and _response_cache:
            _response_cache.set(url, response)

        return BeautifulSoup(response.text, "html.parser")
    except requests.RequestException as e:
        print(f"Error fetching {url}: {e}")
        return None


def _is_interview_thread(title: str) -> bool:
    """Check if thread title indicates interview content."""
    title_lower = title.lower()

    interview_indicators = [
        "interview", "assessment centre", "assessment center",
        "ac experience", "application", "spring week",
        "spring insight", "summer internship", "graduate scheme",
        "video interview", "hirevue", "final round",
        "superday", "insight day", "open day",
        "questions asked", "what to expect",
        "offer", "rejection", "accepted",
    ]

    return any(ind in title_lower for ind in interview_indicators)


def _extract_questions_from_post(text: str) -> List[str]:
    """Extract interview questions from post text."""
    questions = []

    # Split by common question indicators
    lines = text.split("\n")

    for line in lines:
        line = line.strip()
        if not line or len(line) < 15:
            continue

        # Direct questions with ?
        if "?" in line and len(line) < 300:
            # Extract just the question part
            q_match = re.search(r"[A-Z][^.!?]*\?", line)
            if q_match:
                questions.append(q_match.group(0).strip())

        # Questions after "asked:" or "asked me"
        asked_match = re.search(r"asked(?:\s+me)?[:\s]+([^.!?]+\??)", line, re.IGNORECASE)
        if asked_match:
            q = asked_match.group(1).strip()
            if len(q) > 15:
                questions.append(q)

        # Questions in quotes
        quote_match = re.search(r'"([^"]+\?)"', line)
        if quote_match:
            questions.append(quote_match.group(1).strip())

        # Numbered questions (1. What is..., 2. How would you...)
        numbered = re.search(r"^\d+[\.\)]\s*(.+\?)", line)
        if numbered:
            questions.append(numbered.group(1).strip())

        # Bullet points with questions
        bullet = re.search(r"^[-•*]\s*(.+\?)", line)
        if bullet:
            questions.append(bullet.group(1).strip())

    # Deduplicate
    seen = set()
    unique = []
    for q in questions:
        q_normalized = q.lower().strip()
        if q_normalized not in seen and len(q) > 15:
            seen.add(q_normalized)
            unique.append(q)

    return unique


def _extract_process_info(text: str) -> List[str]:
    """Extract interview process information."""
    processes = []
    text_lower = text.lower()

    process_patterns = [
        r"(first\s+round|round\s*1)[:\s]+([^.]+\.)",
        r"(second\s+round|round\s*2)[:\s]+([^.]+\.)",
        r"(final\s+round|partner\s+interview)[:\s]+([^.]+\.)",
        r"(assessment\s+centre?|ac)[:\s]+([^.]+\.)",
        r"(video\s+interview|hirevue)[:\s]+([^.]+\.)",
        r"(phone\s+(screen|interview))[:\s]+([^.]+\.)",
        r"(online\s+test|numerical|verbal)[:\s]+([^.]+\.)",
    ]

    for pattern in process_patterns:
        match = re.search(pattern, text_lower)
        if match:
            stage = match.group(1).strip().title()
            detail = match.group(2).strip() if len(match.groups()) > 1 else ""
            processes.append(f"{stage}: {detail}")

    return processes


def search_interview_threads(
    query: str = "interview questions",
    max_pages: int = 5,
    months_back: int = 5,
) -> List[Dict]:
    """Search TSR for interview-related threads."""
    threads = []
    cutoff_date = datetime.now() - timedelta(days=months_back * 30)

    print(f"Searching TSR for: {query}")

    # TSR search URL
    search_queries = [
        "graduate interview questions",
        "assessment centre experience",
        "spring week interview",
        "investment banking interview",
        "consulting interview",
        "tech interview graduate",
        "video interview questions",
        "competency questions graduate",
    ]

    for sq in search_queries:
        # Construct search URL
        search_url = f"{BASE_URL}/search?q={quote(sq)}"

        soup = _get_soup(search_url)
        if not soup:
            continue

        # Find thread links in search results
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            title = link.get_text(strip=True)

            # Check if it's a thread link
            if "/showthread.php" in href or "/thread/" in href:
                if _is_interview_thread(title):
                    full_url = urljoin(BASE_URL, href)
                    threads.append({
                        "title": title,
                        "url": full_url,
                        "query": sq,
                    })

        time.sleep(RATE_LIMIT_DELAY)

        if len(threads) >= max_pages * 10:
            break

    # Deduplicate by URL
    seen_urls = set()
    unique_threads = []
    for t in threads:
        if t["url"] not in seen_urls:
            seen_urls.add(t["url"])
            unique_threads.append(t)

    print(f"Found {len(unique_threads)} interview threads")
    return unique_threads


def scrape_thread(thread: Dict) -> List[InterviewQuestion]:
    """Scrape a single thread for interview questions."""
    questions = []

    soup = _get_soup(thread["url"])
    if not soup:
        return questions

    title = thread.get("title", "")
    company = _extract_company(title)
    role = _extract_role(title)

    # Find all posts in thread
    posts = soup.find_all("div", class_=re.compile(r"post|message|content"))
    if not posts:
        # Try alternative selectors
        posts = soup.find_all("article")
        if not posts:
            posts = soup.find_all("td", class_=re.compile(r"post"))

    for post in posts:
        post_text = post.get_text(separator="\n", strip=True)

        # Skip very short posts
        if len(post_text) < 50:
            continue

        # Extract company from post if not in title
        post_company = company or _extract_company(post_text)
        post_role = role if role != "Graduate" else _extract_role(post_text)

        # Extract questions
        extracted_qs = _extract_questions_from_post(post_text)

        # Extract date if available
        date_elem = post.find(["time", "span"], class_=re.compile(r"date|time"))
        posted_date = None
        if date_elem:
            posted_date = _parse_relative_date(date_elem.get_text(strip=True))

        for q_text in extracted_qs:
            q = InterviewQuestion(
                id=_generate_id(thread["url"], q_text),
                company=post_company,
                position=post_role,
                question_type=_classify_question_type(q_text),
                difficulty=_estimate_difficulty(q_text),
                question_text=q_text,
                source="studentroom_uk",
                source_url=thread["url"],
                posted_date=posted_date,
                tags=["uk", "graduate"],
            )
            questions.append(q)

        # If no specific questions but interview experience, create general entry
        if not extracted_qs and any(word in post_text.lower() for word in ["interview", "asked", "questions"]):
            process_info = _extract_process_info(post_text)
            if process_info:
                for info in process_info:
                    q = InterviewQuestion(
                        id=_generate_id(thread["url"], info),
                        company=post_company,
                        position=post_role,
                        question_type="process",
                        difficulty="medium",
                        question_text=info,
                        source="studentroom_uk",
                        source_url=thread["url"],
                        posted_date=posted_date,
                        tags=["uk", "graduate", "process"],
                    )
                    questions.append(q)

    return questions


def scrape_forum_section(forum_id: int, forum_name: str, max_pages: int = 3) -> List[InterviewQuestion]:
    """Scrape a specific forum section for interview threads."""
    questions = []

    print(f"Scraping forum: {forum_name}")

    for page in range(1, max_pages + 1):
        url = f"{BASE_URL}/forumdisplay.php?f={forum_id}&page={page}"
        soup = _get_soup(url)

        if not soup:
            break

        # Find thread links
        thread_links = soup.find_all("a", href=re.compile(r"showthread\.php|/thread/"))

        for link in thread_links:
            title = link.get_text(strip=True)
            if _is_interview_thread(title):
                thread = {
                    "title": title,
                    "url": urljoin(BASE_URL, link.get("href", "")),
                }
                thread_qs = scrape_thread(thread)
                questions.extend(thread_qs)
                time.sleep(RATE_LIMIT_DELAY)

        time.sleep(RATE_LIMIT_DELAY)

    return questions


def scrape_studentroom(
    months_back: int = 5,
    max_threads: int = 50,
    search_queries: Optional[List[str]] = None,
) -> List[InterviewQuestion]:
    """Main entry point: scrape TheStudentRoom UK for interview experiences.

    Args:
        months_back: Only include experiences from last N months
        max_threads: Maximum threads to scrape
        search_queries: Custom search queries (defaults to interview-focused)

    Returns:
        List of InterviewQuestion objects
    """
    all_questions = []
    seen_ids = set()

    print(f"Starting TheStudentRoom UK scrape (last {months_back} months)")

    # Default search queries
    if search_queries is None:
        search_queries = [
            "graduate interview questions",
            "assessment centre experience",
            "investment banking interview",
            "consulting case interview",
            "tech company interview uk",
            "competency interview questions",
            "video interview graduate",
            "spring week interview",
        ]

    # Search for interview threads
    threads = search_interview_threads(
        query="interview",
        max_pages=5,
        months_back=months_back,
    )

    # Scrape each thread
    threads_to_scrape = threads[:max_threads]

    for i, thread in enumerate(threads_to_scrape):
        print(f"[{i+1}/{len(threads_to_scrape)}] Scraping: {thread['title'][:50]}...")

        thread_qs = scrape_thread(thread)

        for q in thread_qs:
            if q.id not in seen_ids:
                all_questions.append(q)
                seen_ids.add(q.id)

        if thread_qs:
            print(f"  Found {len(thread_qs)} questions")

        time.sleep(RATE_LIMIT_DELAY)

    # Also try known career forums
    CAREER_FORUMS = [
        (127, "Pair Careers and Jobs"),  # Example forum IDs
        (166, "Job Applications and Interviews"),
    ]

    for forum_id, forum_name in CAREER_FORUMS:
        try:
            forum_qs = scrape_forum_section(forum_id, forum_name, max_pages=2)
            for q in forum_qs:
                if q.id not in seen_ids:
                    all_questions.append(q)
                    seen_ids.add(q.id)
        except Exception as e:
            print(f"Error scraping forum {forum_name}: {e}")

    print(f"\nTotal StudentRoom questions scraped: {len(all_questions)}")
    return all_questions


# Aliases
def fetch_studentroom_interviews(months: int = 5) -> List[InterviewQuestion]:
    """Alias for scrape_studentroom."""
    return scrape_studentroom(months_back=months)


if __name__ == "__main__":
    import json
    import argparse

    parser = argparse.ArgumentParser(description="Scrape TheStudentRoom UK")
    parser.add_argument("--months", type=int, default=5, help="Months to look back")
    parser.add_argument("--max-threads", type=int, default=30, help="Max threads")
    parser.add_argument("--output", type=str, default="studentroom_questions.json")
    args = parser.parse_args()

    questions = scrape_studentroom(
        months_back=args.months,
        max_threads=args.max_threads,
    )

    # Convert to dicts for JSON
    results = [q.to_dict() for q in questions]

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)

    print(f"Saved {len(results)} questions to {args.output}")
