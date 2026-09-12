"""
Source Strategy Selector - Determines optimal scraping approach per source.

Decision factors:
1. API availability and rate limits
2. HTML anti-bot protections
3. Data completeness (API vs HTML)
4. Authentication requirements
5. Historical/deleted content access

Strategies:
- API: Official API with rate limiting
- HTML: BeautifulSoup/requests scraping
- HYBRID: API primary, HTML fallback or complement
- ARCHIVE: Wayback Machine / cache-based
- RSS: RSS/Atom feed parsing
- GRAPHQL: GraphQL API (subset of API)
- PROXY: Access via third-party mirrors/aggregators
"""

from enum import Enum
from dataclasses import dataclass
from typing import Optional, Dict, List, Callable, Any
import time
import random


class ScrapingMethod(Enum):
    API = "api"
    HTML = "html"
    HYBRID = "hybrid"
    ARCHIVE = "archive"
    RSS = "rss"
    GRAPHQL = "graphql"
    PROXY = "proxy"
    USER_SUBMISSION = "user_submission"


class AuthType(Enum):
    NONE = "none"
    API_KEY = "api_key"
    OAUTH = "oauth"
    SESSION_COOKIE = "session_cookie"
    BEARER_TOKEN = "bearer_token"


class Reliability(Enum):
    HIGH = "high"          # >95% success rate
    MEDIUM = "medium"      # 70-95% success rate
    LOW = "low"            # <70% success rate
    BLOCKED = "blocked"    # Actively blocks scraping


@dataclass
class SourceStrategy:
    """Configuration for scraping a specific source."""
    name: str
    method: ScrapingMethod
    fallback_method: Optional[ScrapingMethod] = None

    # Rate limiting
    requests_per_minute: int = 20
    requests_per_hour: int = 500
    min_delay_seconds: float = 1.0
    max_delay_seconds: float = 3.0
    jitter: bool = True  # Add random delay variation

    # Authentication
    auth_type: AuthType = AuthType.NONE
    auth_env_var: Optional[str] = None
    requires_login: bool = False

    # Reliability
    reliability: Reliability = Reliability.MEDIUM
    retry_count: int = 3
    retry_backoff: float = 2.0  # Exponential backoff multiplier

    # Data access
    has_historical_data: bool = True
    has_deleted_content: bool = False  # Can access deleted/removed content
    data_freshness_hours: int = 24  # How often to re-scrape

    # Technical
    api_base_url: Optional[str] = None
    html_base_url: Optional[str] = None
    user_agent: str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    headers: Optional[Dict[str, str]] = None
    cookies_required: bool = False

    # Content parsing
    supports_pagination: bool = True
    max_pages_per_query: int = 100
    items_per_page: int = 20

    # Notes
    notes: str = ""


# Source strategy configurations
SOURCE_STRATEGIES: Dict[str, SourceStrategy] = {
    # ============== HIGH-VALUE APIs ==============

    "github": SourceStrategy(
        name="GitHub",
        method=ScrapingMethod.API,
        fallback_method=ScrapingMethod.HTML,
        requests_per_minute=30,  # Authenticated: 5000/hr = 83/min
        requests_per_hour=5000,
        min_delay_seconds=0.5,
        auth_type=AuthType.BEARER_TOKEN,
        auth_env_var="GITHUB_TOKEN",
        reliability=Reliability.HIGH,
        api_base_url="https://api.github.com",
        html_base_url="https://github.com",
        has_historical_data=True,
        notes="Use GraphQL for complex queries. REST for simple searches."
    ),

    "github_gists": SourceStrategy(
        name="GitHub Gists",
        method=ScrapingMethod.API,
        requests_per_minute=30,
        auth_type=AuthType.BEARER_TOKEN,
        auth_env_var="GITHUB_TOKEN",
        reliability=Reliability.HIGH,
        api_base_url="https://api.github.com/gists",
        notes="Public gists searchable via code search API"
    ),

    "devto": SourceStrategy(
        name="Dev.to",
        method=ScrapingMethod.API,
        requests_per_minute=60,
        requests_per_hour=1000,
        min_delay_seconds=0.5,
        auth_type=AuthType.API_KEY,
        auth_env_var="DEVTO_API_KEY",
        reliability=Reliability.HIGH,
        api_base_url="https://dev.to/api",
        notes="Well-documented, generous limits. No auth needed for read."
    ),

    "hackernews": SourceStrategy(
        name="Hacker News (Algolia)",
        method=ScrapingMethod.API,
        requests_per_minute=100,  # Very generous
        requests_per_hour=3600,
        min_delay_seconds=0.3,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        api_base_url="https://hn.algolia.com/api/v1",
        has_historical_data=True,
        notes="Algolia search is fast and free. Use search_by_date for recent."
    ),

    "codeforces": SourceStrategy(
        name="Codeforces",
        method=ScrapingMethod.API,
        requests_per_minute=30,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        api_base_url="https://codeforces.com/api",
        notes="Well-documented API. Blog posts via HTML."
    ),

    "youtube": SourceStrategy(
        name="YouTube",
        method=ScrapingMethod.API,
        requests_per_minute=20,
        auth_type=AuthType.API_KEY,
        auth_env_var="YOUTUBE_API_KEY",
        reliability=Reliability.HIGH,
        api_base_url="https://www.googleapis.com/youtube/v3",
        notes="10k quota units/day. Search=100 units, video details=1 unit."
    ),

    # ============== GRAPHQL APIs ==============

    "leetcode": SourceStrategy(
        name="LeetCode",
        method=ScrapingMethod.GRAPHQL,
        fallback_method=ScrapingMethod.HTML,
        requests_per_minute=20,  # Rate limited heavily
        min_delay_seconds=3.0,
        max_delay_seconds=5.0,
        jitter=True,
        auth_type=AuthType.SESSION_COOKIE,
        reliability=Reliability.MEDIUM,
        api_base_url="https://leetcode.com/graphql",
        html_base_url="https://leetcode.com",
        requires_login=True,
        cookies_required=True,
        notes="GraphQL for discuss posts. Use LEETCODE_SESSION cookie."
    ),

    # ============== HYBRID (API + HTML) ==============

    "reddit": SourceStrategy(
        name="Reddit",
        method=ScrapingMethod.HYBRID,
        requests_per_minute=60,
        auth_type=AuthType.OAUTH,
        auth_env_var="REDDIT_CLIENT_ID,REDDIT_CLIENT_SECRET",
        reliability=Reliability.MEDIUM,
        api_base_url="https://oauth.reddit.com",
        html_base_url="https://old.reddit.com",  # old.reddit is more scrapable
        has_deleted_content=False,  # Pushshift for deleted
        notes="Official API for recent. Pushshift/Unddit for deleted content."
    ),

    "reddit_deleted": SourceStrategy(
        name="Reddit (Deleted Posts)",
        method=ScrapingMethod.PROXY,
        requests_per_minute=30,
        auth_type=AuthType.NONE,
        reliability=Reliability.LOW,  # Pushshift is unreliable post-2023
        api_base_url="https://api.pushshift.io/reddit",
        has_deleted_content=True,
        notes="Pushshift deprecated. Try camas.unddit.com or Arctic Shift dumps."
    ),

    "nowcoder": SourceStrategy(
        name="Nowcoder (牛客网)",
        method=ScrapingMethod.HYBRID,
        requests_per_minute=20,
        min_delay_seconds=2.0,
        auth_type=AuthType.SESSION_COOKIE,
        reliability=Reliability.MEDIUM,
        api_base_url="https://www.nowcoder.com/api",
        html_base_url="https://www.nowcoder.com",
        requires_login=True,
        notes="HTML for discuss, partial API for search. Chinese content."
    ),

    # ============== HTML SCRAPING ==============

    "1point3acres": SourceStrategy(
        name="1Point3Acres (一亩三分地)",
        method=ScrapingMethod.HTML,
        requests_per_minute=15,
        min_delay_seconds=3.0,
        max_delay_seconds=5.0,
        auth_type=AuthType.SESSION_COOKIE,
        reliability=Reliability.MEDIUM,
        html_base_url="https://www.1point3acres.com/bbs",
        requires_login=True,
        cookies_required=True,
        notes="Level-gated content. OA forum at /bbs/forum-259-1.html"
    ),

    "geeksforgeeks": SourceStrategy(
        name="GeeksforGeeks",
        method=ScrapingMethod.HTML,
        requests_per_minute=30,
        min_delay_seconds=1.0,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        html_base_url="https://www.geeksforgeeks.org",
        notes="Static pages, company-specific interview experiences."
    ),

    "careercup": SourceStrategy(
        name="CareerCup",
        method=ScrapingMethod.HTML,
        requests_per_minute=20,
        min_delay_seconds=2.0,
        auth_type=AuthType.NONE,
        reliability=Reliability.MEDIUM,
        html_base_url="https://www.careercup.com",
        notes="Historical FAANG questions. Check Wayback for old content."
    ),

    "glassdoor": SourceStrategy(
        name="Glassdoor",
        method=ScrapingMethod.ARCHIVE,
        fallback_method=ScrapingMethod.PROXY,
        requests_per_minute=10,
        min_delay_seconds=5.0,
        auth_type=AuthType.NONE,
        reliability=Reliability.LOW,
        html_base_url="https://www.glassdoor.com",
        notes="Heavily paywalled. Use Google cache, archive.org, regional domains."
    ),

    "blind": SourceStrategy(
        name="TeamBlind",
        method=ScrapingMethod.PROXY,
        reliability=Reliability.BLOCKED,
        requires_login=True,
        notes="Cannot scrape directly. Use Reddit mirrors, Levels.fyi crosspost."
    ),

    "ambitionbox": SourceStrategy(
        name="AmbitionBox (India)",
        method=ScrapingMethod.HTML,
        requests_per_minute=20,
        min_delay_seconds=2.0,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        html_base_url="https://www.ambitionbox.com",
        notes="Indian Glassdoor. Less anti-bot than Glassdoor."
    ),

    "atcoder": SourceStrategy(
        name="AtCoder",
        method=ScrapingMethod.HTML,
        requests_per_minute=20,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        html_base_url="https://atcoder.jp",
        notes="Company-sponsored contests. Parse contest metadata."
    ),

    "takeuforward": SourceStrategy(
        name="TakeUForward (Striver)",
        method=ScrapingMethod.HTML,
        requests_per_minute=30,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        html_base_url="https://takeuforward.org",
        notes="Striver's DSA sheet. Static content, highly structured."
    ),

    "codestudio": SourceStrategy(
        name="CodeStudio (Coding Ninjas)",
        method=ScrapingMethod.HTML,
        requests_per_minute=20,
        auth_type=AuthType.NONE,
        reliability=Reliability.MEDIUM,
        html_base_url="https://www.codingninjas.com/studio",
        notes="Company-tagged problems and interview experiences."
    ),

    # ============== RSS FEEDS ==============

    "medium": SourceStrategy(
        name="Medium",
        method=ScrapingMethod.RSS,
        requests_per_minute=30,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        api_base_url="https://medium.com/feed",
        notes="RSS bypasses paywall! Use /feed/tag/interview or /feed/@author"
    ),

    "substack": SourceStrategy(
        name="Substack",
        method=ScrapingMethod.RSS,
        fallback_method=ScrapingMethod.HTML,
        requests_per_minute=20,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        notes="Most Substacks have RSS at /feed. Parse /archive for full list."
    ),

    # ============== CHINESE PLATFORMS ==============

    "zhihu": SourceStrategy(
        name="Zhihu (知乎)",
        method=ScrapingMethod.HTML,
        requests_per_minute=15,
        min_delay_seconds=3.0,
        auth_type=AuthType.SESSION_COOKIE,
        reliability=Reliability.MEDIUM,
        html_base_url="https://www.zhihu.com",
        requires_login=True,
        notes="Chinese Quora. Heavy anti-bot. Rotate user agents."
    ),

    "juejin": SourceStrategy(
        name="Juejin (掘金)",
        method=ScrapingMethod.API,
        requests_per_minute=30,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        api_base_url="https://api.juejin.cn/content_api/v1",
        notes="Chinese dev platform. API for articles, HTML for comments."
    ),

    "csdn": SourceStrategy(
        name="CSDN",
        method=ScrapingMethod.HTML,
        fallback_method=ScrapingMethod.API,
        requests_per_minute=20,
        auth_type=AuthType.NONE,
        reliability=Reliability.MEDIUM,
        api_base_url="https://so.csdn.net/api/v3/search",
        html_base_url="https://blog.csdn.net",
        notes="Search API available. Article content via HTML."
    ),

    "bilibili": SourceStrategy(
        name="Bilibili",
        method=ScrapingMethod.API,
        requests_per_minute=30,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        api_base_url="https://api.bilibili.com/x/web-interface",
        notes="Video search API. Extract descriptions for interview content."
    ),

    # ============== KOREAN PLATFORMS ==============

    "programmers_kr": SourceStrategy(
        name="Programmers.co.kr",
        method=ScrapingMethod.HTML,
        requests_per_minute=20,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        html_base_url="https://programmers.co.kr",
        notes="Korean LeetCode. Company-specific coding tests."
    ),

    "jobplanet": SourceStrategy(
        name="JobPlanet (잡플래닛)",
        method=ScrapingMethod.HTML,
        requests_per_minute=15,
        min_delay_seconds=3.0,
        auth_type=AuthType.SESSION_COOKIE,
        reliability=Reliability.MEDIUM,
        html_base_url="https://www.jobplanet.co.kr",
        requires_login=True,
        notes="Korean Glassdoor. Interview section less paywalled."
    ),

    # ============== JAPANESE PLATFORMS ==============

    "openwork": SourceStrategy(
        name="OpenWork (Japan)",
        method=ScrapingMethod.HTML,
        requests_per_minute=15,
        min_delay_seconds=3.0,
        auth_type=AuthType.NONE,
        reliability=Reliability.MEDIUM,
        html_base_url="https://www.vorkers.com",
        notes="Japanese Glassdoor. Interview section at /companies/*/interviews"
    ),

    "qiita": SourceStrategy(
        name="Qiita",
        method=ScrapingMethod.API,
        requests_per_minute=30,
        auth_type=AuthType.API_KEY,
        auth_env_var="QIITA_API_KEY",
        reliability=Reliability.HIGH,
        api_base_url="https://qiita.com/api/v2",
        notes="Japanese dev platform. Well-documented API."
    ),

    # ============== UK/EU PLATFORMS ==============

    "wikijob": SourceStrategy(
        name="WikiJob",
        method=ScrapingMethod.HTML,
        requests_per_minute=30,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        html_base_url="https://www.wikijob.co.uk",
        notes="UK graduate interview database. Static content."
    ),

    "studentroom": SourceStrategy(
        name="TheStudentRoom",
        method=ScrapingMethod.HTML,
        requests_per_minute=20,
        auth_type=AuthType.NONE,
        reliability=Reliability.MEDIUM,
        html_base_url="https://www.thestudentroom.co.uk",
        notes="UK student forum. Interview threads in careers section."
    ),

    "kununu": SourceStrategy(
        name="Kununu (Germany)",
        method=ScrapingMethod.HTML,
        requests_per_minute=15,
        min_delay_seconds=3.0,
        auth_type=AuthType.NONE,
        reliability=Reliability.MEDIUM,
        html_base_url="https://www.kununu.com",
        notes="German Glassdoor. Interview section less restricted."
    ),

    # ============== RUSSIAN PLATFORMS ==============

    "habr": SourceStrategy(
        name="Habr",
        method=ScrapingMethod.HTML,
        requests_per_minute=20,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        html_base_url="https://habr.com",
        notes="Russian tech hub. Tag-based article search."
    ),

    # ============== ARCHIVE/PROXY ==============

    "wayback": SourceStrategy(
        name="Wayback Machine",
        method=ScrapingMethod.API,
        requests_per_minute=15,
        auth_type=AuthType.NONE,
        reliability=Reliability.HIGH,
        api_base_url="https://web.archive.org",
        has_historical_data=True,
        has_deleted_content=True,
        notes="CDX API for URL search. Memento for snapshots."
    ),

    "google_cache": SourceStrategy(
        name="Google Cache",
        method=ScrapingMethod.PROXY,
        requests_per_minute=10,
        reliability=Reliability.LOW,
        notes="webcache.googleusercontent.com. Unreliable, often blocked."
    ),

    # ============== MESSAGING PLATFORMS ==============

    "telegram": SourceStrategy(
        name="Telegram",
        method=ScrapingMethod.API,
        requests_per_minute=30,
        auth_type=AuthType.API_KEY,
        auth_env_var="TELEGRAM_API_ID,TELEGRAM_API_HASH",
        reliability=Reliability.HIGH,
        notes="Use telethon library. Requires phone auth on first run."
    ),

    "discord": SourceStrategy(
        name="Discord",
        method=ScrapingMethod.USER_SUBMISSION,
        reliability=Reliability.LOW,
        notes="No scraping API. Users submit invite links + screenshots."
    ),

    # ============== USER SUBMISSION ==============

    "glassdoor_submission": SourceStrategy(
        name="Glassdoor (User Submitted)",
        method=ScrapingMethod.USER_SUBMISSION,
        reliability=Reliability.HIGH,
        notes="Users paste Glassdoor URLs. Parse company/role from URL."
    ),

    "blind_submission": SourceStrategy(
        name="Blind (User Submitted)",
        method=ScrapingMethod.USER_SUBMISSION,
        reliability=Reliability.HIGH,
        notes="Users paste Blind post content or screenshots."
    ),
}


class SourceStrategySelector:
    """
    Selects and configures the optimal scraping strategy for a given source.

    Usage:
        selector = SourceStrategySelector()
        strategy = selector.get_strategy("leetcode")

        # Check if source should use API
        if selector.should_use_api("devto"):
            # Use API scraping

        # Get rate limit delay
        delay = selector.get_delay("github")
    """

    def __init__(self):
        self.strategies = SOURCE_STRATEGIES
        self._request_timestamps: Dict[str, List[float]] = {}

    def get_strategy(self, source: str) -> Optional[SourceStrategy]:
        """Get the strategy configuration for a source."""
        source_lower = source.lower().replace("-", "_").replace(" ", "_")
        return self.strategies.get(source_lower)

    def list_sources(self) -> List[str]:
        """List all configured sources."""
        return list(self.strategies.keys())

    def get_sources_by_method(self, method: ScrapingMethod) -> List[str]:
        """Get all sources that use a specific scraping method."""
        return [
            name for name, strategy in self.strategies.items()
            if strategy.method == method
        ]

    def get_sources_by_reliability(self, min_reliability: Reliability) -> List[str]:
        """Get sources with at least the specified reliability."""
        reliability_order = [Reliability.BLOCKED, Reliability.LOW, Reliability.MEDIUM, Reliability.HIGH]
        min_index = reliability_order.index(min_reliability)
        return [
            name for name, strategy in self.strategies.items()
            if reliability_order.index(strategy.reliability) >= min_index
        ]

    def should_use_api(self, source: str) -> bool:
        """Check if source should use API (vs HTML/other)."""
        strategy = self.get_strategy(source)
        if not strategy:
            return False
        return strategy.method in [ScrapingMethod.API, ScrapingMethod.GRAPHQL]

    def requires_auth(self, source: str) -> bool:
        """Check if source requires authentication."""
        strategy = self.get_strategy(source)
        if not strategy:
            return False
        return strategy.auth_type != AuthType.NONE or strategy.requires_login

    def get_delay(self, source: str) -> float:
        """
        Get the delay to use before next request.
        Includes jitter if configured.
        """
        strategy = self.get_strategy(source)
        if not strategy:
            return 1.0

        base_delay = strategy.min_delay_seconds
        if strategy.jitter:
            jitter_range = strategy.max_delay_seconds - strategy.min_delay_seconds
            base_delay += random.random() * jitter_range

        return base_delay

    def can_request(self, source: str) -> bool:
        """
        Check if we can make a request without exceeding rate limits.
        Uses sliding window rate limiting.
        """
        strategy = self.get_strategy(source)
        if not strategy:
            return True

        now = time.time()
        source_key = source.lower()

        if source_key not in self._request_timestamps:
            self._request_timestamps[source_key] = []

        # Clean old timestamps (older than 1 hour)
        self._request_timestamps[source_key] = [
            ts for ts in self._request_timestamps[source_key]
            if now - ts < 3600
        ]

        timestamps = self._request_timestamps[source_key]

        # Check per-minute limit
        recent_minute = sum(1 for ts in timestamps if now - ts < 60)
        if recent_minute >= strategy.requests_per_minute:
            return False

        # Check per-hour limit
        if len(timestamps) >= strategy.requests_per_hour:
            return False

        return True

    def record_request(self, source: str):
        """Record that a request was made (for rate limiting)."""
        source_key = source.lower()
        if source_key not in self._request_timestamps:
            self._request_timestamps[source_key] = []
        self._request_timestamps[source_key].append(time.time())

    def get_headers(self, source: str) -> Dict[str, str]:
        """Get request headers for a source."""
        strategy = self.get_strategy(source)
        if not strategy:
            return {"User-Agent": "Mozilla/5.0"}

        headers = {
            "User-Agent": strategy.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        }

        if strategy.headers:
            headers.update(strategy.headers)

        return headers

    def get_api_url(self, source: str) -> Optional[str]:
        """Get API base URL for a source."""
        strategy = self.get_strategy(source)
        return strategy.api_base_url if strategy else None

    def get_html_url(self, source: str) -> Optional[str]:
        """Get HTML base URL for a source."""
        strategy = self.get_strategy(source)
        return strategy.html_base_url if strategy else None

    def get_fallback_method(self, source: str) -> Optional[ScrapingMethod]:
        """Get fallback scraping method if primary fails."""
        strategy = self.get_strategy(source)
        return strategy.fallback_method if strategy else None

    def get_retry_config(self, source: str) -> tuple:
        """Get retry configuration (count, backoff_multiplier)."""
        strategy = self.get_strategy(source)
        if not strategy:
            return (3, 2.0)
        return (strategy.retry_count, strategy.retry_backoff)

    def summarize(self) -> str:
        """Generate a summary of all source strategies."""
        lines = ["# Source Strategy Summary\n"]

        by_method: Dict[ScrapingMethod, List[str]] = {}
        for name, strategy in self.strategies.items():
            method = strategy.method
            if method not in by_method:
                by_method[method] = []
            by_method[method].append(f"{name} ({strategy.reliability.value})")

        for method in ScrapingMethod:
            if method in by_method:
                lines.append(f"\n## {method.value.upper()}")
                for source in sorted(by_method[method]):
                    lines.append(f"  - {source}")

        return "\n".join(lines)


# Convenience functions for direct use
_selector = SourceStrategySelector()

def get_strategy(source: str) -> Optional[SourceStrategy]:
    """Get strategy for a source."""
    return _selector.get_strategy(source)

def get_delay(source: str) -> float:
    """Get delay before next request."""
    return _selector.get_delay(source)

def should_use_api(source: str) -> bool:
    """Check if source should use API."""
    return _selector.should_use_api(source)

def requires_auth(source: str) -> bool:
    """Check if source requires authentication."""
    return _selector.requires_auth(source)

def can_request(source: str) -> bool:
    """Check if we can make a request (rate limit check)."""
    return _selector.can_request(source)

def record_request(source: str):
    """Record that a request was made."""
    _selector.record_request(source)


if __name__ == "__main__":
    # Print summary
    selector = SourceStrategySelector()
    print(selector.summarize())

    # Example usage
    print("\n# Example: LeetCode strategy")
    lc = selector.get_strategy("leetcode")
    if lc:
        print(f"  Method: {lc.method.value}")
        print(f"  Auth: {lc.auth_type.value}")
        print(f"  Rate: {lc.requests_per_minute}/min")
        print(f"  Delay: {lc.min_delay_seconds}-{lc.max_delay_seconds}s")
