"""DOU.ua Ukraine interview questions scraper.

DOU.ua is the largest Ukrainian IT community with excellent FAANG + EU company coverage.
Interview forum: https://dou.ua/forums/topic/interview/

Uses production infrastructure:
- ResponseCache: Avoid re-fetching forum pages
- GeoProxySelector: Regional proxy support (Ukraine/Russia region)
- UniversalDateParser: Ukrainian date format handling
- StealthSession: Anti-detection
- Monitoring: Scraper metrics

This scraper extracts:
- Company name
- Position/role
- Interview questions (technical + behavioral)
- Interview process details
- Date of interview
"""

import re
import hashlib
import requests
import time
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from html import unescape
from bs4 import BeautifulSoup

from . import InterviewQuestion, QuestionType, Difficulty

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
            _checkpoint = CheckpointManager("dou_ua")
        except Exception:
            pass
    return _checkpoint


def _init_infrastructure():
    """Initialize infrastructure components for Ukraine scraping."""
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

# DOU.ua forum URLs
DOU_BASE_URL = "https://dou.ua"
DOU_INTERVIEW_FORUM = "https://dou.ua/forums/topic/interview/"
DOU_FORUM_SEARCH = "https://dou.ua/forums/topic/"

# Request settings
REQUEST_TIMEOUT = 30
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5,uk;q=0.3",
}

# Company name patterns (FAANG, EU tech, Ukrainian tech)
KNOWN_COMPANIES = [
    "Google", "Meta", "Facebook", "Amazon", "Apple", "Microsoft", "Netflix",
    "Uber", "Airbnb", "Stripe", "Spotify", "Twitter", "X", "LinkedIn",
    "Oracle", "SAP", "Salesforce", "Adobe", "VMware", "Cisco", "Intel",
    "EPAM", "SoftServe", "GlobalLogic", "Luxoft", "Ciklum", "Intellias",
    "Grammarly", "MacPaw", "Readdle", "GitLab", "JetBrains", "Revolut",
    "Bolt", "Wix", "Monday.com", "Fiverr", "Playtika", "Plarium",
    "N26", "Klarna", "Zalando", "Delivery Hero", "Personio",
    "Booking.com", "Adyen", "ASML", "Philips", "ING", "ABN AMRO",
]

# Question type indicators
TECHNICAL_KEYWORDS = [
    "coding", "algorithm", "data structure", "system design", "live coding",
    "leetcode", "hackerrank", "technical", "programming", "code review",
    "architecture", "api", "database", "sql", "distributed", "scalability",
    "алгоритм", "код", "технічн", "програмуван",
]

BEHAVIORAL_KEYWORDS = [
    "behavioral", "situational", "tell me about", "describe a time",
    "leadership", "conflict", "teamwork", "motivation", "weakness",
    "strength", "why", "культур", "поведінк", "soft skills",
]

SYSTEM_DESIGN_KEYWORDS = [
    "system design", "design a", "architect", "scale", "distributed system",
    "microservices", "load balancer", "caching", "database design",
    "high availability", "системний дизайн", "архітектур",
]

# Date patterns (Ukrainian and English)
DATE_PATTERNS = [
    # Ukrainian: "15 січня 2026"
    re.compile(r"(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)\s+(\d{4})", re.IGNORECASE),
    # English: "January 15, 2026" or "15 January 2026"
    re.compile(r"(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})", re.IGNORECASE),
    re.compile(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})", re.IGNORECASE),
    # ISO-like: "2026-01-15"
    re.compile(r"(\d{4})-(\d{2})-(\d{2})"),
]

UKRAINIAN_MONTHS = {
    "січня": 1, "лютого": 2, "березня": 3, "квітня": 4,
    "травня": 5, "червня": 6, "липня": 7, "серпня": 8,
    "вересня": 9, "жовтня": 10, "листопада": 11, "грудня": 12,
}

ENGLISH_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def generate_question_id(text: str, company: str, source: str) -> str:
    """Generate unique ID for a question."""
    content = f"{company}:{text[:100]}:{source}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    text = re.sub(r"\n\s*\n", "\n\n", text)
    return text.strip()


def extract_company(text: str, title: str = "") -> Optional[str]:
    """Extract company name from post text or title using robust detection when available."""
    combined = f"{title} {text}"

    # Use robust company detection if available
    if INFRA_AVAILABLE:
        try:
            company_matches = detect_all_companies_robust(combined)
            if company_matches:
                return company_matches[0].normalized.replace('_', ' ').title()
        except Exception:
            pass  # Fall through to manual detection

    # Check for known companies first
    for company in KNOWN_COMPANIES:
        if re.search(rf"\b{re.escape(company)}\b", combined, re.IGNORECASE):
            return company

    # Try to extract from title patterns like "Interview at Company" or "Company interview"
    patterns = [
        re.compile(r"(?:interview|інтерв'ю|співбесіда)\s+(?:at|в|у|@)\s+([A-Za-z0-9][A-Za-z0-9\s\.\-&]+?)(?:\s*[\|\-\(\[]|$)", re.IGNORECASE),
        re.compile(r"([A-Za-z0-9][A-Za-z0-9\s\.\-&]+?)\s+(?:interview|інтерв'ю|співбесіда)", re.IGNORECASE),
    ]

    for pattern in patterns:
        match = pattern.search(combined[:500])
        if match:
            company = match.group(1).strip()
            if 2 < len(company) < 50:
                return company

    return None


def extract_role(text: str) -> Optional[str]:
    """Extract job role/position from text."""
    role_patterns = [
        re.compile(r"\b(senior|junior|middle|lead|staff|principal)?\s*(software|backend|frontend|full[\-\s]?stack|devops|sre|ml|data|platform|infrastructure)\s*(engineer|developer|scientist)?\b", re.IGNORECASE),
        re.compile(r"\b(swe|sde|mle)\b", re.IGNORECASE),
        re.compile(r"\b(software engineer(?:ing)?|developer|programmer)\b", re.IGNORECASE),
    ]

    for pattern in role_patterns:
        match = pattern.search(text)
        if match:
            role = " ".join(g for g in match.groups() if g).strip()
            if role:
                return role.title()

    return None


def parse_date_dou(text: str) -> Optional[datetime]:
    """Parse date from Ukrainian or English text using UniversalDateParser when available."""
    _init_infrastructure()

    # Use infrastructure date parser if available
    if INFRA_AVAILABLE and _date_parser:
        try:
            parsed = _date_parser.parse(text, language='uk')
            if parsed:
                return parsed.date
        except Exception:
            pass  # Fall through to manual parsing

    # Fallback to manual parsing
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            groups = match.groups()
            try:
                if len(groups) == 3:
                    # Check for Ukrainian month
                    if groups[1].lower() in UKRAINIAN_MONTHS:
                        day, month_name, year = groups
                        month = UKRAINIAN_MONTHS[month_name.lower()]
                        return datetime(int(year), month, int(day))
                    # Check for English month
                    elif groups[1].lower() in ENGLISH_MONTHS:
                        day, month_name, year = groups
                        month = ENGLISH_MONTHS[month_name.lower()]
                        return datetime(int(year), month, int(day))
                    elif groups[0].lower() in ENGLISH_MONTHS:
                        month_name, day, year = groups
                        month = ENGLISH_MONTHS[month_name.lower()]
                        return datetime(int(year), month, int(day))
                    # ISO format
                    elif len(groups[0]) == 4:
                        year, month, day = groups
                        return datetime(int(year), int(month), int(day))
            except (ValueError, KeyError):
                continue

    return None


def classify_question_type(text: str) -> QuestionType:
    """Classify question type based on content."""
    text_lower = text.lower()

    if any(kw in text_lower for kw in SYSTEM_DESIGN_KEYWORDS):
        return QuestionType.SYSTEM_DESIGN
    if any(kw in text_lower for kw in BEHAVIORAL_KEYWORDS):
        return QuestionType.BEHAVIORAL
    if any(kw in text_lower for kw in TECHNICAL_KEYWORDS):
        return QuestionType.TECHNICAL

    # Default to technical for coding/algorithm mentions
    if re.search(r"\b(code|coding|algorithm|leetcode|array|tree|graph|dynamic)\b", text_lower):
        return QuestionType.CODING

    return QuestionType.TECHNICAL


def estimate_difficulty(text: str) -> Optional[Difficulty]:
    """Estimate question difficulty from context."""
    text_lower = text.lower()

    hard_indicators = ["hard", "difficult", "complex", "advanced", "senior", "staff", "principal", "складн"]
    easy_indicators = ["easy", "simple", "basic", "junior", "entry", "прост", "легк"]
    medium_indicators = ["medium", "moderate", "middle", "середн"]

    if any(ind in text_lower for ind in hard_indicators):
        return Difficulty.HARD
    if any(ind in text_lower for ind in easy_indicators):
        return Difficulty.EASY
    if any(ind in text_lower for ind in medium_indicators):
        return Difficulty.MEDIUM

    return None


def extract_questions(text: str) -> list[str]:
    """Extract individual questions from interview experience text."""
    questions = []

    # Split by common question indicators
    question_patterns = [
        re.compile(r"(?:^|\n)\s*[-•*]\s*(.+?\?)", re.MULTILINE),
        re.compile(r"(?:^|\n)\s*\d+[\.\)]\s*(.+?\?)", re.MULTILINE),
        re.compile(r"(?:asked|питали|запитували|запитання)[:\s]+[\"']?(.+?)[\"']?(?:\n|$)", re.IGNORECASE),
        re.compile(r"[\"']([^\"']+\?)[\"']"),
    ]

    for pattern in question_patterns:
        matches = pattern.findall(text)
        for match in matches:
            q = match.strip()
            if 10 < len(q) < 500 and "?" in q:
                questions.append(q)

    # Also look for question-like sentences
    sentences = re.split(r"[.!]\s+", text)
    for sentence in sentences:
        sentence = sentence.strip()
        if sentence.endswith("?") and 15 < len(sentence) < 500:
            if sentence not in questions:
                questions.append(sentence)

    return list(set(questions))[:20]  # Dedupe and limit


def extract_topics(text: str) -> list[str]:
    """Extract technical topics mentioned."""
    topics = []

    topic_patterns = [
        # Programming languages
        re.compile(r"\b(python|java|javascript|typescript|c\+\+|go|rust|scala|kotlin|ruby)\b", re.IGNORECASE),
        # Technologies
        re.compile(r"\b(aws|gcp|azure|docker|kubernetes|k8s|kafka|redis|postgresql|mongodb|mysql)\b", re.IGNORECASE),
        # Concepts
        re.compile(r"\b(rest\s*api|graphql|microservices|ci/cd|testing|security|networking)\b", re.IGNORECASE),
        # DS&A topics
        re.compile(r"\b(arrays?|trees?|graphs?|dynamic programming|dp|sorting|searching|linked lists?|hash\s*(?:map|table)s?)\b", re.IGNORECASE),
    ]

    for pattern in topic_patterns:
        matches = pattern.findall(text)
        for match in matches:
            topic = match.strip().lower()
            if topic not in topics:
                topics.append(topic)

    return topics[:15]


def fetch_forum_page(url: str, page: int = 1) -> Optional[str]:
    """Fetch a page from DOU.ua forums using infrastructure when available."""
    _init_infrastructure()

    if page > 1:
        url = f"{url}?page={page}"

    # Check cache first
    if INFRA_AVAILABLE and _response_cache:
        cached = _response_cache.get(url)
        if cached:
            return cached.content.decode() if isinstance(cached.content, bytes) else cached.content

    try:
        # Use stealth headers if available
        if INFRA_AVAILABLE and _stealth_session:
            config = _stealth_session.get_request_config(url)
            headers = config.get('headers', {})
            headers.update(HEADERS)

            # Get proxy for Ukraine/Russia region
            proxies = None
            if _geo_proxy:
                proxy = _geo_proxy.select_proxy(url)
                if proxy:
                    proxies = proxy.proxy_dict

            # Rate limiting
            if not _stealth_session.before_request():
                time.sleep(1.5)

            response = requests.get(
                url,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
                proxies=proxies,
            )
            _stealth_session.after_request(response.status_code)
        else:
            response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)

        response.raise_for_status()

        # Cache successful response
        if INFRA_AVAILABLE and _response_cache:
            _response_cache.set(url, response)

        return response.text
    except requests.RequestException as e:
        print(f"Error fetching DOU.ua page {url}: {e}")
        return None


def parse_forum_posts(html: str) -> list[dict]:
    """Parse forum posts from HTML."""
    soup = BeautifulSoup(html, "html.parser")
    posts = []

    # Find article/post containers
    for article in soup.select("article.b-post, div.b-post, .topic-content"):
        post = {}

        # Extract title
        title_elem = article.select_one("h1, h2, .title a, .post-title")
        if title_elem:
            post["title"] = title_elem.get_text(strip=True)

        # Extract post URL
        link = article.select_one("a.title, a[href*='/forums/topic/']")
        if link and link.get("href"):
            href = link["href"]
            post["url"] = href if href.startswith("http") else f"{DOU_BASE_URL}{href}"

        # Extract date
        date_elem = article.select_one("time, .date, .post-date, [datetime]")
        if date_elem:
            date_str = date_elem.get("datetime") or date_elem.get_text(strip=True)
            post["date"] = parse_date_dou(date_str)

        # Extract content
        content_elem = article.select_one(".text, .content, .post-content, .b-typo")
        if content_elem:
            post["content"] = clean_html(content_elem.get_text())

        # Extract author
        author_elem = article.select_one(".author, .username, .user a")
        if author_elem:
            post["author"] = author_elem.get_text(strip=True)

        if post.get("content") and len(post["content"]) > 100:
            posts.append(post)

    return posts


def fetch_post_detail(url: str) -> Optional[dict]:
    """Fetch full post content from detail page."""
    html = fetch_forum_page(url)
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")
    post = {"url": url}

    # Extract title
    title_elem = soup.select_one("h1, .topic-title, .b-post-title")
    if title_elem:
        post["title"] = title_elem.get_text(strip=True)

    # Extract full content
    content_elem = soup.select_one(".b-typo, .topic-content, .post-body, article .text")
    if content_elem:
        post["content"] = clean_html(content_elem.get_text())

    # Extract date
    date_elem = soup.select_one("time, .date, [datetime]")
    if date_elem:
        date_str = date_elem.get("datetime") or date_elem.get_text(strip=True)
        post["date"] = parse_date_dou(date_str)

    return post


def post_to_questions(post: dict) -> list[InterviewQuestion]:
    """Convert a forum post to InterviewQuestion objects."""
    questions = []

    content = post.get("content", "")
    title = post.get("title", "")
    url = post.get("url", "")
    interview_date = post.get("date")

    # Extract metadata
    company = extract_company(content, title)
    role = extract_role(content)
    topics = extract_topics(content)

    if not company:
        return []

    # Extract individual questions
    raw_questions = extract_questions(content)

    if raw_questions:
        # Create question objects for each extracted question
        for q_text in raw_questions:
            q_type = classify_question_type(q_text)
            difficulty = estimate_difficulty(q_text)

            question = InterviewQuestion(
                id=generate_question_id(q_text, company, "dou.ua"),
                question_text=q_text,
                question_type=q_type,
                difficulty=difficulty,
                company=company,
                role=role,
                topics=topics,
                source="dou.ua",
                source_url=url,
                interview_date=interview_date,
                upvotes=0,
            )
            questions.append(question)
    else:
        # No specific questions found - create a summary entry
        summary = content[:500] if len(content) > 500 else content
        q_type = classify_question_type(content)

        question = InterviewQuestion(
            id=generate_question_id(summary, company, "dou.ua"),
            question_text=f"Interview experience at {company}: {summary}",
            question_type=q_type,
            difficulty=estimate_difficulty(content),
            company=company,
            role=role,
            topics=topics,
            source="dou.ua",
            source_url=url,
            interview_date=interview_date,
            upvotes=0,
        )
        questions.append(question)

    return questions


def scrape_dou(months: int = 5, max_pages: int = 20) -> list[InterviewQuestion]:
    """Scrape interview questions from DOU.ua forums.

    Args:
        months: Number of months of data to fetch (default 5)
        max_pages: Maximum number of forum pages to scrape (default 20)

    Returns:
        List of InterviewQuestion objects
    """
    cutoff_date = datetime.now() - timedelta(days=months * 30)
    all_questions: list[InterviewQuestion] = []
    seen_urls: set[str] = set()

    print(f"Scraping DOU.ua interview forum (last {months} months)...")

    # Scrape multiple pages of the interview forum
    for page in range(1, max_pages + 1):
        print(f"  Fetching page {page}...")

        html = fetch_forum_page(DOU_INTERVIEW_FORUM, page)
        if not html:
            break

        posts = parse_forum_posts(html)
        if not posts:
            print(f"  No posts found on page {page}, stopping")
            break

        new_posts = 0
        old_posts = 0

        for post in posts:
            url = post.get("url", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)

            # Check date cutoff
            post_date = post.get("date")
            if post_date and post_date < cutoff_date:
                old_posts += 1
                continue

            # Fetch full post content if needed
            if len(post.get("content", "")) < 200 and url:
                detail = fetch_post_detail(url)
                if detail and detail.get("content"):
                    post.update(detail)

            # Extract questions
            questions = post_to_questions(post)
            all_questions.extend(questions)
            new_posts += 1

        print(f"  Found {new_posts} new posts, {old_posts} old posts, {len(all_questions)} total questions")

        # Stop if all posts on page are too old
        if old_posts > new_posts * 2:
            print(f"  Most posts are older than {months} months, stopping")
            break

    print(f"Scraped {len(all_questions)} questions from DOU.ua")
    return all_questions


# Alternative search-based scraping for specific companies
def scrape_dou_company(company: str, months: int = 5) -> list[InterviewQuestion]:
    """Scrape interview questions for a specific company from DOU.ua.

    Args:
        company: Company name to search for
        months: Number of months of data to fetch (default 5)

    Returns:
        List of InterviewQuestion objects for that company
    """
    search_url = f"https://dou.ua/search/?q={company}+interview"
    all_questions: list[InterviewQuestion] = []
    cutoff_date = datetime.now() - timedelta(days=months * 30)

    print(f"Searching DOU.ua for {company} interviews...")

    html = fetch_forum_page(search_url)
    if not html:
        return []

    posts = parse_forum_posts(html)

    for post in posts:
        post_date = post.get("date")
        if post_date and post_date < cutoff_date:
            continue

        questions = post_to_questions(post)
        # Filter to only questions mentioning this company
        questions = [q for q in questions if q.company and company.lower() in q.company.lower()]
        all_questions.extend(questions)

    print(f"Found {len(all_questions)} questions for {company}")
    return all_questions


if __name__ == "__main__":
    # Test the scraper
    questions = scrape_dou(months=5, max_pages=5)

    print("\nSample questions:")
    for q in questions[:10]:
        print(f"\n[{q.company}] ({q.question_type.value})")
        print(f"  {q.question_text[:100]}...")
        if q.topics:
            print(f"  Topics: {', '.join(q.topics[:5])}")
