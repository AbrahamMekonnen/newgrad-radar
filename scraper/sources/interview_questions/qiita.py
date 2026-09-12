"""Qiita (Japan) interview experience scraper.

Fetches interview experiences from Qiita.com, Japan's largest developer knowledge platform.
Searches for articles tagged with interview-related terms and extracts questions.

Tags used:
- 面接 (interview)
- 転職 (job change)
- 技術面接 (technical interview)
- 就活 (job hunting)
- コーディングテスト (coding test)

API docs: https://qiita.com/api/v2/docs

UPGRADED: Uses production-grade infrastructure:
- GeoProxySelector for Japan-specific proxies
- UniversalDateParser for Japanese era dates (令和)
- ResponseCache for efficient caching
- StealthSession for anti-detection
- Monitoring and error handling
"""

import re
import hashlib
import requests
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from html import unescape

from .quant_finance import InterviewQuestion

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
            _checkpoint = CheckpointManager("qiita")
        except Exception:
            pass
    return _checkpoint


def detect_all_companies_robust(text: str):
    """Fallback if not imported."""
    return []


# Qiita API endpoint
QIITA_API_URL = "https://qiita.com/api/v2"

# Japanese company names to English mapping (major tech companies)
COMPANY_TRANSLATIONS = {
    "グーグル": "Google",
    "アマゾン": "Amazon",
    "マイクロソフト": "Microsoft",
    "メタ": "Meta",
    "フェイスブック": "Facebook",
    "アップル": "Apple",
    "楽天": "Rakuten",
    "メルカリ": "Mercari",
    "サイバーエージェント": "CyberAgent",
    "ヤフー": "Yahoo Japan",
    "リクルート": "Recruit",
    "ディー・エヌ・エー": "DeNA",
    "DeNA": "DeNA",
    "LINE": "LINE",
    "ソフトバンク": "SoftBank",
    "富士通": "Fujitsu",
    "日立": "Hitachi",
    "ソニー": "Sony",
    "任天堂": "Nintendo",
    "パナソニック": "Panasonic",
    "トヨタ": "Toyota",
    "ホンダ": "Honda",
    "NTT": "NTT",
    "NTTデータ": "NTT Data",
    "KDDI": "KDDI",
    "ドコモ": "NTT Docomo",
    "三菱": "Mitsubishi",
    "住友": "Sumitomo",
    "伊藤忠": "Itochu",
    "楽天グループ": "Rakuten Group",
    "クックパッド": "Cookpad",
    "スマートニュース": "SmartNews",
    "Preferred Networks": "Preferred Networks",
    "PFN": "Preferred Networks",
    "freee": "freee",
    "マネーフォワード": "Money Forward",
    "Sansan": "Sansan",
    "ラクスル": "Raksul",
    "ビズリーチ": "BizReach",
    "ウォンテッドリー": "Wantedly",
}

# English company names pattern
ENGLISH_COMPANY_PATTERN = re.compile(
    r"\b(Google|Amazon|Microsoft|Meta|Facebook|Apple|Netflix|Uber|Airbnb|Stripe|"
    r"Spotify|Twitter|LinkedIn|Salesforce|Oracle|IBM|Intel|Adobe|Nvidia|Tesla|"
    r"Mercari|Rakuten|LINE|DeNA|CyberAgent|Yahoo|Recruit|SmartNews|PayPay|"
    r"Indeed|Wantedly|freee|Money Forward|Sansan)\b",
    re.IGNORECASE
)

# Role patterns (Japanese and English)
ROLE_PATTERNS = {
    "swe": [
        re.compile(r"ソフトウェアエンジニア", re.IGNORECASE),
        re.compile(r"software engineer", re.IGNORECASE),
        re.compile(r"SWE", re.IGNORECASE),
        re.compile(r"エンジニア", re.IGNORECASE),
    ],
    "backend": [
        re.compile(r"バックエンド", re.IGNORECASE),
        re.compile(r"サーバーサイド", re.IGNORECASE),
        re.compile(r"backend", re.IGNORECASE),
        re.compile(r"server[\-\s]?side", re.IGNORECASE),
    ],
    "frontend": [
        re.compile(r"フロントエンド", re.IGNORECASE),
        re.compile(r"frontend", re.IGNORECASE),
        re.compile(r"front[\-\s]?end", re.IGNORECASE),
    ],
    "ml": [
        re.compile(r"機械学習", re.IGNORECASE),
        re.compile(r"machine learning", re.IGNORECASE),
        re.compile(r"ML", re.IGNORECASE),
        re.compile(r"AI", re.IGNORECASE),
        re.compile(r"人工知能", re.IGNORECASE),
    ],
    "data": [
        re.compile(r"データエンジニア", re.IGNORECASE),
        re.compile(r"data engineer", re.IGNORECASE),
        re.compile(r"データサイエンティスト", re.IGNORECASE),
        re.compile(r"data scientist", re.IGNORECASE),
    ],
    "mobile": [
        re.compile(r"iOS", re.IGNORECASE),
        re.compile(r"Android", re.IGNORECASE),
        re.compile(r"モバイル", re.IGNORECASE),
        re.compile(r"mobile", re.IGNORECASE),
    ],
    "infra": [
        re.compile(r"インフラ", re.IGNORECASE),
        re.compile(r"infrastructure", re.IGNORECASE),
        re.compile(r"SRE", re.IGNORECASE),
        re.compile(r"DevOps", re.IGNORECASE),
    ],
}

# Question type indicators (string values matching quant_finance.py)
QUESTION_TYPE_PATTERNS = {
    "coding": [
        re.compile(r"コーディング", re.IGNORECASE),
        re.compile(r"coding", re.IGNORECASE),
        re.compile(r"アルゴリズム", re.IGNORECASE),
        re.compile(r"algorithm", re.IGNORECASE),
        re.compile(r"LeetCode", re.IGNORECASE),
        re.compile(r"AtCoder", re.IGNORECASE),
    ],
    "system_design": [
        re.compile(r"システム設計", re.IGNORECASE),
        re.compile(r"system design", re.IGNORECASE),
        re.compile(r"アーキテクチャ", re.IGNORECASE),
        re.compile(r"architecture", re.IGNORECASE),
        re.compile(r"設計面接", re.IGNORECASE),
    ],
    "behavioral": [
        re.compile(r"行動面接", re.IGNORECASE),
        re.compile(r"behavioral", re.IGNORECASE),
        re.compile(r"人物面接", re.IGNORECASE),
        re.compile(r"カルチャーフィット", re.IGNORECASE),
        re.compile(r"culture fit", re.IGNORECASE),
    ],
    "technical": [
        re.compile(r"技術面接", re.IGNORECASE),
        re.compile(r"technical", re.IGNORECASE),
        re.compile(r"テクニカル", re.IGNORECASE),
    ],
    "online_assessment": [
        re.compile(r"オンラインテスト", re.IGNORECASE),
        re.compile(r"online assessment", re.IGNORECASE),
        re.compile(r"OA", re.IGNORECASE),
        re.compile(r"適性検査", re.IGNORECASE),
        re.compile(r"SPI", re.IGNORECASE),
    ],
}

# Difficulty indicators (string values)
DIFFICULTY_PATTERNS = {
    "easy": [
        re.compile(r"簡単", re.IGNORECASE),
        re.compile(r"easy", re.IGNORECASE),
        re.compile(r"基本", re.IGNORECASE),
    ],
    "medium": [
        re.compile(r"中級", re.IGNORECASE),
        re.compile(r"medium", re.IGNORECASE),
        re.compile(r"普通", re.IGNORECASE),
    ],
    "hard": [
        re.compile(r"難しい", re.IGNORECASE),
        re.compile(r"hard", re.IGNORECASE),
        re.compile(r"高難度", re.IGNORECASE),
        re.compile(r"難問", re.IGNORECASE),
    ],
}

# Question extraction patterns (Japanese interview question formats)
QUESTION_PATTERNS = [
    # "Q: ..." or "Q. ..." format
    re.compile(r"Q[:.：]\s*(.+?)(?=\n|$)", re.MULTILINE),
    # "問題: ..." format
    re.compile(r"問題[：:]\s*(.+?)(?=\n|$)", re.MULTILINE),
    # "質問: ..." format
    re.compile(r"質問[：:]\s*(.+?)(?=\n|$)", re.MULTILINE),
    # Numbered questions "1. ..." in question sections
    re.compile(r"^\d+\.\s*(.+?)(?=\n|$)", re.MULTILINE),
    # "- " bullet points that look like questions
    re.compile(r"^[\-\*]\s*(.+\?)\s*$", re.MULTILINE),
    # English question format
    re.compile(r"Question[：:]\s*(.+?)(?=\n|$)", re.IGNORECASE | re.MULTILINE),
]


def generate_question_id(source: str, text: str) -> str:
    """Generate unique ID for a question."""
    content = f"{source}:{text[:100]}"
    return hashlib.md5(content.encode()).hexdigest()[:16]


def translate_company_name(name: str) -> str:
    """Translate Japanese company name to English if known."""
    # Check direct translation
    if name in COMPANY_TRANSLATIONS:
        return COMPANY_TRANSLATIONS[name]

    # Check if already English
    if re.match(r"^[A-Za-z0-9\s\.\-&]+$", name):
        return name

    # Return original if no translation available
    return name


def extract_companies(text: str) -> list[str]:
    """Extract company names from text (Japanese and English).

    Uses InternationalCompanyNER if available for better detection.
    """
    companies = []

    # Use robust company detection if available
    if INFRA_AVAILABLE:
        try:
            matches = detect_all_companies_robust(text)
            for match in matches:
                if match.canonical not in companies:
                    companies.append(match.canonical)
            if companies:
                return companies
        except Exception:
            pass

    # Fallback to manual detection
    # Check for Japanese company names
    for jp_name, en_name in COMPANY_TRANSLATIONS.items():
        if jp_name in text:
            if en_name not in companies:
                companies.append(en_name)

    # Check for English company names
    matches = ENGLISH_COMPANY_PATTERN.findall(text)
    for match in matches:
        # Normalize company name
        normalized = match.strip()
        if normalized and normalized not in companies:
            companies.append(normalized)

    return companies


def extract_role(text: str) -> Optional[str]:
    """Extract role type from text."""
    for role, patterns in ROLE_PATTERNS.items():
        for pattern in patterns:
            if pattern.search(text):
                return role
    return None


def determine_question_type(text: str) -> str:
    """Determine the type of interview question."""
    for qtype, patterns in QUESTION_TYPE_PATTERNS.items():
        for pattern in patterns:
            if pattern.search(text):
                return qtype
    return "technical"  # Default


def determine_difficulty(text: str) -> str:
    """Determine difficulty level from text."""
    for difficulty, patterns in DIFFICULTY_PATTERNS.items():
        for pattern in patterns:
            if pattern.search(text):
                return difficulty
    return "medium"  # Default


def extract_questions_from_article(body: str) -> list[str]:
    """Extract individual interview questions from article body."""
    questions = []

    for pattern in QUESTION_PATTERNS:
        matches = pattern.findall(body)
        for match in matches:
            question = match.strip()
            # Filter out too short or too long matches
            if 10 < len(question) < 500:
                # Avoid duplicates
                if question not in questions:
                    questions.append(question)

    return questions


def extract_topics(text: str) -> list[str]:
    """Extract technical topics mentioned in text."""
    topics = []

    # Common technical topics (English preserved, Japanese translated)
    topic_patterns = {
        "algorithms": [r"アルゴリズム", r"algorithm"],
        "data structures": [r"データ構造", r"data structure"],
        "system design": [r"システム設計", r"system design"],
        "databases": [r"データベース", r"database", r"SQL", r"NoSQL"],
        "networking": [r"ネットワーク", r"network", r"TCP", r"HTTP"],
        "concurrency": [r"並行処理", r"concurrent", r"スレッド", r"thread"],
        "distributed systems": [r"分散システム", r"distributed"],
        "machine learning": [r"機械学習", r"machine learning", r"ML"],
        "web development": [r"Web開発", r"web dev", r"フロントエンド", r"バックエンド"],
        "cloud": [r"クラウド", r"cloud", r"AWS", r"GCP", r"Azure"],
        "containers": [r"コンテナ", r"Docker", r"Kubernetes", r"K8s"],
        "security": [r"セキュリティ", r"security"],
    }

    text_lower = text.lower()
    for topic, patterns in topic_patterns.items():
        for p in patterns:
            if re.search(p, text, re.IGNORECASE):
                if topic not in topics:
                    topics.append(topic)
                break

    return topics


def parse_interview_date(text: str, article_date: str) -> Optional[datetime]:
    """Try to extract interview date from text, fallback to article date.

    Uses UniversalDateParser for Japanese era dates (令和, 平成, etc.)
    """
    if INFRA_AVAILABLE:
        # Use UniversalDateParser for comprehensive Japanese date parsing
        try:
            # First try to extract interview-specific date
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

    # Fallback to regex patterns
    # Try to find year/month patterns in Japanese
    # "2024年5月" format
    jp_date_pattern = re.compile(r"(\d{4})年(\d{1,2})月")
    match = jp_date_pattern.search(text)
    if match:
        try:
            year = int(match.group(1))
            month = int(match.group(2))
            return datetime(year, month, 1)
        except ValueError:
            pass

    # Try Japanese era dates (令和6年 = 2024)
    era_pattern = re.compile(r"(令和|平成|昭和)(\d{1,2})年(\d{1,2})月?")
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

    # Fallback to article creation date
    try:
        return datetime.fromisoformat(article_date.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def fetch_qiita_articles(tag: str, months: int = 5, page: int = 1, per_page: int = 100) -> list[dict]:
    """Fetch articles from Qiita API by tag.

    Args:
        tag: Tag to search for (e.g., '面接', '転職')
        months: Only fetch articles from last N months
        page: Page number (1-indexed)
        per_page: Results per page (max 100)

    Returns:
        List of article dicts
    """
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)

    url = f"{QIITA_API_URL}/tags/{tag}/items"
    params = {
        "page": page,
        "per_page": per_page,
    }

    # Use infrastructure if available
    if INFRA_AVAILABLE:
        # Use StealthSession for anti-detection
        stealth = create_stealth_session(min_delay=0.5, max_delay=2.0)
        config = stealth.get_request_config(url)
        headers = config.get('headers', {})
        headers["Accept"] = "application/json"

        # Get Japan-optimized proxy
        proxy = get_proxy_for_url(url)
        proxies = {"http": proxy, "https": proxy} if proxy else None

        # Check cache first
        cache = get_cache()
        cache_key = f"qiita:{tag}:{page}"
        cached = cache.get(cache_key)
        if cached:
            return cached.get('articles', [])

        # Rate limit check
        if not stealth.before_request():
            return []

        try:
            response = requests.get(
                url, params=params, headers=headers,
                timeout=30, proxies=proxies
            )
            response.raise_for_status()
            articles = response.json()
            stealth.after_request(response.status_code)

            # Cache the response
            cache.set(cache_key, {'articles': articles}, ttl=3600)
        except requests.RequestException as e:
            print(f"Error fetching Qiita tag '{tag}': {e}")
            stealth.after_request(500)
            return []
    else:
        # Fallback to basic requests
        headers = {
            "Accept": "application/json",
            "User-Agent": "NewGradRadar/1.0 (Interview Question Aggregator)",
        }
        try:
            response = requests.get(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            articles = response.json()
        except requests.RequestException as e:
            print(f"Error fetching Qiita tag '{tag}': {e}")
            return []
        except ValueError as e:
            print(f"Error parsing Qiita response: {e}")
            return []

    # Filter by date - use UniversalDateParser if available
    filtered = []
    for article in articles:
        created_at = article.get("created_at", "")
        try:
            if INFRA_AVAILABLE:
                # Use UniversalDateParser for proper date handling
                parsed = parse_date(created_at, language='ja')
                if parsed and is_within_months(parsed.datetime, months):
                    filtered.append(article)
            else:
                article_date = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                if article_date.replace(tzinfo=None) >= cutoff_date:
                    filtered.append(article)
        except (ValueError, AttributeError):
            continue

    return filtered


def parse_qiita_article(article: dict) -> list[InterviewQuestion]:
    """Parse a Qiita article into interview questions.

    Args:
        article: Raw article dict from Qiita API

    Returns:
        List of InterviewQuestion objects extracted from the article
    """
    questions = []

    title = article.get("title", "")
    body = article.get("body", "")
    url = article.get("url", "")
    created_at = article.get("created_at", "")
    tags = [t.get("name", "") for t in article.get("tags", [])]

    # Combine title and body for analysis
    full_text = f"{title}\n\n{body}"

    # Extract metadata
    companies = extract_companies(full_text)
    role = extract_role(full_text)
    topics = extract_topics(full_text)
    interview_date = parse_interview_date(full_text, created_at)

    # Extract individual questions from the article
    raw_questions = extract_questions_from_article(body)

    if not raw_questions:
        # If no specific questions found, treat the whole article as one question source
        # Create a summary question from the title
        if any(kw in title.lower() for kw in ["面接", "interview", "質問", "question"]):
            raw_questions = [title]

    # Create InterviewQuestion objects
    for q_text in raw_questions:
        q_type = determine_question_type(q_text)
        difficulty = determine_difficulty(q_text)

        # Create question for each company mentioned (or one with no company)
        target_companies = companies if companies else ["Unknown"]

        for company in target_companies:
            question = InterviewQuestion(
                id=generate_question_id(url, q_text + str(company)),
                company=company or "Unknown",
                position=role or "Software Engineer",
                question_type=q_type,
                difficulty=difficulty,
                question_text=q_text,
                source="qiita",
                source_url=url,
                posted_date=interview_date.isoformat() if interview_date else None,
                tags=topics + tags,
            )
            questions.append(question)

    return questions


def scrape_qiita(months: int = 5, max_pages: int = 3) -> list[InterviewQuestion]:
    """Scrape interview questions from Qiita.

    Uses production-grade infrastructure:
    - GeoProxySelector for Japan-specific proxies
    - ResponseCache for efficient caching
    - StealthSession for anti-detection
    - Monitoring and error handling

    Args:
        months: Only fetch articles from last N months (default 5)
        max_pages: Maximum pages to fetch per tag (default 3)

    Returns:
        List of InterviewQuestion objects
    """
    # Tags to search for interview content
    tags = [
        "面接",          # interview
        "転職",          # job change
        "技術面接",      # technical interview
        "就活",          # job hunting
        "コーディングテスト",  # coding test
        "採用",          # hiring
    ]

    all_questions = []
    seen_ids = set()

    print(f"Scraping Qiita interview questions (last {months} months)...")

    # Use monitoring if available
    if INFRA_AVAILABLE:
        with monitor_scraper('qiita') as ctx:
            for tag in tags:
                print(f"  Fetching tag: {tag}")

                for page in range(1, max_pages + 1):
                    articles = fetch_qiita_articles(tag, months=months, page=page)

                    if not articles:
                        break

                    print(f"    Page {page}: {len(articles)} articles")

                    for article in articles:
                        questions = parse_qiita_article(article)

                        new_count = 0
                        dup_count = 0
                        for q in questions:
                            if q.id not in seen_ids:
                                seen_ids.add(q.id)
                                all_questions.append(q)
                                new_count += 1
                            else:
                                dup_count += 1

                        ctx.record_questions(
                            extracted=len(questions),
                            new=new_count,
                            duplicate=dup_count
                        )
    else:
        # Fallback without monitoring
        for tag in tags:
            print(f"  Fetching tag: {tag}")

            for page in range(1, max_pages + 1):
                articles = fetch_qiita_articles(tag, months=months, page=page)

                if not articles:
                    break

                print(f"    Page {page}: {len(articles)} articles")

                for article in articles:
                    questions = parse_qiita_article(article)

                    for q in questions:
                        if q.id not in seen_ids:
                            seen_ids.add(q.id)
                            all_questions.append(q)

    print(f"Total unique questions from Qiita: {len(all_questions)}")
    return all_questions


def scrape_qiita_by_company(company: str, months: int = 5) -> list[InterviewQuestion]:
    """Scrape interview questions for a specific company.

    Args:
        company: Company name to search for
        months: Only fetch articles from last N months

    Returns:
        List of InterviewQuestion objects for that company
    """
    # Search both company name and common variations
    search_terms = [company]

    # Add Japanese translation if known
    for jp, en in COMPANY_TRANSLATIONS.items():
        if en.lower() == company.lower():
            search_terms.append(jp)
            break

    all_questions = []
    seen_ids = set()
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)

    for term in search_terms:
        # Use Qiita search API
        url = f"{QIITA_API_URL}/items"
        params = {
            "query": f"面接 {term}",  # "interview [company]"
            "per_page": 50,
        }

        headers = {
            "Accept": "application/json",
            "User-Agent": "NewGradRadar/1.0",
        }

        try:
            response = requests.get(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            articles = response.json()
        except requests.RequestException as e:
            print(f"Error searching Qiita for '{term}': {e}")
            continue

        for article in articles:
            created_at = article.get("created_at", "")
            try:
                article_date = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                if article_date.replace(tzinfo=None) < cutoff_date:
                    continue
            except (ValueError, AttributeError):
                continue

            questions = parse_qiita_article(article)

            # Filter to only questions mentioning this company
            for q in questions:
                if q.company and company.lower() in q.company.lower():
                    if q.id not in seen_ids:
                        seen_ids.add(q.id)
                        all_questions.append(q)

    return all_questions


if __name__ == "__main__":
    # Test the scraper
    questions = scrape_qiita(months=5, max_pages=2)

    print("\n--- Sample Questions ---")
    for q in questions[:10]:
        print(f"\nCompany: {q.company}")
        print(f"Role: {q.role}")
        print(f"Type: {q.question_type.value}")
        print(f"Question: {q.question_text[:100]}...")
        print(f"Topics: {', '.join(q.topics[:3])}")
        print(f"URL: {q.source_url}")
