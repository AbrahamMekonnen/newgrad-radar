"""OpenWork (Japan) interview questions scraper.

OpenWork.jp (formerly Vorkers) is Japan's largest employer review site,
similar to Glassdoor. Contains interview experiences with questions asked,
difficulty ratings, and process details.

ACCESSIBILITY:
- PUBLIC (no auth): Company overview pages, basic interview stats
- AUTH-GATED: Full interview text, detailed question lists, salary data
- Requires Japanese registration with email verification

This scraper focuses on publicly accessible data and interview metadata.
For full content, users would need to contribute their own review (free access model).

Source: https://www.openwork.jp/

UPGRADED: Uses production-grade infrastructure:
- GeoProxySelector for Japan-specific proxies (REQUIRED for openwork.jp)
- UniversalDateParser for Japanese era dates (令和, 平成)
- ResponseCache for efficient caching
- StealthSession for anti-detection
- Monitoring and error handling
"""

import re
import hashlib
import requests
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin, quote
from html import unescape

try:
    from googletrans import Translator
    TRANSLATOR_AVAILABLE = True
except ImportError:
    TRANSLATOR_AVAILABLE = False

from . import InterviewQuestion, QuestionType, Difficulty

# Import infrastructure utilities
try:
    from scraper.utils import (
        GeoProxySelector,
        GeoRegion,
        get_proxy_for_url,
        ResponseCache,
        get_cache,
        UniversalDateParser,
        parse_date,
        is_within_months,
        StealthSession,
        create_stealth_session,
        monitor_scraper,
        RetryManager,
        with_retry,
        detect_company_robust,
        detect_all_companies_robust,
        InternationalCompanyNER,
    )
    from ...utils.error_handler import CheckpointManager
    INFRA_AVAILABLE = True
except ImportError:
    INFRA_AVAILABLE = False

# Checkpoint manager
_checkpoint: Optional['CheckpointManager'] = None


def _get_checkpoint() -> Optional['CheckpointManager']:
    """Get or create checkpoint manager."""
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE:
        try:
            _checkpoint = CheckpointManager("openwork")
        except Exception:
            pass
    return _checkpoint

# OpenWork base URLs
BASE_URL = "https://www.openwork.jp"
COMPANY_SEARCH_URL = f"{BASE_URL}/a0910000"  # Company search endpoint
INTERVIEW_SECTION = "/recruitment_interviews"  # Interview section suffix

# Request config
REQUEST_TIMEOUT = 30
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Japanese interview-related keywords
INTERVIEW_KEYWORDS = {
    "面接": "interview",
    "質問": "question",
    "選考": "selection process",
    "内定": "job offer",
    "難易度": "difficulty",
    "雰囲気": "atmosphere",
    "志望動機": "motivation for applying",
    "自己PR": "self-introduction",
    "逆質問": "questions to ask interviewer",
    "グループディスカッション": "group discussion",
    "ケース面接": "case interview",
    "技術面接": "technical interview",
    "コーディング": "coding",
    "アルゴリズム": "algorithm",
}

# Common Japanese tech companies with English names
COMPANY_TRANSLATIONS = {
    "メルカリ": "Mercari",
    "楽天": "Rakuten",
    "ソフトバンク": "SoftBank",
    "ヤフー": "Yahoo Japan",
    "サイバーエージェント": "CyberAgent",
    "ディー・エヌ・エー": "DeNA",
    "グリー": "GREE",
    "リクルート": "Recruit",
    "富士通": "Fujitsu",
    "日立": "Hitachi",
    "ソニー": "Sony",
    "パナソニック": "Panasonic",
    "トヨタ": "Toyota",
    "ホンダ": "Honda",
    "任天堂": "Nintendo",
    "LINE": "LINE",
    "スマートニュース": "SmartNews",
    "freee": "freee",
    "マネーフォワード": "Money Forward",
}

# Role translations
ROLE_TRANSLATIONS = {
    "エンジニア": "Engineer",
    "ソフトウェアエンジニア": "Software Engineer",
    "開発者": "Developer",
    "プログラマー": "Programmer",
    "データサイエンティスト": "Data Scientist",
    "機械学習エンジニア": "ML Engineer",
    "インフラエンジニア": "Infrastructure Engineer",
    "SRE": "SRE",
    "プロダクトマネージャー": "Product Manager",
    "デザイナー": "Designer",
    "新卒": "New Graduate",
    "中途": "Mid-career",
}


def get_translator():
    """Get Google Translator instance if available."""
    if TRANSLATOR_AVAILABLE:
        try:
            return Translator()
        except Exception:
            pass
    return None


def translate_text(text: str, translator=None) -> str:
    """Translate Japanese text to English.

    Args:
        text: Japanese text to translate
        translator: Optional Translator instance for reuse

    Returns:
        English translation or original text if translation fails
    """
    if not text:
        return text

    # First try known translations
    for jp, en in {**COMPANY_TRANSLATIONS, **ROLE_TRANSLATIONS, **INTERVIEW_KEYWORDS}.items():
        text = text.replace(jp, en)

    # If still contains Japanese characters, use Google Translate
    if translator and re.search(r'[぀-ゟ゠-ヿ一-鿿]', text):
        try:
            result = translator.translate(text, src='ja', dest='en')
            return result.text
        except Exception:
            pass

    return text


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<p>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = unescape(text)
    return text.strip()


def generate_question_id(company: str, question: str, source: str) -> str:
    """Generate unique ID for a question."""
    content = f"{company}:{question}:{source}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def parse_difficulty(text: str) -> Optional[Difficulty]:
    """Parse difficulty from Japanese text."""
    text_lower = text.lower()

    # Japanese difficulty indicators
    if any(x in text_lower for x in ["難しい", "高難度", "hard", "難"]):
        return Difficulty.HARD
    elif any(x in text_lower for x in ["普通", "中程度", "medium", "標準"]):
        return Difficulty.MEDIUM
    elif any(x in text_lower for x in ["簡単", "易しい", "easy", "基本"]):
        return Difficulty.EASY

    return None


def parse_question_type(text: str) -> QuestionType:
    """Determine question type from content."""
    text_lower = text.lower()

    if any(x in text_lower for x in ["コーディング", "アルゴリズム", "coding", "algorithm", "実装"]):
        return QuestionType.CODING
    elif any(x in text_lower for x in ["システム設計", "system design", "設計", "アーキテクチャ"]):
        return QuestionType.SYSTEM_DESIGN
    elif any(x in text_lower for x in ["志望動機", "自己PR", "強み", "弱み", "チーム", "困難"]):
        return QuestionType.BEHAVIORAL
    elif any(x in text_lower for x in ["OA", "オンライン", "webテスト", "適性検査"]):
        return QuestionType.OA
    else:
        return QuestionType.TECHNICAL


def extract_questions_from_text(text: str) -> list[str]:
    """Extract individual questions from interview description text."""
    questions = []

    # Common question patterns in Japanese interviews
    patterns = [
        r'「([^」]+\？)」',  # Quoted questions with ?
        r'「([^」]{10,})」',  # Quoted text (likely questions)
        r'・([^\n・]{10,})',  # Bullet points
        r'Q[:：]?\s*(.+?)(?:\n|$)',  # Q: format
        r'質問[:：]?\s*(.+?)(?:\n|$)',  # 質問 (question) prefix
    ]

    for pattern in patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            cleaned = match.strip()
            if len(cleaned) > 10 and cleaned not in questions:
                questions.append(cleaned)

    # If no structured questions found, try sentence extraction
    if not questions:
        sentences = re.split(r'[。\n]', text)
        for sentence in sentences:
            sentence = sentence.strip()
            if len(sentence) > 15 and ('?' in sentence or '？' in sentence or
                any(kw in sentence for kw in ["質問", "聞かれ", "問われ"])):
                questions.append(sentence)

    return questions[:10]  # Limit to 10 questions per interview


def parse_interview_date(text: str) -> Optional[datetime]:
    """Parse interview date from Japanese text.

    Uses UniversalDateParser for Japanese era dates (令和, 平成, etc.)
    """
    # Use UniversalDateParser if available
    if INFRA_AVAILABLE:
        try:
            # Try to extract interview-specific date first
            from scraper.utils import extract_interview_date
            interview_dt = extract_interview_date(text, language='ja')
            if interview_dt:
                return interview_dt

            # Try parsing any date in the text
            parsed = parse_date(text, language='ja')
            if parsed:
                return parsed.datetime
        except Exception:
            pass

    # Fallback to manual patterns
    # Pattern: 2024年5月 or 2024/5 or 2024-05
    patterns = [
        (r'(\d{4})年(\d{1,2})月', lambda m: f"{m.group(1)}-{int(m.group(2)):02d}"),
        (r'(\d{4})/(\d{1,2})', lambda m: f"{m.group(1)}-{int(m.group(2)):02d}"),
        (r'(\d{4})-(\d{1,2})', lambda m: f"{m.group(1)}-{int(m.group(2)):02d}"),
    ]

    for pattern, formatter in patterns:
        match = re.search(pattern, text)
        if match:
            try:
                date_str = formatter(match)
                return datetime.strptime(f"{date_str}-01", "%Y-%m-%d")
            except ValueError:
                continue

    # Try Japanese era dates (令和6年 = 2024)
    era_pattern = re.compile(r"(令和|平成|昭和)(\d{1,2})年(\d{1,2})?月?")
    era_match = era_pattern.search(text)
    if era_match:
        era, era_year, month = era_match.groups()
        era_year = int(era_year)
        month = int(month) if month else 1
        try:
            if era == "令和":
                year = 2018 + era_year  # 令和1年 = 2019
            elif era == "平成":
                year = 1988 + era_year  # 平成1年 = 1989
            elif era == "昭和":
                year = 1925 + era_year  # 昭和1年 = 1926
            else:
                year = 2020
            return datetime(year, month, 1)
        except ValueError:
            pass

    return None


def fetch_company_interview_page(company_id: str, page: int = 1) -> Optional[str]:
    """Fetch interview page HTML for a company.

    Note: Full content requires authentication. This fetches public preview.
    Uses Japan-specific proxy and StealthSession for anti-detection.

    Args:
        company_id: OpenWork company ID (e.g., "a0910000000abc")
        page: Page number for pagination

    Returns:
        HTML content or None if fetch fails
    """
    url = f"{BASE_URL}/company/{company_id}{INTERVIEW_SECTION}"
    if page > 1:
        url += f"?page={page}"

    # Use infrastructure if available
    if INFRA_AVAILABLE:
        # Check cache first
        cache = get_cache()
        cache_key = f"openwork:{company_id}:{page}"
        cached = cache.get(cache_key)
        if cached:
            return cached.get('html')

        # Use StealthSession for anti-detection
        stealth = create_stealth_session(min_delay=1.0, max_delay=3.0)
        config = stealth.get_request_config(url)
        headers = config.get('headers', {})
        headers["Accept"] = "text/html,application/xhtml+xml"
        headers["Accept-Language"] = "ja,en;q=0.9"

        # OpenWork REQUIRES Japan proxy - it blocks non-JP IPs
        proxy = get_proxy_for_url(url)
        proxies = {"http": proxy, "https": proxy} if proxy else None

        # Rate limit check
        if not stealth.before_request():
            return None

        try:
            response = requests.get(
                url, headers=headers, timeout=REQUEST_TIMEOUT,
                proxies=proxies
            )
            response.raise_for_status()
            html = response.text
            stealth.after_request(response.status_code)

            # Cache the response
            cache.set(cache_key, {'html': html}, ttl=3600)
            return html
        except requests.RequestException as e:
            print(f"Error fetching OpenWork page for {company_id}: {e}")
            stealth.after_request(500)
            return None
    else:
        # Fallback without infrastructure
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ja,en;q=0.9",
        }

        try:
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            print(f"Error fetching OpenWork page for {company_id}: {e}")
            return None


def search_companies(query: str) -> list[dict]:
    """Search for companies on OpenWork.

    Args:
        query: Company name to search (Japanese or English)

    Returns:
        List of company dicts with id, name, and interview_count
    """
    # Note: This would require parsing the search results page
    # For now, return empty as search requires form submission
    print(f"OpenWork search not implemented - use direct company IDs")
    return []


def parse_public_interview_preview(html: str, company_name: str) -> list[InterviewQuestion]:
    """Parse publicly accessible interview preview data.

    OpenWork shows limited preview of interviews without login:
    - Interview count and difficulty stats
    - Partial question previews (truncated)
    - General process description

    Full content requires authentication.

    Args:
        html: Raw HTML from company interview page
        company_name: Company name for the questions

    Returns:
        List of InterviewQuestion objects (limited data)
    """
    questions = []
    translator = get_translator()

    # Extract interview snippets (publicly visible previews)
    # Pattern matches the truncated preview text
    preview_pattern = re.compile(
        r'<div[^>]*class="[^"]*interview[^"]*"[^>]*>([^<]+(?:<[^>]+>[^<]+)*)</div>',
        re.IGNORECASE | re.DOTALL
    )

    # Also look for structured data in JSON-LD
    json_ld_pattern = re.compile(
        r'<script[^>]*type="application/ld\+json"[^>]*>([^<]+)</script>',
        re.IGNORECASE
    )

    # Extract visible text sections
    text_sections = preview_pattern.findall(html)

    for i, section in enumerate(text_sections):
        cleaned = clean_html(section)
        if len(cleaned) < 20:
            continue

        # Extract any questions from this section
        extracted_questions = extract_questions_from_text(cleaned)

        for q_text in extracted_questions:
            # Translate if possible
            translated = translate_text(q_text, translator)

            question = InterviewQuestion(
                id=generate_question_id(company_name, q_text, "openwork"),
                question_text=translated,
                question_type=parse_question_type(q_text),
                difficulty=parse_difficulty(cleaned),
                company=translate_text(company_name, translator),
                role=None,  # Not always available in preview
                topics=[],
                source="openwork",
                source_url=BASE_URL,
                interview_date=parse_interview_date(cleaned),
                scraped_at=datetime.utcnow(),
                answer_hint=None,
                upvotes=0,
            )
            questions.append(question)

    return questions


def scrape_openwork(
    company_ids: Optional[List[str]] = None,
    months_back: int = 5,
    max_per_company: int = 50,
) -> List[InterviewQuestion]:
    """Scrape interview questions from OpenWork Japan.

    Uses production-grade infrastructure:
    - GeoProxySelector for Japan-specific proxies (REQUIRED - OpenWork blocks non-JP IPs)
    - UniversalDateParser for Japanese era dates (令和, 平成)
    - ResponseCache for efficient caching
    - StealthSession for anti-detection
    - Monitoring and error handling

    Note: OpenWork requires registration for full content access.
    This scraper fetches publicly available preview data.

    For full access:
    1. Register at https://www.openwork.jp/registration
    2. Contribute one review to unlock full access (free model)
    3. Use authenticated session cookies

    Args:
        company_ids: Optional list of OpenWork company IDs to scrape.
                    If None, uses default list of major tech companies.
        months_back: Only include interviews from last N months (default 5)
        max_per_company: Maximum questions per company (default 50)

    Returns:
        List of InterviewQuestion objects
    """
    # Default major Japanese tech company IDs on OpenWork
    # These are example IDs - actual IDs would need to be looked up
    default_companies = {
        # Format: "company_id": "company_name"
        "a0910000000YM4d": "メルカリ (Mercari)",
        "a0910000000Rfhi": "楽天 (Rakuten)",
        "a0910000000IB9y": "LINE",
        "a0910000000JqZi": "サイバーエージェント (CyberAgent)",
        "a0910000000Fhqe": "ヤフー (Yahoo Japan)",
        "a0910000000L9Qi": "DeNA",
        "a0910000000GRKA": "リクルート (Recruit)",
        "a0910000000N7bm": "SmartNews",
        "a0910000000OPVC": "freee",
        "a0910000000Qwer": "Money Forward",
    }

    all_questions = []
    cutoff_date = datetime.utcnow() - timedelta(days=months_back * 30)

    companies_to_scrape = company_ids if company_ids else list(default_companies.keys())

    # Use monitoring if available
    if INFRA_AVAILABLE:
        with monitor_scraper('openwork') as ctx:
            for company_id in companies_to_scrape:
                company_name = default_companies.get(company_id, company_id)
                print(f"Scraping OpenWork interviews for: {company_name}")

                # Fetch interview page
                html = fetch_company_interview_page(company_id)
                if not html:
                    print(f"  Failed to fetch page for {company_name}")
                    continue

                # Parse questions from public preview
                questions = parse_public_interview_preview(html, company_name)

                # Filter by date and limit
                filtered = []
                for q in questions:
                    # Use is_within_months if available
                    if INFRA_AVAILABLE and q.interview_date:
                        if not is_within_months(q.interview_date, months_back):
                            continue
                    elif q.interview_date and q.interview_date < cutoff_date:
                        continue
                    filtered.append(q)
                    if len(filtered) >= max_per_company:
                        break

                print(f"  Found {len(filtered)} interview questions (public preview)")
                all_questions.extend(filtered)

                # Record metrics
                ctx.record_questions(
                    extracted=len(questions),
                    new=len(filtered),
                    duplicate=0
                )
    else:
        # Fallback without monitoring
        for company_id in companies_to_scrape:
            company_name = default_companies.get(company_id, company_id)
            print(f"Scraping OpenWork interviews for: {company_name}")

            # Fetch interview page
            html = fetch_company_interview_page(company_id)
            if not html:
                print(f"  Failed to fetch page for {company_name}")
                continue

            # Parse questions from public preview
            questions = parse_public_interview_preview(html, company_name)

            # Filter by date and limit
            filtered = []
            for q in questions:
                if q.interview_date and q.interview_date < cutoff_date:
                    continue
                filtered.append(q)
                if len(filtered) >= max_per_company:
                    break

            print(f"  Found {len(filtered)} interview questions (public preview)")
            all_questions.extend(filtered)

    print(f"\nTotal OpenWork questions: {len(all_questions)}")
    print("Note: Full interview content requires OpenWork registration")
    if INFRA_AVAILABLE:
        print("Note: Using Japan proxy for geo-restricted access")

    return all_questions


# Example authenticated scraping (requires session cookies)
def scrape_openwork_authenticated(
    session_cookies: dict,
    company_ids: list[str],
    months_back: int = 5,
) -> list[InterviewQuestion]:
    """Scrape full interview content with authenticated session.

    Requires valid OpenWork session cookies obtained after login.

    Args:
        session_cookies: Dict of cookies from authenticated session
                        Required keys: _openwork_session, remember_token
        company_ids: List of company IDs to scrape
        months_back: Only include interviews from last N months

    Returns:
        List of InterviewQuestion objects with full content
    """
    # This would implement authenticated scraping
    # Not implemented here due to ToS considerations
    raise NotImplementedError(
        "Authenticated scraping requires valid session cookies. "
        "Obtain cookies by logging into OpenWork and export from browser. "
        "Be mindful of OpenWork's Terms of Service regarding automated access."
    )


# Main entry point for testing
if __name__ == "__main__":
    questions = scrape_openwork(months_back=5)
    for q in questions[:5]:
        print(f"\nCompany: {q.company}")
        print(f"Question: {q.question_text}")
        print(f"Type: {q.question_type.value}")
        print(f"Source: {q.source}")
