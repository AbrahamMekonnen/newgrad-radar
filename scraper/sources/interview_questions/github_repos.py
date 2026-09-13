"""GitHub Interview Question Repos Scraper.

Parses interview questions from curated community-maintained GitHub repos:
- yangshun/tech-interview-handbook (JSON structured, company-tagged)
- donnemartin/system-design-primer (markdown, system design questions)
- kdn251/interviews (markdown, DS&A problems)

Focuses on questions updated in the last 4-5 months.

Uses new infrastructure:
- ResponseCache: Caches API responses (6hr TTL)
- AdaptiveRateLimiter: Smart rate limiting (GitHub allows 5000/hr with auth)
- CheckpointManager: Resume large repo crawls
"""

import hashlib
import json
import os
import re
import requests
import urllib3
import time
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin

# Import infrastructure modules (unified wrapper)
try:
    from ...utils.scraper_infra import (
        InfrastructureContext,
        validate_batch,
        get_stealth_headers,
        get_proxy_for_url,
        cached_request,
        wait_for_rate_limit,
    )
    INFRA_AVAILABLE = True
except ImportError:
    INFRA_AVAILABLE = False

# Legacy infrastructure imports (fallback)
try:
    from scraper.utils.cache import ResponseCache, IncrementalScraper
    from scraper.utils.rate_limiter import AdaptiveRateLimiter, DomainThrottler
    from scraper.utils.error_handler import CheckpointManager, RetryManager, ErrorClassifier
    HAS_INFRASTRUCTURE = True
except ImportError:
    HAS_INFRASTRUCTURE = False

logger = logging.getLogger(__name__)

# Disable SSL warnings if SSL_VERIFY is disabled (for corporate proxies)
SSL_VERIFY = os.environ.get("SSL_VERIFY", "true").lower() != "false"
if not SSL_VERIFY:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# GitHub token for higher rate limits (5000/hr vs 60/hr)
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")

# Initialize infrastructure
_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_checkpoint: Optional['CheckpointManager'] = None
_retry_manager: Optional['RetryManager'] = None


def _init_infrastructure():
    """Lazily initialize infrastructure components."""
    global _cache, _rate_limiter, _checkpoint, _retry_manager

    if not HAS_INFRASTRUCTURE:
        return

    if _cache is None:
        _cache = ResponseCache(ttl=3600 * 6)  # 6 hour TTL
        logger.info("Initialized ResponseCache with 6hr TTL")

    if _rate_limiter is None:
        # GitHub allows 5000/hr with auth, 60/hr without
        base_delay = 0.2 if GITHUB_TOKEN else 1.0
        _rate_limiter = AdaptiveRateLimiter(
            base_delay=base_delay,
            min_delay=0.1,
            max_delay=10.0,
            jitter_factor=0.1
        )
        logger.info(f"Initialized AdaptiveRateLimiter (auth={bool(GITHUB_TOKEN)})")

    if _checkpoint is None:
        _checkpoint = CheckpointManager("github_repos")
        logger.info("Initialized CheckpointManager")

    if _retry_manager is None:
        _retry_manager = RetryManager(max_retries=3, base_delay=1.0)
        logger.info("Initialized RetryManager")

try:
    from . import InterviewQuestion, QuestionType, Difficulty
except ImportError:
    # For standalone testing
    from dataclasses import dataclass, field
    from datetime import datetime as dt_datetime
    from enum import Enum

    class QuestionType(Enum):
        TECHNICAL = "technical"
        BEHAVIORAL = "behavioral"
        SYSTEM_DESIGN = "system_design"
        CODING = "coding"
        OA = "online_assessment"

    class Difficulty(Enum):
        EASY = "easy"
        MEDIUM = "medium"
        HARD = "hard"

    @dataclass
    class InterviewQuestion:
        id: str
        question_text: str
        question_type: QuestionType
        difficulty: Difficulty = None
        company: str = None
        role: str = None
        topics: list = field(default_factory=list)
        source: str = ""
        source_url: str = None
        interview_date: dt_datetime = None
        scraped_at: dt_datetime = field(default_factory=dt_datetime.utcnow)
        answer_hint: str = None
        upvotes: int = 0


# GitHub API base
GITHUB_API = "https://api.github.com"
GITHUB_RAW = "https://raw.githubusercontent.com"


def get_request_headers() -> Dict[str, str]:
    """Get request headers with optional GitHub token for higher rate limits."""
    headers = {
        "User-Agent": "NewGradRadar/1.0 (interview question aggregator)",
        "Accept": "application/vnd.github.v3+json",
    }
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    return headers


# Legacy constant for backward compatibility
REQUEST_HEADERS = get_request_headers()

# Months to look back for recent updates
MONTHS_LOOKBACK = 5

# Repo configurations
INTERVIEW_REPOS = {
    "tech-interview-handbook": {
        "owner": "yangshun",
        "repo": "tech-interview-handbook",
        "branch": "main",
        "type": "json_structured",
        "paths": [
            "contents/coding-interview.md",
            "contents/behavioral-interview.md",
            "contents/system-design.md",
            "apps/website/contents/algorithms/",
            "apps/website/contents/coding-interview-prep/",
        ],
    },
    "system-design-primer": {
        "owner": "donnemartin",
        "repo": "system-design-primer",
        "branch": "master",
        "type": "markdown",
        "paths": [
            "README.md",
            "solutions/",
        ],
    },
    "interviews": {
        "owner": "kdn251",
        "repo": "interviews",
        "branch": "master",
        "type": "markdown",
        "paths": [
            "README.md",
        ],
    },
}

# Company name patterns for extraction
COMPANY_PATTERNS = [
    r'\b(Google|Meta|Facebook|Amazon|Apple|Microsoft|Netflix|Uber|Lyft|Airbnb|Twitter|X Corp|LinkedIn|Stripe|Coinbase|Robinhood|DoorDash|Instacart|Snap|Pinterest|Dropbox|Slack|Salesforce|Oracle|IBM|Intel|NVIDIA|AMD|Qualcomm|Adobe|VMware|Cisco|PayPal|Square|Block|Shopify|Atlassian|Databricks|Snowflake|MongoDB|Palantir|SpaceX|Tesla|Bloomberg|Citadel|Two Sigma|Jane Street|DE Shaw|Jump Trading|HRT|Optiver|IMC|Akuna|SIG|Capital One|Goldman Sachs|JP Morgan|Morgan Stanley|Bank of America|Citi|Wells Fargo|Visa|Mastercard|American Express)\b',
]

# Topic extraction patterns
TOPIC_KEYWORDS = {
    "arrays": ["array", "list", "vector"],
    "strings": ["string", "substring", "character"],
    "linked_lists": ["linked list", "linkedlist", "node"],
    "trees": ["tree", "binary tree", "bst", "binary search tree", "trie"],
    "graphs": ["graph", "dfs", "bfs", "dijkstra", "topological"],
    "dynamic_programming": ["dynamic programming", "dp", "memoization", "tabulation"],
    "recursion": ["recursion", "recursive", "backtracking"],
    "sorting": ["sort", "sorting", "quicksort", "mergesort", "heapsort"],
    "searching": ["search", "binary search", "linear search"],
    "hash_tables": ["hash", "hashmap", "hashtable", "dictionary", "set"],
    "stacks": ["stack", "lifo"],
    "queues": ["queue", "fifo", "deque", "priority queue"],
    "heaps": ["heap", "min heap", "max heap", "priority queue"],
    "bit_manipulation": ["bit", "bitwise", "xor", "and", "or"],
    "math": ["math", "number", "prime", "factorial", "fibonacci"],
    "system_design": ["system design", "scalability", "distributed", "architecture"],
    "database": ["database", "sql", "nosql", "index", "query"],
    "caching": ["cache", "caching", "redis", "memcached"],
    "api_design": ["api", "rest", "graphql", "endpoint"],
    "concurrency": ["concurrency", "thread", "mutex", "lock", "async"],
}


def generate_question_id(text: str, source: str) -> str:
    """Generate unique ID for a question."""
    normalized = f"{source}|{text[:200].lower().strip()}"
    return hashlib.md5(normalized.encode()).hexdigest()[:16]


def _make_request(url: str, params: Optional[Dict] = None, use_cache: bool = True) -> Optional[requests.Response]:
    """Make a request with infrastructure support (caching, rate limiting, retry)."""
    _init_infrastructure()

    cache_key = f"{url}|{json.dumps(params or {}, sort_keys=True)}"

    # Check cache first
    if use_cache and HAS_INFRASTRUCTURE and _cache:
        cached = _cache.get(cache_key)
        if cached:
            logger.debug(f"Cache hit: {url}")
            # Create mock response from cached data
            class CachedResponse:
                def __init__(self, data):
                    self._data = data
                    self.status_code = 200
                    self.text = data if isinstance(data, str) else json.dumps(data)

                def json(self):
                    return self._data if isinstance(self._data, dict) else json.loads(self._data)
            return CachedResponse(cached)

    # Apply rate limiting
    if HAS_INFRASTRUCTURE and _rate_limiter:
        delay = _rate_limiter.get_delay()
        if delay > 0:
            time.sleep(delay)

    # Make request with retry
    start_time = time.time()
    try:
        response = requests.get(
            url,
            headers=get_request_headers(),
            params=params,
            timeout=15,
            verify=SSL_VERIFY
        )
        response_time = time.time() - start_time

        # Record metrics for adaptive rate limiting
        if HAS_INFRASTRUCTURE and _rate_limiter:
            if response.status_code == 200:
                _rate_limiter.record_success(response_time)
            elif response.status_code == 429:
                _rate_limiter.record_failure(is_rate_limit=True)
            else:
                _rate_limiter.record_failure()

        # Cache successful responses
        if response.status_code == 200 and use_cache and HAS_INFRASTRUCTURE and _cache:
            try:
                data = response.json()
                _cache.set(cache_key, data)
            except json.JSONDecodeError:
                _cache.set(cache_key, response.text)

        return response

    except Exception as e:
        if HAS_INFRASTRUCTURE and _rate_limiter:
            _rate_limiter.record_failure()
        logger.error(f"Request failed: {url} - {e}")
        return None


def get_repo_last_updated(owner: str, repo: str) -> Optional[datetime]:
    """Check when a repo was last updated using GitHub API."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}"
    response = _make_request(url)
    if response and response.status_code == 200:
        try:
            data = response.json()
            pushed_at = data.get("pushed_at")
            if pushed_at:
                return datetime.fromisoformat(pushed_at.replace("Z", "+00:00"))
        except Exception as e:
            logger.error(f"Error parsing repo data: {e}")
    return None


def get_recent_commits(owner: str, repo: str, path: str = "", since_months: int = MONTHS_LOOKBACK) -> List[Dict]:
    """Get commits from the last N months for a specific path."""
    since_date = datetime.utcnow() - timedelta(days=since_months * 30)
    url = f"{GITHUB_API}/repos/{owner}/{repo}/commits"
    params = {
        "since": since_date.isoformat() + "Z",
        "per_page": 100,
    }
    if path:
        params["path"] = path

    response = _make_request(url, params)
    if response and response.status_code == 200:
        try:
            return response.json()
        except Exception:
            pass
    return []


def fetch_file_content(owner: str, repo: str, branch: str, path: str) -> Optional[str]:
    """Fetch raw file content from GitHub."""
    url = f"{GITHUB_RAW}/{owner}/{repo}/{branch}/{path}"

    # Use cache for raw content too
    _init_infrastructure()
    cache_key = f"raw|{url}"

    if HAS_INFRASTRUCTURE and _cache:
        cached = _cache.get(cache_key)
        if cached:
            return cached if isinstance(cached, str) else str(cached)

    if HAS_INFRASTRUCTURE and _rate_limiter:
        time.sleep(_rate_limiter.get_delay())

    try:
        response = requests.get(url, timeout=15, verify=SSL_VERIFY)
        if response.status_code == 200:
            if HAS_INFRASTRUCTURE and _cache:
                _cache.set(cache_key, response.text)
            return response.text
    except Exception as e:
        logger.error(f"Error fetching {path}: {e}")
    return None


def list_directory_files(owner: str, repo: str, path: str) -> List[str]:
    """List files in a GitHub directory using API."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"
    response = _make_request(url)
    if response and response.status_code == 200:
        try:
            items = response.json()
            if isinstance(items, list):
                return [item["path"] for item in items if item["type"] == "file"]
        except Exception:
            pass
    return []


def extract_companies(text: str) -> list[str]:
    """Extract company names from text."""
    companies = []
    for pattern in COMPANY_PATTERNS:
        matches = re.findall(pattern, text, re.IGNORECASE)
        companies.extend(matches)
    # Preserve extraction order across Python processes; a set makes the
    # selected company (and therefore the deduplication hash) unstable.
    return list(dict.fromkeys(companies))


def extract_topics(text: str) -> list[str]:
    """Extract topic tags from text."""
    text_lower = text.lower()
    topics = []
    for topic, keywords in TOPIC_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text_lower:
                topics.append(topic)
                break
    return list(set(topics))


def extract_difficulty(text: str) -> Optional[Difficulty]:
    """Extract difficulty from text."""
    text_lower = text.lower()
    if any(word in text_lower for word in ["easy", "simple", "basic", "beginner"]):
        return Difficulty.EASY
    elif any(word in text_lower for word in ["hard", "difficult", "advanced", "complex"]):
        return Difficulty.HARD
    elif any(word in text_lower for word in ["medium", "moderate", "intermediate"]):
        return Difficulty.MEDIUM
    return None


def parse_tech_interview_handbook(owner: str, repo: str, branch: str) -> list[InterviewQuestion]:
    """Parse yangshun/tech-interview-handbook.

    This repo has structured content with company tags and categories.
    """
    questions = []

    # Fetch main algorithm content
    algo_files = list_directory_files(owner, repo, "apps/website/contents/algorithms")

    for file_path in algo_files:
        if not file_path.endswith(".md"):
            continue

        content = fetch_file_content(owner, repo, branch, file_path)
        if not content:
            continue

        # Parse markdown for questions
        lines = content.split("\n")
        current_question = ""
        current_section = ""

        for line in lines:
            # Track section headers
            if line.startswith("## "):
                current_section = line[3:].strip()
                continue
            elif line.startswith("### "):
                current_section = line[4:].strip()
                continue

            # Look for question patterns
            if "?" in line and len(line) > 20:
                question_text = line.strip()
                # Clean up markdown formatting
                question_text = re.sub(r'\*\*|\*|`|#', '', question_text)
                question_text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', question_text)

                if len(question_text) > 15:
                    companies = extract_companies(content)
                    topics = extract_topics(file_path + " " + current_section + " " + question_text)
                    difficulty = extract_difficulty(current_section + " " + question_text)

                    q = InterviewQuestion(
                        id=generate_question_id(question_text, "tech-interview-handbook"),
                        question_text=question_text,
                        question_type=QuestionType.CODING,
                        difficulty=difficulty,
                        company=companies[0] if companies else None,
                        topics=topics,
                        source="github_tech-interview-handbook",
                        source_url=f"https://github.com/{owner}/{repo}/blob/{branch}/{file_path}",
                    )
                    questions.append(q)

    # Fetch behavioral interview content
    behavioral_content = fetch_file_content(owner, repo, branch, "contents/behavioral-interview.md")
    if behavioral_content:
        questions.extend(parse_behavioral_questions(behavioral_content, "tech-interview-handbook", owner, repo, branch))

    # Fetch system design content
    system_design_content = fetch_file_content(owner, repo, branch, "contents/system-design.md")
    if system_design_content:
        questions.extend(parse_system_design_questions(system_design_content, "tech-interview-handbook", owner, repo, branch))

    print(f"Parsed {len(questions)} questions from tech-interview-handbook")
    return questions


def parse_behavioral_questions(content: str, source_name: str, owner: str, repo: str, branch: str) -> list[InterviewQuestion]:
    """Parse behavioral interview questions from markdown."""
    questions = []
    lines = content.split("\n")

    for line in lines:
        line = line.strip()
        # Look for bullet points or numbered lists with questions
        if (line.startswith("- ") or line.startswith("* ") or re.match(r'^\d+\.', line)) and "?" in line:
            # Clean the question
            question_text = re.sub(r'^[-*\d.]\s*', '', line)
            question_text = re.sub(r'\*\*|\*|`', '', question_text)
            question_text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', question_text)

            if len(question_text) > 20:
                companies = extract_companies(question_text)

                q = InterviewQuestion(
                    id=generate_question_id(question_text, source_name),
                    question_text=question_text,
                    question_type=QuestionType.BEHAVIORAL,
                    company=companies[0] if companies else None,
                    topics=["behavioral", "soft_skills"],
                    source=f"github_{source_name}",
                    source_url=f"https://github.com/{owner}/{repo}/blob/{branch}/contents/behavioral-interview.md",
                )
                questions.append(q)

    return questions


def parse_system_design_questions(content: str, source_name: str, owner: str, repo: str, branch: str) -> list[InterviewQuestion]:
    """Parse system design questions from markdown."""
    questions = []

    # Look for "Design..." patterns
    design_patterns = [
        r"Design\s+(?:a\s+)?([A-Za-z\s]+)(?:\?|\.)",
        r"How\s+would\s+you\s+design\s+([A-Za-z\s]+)(?:\?|\.)",
        r"Build\s+(?:a\s+)?([A-Za-z\s]+)",
        r"Implement\s+(?:a\s+)?([A-Za-z\s]+)",
    ]

    for pattern in design_patterns:
        matches = re.findall(pattern, content, re.IGNORECASE)
        for match in matches:
            question_text = f"Design {match.strip()}"
            companies = extract_companies(content)
            topics = extract_topics(content)
            topics.append("system_design")

            q = InterviewQuestion(
                id=generate_question_id(question_text, source_name),
                question_text=question_text,
                question_type=QuestionType.SYSTEM_DESIGN,
                difficulty=Difficulty.HARD,
                company=companies[0] if companies else None,
                topics=list(set(topics)),
                source=f"github_{source_name}",
                source_url=f"https://github.com/{owner}/{repo}",
            )
            questions.append(q)

    return questions


def parse_system_design_primer(owner: str, repo: str, branch: str) -> list[InterviewQuestion]:
    """Parse donnemartin/system-design-primer.

    This repo has comprehensive system design content organized by topic.
    """
    questions = []

    content = fetch_file_content(owner, repo, branch, "README.md")
    if not content:
        print("Could not fetch system-design-primer README")
        return []

    # Extract system design interview questions section
    lines = content.split("\n")
    in_questions_section = False

    for i, line in enumerate(lines):
        # Look for the system design questions section
        if "system design interview questions" in line.lower():
            in_questions_section = True
            continue

        if in_questions_section:
            # Stop at next major section
            if line.startswith("## ") and "question" not in line.lower():
                in_questions_section = False
                continue

            # Parse question links
            link_match = re.search(r'\[([^\]]+)\]\(([^)]+)\)', line)
            if link_match:
                question_text = link_match.group(1).strip()
                question_url = link_match.group(2).strip()

                # Filter out non-question links
                if any(word in question_text.lower() for word in ["design", "scale", "build", "implement", "system"]):
                    companies = extract_companies(line)
                    topics = extract_topics(question_text)
                    topics.append("system_design")

                    q = InterviewQuestion(
                        id=generate_question_id(question_text, "system-design-primer"),
                        question_text=f"Design: {question_text}",
                        question_type=QuestionType.SYSTEM_DESIGN,
                        difficulty=Difficulty.HARD,
                        company=companies[0] if companies else None,
                        topics=list(set(topics)),
                        source="github_system-design-primer",
                        source_url=question_url if question_url.startswith("http") else f"https://github.com/{owner}/{repo}/blob/{branch}/{question_url}",
                    )
                    questions.append(q)

    # Also extract from solution directories
    solutions_files = list_directory_files(owner, repo, "solutions")
    for file_path in solutions_files:
        if file_path.endswith(".md"):
            # Extract topic from filename
            filename = file_path.split("/")[-1].replace(".md", "").replace("_", " ").title()
            if any(word in filename.lower() for word in ["design", "system", "scale"]):
                q = InterviewQuestion(
                    id=generate_question_id(filename, "system-design-primer-solutions"),
                    question_text=f"System Design: {filename}",
                    question_type=QuestionType.SYSTEM_DESIGN,
                    difficulty=Difficulty.HARD,
                    topics=["system_design"] + extract_topics(filename),
                    source="github_system-design-primer",
                    source_url=f"https://github.com/{owner}/{repo}/blob/{branch}/{file_path}",
                )
                questions.append(q)

    print(f"Parsed {len(questions)} questions from system-design-primer")
    return questions


def parse_kdn251_interviews(owner: str, repo: str, branch: str) -> list[InterviewQuestion]:
    """Parse kdn251/interviews.

    This repo has DS&A problems organized by topic.
    """
    questions = []

    content = fetch_file_content(owner, repo, branch, "README.md")
    if not content:
        print("Could not fetch kdn251/interviews README")
        return []

    # This repo has problems organized by company in tables
    lines = content.split("\n")
    current_company = None
    current_topic = None

    for line in lines:
        line = line.strip()

        # Track headers
        if line.startswith("## "):
            header = line[3:].strip()
            # Check if it's a company name
            companies = extract_companies(header)
            if companies:
                current_company = companies[0]
            else:
                current_topic = header.lower().replace(" ", "_")
            continue

        # Look for table rows with problem links
        if "|" in line and "[" in line:
            cells = [c.strip() for c in line.split("|")]
            for cell in cells:
                link_match = re.search(r'\[([^\]]+)\]\(([^)]+)\)', cell)
                if link_match:
                    problem_name = link_match.group(1).strip()
                    problem_url = link_match.group(2).strip()

                    # Skip header/separator cells
                    if problem_name.lower() in ["problem", "solution", "---", ""]:
                        continue

                    topics = extract_topics(problem_name)
                    if current_topic:
                        topics.append(current_topic)

                    difficulty = extract_difficulty(line)

                    q = InterviewQuestion(
                        id=generate_question_id(problem_name, "kdn251-interviews"),
                        question_text=problem_name,
                        question_type=QuestionType.CODING,
                        difficulty=difficulty,
                        company=current_company,
                        topics=list(set(topics)),
                        source="github_kdn251-interviews",
                        source_url=problem_url if problem_url.startswith("http") else f"https://github.com/{owner}/{repo}/blob/{branch}/{problem_url}",
                    )
                    questions.append(q)

    print(f"Parsed {len(questions)} questions from kdn251/interviews")
    return questions


def filter_recent_questions(questions: List[InterviewQuestion], months: int = MONTHS_LOOKBACK) -> List[InterviewQuestion]:
    """Filter questions to those from repos updated recently.

    Note: Individual questions don't have dates, but we verify the repo was updated recently.
    """
    # For now, return all since we verify repo update times before parsing
    return questions


def deduplicate_questions(questions: List[InterviewQuestion]) -> List[InterviewQuestion]:
    """Remove duplicate questions based on ID."""
    seen_ids = set()
    unique = []
    for q in questions:
        if q.id not in seen_ids:
            seen_ids.add(q.id)
            unique.append(q)
    return unique


def get_cache_stats() -> Dict[str, Any]:
    """Get cache statistics for monitoring."""
    _init_infrastructure()
    if HAS_INFRASTRUCTURE and _cache:
        return {
            "enabled": True,
            "hits": getattr(_cache, '_hits', 0),
            "misses": getattr(_cache, '_misses', 0),
        }
    return {"enabled": False}


def clear_cache():
    """Clear the response cache."""
    global _cache
    if HAS_INFRASTRUCTURE and _cache:
        _cache.clear()
        logger.info("Cache cleared")


# How many questions to keep per company (per source). The 6-month CSVs have
# hundreds of rows for big companies; we want deep, role-specific banks.
COMPANY_WISE_CAP = 2000  # effectively uncapped for the 6-month window


def _build_cw_question(company_name, title, difficulty, link, rank, total, extra_tags=None):
    """Build a company-wise LeetCode question.

    Uses a shared id/source across both source repos so identical
    (company, title) pairs dedupe into a union. `rank` (0 = most frequently
    asked) staggers interview_date across the last ~90 days so the most
    relevant/recent questions sort to the top.
    """
    diff = (difficulty or "unknown").strip().lower()
    days_ago = int(rank * 90 / max(total, 1))
    approx_date = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    tags = (["leetcode", "coding"] + (extra_tags or []))[:8]
    return InterviewQuestion(
        id=generate_question_id(f"{company_name.lower()}|{title.lower()}", "leetcode_company_wise"),
        company=company_name,
        position="Software Engineer",
        question_type="technical_coding",
        difficulty=diff if diff in ("easy", "medium", "hard") else "unknown",
        question_text=f"{title} — asked at {company_name} (LeetCode, last 6 months).",
        source="leetcode_company_wise",
        source_url=link or None,
        interview_date=approx_date,
        tags=tags,
        upvotes=max(total - rank, 0),  # higher for more-frequently-asked
        answer_hint=None,
    )


def parse_company_wise_leetcode(top_n_per_company: int = COMPANY_WISE_CAP) -> List[InterviewQuestion]:
    """Parse krishnadey30/LeetCode-Questions-CompanyWise — RECENT (6-month) only.

    Per the product requirement we only use each company's `_6months.csv`
    (last ~6 months), sorted most-frequently-asked first, and keep up to
    top_n_per_company so users get 100+ role-specific questions per company.
    """
    import csv as _csv
    import io as _io

    owner, repo, branch = "krishnadey30", "LeetCode-Questions-CompanyWise", "master"
    questions: List[InterviewQuestion] = []

    files = list_directory_files(owner, repo, "")
    csvs = [f for f in files if f.endswith("_6months.csv")]
    print(f"  [krishnadey30] {len(csvs)} companies (6-month window)")

    for fname in csvs:
        comp_slug = fname[: -len("_6months.csv")]
        content = fetch_file_content(owner, repo, branch, fname)
        if not content:
            continue
        company_name = comp_slug.replace("-", " ").title()
        rows = []
        try:
            for row in _csv.DictReader(_io.StringIO(content)):
                title = (row.get("Title") or "").strip()
                if not title:
                    continue
                try:
                    freq = float(row.get("Frequency") or 0)
                except (ValueError, TypeError):
                    freq = 0.0
                rows.append((freq, row, title))
        except Exception as e:
            logger.error(f"[krishnadey30] CSV parse error for {fname}: {e}")
            continue

        rows.sort(key=lambda x: x[0], reverse=True)
        top = rows[:top_n_per_company]
        for rank, (freq, row, title) in enumerate(top):
            link = (row.get("Leetcode Question Link") or row.get("Leetcode Link") or "").strip()
            questions.append(_build_cw_question(company_name, title, row.get("Difficulty"), link, rank, len(top)))

    print(f"  [krishnadey30] parsed {len(questions)} questions")
    return questions


def parse_company_wise_liquidslr(top_n_per_company: int = COMPANY_WISE_CAP) -> List[InterviewQuestion]:
    """Parse liquidslr/leetcode-company-wise-problems.

    Per-company folders with finer recency buckets ("1. Thirty Days.csv",
    "2. Three Months.csv", "3. Six Months.csv", ...) and a Topics column.
    We grab the whole file tree in ONE git-tree API call, then fetch the most
    recent bucket per company from raw.githubusercontent (no API rate limit).
    """
    import csv as _csv
    import io as _io

    owner, repo, branch = "liquidslr", "leetcode-company-wise-problems", "main"
    questions: List[InterviewQuestion] = []

    tree_url = f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    resp = _make_request(tree_url)
    if not resp or resp.status_code != 200:
        logger.warning("[liquidslr] could not fetch repo tree")
        return questions
    try:
        paths = [t["path"] for t in resp.json().get("tree", []) if t["type"] == "blob" and t["path"].endswith(".csv")]
    except Exception as e:
        logger.error(f"[liquidslr] tree parse error: {e}")
        return questions

    # RECENT only: use each company's "3. Six Months.csv" (last ~6 months).
    target = "3. Six Months.csv"
    company_files = {}
    for p in paths:
        parts = p.split("/")
        if len(parts) == 2 and parts[1] == target:
            company_files[parts[0]] = p

    print(f"  [liquidslr] {len(company_files)} companies (6-month window)")

    for company, path in company_files.items():
        content = fetch_file_content(owner, repo, branch, path)
        if not content:
            continue
        rows = []
        try:
            for row in _csv.DictReader(_io.StringIO(content)):
                title = (row.get("Title") or "").strip()
                if not title:
                    continue
                try:
                    freq = float(row.get("Frequency") or 0)
                except (ValueError, TypeError):
                    freq = 0.0
                rows.append((freq, row, title))
        except Exception:
            continue
        rows.sort(key=lambda x: x[0], reverse=True)
        top = rows[:top_n_per_company]
        for rank, (freq, row, title) in enumerate(top):
            topics = [t.strip() for t in (row.get("Topics") or "").split(",") if t.strip()]
            questions.append(_build_cw_question(
                company, title, row.get("Difficulty"),
                (row.get("Link") or "").strip(), rank, len(top), extra_tags=topics,
            ))

    print(f"  [liquidslr] parsed {len(questions)} questions")
    return questions


def scrape_github_repos(resume: bool = True) -> List[InterviewQuestion]:
    """Main entry point: scrape all configured GitHub repos for interview questions.

    Args:
        resume: If True, resume from last checkpoint (skip completed repos)

    Returns:
        List of InterviewQuestion objects from all sources.
    """
    _init_infrastructure()
    all_questions = []

    # Load checkpoint state for resume
    completed_repos = set()
    if resume and HAS_INFRASTRUCTURE and _checkpoint:
        state = _checkpoint.load_state()
        completed_repos = set(state.get("completed_repos", []))
        if completed_repos:
            logger.info(f"Resuming: {len(completed_repos)} repos already completed")

    for repo_key, config in INTERVIEW_REPOS.items():
        owner = config["owner"]
        repo = config["repo"]
        branch = config["branch"]
        repo_id = f"{owner}/{repo}"

        # Skip if already completed (resume mode)
        if repo_id in completed_repos:
            print(f"  Skipping {repo_id} (already completed)")
            continue

        print(f"\nProcessing {repo_id}...")

        # Check if repo was updated in last N months
        last_updated = get_repo_last_updated(owner, repo)
        if last_updated:
            cutoff = datetime.now(last_updated.tzinfo) - timedelta(days=MONTHS_LOOKBACK * 30)
            cutoff = cutoff.replace(tzinfo=last_updated.tzinfo)
            if last_updated < cutoff:
                print(f"  Skipping - not updated since {last_updated.date()}")
                # Mark as completed even if skipped
                if HAS_INFRASTRUCTURE and _checkpoint:
                    completed_repos.add(repo_id)
                    _checkpoint.save_checkpoint(completed_repos=list(completed_repos))
                continue
            print(f"  Last updated: {last_updated.date()}")

        # Parse based on repo type
        try:
            if repo_key == "tech-interview-handbook":
                questions = parse_tech_interview_handbook(owner, repo, branch)
            elif repo_key == "system-design-primer":
                questions = parse_system_design_primer(owner, repo, branch)
            elif repo_key == "interviews":
                questions = parse_kdn251_interviews(owner, repo, branch)
            else:
                print(f"  Unknown repo type: {repo_key}")
                continue

            all_questions.extend(questions)

            # Save checkpoint after each successful repo
            if HAS_INFRASTRUCTURE and _checkpoint:
                completed_repos.add(repo_id)
                _checkpoint.save_checkpoint(
                    completed_repos=list(completed_repos),
                    questions_count=len(all_questions)
                )
                logger.info(f"Checkpoint saved: {len(completed_repos)} repos, {len(all_questions)} questions")

        except Exception as e:
            logger.error(f"Error processing {repo_id}: {e}")
            # Continue to next repo on error

    # Company-wise LeetCode questions (recent, per-company, high volume)
    try:
        print("\nProcessing company-wise LeetCode repo (krishnadey30)...")
        all_questions.extend(parse_company_wise_leetcode())
    except Exception as e:
        logger.error(f"Error processing company-wise repo: {e}")

    # Second company-wise repo: finer recency windows + topic tags
    try:
        print("\nProcessing company-wise LeetCode repo (liquidslr)...")
        all_questions.extend(parse_company_wise_liquidslr())
    except Exception as e:
        logger.error(f"Error processing liquidslr repo: {e}")

    # Deduplicate
    unique_questions = deduplicate_questions(all_questions)
    print(f"\nTotal unique questions: {len(unique_questions)}")

    # Clear checkpoint on successful completion
    if HAS_INFRASTRUCTURE and _checkpoint:
        _checkpoint.clear()

    return unique_questions


def scrape_github_repos_by_company(company: str) -> list[InterviewQuestion]:
    """Scrape questions filtered by company name."""
    all_questions = scrape_github_repos()
    return [q for q in all_questions if q.company and company.lower() in q.company.lower()]


def scrape_github_repos_by_topic(topic: str) -> list[InterviewQuestion]:
    """Scrape questions filtered by topic."""
    all_questions = scrape_github_repos()
    return [q for q in all_questions if topic.lower() in [t.lower() for t in q.topics]]


if __name__ == "__main__":
    print("Testing GitHub interview question scraper...")
    print("=" * 60)

    questions = scrape_github_repos()

    print("\n" + "=" * 60)
    print("Sample questions:")
    print("=" * 60)

    for q in questions[:10]:
        print(f"\n[{q.question_type.value}] {q.question_text[:80]}...")
        print(f"  Company: {q.company or 'N/A'}")
        print(f"  Topics: {', '.join(q.topics[:5])}")
        print(f"  Difficulty: {q.difficulty.value if q.difficulty else 'N/A'}")
        print(f"  Source: {q.source}")
