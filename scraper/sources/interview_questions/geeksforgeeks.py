"""GeeksforGeeks Interview Experiences Scraper.

Scrapes interview experiences from GeeksforGeeks company interview corner.
Filters by interview date (last 4-5 months) and extracts:
- Company name
- Position/Role
- Interview date
- Round details
- Actual questions asked

URL: https://www.geeksforgeeks.org/company-interview-corner/

Uses production infrastructure:
- StealthSession for anti-detection
- ResponseCache for HTTP response caching (24h TTL - content changes slowly)
- AdaptiveRateLimiter for intelligent rate limiting (gentle with site)
- text_parser for company detection and question extraction
- Monitoring for metrics tracking
"""

import re
import time
import logging
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import Optional, TypedDict, List
from dataclasses import dataclass, asdict
from urllib.parse import urljoin
import sys
import os

# Add parent directory for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Import production infrastructure with INFRA_AVAILABLE flag pattern
INFRA_AVAILABLE = False
try:
    from utils.anti_detection import StealthSession, create_stealth_session
    from utils.cache import ResponseCache, get_cache
    from utils.rate_limiter import AdaptiveRateLimiter
    from utils.text_parser import detect_all_companies_robust, extract_interview_questions
    from utils.monitoring import monitor_scraper
    from utils.error_handler import CheckpointManager
    INFRA_AVAILABLE = True
except ImportError:
    pass

# Fallback to basic requests if infrastructure not available
try:
    import requests
except ImportError:
    requests = None

logger = logging.getLogger(__name__)

# Request settings
REQUEST_TIMEOUT = 30
DEFAULT_TTL = 3600  # 1 hour cache

# Base URLs
GFG_BASE_URL = "https://www.geeksforgeeks.org"
GFG_INTERVIEW_CORNER = "https://www.geeksforgeeks.org/company-interview-corner/"


class InterviewQuestion(TypedDict):
    """Structure for an interview question."""
    id: str
    company: str
    position: str
    question_type: str  # 'technical', 'behavioral', 'system_design', 'oa'
    question_text: str
    difficulty: str  # 'easy', 'medium', 'hard'
    source: str
    source_url: str
    interview_date: Optional[str]  # ISO date
    round_info: str
    created_at: str


class InterviewExperience(TypedDict):
    """Structure for a full interview experience."""
    id: str
    company: str
    position: str
    interview_date: Optional[str]
    source_url: str
    rounds: List[dict]
    questions: List[InterviewQuestion]
    difficulty: str
    outcome: Optional[str]  # 'offer', 'rejected', 'pending'
    raw_text: str


# Date patterns for parsing interview dates
DATE_PATTERNS = [
    # "Jan 2024", "January 2024"
    re.compile(r'\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*(\d{4})\b', re.IGNORECASE),
    # "2024-01", "01/2024"
    re.compile(r'\b(\d{4})[-/](\d{1,2})\b'),
    re.compile(r'\b(\d{1,2})[-/](\d{4})\b'),
    # "Last updated: DD Mon YYYY"
    re.compile(r'(?:updated|posted|date)[:\s]*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})', re.IGNORECASE),
]

# Month name to number mapping
MONTH_MAP = {
    'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
    'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
    'aug': 8, 'august': 8, 'sep': 9, 'september': 9, 'oct': 10, 'october': 10,
    'nov': 11, 'november': 11, 'dec': 12, 'december': 12
}

# Question type patterns
QUESTION_TYPE_PATTERNS = {
    'system_design': re.compile(r'\b(system\s*design|design\s*(a|an|the)?\s*(system|app|service|api|database|cache|url\s*shortener|twitter|instagram|uber|whatsapp))\b', re.IGNORECASE),
    'oa': re.compile(r'\b(online\s*(assessment|test|round)|oa\b|coding\s*test|hackerrank|codility|codesignal|leetcode\s*style)\b', re.IGNORECASE),
    'behavioral': re.compile(r'\b(behavioral|hr\s*round|tell\s*me\s*about|why\s*(this\s*company|do\s*you|should\s*we)|leadership|teamwork|conflict|challenge|failure|success|strength|weakness|describe\s*a\s*time)\b', re.IGNORECASE),
    'technical': re.compile(r'\b(technical|coding|algorithm|data\s*structure|array|string|tree|graph|dp|dynamic\s*programming|recursion|linked\s*list|hash|sort|search|bfs|dfs|sql|database|os|operating\s*system|network|oops|oop)\b', re.IGNORECASE),
}

# Difficulty patterns
DIFFICULTY_PATTERNS = {
    'easy': re.compile(r'\b(easy|simple|basic|beginner|straightforward)\b', re.IGNORECASE),
    'hard': re.compile(r'\b(hard|difficult|challenging|complex|advanced|tough)\b', re.IGNORECASE),
    'medium': re.compile(r'\b(medium|moderate|intermediate)\b', re.IGNORECASE),
}

# Round patterns
ROUND_PATTERNS = [
    re.compile(r'(round\s*\d+|r\d+|first\s*round|second\s*round|third\s*round|final\s*round|hr\s*round|technical\s*round|coding\s*round|system\s*design\s*round|managerial\s*round|onsite|phone\s*screen|screening)', re.IGNORECASE),
]


# Initialize infrastructure components
_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_stealth_session: Optional['StealthSession'] = None
_checkpoint: Optional['CheckpointManager'] = None


def _get_checkpoint() -> Optional['CheckpointManager']:
    """Get or create checkpoint manager."""
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE:
        try:
            _checkpoint = CheckpointManager("geeksforgeeks")
            logger.debug("CheckpointManager initialized for GFG scraper")
        except Exception:
            pass
    return _checkpoint

# Use longer TTL for GFG - content changes slowly (24 hours)
GFG_CACHE_TTL = 3600 * 24


def _get_cache() -> Optional['ResponseCache']:
    """Get or create response cache with longer TTL for slow-changing content."""
    global _cache
    if _cache is None and INFRA_AVAILABLE:
        try:
            _cache = ResponseCache(ttl=GFG_CACHE_TTL)
            logger.debug("ResponseCache initialized for GFG scraper (24h TTL)")
        except Exception as e:
            logger.warning(f"Failed to initialize cache: {e}")
    return _cache


def _get_rate_limiter() -> Optional['AdaptiveRateLimiter']:
    """Get or create rate limiter - be gentle with GFG."""
    global _rate_limiter
    if _rate_limiter is None and INFRA_AVAILABLE:
        try:
            _rate_limiter = AdaptiveRateLimiter(
                base_delay=2.0,       # Start with 2s delay
                min_delay=1.5,        # Never go below 1.5s
                max_delay=10.0,       # Max 10s on errors
                target_response_time=3.0,
                jitter_factor=0.2,    # 20% jitter
            )
            logger.debug("AdaptiveRateLimiter initialized for GFG scraper")
        except Exception as e:
            logger.warning(f"Failed to initialize rate limiter: {e}")
    return _rate_limiter


def _get_stealth_session() -> Optional['StealthSession']:
    """Get or create stealth session for anti-detection."""
    global _stealth_session
    if _stealth_session is None and INFRA_AVAILABLE:
        try:
            _stealth_session = create_stealth_session(
                min_delay=1.5,
                max_delay=4.0,
                requests_per_minute=20,  # Gentle rate
            )
            logger.debug("StealthSession initialized for GFG scraper")
        except Exception as e:
            logger.warning(f"Failed to initialize stealth session: {e}")
    return _stealth_session


def make_request(url: str, session=None) -> Optional[BeautifulSoup]:
    """Make a rate-limited request with caching and stealth headers.

    Uses:
    - ResponseCache for caching (24h TTL)
    - AdaptiveRateLimiter for gentle rate limiting
    - StealthSession for anti-detection headers
    """
    # Check cache first
    cache = _get_cache()
    if cache:
        cached = cache.get(url)
        if cached:
            logger.debug(f"Cache hit for {url}")
            return BeautifulSoup(cached.content, 'html.parser')

    # Apply rate limiting
    rate_limiter = _get_rate_limiter()
    if rate_limiter:
        rate_limiter.wait_sync()
    else:
        time.sleep(2.5)  # Fallback delay

    start_time = time.time()
    try:
        # Use stealth session if available
        stealth = _get_stealth_session()
        if stealth:
            config = stealth.get_request_config(url)
            headers = config['headers']
        else:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }

        # Use provided session or create new one
        if session is None:
            if requests is None:
                logger.error("requests module not available")
                return None
            session = requests.Session()

        response = session.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        response_time = time.time() - start_time

        # Update rate limiter with response status
        if rate_limiter:
            if response.ok:
                rate_limiter.record_success(response_time)
            else:
                is_rate_limit = response.status_code == 429
                rate_limiter.record_failure(is_rate_limit=is_rate_limit)

        response.raise_for_status()

        # Cache successful response
        if cache:
            cache.set(url, response)
            logger.debug(f"Cached response for {url}")

        return BeautifulSoup(response.text, 'html.parser')
    except Exception as e:
        if rate_limiter:
            rate_limiter.record_failure()
        logger.error(f"Error fetching {url}: {e}")
        return None


def parse_date(text: str) -> Optional[str]:
    """Extract and normalize date from text to ISO format (YYYY-MM-DD)."""
    if not text:
        return None

    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            groups = match.groups()
            try:
                if len(groups) == 2:
                    # Month Year or Year Month format
                    first, second = groups
                    if first.isdigit():
                        if int(first) > 12:  # It's a year
                            year, month = int(first), int(second)
                        else:  # It's a month
                            month, year = int(first), int(second)
                    else:
                        month = MONTH_MAP.get(first.lower()[:3], 1)
                        year = int(second)
                    return f"{year}-{month:02d}-01"
                elif len(groups) == 3:
                    # Day Month Year format
                    day, month_str, year = groups
                    month = MONTH_MAP.get(month_str.lower()[:3], 1)
                    return f"{int(year)}-{month:02d}-{int(day):02d}"
            except (ValueError, KeyError):
                continue

    return None


def is_within_months(date_str: Optional[str], months: int = 5) -> bool:
    """Check if date is within the last N months."""
    if not date_str:
        return True  # Include if we can't parse the date

    try:
        date = datetime.strptime(date_str, "%Y-%m-%d")
        cutoff = datetime.now() - timedelta(days=months * 30)
        return date >= cutoff
    except ValueError:
        return True  # Include if we can't parse


def classify_question_type(text: str) -> str:
    """Classify question type based on content."""
    for qtype, pattern in QUESTION_TYPE_PATTERNS.items():
        if pattern.search(text):
            return qtype
    return 'technical'  # Default


def classify_difficulty(text: str) -> str:
    """Classify difficulty based on content."""
    for difficulty, pattern in DIFFICULTY_PATTERNS.items():
        if pattern.search(text):
            return difficulty
    return 'medium'  # Default


def extract_round_info(text: str) -> str:
    """Extract round information from text."""
    for pattern in ROUND_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1)
    return 'Unknown Round'


def extract_questions_from_text(text: str, company: str, position: str,
                                  interview_date: Optional[str], source_url: str) -> List[InterviewQuestion]:
    """Extract individual questions from interview experience text."""
    questions = []

    # Split text into potential question segments
    # Look for numbered lists, bullet points, or Q: patterns
    question_patterns = [
        re.compile(r'(?:^|\n)\s*(?:Q\d*[:\.\)]|Question\s*\d*[:\.\)]|\d+[:\.\)]\s*(?:What|How|Why|Design|Implement|Write|Explain|Describe|Given|Find))', re.MULTILINE | re.IGNORECASE),
        re.compile(r'(?:^|\n)\s*[-*]\s*(?:What|How|Why|Design|Implement|Write|Explain|Describe|Given|Find)', re.MULTILINE | re.IGNORECASE),
        re.compile(r'(?:They asked|I was asked|Question was|Asked me to)\s*[:\-]?\s*', re.IGNORECASE),
    ]

    # Find all question-like segments
    segments = []
    lines = text.split('\n')
    current_segment = []

    for line in lines:
        line = line.strip()
        if not line:
            if current_segment:
                segments.append(' '.join(current_segment))
                current_segment = []
            continue

        # Check if this line starts a new question
        is_question_start = False
        for pattern in question_patterns:
            if pattern.search(line):
                if current_segment:
                    segments.append(' '.join(current_segment))
                current_segment = [line]
                is_question_start = True
                break

        if not is_question_start:
            current_segment.append(line)

    if current_segment:
        segments.append(' '.join(current_segment))

    # Process each segment as a potential question
    for i, segment in enumerate(segments):
        # Skip very short segments
        if len(segment) < 20:
            continue

        # Skip segments that don't look like questions
        question_indicators = ['?', 'implement', 'write', 'design', 'explain', 'find',
                               'given', 'solve', 'what', 'how', 'why', 'describe']
        if not any(ind in segment.lower() for ind in question_indicators):
            continue

        # Clean up the question text
        question_text = segment.strip()
        question_text = re.sub(r'^(?:Q\d*[:\.\)]|Question\s*\d*[:\.\)]|\d+[:\.\)]\s*)', '', question_text).strip()
        question_text = re.sub(r'^[-*]\s*', '', question_text).strip()

        if len(question_text) < 15:
            continue

        question: InterviewQuestion = {
            'id': f"gfg_{company.lower().replace(' ', '_')}_{hash(question_text) % 100000}",
            'company': company,
            'position': position,
            'question_type': classify_question_type(question_text),
            'question_text': question_text[:1000],  # Limit length
            'difficulty': classify_difficulty(segment),
            'source': 'geeksforgeeks',
            'source_url': source_url,
            'interview_date': interview_date,
            'round_info': extract_round_info(segment),
            'created_at': datetime.now().isoformat(),
        }
        questions.append(question)

    return questions


def get_company_list(session: requests.Session) -> List[dict]:
    """Fetch list of companies from the interview corner."""
    soup = make_request(GFG_INTERVIEW_CORNER, session)
    if not soup:
        return []

    companies = []

    # GFG organizes companies in lists/cards
    # Look for company links
    company_links = soup.select('a[href*="/interview-preparation/"]') or \
                    soup.select('a[href*="-interview-experience"]') or \
                    soup.select('.entry-title a') or \
                    soup.select('.article-title a')

    seen_urls = set()
    for link in company_links:
        href = link.get('href', '')
        if href and href not in seen_urls:
            company_name = link.get_text(strip=True)
            if company_name and len(company_name) > 1:
                full_url = urljoin(GFG_BASE_URL, href)
                companies.append({
                    'name': company_name,
                    'url': full_url
                })
                seen_urls.add(href)

    # Also try to find company cards/boxes
    company_cards = soup.select('.company-card, .interview-card, .article-card')
    for card in company_cards:
        link = card.select_one('a')
        if link:
            href = link.get('href', '')
            if href and href not in seen_urls:
                company_name = card.get_text(strip=True).split('\n')[0]
                if company_name:
                    companies.append({
                        'name': company_name,
                        'url': urljoin(GFG_BASE_URL, href)
                    })
                    seen_urls.add(href)

    print(f"Found {len(companies)} companies on GFG interview corner")
    return companies[:100]  # Limit to avoid too many requests


def get_company_experiences(company_url: str, company_name: str,
                            session: requests.Session, max_pages: int = 5) -> List[str]:
    """Fetch interview experience URLs for a company."""
    experience_urls = []
    current_url = company_url

    for page in range(max_pages):
        soup = make_request(current_url, session)
        if not soup:
            break

        # Find interview experience article links
        article_links = soup.select('article a, .entry-title a, .post-title a, .article-title a, h2 a, h3 a')

        for link in article_links:
            href = link.get('href', '')
            text = link.get_text(strip=True).lower()

            # Filter for interview experience articles
            if href and ('interview-experience' in href or 'interview-experience' in text):
                full_url = urljoin(GFG_BASE_URL, href)
                if full_url not in experience_urls:
                    experience_urls.append(full_url)

        # Look for pagination
        next_link = soup.select_one('a.next, a[rel="next"], .pagination a:contains("Next"), .nav-next a')
        if next_link:
            next_href = next_link.get('href')
            if next_href:
                current_url = urljoin(GFG_BASE_URL, next_href)
            else:
                break
        else:
            break

    return experience_urls


def parse_experience_page(url: str, company_name: str,
                          session: requests.Session) -> Optional[InterviewExperience]:
    """Parse a single interview experience page."""
    soup = make_request(url, session)
    if not soup:
        return None

    # Extract title
    title_elem = soup.select_one('h1, .post-title, .entry-title, .article-title')
    title = title_elem.get_text(strip=True) if title_elem else ''

    # Extract position from title
    position = 'Software Engineer'  # Default
    position_patterns = [
        re.compile(r'(SDE|Software\s*(?:Development\s*)?Engineer|Backend|Frontend|Full[\s-]*Stack|DevOps|ML|Data\s*(?:Scientist|Engineer)|Product\s*Manager|QA|Test|Intern)', re.IGNORECASE),
    ]
    for pattern in position_patterns:
        match = pattern.search(title)
        if match:
            position = match.group(1)
            break

    # Extract main content
    content_elem = soup.select_one('.entry-content, .post-content, .article-content, article')
    if not content_elem:
        return None

    # Get full text
    full_text = content_elem.get_text(separator='\n', strip=True)

    # Extract date
    date_elem = soup.select_one('.entry-date, .post-date, time, .date')
    date_text = date_elem.get_text(strip=True) if date_elem else title
    interview_date = parse_date(date_text) or parse_date(full_text[:500])

    # Check if within date range
    if not is_within_months(interview_date, months=5):
        return None

    # Extract questions
    questions = extract_questions_from_text(full_text, company_name, position, interview_date, url)

    if not questions:
        return None

    # Determine overall difficulty
    difficulty_counts = {'easy': 0, 'medium': 0, 'hard': 0}
    for q in questions:
        difficulty_counts[q['difficulty']] = difficulty_counts.get(q['difficulty'], 0) + 1
    overall_difficulty = max(difficulty_counts, key=difficulty_counts.get)

    # Determine outcome
    outcome = None
    if re.search(r'\b(got\s*the\s*offer|selected|accepted|joined)\b', full_text, re.IGNORECASE):
        outcome = 'offer'
    elif re.search(r'\b(rejected|not\s*selected|did\s*not\s*get)\b', full_text, re.IGNORECASE):
        outcome = 'rejected'

    experience: InterviewExperience = {
        'id': f"gfg_exp_{hash(url) % 1000000}",
        'company': company_name,
        'position': position,
        'interview_date': interview_date,
        'source_url': url,
        'rounds': [],  # Could extract round details if needed
        'questions': questions,
        'difficulty': overall_difficulty,
        'outcome': outcome,
        'raw_text': full_text[:5000],  # Keep for reference
    }

    return experience


def scrape_geeksforgeeks(target_companies: Optional[List[str]] = None,
                         months: int = 5,
                         max_experiences_per_company: int = 20,
                         resume: bool = True) -> List[InterviewQuestion]:
    """
    Main scraper function for GeeksforGeeks interview experiences.

    Uses production infrastructure:
    - StealthSession for anti-detection
    - ResponseCache for caching (24h TTL - content changes slowly)
    - AdaptiveRateLimiter for gentle rate limiting
    - text_parser for robust company detection
    - Monitoring for metrics tracking
    - CheckpointManager for resumable scraping

    Args:
        target_companies: Optional list of company names to scrape. If None, scrapes all.
        months: Number of months to look back (default 5)
        max_experiences_per_company: Max experiences to fetch per company
        resume: If True, resume from last checkpoint

    Returns:
        List of InterviewQuestion dicts
    """
    if requests is None:
        logger.error("requests module not available")
        return []

    session = requests.Session()
    all_questions: List[InterviewQuestion] = []
    completed_companies = set()

    # Load checkpoint if available
    checkpoint = _get_checkpoint()
    if resume and checkpoint:
        checkpoint_data = checkpoint.load()
        if checkpoint_data:
            completed_companies = set(checkpoint_data.get("completed_companies", []))
            all_questions = checkpoint_data.get("questions", [])
            print(f"[GFG] Resuming from checkpoint ({len(completed_companies)} companies done)")

    # Use monitoring context if available
    monitoring_ctx = None
    if INFRA_AVAILABLE:
        try:
            monitoring_ctx = monitor_scraper('geeksforgeeks')
            monitoring_ctx.__enter__()
        except Exception as e:
            logger.warning(f"Failed to start monitoring: {e}")

    logger.info(f"Starting GeeksforGeeks scraper (last {months} months)")
    print(f"Starting GeeksforGeeks scraper (last {months} months)")

    # Popular tech companies to prioritize
    priority_companies = [
        'google', 'amazon', 'microsoft', 'meta', 'facebook', 'apple',
        'netflix', 'uber', 'airbnb', 'linkedin', 'twitter', 'stripe',
        'salesforce', 'oracle', 'adobe', 'nvidia', 'intel', 'qualcomm',
        'paypal', 'walmart', 'jpmorgan', 'goldman', 'bloomberg', 'citadel',
        'tiktok', 'bytedance', 'snap', 'pinterest', 'dropbox', 'slack',
        'atlassian', 'databricks', 'snowflake', 'coinbase', 'robinhood',
        'doordash', 'instacart', 'lyft', 'spotify', 'shopify', 'zoom',
        'vmware', 'cisco', 'ibm', 'samsung', 'sony', 'morgan stanley',
        'de shaw', 'two sigma', 'jane street', 'hrt', 'palantir', 'datadog'
    ]

    # If target companies specified, use those
    if target_companies:
        companies_to_scrape = [{'name': c, 'url': None} for c in target_companies]
    else:
        # Get company list from GFG
        companies_to_scrape = get_company_list(session)

        # Prioritize well-known companies
        def company_priority(c):
            name_lower = c['name'].lower()
            for i, priority in enumerate(priority_companies):
                if priority in name_lower:
                    return i
            return 999

        companies_to_scrape.sort(key=company_priority)

    companies_processed = 0
    max_companies = 50  # Limit to avoid overwhelming

    for company_info in companies_to_scrape[:max_companies]:
        company_name = company_info['name']
        company_url = company_info.get('url')

        # Skip already completed companies
        if company_name.lower() in completed_companies:
            continue

        # Construct search URL if needed
        if not company_url:
            search_name = company_name.lower().replace(' ', '-')
            company_url = f"{GFG_BASE_URL}/{search_name}-interview-experience/"

        print(f"\nScraping: {company_name}")

        try:
            # Get experience URLs
            experience_urls = get_company_experiences(company_url, company_name, session)
            print(f"  Found {len(experience_urls)} experience articles")

            experiences_processed = 0
            for exp_url in experience_urls[:max_experiences_per_company]:
                experience = parse_experience_page(exp_url, company_name, session)

                if experience and experience['questions']:
                    # Filter questions by date
                    recent_questions = [
                        q for q in experience['questions']
                        if is_within_months(q.get('interview_date'), months)
                    ]

                    all_questions.extend(recent_questions)
                    experiences_processed += 1
                    print(f"    Extracted {len(recent_questions)} questions from {exp_url.split('/')[-2]}")

            print(f"  Processed {experiences_processed} experiences, total questions: {len(all_questions)}")
            companies_processed += 1
            completed_companies.add(company_name.lower())

            # Save checkpoint after each company
            if checkpoint:
                checkpoint.save({
                    "completed_companies": list(completed_companies),
                    "questions": all_questions,
                })

        except Exception as e:
            print(f"  Error processing {company_name}: {e}")
            continue

    print(f"\n=== Scraping Complete ===")
    print(f"Companies processed: {companies_processed}")
    print(f"Total questions extracted: {len(all_questions)}")

    # Deduplicate by question text
    seen_questions = set()
    unique_questions = []
    for q in all_questions:
        q_key = (q['company'].lower(), q['question_text'][:100].lower())
        if q_key not in seen_questions:
            seen_questions.add(q_key)
            unique_questions.append(q)

    print(f"Unique questions after dedup: {len(unique_questions)}")

    # Use text_parser for enhanced company detection on questions
    validated_questions = []
    if INFRA_AVAILABLE:
        for q in unique_questions:
            try:
                # Use robust company detection from text_parser
                companies = detect_all_companies_robust(q.get('question_text', '') + ' ' + q.get('company', ''))
                if companies:
                    q['company'] = companies[0].normalized
                validated_questions.append(q)
            except Exception:
                validated_questions.append(q)
    else:
        validated_questions = unique_questions

    logger.info(f"Validated {len(validated_questions)} questions")
    print(f"Validated questions: {len(validated_questions)}")

    # Record metrics and close monitoring
    if monitoring_ctx:
        try:
            monitoring_ctx.record_questions(
                extracted=len(all_questions),
                new=len(validated_questions),
                duplicate=len(all_questions) - len(unique_questions),
            )
            monitoring_ctx.__exit__(None, None, None)
        except Exception as e:
            logger.warning(f"Failed to close monitoring: {e}")

    # Clear checkpoint on successful completion
    if checkpoint:
        checkpoint.clear()

    return validated_questions


# Convenience aliases
def fetch_gfg_interviews(months: int = 5) -> List[InterviewQuestion]:
    """Alias for scrape_geeksforgeeks."""
    return scrape_geeksforgeeks(months=months)


if __name__ == "__main__":
    # Test run
    questions = scrape_geeksforgeeks(
        target_companies=['Google', 'Amazon', 'Microsoft'],
        months=5,
        max_experiences_per_company=5
    )

    print(f"\nSample questions:")
    for q in questions[:5]:
        print(f"\n[{q['company']}] {q['question_type'].upper()}")
        print(f"  {q['question_text'][:200]}...")
        print(f"  Difficulty: {q['difficulty']}, Round: {q['round_info']}")
