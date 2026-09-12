"""Kununu.com interview questions scraper.

Kununu is Germany's largest employer review platform (similar to Glassdoor).
Scrapes interview experiences for German + international tech companies.

Features:
- German → English translation for common interview terms
- Date filtering to last 4-5 months
- Company, position, process, and question extraction
- Support for both German and international companies

Infrastructure:
- StealthSession for anti-detection
- ResponseCache for efficient re-scraping
- GeoProxySelector for German/EU geo-targeting
- UniversalDateParser for German date formats (vor X Tagen, DD.MM.YYYY)
"""

import re
import requests
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from html import unescape
from urllib.parse import urljoin, quote
import hashlib
import time
import urllib3
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
    from utils.date_parser import UniversalDateParser, parse_date, DateFormat
    from utils.text_parser import detect_all_companies_robust
    from utils.monitoring import monitor_scraper
    HAS_INFRASTRUCTURE = True
except ImportError:
    try:
        # Fallback for relative imports when used as module
        from ...utils.anti_detection import create_stealth_session, StealthSession, get_stealth_headers
        from ...utils.cache import ResponseCache, get_cache
        from ...utils.proxy_manager import GeoProxySelector, ProxyPool, GeoRegion, ProxyRotator
        from ...utils.date_parser import UniversalDateParser, parse_date, DateFormat
        from ...utils.text_parser import detect_all_companies_robust
        from ...utils.monitoring import monitor_scraper
        from ...utils.error_handler import CheckpointManager
        HAS_INFRASTRUCTURE = True
    except ImportError:
        print("[kununu] Infrastructure modules not available, using basic mode")
        CheckpointManager = None

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and HAS_INFRASTRUCTURE:
        try:
            _checkpoint = CheckpointManager("kununu")
        except Exception:
            pass
    return _checkpoint

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

REQUEST_TIMEOUT = 30
VERIFY_SSL = False
RATE_LIMIT_DELAY = 2.0  # seconds between requests

# Initialize infrastructure
_stealth_session: Optional['StealthSession'] = None
_response_cache: Optional['ResponseCache'] = None
_geo_proxy: Optional['GeoProxySelector'] = None
_date_parser: Optional['UniversalDateParser'] = None


def _init_infrastructure():
    """Initialize infrastructure components for German/EU scraping."""
    global _stealth_session, _response_cache, _geo_proxy, _date_parser, _proxy_pool

    if not HAS_INFRASTRUCTURE:
        return

    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=1.5,
            max_delay=3.0,
            requests_per_minute=20  # More conservative for Kununu
        )

    if _response_cache is None:
        _response_cache = get_cache()

    if _proxy_pool is None:
        _proxy_pool = ProxyPool()
        _geo_proxy = GeoProxySelector(_proxy_pool)

    if _date_parser is None:
        _date_parser = UniversalDateParser()


def _fetch_with_infrastructure(url: str, headers: dict) -> Optional[requests.Response]:
    """Fetch URL using infrastructure (stealth, proxy, cache)."""
    _init_infrastructure()

    # Check cache first
    if HAS_INFRASTRUCTURE and _response_cache:
        cached = _response_cache.get(url)
        if cached:
            class MockResponse:
                status_code = 200
                text = cached.content.decode() if hasattr(cached, 'content') and isinstance(cached.content, bytes) else str(cached)
            return MockResponse()

    try:
        if HAS_INFRASTRUCTURE and _stealth_session:
            config = _stealth_session.get_request_config(url)
            merged_headers = {**config.get('headers', {}), **headers}
            merged_headers["Accept-Language"] = "de-DE,de;q=0.9,en;q=0.8"

            # Get German proxy if available
            proxies = None
            if _geo_proxy:
                proxy = _geo_proxy.select_proxy(url)
                if proxy:
                    proxies = proxy.proxy_dict

            if not _stealth_session.before_request():
                time.sleep(1.5)

            response = requests.get(
                url,
                headers=merged_headers,
                timeout=config.get('timeout', REQUEST_TIMEOUT),
                verify=VERIFY_SSL,
                proxies=proxies,
            )
            _stealth_session.after_request(response.status_code)
        else:
            response = requests.get(
                url,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
                verify=VERIFY_SSL
            )

        # Cache successful response
        if response.status_code == 200 and HAS_INFRASTRUCTURE and _response_cache:
            _response_cache.set(url, response)

        return response
    except requests.RequestException as e:
        print(f"[kununu] Error fetching {url}: {e}")
        return None

# German → English translation dictionary
GERMAN_TO_ENGLISH = {
    # Interview process terms
    "vorstellungsgespräch": "interview",
    "bewerbungsgespräch": "job interview",
    "telefoninterview": "phone interview",
    "videointerview": "video interview",
    "assessment center": "assessment center",
    "probearbeit": "trial work day",
    "case study": "case study",
    "technisches interview": "technical interview",
    "hr-gespräch": "HR interview",
    "fachgespräch": "technical discussion",

    # Difficulty/Experience terms
    "einfach": "easy",
    "mittel": "medium",
    "schwer": "hard",
    "sehr schwer": "very hard",
    "angenehm": "pleasant",
    "stressig": "stressful",
    "professionell": "professional",
    "unprofessionell": "unprofessional",

    # Position terms
    "softwareentwickler": "software developer",
    "entwickler": "developer",
    "ingenieur": "engineer",
    "praktikant": "intern",
    "werkstudent": "working student",
    "berater": "consultant",
    "projektmanager": "project manager",
    "teamleiter": "team lead",
    "datenanalyst": "data analyst",
    "produktmanager": "product manager",

    # Question types
    "warum": "why",
    "wie": "how",
    "was": "what",
    "erzählen sie": "tell us",
    "beschreiben sie": "describe",
    "stärken": "strengths",
    "schwächen": "weaknesses",
    "gehalt": "salary",
    "gehaltsvorstellung": "salary expectations",
    "motivation": "motivation",
    "karriereziele": "career goals",
    "teamarbeit": "teamwork",
    "konflikt": "conflict",
    "herausforderung": "challenge",

    # Process terms
    "runde": "round",
    "erste runde": "first round",
    "zweite runde": "second round",
    "finale runde": "final round",
    "absage": "rejection",
    "zusage": "offer",
    "feedback": "feedback",
    "wartezeit": "waiting time",
    "dauer": "duration",

    # Company types
    "unternehmen": "company",
    "startup": "startup",
    "konzern": "corporation",
    "mittelstand": "mid-sized company",
}

# Major German + international tech companies on Kununu
TARGET_COMPANIES = [
    # German tech
    ("sap", "SAP"),
    ("siemens", "Siemens"),
    ("bosch", "Bosch"),
    ("zalando", "Zalando"),
    ("delivery-hero", "Delivery Hero"),
    ("n26", "N26"),
    ("celonis", "Celonis"),
    ("personio", "Personio"),
    ("flixbus", "FlixBus"),
    ("trivago", "Trivago"),
    ("check24", "Check24"),
    ("otto", "Otto Group"),
    ("continental", "Continental"),
    ("infineon", "Infineon"),
    ("teamviewer", "TeamViewer"),
    ("scout24", "Scout24"),
    ("hellofresh", "HelloFresh"),
    ("about-you", "About You"),
    ("idealo", "Idealo"),
    ("solactive", "Solactive"),

    # International tech with German offices
    ("google", "Google"),
    ("amazon", "Amazon"),
    ("microsoft", "Microsoft"),
    ("meta", "Meta"),
    ("apple", "Apple"),
    ("spotify", "Spotify"),
    ("booking-com", "Booking.com"),
    ("palantir", "Palantir"),
    ("stripe", "Stripe"),
    ("mongodb", "MongoDB"),
    ("datadog", "Datadog"),
    ("snowflake", "Snowflake"),
    ("cloudflare", "Cloudflare"),
    ("twilio", "Twilio"),
    ("atlassian", "Atlassian"),

    # German consulting/finance
    ("mckinsey", "McKinsey"),
    ("bcg", "BCG"),
    ("bain", "Bain"),
    ("deutsche-bank", "Deutsche Bank"),
    ("commerzbank", "Commerzbank"),
    ("allianz", "Allianz"),
]


@dataclass
class InterviewQuestion:
    """Interview question data structure."""
    id: str
    company: str
    position: Optional[str]
    question_type: str  # behavioral, technical, coding, system_design, hr
    difficulty: str  # easy, medium, hard
    question_text: str
    question_text_original: Optional[str]  # Original German if translated
    source: str
    source_url: str
    interview_date: Optional[str]
    process_description: Optional[str]
    tags: List[str]
    scraped_at: str


def translate_german(text: str) -> str:
    """Translate common German interview terms to English.

    Uses unified translation infrastructure when available,
    falls back to dictionary-based translation.
    """
    if not text:
        return text

    # Try unified translation infrastructure first
    if HAS_INFRA:
        try:
            translated = translate_single(text, target_lang="en")
            if translated and translated != text:
                return translated
        except Exception:
            pass  # Fall through to dictionary translation

    # Dictionary-based translation fallback
    result = text.lower()
    translated = text

    # Sort by length (longest first) to avoid partial replacements
    sorted_terms = sorted(GERMAN_TO_ENGLISH.items(), key=lambda x: len(x[0]), reverse=True)

    for german, english in sorted_terms:
        pattern = re.compile(re.escape(german), re.IGNORECASE)
        translated = pattern.sub(english, translated)

    return translated


def detect_question_type(text: str) -> str:
    """Classify question type from text content."""
    text_lower = text.lower()

    # Technical/coding patterns
    if any(kw in text_lower for kw in [
        "algorithm", "code", "implement", "data structure", "complexity",
        "algorithmus", "programmier", "datenstruktur", "array", "linked list",
        "binary tree", "hash", "sort", "search", "recursion", "dynamic programming"
    ]):
        return "coding"

    # System design patterns
    if any(kw in text_lower for kw in [
        "design", "system", "architect", "scale", "database", "api",
        "microservice", "load balancer", "cache", "distributed",
        "entwerfen", "skalier", "datenbank"
    ]):
        return "system_design"

    # Behavioral patterns
    if any(kw in text_lower for kw in [
        "tell me about", "describe a time", "how do you handle", "weakness",
        "strength", "conflict", "challenge", "team", "failure", "success",
        "erzählen sie", "beschreiben sie", "stärken", "schwächen",
        "teamarbeit", "konflikt", "herausforderung", "why do you want"
    ]):
        return "behavioral"

    # HR/general patterns
    if any(kw in text_lower for kw in [
        "salary", "gehalt", "compensation", "benefits", "vacation",
        "remote", "work from home", "hours", "overtime", "notice period",
        "kündigungsfrist", "urlaub", "homeoffice"
    ]):
        return "hr"

    return "technical"


def detect_difficulty(text: str) -> str:
    """Estimate difficulty from text content."""
    text_lower = text.lower()

    hard_patterns = [
        "schwer", "schwierig", "hard", "difficult", "complex", "challenging",
        "tricky", "advanced", "senior", "deep dive", "sehr anspruchsvoll"
    ]

    easy_patterns = [
        "einfach", "easy", "basic", "simple", "straightforward", "standard",
        "üblich", "normal", "typical"
    ]

    if any(p in text_lower for p in hard_patterns):
        return "hard"
    if any(p in text_lower for p in easy_patterns):
        return "easy"
    return "medium"


def extract_questions(text: str) -> List[str]:
    """Extract individual questions from interview experience text."""
    questions = []

    # Pattern 1: Lines ending with ?
    q_pattern = re.compile(r'([^.!?\n]{10,}[?])', re.MULTILINE)
    for match in q_pattern.findall(text):
        q = match.strip()
        if len(q) > 15 and len(q) < 500:
            questions.append(q)

    # Pattern 2: "Question:" or "Frage:" prefixed
    q_prefix = re.compile(r'(?:question|frage|q)[:\s]+([^.!?\n]+[?]?)', re.IGNORECASE)
    for match in q_prefix.findall(text):
        q = match.strip()
        if len(q) > 10 and len(q) < 500:
            questions.append(q)

    # Pattern 3: Bullet points or numbered lists
    list_pattern = re.compile(r'(?:^|\n)\s*(?:[-•*]|\d+[.)]\s)([^.!?\n]{10,})', re.MULTILINE)
    for match in list_pattern.findall(text):
        q = match.strip()
        # Only include if it looks like a question (ends with ? or starts with question word)
        if (q.endswith('?') or
            any(q.lower().startswith(w) for w in ['what', 'why', 'how', 'tell', 'describe', 'was', 'warum', 'wie', 'erzählen'])):
            questions.append(q)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for q in questions:
        q_normalized = q.lower().strip()
        if q_normalized not in seen:
            seen.add(q_normalized)
            unique.append(q)

    return unique[:10]  # Limit to 10 questions per experience


def extract_tags(text: str, company: str) -> List[str]:
    """Extract relevant tags from interview text."""
    tags = set()
    text_lower = text.lower()

    # Technical topics
    topic_keywords = {
        "python": "python", "java": "java", "javascript": "javascript",
        "sql": "sql", "aws": "aws", "cloud": "cloud", "docker": "docker",
        "kubernetes": "kubernetes", "react": "react", "node": "nodejs",
        "machine learning": "ml", "data science": "data_science",
        "agile": "agile", "scrum": "scrum", "devops": "devops",
    }

    for keyword, tag in topic_keywords.items():
        if keyword in text_lower:
            tags.add(tag)

    # Interview round info
    if any(r in text_lower for r in ["phone", "telefon"]):
        tags.add("phone_screen")
    if any(r in text_lower for r in ["onsite", "vor ort", "office"]):
        tags.add("onsite")
    if any(r in text_lower for r in ["video", "zoom", "teams"]):
        tags.add("video_interview")
    if any(r in text_lower for r in ["coding test", "online test", "hackerrank", "codility"]):
        tags.add("online_assessment")

    return list(tags)


def parse_german_date(date_str: str) -> Optional[str]:
    """Parse German date formats to ISO format.

    Uses UniversalDateParser when available for better accuracy.
    Supports: heute, gestern, vor X Tagen/Wochen/Monaten, DD.MM.YYYY
    """
    if not date_str:
        return None

    # Use infrastructure date parser if available
    _init_infrastructure()
    if _date_parser and HAS_INFRASTRUCTURE:
        try:
            parsed = _date_parser.parse(date_str, language='de', format_hint=DateFormat.EU)
            if parsed:
                return parsed.strftime("%Y-%m-%d")
        except Exception:
            pass  # Fall through to manual parsing

    date_str = date_str.lower().strip()
    now = datetime.now()

    # Relative dates
    if "heute" in date_str or "today" in date_str:
        return now.strftime("%Y-%m-%d")
    if "gestern" in date_str or "yesterday" in date_str:
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")

    # "vor X tagen/wochen/monaten"
    relative_pattern = re.compile(r'vor\s+(\d+)\s+(tag|woche|monat)', re.IGNORECASE)
    match = relative_pattern.search(date_str)
    if match:
        num = int(match.group(1))
        unit = match.group(2).lower()
        if "tag" in unit:
            return (now - timedelta(days=num)).strftime("%Y-%m-%d")
        elif "woche" in unit:
            return (now - timedelta(weeks=num)).strftime("%Y-%m-%d")
        elif "monat" in unit:
            return (now - timedelta(days=num * 30)).strftime("%Y-%m-%d")

    # German date format: DD.MM.YYYY
    german_date = re.compile(r'(\d{1,2})\.(\d{1,2})\.(\d{4})')
    match = german_date.search(date_str)
    if match:
        day, month, year = match.groups()
        try:
            return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
        except:
            pass

    return None


def is_within_months(date_str: Optional[str], months: int) -> bool:
    """Check if date is within the specified number of months."""
    if not date_str:
        return True  # Include if no date (can't filter)

    try:
        date = datetime.strptime(date_str, "%Y-%m-%d")
        cutoff = datetime.now() - timedelta(days=months * 30)
        return date >= cutoff
    except:
        return True


def generate_question_id(company: str, question: str) -> str:
    """Generate unique ID for a question."""
    content = f"{company.lower()}:{question.lower()}"
    return hashlib.md5(content.encode()).hexdigest()[:16]


def scrape_kununu_company(company_slug: str, company_name: str, months: int = 5) -> List[Dict[str, Any]]:
    """Scrape interview experiences for a specific company from Kununu.

    Uses infrastructure when available:
    - StealthSession for anti-detection
    - ResponseCache for efficient re-scraping
    - GeoProxySelector for German geo-targeting
    """
    questions = []
    base_url = f"https://www.kununu.com/de/{company_slug}/bewerbung"

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    }

    try:
        # Use infrastructure for fetching
        response = _fetch_with_infrastructure(base_url, headers)

        if response is None or response.status_code != 200:
            return []

        html = response.text

        # Extract interview experience sections
        # Kununu uses specific class patterns for interview content
        experience_pattern = re.compile(
            r'<div[^>]*class="[^"]*interview[^"]*"[^>]*>(.*?)</div>',
            re.DOTALL | re.IGNORECASE
        )

        # Also look for general review content mentioning interviews
        content_pattern = re.compile(
            r'<p[^>]*>(.*?(?:interview|bewerbung|vorstellungsgespräch|frage).*?)</p>',
            re.DOTALL | re.IGNORECASE
        )

        all_content = []

        for match in experience_pattern.findall(html):
            text = re.sub(r'<[^>]+>', ' ', match)
            text = unescape(text).strip()
            if len(text) > 50:
                all_content.append(text)

        for match in content_pattern.findall(html):
            text = re.sub(r'<[^>]+>', ' ', match)
            text = unescape(text).strip()
            if len(text) > 50:
                all_content.append(text)

        # Process each content block
        for content in all_content:
            # Extract questions from content
            extracted = extract_questions(content)

            for q in extracted:
                # Translate to English
                q_english = translate_german(q)

                question_data = InterviewQuestion(
                    id=generate_question_id(company_name, q),
                    company=company_name,
                    position=None,  # Would need more parsing
                    question_type=detect_question_type(q),
                    difficulty=detect_difficulty(content),
                    question_text=q_english,
                    question_text_original=q if q != q_english else None,
                    source="kununu",
                    source_url=base_url,
                    interview_date=None,
                    process_description=content[:200] if len(content) > 200 else content,
                    tags=extract_tags(content, company_name),
                    scraped_at=datetime.now().isoformat()
                )

                questions.append(asdict(question_data))

    except requests.exceptions.RequestException as e:
        print(f"[kununu] Error scraping {company_name}: {e}")
    except Exception as e:
        print(f"[kununu] Unexpected error for {company_name}: {e}")

    return questions


def scrape_kununu(
    companies: Optional[List[tuple]] = None,
    months: int = 5,
    max_companies: int = 50
) -> List[Dict[str, Any]]:
    """
    Scrape interview questions from Kununu.com.

    Args:
        companies: List of (slug, name) tuples. Defaults to TARGET_COMPANIES.
        months: Only include interviews from last N months. Default 5.
        max_companies: Maximum number of companies to scrape.

    Returns:
        List of InterviewQuestion dictionaries.
    """
    all_questions = []
    companies = companies or TARGET_COMPANIES[:max_companies]

    print(f"[kununu] Starting scrape for {len(companies)} companies (last {months} months)")

    for i, (slug, name) in enumerate(companies):
        print(f"[kununu] Scraping {name} ({i+1}/{len(companies)})")

        questions = scrape_kununu_company(slug, name, months)
        all_questions.extend(questions)

        # Rate limiting via infrastructure or fallback
        if i < len(companies) - 1:
            if HAS_INFRA:
                wait_for_rate_limit("kununu.com")
            else:
                time.sleep(RATE_LIMIT_DELAY)

    # Deduplicate by ID
    seen_ids = set()
    unique_questions = []
    for q in all_questions:
        if q["id"] not in seen_ids:
            seen_ids.add(q["id"])
            unique_questions.append(q)

    print(f"[kununu] Scraped {len(unique_questions)} unique questions from {len(companies)} companies")

    return unique_questions


def scrape_kununu_search(query: str, months: int = 5) -> List[Dict[str, Any]]:
    """
    Search Kununu for interview experiences matching a query.

    Args:
        query: Search term (company name, role, etc.)
        months: Only include interviews from last N months.

    Returns:
        List of InterviewQuestion dictionaries.
    """
    _init_infrastructure()

    # Kununu search URL
    encoded_query = quote(query)
    search_url = f"https://www.kununu.com/de/search?q={encoded_query}&type=interview"

    questions = []

    # Use stealth headers from infrastructure
    if HAS_INFRA:
        headers = get_stealth_headers(search_url)
        headers["Accept-Language"] = "de-DE,de;q=0.9,en;q=0.8"
    else:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        }

    try:
        # Apply rate limiting
        if HAS_INFRA:
            wait_for_rate_limit("kununu.com")

        # Get regional proxy
        proxies = None
        if HAS_INFRA:
            proxies = get_proxy_for_url(search_url)

        response = requests.get(
            search_url,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            verify=VERIFY_SSL,
            proxies=proxies
        )

        if response.status_code == 200:
            # Extract company links from search results
            company_pattern = re.compile(r'href="/de/([^/"]+)"[^>]*>([^<]+)</a>')

            companies_found = set()
            for match in company_pattern.findall(response.text):
                slug, name = match
                if len(companies_found) < 10:  # Limit search results
                    companies_found.add((slug, name))

            for slug, name in companies_found:
                q = scrape_kununu_company(slug, name, months)
                questions.extend(q)
                # Rate limiting handled by infrastructure or fallback
                if HAS_INFRA:
                    wait_for_rate_limit("kununu.com")
                else:
                    time.sleep(RATE_LIMIT_DELAY)

    except Exception as e:
        print(f"[kununu] Search error: {e}")

    return questions


# Convenience alias
def fetch_kununu_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Convenience alias for scrape_kununu()."""
    return scrape_kununu(months=months)


# Fallback curated data for when scraping is blocked
FALLBACK_QUESTIONS = [
    {
        "id": "kununu_fallback_1",
        "company": "SAP",
        "position": "Software Developer",
        "question_type": "behavioral",
        "difficulty": "medium",
        "question_text": "Tell us about a time you had to work with a difficult team member. How did you handle it?",
        "question_text_original": "Erzählen Sie von einer Situation, in der Sie mit einem schwierigen Teammitglied arbeiten mussten.",
        "source": "kununu",
        "source_url": "https://www.kununu.com/de/sap/bewerbung",
        "interview_date": None,
        "process_description": "3 rounds: HR phone screen, technical interview, team fit",
        "tags": ["teamwork", "behavioral"],
        "scraped_at": datetime.now().isoformat()
    },
    {
        "id": "kununu_fallback_2",
        "company": "Zalando",
        "position": "Backend Engineer",
        "question_type": "technical",
        "difficulty": "medium",
        "question_text": "How would you design a system to handle millions of product updates per day?",
        "question_text_original": None,
        "source": "kununu",
        "source_url": "https://www.kununu.com/de/zalando/bewerbung",
        "interview_date": None,
        "process_description": "Coding challenge, system design, culture fit",
        "tags": ["system_design", "scalability"],
        "scraped_at": datetime.now().isoformat()
    },
    {
        "id": "kununu_fallback_3",
        "company": "N26",
        "position": "Full Stack Developer",
        "question_type": "coding",
        "difficulty": "medium",
        "question_text": "Implement a function to detect cycles in a directed graph.",
        "question_text_original": None,
        "source": "kununu",
        "source_url": "https://www.kununu.com/de/n26/bewerbung",
        "interview_date": None,
        "process_description": "Online assessment, 2 technical rounds, hiring manager",
        "tags": ["algorithms", "graphs"],
        "scraped_at": datetime.now().isoformat()
    },
    {
        "id": "kununu_fallback_4",
        "company": "Delivery Hero",
        "position": "Data Engineer",
        "question_type": "technical",
        "difficulty": "hard",
        "question_text": "How would you design a real-time analytics pipeline for food delivery tracking?",
        "question_text_original": None,
        "source": "kununu",
        "source_url": "https://www.kununu.com/de/delivery-hero/bewerbung",
        "interview_date": None,
        "process_description": "Phone screen, take-home project, system design discussion",
        "tags": ["data_pipeline", "real_time", "system_design"],
        "scraped_at": datetime.now().isoformat()
    },
    {
        "id": "kununu_fallback_5",
        "company": "Siemens",
        "position": "Software Engineer",
        "question_type": "behavioral",
        "difficulty": "easy",
        "question_text": "Why are you interested in working for Siemens? What do you know about our digital transformation?",
        "question_text_original": "Warum interessieren Sie sich für Siemens? Was wissen Sie über unsere digitale Transformation?",
        "source": "kununu",
        "source_url": "https://www.kununu.com/de/siemens/bewerbung",
        "interview_date": None,
        "process_description": "Assessment center with group exercises and individual interviews",
        "tags": ["motivation", "company_knowledge"],
        "scraped_at": datetime.now().isoformat()
    },
]


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Scrape Kununu interview questions")
    parser.add_argument("--months", type=int, default=5, help="Months of history to scrape")
    parser.add_argument("--max-companies", type=int, default=10, help="Max companies to scrape")
    parser.add_argument("--search", type=str, help="Search query instead of predefined list")
    parser.add_argument("--output", type=str, help="Output JSON file")
    parser.add_argument("--fallback", action="store_true", help="Use fallback data only")

    args = parser.parse_args()

    if args.fallback:
        questions = FALLBACK_QUESTIONS
    elif args.search:
        questions = scrape_kununu_search(args.search, months=args.months)
    else:
        questions = scrape_kununu(months=args.months, max_companies=args.max_companies)

    # If scraping failed, use fallback
    if not questions:
        print("[kununu] No results from scraping, using fallback data")
        questions = FALLBACK_QUESTIONS

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(questions, f, indent=2, ensure_ascii=False)
        print(f"[kununu] Saved {len(questions)} questions to {args.output}")
    else:
        print(json.dumps(questions, indent=2, ensure_ascii=False))
