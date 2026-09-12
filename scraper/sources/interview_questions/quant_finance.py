"""Quant finance interview questions scraper.

Fetches interview questions from:
1. brainstellar.com - Brain teaser puzzles for quant interviews
2. quantnet.com forums - Interview experiences for Jane Street, Citadel, Two Sigma, etc.

Filters to last 4-5 months of content where dates are available.

Uses production-grade infrastructure:
- StealthSession for anti-detection (user agents, fingerprints, timing jitter)
- ResponseCache for intelligent caching (avoid redundant requests)
- CheckpointManager for resume capability on failures
- ValidationPipeline for quality filtering
- ReliabilityEngine for source scoring
"""

import re
import requests
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from html import unescape
from urllib.parse import urljoin
import json
import urllib3
import hashlib
import sys
import os

# Add parent path for utils imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Import infrastructure modules with graceful fallback
INFRA_AVAILABLE = False
import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)

try:
    from utils.anti_detection import create_stealth_session, StealthSession
    from utils.cache import ResponseCache, get_cache
    from utils.rate_limiter import AdaptiveRateLimiter
    from utils.monitoring import monitor_scraper, get_monitoring
    INFRA_AVAILABLE = True
except ImportError:
    try:
        from scraper.utils.anti_detection import create_stealth_session, StealthSession
        from scraper.utils.cache import ResponseCache, get_cache
        from scraper.utils.rate_limiter import AdaptiveRateLimiter
        from scraper.utils.monitoring import monitor_scraper, get_monitoring
        INFRA_AVAILABLE = True
    except ImportError:
        logger.warning("[quant_finance] Infrastructure modules not available, using basic mode")
        create_stealth_session = None
        StealthSession = None
        ResponseCache = None
        get_cache = None
        AdaptiveRateLimiter = None
        monitor_scraper = None
        get_monitoring = None

# Try importing optional infrastructure modules
try:
    from utils.error_handler import CheckpointManager, RetryManager
    HAS_CHECKPOINT = True
except ImportError:
    HAS_CHECKPOINT = False
    CheckpointManager = None
    RetryManager = None

try:
    from utils.validation import ValidationPipeline, validate_questions
    HAS_VALIDATION = True
except ImportError:
    HAS_VALIDATION = False
    ValidationPipeline = None
    validate_questions = None

try:
    from utils.reliability import ReliabilityEngine, SourceScorer
    HAS_RELIABILITY = True
except ImportError:
    HAS_RELIABILITY = False
    ReliabilityEngine = None
    SourceScorer = None


@contextmanager
def _monitoring_context(source_name: str = 'quant_finance'):
    """Context manager for scraper monitoring."""
    if INFRA_AVAILABLE and monitor_scraper:
        with monitor_scraper(source_name) as ctx:
            yield ctx
    else:
        # Dummy context when monitoring not available
        class DummyContext:
            def record_questions(self, **kwargs): pass
            def record_request(self, **kwargs): pass
            def record_api_cost(self, **kwargs): pass
        yield DummyContext()

# Disable SSL warnings for sites with cert issues
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

REQUEST_TIMEOUT = 30
VERIFY_SSL = False  # Some puzzle sites have SSL issues

# Initialize infrastructure components
_stealth_session: Optional['StealthSession'] = None
_response_cache: Optional['ResponseCache'] = None
_checkpoint_mgr: Optional['CheckpointManager'] = None
_validation_pipeline: Optional['ValidationPipeline'] = None
_reliability_engine: Optional['ReliabilityEngine'] = None


def _init_infrastructure():
    """Initialize infrastructure components lazily."""
    global _stealth_session, _response_cache, _checkpoint_mgr, _validation_pipeline, _reliability_engine

    if not INFRA_AVAILABLE:
        return

    if _stealth_session is None:
        try:
            _stealth_session = create_stealth_session(
                min_delay=1.5,  # Quant sites are sensitive
                max_delay=4.0,
                requests_per_minute=15  # Conservative for niche sites
            )
            logger.info("[quant_finance] StealthSession initialized")
        except Exception as e:
            logger.warning(f"[quant_finance] Could not initialize StealthSession: {e}")

    if _response_cache is None:
        try:
            _response_cache = ResponseCache(ttl=3600 * 6)  # 6 hour cache
            logger.info("[quant_finance] ResponseCache initialized")
        except Exception as e:
            logger.warning(f"[quant_finance] Could not initialize ResponseCache: {e}")

    if _checkpoint_mgr is None and HAS_CHECKPOINT and CheckpointManager:
        try:
            _checkpoint_mgr = CheckpointManager('quant_finance')
            logger.info("[quant_finance] CheckpointManager initialized")
        except Exception as e:
            logger.warning(f"[quant_finance] Could not initialize CheckpointManager: {e}")

    if _validation_pipeline is None and HAS_VALIDATION and ValidationPipeline:
        try:
            _validation_pipeline = ValidationPipeline(min_quality_score=0.35)
            logger.info("[quant_finance] ValidationPipeline initialized")
        except Exception as e:
            logger.warning(f"[quant_finance] Could not initialize ValidationPipeline: {e}")

    if _reliability_engine is None and HAS_RELIABILITY and ReliabilityEngine:
        try:
            _reliability_engine = ReliabilityEngine()
            logger.info("[quant_finance] ReliabilityEngine initialized")
        except Exception as e:
            logger.warning(f"[quant_finance] Could not initialize ReliabilityEngine: {e}")


def get_stealth_session() -> Optional['StealthSession']:
    """Get the stealth session for quant finance scraping."""
    _init_infrastructure()
    return _stealth_session


def _make_request(url: str, headers: Optional[Dict] = None) -> Optional[requests.Response]:
    """Make a request using infrastructure if available."""
    _init_infrastructure()

    # Check cache first
    if _response_cache and INFRA_AVAILABLE:
        cached = _response_cache.get(url)
        if cached:
            print(f"[cache hit] {url}")
            # Create mock response
            class CachedResponse:
                ok = True
                status_code = 200
                text = cached
            return CachedResponse()

    # Use stealth session if available
    if _stealth_session and INFRA_AVAILABLE:
        config = _stealth_session.get_request_config(url)
        if headers:
            config['headers'].update(headers)

        if _stealth_session.before_request():
            try:
                response = requests.get(
                    url,
                    headers=config['headers'],
                    timeout=config.get('timeout', REQUEST_TIMEOUT),
                    verify=VERIFY_SSL
                )
                _stealth_session.after_request(response.status_code)

                # Cache successful responses
                if response.ok and _response_cache:
                    _response_cache.set(url, response.text)

                return response
            except requests.RequestException as e:
                _stealth_session.after_request(500)
                raise
    else:
        # Fallback to basic request
        default_headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        if headers:
            default_headers.update(headers)
        return requests.get(url, headers=default_headers, timeout=REQUEST_TIMEOUT, verify=VERIFY_SSL)


def _validate_and_score(questions: List['InterviewQuestion']) -> List['InterviewQuestion']:
    """Validate questions and add reliability scores."""
    if not INFRA_AVAILABLE or not _validation_pipeline:
        return questions

    validated = []
    for q in questions:
        # Convert to dict for validation
        q_dict = q.to_dict()

        # Validate
        result = _validation_pipeline.validate(q_dict)
        if result.is_valid:
            # Add reliability score
            if _reliability_engine:
                score = _reliability_engine.score(q_dict)
                q_dict['reliability_score'] = score.overall
            validated.append(InterviewQuestion(**{k: v for k, v in q_dict.items() if k != 'reliability_score'}))

    return validated


def _save_checkpoint(source: str, items_processed: List[str]):
    """Save checkpoint for resume capability."""
    if _checkpoint_mgr and INFRA_AVAILABLE:
        for item_id in items_processed:
            _checkpoint_mgr.mark_seen(item_id)
        _checkpoint_mgr.save_checkpoint()


def _should_skip(item_id: str) -> bool:
    """Check if item was already processed in a previous run."""
    if _checkpoint_mgr and INFRA_AVAILABLE:
        return _checkpoint_mgr.has_seen(item_id)
    return False

# Target quant firms for filtering
QUANT_FIRMS = [
    "jane street", "citadel", "citadel securities", "two sigma",
    "de shaw", "d.e. shaw", "hudson river trading", "hrt",
    "jump trading", "optiver", "imc", "akuna capital",
    "susquehanna", "sig", "drw", "five rings", "tower research",
    "virtu", "flow traders", "maven securities", "g-research",
    "point72", "millennium", "balyasny", "squarepoint",
    "quantlab", "radix trading", "belvedere trading",
]

# Question type patterns
QUESTION_TYPES = {
    "brain_teaser": [
        r"\bpuzzle\b", r"\bbrain\s*teaser\b", r"\briddle\b",
        r"\blogic\s*problem\b", r"\bwhat\s+is\b.*\?",
    ],
    "probability": [
        r"\bprobability\b", r"\bexpected\s+value\b", r"\bE\[",
        r"\bvariance\b", r"\bdistribution\b", r"\bstochastic\b",
        r"\bmarkov\b", r"\brandom\s+walk\b", r"\bdice\b", r"\bcoin\b",
        r"\bcards?\b", r"\bbayes\b",
    ],
    "statistics": [
        r"\bregression\b", r"\bhypothesis\b", r"\bconfidence\b",
        r"\bp-value\b", r"\bstatistic\b", r"\bmean\b.*\bmedian\b",
    ],
    "coding": [
        r"\bcode\b", r"\balgorithm\b", r"\bimplement\b", r"\bfunction\b",
        r"\bpython\b", r"\bc\+\+\b", r"\bdata\s+structure\b",
        r"\btime\s+complexity\b", r"\bO\(", r"\bleetcode\b",
    ],
    "math": [
        r"\bintegral\b", r"\bderivative\b", r"\blimit\b", r"\bprove\b",
        r"\blinear\s+algebra\b", r"\bmatrix\b", r"\beigenvalue\b",
        r"\bcalculus\b", r"\bdifferential\b",
    ],
    "finance": [
        r"\boption\b", r"\bblack.scholes\b", r"\bgreeks\b", r"\bdelta\b",
        r"\bgamma\b", r"\bvolatility\b", r"\bhedg\b", r"\barbitrage\b",
        r"\bmarket\s+making\b", r"\bspread\b", r"\bbid.ask\b",
    ],
    "mental_math": [
        r"\bmental\s+math\b", r"\bquick\b.*\bcalculate\b", r"\bzetamac\b",
        r"\barithmetic\b",
    ],
}

# Difficulty patterns
DIFFICULTY_PATTERNS = {
    "easy": [r"\beasy\b", r"\bsimple\b", r"\bbasic\b", r"\bwarm.up\b"],
    "medium": [r"\bmedium\b", r"\bmoderate\b", r"\bintermediate\b"],
    "hard": [r"\bhard\b", r"\bdifficult\b", r"\bchallenging\b", r"\btricky\b", r"\badvanced\b"],
}


@dataclass
class InterviewQuestion:
    """Represents a single interview question."""
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


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<p>", "\n", text)
    text = re.sub(r"</p>", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return text.strip()


def detect_question_type(text: str) -> str:
    """Detect the type of question based on content."""
    text_lower = text.lower()

    type_scores = {}
    for qtype, patterns in QUESTION_TYPES.items():
        score = 0
        for pattern in patterns:
            if re.search(pattern, text_lower):
                score += 1
        if score > 0:
            type_scores[qtype] = score

    if type_scores:
        return max(type_scores, key=type_scores.get)
    return "general"


def detect_difficulty(text: str) -> str:
    """Detect difficulty level from text."""
    text_lower = text.lower()

    for difficulty, patterns in DIFFICULTY_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                return difficulty

    return "medium"  # Default


def extract_company(text: str) -> str:
    """Extract company name from text."""
    text_lower = text.lower()

    for firm in QUANT_FIRMS:
        if firm in text_lower:
            # Return properly capitalized version
            return firm.title()

    return "Quant Firm"


def is_within_date_range(date_str: Optional[str], months: int = 5) -> bool:
    """Check if date is within the last N months."""
    if not date_str:
        return True  # Include if no date available

    try:
        # Try various date formats
        for fmt in ["%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%d/%m/%Y", "%m/%d/%Y"]:
            try:
                date = datetime.strptime(date_str, fmt)
                cutoff = datetime.now() - timedelta(days=months * 30)
                return date >= cutoff
            except ValueError:
                continue
        return True  # Include if date format unknown
    except Exception:
        return True


# ============================================================================
# BRAINSTELLAR SCRAPER
# ============================================================================

BRAINSTELLAR_BASE = "https://brainstellar.com"
BRAINSTELLAR_CATEGORIES = [
    "/puzzles/all",
    "/puzzles/probability",
    "/puzzles/mathematics",
    "/puzzles/logic",
]


def scrape_brainstellar() -> List[InterviewQuestion]:
    """Scrape brain teaser puzzles from brainstellar.com."""
    questions = []
    seen_ids = set()
    processed_ids = []

    print("[brainstellar] Starting scrape with production infrastructure...")
    _init_infrastructure()

    for category_path in BRAINSTELLAR_CATEGORIES:
        url = urljoin(BRAINSTELLAR_BASE, category_path)
        print(f"[brainstellar] Fetching: {url}")

        try:
            response = _make_request(url)
            if not response or not response.ok:
                print(f"[brainstellar] Failed to fetch {url}")
                continue
            html = response.text
        except requests.RequestException as e:
            print(f"[brainstellar] Error fetching {url}: {e}")
            continue

        # Extract puzzle cards/links
        # Pattern: <a href="/puzzles/XXX" or puzzle-card class patterns
        puzzle_pattern = re.compile(
            r'<a[^>]*href="(/puzzles/[a-z0-9\-]+)"[^>]*>.*?<h[23][^>]*>([^<]+)</h[23]>',
            re.DOTALL | re.IGNORECASE
        )

        # Alternative pattern for list items
        alt_pattern = re.compile(
            r'href="(/puzzles/[a-z0-9\-]+)"[^>]*>([^<]+)</a>',
            re.IGNORECASE
        )

        matches = puzzle_pattern.findall(html)
        if not matches:
            matches = alt_pattern.findall(html)

        for puzzle_path, title in matches:
            puzzle_id = f"brainstellar_{puzzle_path.replace('/', '_')}"

            # Skip if already processed in previous run
            if _should_skip(puzzle_id) or puzzle_path in seen_ids:
                continue
            seen_ids.add(puzzle_path)

            # Fetch individual puzzle page for full content
            puzzle_url = urljoin(BRAINSTELLAR_BASE, puzzle_path)
            question_text = title.strip()

            try:
                puzzle_response = _make_request(puzzle_url)
                if puzzle_response and puzzle_response.ok:
                    puzzle_html = puzzle_response.text

                    # Extract puzzle description
                    # Look for common content containers
                    content_patterns = [
                        re.compile(r'<div[^>]*class="[^"]*puzzle[^"]*content[^"]*"[^>]*>(.*?)</div>', re.DOTALL | re.IGNORECASE),
                        re.compile(r'<div[^>]*class="[^"]*problem[^"]*"[^>]*>(.*?)</div>', re.DOTALL | re.IGNORECASE),
                        re.compile(r'<article[^>]*>(.*?)</article>', re.DOTALL | re.IGNORECASE),
                        re.compile(r'<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)</div>', re.DOTALL | re.IGNORECASE),
                    ]

                    for pattern in content_patterns:
                        content_match = pattern.search(puzzle_html)
                        if content_match:
                            extracted = clean_html(content_match.group(1))
                            if len(extracted) > len(question_text):
                                question_text = f"{title.strip()}\n\n{extracted}"
                            break
            except requests.RequestException:
                pass  # Use title as fallback

            question_text = clean_html(question_text)

            # Detect type and difficulty
            qtype = detect_question_type(question_text)
            if qtype == "general":
                qtype = "brain_teaser"  # Default for brainstellar

            difficulty = detect_difficulty(question_text)

            # Extract tags from category
            category_name = category_path.split("/")[-1]
            tags = [category_name, "brain_teaser", "quant"]

            question = InterviewQuestion(
                id=puzzle_id,
                company="Quant Firms (General)",
                position="Quant Trader / Researcher",
                question_type=qtype,
                difficulty=difficulty,
                question_text=question_text[:2000],  # Limit length
                source="brainstellar",
                source_url=puzzle_url,
                posted_date=None,  # Brainstellar doesn't show dates
                tags=tags,
            )
            questions.append(question)
            processed_ids.append(puzzle_id)

    # Save checkpoint
    _save_checkpoint('brainstellar', processed_ids)

    # Validate and score
    validated = _validate_and_score(questions)
    print(f"[brainstellar] Scraped {len(questions)} puzzles, {len(validated)} passed validation")
    return validated if validated else questions


# ============================================================================
# QUANTNET SCRAPER
# ============================================================================

QUANTNET_BASE = "https://quantnet.com"
QUANTNET_INTERVIEW_FORUM = "/threads/tagged/interview"
QUANTNET_SEARCH_TERMS = ["interview", "jane street", "citadel", "two sigma", "quant interview"]


def scrape_quantnet() -> List[InterviewQuestion]:
    """Scrape interview experiences from quantnet.com forums."""
    questions = []
    seen_ids = set()
    processed_ids = []

    print("[quantnet] Starting scrape with production infrastructure...")
    _init_infrastructure()

    # Method 1: Browse forum categories
    forum_urls = [
        f"{QUANTNET_BASE}/forums/quant-interviews.30/",
        f"{QUANTNET_BASE}/forums/quant-career-advice.79/",
    ]

    for forum_url in forum_urls:
        print(f"[quantnet] Fetching forum: {forum_url}")

        try:
            response = _make_request(forum_url)
            if not response or not response.ok:
                print(f"[quantnet] Forum returned error")
                continue
            html = response.text
        except requests.RequestException as e:
            print(f"[quantnet] Error: {e}")
            continue

        # Extract thread links
        # XenForo pattern: <a href="/threads/title.12345/" data-preview-url
        thread_pattern = re.compile(
            r'<a[^>]*href="(/threads/[^"]+)"[^>]*data-preview-url[^>]*>.*?'
            r'<span[^>]*>([^<]+)</span>',
            re.DOTALL | re.IGNORECASE
        )

        # Simpler fallback pattern
        alt_pattern = re.compile(
            r'href="(/threads/[^"]+\.\d+/?)"[^>]*>([^<]+)</a>',
            re.IGNORECASE
        )

        matches = thread_pattern.findall(html)
        if not matches:
            matches = alt_pattern.findall(html)

        # Also extract dates if available
        date_pattern = re.compile(
            r'<time[^>]*datetime="([^"]+)"[^>]*>',
            re.IGNORECASE
        )
        dates = date_pattern.findall(html)

        for i, (thread_path, title) in enumerate(matches[:50]):  # Limit to 50 threads
            thread_id = f"quantnet_{thread_path.replace('/', '_')}"

            # Skip if already processed
            if _should_skip(thread_id) or thread_path in seen_ids:
                continue

            # Filter for interview-related threads
            title_lower = title.lower()
            if not any(kw in title_lower for kw in ["interview", "quant", "trading", "jane street", "citadel", "two sigma", "experience", "question"]):
                continue

            seen_ids.add(thread_path)

            # Get date if available
            posted_date = dates[i] if i < len(dates) else None
            if posted_date:
                # Parse ISO format
                try:
                    posted_date = posted_date[:10]  # Just the date part
                except Exception:
                    posted_date = None

            # Check date filter
            if not is_within_date_range(posted_date, months=5):
                continue

            thread_url = urljoin(QUANTNET_BASE, thread_path)
            question_text = clean_html(title)

            # Fetch thread content for actual questions
            try:
                thread_response = _make_request(thread_url)
                if thread_response and thread_response.ok:
                    thread_html = thread_response.text

                    # Extract first post content
                    post_patterns = [
                        re.compile(r'<article[^>]*class="[^"]*message-body[^"]*"[^>]*>(.*?)</article>', re.DOTALL | re.IGNORECASE),
                        re.compile(r'<div[^>]*class="[^"]*message-content[^"]*"[^>]*>(.*?)</div>', re.DOTALL | re.IGNORECASE),
                        re.compile(r'<div[^>]*class="[^"]*bbWrapper[^"]*"[^>]*>(.*?)</div>', re.DOTALL | re.IGNORECASE),
                    ]

                    for pattern in post_patterns:
                        post_match = pattern.search(thread_html)
                        if post_match:
                            content = clean_html(post_match.group(1))
                            if len(content) > 50:
                                question_text = f"{title}\n\n{content[:1500]}"
                            break
            except requests.RequestException:
                pass

            # Extract company
            company = extract_company(question_text)

            # Detect type and difficulty
            qtype = detect_question_type(question_text)
            difficulty = detect_difficulty(question_text)

            # Generate tags
            tags = ["quant", "interview"]
            if company.lower() in [f.lower() for f in QUANT_FIRMS]:
                tags.append(company.lower().replace(" ", "_"))
            tags.append(qtype)

            question = InterviewQuestion(
                id=thread_id,
                company=company,
                position="Quant Trader / Researcher / Developer",
                question_type=qtype,
                difficulty=difficulty,
                question_text=question_text[:2000],
                source="quantnet",
                source_url=thread_url,
                posted_date=posted_date,
                tags=list(set(tags)),
            )
            questions.append(question)
            processed_ids.append(thread_id)

    # Save checkpoint
    _save_checkpoint('quantnet', processed_ids)

    # Validate and score
    validated = _validate_and_score(questions)
    print(f"[quantnet] Scraped {len(questions)} threads, {len(validated)} passed validation")
    return validated if validated else questions


# ============================================================================
# CURATED FALLBACK DATA (When sites have bot protection)
# ============================================================================

CURATED_QUANT_QUESTIONS = [
    {
        "id": "curated_js_01",
        "company": "Jane Street",
        "position": "Quant Trader",
        "question_type": "probability",
        "difficulty": "hard",
        "question_text": "You have 100 coins, 99 of which are fair. One coin has heads on both sides. You pick a coin at random and flip it 10 times. All 10 flips come up heads. What is the probability that the coin you picked is the double-headed coin?",
        "source": "curated",
        "source_url": "https://www.janestreet.com/join-jane-street/interview-prep/",
        "posted_date": None,
        "tags": ["probability", "bayes", "jane_street", "quant"],
    },
    {
        "id": "curated_js_02",
        "company": "Jane Street",
        "position": "Quant Trader",
        "question_type": "brain_teaser",
        "difficulty": "hard",
        "question_text": "There are 25 horses. You can race 5 horses at a time. What is the minimum number of races needed to find the 3 fastest horses? (You cannot time the horses, only rank them by race results.)",
        "source": "curated",
        "source_url": "https://www.janestreet.com/join-jane-street/interview-prep/",
        "posted_date": None,
        "tags": ["brain_teaser", "logic", "jane_street", "quant"],
    },
    {
        "id": "curated_citadel_01",
        "company": "Citadel",
        "position": "Quant Researcher",
        "question_type": "probability",
        "difficulty": "hard",
        "question_text": "Two people are playing a game. They take turns rolling a fair six-sided die. The first person to roll a 6 wins. What is the probability that the person who goes first wins?",
        "source": "curated",
        "source_url": "https://www.citadel.com/careers/",
        "posted_date": None,
        "tags": ["probability", "game_theory", "citadel", "quant"],
    },
    {
        "id": "curated_citadel_02",
        "company": "Citadel",
        "position": "Quant Developer",
        "question_type": "coding",
        "difficulty": "medium",
        "question_text": "Implement a function to find the median of a stream of integers. You should be able to add integers to the stream and query the median at any time. What data structure would you use and what is the time complexity?",
        "source": "curated",
        "source_url": "https://www.citadel.com/careers/",
        "posted_date": None,
        "tags": ["coding", "data_structures", "citadel", "quant"],
    },
    {
        "id": "curated_2sigma_01",
        "company": "Two Sigma",
        "position": "Quant Researcher",
        "question_type": "statistics",
        "difficulty": "hard",
        "question_text": "You have a dataset with 1 million data points. How would you detect if there's a change point (a sudden shift in the distribution) somewhere in the dataset? Describe your approach and any statistical tests you would use.",
        "source": "curated",
        "source_url": "https://www.twosigma.com/careers/",
        "posted_date": None,
        "tags": ["statistics", "change_detection", "two_sigma", "quant"],
    },
    {
        "id": "curated_2sigma_02",
        "company": "Two Sigma",
        "position": "Quant Developer",
        "question_type": "coding",
        "difficulty": "hard",
        "question_text": "Design a system that can process 10 million trading events per second. Each event needs to update portfolio positions and risk metrics in real-time. What architecture would you use? Consider latency, throughput, and fault tolerance.",
        "source": "curated",
        "source_url": "https://www.twosigma.com/careers/",
        "posted_date": None,
        "tags": ["system_design", "coding", "two_sigma", "quant"],
    },
    {
        "id": "curated_hrt_01",
        "company": "Hudson River Trading",
        "position": "Algorithm Developer",
        "question_type": "probability",
        "difficulty": "hard",
        "question_text": "You're playing a game where you repeatedly flip a fair coin. Each time you flip heads, you win $1. Each time you flip tails, you lose $1. The game ends when your total winnings reach +$N or -$N. What is the expected number of flips until the game ends?",
        "source": "curated",
        "source_url": "https://www.hudsonrivertrading.com/careers/",
        "posted_date": None,
        "tags": ["probability", "random_walk", "hrt", "quant"],
    },
    {
        "id": "curated_optiver_01",
        "company": "Optiver",
        "position": "Quant Trader",
        "question_type": "mental_math",
        "difficulty": "medium",
        "question_text": "Mental math: What is 87 * 93? (Expected to answer within 5 seconds). Follow-up: What is 127^2? What techniques do you use for fast mental calculation?",
        "source": "curated",
        "source_url": "https://www.optiver.com/working-at-optiver/career-opportunities/",
        "posted_date": None,
        "tags": ["mental_math", "arithmetic", "optiver", "quant"],
    },
    {
        "id": "curated_optiver_02",
        "company": "Optiver",
        "position": "Quant Trader",
        "question_type": "finance",
        "difficulty": "hard",
        "question_text": "Explain how you would price a variance swap. What is the relationship between a variance swap and a portfolio of options? How does the P&L of a delta-hedged option relate to realized variance?",
        "source": "curated",
        "source_url": "https://www.optiver.com/working-at-optiver/career-opportunities/",
        "posted_date": None,
        "tags": ["finance", "options", "variance", "optiver", "quant"],
    },
    {
        "id": "curated_jump_01",
        "company": "Jump Trading",
        "position": "Quant Developer",
        "question_type": "coding",
        "difficulty": "hard",
        "question_text": "Implement a lock-free concurrent queue in C++. Explain your design choices and discuss the memory ordering guarantees needed. What are the trade-offs compared to a mutex-based implementation?",
        "source": "curated",
        "source_url": "https://www.jumptrading.com/careers/",
        "posted_date": None,
        "tags": ["coding", "concurrency", "cpp", "jump_trading", "quant"],
    },
    {
        "id": "curated_deshaw_01",
        "company": "D.E. Shaw",
        "position": "Quant Analyst",
        "question_type": "probability",
        "difficulty": "hard",
        "question_text": "You have an urn with N red balls and M blue balls. You draw balls one at a time without replacement until you draw a red ball. What is the expected number of blue balls drawn before the first red ball?",
        "source": "curated",
        "source_url": "https://www.deshaw.com/careers/",
        "posted_date": None,
        "tags": ["probability", "expected_value", "de_shaw", "quant"],
    },
    {
        "id": "curated_general_01",
        "company": "Quant Firms (General)",
        "position": "Quant Trader / Researcher",
        "question_type": "brain_teaser",
        "difficulty": "medium",
        "question_text": "You have 12 balls, one of which is either heavier or lighter than the rest (you don't know which). Using a balance scale, what is the minimum number of weighings needed to identify the odd ball and determine if it's heavier or lighter?",
        "source": "curated",
        "source_url": "https://brainstellar.com/",
        "posted_date": None,
        "tags": ["brain_teaser", "logic", "quant"],
    },
    {
        "id": "curated_general_02",
        "company": "Quant Firms (General)",
        "position": "Quant Trader / Researcher",
        "question_type": "probability",
        "difficulty": "hard",
        "question_text": "A stick of length 1 is broken at two random points uniformly distributed along its length. What is the probability that the three pieces can form a triangle?",
        "source": "curated",
        "source_url": "https://brainstellar.com/",
        "posted_date": None,
        "tags": ["probability", "geometry", "quant"],
    },
    {
        "id": "curated_general_03",
        "company": "Quant Firms (General)",
        "position": "Quant Trader / Researcher",
        "question_type": "probability",
        "difficulty": "hard",
        "question_text": "You have a biased coin with unknown probability p of heads. How would you use this coin to simulate a fair coin flip? Prove that your method gives exactly 50% probability for each outcome.",
        "source": "curated",
        "source_url": "https://brainstellar.com/",
        "posted_date": None,
        "tags": ["probability", "algorithms", "quant"],
    },
    {
        "id": "curated_general_04",
        "company": "Quant Firms (General)",
        "position": "Quant Developer",
        "question_type": "coding",
        "difficulty": "hard",
        "question_text": "Design an order matching engine for a stock exchange. It should support limit orders, market orders, and cancel requests. What data structures would you use to achieve O(1) matching for market orders?",
        "source": "curated",
        "source_url": "https://quantnet.com/",
        "posted_date": None,
        "tags": ["system_design", "coding", "quant", "trading"],
    },
]


def get_curated_questions() -> List[InterviewQuestion]:
    """Return curated fallback questions when scraping fails."""
    return [
        InterviewQuestion(**q) for q in CURATED_QUANT_QUESTIONS
    ]


# ============================================================================
# COMBINED SCRAPER
# ============================================================================

def scrape_quant_finance(months: int = 5) -> List[Dict[str, Any]]:
    """Scrape all quant finance interview sources.

    Args:
        months: Number of months to look back for dated content

    Returns:
        List of interview question dicts
    """
    all_questions: List[InterviewQuestion] = []

    print("=" * 60)
    print("QUANT FINANCE INTERVIEW SCRAPER")
    print(f"Filtering to last {months} months where dates available")
    print(f"Infrastructure: {'ENABLED' if INFRA_AVAILABLE else 'BASIC MODE'}")
    if INFRA_AVAILABLE:
        print("  - StealthSession: Anti-detection enabled")
        print("  - ResponseCache: 6-hour TTL caching")
        print("  - Monitoring: Metrics and anomaly detection")
        if HAS_CHECKPOINT:
            print("  - CheckpointManager: Resume capability")
        if HAS_VALIDATION:
            print("  - ValidationPipeline: Quality filtering")
        if HAS_RELIABILITY:
            print("  - ReliabilityEngine: Source scoring")
    print("=" * 60)

    with _monitoring_context('quant_finance') as monitor_ctx:
        # Scrape brainstellar
        try:
            brainstellar_questions = scrape_brainstellar()
            all_questions.extend(brainstellar_questions)
            if hasattr(monitor_ctx, 'record_questions'):
                monitor_ctx.record_questions(
                    extracted=len(brainstellar_questions),
                    new=len(brainstellar_questions)
                )
        except Exception as e:
            print(f"[brainstellar] Fatal error: {e}")

        # Scrape quantnet
        try:
            quantnet_questions = scrape_quantnet()
            all_questions.extend(quantnet_questions)
            if hasattr(monitor_ctx, 'record_questions'):
                monitor_ctx.record_questions(
                    extracted=len(quantnet_questions),
                    new=len(quantnet_questions)
                )
        except Exception as e:
            print(f"[quantnet] Fatal error: {e}")

        # If no questions scraped, use curated fallback
        if len(all_questions) == 0:
            print("[fallback] Sites protected, using curated questions...")
            all_questions = get_curated_questions()

    print("=" * 60)
    print(f"TOTAL QUESTIONS: {len(all_questions)}")
    print(f"  - Brainstellar: {len([q for q in all_questions if q.source == 'brainstellar'])}")
    print(f"  - QuantNet: {len([q for q in all_questions if q.source == 'quantnet'])}")
    print(f"  - Curated: {len([q for q in all_questions if q.source == 'curated'])}")
    print("=" * 60)

    # Convert to dicts for return
    return [q.to_dict() for q in all_questions]


# ============================================================================
# CLI ENTRYPOINT
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape quant finance interview questions")
    parser.add_argument("--months", type=int, default=5, help="Months to look back")
    parser.add_argument("--output", type=str, help="Output JSON file")
    args = parser.parse_args()

    questions = scrape_quant_finance(months=args.months)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(questions, f, indent=2)
        print(f"Saved {len(questions)} questions to {args.output}")
    else:
        print(json.dumps(questions[:5], indent=2))  # Preview first 5
        print(f"... and {len(questions) - 5} more")
