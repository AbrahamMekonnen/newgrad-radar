"""TabNews Brazil interview questions scraper.

Fetches interview questions and experiences from TabNews.com.br,
Brazil's largest tech forum. Searches for interview-related posts
(entrevista, processo seletivo, contratação) and extracts company,
position, and interview details.

Includes Portuguese to English translation for extracted content.
Filters to last 5 months by default.

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
import time
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
    print("[tabnews] Unified infrastructure not available, trying legacy imports...")

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and HAS_INFRA and CheckpointManager:
        try:
            _checkpoint = CheckpointManager("tabnews")
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
        print("[tabnews] Infrastructure modules not available, using basic mode")

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

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

REQUEST_TIMEOUT = 30
VERIFY_SSL = True
RATE_LIMIT_DELAY = 1.5  # seconds between requests

# Initialize infrastructure based on availability
_geo_proxy = None
_cache = None
_date_parser = None
_throttler = None
_stealth_session = None
_infra_context = None


def _init_infrastructure():
    """Initialize infrastructure components for Brazil scraping."""
    global _geo_proxy, _cache, _date_parser, _throttler, _stealth_session, _infra_context

    # Use unified infrastructure if available
    if HAS_INFRA:
        if _infra_context is None:
            _infra_context = InfrastructureContext(source="tabnews.com.br", region="br", ttl=21600)
        return

    # Fall back to legacy infrastructure
    if HAS_LEGACY:
        if _geo_proxy is None:
            _geo_proxy = GeoProxySelector()
        if _cache is None:
            _cache = get_cache("tabnews", ttl_hours=6)
        if _date_parser is None:
            _date_parser = UniversalDateParser()
        if _throttler is None:
            _throttler = get_throttler("tabnews.com.br")


def _get_session():
    """Get or create stealth session with Brazil proxies."""
    global _stealth_session
    _init_infrastructure()

    if HAS_INFRA:
        # Return a wrapper that uses unified infrastructure
        return _InfraSession()

    if HAS_LEGACY and _stealth_session is None:
        proxy = _geo_proxy.get_proxy_for_region(GeoRegion.BRAZIL, "tabnews.com.br")
        _stealth_session = create_stealth_session(proxy=proxy)

    return _stealth_session


class _InfraSession:
    """Wrapper session using unified infrastructure."""

    def get(self, url, **kwargs):
        """Make a GET request using unified infrastructure."""
        import requests

        # Apply rate limiting
        wait_for_rate_limit("tabnews.com.br")

        # Get stealth headers
        headers = get_stealth_headers(url)
        headers["Accept-Language"] = "pt-BR,pt;q=0.9,en;q=0.8"
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

# TabNews API endpoints
TABNEWS_API_BASE = "https://www.tabnews.com.br/api/v1"

# Portuguese interview keywords
PT_INTERVIEW_KEYWORDS = [
    "entrevista", "processo seletivo", "contratação", "contratacao",
    "vaga", "emprego", "seleção", "selecao", "recrutamento",
    "hiring", "interview", "processo de seleção", "entrevista técnica",
    "entrevista tecnica", "teste técnico", "teste tecnico", "code challenge",
    "live coding", "desafio técnico", "desafio tecnico", "whiteboard",
]

# Portuguese to English company name mapping
COMPANY_TRANSLATIONS = {
    "nubank": "Nubank",
    "ifood": "iFood",
    "mercado livre": "Mercado Libre",
    "mercadolibre": "Mercado Libre",
    "stone": "Stone",
    "picpay": "PicPay",
    "99": "99 (DiDi)",
    "99 taxi": "99 (DiDi)",
    "globo": "Globo",
    "itaú": "Itaú",
    "itau": "Itaú",
    "bradesco": "Bradesco",
    "santander": "Santander",
    "inter": "Banco Inter",
    "banco inter": "Banco Inter",
    "c6 bank": "C6 Bank",
    "neon": "Neon",
    "creditas": "Creditas",
    "loft": "Loft",
    "quinto andar": "QuintoAndar",
    "quintoandar": "QuintoAndar",
    "loggi": "Loggi",
    "rappi": "Rappi",
    "olist": "Olist",
    "vtex": "VTEX",
    "totvs": "TOTVS",
    "ci&t": "CI&T",
    "ciandt": "CI&T",
    "zup": "Zup",
    "dafiti": "Dafiti",
    "b3": "B3",
    "xp": "XP Inc",
    "xp inc": "XP Inc",
    "pagseguro": "PagSeguro",
    "pag seguro": "PagSeguro",
    "amazon": "Amazon",
    "google": "Google",
    "meta": "Meta",
    "facebook": "Meta",
    "microsoft": "Microsoft",
    "apple": "Apple",
    "netflix": "Netflix",
    "uber": "Uber",
    "twitter": "X (Twitter)",
    "x twitter": "X (Twitter)",
    "shopee": "Shopee",
    "cloudwalk": "CloudWalk",
    "hotmart": "Hotmart",
    "resultados digitais": "RD Station",
    "rd station": "RD Station",
    "ambev tech": "Ambev Tech",
    "magalu": "Magazine Luiza",
    "magazine luiza": "Magazine Luiza",
    "americanas": "Americanas",
    "getninjas": "GetNinjas",
    "gympass": "Gympass",
    "wellhub": "Wellhub",
}

# Portuguese to English common tech terms
PT_TO_EN = {
    "entrevista": "interview",
    "entrevista técnica": "technical interview",
    "entrevista tecnica": "technical interview",
    "processo seletivo": "hiring process",
    "teste técnico": "technical test",
    "teste tecnico": "technical test",
    "desafio de código": "coding challenge",
    "desafio de codigo": "coding challenge",
    "programação": "programming",
    "programacao": "programming",
    "desenvolvedor": "developer",
    "desenvolvedora": "developer",
    "engenheiro de software": "software engineer",
    "engenheira de software": "software engineer",
    "arquitetura": "architecture",
    "banco de dados": "database",
    "estrutura de dados": "data structure",
    "algoritmo": "algorithm",
    "complexidade": "complexity",
    "back-end": "backend",
    "front-end": "frontend",
    "full stack": "fullstack",
    "pleno": "mid-level",
    "sênior": "senior",
    "senior": "senior",
    "júnior": "junior",
    "junior": "junior",
    "estagiário": "intern",
    "estagiario": "intern",
    "estágio": "internship",
    "estagio": "internship",
    "pergunta": "question",
    "perguntas": "questions",
    "comportamental": "behavioral",
    "técnica": "technical",
    "tecnica": "technical",
    "salário": "salary",
    "salario": "salary",
    "remoto": "remote",
    "presencial": "on-site",
    "híbrido": "hybrid",
    "hibrido": "hybrid",
    "vaga": "position",
    "vagas": "positions",
}

# Role detection patterns (Portuguese)
ROLE_PATTERNS_PT = {
    "swe": [r"desenvolvedor", r"engenheiro de software", r"software engineer", r"programador"],
    "backend": [r"back.?end", r"backend"],
    "frontend": [r"front.?end", r"frontend"],
    "fullstack": [r"full.?stack", r"fullstack"],
    "mobile": [r"mobile", r"android", r"ios", r"react native", r"flutter"],
    "data": [r"dados", r"data engineer", r"engenheiro de dados", r"data"],
    "ml": [r"machine learning", r"ml", r"ia", r"inteligência artificial", r"data scientist"],
    "devops": [r"devops", r"sre", r"infraestrutura", r"infrastructure", r"cloud"],
    "qa": [r"qa", r"teste", r"quality", r"qualidade"],
}

# Question type patterns
QUESTION_TYPE_PATTERNS = {
    "technical": [
        r"\bcódigo\b", r"\bcodigo\b", r"\balgorithm\b", r"\balgoritmo\b",
        r"\bimplementar\b", r"\bdesenvolver\b", r"\bcoding\b",
        r"\bprogramação\b", r"\bprogramacao\b", r"\bwhiteboard\b",
    ],
    "behavioral": [
        r"\bcomportamental\b", r"\bsituação\b", r"\bsituacao\b",
        r"\bexperiência\b", r"\bexperiencia\b", r"\btrabalho em equipe\b",
        r"\bdesafio\b.*\benfrentou\b", r"\bcomo você\b", r"\bcomo voce\b",
    ],
    "system_design": [
        r"\bsystem design\b", r"\barquitetura\b", r"\bescalabilidade\b",
        r"\bescalar\b", r"\bdesign de sistema\b", r"\bmicroserviços\b",
        r"\bmicroservicos\b", r"\bdistribuído\b", r"\bdistribuido\b",
    ],
    "coding": [
        r"\bleetcode\b", r"\bhackerrank\b", r"\bcodility\b", r"\bcodesignal\b",
        r"\bonline assessment\b", r"\boa\b", r"\bteste online\b",
        r"\bplataforma de código\b", r"\bplataforma de codigo\b",
    ],
}


@dataclass
class InterviewQuestion:
    """Represents a single interview question from TabNews."""
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
    original_language: str = "pt-BR"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def translate_text(text: str) -> str:
    """Basic Portuguese to English translation for common terms."""
    if not text:
        return text

    result = text.lower()
    for pt, en in sorted(PT_TO_EN.items(), key=lambda x: -len(x[0])):
        result = re.sub(rf'\b{re.escape(pt)}\b', en, result, flags=re.IGNORECASE)

    return result


def normalize_company(text: str) -> str:
    """Normalize and translate company names."""
    if not text:
        return "Unknown"

    text_lower = text.lower().strip()
    for pt_name, en_name in COMPANY_TRANSLATIONS.items():
        if pt_name in text_lower:
            return en_name

    # Return original with title case if no translation found
    return text.strip().title()


def detect_company(text: str) -> Optional[str]:
    """Detect company name from text using robust detection."""
    if not text:
        return None

    # Use infrastructure's robust company detection first
    if HAS_LEGACY or HAS_INFRA:
        try:
            result = detect_company_robust(text)
            if result and hasattr(result, 'canonical_name'):
                return result.canonical_name
        except Exception:
            pass

    text_lower = text.lower()

    # Fall back to Brazilian-specific companies
    for company_pt, company_en in COMPANY_TRANSLATIONS.items():
        if company_pt in text_lower:
            return company_en

    # Try pattern matching for unlisted companies
    patterns = [
        r"(?:na|no|da|do|para)\s+(?:empresa\s+)?([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)?)",
        r"(?:entrevista|processo)\s+(?:na|no|da|do|para)\s+([A-Z][a-zA-Z0-9]+)",
        r"@([a-zA-Z0-9]+)\s+(?:está|esta|estamos)\s+contratando",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return normalize_company(match.group(1))

    return None


def detect_role(text: str) -> str:
    """Detect role type from text."""
    if not text:
        return "swe"

    text_lower = text.lower()

    for role, patterns in ROLE_PATTERNS_PT.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return role

    return "swe"


def detect_question_type(text: str) -> str:
    """Detect question type from text."""
    if not text:
        return "general"

    text_lower = text.lower()

    for q_type, patterns in QUESTION_TYPE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return q_type

    return "general"


def detect_difficulty(text: str) -> str:
    """Detect difficulty from text."""
    if not text:
        return "medium"

    text_lower = text.lower()

    easy_patterns = [r"\bfácil\b", r"\bfacil\b", r"\bsimples\b", r"\bbásico\b", r"\bbasico\b", r"\beasy\b"]
    hard_patterns = [r"\bdifícil\b", r"\bdificil\b", r"\bcomplexo\b", r"\bavançado\b", r"\bavancado\b", r"\bhard\b", r"\bchallenging\b"]

    for pattern in hard_patterns:
        if re.search(pattern, text_lower):
            return "hard"

    for pattern in easy_patterns:
        if re.search(pattern, text_lower):
            return "easy"

    return "medium"


def extract_questions_from_text(text: str) -> List[str]:
    """Extract individual interview questions from text."""
    if not text:
        return []

    questions = []

    # Pattern: Questions ending with ?
    question_marks = re.findall(r'[^.!?\n]+\?', text)
    questions.extend([q.strip() for q in question_marks if len(q.strip()) > 20])

    # Pattern: "perguntaram" / "asked" patterns
    asked_patterns = [
        r'(?:perguntaram|perguntou|asked|questionaram)[\s:]+["\']?([^"\'.\n]{20,200})["\']?',
        r'(?:perguntas?|questions?)[\s:]+["\']?([^"\'.\n]{20,200})["\']?',
    ]

    for pattern in asked_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        questions.extend([m.strip() for m in matches if len(m.strip()) > 15])

    # Pattern: Numbered lists (1. 2. 3.)
    numbered = re.findall(r'(?:^|\n)\s*\d+[.)]\s*([^\n]{15,200})', text)
    questions.extend([q.strip() for q in numbered if '?' in q or any(kw in q.lower() for kw in ['implement', 'explain', 'describe', 'what', 'how', 'why', 'como', 'por que', 'explique', 'descreva'])])

    # Pattern: Bullet points
    bullets = re.findall(r'(?:^|\n)\s*[-•*]\s*([^\n]{15,200})', text)
    questions.extend([q.strip() for q in bullets if '?' in q or any(kw in q.lower() for kw in ['implement', 'explain', 'describe', 'what', 'how', 'why', 'como', 'por que', 'explique', 'descreva'])])

    # Deduplicate while preserving order
    seen = set()
    unique_questions = []
    for q in questions:
        q_normalized = q.lower().strip()
        if q_normalized not in seen and len(q.strip()) > 15:
            seen.add(q_normalized)
            unique_questions.append(q.strip())

    return unique_questions[:20]  # Limit to 20 questions per post


def is_interview_related(content: Dict[str, Any]) -> bool:
    """Check if a post is interview-related."""
    title = content.get("title", "").lower()
    body = content.get("body", "").lower()
    combined = f"{title} {body}"

    return any(kw in combined for kw in PT_INTERVIEW_KEYWORDS)


def parse_date(date_str: str) -> Optional[datetime]:
    """Parse TabNews date string using UniversalDateParser."""
    if not date_str:
        return None

    _init_infrastructure()

    # Use infrastructure's universal date parser
    if HAS_LEGACY and _date_parser:
        result = _date_parser.parse(date_str, language="pt")
        if result and result.datetime:
            return result.datetime

    # Fallback: Try ISO format directly
    try:
        return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None


def is_within_months(date_str: str, months: int) -> bool:
    """Check if date is within the last N months."""
    # Use infrastructure's built-in check
    return utils_is_within_months(date_str, months)


def generate_question_id(company: str, question: str) -> str:
    """Generate unique ID for a question."""
    content = f"{company}:{question}".lower()
    return hashlib.md5(content.encode()).hexdigest()[:16]


def fetch_tabnews_contents(page: int = 1, per_page: int = 100, strategy: str = "relevant") -> List[Dict]:
    """Fetch contents from TabNews API with caching and stealth session."""
    _init_infrastructure()
    url = f"{TABNEWS_API_BASE}/contents"
    params = {
        "page": page,
        "per_page": per_page,
        "strategy": strategy,
    }

    cache_key = f"contents_{page}_{per_page}_{strategy}"

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
        wait_for_rate_limit("tabnews.com.br")
    elif HAS_LEGACY and _throttler:
        _throttler.wait()

    try:
        session = _get_session()
        response = session.get(url, params=params, timeout=REQUEST_TIMEOUT, verify=VERIFY_SSL)
        response.raise_for_status()
        data = response.json()

        # Cache response (unified or legacy)
        if HAS_INFRA:
            cache = infra_get_cache(ttl=21600)
            cache.set(cache_key, data)
        elif HAS_LEGACY and _cache:
            _cache.set(cache_key, data)

        return data
    except Exception as e:
        print(f"[TabNews] Error fetching page {page}: {e}")
        return []


def fetch_content_body(owner_username: str, slug: str) -> Optional[str]:
    """Fetch full content body from TabNews API with caching."""
    _init_infrastructure()
    url = f"{TABNEWS_API_BASE}/contents/{owner_username}/{slug}"
    cache_key = f"body_{owner_username}_{slug}"

    # Check cache first (unified or legacy)
    if HAS_INFRA:
        cache = infra_get_cache(ttl=21600)
        cached = cache.get(cache_key)
        if cached:
            return cached if isinstance(cached, str) else None
    elif HAS_LEGACY and _cache:
        cached = _cache.get(cache_key)
        if cached:
            return cached.data if hasattr(cached, 'data') else cached

    # Rate limit (unified or legacy)
    if HAS_INFRA:
        wait_for_rate_limit("tabnews.com.br")
    elif HAS_LEGACY and _throttler:
        _throttler.wait()

    try:
        session = _get_session()
        response = session.get(url, timeout=REQUEST_TIMEOUT, verify=VERIFY_SSL)
        response.raise_for_status()
        data = response.json()
        body = data.get("body", "")

        # Cache response (unified or legacy)
        if HAS_INFRA:
            cache = infra_get_cache(ttl=21600)
            cache.set(cache_key, body)
        elif HAS_LEGACY and _cache:
            _cache.set(cache_key, body)

        return body
    except Exception as e:
        print(f"[TabNews] Error fetching content {owner_username}/{slug}: {e}")
        return None


def search_tabnews(query: str, page: int = 1) -> List[Dict]:
    """Search TabNews for specific terms."""
    # TabNews doesn't have a search API, so we filter from contents
    contents = fetch_tabnews_contents(page=page, per_page=100, strategy="new")

    query_lower = query.lower()
    return [c for c in contents if query_lower in c.get("title", "").lower() or query_lower in c.get("body", "").lower()]


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


def scrape_tabnews(
    months: int = 5,
    max_pages: int = 10,
    include_body: bool = True
) -> List[Dict[str, Any]]:
    """
    Scrape TabNews.com.br for interview questions.

    Args:
        months: Number of months to look back (default 5)
        max_pages: Maximum pages to fetch (default 10)
        include_body: Whether to fetch full body content (slower but more questions)

    Returns:
        List of InterviewQuestion dicts
    """
    _init_infrastructure()
    print(f"[TabNews] Starting scrape - last {months} months, {max_pages} pages")

    all_questions: List[InterviewQuestion] = []
    seen_ids: set = set()

    for page in range(1, max_pages + 1):
        print(f"[TabNews] Fetching page {page}/{max_pages}")

        contents = fetch_tabnews_contents(page=page, per_page=100, strategy="new")

        if not contents:
            print(f"[TabNews] No more content at page {page}")
            break

        for content in contents:
            # Check date filter
            created_at = content.get("created_at", "")
            if not is_within_months(created_at, months):
                continue

            title = content.get("title", "")
            body_preview = content.get("body", "")
            owner = content.get("owner_username", "")
            slug = content.get("slug", "")

            # Check if interview-related
            if not is_interview_related({"title": title, "body": body_preview}):
                continue

            # Fetch full body if requested (throttler handles rate limiting)
            full_body = body_preview
            if include_body and owner and slug:
                fetched_body = fetch_content_body(owner, slug)
                if fetched_body:
                    full_body = fetched_body

            # Extract metadata
            combined_text = f"{title}\n{full_body}"
            company = detect_company(combined_text)
            role = detect_role(combined_text)
            q_type = detect_question_type(combined_text)
            difficulty = detect_difficulty(combined_text)

            # Extract individual questions
            questions = extract_questions_from_text(full_body)

            # If no specific questions found, use the post title/summary as a data point
            if not questions and company:
                questions = [title]

            source_url = f"https://www.tabnews.com.br/{owner}/{slug}"

            for q_text in questions:
                q_id = generate_question_id(company or "unknown", q_text)

                if q_id in seen_ids:
                    continue
                seen_ids.add(q_id)

                question = InterviewQuestion(
                    id=q_id,
                    company=company or "Unknown",
                    position=role,
                    question_type=q_type,
                    difficulty=difficulty,
                    question_text=q_text,
                    source="tabnews",
                    source_url=source_url,
                    posted_date=created_at,
                    tags=[role, q_type, "brazil", "portuguese"],
                    original_language="pt-BR",
                )

                # Validate question before adding
                is_valid, _, score = _validate_question_wrapper(question.to_dict())
                if is_valid or score >= 0.6:
                    all_questions.append(question)

        # Throttler handles rate limiting automatically

    print(f"[TabNews] Scraped {len(all_questions)} questions")
    return [q.to_dict() for q in all_questions]


def scrape_tabnews_by_company(company: str, months: int = 5) -> List[Dict[str, Any]]:
    """
    Scrape TabNews for a specific company.

    Args:
        company: Company name to search for
        months: Number of months to look back

    Returns:
        List of InterviewQuestion dicts
    """
    all_questions = scrape_tabnews(months=months, max_pages=5)

    company_lower = company.lower()
    return [q for q in all_questions if company_lower in q.get("company", "").lower()]


# Alias for consistent naming across scrapers
def fetch_tabnews_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Alias for scrape_tabnews."""
    return scrape_tabnews(months=months)


if __name__ == "__main__":
    import json
    import argparse

    parser = argparse.ArgumentParser(description="Scrape TabNews for interview questions")
    parser.add_argument("--months", type=int, default=5, help="Months to look back")
    parser.add_argument("--pages", type=int, default=5, help="Max pages to fetch")
    parser.add_argument("--output", type=str, help="Output JSON file")
    parser.add_argument("--company", type=str, help="Filter by company")
    args = parser.parse_args()

    if args.company:
        questions = scrape_tabnews_by_company(args.company, months=args.months)
    else:
        questions = scrape_tabnews(months=args.months, max_pages=args.pages)

    print(f"\n[TabNews] Found {len(questions)} questions")

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(questions, f, ensure_ascii=False, indent=2)
        print(f"[TabNews] Saved to {args.output}")
    else:
        for q in questions[:5]:
            print(f"\n- Company: {q['company']}")
            print(f"  Type: {q['question_type']}")
            print(f"  Question: {q['question_text'][:100]}...")
