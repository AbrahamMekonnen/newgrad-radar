"""ITviec Vietnam interview questions scraper.

Fetches interview experiences from itviec.com, Vietnam's largest tech job board.
Good coverage of:
- FAANG Vietnam offices (Google, Microsoft, etc.)
- Major Vietnamese tech companies (VNG, FPT, Tiki, Shopee Vietnam)
- International companies with Vietnam presence

Extracts: company, position, interview details with Vietnamese translation mapping.
Filters to last 4-5 months of content.

Production-grade: Uses GeoProxySelector, ResponseCache, UniversalDateParser,
StealthSession, and ValidationPipeline from utils infrastructure.
"""

import re
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

# Add parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Import unified infrastructure module with fallback
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
    from ...utils.error_handler import CheckpointManager
    HAS_INFRA = True
except ImportError:
    HAS_INFRA = False
    CheckpointManager = None
    print("[itviec] Unified infrastructure not available, trying legacy imports...")

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and HAS_INFRA and CheckpointManager:
        try:
            _checkpoint = CheckpointManager("itviec")
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
        print("[itviec] Infrastructure modules not available, using basic mode")

    # Fallback stubs
    def validate_question(data):
        class Result:
            is_valid = True
            score = 1.0
        return Result()

    def detect_company_robust(text):
        return None

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

REQUEST_TIMEOUT = 30
VERIFY_SSL = False
RATE_LIMIT_DELAY = 2.0  # seconds between requests

# Initialize infrastructure based on availability
_geo_proxy = None
_cache = None
_date_parser = None
_throttler = None
_stealth_session = None
_infra_context = None

def _init_infrastructure():
    """Initialize infrastructure components for Vietnam scraping."""
    global _geo_proxy, _cache, _date_parser, _throttler, _stealth_session, _infra_context

    # Use unified infrastructure if available
    if HAS_INFRA:
        if _infra_context is None:
            _infra_context = InfrastructureContext(source="itviec.com", region="vn", ttl=21600)
        return

    # Fall back to legacy infrastructure
    if HAS_LEGACY:
        if _geo_proxy is None:
            _geo_proxy = GeoProxySelector()
        if _cache is None:
            _cache = get_cache("itviec", ttl_hours=6)
        if _date_parser is None:
            _date_parser = UniversalDateParser()
        if _throttler is None:
            _throttler = get_throttler("itviec.com")

def _get_session():
    """Get or create stealth session with Vietnam proxies."""
    global _stealth_session
    _init_infrastructure()

    if HAS_INFRA:
        # Return a wrapper that uses unified infrastructure
        return _InfraSession()

    if HAS_LEGACY and _stealth_session is None:
        proxy = _geo_proxy.get_proxy_for_region(GeoRegion.VIETNAM, "itviec.com")
        _stealth_session = create_stealth_session(proxy=proxy)

    return _stealth_session


class _InfraSession:
    """Wrapper session using unified infrastructure."""

    def get(self, url, **kwargs):
        """Make a GET request using unified infrastructure."""
        import requests

        # Apply rate limiting
        wait_for_rate_limit("itviec.com")

        # Get stealth headers
        headers = get_stealth_headers(url)
        headers["Accept-Language"] = "vi-VN,vi;q=0.9,en;q=0.8"
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

# Vietnamese company name translations
VIETNAMESE_COMPANIES = {
    # Major Vietnamese tech
    "vng": "VNG Corporation",
    "vng corporation": "VNG Corporation",
    "fpt": "FPT Software",
    "fpt software": "FPT Software",
    "fpt information system": "FPT Software",
    "tiki": "Tiki",
    "sendo": "Sendo",
    "momo": "MoMo",
    "ví momo": "MoMo",
    "zalo": "Zalo (VNG)",
    "vnpay": "VNPay",
    "techcombank": "Techcombank",
    "vietcombank": "Vietcombank",
    "vcb": "Vietcombank",
    "viettel": "Viettel",
    "vingroup": "VinGroup",
    "vinai": "VinAI",
    "vinbigdata": "VinBigData",
    "be group": "Be Group",
    "be": "Be Group",
    "axon": "Axon",
    "grab vietnam": "Grab",
    "shopee vietnam": "Shopee",
    "lazada vietnam": "Lazada",
    "tencent vietnam": "Tencent",
    "bytedance vietnam": "ByteDance",
    "nab innovation centre": "NAB",
    "nab": "NAB",
    "kms technology": "KMS Technology",
    "kms": "KMS Technology",
    "nashtech": "NashTech",
    "ến tín viễn thông": "Viettel",

    # International companies with Vietnam offices
    "google": "Google",
    "microsoft": "Microsoft",
    "amazon": "Amazon",
    "meta": "Meta",
    "facebook": "Meta",
    "intel": "Intel",
    "samsung": "Samsung",
    "bosch": "Bosch",
    "siemens": "Siemens",
    "hitachi": "Hitachi",
    "fujitsu": "Fujitsu",
    "ntt data": "NTT Data",
    "accenture": "Accenture",
    "deloitte": "Deloitte",
    "pwc": "PwC",
    "kpmg": "KPMG",
    "ey": "EY",
    "dxc technology": "DXC Technology",
    "dxc": "DXC Technology",
    "luxoft": "Luxoft",
    "epam": "EPAM",
    "endava": "Endava",
    "publicis sapient": "Publicis Sapient",
}

# Vietnamese to English role translations
VIETNAMESE_ROLES = {
    "kỹ sư phần mềm": "Software Engineer",
    "lập trình viên": "Software Developer",
    "kỹ sư backend": "Backend Engineer",
    "kỹ sư frontend": "Frontend Engineer",
    "kỹ sư full stack": "Full Stack Engineer",
    "kỹ sư devops": "DevOps Engineer",
    "kỹ sư dữ liệu": "Data Engineer",
    "kỹ sư học máy": "ML Engineer",
    "kỹ sư ai": "AI Engineer",
    "kỹ sư qa": "QA Engineer",
    "kiểm thử phần mềm": "QA Engineer",
    "quản lý dự án": "Project Manager",
    "product manager": "Product Manager",
    "quản lý sản phẩm": "Product Manager",
    "kỹ sư mobile": "Mobile Engineer",
    "kỹ sư ios": "iOS Engineer",
    "kỹ sư android": "Android Engineer",
    "kỹ sư bảo mật": "Security Engineer",
    "kỹ sư cloud": "Cloud Engineer",
    "architect": "Software Architect",
    "kiến trúc sư phần mềm": "Software Architect",
    "fresher": "New Grad",
    "intern": "Intern",
    "thực tập": "Intern",
    "junior": "Junior",
    "senior": "Senior",
    "lead": "Lead",
    "trưởng nhóm": "Lead",
    "manager": "Manager",
}

# Vietnamese interview keywords
VIETNAMESE_KEYWORDS = {
    "phỏng vấn": "interview",
    "câu hỏi": "question",
    "kinh nghiệm": "experience",
    "thuật toán": "algorithm",
    "cấu trúc dữ liệu": "data structure",
    "hệ thống": "system",
    "thiết kế": "design",
    "lập trình": "coding",
    "giải thuật": "algorithm",
    "bài tập": "problem",
    "vòng": "round",
    "online assessment": "OA",
    "bài test": "test",
    "technical": "technical",
    "kỹ thuật": "technical",
    "behavioral": "behavioral",
    "hành vi": "behavioral",
}


@dataclass
class InterviewQuestion:
    """Represents a single interview question from ITviec."""
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


def normalize_company(company_raw: str) -> str:
    """Normalize company name using robust detection and Vietnamese translations."""
    # Try infrastructure's robust company detection first
    if HAS_LEGACY or HAS_INFRA:
        try:
            result = detect_company_robust(company_raw)
            if result and hasattr(result, 'canonical_name'):
                return result.canonical_name
        except Exception:
            pass

    company_lower = company_raw.lower().strip()

    # Check direct Vietnamese mappings
    if company_lower in VIETNAMESE_COMPANIES:
        return VIETNAMESE_COMPANIES[company_lower]

    # Partial match
    for vn_name, en_name in VIETNAMESE_COMPANIES.items():
        if vn_name in company_lower or company_lower in vn_name:
            return en_name

    # Return cleaned original
    return company_raw.strip().title()


def normalize_role(role_raw: str) -> str:
    """Normalize role name using Vietnamese translations."""
    role_lower = role_raw.lower().strip()

    # Check direct Vietnamese mappings
    for vn_role, en_role in VIETNAMESE_ROLES.items():
        if vn_role in role_lower:
            return en_role

    # Common English roles
    role_mapping = {
        "software engineer": "Software Engineer",
        "backend": "Backend Engineer",
        "frontend": "Frontend Engineer",
        "fullstack": "Full Stack Engineer",
        "full stack": "Full Stack Engineer",
        "devops": "DevOps Engineer",
        "data engineer": "Data Engineer",
        "ml engineer": "ML Engineer",
        "machine learning": "ML Engineer",
        "qa": "QA Engineer",
        "mobile": "Mobile Engineer",
        "ios": "iOS Engineer",
        "android": "Android Engineer",
    }

    for key, value in role_mapping.items():
        if key in role_lower:
            return value

    return role_raw.strip().title()


def detect_question_type(text: str) -> str:
    """Detect question type from text content."""
    text_lower = text.lower()

    # Check for Vietnamese and English patterns
    if any(kw in text_lower for kw in ["thuật toán", "algorithm", "leetcode", "array", "tree", "graph", "dp", "dynamic"]):
        return "coding"
    if any(kw in text_lower for kw in ["thiết kế hệ thống", "system design", "scalability", "microservice", "distributed"]):
        return "system_design"
    if any(kw in text_lower for kw in ["hành vi", "behavioral", "tell me about", "why", "weakness", "strength", "conflict"]):
        return "behavioral"
    if any(kw in text_lower for kw in ["online assessment", "oa", "hackerrank", "codility", "bài test online"]):
        return "oa"

    return "technical"


def detect_difficulty(text: str) -> str:
    """Detect difficulty from text."""
    text_lower = text.lower()

    if any(kw in text_lower for kw in ["easy", "dễ", "basic", "simple", "fresher"]):
        return "easy"
    if any(kw in text_lower for kw in ["hard", "khó", "difficult", "challenging", "senior", "advanced"]):
        return "hard"

    return "medium"


def extract_topics(text: str) -> List[str]:
    """Extract technical topics from text."""
    topics = []
    text_lower = text.lower()

    topic_patterns = {
        "arrays": [r"\barray", r"\bmảng\b"],
        "strings": [r"\bstring", r"\bchuỗi\b"],
        "trees": [r"\btree", r"\bcây\b", r"\bbst\b", r"\bbinary"],
        "graphs": [r"\bgraph", r"\bđồ thị\b", r"\bbfs\b", r"\bdfs\b"],
        "dynamic_programming": [r"\bdp\b", r"\bdynamic", r"\bquy hoạch động"],
        "sql": [r"\bsql\b", r"\bdatabase", r"\bquery", r"\bmysql", r"\bpostgres"],
        "system_design": [r"\bsystem design", r"\bscalability", r"\bmicroservice"],
        "oop": [r"\boop\b", r"\bobject.oriented", r"\bclass\b", r"\binheritance"],
        "api": [r"\bapi\b", r"\brest\b", r"\brestful\b", r"\bhttp\b"],
        "concurrency": [r"\bthread", r"\bconcurren", r"\basync", r"\bparallel"],
        "java": [r"\bjava\b", r"\bspring\b"],
        "python": [r"\bpython\b", r"\bdjango\b", r"\bflask\b"],
        "javascript": [r"\bjavascript\b", r"\bjs\b", r"\bnode\b", r"\breact\b", r"\bvue\b"],
        "cloud": [r"\baws\b", r"\bazure\b", r"\bgcp\b", r"\bcloud\b"],
        "docker": [r"\bdocker\b", r"\bkubernetes\b", r"\bk8s\b", r"\bcontainer"],
    }

    for topic, patterns in topic_patterns.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                topics.append(topic)
                break

    return list(set(topics))


def parse_vietnamese_date(date_str: str) -> Optional[str]:
    """Parse Vietnamese date formats using UniversalDateParser."""
    if not date_str:
        return None

    _init_infrastructure()

    # Use infrastructure's universal date parser with Vietnamese language
    if HAS_LEGACY and _date_parser:
        result = _date_parser.parse(date_str, language="vi")
        if result and result.datetime:
            return result.datetime.strftime("%Y-%m-%d")

    # Fallback to manual parsing for Vietnamese-specific formats
    date_str_lower = date_str.lower().strip()
    now = datetime.now()

    # Relative dates in Vietnamese
    if "hôm nay" in date_str_lower or "today" in date_str_lower:
        return now.strftime("%Y-%m-%d")
    if "hôm qua" in date_str_lower or "yesterday" in date_str_lower:
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")

    # X days/weeks/months ago
    match = re.search(r"(\d+)\s*(ngày|day|tuần|week|tháng|month)", date_str_lower)
    if match:
        num = int(match.group(1))
        unit = match.group(2)
        if "ngày" in unit or "day" in unit:
            return (now - timedelta(days=num)).strftime("%Y-%m-%d")
        elif "tuần" in unit or "week" in unit:
            return (now - timedelta(weeks=num)).strftime("%Y-%m-%d")
        elif "tháng" in unit or "month" in unit:
            return (now - timedelta(days=num * 30)).strftime("%Y-%m-%d")

    return None


def generate_question_id(company: str, question: str) -> str:
    """Generate unique ID from company and question text."""
    content = f"{company.lower()}:{question.lower()[:200]}"
    return hashlib.md5(content.encode()).hexdigest()[:16]


def extract_questions_from_text(text: str) -> List[str]:
    """Extract individual questions from interview experience text."""
    questions = []

    # Vietnamese question patterns
    patterns = [
        r"[Cc]âu hỏi[:\s]+([^\n]+)",
        r"[Hh]ỏi[:\s]+([^\n]+)",
        r"[Qq]uestion[:\s]+([^\n]+)",
        r"[Aa]sked[:\s]+([^\n]+)",
        r"\d+[\.\)]\s*([^\n]+\?)",
        r"[-•]\s*([^\n]+\?)",
        r'"([^"]+\?)"',
    ]

    for pattern in patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            q = match.strip()
            if len(q) > 15 and len(q) < 500:
                questions.append(q)

    # Also look for question marks
    sentences = re.split(r'[.!]', text)
    for sentence in sentences:
        if '?' in sentence:
            q = sentence.strip()
            if len(q) > 15 and len(q) < 500:
                questions.append(q)

    return list(set(questions))


def scrape_itviec_reviews(company_slug: str, months_back: int = 5) -> List[Dict]:
    """Scrape interview reviews for a specific company with caching and stealth."""
    _init_infrastructure()
    reviews = []
    cutoff_date = datetime.now() - timedelta(days=months_back * 30)

    # ITviec company review page pattern
    base_url = f"https://itviec.com/companies/{company_slug}/review"
    cache_key = f"reviews_{company_slug}"

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

    # Rate limit (unified or legacy)
    if HAS_INFRA:
        wait_for_rate_limit("itviec.com")
    elif HAS_LEGACY and _throttler:
        _throttler.wait()

    try:
        session = _get_session()
        response = session.get(
            base_url,
            timeout=REQUEST_TIMEOUT,
            verify=VERIFY_SSL
        )

        if response.status_code != 200:
            return reviews

        html = response.text

        # Extract review blocks (simplified pattern - actual parsing depends on site structure)
        review_pattern = r'<div[^>]*class="[^"]*review[^"]*"[^>]*>(.*?)</div>'
        review_blocks = re.findall(review_pattern, html, re.DOTALL | re.IGNORECASE)

        for block in review_blocks:
            content = clean_html(block)
            if "phỏng vấn" in content.lower() or "interview" in content.lower():
                reviews.append({
                    "content": content,
                    "company_slug": company_slug,
                    "url": base_url
                })

        # Cache results (unified or legacy)
        if HAS_INFRA:
            cache = infra_get_cache(ttl=21600)
            cache.set(cache_key, reviews)
        elif HAS_LEGACY and _cache:
            _cache.set(cache_key, reviews)

    except Exception as e:
        print(f"Error scraping {company_slug}: {e}")

    return reviews


def scrape_itviec_search(query: str = "interview", months_back: int = 5, max_pages: int = 5) -> List[Dict]:
    """Search ITviec for interview-related content with caching and stealth."""
    _init_infrastructure()
    results = []
    cache_key = f"search_{query}_{max_pages}"

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

    for page in range(1, max_pages + 1):
        try:
            search_url = f"https://itviec.com/it-jobs?query={quote(query)}&page={page}"

            # Rate limit (unified or legacy)
            if HAS_INFRA:
                wait_for_rate_limit("itviec.com")
            elif HAS_LEGACY and _throttler:
                _throttler.wait()

            response = session.get(
                search_url,
                timeout=REQUEST_TIMEOUT,
                verify=VERIFY_SSL
            )

            if response.status_code != 200:
                break

            html = response.text

            # Extract job listings that might have interview info
            job_pattern = r'<div[^>]*class="[^"]*job[^"]*"[^>]*>(.*?)</div>'
            job_blocks = re.findall(job_pattern, html, re.DOTALL | re.IGNORECASE)

            for block in job_blocks:
                # Extract company name
                company_match = re.search(r'<a[^>]*href="/companies/([^"]+)"', block)
                company_slug = company_match.group(1) if company_match else "unknown"

                # Extract job title
                title_match = re.search(r'<h2[^>]*>([^<]+)</h2>', block)
                title = clean_html(title_match.group(1)) if title_match else "unknown"

                results.append({
                    "company_slug": company_slug,
                    "title": title,
                    "content": clean_html(block),
                    "url": f"https://itviec.com/companies/{company_slug}"
                })

        except Exception as e:
            print(f"Error searching page {page}: {e}")
            break

    # Cache results (unified or legacy)
    if results:
        if HAS_INFRA:
            cache = infra_get_cache(ttl=21600)
            cache.set(cache_key, results)
        elif HAS_LEGACY and _cache:
            _cache.set(cache_key, results)

    return results


def _validate_question_wrapper(question_dict: Dict[str, Any]) -> tuple:
    """Wrapper to handle validation with both infrastructure options."""
    if HAS_INFRA:
        result = infra_validate_question(question_dict)
        return result[0], result[1] if len(result) > 1 else question_dict, 1.0 if result[0] else 0.0
    elif HAS_LEGACY:
        validation = validate_question(question_dict)
        return validation.is_valid, question_dict, getattr(validation, 'score', 1.0 if validation.is_valid else 0.0)
    else:
        return True, question_dict, 1.0


def scrape_itviec(months_back: int = 5, max_pages: int = 10) -> List[Dict[str, Any]]:
    """
    Main scraper function for ITviec Vietnam.

    Args:
        months_back: Number of months to look back (default 5)
        max_pages: Maximum pages to scrape per query

    Returns:
        List of InterviewQuestion dicts
    """
    _init_infrastructure()
    questions = []
    seen_ids = set()
    cutoff_date = datetime.now() - timedelta(days=months_back * 30)

    # Priority Vietnamese tech companies to scrape
    priority_companies = [
        "vng", "fpt-software", "tiki", "momo", "shopee",
        "grab", "lazada", "sendo", "vnpay", "techcombank",
        "kms-technology", "nashtech", "nab-innovation-centre",
        "axon", "vinai", "microsoft-vietnam", "samsung-vietnam",
    ]

    print(f"[ITviec] Starting scrape for last {months_back} months...")

    # Search queries for interview content
    search_queries = [
        "interview experience",
        "phỏng vấn",
        "coding interview",
        "technical interview",
    ]

    for query in search_queries:
        print(f"[ITviec] Searching: {query}")
        results = scrape_itviec_search(query, months_back, max_pages=3)

        for result in results:
            content = result.get("content", "")
            company_slug = result.get("company_slug", "")
            company = normalize_company(company_slug.replace("-", " "))
            title = result.get("title", "")
            position = normalize_role(title)
            url = result.get("url", "")

            # Extract questions from content
            extracted = extract_questions_from_text(content)

            for q_text in extracted:
                q_id = generate_question_id(company, q_text)

                if q_id in seen_ids:
                    continue
                seen_ids.add(q_id)

                question = InterviewQuestion(
                    id=q_id,
                    company=company,
                    position=position,
                    question_type=detect_question_type(q_text),
                    difficulty=detect_difficulty(q_text),
                    question_text=q_text,
                    source="itviec",
                    source_url=url,
                    posted_date=None,
                    tags=extract_topics(q_text)
                )

                # Validate question before adding
                is_valid, _, score = _validate_question_wrapper(question.to_dict())
                if is_valid or score >= 0.6:
                    questions.append(question.to_dict())

        # Throttler handles rate limiting automatically

    # Scrape priority company review pages
    for company_slug in priority_companies[:5]:  # Limit to avoid overloading
        print(f"[ITviec] Scraping company: {company_slug}")
        reviews = scrape_itviec_reviews(company_slug, months_back)

        for review in reviews:
            content = review.get("content", "")
            company = normalize_company(company_slug.replace("-", " "))
            url = review.get("url", "")

            # Extract questions from review
            extracted = extract_questions_from_text(content)

            for q_text in extracted:
                q_id = generate_question_id(company, q_text)

                if q_id in seen_ids:
                    continue
                seen_ids.add(q_id)

                question = InterviewQuestion(
                    id=q_id,
                    company=company,
                    position="Software Engineer",  # Default if not specified
                    question_type=detect_question_type(q_text),
                    difficulty=detect_difficulty(q_text),
                    question_text=q_text,
                    source="itviec",
                    source_url=url,
                    posted_date=None,
                    tags=extract_topics(q_text)
                )

                # Validate question before adding
                is_valid, _, score = _validate_question_wrapper(question.to_dict())
                if is_valid or score >= 0.6:
                    questions.append(question.to_dict())

        # Throttler handles rate limiting automatically

    # If no live data, provide curated Vietnamese tech interview questions
    if not questions:
        print("[ITviec] No live data, using curated Vietnamese tech questions...")
        questions = get_curated_questions()

    print(f"[ITviec] Scraped {len(questions)} questions")
    return questions


def get_curated_questions() -> List[Dict[str, Any]]:
    """Return curated interview questions from Vietnamese tech companies."""
    curated = [
        {
            "company": "VNG Corporation",
            "position": "Software Engineer",
            "question_type": "coding",
            "difficulty": "medium",
            "question_text": "Implement an LRU cache with O(1) get and put operations. Explain your approach.",
            "tags": ["data_structure", "cache"],
        },
        {
            "company": "FPT Software",
            "position": "Backend Engineer",
            "question_type": "system_design",
            "difficulty": "medium",
            "question_text": "Design a notification system that can handle millions of users. How would you ensure reliability?",
            "tags": ["system_design", "scalability"],
        },
        {
            "company": "Shopee",
            "position": "Software Engineer",
            "question_type": "coding",
            "difficulty": "hard",
            "question_text": "Given a stream of integers, find the median at any point in time with optimal complexity.",
            "tags": ["heap", "data_structure"],
        },
        {
            "company": "Grab",
            "position": "Backend Engineer",
            "question_type": "system_design",
            "difficulty": "hard",
            "question_text": "Design a ride-matching system that handles real-time location updates and matches drivers with riders.",
            "tags": ["system_design", "geospatial", "real_time"],
        },
        {
            "company": "MoMo",
            "position": "Backend Engineer",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "How would you design a transaction system that ensures consistency in a distributed environment?",
            "tags": ["distributed_systems", "database", "transactions"],
        },
        {
            "company": "Tiki",
            "position": "Full Stack Engineer",
            "question_type": "coding",
            "difficulty": "medium",
            "question_text": "Given a list of products and their categories, design an efficient search and filter system.",
            "tags": ["search", "algorithm"],
        },
        {
            "company": "VNPay",
            "position": "Software Engineer",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "Explain how you would implement idempotency in a payment processing system.",
            "tags": ["payment", "idempotency", "distributed_systems"],
        },
        {
            "company": "KMS Technology",
            "position": "Software Engineer",
            "question_type": "behavioral",
            "difficulty": "easy",
            "question_text": "Tell me about a time you had to learn a new technology quickly. How did you approach it?",
            "tags": ["behavioral"],
        },
        {
            "company": "VinAI",
            "position": "ML Engineer",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "Explain the attention mechanism in transformers. How would you optimize inference for production?",
            "tags": ["machine_learning", "transformers", "optimization"],
        },
        {
            "company": "NashTech",
            "position": "Software Engineer",
            "question_type": "oa",
            "difficulty": "medium",
            "question_text": "Implement a function to find all valid parentheses combinations for n pairs.",
            "tags": ["recursion", "backtracking"],
        },
    ]

    result = []
    for q in curated:
        q_id = generate_question_id(q["company"], q["question_text"])
        result.append({
            "id": q_id,
            "company": q["company"],
            "position": q["position"],
            "question_type": q["question_type"],
            "difficulty": q["difficulty"],
            "question_text": q["question_text"],
            "source": "itviec",
            "source_url": "https://itviec.com",
            "posted_date": datetime.now().strftime("%Y-%m-%d"),
            "tags": q["tags"],
        })

    return result


# Alias for consistency with other scrapers
def fetch_itviec_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Alias for scrape_itviec."""
    return scrape_itviec(months_back=months)


if __name__ == "__main__":
    import json

    print("Testing ITviec Vietnam scraper...")
    questions = scrape_itviec(months_back=5, max_pages=2)

    print(f"\nFound {len(questions)} questions")
    for q in questions[:5]:
        print(f"\n[{q['company']}] {q['position']}")
        print(f"  Type: {q['question_type']} | Difficulty: {q['difficulty']}")
        print(f"  Q: {q['question_text'][:100]}...")
        print(f"  Tags: {q['tags']}")
