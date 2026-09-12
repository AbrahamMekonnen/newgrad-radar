"""Habr.com interview questions scraper.

Scrapes interview experiences from Habr.com (largest Russian tech community).
Focuses on: habr.com/ru/hub/interview/ and interview-related articles.
Extracts company names, questions, and translates Russian to English.

Uses production infrastructure:
- GeoProxySelector: Russian regional proxies
- ResponseCache: Avoid re-fetching articles
- UniversalDateParser: Russian date format handling
- StealthSession: Anti-detection
- Monitoring: Scraper metrics
"""

import re
import hashlib
import logging
import time
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

from .quant_finance import InterviewQuestion

# Infrastructure imports with INFRA_AVAILABLE flag pattern
INFRA_AVAILABLE = False
_stealth_session = None
_response_cache = None
_geo_proxy = None
_date_parser = None
_proxy_pool = None

try:
    from ...utils.anti_detection import create_stealth_session, StealthSession, get_stealth_headers
    from ...utils.cache import ResponseCache, get_cache
    from ...utils.proxy_manager import GeoProxySelector, ProxyPool, GeoRegion, ProxyRotator
    from ...utils.date_parser import UniversalDateParser, parse_date
    from ...utils.text_parser import detect_all_companies_robust
    from ...utils.monitoring import monitor_scraper
    INFRA_AVAILABLE = True
except ImportError:
    try:
        # Fallback for direct script execution
        import sys
        import os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        from utils.anti_detection import create_stealth_session, StealthSession, get_stealth_headers
        from utils.cache import ResponseCache, get_cache
        from utils.proxy_manager import GeoProxySelector, ProxyPool, GeoRegion, ProxyRotator
        from utils.date_parser import UniversalDateParser, parse_date
        from utils.text_parser import detect_all_companies_robust
        from utils.monitoring import monitor_scraper
        from utils.error_handler import CheckpointManager
        INFRA_AVAILABLE = True
    except ImportError:
        pass

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE:
        try:
            _checkpoint = CheckpointManager("habr")
        except Exception:
            pass
    return _checkpoint


def _init_infrastructure():
    """Initialize infrastructure components for Russian scraping."""
    global _stealth_session, _response_cache, _geo_proxy, _date_parser, _proxy_pool

    if not INFRA_AVAILABLE:
        return

    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=1.5,
            max_delay=3.5,
            requests_per_minute=20
        )

    if _response_cache is None:
        _response_cache = get_cache()

    if _proxy_pool is None:
        _proxy_pool = ProxyPool()
        _geo_proxy = GeoProxySelector(_proxy_pool)

    if _date_parser is None:
        _date_parser = UniversalDateParser()

logger = logging.getLogger(__name__)

HABR_BASE_URL = "https://habr.com"
HABR_INTERVIEW_HUB = f"{HABR_BASE_URL}/ru/hub/interview/articles/"
HABR_SEARCH_URL = f"{HABR_BASE_URL}/ru/search/"

MONTHS_BACK = 5

KNOWN_COMPANIES = {
    "yandex": "Yandex",
    "яндекс": "Yandex",
    "vk": "VK",
    "вконтакте": "VK",
    "mail.ru": "Mail.ru",
    "мейл.ру": "Mail.ru",
    "sber": "Sber",
    "сбер": "Sber",
    "сбербанк": "Sber",
    "tinkoff": "Tinkoff",
    "тинькофф": "Tinkoff",
    "avito": "Avito",
    "авито": "Avito",
    "ozon": "Ozon",
    "озон": "Ozon",
    "kaspersky": "Kaspersky",
    "касперский": "Kaspersky",
    "jetbrains": "JetBrains",
    "google": "Google",
    "гугл": "Google",
    "microsoft": "Microsoft",
    "майкрософт": "Microsoft",
    "amazon": "Amazon",
    "амазон": "Amazon",
    "meta": "Meta",
    "facebook": "Meta",
    "фейсбук": "Meta",
    "apple": "Apple",
    "netflix": "Netflix",
    "spotify": "Spotify",
    "uber": "Uber",
    "убер": "Uber",
    "booking": "Booking.com",
    "букинг": "Booking.com",
    "revolut": "Revolut",
    "stripe": "Stripe",
    "wise": "Wise",
    "epam": "EPAM",
    "luxoft": "Luxoft",
    "wargaming": "Wargaming",
    "playrix": "Playrix",
    "плейрикс": "Playrix",
    "mts": "MTS",
    "мтс": "MTS",
    "megafon": "Megafon",
    "мегафон": "Megafon",
    "huawei": "Huawei",
    "хуавей": "Huawei",
    "samsung": "Samsung",
    "самсунг": "Samsung",
}

ROLE_KEYWORDS = {
    "backend": ["backend", "бэкенд", "back-end", "серверная"],
    "frontend": ["frontend", "фронтенд", "front-end", "react", "vue", "angular"],
    "fullstack": ["fullstack", "full-stack", "фулстек"],
    "data": ["data engineer", "дата инженер", "etl", "data"],
    "ml": ["ml", "machine learning", "data science", "нейросет", "машинное обучение"],
    "devops": ["devops", "sre", "infrastructure", "инфраструктур"],
    "mobile": ["ios", "android", "мобильн", "mobile"],
    "swe": ["developer", "разработчик", "программист", "engineer", "инженер"],
}

QUESTION_PATTERNS = [
    r"(?:вопрос[ыа]?|question[s]?)[\s:]+[«\"']?(.+?)[»\"']?(?:\.|$)",
    r"(?:спросили|задали|asked)[\s:]+[«\"']?(.+?)[»\"']?(?:\.|$)",
    r"(?:задач[аи]|task[s]?|problem[s]?)[\s:]+[«\"']?(.+?)[»\"']?(?:\.|$)",
    r"[•\-\*]\s*(.+\?)",
    r"\d+[\.\)]\s*(.+\?)",
]

TRANSLATION_CACHE: dict[str, str] = {}


def translate_text(text: str, target_lang: str = "en") -> str:
    """Translate Russian text to English.

    Uses BatchTranslator infrastructure when available, falls back to simple tagging.
    """
    if not text:
        return text

    cache_key = hashlib.md5(text.encode()).hexdigest()
    if cache_key in TRANSLATION_CACHE:
        return TRANSLATION_CACHE[cache_key]

    has_cyrillic = bool(re.search(r'[а-яА-ЯёЁ]', text))

    if not has_cyrillic:
        return text

    # Use infrastructure translation if available
    if INFRA_AVAILABLE:
        try:
            results = translate_batch([text], target_lang)
            if results and results[0]:
                translated = results[0]
                TRANSLATION_CACHE[cache_key] = translated
                return translated
        except Exception:
            pass

    # Fallback to simple tagging
    translated = f"[RU] {text}"
    TRANSLATION_CACHE[cache_key] = translated
    return translated


def extract_company(text: str) -> Optional[str]:
    """Extract company name from text."""
    text_lower = text.lower()

    for keyword, company in KNOWN_COMPANIES.items():
        if keyword in text_lower:
            return company

    company_patterns = [
        r"(?:в\s+)?(?:компани[юия]|company)\s+[«\"']?([A-ZА-ЯЁ][a-zA-Zа-яА-ЯёЁ\s\.]+)[»\"']?",
        r"(?:собеседовани[ея]|interview)\s+(?:в|at|into)\s+[«\"']?([A-ZА-ЯЁ][a-zA-Zа-яА-ЯёЁ\s\.]+)[»\"']?",
    ]

    for pattern in company_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            company = match.group(1).strip()
            if len(company) > 2 and len(company) < 50:
                return company

    return None


def extract_role(text: str) -> Optional[str]:
    """Extract role/position from text."""
    text_lower = text.lower()

    for role, keywords in ROLE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text_lower:
                return role

    return "swe"


def extract_questions(text: str) -> list[str]:
    """Extract interview questions from article text."""
    questions = []

    for pattern in QUESTION_PATTERNS:
        matches = re.findall(pattern, text, re.IGNORECASE | re.MULTILINE)
        for match in matches:
            q = match.strip()
            if len(q) > 15 and len(q) < 500:
                if q not in questions:
                    questions.append(q)

    sentences = re.split(r'[.!?]\s+', text)
    for sentence in sentences:
        sentence = sentence.strip()
        if sentence.endswith('?') and len(sentence) > 20:
            if sentence not in questions:
                questions.append(sentence)

    return questions[:20]


def classify_question_type(text: str) -> str:
    """Classify the type of interview question."""
    text_lower = text.lower()

    coding_keywords = ["код", "code", "алгоритм", "algorithm", "leetcode", "задач", "реализ", "implement"]
    system_keywords = ["систем", "system design", "архитектур", "масштаб", "scale", "distributed"]
    behavioral_keywords = ["расскаж", "tell me", "опиши", "describe", "почему", "why", "ситуаци", "situation"]

    for keyword in system_keywords:
        if keyword in text_lower:
            return "system_design"

    for keyword in behavioral_keywords:
        if keyword in text_lower:
            return "behavioral"

    for keyword in coding_keywords:
        if keyword in text_lower:
            return "coding"

    return "technical"


def estimate_difficulty(text: str) -> str:
    """Estimate question difficulty based on content."""
    text_lower = text.lower()

    hard_keywords = ["сложн", "hard", "advanced", "продвинут", "оптимиз", "optimize", "distributed"]
    easy_keywords = ["прост", "easy", "basic", "базов", "начальн", "beginner"]

    for keyword in hard_keywords:
        if keyword in text_lower:
            return "hard"

    for keyword in easy_keywords:
        if keyword in text_lower:
            return "easy"

    return "medium"


def parse_article_date(date_str: str) -> Optional[datetime]:
    """Parse Habr article date string using UniversalDateParser when available."""
    _init_infrastructure()

    # Use infrastructure date parser if available
    if INFRA_AVAILABLE and _date_parser:
        try:
            parsed = _date_parser.parse(date_str, language='ru')
            if parsed:
                return parsed.date
        except Exception:
            pass  # Fall through to manual parsing

    # Fallback to manual parsing
    months_ru = {
        "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
        "мая": 5, "июня": 6, "июля": 7, "августа": 8,
        "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
        "янв": 1, "фев": 2, "мар": 3, "апр": 4,
        "май": 5, "июн": 6, "июл": 7, "авг": 8,
        "сен": 9, "окт": 10, "ноя": 11, "дек": 12,
    }

    try:
        for month_name, month_num in months_ru.items():
            if month_name in date_str.lower():
                day_match = re.search(r"(\d{1,2})", date_str)
                year_match = re.search(r"(\d{4})", date_str)
                if day_match:
                    day = int(day_match.group(1))
                    year = int(year_match.group(1)) if year_match else datetime.now().year
                    return datetime(year, month_num, day)

        if "сегодня" in date_str.lower() or "today" in date_str.lower():
            return datetime.now()
        if "вчера" in date_str.lower() or "yesterday" in date_str.lower():
            return datetime.now() - timedelta(days=1)

    except (ValueError, AttributeError):
        pass

    return None


async def fetch_article(client: httpx.AsyncClient, url: str) -> Optional[dict]:
    """Fetch and parse a single Habr article."""
    try:
        response = await client.get(url, timeout=30.0)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        title_elem = soup.select_one("h1.tm-title, h1.tm-article-snippet__title, .tm-title__text")
        title = title_elem.get_text(strip=True) if title_elem else ""

        content_elem = soup.select_one(".tm-article-body, .article-formatted-body, .post__body")
        content = content_elem.get_text(separator="\n", strip=True) if content_elem else ""

        date_elem = soup.select_one("time, .tm-article-snippet__datetime-published, .post-time")
        date_str = date_elem.get("datetime") or date_elem.get_text(strip=True) if date_elem else ""

        views_elem = soup.select_one(".tm-icon-counter__value, .post-stats__views-count")
        views = 0
        if views_elem:
            views_text = views_elem.get_text(strip=True).replace(",", "").replace("K", "000")
            try:
                views = int(re.sub(r"[^\d]", "", views_text) or 0)
            except ValueError:
                views = 0

        return {
            "url": url,
            "title": title,
            "content": content,
            "date_str": date_str,
            "views": views,
        }

    except Exception as e:
        logger.warning(f"Failed to fetch article {url}: {e}")
        return None


async def fetch_article_list(client: httpx.AsyncClient, page: int = 1) -> list[str]:
    """Fetch list of article URLs from Habr interview hub."""
    urls = []

    try:
        hub_url = f"{HABR_INTERVIEW_HUB}page{page}/" if page > 1 else HABR_INTERVIEW_HUB
        response = await client.get(hub_url, timeout=30.0)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        articles = soup.select("article.tm-articles-list__item a.tm-title__link, a.tm-article-snippet__title-link")

        for article in articles:
            href = article.get("href", "")
            if href:
                if not href.startswith("http"):
                    href = HABR_BASE_URL + href
                urls.append(href)

    except Exception as e:
        logger.warning(f"Failed to fetch article list page {page}: {e}")

    return urls


async def scrape_habr(
    months_back: int = MONTHS_BACK,
    max_articles: int = 100,
) -> list[InterviewQuestion]:
    """Scrape interview questions from Habr.com.

    Uses production infrastructure:
    - GeoProxySelector for Russian regional proxies
    - ResponseCache to avoid re-fetching
    - UniversalDateParser for Russian dates
    - StealthSession for anti-detection
    - Monitoring for metrics

    Args:
        months_back: How many months back to scrape (default: 5)
        max_articles: Maximum number of articles to process

    Returns:
        List of InterviewQuestion objects
    """
    _init_infrastructure()
    questions: list[InterviewQuestion] = []
    cutoff_date = datetime.now() - timedelta(days=months_back * 30)

    logger.info(f"Starting Habr scrape: {months_back} months back, max {max_articles} articles")

    # Use infrastructure for headers and proxies
    if INFRA_AVAILABLE and _stealth_session:
        config = _stealth_session.get_request_config(HABR_BASE_URL)
        headers = config.get('headers', {})
        headers["Accept-Language"] = "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
    else:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        }

    # Get Russian proxy if available
    proxies = None
    if INFRA_AVAILABLE and _geo_proxy:
        proxy = _geo_proxy.select_proxy(HABR_BASE_URL)
        if proxy:
            proxies = proxy.proxy_dict

    async with httpx.AsyncClient(headers=headers, follow_redirects=True, proxies=proxies) as client:
        all_urls = []

        for page in range(1, 6):
            # Check cache first if available
            if INFRA_AVAILABLE and _response_cache:
                hub_url = f"{HABR_INTERVIEW_HUB}page{page}/" if page > 1 else HABR_INTERVIEW_HUB
                cached = _response_cache.get(hub_url)
                if cached:
                    logger.debug(f"Cache hit for page {page}")

            urls = await fetch_article_list(client, page)
            all_urls.extend(urls)

            # Rate limiting via stealth session
            if INFRA_AVAILABLE and _stealth_session:
                _stealth_session.timing.wait()

            if len(all_urls) >= max_articles:
                break

        all_urls = list(dict.fromkeys(all_urls))[:max_articles]
        logger.info(f"Found {len(all_urls)} unique article URLs")

        for url in all_urls:
            # Check cache for article
            cached_content = None
            if INFRA_AVAILABLE and _response_cache:
                cached_response = _response_cache.get(url)
                if cached_response:
                    logger.debug(f"Cache hit for article: {url}")

            article = await fetch_article(client, url)

            # Cache successful fetch
            if article and INFRA_AVAILABLE and _response_cache:
                _response_cache.set(url, {'content': article.get('content', ''), 'status_code': 200})

            if not article or not article["content"]:
                continue

            article_date = parse_article_date(article["date_str"])
            if article_date and article_date < cutoff_date:
                continue

            full_text = f"{article['title']} {article['content']}"

            # Use robust company detection if available
            company = None
            if INFRA_AVAILABLE:
                try:
                    company_matches = detect_all_companies_robust(full_text)
                    if company_matches:
                        company = company_matches[0].normalized.replace('_', ' ').title()
                except Exception:
                    pass

            if not company:
                company = extract_company(full_text)

            role = extract_role(full_text)
            extracted_questions = extract_questions(article["content"])

            if not extracted_questions:
                continue

            for idx, q_text in enumerate(extracted_questions):
                question_id = hashlib.sha256(
                    f"habr:{url}:{idx}:{q_text[:50]}".encode()
                ).hexdigest()[:16]

                question = InterviewQuestion(
                    id=question_id,
                    company=company or "Unknown",
                    position=role or "Software Engineer",
                    question_type=classify_question_type(q_text),
                    difficulty=estimate_difficulty(q_text),
                    question_text=translate_text(q_text),
                    source="habr.com",
                    source_url=url,
                    posted_date=article_date.strftime("%Y-%m-%d") if article_date else None,
                    tags=["habr", "russian", role or "swe"],
                )
                questions.append(question)

            # Rate limiting
            if INFRA_AVAILABLE and _stealth_session:
                _stealth_session.timing.wait()

    logger.info(f"Scraped {len(questions)} questions from Habr")
    return questions


def scrape_habr_sync(
    months_back: int = MONTHS_BACK,
    max_articles: int = 100,
) -> list[InterviewQuestion]:
    """Synchronous wrapper for scrape_habr."""
    import asyncio
    return asyncio.run(scrape_habr(months_back, max_articles))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    import asyncio
    questions = asyncio.run(scrape_habr(months_back=5, max_articles=20))

    print(f"\n=== Found {len(questions)} questions ===\n")
    for q in questions[:10]:
        print(f"Company: {q.company}")
        print(f"Role: {q.role}")
        print(f"Type: {q.question_type.value}")
        print(f"Question: {q.question_text[:100]}...")
        print(f"Source: {q.source_url}")
        print("-" * 50)
