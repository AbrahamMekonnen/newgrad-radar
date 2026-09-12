"""GitHub Gist scraper for interview questions.

Searches GitHub Gists for interview prep content:
- Interview questions
- OA (Online Assessment) questions
- FAANG interview prep
- Company-specific interview prep

Uses GitHub API with authentication for higher rate limits (5000 req/hr).
Filters by updated_at to get recent content (last 4-5 months).

Infrastructure:
- ResponseCache: Caches API responses (6hr TTL)
- AdaptiveRateLimiter: Smart rate limiting (5000/hr with auth)
- CheckpointManager: Resume from last gist processed
"""

import os
import re
import hashlib
import requests
import time
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict

# Import unified infrastructure
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
    from scraper.utils.rate_limiter import AdaptiveRateLimiter
    from scraper.utils.error_handler import CheckpointManager, RetryManager
    HAS_INFRASTRUCTURE = True
except ImportError:
    HAS_INFRASTRUCTURE = False

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 30

# GitHub API configuration
GITHUB_API_BASE = "https://api.github.com"
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")

# Initialize infrastructure
_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_checkpoint: Optional['CheckpointManager'] = None
_incremental: Optional['IncrementalScraper'] = None


def _init_infrastructure():
    """Lazily initialize infrastructure components."""
    global _cache, _rate_limiter, _checkpoint, _incremental

    if not HAS_INFRASTRUCTURE:
        return

    if _cache is None:
        _cache = ResponseCache(ttl=3600 * 6)  # 6 hour TTL
        logger.info("Initialized ResponseCache")

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
        _checkpoint = CheckpointManager("github_gists")
        logger.info("Initialized CheckpointManager")

    if _incremental is None:
        _incremental = IncrementalScraper("github_gists")
        logger.info("Initialized IncrementalScraper")


@dataclass
class InterviewQuestion:
    """Represents a single interview question from GitHub Gist."""
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

# Search queries for finding interview gists
SEARCH_QUERIES = [
    "interview questions",
    "OA questions",
    "FAANG interview",
    "Google interview prep",
    "Amazon interview prep",
    "Meta interview prep",
    "Microsoft interview prep",
    "coding interview",
    "system design interview",
    "behavioral interview",
    "leetcode solutions",
    "technical interview",
]

# Top tech companies to identify
KNOWN_COMPANIES = {
    "google": "Google",
    "amazon": "Amazon",
    "meta": "Meta",
    "facebook": "Meta",
    "apple": "Apple",
    "microsoft": "Microsoft",
    "netflix": "Netflix",
    "uber": "Uber",
    "lyft": "Lyft",
    "airbnb": "Airbnb",
    "stripe": "Stripe",
    "coinbase": "Coinbase",
    "robinhood": "Robinhood",
    "doordash": "DoorDash",
    "instacart": "Instacart",
    "dropbox": "Dropbox",
    "twitter": "Twitter",
    "x": "X",
    "snap": "Snap",
    "snapchat": "Snap",
    "linkedin": "LinkedIn",
    "salesforce": "Salesforce",
    "oracle": "Oracle",
    "ibm": "IBM",
    "nvidia": "NVIDIA",
    "amd": "AMD",
    "intel": "Intel",
    "palantir": "Palantir",
    "databricks": "Databricks",
    "snowflake": "Snowflake",
    "mongodb": "MongoDB",
    "datadog": "Datadog",
    "twilio": "Twilio",
    "square": "Square",
    "block": "Block",
    "shopify": "Shopify",
    "atlassian": "Atlassian",
    "slack": "Slack",
    "zoom": "Zoom",
    "spotify": "Spotify",
    "pinterest": "Pinterest",
    "reddit": "Reddit",
    "discord": "Discord",
    "roblox": "Roblox",
    "bytedance": "ByteDance",
    "tiktok": "TikTok",
    "jane street": "Jane Street",
    "citadel": "Citadel",
    "two sigma": "Two Sigma",
    "de shaw": "D.E. Shaw",
    "hrt": "Hudson River Trading",
    "goldman": "Goldman Sachs",
    "jpmorgan": "JPMorgan",
    "morgan stanley": "Morgan Stanley",
}

# Question type indicators
TECHNICAL_INDICATORS = [
    "implement", "algorithm", "data structure", "time complexity",
    "space complexity", "big o", "recursion", "iteration",
    "binary search", "dynamic programming", "dp", "graph",
    "tree", "linked list", "hash", "array", "string",
    "sort", "search", "bfs", "dfs", "heap", "stack", "queue",
]

BEHAVIORAL_INDICATORS = [
    "tell me about", "describe a time", "what would you do",
    "how do you handle", "leadership", "teamwork", "conflict",
    "weakness", "strength", "why this company", "career goals",
    "star method", "behavioral", "situation", "task", "action", "result",
]

SYSTEM_DESIGN_INDICATORS = [
    "design a", "system design", "architecture", "scalability",
    "distributed", "microservice", "load balancer", "database design",
    "api design", "high availability", "caching", "sharding",
    "cdn", "message queue", "rate limiting", "url shortener",
]

# Difficulty indicators
EASY_INDICATORS = ["easy", "simple", "basic", "beginner", "trivial"]
MEDIUM_INDICATORS = ["medium", "moderate", "intermediate"]
HARD_INDICATORS = ["hard", "difficult", "advanced", "challenging", "expert"]

# Request headers
def get_headers() -> dict:
    """Get request headers with optional authentication."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "NewGradRadar/1.0 (interview question aggregator)",
    }
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    return headers


def generate_question_id(text: str, source_url: str) -> str:
    """Generate unique ID for a question."""
    normalized = f"{text.lower().strip()[:200]}|{source_url}"
    return hashlib.md5(normalized.encode()).hexdigest()[:16]


def detect_company(text: str) -> Optional[str]:
    """Detect company name from text."""
    text_lower = text.lower()
    for keyword, company in KNOWN_COMPANIES.items():
        if keyword in text_lower:
            return company
    return None


def detect_question_type(text: str) -> str:
    """Detect question type from text."""
    text_lower = text.lower()

    # Check for system design first (most specific)
    if any(ind in text_lower for ind in SYSTEM_DESIGN_INDICATORS):
        return "system_design"

    # Check for behavioral
    if any(ind in text_lower for ind in BEHAVIORAL_INDICATORS):
        return "behavioral"

    # Check for technical/coding
    if any(ind in text_lower for ind in TECHNICAL_INDICATORS):
        return "coding"

    # Default to technical
    return "technical"


def detect_difficulty(text: str) -> str:
    """Detect difficulty level from text."""
    text_lower = text.lower()

    if any(ind in text_lower for ind in HARD_INDICATORS):
        return "hard"
    if any(ind in text_lower for ind in MEDIUM_INDICATORS):
        return "medium"
    if any(ind in text_lower for ind in EASY_INDICATORS):
        return "easy"

    return "medium"


def detect_role(text: str) -> Optional[str]:
    """Detect job role from text."""
    text_lower = text.lower()

    role_patterns = {
        r'\b(software engineer|swe|sde)\b': "Software Engineer",
        r'\b(frontend|front-end|front end)\b': "Frontend Engineer",
        r'\b(backend|back-end|back end)\b': "Backend Engineer",
        r'\b(fullstack|full-stack|full stack)\b': "Full Stack Engineer",
        r'\b(machine learning|ml engineer|ai engineer)\b': "ML Engineer",
        r'\b(data engineer|data engineering)\b': "Data Engineer",
        r'\b(data scientist|data science)\b': "Data Scientist",
        r'\b(devops|sre|site reliability)\b': "DevOps/SRE",
        r'\b(mobile|ios|android)\b': "Mobile Engineer",
        r'\b(product manager|pm)\b': "Product Manager",
        r'\b(quant|quantitative)\b': "Quantitative Engineer",
    }

    for pattern, role in role_patterns.items():
        if re.search(pattern, text_lower):
            return role

    return None


def extract_topics(text: str) -> list[str]:
    """Extract topic tags from text."""
    topics = []
    text_lower = text.lower()

    topic_keywords = [
        "arrays", "strings", "linked list", "trees", "graphs",
        "dynamic programming", "recursion", "binary search",
        "sorting", "hashing", "heap", "stack", "queue",
        "backtracking", "greedy", "bit manipulation",
        "math", "sql", "system design", "oop", "concurrency",
        "distributed systems", "api design", "database",
    ]

    for topic in topic_keywords:
        if topic in text_lower:
            topics.append(topic.title())

    return topics[:5]  # Limit to 5 topics


def parse_markdown_questions(content: str, gist_url: str, gist_updated: datetime) -> list[InterviewQuestion]:
    """Parse markdown content to extract interview questions.

    Looks for patterns like:
    - Numbered lists (1. Question text)
    - Bullet points (- Question text, * Question text)
    - Headers followed by content (## Question: ...)
    - Q: or Question: prefixes
    """
    questions = []
    lines = content.split('\n')

    # Detect overall company and role from content
    overall_company = detect_company(content)
    overall_role = detect_role(content)
    overall_difficulty = detect_difficulty(content)

    current_section = ""

    for i, line in enumerate(lines):
        line = line.strip()

        # Track section headers
        if line.startswith('#'):
            current_section = line.lstrip('#').strip()
            continue

        # Skip empty lines and non-question content
        if not line or len(line) < 20:
            continue

        # Skip code blocks
        if line.startswith('```') or line.startswith('    '):
            continue

        question_text = None

        # Pattern 1: Numbered list (1. Question text)
        numbered_match = re.match(r'^(\d+)\.\s+(.+)$', line)
        if numbered_match:
            question_text = numbered_match.group(2)

        # Pattern 2: Bullet points
        elif re.match(r'^[-*+]\s+(.+)$', line):
            question_text = re.sub(r'^[-*+]\s+', '', line)

        # Pattern 3: Q: or Question: prefix
        elif re.match(r'^(Q:|Question:|Q\d+:?)\s*(.+)$', line, re.IGNORECASE):
            match = re.match(r'^(Q:|Question:|Q\d+:?)\s*(.+)$', line, re.IGNORECASE)
            question_text = match.group(2)

        if question_text and len(question_text) >= 20:
            # Filter out non-question content
            skip_patterns = [
                r'^(note:|answer:|solution:|hint:|example:|explanation:)',
                r'^(```|import |def |class |function )',
                r'^(http|www\.|@)',
            ]

            if any(re.match(pattern, question_text.lower()) for pattern in skip_patterns):
                continue

            # Check if it looks like a question
            question_indicators = ['?', 'how', 'what', 'why', 'when', 'where',
                                   'implement', 'design', 'write', 'create', 'build',
                                   'explain', 'describe', 'find', 'given', 'you are']

            is_question = any(ind in question_text.lower() for ind in question_indicators)

            if is_question:
                # Detect specifics for this question
                company = detect_company(question_text) or detect_company(current_section) or overall_company or "Unknown"
                q_type = detect_question_type(question_text + " " + current_section)
                difficulty = detect_difficulty(question_text + " " + current_section) or overall_difficulty or "medium"
                role = detect_role(question_text + " " + current_section) or overall_role or "Software Engineer"
                topics = extract_topics(question_text + " " + current_section)

                question = InterviewQuestion(
                    id=generate_question_id(question_text, gist_url),
                    company=company,
                    position=role,
                    question_type=q_type,
                    difficulty=difficulty,
                    question_text=question_text[:500],  # Limit length
                    source="github_gist",
                    source_url=gist_url,
                    posted_date=gist_updated.isoformat()[:10] if gist_updated else None,
                    tags=topics,
                )
                questions.append(question)

    return questions


def search_gists(query: str, since: datetime, per_page: int = 100) -> List[Dict]:
    """Search GitHub gists with a query.

    Uses infrastructure for caching and rate limiting.
    """
    _init_infrastructure()
    all_gists = []
    page = 1
    max_pages = 10  # Limit to avoid rate limiting

    url = f"{GITHUB_API_BASE}/gists/public"

    while page <= max_pages:
        params = {
            "per_page": per_page,
            "page": page,
            "since": since.isoformat() + "Z",
        }

        # Check cache first
        cache_key = f"gists|{query}|{page}|{since.date()}"
        if HAS_INFRASTRUCTURE and _cache:
            cached = _cache.get(cache_key)
            if cached:
                logger.debug(f"Cache hit for gists page {page}")
                gists = cached
                all_gists.extend(_filter_gists(gists, query))
                page += 1
                continue

        # Apply rate limiting
        if HAS_INFRASTRUCTURE and _rate_limiter:
            delay = _rate_limiter.get_delay()
            if delay > 0:
                time.sleep(delay)

        try:
            start_time = time.time()
            response = requests.get(url, headers=get_headers(), params=params, timeout=30)
            response_time = time.time() - start_time

            # Record metrics
            if HAS_INFRASTRUCTURE and _rate_limiter:
                if response.status_code == 200:
                    _rate_limiter.record_success(response_time)
                elif response.status_code == 429:
                    _rate_limiter.record_failure(is_rate_limit=True)
                else:
                    _rate_limiter.record_failure()

            if response.status_code == 403:
                print(f"Rate limited. Remaining: {response.headers.get('X-RateLimit-Remaining', 'unknown')}")
                break

            if response.status_code != 200:
                print(f"Error fetching gists: {response.status_code}")
                break

            gists = response.json()

            if not gists:
                break

            # Cache the raw response
            if HAS_INFRASTRUCTURE and _cache:
                _cache.set(cache_key, gists)

            # Filter gists that match our criteria
            all_gists.extend(_filter_gists(gists, query))

            page += 1

            # Rate limit check
            remaining = int(response.headers.get('X-RateLimit-Remaining', 1000))
            if remaining < 100:
                print(f"Rate limit low ({remaining}), stopping early")
                break

        except requests.RequestException as e:
            print(f"Error searching gists: {e}")
            if HAS_INFRASTRUCTURE and _rate_limiter:
                _rate_limiter.record_failure()
            break

    return all_gists


def _filter_gists(gists: List[Dict], query: str) -> List[Dict]:
    """Filter gists that match our search criteria."""
    matched = []
    for gist in gists:
        description = (gist.get("description") or "").lower()
        files = gist.get("files", {})
        file_names = " ".join(files.keys()).lower()

        search_terms = query.lower().split()
        combined_text = f"{description} {file_names}"

        if any(term in combined_text for term in search_terms):
            matched.append(gist)
    return matched


def fetch_gist_content(gist: Dict) -> Optional[str]:
    """Fetch full content of a gist with caching and rate limiting."""
    gist_id = gist.get("id")
    if not gist_id:
        return None

    _init_infrastructure()
    url = f"{GITHUB_API_BASE}/gists/{gist_id}"
    cache_key = f"gist_content|{gist_id}"

    # Check cache first
    if HAS_INFRASTRUCTURE and _cache:
        cached = _cache.get(cache_key)
        if cached:
            logger.debug(f"Cache hit for gist {gist_id}")
            return cached

    # Apply rate limiting
    if HAS_INFRASTRUCTURE and _rate_limiter:
        delay = _rate_limiter.get_delay()
        if delay > 0:
            time.sleep(delay)

    try:
        start_time = time.time()
        response = requests.get(url, headers=get_headers(), timeout=30)
        response_time = time.time() - start_time

        # Record metrics
        if HAS_INFRASTRUCTURE and _rate_limiter:
            if response.status_code == 200:
                _rate_limiter.record_success(response_time)
            else:
                _rate_limiter.record_failure()

        if response.status_code != 200:
            return None

        gist_data = response.json()
        files = gist_data.get("files", {})

        # Combine content from all markdown files
        content_parts = []
        for filename, file_data in files.items():
            if filename.endswith(('.md', '.markdown', '.txt')):
                content = file_data.get("content", "")
                if content:
                    content_parts.append(f"# {filename}\n\n{content}")

        result = "\n\n".join(content_parts) if content_parts else None

        # Cache the result
        if result and HAS_INFRASTRUCTURE and _cache:
            _cache.set(cache_key, result)

        return result

    except requests.RequestException as e:
        print(f"Error fetching gist {gist_id}: {e}")
        if HAS_INFRASTRUCTURE and _rate_limiter:
            _rate_limiter.record_failure()
        return None


def scrape_github_gists(months_back: int = 5, resume: bool = True) -> List[Dict[str, Any]]:
    """Main function to scrape GitHub Gists for interview questions.

    Args:
        months_back: Number of months to look back (default 5)
        resume: If True, resume from last checkpoint

    Returns:
        List of interview question dicts
    """
    _init_infrastructure()
    all_questions: List[InterviewQuestion] = []
    seen_ids = set()
    start_query_idx = 0

    # Calculate date range
    since_date = datetime.utcnow() - timedelta(days=months_back * 30)

    # Check for checkpoint
    if resume and HAS_INFRASTRUCTURE and _checkpoint:
        checkpoint_data = _checkpoint.load()
        if checkpoint_data:
            start_query_idx = checkpoint_data.get("query_idx", 0)
            seen_ids = set(checkpoint_data.get("seen_ids", []))
            all_questions = [
                InterviewQuestion(**q) for q in checkpoint_data.get("questions", [])
            ]
            logger.info(f"Resuming from query {start_query_idx}, {len(all_questions)} questions collected")
            print(f"[github_gist] Resuming from checkpoint (query {start_query_idx})")

    print("=" * 60)
    print("GITHUB GIST INTERVIEW SCRAPER")
    print(f"Searching for gists updated since {since_date.date()}")
    print("=" * 60)

    for query_idx, query in enumerate(SEARCH_QUERIES):
        # Skip already processed queries
        if query_idx < start_query_idx:
            continue

        print(f"[github_gist] Searching for: {query}")

        gists = search_gists(query, since_date)
        print(f"[github_gist]   Found {len(gists)} gists matching '{query}'")

        for gist in gists:
            # Skip if no description or files
            if not gist.get("files"):
                continue

            # Check if any files are markdown
            files = gist.get("files", {})
            has_markdown = any(
                f.endswith(('.md', '.markdown', '.txt'))
                for f in files.keys()
            )

            if not has_markdown:
                continue

            # Fetch full content
            content = fetch_gist_content(gist)
            if not content or len(content) < 100:
                continue

            # Parse for questions
            gist_url = gist.get("html_url", "")
            updated_at_str = gist.get("updated_at", "")
            try:
                updated_at = datetime.fromisoformat(
                    updated_at_str.replace("Z", "+00:00")
                ).replace(tzinfo=None)
            except (ValueError, AttributeError):
                updated_at = datetime.utcnow()

            questions = parse_markdown_questions(content, gist_url, updated_at)

            # Deduplicate
            for q in questions:
                if q.id not in seen_ids:
                    seen_ids.add(q.id)
                    all_questions.append(q)

        # Save checkpoint after each query
        if HAS_INFRASTRUCTURE and _checkpoint:
            _checkpoint.save({
                "query_idx": query_idx + 1,
                "seen_ids": list(seen_ids),
                "questions": [q.to_dict() for q in all_questions],
            })
            logger.debug(f"Checkpoint saved after query {query_idx}")

        # Be nice to API (handled by rate limiter now)
        time.sleep(0.5)

    print("=" * 60)
    print(f"[github_gist] TOTAL: {len(all_questions)} unique interview questions")
    print("=" * 60)

    # Clear checkpoint on successful completion
    if HAS_INFRASTRUCTURE and _checkpoint:
        _checkpoint.clear()
        logger.info("Checkpoint cleared after successful completion")

    # Convert to dicts for return
    return [q.to_dict() for q in all_questions]


def get_rate_limit_status() -> dict:
    """Check current GitHub API rate limit status."""
    url = f"{GITHUB_API_BASE}/rate_limit"

    try:
        response = requests.get(url, headers=get_headers(), timeout=10)
        if response.status_code == 200:
            data = response.json()
            core = data.get("resources", {}).get("core", {})
            return {
                "limit": core.get("limit", 60),
                "remaining": core.get("remaining", 0),
                "reset": datetime.fromtimestamp(core.get("reset", 0)),
            }
    except requests.RequestException:
        pass

    return {"limit": 60, "remaining": 0, "reset": datetime.utcnow()}


if __name__ == "__main__":
    import json
    import argparse

    parser = argparse.ArgumentParser(description="Scrape GitHub Gists for interview questions")
    parser.add_argument("--months", type=int, default=5, help="Months to look back")
    parser.add_argument("--output", type=str, help="Output JSON file")
    args = parser.parse_args()

    # Check rate limit
    rate_limit = get_rate_limit_status()
    print(f"Rate limit: {rate_limit['remaining']}/{rate_limit['limit']}")
    print(f"Resets at: {rate_limit['reset']}")
    print()

    # Run scraper
    questions = scrape_github_gists(months_back=args.months)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(questions, f, indent=2)
        print(f"Saved {len(questions)} questions to {args.output}")
    else:
        print("\nSample questions:")
        for q in questions[:10]:
            print(f"\n{'='*50}")
            print(f"Company: {q.get('company', 'Unknown')}")
            print(f"Type: {q.get('question_type', 'Unknown')}")
            print(f"Difficulty: {q.get('difficulty', 'Unknown')}")
            print(f"Question: {q.get('question_text', '')[:100]}...")
            print(f"Source: {q.get('source_url', '')}")
