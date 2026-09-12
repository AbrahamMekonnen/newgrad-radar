"""Dicoding Indonesia interview experience scraper.

Fetches interview experiences from Dicoding.com, Indonesia's largest developer learning platform.
Searches forum discussions for interview-related content.

Focus areas:
- Tech company interviews (Gojek, Tokopedia, Shopee, Grab, etc.)
- Google/FAANG Indonesia offices
- Bangkit program (Google-backed) alumni experiences

Production-grade: Uses GeoProxySelector, ResponseCache, UniversalDateParser,
StealthSession, and ValidationPipeline from utils infrastructure.
"""

import re
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from html import unescape
import urllib3
import sys
import os

# Add parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Import unified scraper infrastructure with fallback
try:
    from utils.scraper_infra import (
        get_cache as infra_get_cache,
        get_stealth_headers,
        get_proxy_for_url,
        wait_for_rate_limit,
        translate_batch,
        translate_single,
        validate_question as infra_validate_question,
        cached_request,
        InfrastructureContext,
    )
    HAS_INFRA = True
except ImportError:
    try:
        # Try relative import
        from ...utils.scraper_infra import (
            get_cache as infra_get_cache,
            get_stealth_headers,
            get_proxy_for_url,
            wait_for_rate_limit,
            translate_batch,
            translate_single,
            validate_question as infra_validate_question,
            cached_request,
            InfrastructureContext,
        )
        from ...utils.error_handler import CheckpointManager
        HAS_INFRA = True
    except ImportError:
        HAS_INFRA = False
        CheckpointManager = None
        print("[dicoding] Unified infrastructure not available, trying legacy imports...")

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and HAS_INFRA and CheckpointManager:
        try:
            _checkpoint = CheckpointManager("dicoding")
        except Exception:
            pass
    return _checkpoint

# Legacy infrastructure imports as fallback
try:
    from utils import (
        GeoProxySelector,
        GeoRegion,
        ResponseCache,
        get_cache,
        UniversalDateParser,
        parse_date as utils_parse_date,
        is_within_months as utils_is_within_months,
        create_stealth_session,
        StealthSession,
        ValidationPipeline,
        validate_question,
        detect_company_robust,
        DomainThrottler,
        get_throttler,
    )
    HAS_LEGACY = True
except ImportError:
    HAS_LEGACY = False
    if not HAS_INFRA:
        print("[dicoding] Infrastructure modules not available, using basic mode")

    # Fallback stubs
    def validate_question(data):
        class Result:
            is_valid = True
            score = 1.0
        return Result()

    def detect_company_robust(text):
        return None

    def utils_is_within_months(date_str, months):
        return True

# Disable SSL warnings for sites with cert issues
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

REQUEST_TIMEOUT = 30
VERIFY_SSL = True

# Initialize infrastructure based on availability
_geo_proxy = None
_cache = None
_date_parser = None
_throttler = None
_stealth_session = None
_infra_context = None


def _init_infrastructure():
    """Initialize infrastructure components for Indonesia scraping."""
    global _geo_proxy, _cache, _date_parser, _throttler, _stealth_session, _infra_context

    # Use unified infrastructure if available
    if HAS_INFRA:
        if _infra_context is None:
            _infra_context = InfrastructureContext(source="dicoding.com", region="id", ttl=21600)
        return

    # Fall back to legacy infrastructure
    if HAS_LEGACY:
        if _geo_proxy is None:
            _geo_proxy = GeoProxySelector()
        if _cache is None:
            _cache = get_cache("dicoding", ttl_hours=6)
        if _date_parser is None:
            _date_parser = UniversalDateParser()
        if _throttler is None:
            _throttler = get_throttler("dicoding.com")


def _get_session():
    """Get or create stealth session with Indonesia proxies."""
    global _stealth_session
    _init_infrastructure()

    if HAS_INFRA:
        # Return a wrapper that uses unified infrastructure
        return _InfraSession()

    if HAS_LEGACY and _stealth_session is None:
        proxy = _geo_proxy.get_proxy_for_region(GeoRegion.INDONESIA, "dicoding.com")
        _stealth_session = create_stealth_session(proxy=proxy)

    return _stealth_session


class _InfraSession:
    """Wrapper session using unified infrastructure."""

    def get(self, url, **kwargs):
        """Make a GET request using unified infrastructure."""
        import requests

        # Apply rate limiting
        wait_for_rate_limit("dicoding.com")

        # Get stealth headers
        headers = get_stealth_headers(url)
        headers["Accept-Language"] = "id-ID,id;q=0.9,en;q=0.8"
        if "headers" in kwargs:
            headers.update(kwargs.pop("headers"))

        # Get regional proxy
        proxies = get_proxy_for_url(url)

        return requests.get(
            url,
            headers=headers,
            proxies=proxies,
            **kwargs
        )

# Indonesian to English company translations
COMPANY_TRANSLATIONS = {
    # Indonesian unicorns and tech companies
    "gojek": "Gojek",
    "tokopedia": "Tokopedia",
    "bukalapak": "Bukalapak",
    "traveloka": "Traveloka",
    "ovo": "OVO",
    "dana": "DANA",
    "shopee": "Shopee",
    "grab": "Grab",
    "blibli": "Blibli",
    "tiket": "Tiket.com",
    "ruangguru": "Ruangguru",
    "zenius": "Zenius",
    "kumparan": "Kumparan",
    "kompas": "Kompas",
    "telkom": "Telkom Indonesia",
    "telkomsel": "Telkomsel",
    "indosat": "Indosat",
    "xl": "XL Axiata",
    "pertamina": "Pertamina",
    "bca": "Bank BCA",
    "bri": "Bank BRI",
    "mandiri": "Bank Mandiri",
    "bni": "Bank BNI",
    "ajaib": "Ajaib",
    "stockbit": "Stockbit",
    "bibit": "Bibit",
    "flip": "Flip",
    "xendit": "Xendit",
    "midtrans": "Midtrans",
    "mekari": "Mekari",
    "amartha": "Amartha",
    "kredivo": "Kredivo",
    "sirclo": "Sirclo",
    "sociolla": "Sociolla",
    # International companies with Indonesia presence
    "google": "Google",
    "microsoft": "Microsoft",
    "amazon": "Amazon",
    "meta": "Meta",
    "facebook": "Facebook",
    "apple": "Apple",
    "netflix": "Netflix",
    "uber": "Uber",
    "airbnb": "Airbnb",
    "stripe": "Stripe",
    "twitter": "Twitter",
    "linkedin": "LinkedIn",
    "bytedance": "ByteDance",
    "tiktok": "TikTok",
    "alibaba": "Alibaba",
    "lazada": "Lazada",
}

# Indonesian terms to English
INDONESIAN_TERMS = {
    # Interview related
    "wawancara": "interview",
    "interview": "interview",
    "tes": "test",
    "ujian": "exam",
    "seleksi": "selection",
    "rekrutmen": "recruitment",
    "lamaran": "application",
    "lowongan": "job opening",
    "karir": "career",
    "kerja": "work",
    "magang": "internship",
    "pengalaman": "experience",
    "pertanyaan": "question",
    "jawaban": "answer",
    # Roles
    "insinyur perangkat lunak": "software engineer",
    "pengembang": "developer",
    "programmer": "programmer",
    "data scientist": "data scientist",
    "analis data": "data analyst",
    "backend": "backend",
    "frontend": "frontend",
    "fullstack": "fullstack",
    "mobile": "mobile",
    "android": "android",
    "ios": "ios",
    "devops": "devops",
    "qa": "qa",
    "tester": "tester",
    # Difficulty
    "mudah": "easy",
    "sedang": "medium",
    "sulit": "hard",
    "susah": "hard",
    # Question types
    "teknis": "technical",
    "coding": "coding",
    "algoritma": "algorithm",
    "struktur data": "data structure",
    "sistem": "system",
    "desain": "design",
    "perilaku": "behavioral",
    "hr": "hr",
}

# Role patterns
ROLE_PATTERNS = {
    "swe": [
        re.compile(r"software\s*engineer", re.IGNORECASE),
        re.compile(r"pengembang\s*perangkat\s*lunak", re.IGNORECASE),
        re.compile(r"insinyur\s*perangkat\s*lunak", re.IGNORECASE),
        re.compile(r"programmer", re.IGNORECASE),
    ],
    "backend": [
        re.compile(r"backend", re.IGNORECASE),
        re.compile(r"back[\-\s]?end", re.IGNORECASE),
        re.compile(r"server[\-\s]?side", re.IGNORECASE),
    ],
    "frontend": [
        re.compile(r"frontend", re.IGNORECASE),
        re.compile(r"front[\-\s]?end", re.IGNORECASE),
    ],
    "mobile": [
        re.compile(r"mobile", re.IGNORECASE),
        re.compile(r"android", re.IGNORECASE),
        re.compile(r"ios", re.IGNORECASE),
    ],
    "data": [
        re.compile(r"data\s*scientist", re.IGNORECASE),
        re.compile(r"data\s*engineer", re.IGNORECASE),
        re.compile(r"data\s*analyst", re.IGNORECASE),
        re.compile(r"analis\s*data", re.IGNORECASE),
    ],
    "ml": [
        re.compile(r"machine\s*learning", re.IGNORECASE),
        re.compile(r"ML\s*engineer", re.IGNORECASE),
        re.compile(r"AI", re.IGNORECASE),
    ],
    "devops": [
        re.compile(r"devops", re.IGNORECASE),
        re.compile(r"sre", re.IGNORECASE),
        re.compile(r"infrastructure", re.IGNORECASE),
    ],
}

# Question type patterns
QUESTION_TYPE_PATTERNS = {
    "technical": [
        r"\bcoding\b", r"\balgorithm\b", r"\balgoritma\b",
        r"\bdata\s*structure\b", r"\bstruktur\s*data\b",
        r"\bteknis\b", r"\btechnical\b",
    ],
    "behavioral": [
        r"\bbehavioral\b", r"\bperilaku\b", r"\bsoft\s*skill\b",
        r"\bkepribadian\b", r"\bpersonality\b", r"\bstar\s*method\b",
        r"\bceritakan\b", r"\btell\s*me\b",
    ],
    "system_design": [
        r"\bsystem\s*design\b", r"\bdesain\s*sistem\b",
        r"\barsitektur\b", r"\barchitecture\b",
        r"\bscalability\b", r"\bhigh\s*level\b",
    ],
    "oa": [
        r"\bonline\s*assessment\b", r"\bOA\b", r"\bcoding\s*test\b",
        r"\bhackerrank\b", r"\bleetcode\b", r"\btes\s*coding\b",
    ],
}

# Difficulty patterns
DIFFICULTY_PATTERNS = {
    "easy": [r"\beasy\b", r"\bmudah\b", r"\bsimple\b", r"\bbasic\b"],
    "medium": [r"\bmedium\b", r"\bsedang\b", r"\bmoderate\b"],
    "hard": [r"\bhard\b", r"\bsulit\b", r"\bsusah\b", r"\bdifficult\b", r"\bcomplex\b"],
}


@dataclass
class InterviewQuestion:
    """Interview question data structure."""
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


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<p>", "\n", text)
    text = re.sub(r"</p>", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return text.strip()


def translate_to_english(text: str) -> str:
    """Basic Indonesian to English translation for common interview terms."""
    result = text.lower()
    for indo, eng in INDONESIAN_TERMS.items():
        result = re.sub(rf"\b{re.escape(indo)}\b", eng, result, flags=re.IGNORECASE)
    return result


def detect_company(text: str) -> Optional[str]:
    """Detect company name from text using robust detection."""
    # Try infrastructure's robust company detection first
    if HAS_LEGACY:
        try:
            result = detect_company_robust(text)
            if result and hasattr(result, 'canonical_name'):
                return result.canonical_name
        except Exception:
            pass

    text_lower = text.lower()

    # Check Indonesian company translations
    for indo_name, eng_name in COMPANY_TRANSLATIONS.items():
        if indo_name in text_lower:
            return eng_name

    # Check for common company mentions
    company_pattern = re.compile(
        r"\b(gojek|tokopedia|shopee|grab|bukalapak|traveloka|ruangguru|"
        r"google|microsoft|amazon|meta|facebook|apple|netflix|"
        r"xendit|midtrans|flip|ajaib|stockbit|mekari|"
        r"telkom|bca|mandiri|bri|bni|pertamina)\b",
        re.IGNORECASE
    )
    match = company_pattern.search(text)
    if match:
        company = match.group(1).lower()
        return COMPANY_TRANSLATIONS.get(company, company.title())

    return None


def detect_role(text: str) -> str:
    """Detect role type from text."""
    for role, patterns in ROLE_PATTERNS.items():
        for pattern in patterns:
            if pattern.search(text):
                return role
    return "swe"  # Default


def detect_question_type(text: str) -> str:
    """Detect question type from content."""
    text_lower = text.lower()

    type_scores = {}
    for qtype, patterns in QUESTION_TYPE_PATTERNS.items():
        score = 0
        for pattern in patterns:
            if re.search(pattern, text_lower):
                score += 1
        if score > 0:
            type_scores[qtype] = score

    if type_scores:
        return max(type_scores, key=type_scores.get)
    return "technical"


def detect_difficulty(text: str) -> str:
    """Detect difficulty level from text."""
    text_lower = text.lower()

    for difficulty, patterns in DIFFICULTY_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                return difficulty
    return "medium"


def extract_questions(text: str) -> List[str]:
    """Extract individual questions from text."""
    questions = []

    # Question patterns
    patterns = [
        # Numbered questions
        r"\d+[\.\)]\s*([^?\n]+\?)",
        # Bullet points
        r"[-•]\s*([^?\n]+\?)",
        # Direct questions
        r"(?:pertanyaan|question|asked|ditanya)[:\s]+([^?\n]+\?)",
        # Indonesian question starters
        r"(?:apa|bagaimana|mengapa|kapan|dimana|siapa|berapa)[^?\n]+\?",
        # English question starters
        r"(?:what|how|why|when|where|who|which)[^?\n]+\?",
    ]

    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE | re.MULTILINE)
        for match in matches:
            if isinstance(match, tuple):
                match = match[0]
            q = clean_html(match.strip())
            if len(q) > 10 and len(q) < 500:
                questions.append(q)

    return list(set(questions))


def extract_topics(text: str) -> List[str]:
    """Extract technical topics from text."""
    topics = []

    topic_patterns = {
        "arrays": r"\barray\b",
        "strings": r"\bstring\b",
        "trees": r"\btree\b|\bbst\b|\bbinary\s*tree\b",
        "graphs": r"\bgraph\b|\bdfs\b|\bbfs\b",
        "dynamic_programming": r"\bdp\b|\bdynamic\s*programming\b",
        "recursion": r"\brecursi\w+\b",
        "sorting": r"\bsort\w*\b",
        "searching": r"\bsearch\w*\b|\bbinary\s*search\b",
        "linked_list": r"\blinked\s*list\b",
        "stack": r"\bstack\b",
        "queue": r"\bqueue\b",
        "hash": r"\bhash\b|\bhashmap\b",
        "sql": r"\bsql\b|\bquery\b|\bdatabase\b",
        "api": r"\bapi\b|\brest\b|\bendpoint\b",
        "oop": r"\boop\b|\bobject\s*oriented\b",
        "system_design": r"\bsystem\s*design\b|\barchitecture\b",
    }

    text_lower = text.lower()
    for topic, pattern in topic_patterns.items():
        if re.search(pattern, text_lower):
            topics.append(topic)

    return topics


def parse_date(date_str: str) -> Optional[str]:
    """Parse Indonesian/English date strings using UniversalDateParser."""
    if not date_str:
        return None

    _init_infrastructure()

    # Use infrastructure's universal date parser with Indonesian language
    if HAS_LEGACY and _date_parser:
        try:
            result = _date_parser.parse(date_str, language="id")
            if result and result.datetime:
                return result.datetime.strftime("%Y-%m-%d")
        except Exception:
            pass

    # Fallback to manual parsing for Indonesian-specific formats
    date_str = date_str.lower().strip()
    now = datetime.now()

    # Relative dates in Indonesian
    if "hari" in date_str or "day" in date_str:
        match = re.search(r"(\d+)\s*(?:hari|day)", date_str)
        if match:
            days = int(match.group(1))
            return (now - timedelta(days=days)).strftime("%Y-%m-%d")

    if "minggu" in date_str or "week" in date_str:
        match = re.search(r"(\d+)\s*(?:minggu|week)", date_str)
        if match:
            weeks = int(match.group(1))
            return (now - timedelta(weeks=weeks)).strftime("%Y-%m-%d")

    if "bulan" in date_str or "month" in date_str:
        match = re.search(r"(\d+)\s*(?:bulan|month)", date_str)
        if match:
            months = int(match.group(1))
            return (now - timedelta(days=months * 30)).strftime("%Y-%m-%d")

    if "tahun" in date_str or "year" in date_str:
        match = re.search(r"(\d+)\s*(?:tahun|year)", date_str)
        if match:
            years = int(match.group(1))
            return (now - timedelta(days=years * 365)).strftime("%Y-%m-%d")

    return None


def is_within_months(date_str: Optional[str], months: int) -> bool:
    """Check if date is within specified months from now."""
    if not date_str:
        return True  # Include if no date (might be recent)

    # Use infrastructure's built-in check
    if HAS_LEGACY:
        try:
            return utils_is_within_months(date_str, months)
        except Exception:
            pass

    # Manual fallback
    try:
        from datetime import datetime
        date = datetime.strptime(date_str, "%Y-%m-%d")
        cutoff = datetime.now() - timedelta(days=months * 30)
        return date >= cutoff
    except Exception:
        return True


def generate_id(company: str, question: str) -> str:
    """Generate unique ID for a question."""
    content = f"{company}:{question}".lower()
    return hashlib.md5(content.encode()).hexdigest()[:16]


def fetch_dicoding_forum(months: int = 5, max_pages: int = 10) -> List[Dict[str, Any]]:
    """Fetch interview discussions from Dicoding forum with caching and stealth."""
    _init_infrastructure()
    posts = []
    cache_key = f"forum_{months}_{max_pages}"

    # Check cache first (unified or legacy)
    if HAS_INFRA:
        cache = infra_get_cache(ttl=21600)
        cached = cache.get(cache_key)
        if cached:
            return cached if isinstance(cached, list) else []
    elif HAS_LEGACY and _cache:
        cached = _cache.get(cache_key)
        if cached:
            return cached.data if hasattr(cached, 'data') else cached

    session = _get_session()

    # Dicoding forum search patterns
    search_terms = [
        "interview",
        "wawancara",
        "seleksi",
        "rekrutmen",
        "pengalaman kerja",
        "tes coding",
        "technical interview",
        "gojek interview",
        "tokopedia interview",
        "shopee interview",
    ]

    # Try Dicoding forum
    base_url = "https://www.dicoding.com/blog"

    for term in search_terms[:5]:  # Limit to avoid rate limiting
        try:
            # Rate limit (unified or legacy)
            if HAS_INFRA:
                wait_for_rate_limit("dicoding.com")
            elif HAS_LEGACY and _throttler:
                _throttler.wait()

            # Try blog/forum search
            url = f"{base_url}?s={term.replace(' ', '+')}"
            response = session.get(
                url,
                timeout=REQUEST_TIMEOUT,
                verify=VERIFY_SSL
            )

            if response.status_code == 200:
                # Parse HTML for interview content
                content = response.text

                # Extract article links and titles
                article_pattern = r'<a[^>]+href="([^"]+)"[^>]*>([^<]*(?:interview|wawancara|pengalaman)[^<]*)</a>'
                matches = re.findall(article_pattern, content, re.IGNORECASE)

                for url, title in matches:
                    posts.append({
                        "url": url if url.startswith("http") else f"https://www.dicoding.com{url}",
                        "title": clean_html(title),
                        "source": "dicoding_blog",
                    })
        except Exception as e:
            print(f"Error fetching Dicoding: {e}")
            continue

    # Also try the discussion forum
    forum_url = "https://www.dicoding.com/academies"
    try:
        # Rate limit (unified or legacy)
        if HAS_INFRA:
            wait_for_rate_limit("dicoding.com")
        elif HAS_LEGACY and _throttler:
            _throttler.wait()

        response = session.get(
            forum_url,
            timeout=REQUEST_TIMEOUT,
            verify=VERIFY_SSL
        )

        if response.status_code == 200:
            # Look for discussion/forum links
            discussion_pattern = r'href="([^"]*forum[^"]*|[^"]*discuss[^"]*)"'
            matches = re.findall(discussion_pattern, response.text, re.IGNORECASE)

            for url in matches[:10]:
                if not url.startswith("http"):
                    url = f"https://www.dicoding.com{url}"
                posts.append({
                    "url": url,
                    "title": "Forum discussion",
                    "source": "dicoding_forum",
                })
    except Exception as e:
        print(f"Error fetching Dicoding forum: {e}")

    # Cache results (unified or legacy)
    if posts:
        if HAS_INFRA:
            cache = infra_get_cache(ttl=21600)
            cache.set(cache_key, posts)
        elif HAS_LEGACY and _cache:
            _cache.set(cache_key, posts)

    return posts


def fetch_dicoding_discussions_api() -> List[Dict[str, Any]]:
    """Try to fetch from Dicoding's discussion API with caching and stealth."""
    _init_infrastructure()
    discussions = []
    cache_key = "discussions_api"

    # Check cache first (unified or legacy)
    if HAS_INFRA:
        cache = infra_get_cache(ttl=21600)
        cached = cache.get(cache_key)
        if cached:
            return cached if isinstance(cached, list) else []
    elif HAS_LEGACY and _cache:
        cached = _cache.get(cache_key)
        if cached:
            return cached.data if hasattr(cached, 'data') else cached

    session = _get_session()

    # Common API endpoints to try
    api_endpoints = [
        "https://www.dicoding.com/api/discussions",
        "https://www.dicoding.com/api/forum/posts",
        "https://www.dicoding.com/blog/wp-json/wp/v2/posts",
    ]

    for endpoint in api_endpoints:
        try:
            # Rate limit (unified or legacy)
            if HAS_INFRA:
                wait_for_rate_limit("dicoding.com")
            elif HAS_LEGACY and _throttler:
                _throttler.wait()

            response = session.get(
                endpoint,
                timeout=REQUEST_TIMEOUT,
                verify=VERIFY_SSL
            )

            if response.status_code == 200:
                try:
                    data = response.json()
                    if isinstance(data, list):
                        for item in data[:50]:
                            discussions.append({
                                "title": item.get("title", {}).get("rendered", "") if isinstance(item.get("title"), dict) else item.get("title", ""),
                                "content": item.get("content", {}).get("rendered", "") if isinstance(item.get("content"), dict) else item.get("content", ""),
                                "url": item.get("link", ""),
                                "date": item.get("date", ""),
                                "source": "dicoding_api",
                            })
                except Exception:
                    pass
        except Exception:
            continue

    # Cache results (unified or legacy)
    if discussions:
        if HAS_INFRA:
            cache = infra_get_cache(ttl=21600)
            cache.set(cache_key, discussions)
        elif HAS_LEGACY and _cache:
            _cache.set(cache_key, discussions)

    return discussions


def get_curated_indonesian_questions() -> List[Dict[str, Any]]:
    """Return curated Indonesian tech interview questions as fallback."""
    return [
        {
            "company": "Gojek",
            "position": "swe",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Design a ride-sharing system that matches drivers with passengers efficiently. Consider surge pricing.",
            "tags": ["system_design", "distributed_systems"],
        },
        {
            "company": "Gojek",
            "position": "backend",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "How would you implement real-time location tracking for millions of drivers?",
            "tags": ["system_design", "real_time", "geolocation"],
        },
        {
            "company": "Tokopedia",
            "position": "swe",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Design a product recommendation system for an e-commerce platform.",
            "tags": ["system_design", "machine_learning", "recommendations"],
        },
        {
            "company": "Tokopedia",
            "position": "backend",
            "question_type": "oa",
            "difficulty": "medium",
            "question_text": "Given a list of products with prices and categories, implement an efficient search with filters.",
            "tags": ["arrays", "searching", "optimization"],
        },
        {
            "company": "Shopee",
            "position": "swe",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "How would you design a flash sale system that handles millions of concurrent requests?",
            "tags": ["system_design", "high_availability", "concurrency"],
        },
        {
            "company": "Shopee",
            "position": "data",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Design a data pipeline to track user behavior across the shopping journey.",
            "tags": ["data_engineering", "etl", "analytics"],
        },
        {
            "company": "Grab",
            "position": "swe",
            "question_type": "system_design",
            "difficulty": "hard",
            "question_text": "Design a payment system that supports multiple payment methods and handles failures gracefully.",
            "tags": ["system_design", "payments", "fault_tolerance"],
        },
        {
            "company": "Grab",
            "position": "mobile",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "How would you optimize app performance for low-end devices with limited connectivity?",
            "tags": ["mobile", "optimization", "performance"],
        },
        {
            "company": "Bukalapak",
            "position": "swe",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Implement a shopping cart system with real-time inventory checking.",
            "tags": ["system_design", "inventory", "real_time"],
        },
        {
            "company": "Traveloka",
            "position": "backend",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "Design a booking system that handles concurrent reservations without double-booking.",
            "tags": ["system_design", "concurrency", "transactions"],
        },
        {
            "company": "Xendit",
            "position": "swe",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "How would you design a payment gateway API that's secure and highly available?",
            "tags": ["api_design", "security", "payments"],
        },
        {
            "company": "Ruangguru",
            "position": "backend",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Design a live streaming system for online classes with chat functionality.",
            "tags": ["system_design", "streaming", "real_time"],
        },
        {
            "company": "Google",
            "position": "swe",
            "question_type": "oa",
            "difficulty": "medium",
            "question_text": "Given an array of integers, find the longest subarray with sum equal to k.",
            "tags": ["arrays", "hash", "sliding_window"],
        },
        {
            "company": "Google",
            "position": "swe",
            "question_type": "behavioral",
            "difficulty": "medium",
            "question_text": "Tell me about a time when you had to work with a difficult team member. How did you handle it?",
            "tags": ["behavioral", "teamwork", "conflict_resolution"],
        },
        {
            "company": "Microsoft",
            "position": "swe",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Implement an LRU cache with O(1) get and put operations.",
            "tags": ["data_structures", "hash", "linked_list"],
        },
    ]


def _validate_question_wrapper(question_dict: Dict[str, Any]) -> tuple:
    """Wrapper to handle validation with both infrastructure options."""
    if HAS_INFRA:
        try:
            result = infra_validate_question(question_dict)
            return result[0], result[1] if len(result) > 1 else question_dict, 1.0 if result[0] else 0.0
        except Exception:
            pass
    if HAS_LEGACY:
        try:
            validation = validate_question(question_dict)
            return validation.is_valid, question_dict, getattr(validation, 'score', 1.0 if validation.is_valid else 0.0)
        except Exception:
            pass
    return True, question_dict, 1.0


def scrape_dicoding(
    months: int = 5,
    max_pages: int = 10,
    include_curated: bool = True
) -> List[Dict[str, Any]]:
    """
    Scrape Dicoding Indonesia for interview questions.

    Args:
        months: Number of months back to scrape (default 5)
        max_pages: Maximum pages to scrape per source
        include_curated: Include curated fallback questions

    Returns:
        List of InterviewQuestion dictionaries
    """
    _init_infrastructure()
    questions = []
    seen_ids = set()

    print(f"Scraping Dicoding Indonesia (last {months} months)...")

    # Try forum scraping
    forum_posts = fetch_dicoding_forum(months=months, max_pages=max_pages)
    print(f"Found {len(forum_posts)} forum posts")

    session = _get_session()

    for post in forum_posts:
        try:
            # Fetch full post content if we have a URL
            if post.get("url"):
                # Check cache for this URL
                url_cache_key = f"post_{hashlib.md5(post['url'].encode()).hexdigest()[:12]}"

                # Check cache (unified or legacy)
                cached_content = None
                if HAS_INFRA:
                    cache = infra_get_cache(ttl=21600)
                    cached_content = cache.get(url_cache_key)
                elif HAS_LEGACY and _cache:
                    cached_content = _cache.get(url_cache_key)

                if cached_content:
                    content = cached_content.data if hasattr(cached_content, 'data') else cached_content
                else:
                    # Rate limit (unified or legacy)
                    if HAS_INFRA:
                        wait_for_rate_limit("dicoding.com")
                    elif HAS_LEGACY and _throttler:
                        _throttler.wait()

                    response = session.get(
                        post["url"],
                        timeout=REQUEST_TIMEOUT,
                        verify=VERIFY_SSL
                    )

                    if response.status_code != 200:
                        continue

                    content = clean_html(response.text)

                    # Cache result (unified or legacy)
                    if HAS_INFRA:
                        cache = infra_get_cache(ttl=21600)
                        cache.set(url_cache_key, content)
                    elif HAS_LEGACY and _cache:
                        _cache.set(url_cache_key, content)

                # Detect company from content
                company = detect_company(content) or detect_company(post.get("title", ""))
                if not company:
                    continue

                # Extract questions
                extracted = extract_questions(content)

                for q in extracted:
                    q_id = generate_id(company, q)
                    if q_id in seen_ids:
                        continue
                    seen_ids.add(q_id)

                    question = InterviewQuestion(
                        id=q_id,
                        company=company,
                        position=detect_role(content),
                        question_type=detect_question_type(q),
                        difficulty=detect_difficulty(content),
                        question_text=q,
                        source="dicoding",
                        source_url=post["url"],
                        posted_date=parse_date(post.get("date", "")),
                        tags=extract_topics(q + " " + content),
                    )

                    # Validate question before adding
                    is_valid, _, score = _validate_question_wrapper(question.to_dict())
                    if is_valid or score >= 0.6:
                        questions.append(question.to_dict())
        except Exception as e:
            print(f"Error processing post: {e}")
            continue

    # Try API
    api_discussions = fetch_dicoding_discussions_api()
    print(f"Found {len(api_discussions)} API discussions")

    for disc in api_discussions:
        try:
            content = clean_html(disc.get("content", "") + " " + disc.get("title", ""))
            company = detect_company(content)
            if not company:
                continue

            extracted = extract_questions(content)

            for q in extracted:
                q_id = generate_id(company, q)
                if q_id in seen_ids:
                    continue
                seen_ids.add(q_id)

                parsed_date = parse_date(disc.get("date", ""))
                if not is_within_months(parsed_date, months):
                    continue

                question = InterviewQuestion(
                    id=q_id,
                    company=company,
                    position=detect_role(content),
                    question_type=detect_question_type(q),
                    difficulty=detect_difficulty(content),
                    question_text=q,
                    source="dicoding",
                    source_url=disc.get("url", "https://www.dicoding.com"),
                    posted_date=parsed_date,
                    tags=extract_topics(q + " " + content),
                )

                # Validate question before adding
                validation = validate_question(question.to_dict())
                if validation.is_valid or validation.score >= 0.6:
                    questions.append(question.to_dict())
        except Exception as e:
            print(f"Error processing discussion: {e}")
            continue

    # Add curated questions as fallback
    if include_curated and len(questions) < 10:
        print("Adding curated Indonesian tech interview questions...")
        curated = get_curated_indonesian_questions()

        for q in curated:
            q_id = generate_id(q["company"], q["question_text"])
            if q_id in seen_ids:
                continue
            seen_ids.add(q_id)

            question = InterviewQuestion(
                id=q_id,
                company=q["company"],
                position=q["position"],
                question_type=q["question_type"],
                difficulty=q["difficulty"],
                question_text=q["question_text"],
                source="dicoding_curated",
                source_url="https://www.dicoding.com",
                posted_date=datetime.now().strftime("%Y-%m-%d"),
                tags=q["tags"],
            )
            questions.append(question.to_dict())

    print(f"Total questions scraped: {len(questions)}")
    return questions


# Alias for consistency with other scrapers
def fetch_dicoding_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Alias for scrape_dicoding."""
    return scrape_dicoding(months=months)


if __name__ == "__main__":
    import json

    questions = scrape_dicoding(months=5)
    print(f"\nScraped {len(questions)} questions")

    if questions:
        print("\nSample questions:")
        for q in questions[:3]:
            print(f"- [{q['company']}] {q['question_text'][:80]}...")

        # Save to file
        with open("dicoding_questions.json", "w", encoding="utf-8") as f:
            json.dump(questions, f, indent=2, ensure_ascii=False)
        print("\nSaved to dicoding_questions.json")
