"""Programmers.co.kr scraper for Korean tech interview questions.

Programmers is Korea's leading coding test platform, used by:
- Kakao (annual coding challenges)
- LINE (hiring assessments)
- Naver (tech interviews)
- Samsung, LG, and other Korean tech companies

The platform hosts company-sponsored coding problems and practice challenges.

UPGRADED: Uses production infrastructure:
- GeoProxySelector for Korea-specific proxies (CRITICAL for Korean sites)
- UniversalDateParser for Korean date formats ("3일 전", "어제", "2024년 4월 15일")
- InternationalCompanyNER for Korean company detection (카카오, 네이버, etc.)
- ResponseCache for caching with 6h TTL
- StealthSession for anti-detection
- Monitoring for metrics tracking
"""

import re
import hashlib
import time
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

# Conditional imports for infrastructure
try:
    import requests
    from bs4 import BeautifulSoup
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

from .quant_finance import InterviewQuestion

# Import unified scraper infrastructure
try:
    from ...utils.scraper_infra import (
        InfrastructureContext,
        translate_batch,
        validate_batch,
        get_stealth_headers,
        get_proxy_for_url,
        cached_request,
        wait_for_rate_limit,
    )
    UNIFIED_INFRA = True
except ImportError:
    UNIFIED_INFRA = False

# Infrastructure imports with consolidated INFRA_AVAILABLE flag
INFRA_AVAILABLE = False
try:
    from ...utils.proxy_manager import GeoProxySelector, ProxyRotator, ProxyPool
    from ...utils.date_parser import UniversalDateParser, parse_date
    from ...utils.cache import ResponseCache, IncrementalScraper
    from ...utils.anti_detection import StealthSession, create_stealth_session
    from ...utils.text_parser import InternationalCompanyNER, detect_all_companies_robust
    from ...utils.monitoring import monitor_scraper
    INFRA_AVAILABLE = True
except ImportError:
    # Fallback: individual flags for partial availability
    pass

# Treat unified infra as equivalent to full infra
if UNIFIED_INFRA and not INFRA_AVAILABLE:
    INFRA_AVAILABLE = True

# Legacy individual flags for backward compatibility
PROXY_AVAILABLE = INFRA_AVAILABLE
DATE_PARSER_AVAILABLE = INFRA_AVAILABLE
CACHE_AVAILABLE = INFRA_AVAILABLE
STEALTH_AVAILABLE = INFRA_AVAILABLE

# Base URLs
BASE_URL = "https://programmers.co.kr"
PROBLEMS_URL = f"{BASE_URL}/learn/challenges"
SKILL_CHECK_URL = f"{BASE_URL}/skill_checks"

# API endpoints (discovered from network inspection)
API_BASE = "https://programmers.co.kr/api"
CHALLENGES_API = f"{API_BASE}/challenges"

# Request config
REQUEST_TIMEOUT = 30
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
}

# Known Korean tech companies that sponsor problems
KOREAN_COMPANIES = {
    "kakao": ["카카오", "kakao", "카카오코딩테스트", "카카오 블라인드"],
    "line": ["라인", "line", "LINE", "라인플러스"],
    "naver": ["네이버", "naver", "NAVER", "네이버웹툰"],
    "samsung": ["삼성", "samsung", "SAMSUNG", "삼성전자"],
    "lg": ["LG", "엘지", "엘지전자"],
    "coupang": ["쿠팡", "coupang", "COUPANG"],
    "woowa": ["우아한형제들", "woowa", "배달의민족", "baemin"],
    "toss": ["토스", "toss", "비바리퍼블리카", "Toss"],
    "karrot": ["당근마켓", "karrot", "danggeun", "당근"],
    "hyundai": ["현대", "hyundai", "현대자동차"],
    "sk": ["SK", "에스케이", "SK하이닉스"],
    "socar": ["쏘카", "socar", "SOCAR"],
    "devsisters": ["데브시스터즈", "devsisters"],
    "krafton": ["크래프톤", "krafton", "KRAFTON"],
    "nexon": ["넥슨", "nexon", "NEXON"],
    "ncsoft": ["엔씨소프트", "ncsoft", "NCSOFT"],
    "smilegate": ["스마일게이트", "smilegate"],
}

# Difficulty mapping (string values to match InterviewQuestion)
DIFFICULTY_MAP = {
    "level1": "easy",
    "level2": "easy",
    "level3": "medium",
    "level4": "hard",
    "level5": "hard",
    "lv1": "easy",
    "lv2": "easy",
    "lv3": "medium",
    "lv4": "hard",
    "lv5": "hard",
    "레벨1": "easy",
    "레벨2": "easy",
    "레벨3": "medium",
    "레벨4": "hard",
    "레벨5": "hard",
}


class ProgrammersKRScraper:
    """Production-grade scraper for Programmers.co.kr using infrastructure modules."""

    def __init__(self, use_proxy: bool = True, use_cache: bool = True):
        """Initialize scraper with optional proxy and caching.

        Args:
            use_proxy: Whether to use Korea geo-proxies (CRITICAL for Korean sites)
            use_cache: Whether to cache responses
        """
        self.use_proxy = use_proxy and INFRA_AVAILABLE
        self.use_cache = use_cache and INFRA_AVAILABLE

        # Initialize infrastructure components
        self.geo_selector: Optional['GeoProxySelector'] = None
        self.cache: Optional['ResponseCache'] = None
        self.stealth: Optional['StealthSession'] = None
        self.date_parser: Optional['UniversalDateParser'] = None
        self.company_ner: Optional['InternationalCompanyNER'] = None
        self.incremental: Optional['IncrementalScraper'] = None

        self._init_infrastructure()

        # Stats tracking
        self.stats = {
            "requests_made": 0,
            "cache_hits": 0,
            "proxy_used": 0,
            "questions_found": 0,
        }

    def _init_infrastructure(self):
        """Initialize all infrastructure components if available."""
        if not INFRA_AVAILABLE:
            print("[programmers_kr] Infrastructure not available, using basic mode")
            return

        try:
            # Korea geo-proxy selector (CRITICAL for Korean sites)
            self.geo_selector = GeoProxySelector(ProxyPool())
            print("[programmers_kr] Korea geo-proxy enabled")
        except Exception as e:
            print(f"[programmers_kr] Proxy init failed: {e}")

        try:
            # Response cache with 6 hour TTL
            self.cache = ResponseCache(ttl=3600 * 6)
            print("[programmers_kr] Response cache enabled")
        except Exception as e:
            print(f"[programmers_kr] Cache init failed: {e}")

        try:
            # Stealth session for anti-detection
            self.stealth = create_stealth_session(
                min_delay=1.0,
                max_delay=3.0,
                requests_per_minute=20  # Korean sites rate limit aggressively
            )
            print("[programmers_kr] Stealth mode enabled")
        except Exception as e:
            print(f"[programmers_kr] Stealth init failed: {e}")

        try:
            # Korean date parser for formats like "3일 전", "어제", "2024년 4월 15일"
            self.date_parser = UniversalDateParser()
            print("[programmers_kr] Korean date parser enabled")
        except Exception as e:
            print(f"[programmers_kr] Date parser init failed: {e}")

        try:
            # Korean company name recognition (카카오, 네이버, 삼성, etc.)
            self.company_ner = InternationalCompanyNER()
            print("[programmers_kr] Korean company NER enabled")
        except Exception as e:
            print(f"[programmers_kr] Company NER init failed: {e}")

        try:
            # Incremental scraper for tracking seen items
            self.incremental = IncrementalScraper('programmers_kr')
            print("[programmers_kr] Incremental scraping enabled")
        except Exception as e:
            print(f"[programmers_kr] Incremental init failed: {e}")

    def _get_request_config(self, url: str) -> Dict[str, Any]:
        """Get request configuration with proxies and headers.

        Args:
            url: URL to request

        Returns:
            Dict with headers, proxies, timeout
        """
        config = {
            "headers": HEADERS.copy(),
            "timeout": REQUEST_TIMEOUT,
            "proxies": None,
            "verify": False,  # Some Korean sites have cert issues
        }

        # Add stealth headers if available
        if self.stealth:
            stealth_config = self.stealth.get_request_config(url)
            config["headers"].update(stealth_config.get("headers", {}))

        # Add Korea proxy if available (CRITICAL for Korean sites)
        if self.geo_selector:
            try:
                # programmers.co.kr works better with Korean IPs
                proxy = self.geo_selector.select_proxy(url)
                if proxy:
                    config["proxies"] = proxy.proxy_dict
                    self.stats["proxy_used"] += 1
            except Exception:
                pass

        return config

    def _wait_rate_limit(self):
        """Wait according to stealth session rate limiter."""
        if self.stealth:
            if not self.stealth.before_request():
                time.sleep(2.0)  # Default delay if rate limited
        else:
            time.sleep(1.5)  # Fallback delay for Korean sites

    def _record_response(self, status_code: int):
        """Record response for adaptive rate limiting."""
        if self.stealth:
            self.stealth.after_request(status_code)

    def _fetch_with_cache(self, url: str) -> Optional[str]:
        """Fetch URL with caching support.

        Args:
            url: URL to fetch

        Returns:
            Response text or None on error
        """
        # Check cache first
        if self.cache:
            cached = self.cache.get(url)
            if cached:
                self.stats["cache_hits"] += 1
                return cached

        # Rate limit
        self._wait_rate_limit()

        # Make request
        config = self._get_request_config(url)
        try:
            response = requests.get(url, **config)
            self.stats["requests_made"] += 1
            self._record_response(response.status_code)

            if response.status_code == 200:
                text = response.text
                # Cache successful response
                if self.cache:
                    self.cache.set(url, text)
                return text
            else:
                print(f"[programmers_kr] HTTP {response.status_code} for {url}")
                return None

        except requests.RequestException as e:
            print(f"[programmers_kr] Request error: {e}")
            self._record_response(500)  # Treat as server error
            return None

    def parse_korean_date(self, date_text: str) -> Optional[datetime]:
        """Parse Korean relative date like '3일 전'.

        Uses UniversalDateParser if available, which handles:
        - Relative: 3일 전, 어제, 오늘, 방금
        - Absolute: 2024년 4월 15일, 2024.04.15

        Args:
            date_text: Korean date string

        Returns:
            datetime object or None
        """
        if not date_text:
            return None

        # Try infrastructure date parser first (handles 15+ languages)
        if self.date_parser:
            try:
                result = self.date_parser.parse(date_text, language="ko")
                if result and result.date:
                    return result.date
            except Exception:
                pass

        # Fallback: manual Korean date parsing
        now = datetime.utcnow()

        # Korean relative patterns
        patterns = [
            (r'(\d+)\s*분\s*전', lambda m: now - timedelta(minutes=int(m.group(1)))),
            (r'(\d+)\s*시간\s*전', lambda m: now - timedelta(hours=int(m.group(1)))),
            (r'(\d+)\s*일\s*전', lambda m: now - timedelta(days=int(m.group(1)))),
            (r'(\d+)\s*주\s*전', lambda m: now - timedelta(weeks=int(m.group(1)))),
            (r'(\d+)\s*개월\s*전', lambda m: now - timedelta(days=int(m.group(1)) * 30)),
            (r'(\d+)\s*달\s*전', lambda m: now - timedelta(days=int(m.group(1)) * 30)),
            (r'어제', lambda m: now - timedelta(days=1)),
            (r'오늘', lambda m: now),
            (r'방금', lambda m: now),
            (r'그저께', lambda m: now - timedelta(days=2)),
            (r'지난\s*주', lambda m: now - timedelta(weeks=1)),
            (r'지난\s*달', lambda m: now - timedelta(days=30)),
            (r'작년', lambda m: now - timedelta(days=365)),
            # Absolute date: 2024년 4월 15일
            (r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일',
             lambda m: datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))),
            # Absolute date: 2024.04.15
            (r'(\d{4})\.(\d{1,2})\.(\d{1,2})',
             lambda m: datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))),
            # Absolute date: 2024-04-15
            (r'(\d{4})-(\d{1,2})-(\d{1,2})',
             lambda m: datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))),
        ]

        for pattern, handler in patterns:
            match = re.search(pattern, date_text)
            if match:
                try:
                    return handler(match)
                except Exception:
                    continue

        return None

    def fetch_problem_list(self, page: int = 1, per_page: int = 20) -> List[Dict]:
        """Fetch problems from Programmers problem list page.

        Args:
            page: Page number to fetch
            per_page: Number of problems per page

        Returns:
            List of raw problem dicts
        """
        url = f"{PROBLEMS_URL}?page={page}&perPage={per_page}"

        html = self._fetch_with_cache(url)
        if not html:
            return []

        soup = BeautifulSoup(html, "html.parser")
        problems = []

        # Find problem cards
        for card in soup.select(".algorithm-list tbody tr, .challenge-list li, [class*='challenge']"):
            try:
                # Extract title
                title_elem = card.select_one("a, .title, [class*='title']")
                if not title_elem:
                    continue

                title = title_elem.get_text(strip=True)
                href = title_elem.get("href", "")

                # Extract difficulty
                level_elem = card.select_one("[class*='level'], .difficulty, span[class*='lv']")
                level = level_elem.get_text(strip=True) if level_elem else ""

                # Extract tags
                tag_elems = card.select(".tag, [class*='tag'], .topic")
                tags = [t.get_text(strip=True) for t in tag_elems if t.get_text(strip=True)]

                # Extract company if tagged
                company_elem = card.select_one("[class*='company'], .partner")
                company = company_elem.get_text(strip=True) if company_elem else ""

                # Check for company in title or tags
                if not company:
                    company = self._extract_company_from_title(title) or ""
                    for tag in tags:
                        if not company:
                            company = self._extract_company_from_title(tag) or ""

                # Extract date if available
                date_elem = card.select_one("[class*='date'], .created, time")
                date_text = date_elem.get_text(strip=True) if date_elem else ""
                posted_date = self.parse_korean_date(date_text) if date_text else None

                problems.append({
                    "title": title,
                    "url": BASE_URL + href if href.startswith("/") else href,
                    "level": level,
                    "tags": tags,
                    "company": company,
                    "posted_date": posted_date,
                })

            except Exception as e:
                print(f"[programmers_kr] Error parsing problem card: {e}")
                continue

        return problems

    def _extract_company_from_title(self, title: str) -> Optional[str]:
        """Extract company name from problem title.

        Uses InternationalCompanyNER if available for Korean company names
        (카카오, 네이버, 삼성, etc.) with parent company resolution.
        """
        # Try infrastructure company NER first (handles Korean, Japanese, Chinese names)
        if self.company_ner:
            try:
                matches = self.company_ner.find_companies_in_text(title)
                if matches:
                    # Return the first match's canonical name
                    _, canonical, _ = matches[0]
                    return canonical.capitalize()
            except Exception:
                pass

        # Fallback: manual Korean company matching
        title_lower = title.lower()
        for company, aliases in KOREAN_COMPANIES.items():
            for alias in aliases:
                if alias.lower() in title_lower:
                    return company.capitalize()
        return None

    def fetch_company_challenges(self) -> List[Dict]:
        """Fetch company-sponsored coding challenges."""
        problems = []

        # Scrape company tag searches
        for company, aliases in KOREAN_COMPANIES.items():
            for alias in aliases[:1]:  # Just use first alias for search
                search_url = f"{PROBLEMS_URL}?q={alias}"

                html = self._fetch_with_cache(search_url)
                if not html:
                    continue

                soup = BeautifulSoup(html, "html.parser")

                for card in soup.select("tr, li, [class*='challenge'], [class*='problem']"):
                    title_elem = card.select_one("a")
                    if title_elem:
                        title = title_elem.get_text(strip=True)
                        href = title_elem.get("href", "")

                        # Check if actually related to company
                        if any(a.lower() in title.lower() for a in aliases):
                            problems.append({
                                "title": title,
                                "url": BASE_URL + href if href.startswith("/") else href,
                                "company": company.capitalize(),
                                "tags": [],
                                "level": "",
                                "posted_date": None,
                            })

        return problems

    def fetch_recent_problems(self, months: int = 5) -> List[Dict]:
        """Fetch problems from the past N months.

        Args:
            months: Number of months to look back

        Returns:
            List of problem dicts with metadata
        """
        cutoff_date = datetime.utcnow() - timedelta(days=months * 30)
        all_problems = []
        seen_urls = set()

        # Fetch multiple pages of problems
        for page in range(1, 11):  # First 10 pages
            problems = self.fetch_problem_list(page=page)
            if not problems:
                break

            for problem in problems:
                url = problem.get("url", "")
                if url and url not in seen_urls:
                    # Filter by date if available
                    posted_date = problem.get("posted_date")
                    if posted_date and posted_date < cutoff_date:
                        continue

                    seen_urls.add(url)
                    all_problems.append(problem)

        # Also fetch company-specific challenges
        company_problems = self.fetch_company_challenges()
        for problem in company_problems:
            url = problem.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                all_problems.append(problem)

        print(f"[programmers_kr] Fetched {len(all_problems)} problems")
        return all_problems

    def convert_to_interview_question(self, problem: Dict) -> Optional[InterviewQuestion]:
        """Convert raw problem dict to InterviewQuestion."""
        title = problem.get("title", "")
        if not title:
            return None

        company = problem.get("company", "") or "Korean Tech"
        url = problem.get("url", "")
        level = problem.get("level", "")
        tags = problem.get("tags", [])
        posted_date = problem.get("posted_date")

        # Parse difficulty
        difficulty = parse_difficulty(level)

        # Extract topics from tags
        topics = extract_topics(tags)

        # Determine question type
        question_type = "coding"
        if any(t in topics for t in ["system_design", "design"]):
            question_type = "system_design"

        # Generate ID
        question_id = generate_question_id("programmers_kr", title, company)

        # Add source-specific tags
        all_tags = topics + ["korean", "programmers_kr"]
        if company and company != "Korean Tech":
            all_tags.append(company.lower().replace(" ", "_"))

        self.stats["questions_found"] += 1

        return InterviewQuestion(
            id=question_id,
            company=company,
            position="Software Engineer",
            question_type=question_type,
            difficulty=difficulty,
            question_text=title,
            source="programmers_kr",
            source_url=url if url else f"{BASE_URL}/learn/challenges",
            posted_date=posted_date,
            tags=list(set(all_tags)),
        )

    def scrape(self, months: int = 5) -> List[InterviewQuestion]:
        """Main scrape method.

        Uses production infrastructure if available:
        - GeoProxySelector for Korea proxies
        - ResponseCache for caching
        - IncrementalScraper for tracking seen items
        - Monitoring for metrics

        Args:
            months: Number of months to look back

        Returns:
            List of InterviewQuestion objects
        """
        print(f"[programmers_kr] Scraping (past {months} months)...")
        if INFRA_AVAILABLE:
            print("[programmers_kr] Using infrastructure: proxies, caching, company NER")

        # Fetch problems
        raw_problems = self.fetch_recent_problems(months=months)

        # Convert to InterviewQuestion objects
        questions = []
        for problem in raw_problems:
            # Skip already-seen problems if incremental scraping enabled
            if self.incremental:
                problem_id = problem.get("url", "") or problem.get("title", "")
                if self.incremental.has_seen(problem_id):
                    continue

            question = self.convert_to_interview_question(problem)
            if question:
                questions.append(question)
                # Mark as seen
                if self.incremental:
                    self.incremental.mark_seen(problem.get("url", "") or problem.get("title", ""))

        # Sort by company (company-sponsored first)
        questions.sort(key=lambda q: (q.company is None, q.company or ""))

        print(f"[programmers_kr] Extracted {len(questions)} questions")
        print(f"[programmers_kr] Stats: {self.stats}")

        # Log company distribution
        companies = {}
        for q in questions:
            company = q.company or "General"
            companies[company] = companies.get(company, 0) + 1

        print("[programmers_kr] Company distribution:")
        for company, count in sorted(companies.items(), key=lambda x: -x[1])[:10]:
            print(f"  {company}: {count}")

        # Save incremental state
        if self.incremental:
            self.incremental.save_checkpoint(questions_count=len(questions))

        return questions


# Helper functions (module-level for backward compatibility)
def generate_question_id(source: str, title: str, company: str) -> str:
    """Generate a unique ID for a question."""
    content = f"{source}:{title}:{company}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def parse_difficulty(text: str) -> str:
    """Parse difficulty level from text."""
    text_lower = text.lower().replace(" ", "").replace("-", "")
    for key, difficulty in DIFFICULTY_MAP.items():
        if key in text_lower:
            return difficulty
    return "medium"  # Default


def extract_topics(tags: List[str]) -> List[str]:
    """Convert Korean tags to English topic names."""
    topic_map = {
        "해시": "hash",
        "스택/큐": "stack_queue",
        "스택": "stack",
        "큐": "queue",
        "힙": "heap",
        "정렬": "sorting",
        "완전탐색": "brute_force",
        "그리디": "greedy",
        "동적프로그래밍": "dynamic_programming",
        "dp": "dynamic_programming",
        "깊이/너비 우선 탐색": "dfs_bfs",
        "dfs": "dfs_bfs",
        "bfs": "dfs_bfs",
        "이분탐색": "binary_search",
        "그래프": "graph",
        "트리": "tree",
        "문자열": "string",
        "구현": "implementation",
        "시뮬레이션": "simulation",
        "백트래킹": "backtracking",
        "투포인터": "two_pointer",
        "슬라이딩윈도우": "sliding_window",
        "수학": "math",
        "비트마스킹": "bit_manipulation",
        "최단경로": "shortest_path",
        "union-find": "union_find",
        "최소신장트리": "mst",
        "세그먼트트리": "segment_tree",
        "다이나믹프로그래밍": "dynamic_programming",
        "분할정복": "divide_and_conquer",
        "재귀": "recursion",
        "탐욕법": "greedy",
    }

    result = []
    for tag in tags:
        tag_lower = tag.lower().replace(" ", "")
        for korean, english in topic_map.items():
            if korean in tag_lower:
                if english not in result:
                    result.append(english)
                break
        else:
            # Keep original if no mapping
            if tag and tag not in result:
                result.append(tag.lower().replace(" ", "_"))

    return result


# Main scraper function (backward compatible)
def scrape_programmers_kr(months: int = 5) -> List[InterviewQuestion]:
    """Main scraper function for Programmers.co.kr.

    Scrapes coding problems from Korea's largest coding test platform.
    Focuses on company-sponsored problems from Kakao, LINE, Naver, etc.

    Args:
        months: Number of months to look back (default 5)

    Returns:
        List of InterviewQuestion objects
    """
    scraper = ProgrammersKRScraper(use_proxy=True, use_cache=True)
    return scraper.scrape(months=months)


# Alias for consistent naming
def fetch_programmers_kr_problems(months: int = 5) -> List[InterviewQuestion]:
    """Alias for scrape_programmers_kr."""
    return scrape_programmers_kr(months)


if __name__ == "__main__":
    # Test the scraper
    questions = scrape_programmers_kr(months=5)

    print(f"\nSample questions:")
    for q in questions[:5]:
        print(f"  - {q.question_text}")
        print(f"    Company: {q.company or 'N/A'}")
        print(f"    Difficulty: {q.difficulty if q.difficulty else 'N/A'}")
        print(f"    Topics: {', '.join(q.tags[:3]) if q.tags else 'N/A'}")
        print()
