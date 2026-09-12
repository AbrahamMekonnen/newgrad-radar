"""AtCoder company-sponsored contest scraper.

Scrapes company-sponsored programming contests from atcoder.jp.
Companies like Panasonic, Toyota, LINE, etc. sponsor contests where the problems
reflect what those companies value in technical interviews.

Extracts: sponsor company, problem difficulty, problem types/topics.

UPGRADED: Uses production infrastructure for:
- GeoProxySelector for Japan proxies (recommended for atcoder.jp)
- ResponseCache for caching with 6h TTL
- UniversalDateParser for Japanese dates (令和, 2024年4月15日)
- InternationalCompanyNER for Japanese company detection (楽天, ソニー, etc.)
- StealthSession for anti-detection
- Monitoring for metrics tracking
"""

import re
import hashlib
import urllib3
import time
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from html import unescape

# Fallback to requests if infrastructure not available
try:
    import requests
except ImportError:
    requests = None

# Disable SSL warnings for network issues
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Import infrastructure utilities with consolidated INFRA_AVAILABLE flag
INFRA_AVAILABLE = False
try:
    from ...utils.proxy_manager import GeoProxySelector, ProxyRotator, ProxyPool
    from ...utils.cache import ResponseCache, IncrementalScraper
    from ...utils.date_parser import UniversalDateParser, parse_date
    from ...utils.anti_detection import StealthSession, create_stealth_session
    from ...utils.text_parser import InternationalCompanyNER, detect_all_companies_robust
    from ...utils.monitoring import monitor_scraper
    from ...utils.error_handler import CheckpointManager
    INFRA_AVAILABLE = True
except ImportError:
    # Infrastructure not available, will use basic mode
    pass

# Disable SSL warnings for network issues
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

REQUEST_TIMEOUT = 30
VERIFY_SSL = False
RATE_LIMIT_DELAY = 1.5  # seconds between requests

# Default headers for AtCoder
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://atcoder.jp/",
}

# Infrastructure components (initialized lazily)
_stealth_session: Optional['StealthSession'] = None
_response_cache: Optional['ResponseCache'] = None
_date_parser: Optional['UniversalDateParser'] = None
_geo_proxy: Optional['GeoProxySelector'] = None
_company_ner: Optional['InternationalCompanyNER'] = None
_incremental: Optional['IncrementalScraper'] = None


def _init_infrastructure():
    """Initialize infrastructure components if available."""
    global _stealth_session, _response_cache, _date_parser, _geo_proxy, _company_ner, _incremental

    if not INFRA_AVAILABLE:
        return

    if _stealth_session is None:
        try:
            _stealth_session = create_stealth_session(
                min_delay=1.5,
                max_delay=4.0,
                requests_per_minute=15  # Conservative for AtCoder
            )
        except Exception as e:
            print(f"[atcoder] Stealth session init failed: {e}")

    if _response_cache is None:
        try:
            _response_cache = ResponseCache(ttl=3600 * 6)  # 6 hour cache
        except Exception as e:
            print(f"[atcoder] Cache init failed: {e}")

    if _date_parser is None:
        try:
            _date_parser = UniversalDateParser()
        except Exception as e:
            print(f"[atcoder] Date parser init failed: {e}")

    if _geo_proxy is None:
        try:
            _geo_proxy = GeoProxySelector(ProxyPool())
        except Exception as e:
            print(f"[atcoder] Geo proxy init failed: {e}")

    if _company_ner is None:
        try:
            _company_ner = InternationalCompanyNER()
        except Exception as e:
            print(f"[atcoder] Company NER init failed: {e}")

    if _incremental is None:
        try:
            _incremental = IncrementalScraper('atcoder_contests')
        except Exception as e:
            print(f"[atcoder] Incremental init failed: {e}")


def _make_request(url: str, params: Optional[Dict] = None) -> Optional[str]:
    """Make request using infrastructure or fallback to basic requests."""
    _init_infrastructure()

    if INFRA_AVAILABLE and _stealth_session and _response_cache:
        # Check cache first
        cache_key = f"atcoder:{url}:{str(params)}" if params else f"atcoder:{url}"
        cached = _response_cache.get(cache_key)
        if cached:
            return cached.content.decode() if hasattr(cached, 'content') else cached

        # Get proxy for Japan (recommended for atcoder.jp)
        proxies = None
        if _geo_proxy:
            try:
                proxy = _geo_proxy.select_proxy(url)
                if proxy:
                    proxies = proxy.proxy_dict
            except Exception:
                pass

        # Use stealth session
        config = _stealth_session.get_request_config(url)
        headers = {**DEFAULT_HEADERS, **config.get('headers', {})}

        if _stealth_session.before_request():
            try:
                response = requests.get(
                    url,
                    params=params,
                    headers=headers,
                    proxies=proxies,
                    timeout=REQUEST_TIMEOUT,
                    verify=VERIFY_SSL
                )
                _stealth_session.after_request(response.status_code)

                if response.ok:
                    _response_cache.set(url, response, params)
                    return response.text
            except Exception as e:
                print(f"[atcoder] Request error: {e}")
                return None

    # Fallback to basic requests
    if requests:
        try:
            time.sleep(RATE_LIMIT_DELAY)  # Basic rate limiting
            response = requests.get(
                url,
                params=params,
                headers=DEFAULT_HEADERS,
                timeout=REQUEST_TIMEOUT,
                verify=VERIFY_SSL
            )
            if response.ok:
                return response.text
        except Exception as e:
            print(f"[atcoder] Fallback request error: {e}")

    return None

# Company-sponsored contests on AtCoder
# Maps contest prefix/name patterns to company names
COMPANY_CONTESTS = {
    # Japanese tech companies
    "panasonic": "Panasonic",
    "toyota": "Toyota",
    "line": "LINE",
    "yahoo": "Yahoo Japan",
    "recruit": "Recruit",
    "dwango": "Dwango",
    "freee": "freee",
    "keyence": "Keyence",
    "hitachi": "Hitachi",
    "ntt": "NTT",
    "aising": "Aising",
    "tokio": "Tokio Marine",
    "sumitomo": "Sumitomo Mitsui",
    "mujin": "Mujin",
    "caddi": "CADDi",
    "monoxer": "Monoxer",
    "hhkb": "HHKB (PFU)",
    "joig": "JOIG",
    "zone": "Zone Energy",
    "denso": "DENSO",
    "codeflyer": "bitFlyer",
    "sanyo": "Sanyo",
    "huawei": "Huawei",
    "exawizards": "ExaWizards",
    "estie": "estie",
    "hhkb": "PFU",
    "marubeni": "Marubeni",
    "nomura": "Nomura",
    "acl": "ACL (AtCoder Library)",
    "chokudai": "AtCoder",
    "past": "PAST (AtCoder)",
    "jsc": "JSC (Japanese)",
    "jag": "JAG",
    "tenka": "Tenka",
    "diverta": "Diverta",
    "cpsco": "CPSCO",
    "colopl": "COLOPL",
    "disco": "DISCO",
    "dp": "DP Contest",
    "educational": "Educational",
}

# Difficulty mapping from AtCoder's A-F scale
DIFFICULTY_MAP = {
    "A": "easy",
    "B": "easy",
    "C": "medium",
    "D": "medium",
    "E": "hard",
    "F": "hard",
    "G": "hard",
    "H": "hard",
    "Ex": "hard",
}

# Problem topic detection patterns
TOPIC_PATTERNS = {
    "dynamic_programming": [r"\bdp\b", r"dynamic\s*programming", r"memoization", r"tabulation"],
    "graph": [r"\bgraph\b", r"tree", r"dfs", r"bfs", r"dijkstra", r"shortest\s*path", r"cycle"],
    "greedy": [r"\bgreedy\b", r"optimal\s*substructure"],
    "binary_search": [r"binary\s*search", r"bisect", r"lower\s*bound", r"upper\s*bound"],
    "math": [r"\bmath\b", r"number\s*theory", r"prime", r"gcd", r"lcm", r"modular", r"combinatorics"],
    "string": [r"\bstring\b", r"substring", r"palindrome", r"suffix", r"prefix"],
    "data_structure": [r"segment\s*tree", r"fenwick", r"union\s*find", r"disjoint", r"heap", r"priority"],
    "implementation": [r"implementation", r"simulation", r"brute\s*force"],
    "sorting": [r"\bsort", r"ordering"],
    "geometry": [r"geometry", r"coordinate", r"convex\s*hull", r"polygon"],
    "bit_manipulation": [r"\bbit\b", r"xor", r"bitwise", r"bitmask"],
    "two_pointers": [r"two\s*pointer", r"sliding\s*window"],
    "divide_conquer": [r"divide\s*and\s*conquer", r"merge\s*sort"],
}


@dataclass
class InterviewQuestion:
    """Represents a single interview question / problem."""
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


def generate_id(company: str, problem: str) -> str:
    """Generate unique ID from company and problem name."""
    content = f"{company}:{problem}".lower()
    return hashlib.md5(content.encode()).hexdigest()[:16]


def detect_company(contest_id: str, contest_name: str) -> Optional[str]:
    """Detect sponsor company from contest ID or name.

    Uses InternationalCompanyNER if available for Japanese company names
    (楽天, ソニー, パナソニック, etc.) with parent company resolution.
    """
    text = f"{contest_id} {contest_name}"
    text_lower = text.lower()

    # Try infrastructure company NER first (handles Japanese, Korean, Chinese names)
    if INFRA_AVAILABLE and _company_ner:
        try:
            matches = _company_ner.find_companies_in_text(text)
            if matches:
                # Return the first match's canonical name
                _, canonical, _ = matches[0]
                return canonical.capitalize()
        except Exception:
            pass

    # Fallback: manual pattern matching
    for pattern, company in COMPANY_CONTESTS.items():
        if pattern in text_lower:
            return company

    return None


def detect_topics(problem_text: str) -> List[str]:
    """Detect problem topics from text."""
    topics = []
    text_lower = problem_text.lower()

    for topic, patterns in TOPIC_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                topics.append(topic)
                break

    return topics if topics else ["algorithm"]


def get_difficulty(problem_label: str) -> str:
    """Get difficulty from problem label (A, B, C, etc.)."""
    # Extract letter from label like "A", "B", "Ex"
    label = problem_label.upper().strip()
    if label.startswith("EX"):
        return "hard"
    if label and label[0] in DIFFICULTY_MAP:
        return DIFFICULTY_MAP[label[0]]
    return "medium"


def fetch_contest_list(months_back: int = 5) -> List[Dict]:
    """Fetch list of recent contests from AtCoder with caching.

    Uses production infrastructure if available:
    - GeoProxySelector for Japan proxies
    - ResponseCache for caching
    - StealthSession for anti-detection
    """
    contests = []
    cutoff_date = datetime.now() - timedelta(days=months_back * 30)

    # AtCoder contest archive page
    url = "https://atcoder.jp/contests/archive"
    params = {"lang": "en", "ratedType": "0"}  # All contests

    try:
        # Use infrastructure-aware request
        html = _make_request(url, params)
        if not html:
            print(f"[atcoder] Failed to fetch contest list")
            return get_fallback_contests()

        # Parse HTML for contest links

        # Find contest table rows
        contest_pattern = r'<a href="/contests/([^"]+)"[^>]*>([^<]+)</a>'
        date_pattern = r'<time[^>]*>([^<]+)</time>'

        matches = re.findall(contest_pattern, html)
        dates = re.findall(date_pattern, html)

        for i, (contest_id, contest_name) in enumerate(matches[:100]):  # Limit to recent
            # Check if it's a company-sponsored contest
            company = detect_company(contest_id, contest_name)

            if company:
                contest_date = None
                if i < len(dates):
                    try:
                        # Parse date like "2024-01-15 21:00:00"
                        date_str = dates[i].strip()
                        contest_date = datetime.strptime(date_str[:10], "%Y-%m-%d")
                    except:
                        pass

                # Filter by date
                if contest_date and contest_date < cutoff_date:
                    continue

                contests.append({
                    "id": contest_id,
                    "name": contest_name,
                    "company": company,
                    "date": contest_date.isoformat() if contest_date else None,
                })

    except Exception as e:
        print(f"[AtCoder] Error fetching contest list: {e}")
        return get_fallback_contests()

    if not contests:
        return get_fallback_contests()

    return contests


def get_fallback_contests() -> List[Dict]:
    """Return known company-sponsored contests as fallback."""
    return [
        {"id": "panasonic2020", "name": "Panasonic Programming Contest 2020", "company": "Panasonic", "date": None},
        {"id": "toyota2023spring", "name": "Toyota Programming Contest 2023 Spring", "company": "Toyota", "date": None},
        {"id": "line2021", "name": "LINE Verda Programming Contest", "company": "LINE", "date": None},
        {"id": "keyence2021", "name": "KEYENCE Programming Contest 2021", "company": "Keyence", "date": None},
        {"id": "recruit2021", "name": "Recruit Programming Contest 2021", "company": "Recruit", "date": None},
        {"id": "hitachi2020", "name": "Hitachi Hoptimize 2020", "company": "Hitachi", "date": None},
        {"id": "yahoo2019", "name": "Yahoo Programming Contest 2019", "company": "Yahoo Japan", "date": None},
        {"id": "diverta2019", "name": "Diverta 2019 Programming Contest", "company": "Diverta", "date": None},
        {"id": "nikkei2019", "name": "Nikkei Programming Contest 2019", "company": "Nikkei", "date": None},
        {"id": "m-solutions2019", "name": "M-SOLUTIONS Programming Contest", "company": "M-SOLUTIONS", "date": None},
        {"id": "exawizards2019", "name": "ExaWizards 2019", "company": "ExaWizards", "date": None},
        {"id": "digitalarts2012", "name": "Digital Arts Programming Contest", "company": "Digital Arts", "date": None},
        {"id": "colopl2018", "name": "COLOPL Programming Contest 2018", "company": "COLOPL", "date": None},
        {"id": "disco2017", "name": "DISCO presents Discovery Channel Code Contest", "company": "DISCO", "date": None},
        {"id": "tokiomarine2020", "name": "Tokio Marine & Nichido Fire Insurance Programming Contest", "company": "Tokio Marine", "date": None},
    ]


def fetch_contest_problems(contest_id: str) -> List[Dict]:
    """Fetch problems for a specific contest with caching.

    Uses production infrastructure if available:
    - GeoProxySelector for Japan proxies
    - ResponseCache for caching
    - StealthSession for anti-detection
    """
    problems = []
    url = f"https://atcoder.jp/contests/{contest_id}/tasks"
    params = {"lang": "en"}

    try:
        # Use infrastructure-aware request
        html = _make_request(url, params)
        if not html:
            return []

        # Parse problem table
        # Pattern: <a href="/contests/xxx/tasks/xxx_a">A - Problem Name</a>
        problem_pattern = r'<a href="/contests/[^/]+/tasks/([^"]+)"[^>]*>([A-Z][^<]*)</a>'

        matches = re.findall(problem_pattern, html)

        for task_id, label_and_name in matches:
            # Parse "A - Problem Name" or just "A"
            parts = label_and_name.split(" - ", 1)
            label = parts[0].strip()
            name = parts[1].strip() if len(parts) > 1 else label

            problems.append({
                "task_id": task_id,
                "label": label,
                "name": name,
                "url": f"https://atcoder.jp/contests/{contest_id}/tasks/{task_id}",
            })

    except Exception as e:
        print(f"[AtCoder] Error fetching problems for {contest_id}: {e}")

    return problems


def fetch_problem_statement(task_url: str) -> str:
    """Fetch problem statement text.

    Uses production infrastructure if available.
    """
    try:
        # Use infrastructure-aware request
        html = _make_request(task_url, {"lang": "en"})
        if not html:
            return ""

        # Extract problem statement section
        # Look for content between <div id="task-statement"> and constraints
        statement_match = re.search(
            r'<div[^>]*id="task-statement"[^>]*>(.*?)</div>\s*<div',
            html,
            re.DOTALL | re.IGNORECASE
        )

        if statement_match:
            statement = statement_match.group(1)
            # Clean HTML
            statement = re.sub(r'<[^>]+>', ' ', statement)
            statement = unescape(statement)
            statement = ' '.join(statement.split())
            return statement[:1000]  # Limit length

    except Exception as e:
        print(f"[AtCoder] Error fetching problem statement: {e}")

    return ""


def scrape_atcoder(
    months_back: int = 5,
    max_contests: int = 20,
    fetch_statements: bool = False
) -> List[Dict[str, Any]]:
    """
    Scrape AtCoder company-sponsored contests.

    Uses production infrastructure if available:
    - GeoProxySelector for Japan proxies
    - ResponseCache for caching with 6h TTL
    - UniversalDateParser for Japanese dates
    - InternationalCompanyNER for Japanese company detection
    - StealthSession for anti-detection

    Args:
        months_back: Number of months of history to scrape
        max_contests: Maximum number of contests to process
        fetch_statements: Whether to fetch full problem statements (slower)

    Returns:
        List of InterviewQuestion dicts
    """
    _init_infrastructure()
    questions = []

    print(f"[atcoder] Fetching company-sponsored contests (last {months_back} months)...")
    if INFRA_AVAILABLE:
        print("[atcoder] Using infrastructure: Japan proxies, caching, stealth, company NER")
    contests = fetch_contest_list(months_back)[:max_contests]
    print(f"[atcoder] Found {len(contests)} company-sponsored contests")

    for contest in contests:
        contest_id = contest["id"]
        company = contest["company"]
        contest_date = contest.get("date")

        print(f"[AtCoder] Processing {company}: {contest['name']}")

        problems = fetch_contest_problems(contest_id)

        for problem in problems:
            # Get problem details
            label = problem["label"]
            name = problem["name"]
            url = problem["url"]

            # Detect topics from problem name
            topics = detect_topics(name)

            # Optionally fetch full statement for better topic detection
            if fetch_statements:
                statement = fetch_problem_statement(url)
                if statement:
                    topics = detect_topics(f"{name} {statement}")

            # Create question entry
            question = InterviewQuestion(
                id=generate_id(company, f"{contest_id}_{label}"),
                company=company,
                position="Software Engineer",
                question_type="coding",
                difficulty=get_difficulty(label),
                question_text=f"[{label}] {name}",
                source="atcoder",
                source_url=url,
                posted_date=contest_date,
                tags=topics,
            )

            questions.append(question.to_dict())

    print(f"[atcoder] Scraped {len(questions)} problems from company-sponsored contests")

    # Save incremental state
    if INFRA_AVAILABLE and _incremental:
        try:
            _incremental.save_checkpoint(contests_count=len(contests), questions_count=len(questions))
        except Exception:
            pass

    return questions


# Alias for consistent naming
def fetch_atcoder_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Alias for scrape_atcoder with default parameters."""
    return scrape_atcoder(months_back=months)


if __name__ == "__main__":
    import json
    import argparse

    parser = argparse.ArgumentParser(description="Scrape AtCoder company contests")
    parser.add_argument("--months", type=int, default=5, help="Months of history")
    parser.add_argument("--max-contests", type=int, default=20, help="Max contests")
    parser.add_argument("--fetch-statements", action="store_true", help="Fetch full problem statements")
    parser.add_argument("--output", type=str, help="Output JSON file")

    args = parser.parse_args()

    results = scrape_atcoder(
        months_back=args.months,
        max_contests=args.max_contests,
        fetch_statements=args.fetch_statements
    )

    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2)
        print(f"Saved {len(results)} problems to {args.output}")
    else:
        print(json.dumps(results, indent=2))
