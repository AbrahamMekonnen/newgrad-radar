"""Telegram channel monitor for interview questions.

Monitors Telegram channels that share OA questions, interview experiences,
and coding problems. Uses the telethon library for Telegram API access.

SETUP REQUIRED:
1. Go to https://my.telegram.org/apps
2. Create an application to get API credentials
3. Set environment variables:
   - TELEGRAM_API_ID: Your Telegram API ID (numeric)
   - TELEGRAM_API_HASH: Your Telegram API hash (string)
   - TELEGRAM_PHONE: Your phone number for auth (first run only)

MONITORED CHANNELS (examples):
- @leetcode_daily - Daily LeetCode problems with company tags
- @faang_oa - FAANG online assessment questions
- @coding_ninjas_official - Indian interview prep
- @placement_preparation - Placement prep for Indian companies
- @algorithms_ru - Russian-language algorithm discussions

USAGE:
    from telegram_monitor import scrape_telegram
    questions = scrape_telegram(months_back=5, max_messages=500)

NOTE: First run requires interactive phone authentication.
Subsequent runs use cached session file.

INFRASTRUCTURE:
- Uses InstantArchiver for ephemeral content preservation
- Uses ResponseCache to avoid re-processing same messages
- Uses AdaptiveRateLimiter for API throttling
"""

import os
import re
import asyncio
import hashlib
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Set
from dataclasses import dataclass, asdict
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import infrastructure modules with graceful fallback
INFRA_AVAILABLE = False

try:
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'utils'))
    from anti_detection import StealthSession, create_stealth_session
    from realtime import InstantArchiver, WebSocketMonitor, PastebinMonitor
    from cache import ResponseCache, IncrementalScraper, get_cache
    from rate_limiter import AdaptiveRateLimiter
    from monitoring import monitor_scraper, get_monitoring
    INFRA_AVAILABLE = True
except ImportError:
    try:
        from scraper.utils.anti_detection import StealthSession, create_stealth_session
        from scraper.utils.realtime import InstantArchiver, WebSocketMonitor, PastebinMonitor
        from scraper.utils.cache import ResponseCache, IncrementalScraper, get_cache
        from scraper.utils.rate_limiter import AdaptiveRateLimiter
        from scraper.utils.monitoring import monitor_scraper, get_monitoring
        from scraper.utils.error_handler import CheckpointManager
        INFRA_AVAILABLE = True
    except ImportError:
        logger.warning("[telegram_monitor] Infrastructure modules not available, using basic mode")
        CheckpointManager = None
        StealthSession = None
        create_stealth_session = None
        InstantArchiver = None
        WebSocketMonitor = None
        PastebinMonitor = None
        ResponseCache = None
        get_cache = None
        IncrementalScraper = None
        AdaptiveRateLimiter = None
        monitor_scraper = None
        get_monitoring = None

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE:
        try:
            _checkpoint = CheckpointManager("telegram_monitor")
        except Exception:
            pass
    return _checkpoint

# Backward compatibility
HAS_INFRASTRUCTURE = INFRA_AVAILABLE

# Telegram API credentials (required)
TELEGRAM_API_ID = os.environ.get("TELEGRAM_API_ID")
TELEGRAM_API_HASH = os.environ.get("TELEGRAM_API_HASH")
TELEGRAM_PHONE = os.environ.get("TELEGRAM_PHONE")
TELEGRAM_SESSION_FILE = os.environ.get("TELEGRAM_SESSION_FILE", "telegram_session")

# Initialize infrastructure components
_stealth_session: Optional[Any] = None
_archiver: Optional[Any] = None
_cache: Optional[Any] = None
_rate_limiter: Optional[Any] = None
_incremental: Optional[Any] = None
_websocket_monitor: Optional[Any] = None
_pastebin_monitor: Optional[Any] = None


def _init_infrastructure():
    """Initialize infrastructure components lazily."""
    global _stealth_session, _archiver, _cache, _rate_limiter, _incremental, _websocket_monitor, _pastebin_monitor

    if not INFRA_AVAILABLE:
        return

    if _stealth_session is None:
        try:
            _stealth_session = create_stealth_session(
                min_delay=1.0,
                max_delay=3.0,
                requests_per_minute=20  # Telegram API is relatively generous
            )
            logger.info("[telegram_monitor] StealthSession initialized")
        except Exception as e:
            logger.warning(f"[telegram_monitor] Could not initialize StealthSession: {e}")

    if _archiver is None:
        try:
            archive_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'archive', 'telegram')
            _archiver = InstantArchiver(archive_dir=archive_dir)
            logger.info("[telegram_monitor] InstantArchiver initialized for ephemeral content")
        except Exception as e:
            logger.warning(f"[telegram_monitor] Could not initialize InstantArchiver: {e}")

    if _cache is None:
        try:
            _cache = ResponseCache(ttl=3600 * 12)  # 12 hour TTL for Telegram
            logger.info("[telegram_monitor] ResponseCache initialized")
        except Exception as e:
            logger.warning(f"[telegram_monitor] Could not initialize ResponseCache: {e}")

    if _rate_limiter is None:
        try:
            _rate_limiter = AdaptiveRateLimiter(
                base_delay=1.0,
                min_delay=0.5,
                max_delay=10.0,
                target_response_time=2.0
            )
            logger.info("[telegram_monitor] AdaptiveRateLimiter initialized")
        except Exception as e:
            logger.warning(f"[telegram_monitor] Could not initialize AdaptiveRateLimiter: {e}")

    if _incremental is None:
        try:
            _incremental = IncrementalScraper('telegram_monitor')
            logger.info("[telegram_monitor] IncrementalScraper initialized for resume capability")
        except Exception as e:
            logger.warning(f"[telegram_monitor] Could not initialize IncrementalScraper: {e}")

    if _websocket_monitor is None and WebSocketMonitor is not None:
        try:
            _websocket_monitor = WebSocketMonitor(_archiver)
            logger.info("[telegram_monitor] WebSocketMonitor initialized")
        except Exception as e:
            logger.warning(f"[telegram_monitor] Could not initialize WebSocketMonitor: {e}")

    if _pastebin_monitor is None and PastebinMonitor is not None:
        try:
            _pastebin_monitor = PastebinMonitor(_archiver)
            logger.info("[telegram_monitor] PastebinMonitor initialized")
        except Exception as e:
            logger.warning(f"[telegram_monitor] Could not initialize PastebinMonitor: {e}")


def get_stealth_session() -> Optional[Any]:
    """Get the stealth session for Telegram requests."""
    _init_infrastructure()
    return _stealth_session


def get_websocket_monitor() -> Optional[Any]:
    """Get the WebSocket monitor for real-time Telegram monitoring."""
    _init_infrastructure()
    return _websocket_monitor


def get_pastebin_monitor() -> Optional[Any]:
    """Get the Pastebin monitor for capturing ephemeral content."""
    _init_infrastructure()
    return _pastebin_monitor

# Default channels to monitor for interview questions
DEFAULT_CHANNELS = [
    # English channels
    "leetcode_daily",
    "faang_oa",
    "codinginterviewprep",
    "dailycoding",
    "algorithmsclub",
    "oa_solutions",
    "faang_interview",

    # Indian channels
    "placement_preparation",
    "coding_ninjas_official",
    "interviewbit_community",

    # Russian channels
    "algorithms_ru",
    "leetcode_ru",
    "frontendinterview",
    "javaquestions",
    "pythoninterview",

    # Chinese-related (international)
    "leetcode_cn",
]

# Keyword queries used to DISCOVER live public channels/groups via Telegram's
# global search (contacts.Search). Public hardcoded usernames rot fast, but
# people constantly create new channels that dump company interview questions,
# OAs, and placement experiences — search finds the ones alive right now.
# Built programmatically so coverage spans many languages, countries and
# companies — Telegram search matches channel titles/usernames, so native-
# script terms surface non-English channels English terms never would.


def _build_search_queries() -> List[str]:
    english = [
        # Core interview-prep
        "leetcode", "leetcode discuss", "leetcode solutions", "coding interview",
        "interview questions", "interview experience", "interview preparation",
        "interview prep", "tech interview", "faang", "faang interview",
        "faang preparation", "online assessment", "oa questions", "coding round",
        "system design interview", "system design", "dsa", "dsa sheet",
        "dsa questions", "competitive programming", "software engineer interview",
        "sde interview", "sde sheet", "sde preparation", "backend interview",
        "frontend interview", "fullstack interview", "machine learning interview",
        "ml interview", "data science interview", "data engineer interview",
        "coding questions", "coding problems", "hackerrank", "codesignal",
        "hackerearth", "codechef", "interview cake", "cracking the coding interview",
        "behavioral interview", "hr interview", "aptitude", "mock interview",
        "referrals", "off campus", "off campus drive", "on campus placement",
        "placement", "placement preparation", "placement material", "campus placement",
        "product based companies", "service based companies", "dream placement",
        "job openings", "tech jobs", "fresher jobs", "internship", "new grad",
        "quant interview", "quant finance interview", "trading interview",
        "devops interview", "sql interview", "python interview", "java interview",
        "javascript interview", "golang interview", "android interview",
        "ios interview", "cloud interview", "aws interview", "kubernetes interview",
    ]
    # People name channels after the target company.
    companies = [
        "amazon", "google", "microsoft", "meta", "apple", "netflix", "uber",
        "goldman sachs", "jane street", "citadel", "nvidia", "salesforce",
        "adobe", "bloomberg", "atlassian", "stripe", "tiktok", "bytedance",
        "oracle", "linkedin", "paypal", "walmart", "visa", "mastercard",
        "jpmorgan", "morgan stanley", "deloitte", "accenture", "tcs", "infosys",
        "wipro", "cognizant", "capgemini", "flipkart", "swiggy", "zomato",
        "paytm", "razorpay", "phonepe", "samsung", "intel", "qualcomm", "cisco",
        "vmware", "sap", "ibm", "dell", "servicenow", "databricks", "snowflake",
        "palantir", "doordash", "airbnb", "coinbase", "robinhood",
    ]
    company_qs = [f"{c} interview" for c in companies] + [f"{c} oa" for c in companies[:20]]
    # country/region + placement/jobs — surfaces regional community channels.
    countries = [
        "india", "usa", "uk", "canada", "germany", "russia", "ukraine", "china",
        "japan", "korea", "brazil", "indonesia", "vietnam", "turkey", "egypt",
        "nigeria", "pakistan", "bangladesh", "poland", "spain", "france",
        "israel", "singapore", "philippines", "mexico", "argentina", "italy",
    ]
    country_qs = []
    for c in countries:
        country_qs += [f"{c} placement", f"{c} it jobs", f"{c} coding jobs",
                       f"{c} tech interview"]
    # Native-script / transliterated terms per major language.
    multilingual = [
        # Russian / Ukrainian
        "собеседование", "собеседование программист", "алгоритмы собеседование",
        "вопросы на собеседовании", "подготовка к собеседованию", "литкод",
        "співбесіда", "айті вакансії",
        # Chinese (simplified/traditional)
        "面试题", "算法面试", "求职", "刷题", "面经", "力扣", "字节跳动面试",
        "程序员面试", "校招", "内推",
        # Hindi / Indian languages
        "नौकरी", "प्लेसमेंट", "साक्षात्कार",
        # Spanish / Portuguese
        "entrevista programacion", "entrevista tecnica", "preparacion entrevista",
        "entrevista de emprego ti", "vagas programador", "entrevista tecnica ti",
        # Arabic
        "مقابلة عمل برمجة", "أسئلة مقابلة", "وظائف برمجة",
        # Indonesian / Vietnamese / Turkish / Korean / Japanese / French / German
        "lowongan programmer", "persiapan interview", "phong van lap trinh",
        "tuyen dung it", "yazılım mülakat", "mülakat soruları",
        "개발자 면접", "코딩테스트", "コーディング面接", "エンジニア転職",
        "entretien technique", "offres emploi developpeur",
        "vorstellungsgespräch programmierer", "bewerbung informatik",
    ]
    seen = set()
    out = []
    for q in english + company_qs + country_qs + multilingual:
        if q not in seen:
            seen.add(q)
            out.append(q)
    return out


SEARCH_QUERIES = _build_search_queries()

# Company detection patterns (100+ companies)
KNOWN_COMPANIES = [
    # FAANG / MAANG
    "google", "meta", "facebook", "amazon", "apple", "netflix", "microsoft",
    # Big Tech
    "uber", "lyft", "airbnb", "dropbox", "stripe", "slack", "zoom",
    "twitter", "x corp", "linkedin", "pinterest", "snap", "snapchat",
    "spotify", "nvidia", "intel", "amd", "qualcomm", "oracle", "salesforce",
    "adobe", "vmware", "cisco", "ibm", "hp", "dell",
    # Fintech / Payments
    "paypal", "square", "block", "robinhood", "coinbase", "plaid",
    "chime", "sofi", "affirm", "klarna", "stripe",
    # Unicorns / Startups
    "databricks", "snowflake", "palantir", "doordash", "instacart",
    "reddit", "discord", "figma", "notion", "canva", "asana",
    "twilio", "datadog", "cloudflare", "elastic", "mongodb",
    "confluent", "hashicorp", "gitlab", "atlassian",
    # Quant / Trading
    "jane street", "citadel", "two sigma", "de shaw", "d.e. shaw",
    "hudson river", "hrt", "jump trading", "optiver", "imc",
    "akuna", "susquehanna", "sig", "drw", "five rings",
    "tower research", "virtu", "flow traders",
    # Enterprise
    "workday", "servicenow", "splunk", "palo alto", "crowdstrike",
    "okta", "zscaler", "docusign", "coupa", "veeva",
    # E-commerce / Retail
    "shopify", "ebay", "wayfair", "chewy", "etsy", "wish",
    "target", "walmart", "costco", "kroger",
    # Gaming
    "roblox", "epic games", "riot games", "activision", "blizzard",
    "ea", "electronic arts", "unity", "valve",
    # Autonomous / Robotics
    "waymo", "cruise", "aurora", "nuro", "zoox", "argo",
    "tesla", "rivian", "lucid",
    # Social / Media
    "tiktok", "bytedance", "twitch", "youtube",
    # Indian Tech
    "flipkart", "swiggy", "zomato", "razorpay", "phonepe", "paytm",
    "ola", "meesho", "cred", "dream11", "groww", "zerodha",
    # Chinese Tech
    "alibaba", "tencent", "baidu", "jd", "meituan", "pinduoduo",
    "didi", "xiaomi", "huawei",
    # Korean Tech
    "kakao", "naver", "samsung", "lg", "coupang", "toss", "line",
    # Japanese Tech
    "rakuten", "mercari", "cybereagent", "dena", "yahoo japan",
    # European Tech
    "revolut", "wise", "transferwise", "klarna", "spotify", "adyen",
    "booking", "zalando", "delivery hero", "glovo",
    # Southeast Asian Tech
    "grab", "gojek", "sea", "shopee", "lazada",
]

# Question type detection patterns
QUESTION_TYPE_PATTERNS = {
    "online_assessment": [
        r"\bOA\b", r"\bonline\s*assessment\b", r"\bcoding\s*test\b",
        r"\bhackerrank\b", r"\bcodesignal\b", r"\bleetcode\b",
        r"\bkarat\b", r"\bcodepad\b", r"\bhackerearth\b",
    ],
    "technical": [
        r"\balgorithm\b", r"\bdata\s*structure\b", r"\barray\b",
        r"\btree\b", r"\bgraph\b", r"\bDP\b", r"\bdynamic\s*programming\b",
        r"\blinked\s*list\b", r"\bstack\b", r"\bqueue\b", r"\bheap\b",
        r"\bhash\b", r"\bbinary\s*search\b", r"\bsort\b", r"\bBFS\b", r"\bDFS\b",
    ],
    "system_design": [
        r"\bsystem\s*design\b", r"\bscalability\b", r"\bload\s*balancer\b",
        r"\bcache\b", r"\bdatabase\b", r"\bmicroservice\b", r"\bAPI\b",
        r"\bdistributed\b", r"\barchitecture\b",
    ],
    "behavioral": [
        r"\bbehavioral\b", r"\bSTAR\b", r"\bleadership\b",
        r"\btell\s*me\s*about\b", r"\bwhy\s*do\s*you\b",
        r"\bstrength\b", r"\bweakness\b", r"\bchallenge\b",
    ],
    "coding": [
        r"\bcode\b", r"\bimplement\b", r"\bfunction\b", r"\bmethod\b",
        r"\bpython\b", r"\bjava\b", r"\bc\+\+\b", r"\bjavascript\b",
    ],
}

# Role type detection
ROLE_PATTERNS = {
    "swe": [r"\bswe\b", r"\bsoftware\s*engineer\b", r"\bsde\b"],
    "frontend": [r"\bfrontend\b", r"\bfront\s*end\b", r"\breact\b", r"\bvue\b", r"\bangular\b"],
    "backend": [r"\bbackend\b", r"\bback\s*end\b", r"\bserver\b"],
    "fullstack": [r"\bfull\s*stack\b", r"\bfullstack\b"],
    "ml": [r"\bmachine\s*learning\b", r"\bML\b", r"\bAI\b", r"\bdata\s*scientist\b"],
    "data": [r"\bdata\s*engineer\b", r"\bdata\s*analyst\b", r"\bDE\b"],
    "mobile": [r"\bios\b", r"\bandroid\b", r"\bmobile\b", r"\bflutter\b", r"\breact\s*native\b"],
    "infra": [r"\binfra\b", r"\bplatform\b", r"\bSRE\b", r"\bdevops\b", r"\bcloud\b"],
}

# Difficulty patterns
DIFFICULTY_PATTERNS = {
    "easy": [r"\beasy\b", r"\bsimple\b", r"\bbasic\b", r"\blc\s*easy\b", r"\bleetcode\s*easy\b"],
    "medium": [r"\bmedium\b", r"\bmoderate\b", r"\blc\s*medium\b", r"\bleetcode\s*medium\b"],
    "hard": [r"\bhard\b", r"\bdifficult\b", r"\bcomplex\b", r"\blc\s*hard\b", r"\bleetcode\s*hard\b"],
}


@dataclass
class InterviewQuestion:
    """Represents an interview question from Telegram."""
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


def generate_question_id(company: str, question_text: str) -> str:
    """Generate unique ID from company and question text."""
    content = f"{company.lower().strip()}:{question_text.lower().strip()}"
    return hashlib.md5(content.encode()).hexdigest()[:16]


_COMPANY_PATTERNS: Optional[List] = None


def _build_company_patterns() -> List:
    """Compile word-boundary regexes for every known company.

    Raw substring matching is disastrous for short names — "ea" matches
    "team"/"please", "line" matches "online", "lg"/"hp" match inside words.
    Word boundaries fix that. Longest names are tried first so multi-word
    aliases ("electronic arts") win over their short forms ("ea").
    """
    pats = []
    for company in KNOWN_COMPANIES:
        escaped = r"\s+".join(re.escape(w) for w in company.split())
        pats.append((company, re.compile(r"\b" + escaped + r"\b", re.IGNORECASE)))
    pats.sort(key=lambda p: len(p[0]), reverse=True)
    return pats


# Company names that are also common English words. Word boundaries aren't
# enough ("line by line", "booking a slot", "target sum", "wish list"), so for
# these we require a Capitalized (proper-noun) occurrence to count as a match.
_AMBIGUOUS_COMPANIES = {
    "line", "booking", "target", "wish", "block", "notion", "sea", "wise",
    "ola", "unity", "square", "meta", "snap", "match", "box", "apple", "sig",
}


def detect_company(text: str) -> Optional[str]:
    """Detect company name from text using word-boundary matching."""
    global _COMPANY_PATTERNS
    if _COMPANY_PATTERNS is None:
        _COMPANY_PATTERNS = _build_company_patterns()
    for company, pat in _COMPANY_PATTERNS:
        matches = list(pat.finditer(text))
        if not matches:
            continue
        if company in _AMBIGUOUS_COMPANIES:
            # require at least one Capitalized/upper occurrence (proper noun)
            if not any(m.group(0)[:1].isupper() for m in matches):
                continue
        return company.title()
    return None


# A candidate that is really a URL, a file path, or mostly non-Latin text is
# not an interview question — these gates strip the Telegram noise.
_URLISH = re.compile(r"https?://|www\.|\w+\.(?:com|net|org|io|ru|cn|de|co)\b", re.IGNORECASE)


def _looks_like_question(q: str) -> bool:
    """Heuristic gate: does this fragment read like a real question/prompt?"""
    q = q.strip()
    if not (15 <= len(q) <= 600):
        return False
    if _URLISH.search(q):
        return False
    # slash between word chars => path/URL fragment (net/catalog, ru/claude-…)
    if re.search(r"\w/\w", q):
        return False
    # need enough Latin letters (filters Russian/Chinese-only snippets)
    latin = sum(1 for c in q if "a" <= c.lower() <= "z")
    if latin < 12 or latin / len(q) < 0.4:
        return False
    # need at least 3 word-ish tokens
    if len(re.findall(r"[A-Za-z]{2,}", q)) < 3:
        return False
    return True


def detect_question_type(text: str) -> str:
    """Detect question type from text."""
    text_lower = text.lower()
    for qtype, patterns in QUESTION_TYPE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return qtype
    return "technical"


def detect_role(text: str) -> str:
    """Detect role type from text."""
    text_lower = text.lower()
    for role, patterns in ROLE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return role
    return "swe"


def detect_difficulty(text: str) -> str:
    """Detect difficulty from text."""
    text_lower = text.lower()
    for difficulty, patterns in DIFFICULTY_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return difficulty
    return "medium"


def extract_questions_from_text(text: str) -> List[str]:
    """Extract individual questions from a message."""
    questions = []

    # Pattern 1: Lines ending with ?
    q_marks = re.findall(r"[^.!?]*\?", text)
    questions.extend([q.strip() for q in q_marks if len(q.strip()) > 15])

    # Pattern 2: Numbered items (1. Question, 2. Question)
    numbered = re.findall(r"\d+[\.\)]\s*([^\n]+)", text)
    questions.extend([q.strip() for q in numbered if len(q.strip()) > 15])

    # Pattern 3: Lines starting with Q: or Question:
    q_prefix = re.findall(r"(?:Q:|Question:)\s*([^\n]+)", text, re.IGNORECASE)
    questions.extend([q.strip() for q in q_prefix])

    # Pattern 4: Problem/Task descriptions
    problem = re.findall(r"(?:Problem:|Task:|Given)[\s:]*([^\n]+(?:\n[^\n]+)?)", text, re.IGNORECASE)
    questions.extend([q.strip() for q in problem if len(q.strip()) > 20])

    # Dedupe while preserving order
    seen = set()
    unique = []
    for q in questions:
        q_normalized = q.lower().strip()
        if q_normalized not in seen and _looks_like_question(q):
            seen.add(q_normalized)
            unique.append(q)

    return unique


def extract_topics(text: str) -> List[str]:
    """Extract topic tags from text."""
    topics = []
    text_lower = text.lower()

    topic_keywords = [
        "array", "string", "tree", "graph", "dp", "dynamic programming",
        "binary search", "two pointers", "sliding window", "backtracking",
        "recursion", "stack", "queue", "heap", "hash", "linked list",
        "sorting", "greedy", "bfs", "dfs", "trie", "union find",
        "math", "bit manipulation", "design", "simulation",
    ]

    for topic in topic_keywords:
        if topic in text_lower:
            topics.append(topic)

    return topics


# Persisted set of discovered channel usernames. Grows across runs so the
# monitored universe keeps expanding instead of restarting from scratch.
_CHANNEL_CACHE_FILE = os.path.join(
    os.path.dirname(__file__), ".telegram_channels.json"
)


def _load_channel_cache() -> List[str]:
    try:
        import json
        with open(_CHANNEL_CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return list(data) if isinstance(data, list) else []
    except Exception:
        return []


def _save_channel_cache(usernames: List[str]) -> None:
    try:
        import json
        merged = sorted(set(_load_channel_cache()) | set(usernames))
        with open(_CHANNEL_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(merged, f)
        logger.info(f"Channel cache now holds {len(merged)} usernames")
    except Exception as e:
        logger.debug(f"Could not persist channel cache: {e}")


# Richer cache holding id + access_hash so warm runs can build InputPeerChannel
# directly and skip the (slow) discovery stage without any ResolveUsername call.
_ENTITY_CACHE_FILE = os.path.join(
    os.path.dirname(__file__), ".telegram_entities.json"
)


def _save_entity_cache(entities: List[Any]) -> None:
    try:
        import json, time
        rows = []
        for e in entities:
            ah = getattr(e, "access_hash", None)
            eid = getattr(e, "id", None)
            if ah is None or eid is None:
                continue
            rows.append({
                "id": eid,
                "access_hash": ah,
                "username": getattr(e, "username", None),
                "title": getattr(e, "title", None),
                "participants": getattr(e, "participants_count", 0) or 0,
            })
        with open(_ENTITY_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"saved_at": time.time(), "channels": rows}, f)
        logger.info(f"Entity cache now holds {len(rows)} channels (with access_hash)")
    except Exception as e:
        logger.debug(f"Could not persist entity cache: {e}")


def _load_entity_cache(max_age_hours: float = 12) -> List[Dict[str, Any]]:
    try:
        import json, time
        with open(_ENTITY_CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if time.time() - data.get("saved_at", 0) > max_age_hours * 3600:
            return []  # stale — force fresh discovery
        return data.get("channels", []) or []
    except Exception:
        return []


def _is_public_channel(chat: Any) -> bool:
    """A broadcast channel or megagroup with a public username (readable
    without joining)."""
    if not getattr(chat, "username", None):
        return False
    return bool(getattr(chat, "broadcast", False) or getattr(chat, "megagroup", False))


# Tokens that mark a channel as interview/coding/placement-relevant. Telegram's
# "similar channels" recommendations drift fast (a jobs channel is "similar" to
# crypto, English-learning, news...), so every discovered channel must match at
# least one of these in its username or title or it is dropped.
_RELEVANCE_TOKENS = (
    "interview", "leetcode", "leet code", "coding", "coding", "dsa", "sde",
    "faang", "maang", "algorithm", "algo", "competitive", "hackerrank",
    "codeforces", "codechef", "codingninja", "coding ninja", "interviewbit",
    "geeksforgeeks", "gfg", "placement", "campus", "aptitude", "cracking",
    "system design", "systemdesign", "oa ", "online assessment", "coding test",
    "codetest", "programmer", "programming", "developer", "software engineer",
    "swe", "cs prep", "tech prep", "career prep", "off campus", "offcampus",
    "recruit", "questpre", "exam2026", "exam 2026",
    # multilingual interview/coding markers
    "собеседован", "литкод", "алгоритм", "面试", "面经", "刷题", "力扣", "校招",
    "코딩", "면접", "コーディング", "エンジニア", "mülakat", "entrevista",
    "programador", "programacion", "मॉक", "साक्षात्कार", "प्लेसमेंट",
)


def _is_relevant_channel(chat: Any) -> bool:
    hay = (
        (getattr(chat, "username", "") or "") + " " + (getattr(chat, "title", "") or "")
    ).lower()
    return any(tok in hay for tok in _RELEVANCE_TOKENS)


async def discover_channels(
    client: Any,
    queries: Optional[List[str]] = None,
    per_query_limit: int = 50,
    max_channels: int = 2500,
    use_recommendations: bool = True,
    max_recommendation_calls: int = 250,
) -> List[Any]:
    """Discover live public channels/groups and return telethon ENTITIES.

    Two-stage expansion:
      1. contacts.Search across every keyword in ``queries``.
      2. channels.GetChannelRecommendations ("similar channels") seeded from
         what stage 1 found — this snowballs into far more channels than
         search alone surfaces.

    Returns entity objects (which carry access_hash), so callers can read
    history WITHOUT a per-username ResolveUsername call — resolves are the
    operation that triggers 12–24h Telegram flood bans.
    """
    try:
        from telethon.tl.functions.contacts import SearchRequest
        from telethon.errors import FloodWaitError
    except ImportError:
        return []
    try:
        from telethon.tl.functions.channels import GetChannelRecommendationsRequest
        _have_recs = True
    except ImportError:
        _have_recs = False

    if queries is None:
        queries = SEARCH_QUERIES

    found: Dict[Any, Any] = {}  # channel_id -> entity (deduped)

    def _add(chat: Any) -> None:
        if _is_public_channel(chat) and _is_relevant_channel(chat):
            found.setdefault(getattr(chat, "id", None), chat)

    # Stage 1: keyword search.
    for i, q in enumerate(queries):
        if len(found) >= max_channels:
            break
        try:
            res = await client(SearchRequest(q=q, limit=per_query_limit))
            for chat in getattr(res, "chats", []) or []:
                _add(chat)
        except FloodWaitError as e:
            wait = getattr(e, "seconds", 0)
            if wait <= 20:
                await asyncio.sleep(wait + 1)
            else:
                logger.warning(f"Search flood wait {wait}s — stopping search stage")
                break
        except Exception as e:
            logger.debug(f"search '{q}' failed: {e}")
        if i % 25 == 0:
            logger.info(f"  search progress: {i}/{len(queries)} queries, {len(found)} channels")
        await asyncio.sleep(0.3)

    logger.info(f"Search stage found {len(found)} channels")

    # Stage 2: recommendations snowball (breadth-first over what we have).
    # Hard-capped: each call is cheap individually but making thousands in one
    # run trips Telegram's anti-abuse flood limit (a ~12h ban on Search too).
    # A few hundred calls already surfaces 700-800 relevant channels, and the
    # warm entity cache means discovery runs at most once per 12h anyway.
    if use_recommendations and _have_recs and found:
        seeds = list(found.values())
        idx = 0
        calls = 0
        while idx < len(seeds) and len(found) < max_channels and calls < max_recommendation_calls:
            seed = seeds[idx]
            idx += 1
            calls += 1
            try:
                rec = await client(GetChannelRecommendationsRequest(channel=seed))
                for chat in getattr(rec, "chats", []) or []:
                    before = len(found)
                    _add(chat)
                    # newly found channels become seeds too (bounded by cap)
                    if len(found) > before and len(seeds) < max_channels:
                        seeds.append(chat)
            except FloodWaitError as e:
                wait = getattr(e, "seconds", 0)
                if wait <= 20:
                    await asyncio.sleep(wait + 1)
                else:
                    logger.warning(f"Recommendations flood wait {wait}s — stopping")
                    break
            except Exception as e:
                logger.debug(f"recommendations failed: {e}")
            if idx % 50 == 0:
                logger.info(f"  recommendations: expanded to {len(found)} channels ({calls} calls)")
            await asyncio.sleep(0.5)

    entities = list(found.values())
    # Prefer larger communities first (more content, more likely active).
    entities.sort(key=lambda c: getattr(c, "participants_count", 0) or 0, reverse=True)
    entities = entities[:max_channels]
    _save_channel_cache([c.username for c in entities if getattr(c, "username", None)])
    _save_entity_cache(entities)  # persist id+access_hash for fast warm runs
    logger.info(f"Discovered {len(entities)} public channels (search + recommendations)")
    return entities


async def fetch_telegram_messages(
    channels: List[str],
    months_back: int = 5,
    max_messages_per_channel: int = 100,
    discover: bool = True,
    max_channels: int = 2000,
    time_budget_seconds: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch messages from Telegram channels using telethon.

    Requires TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables.
    First run requires phone number authentication.

    Uses infrastructure:
    - InstantArchiver: Archives messages immediately (ephemeral content)
    - ResponseCache: Caches processed messages
    - AdaptiveRateLimiter: Respects API rate limits
    - IncrementalScraper: Skips already-seen messages

    Args:
        channels: List of channel usernames (without @)
        months_back: How many months of history to fetch
        max_messages_per_channel: Maximum messages per channel

    Returns:
        List of message dicts with text, date, channel info
    """
    # Initialize infrastructure
    _init_infrastructure()

    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
        from telethon.tl.types import Channel, Message
    except ImportError:
        logger.error("telethon not installed. Run: pip install telethon")
        return []

    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        logger.error(
            "Missing Telegram credentials. Set TELEGRAM_API_ID and TELEGRAM_API_HASH"
        )
        return []

    messages = []
    cutoff_date = datetime.now() - timedelta(days=months_back * 30)

    # Prefer a StringSession (from TELEGRAM_SESSION_STRING) so this runs
    # headlessly in CI; fall back to a local file session for interactive use.
    _session_str = os.environ.get("TELEGRAM_SESSION_STRING")
    _session = StringSession(_session_str) if _session_str else TELEGRAM_SESSION_FILE

    async with TelegramClient(
        _session,
        int(TELEGRAM_API_ID),
        TELEGRAM_API_HASH,
    ) as client:
        # Authenticate if needed (first run)
        if not await client.is_user_authorized():
            if TELEGRAM_PHONE:
                await client.send_code_request(TELEGRAM_PHONE)
                logger.info(f"Auth code sent to {TELEGRAM_PHONE}. Enter it manually.")
            else:
                logger.error("Set TELEGRAM_PHONE for first-time authentication")
                return []

        from telethon.errors import FloodWaitError
        from telethon.tl.types import InputPeerChannel

        # Build the target list. Each entry is (label, peer, trusted):
        #   - seed usernames        -> (name, None, False)  resolved lazily
        #   - warm entity cache     -> (name, InputPeerChannel, True)  no resolve
        #   - freshly discovered    -> (name, entity, True)  no resolve
        # peers built from access_hash need no ResolveUsername call — bulk
        # resolves are what trigger 12–24h flood bans.
        targets: List[Any] = []
        seen_ch: set = set()

        def _queue(label: Optional[str], peer: Any, trusted: bool) -> None:
            if not label:
                return
            key = label.lower()
            if key in seen_ch:
                return
            seen_ch.add(key)
            targets.append((label, peer, trusted))

        for name in channels:  # explicit seeds first
            _queue(name, None, False)

        if discover:
            warm = _load_entity_cache(max_age_hours=12)
            if warm:
                # Reuse recently-discovered channels — skips the ~6 min search
                # + recommendations stage entirely on warm runs.
                logger.info(f"Using {len(warm)} channels from warm entity cache (skipping discovery)")
                for row in warm:
                    ah = row.get("access_hash")
                    if ah is None:
                        continue
                    peer = InputPeerChannel(channel_id=row["id"], access_hash=ah)
                    _queue(row.get("username") or str(row["id"]), peer, True)
            else:
                try:
                    discovered = await discover_channels(client, max_channels=max_channels)
                except Exception as e:
                    logger.warning(f"Channel discovery failed: {e}")
                    discovered = []
                for ent in discovered:
                    _queue(getattr(ent, "username", None), ent, True)

        targets = targets[:max_channels]
        logger.info(f"Monitoring {len(targets)} channels total")

        _loop_start = asyncio.get_event_loop().time()

        async def _fetch_one(label: str, peer: Any, trusted: bool) -> List[Dict[str, Any]]:
            """Fetch one channel's recent messages. Returns msg dicts (may be [])."""
            out: List[Dict[str, Any]] = []
            try:
                if peer is not None:
                    channel = peer  # entity or InputPeerChannel — no resolve
                else:
                    try:
                        channel = await client.get_entity(label)
                    except FloodWaitError as e:
                        logger.warning(f"Resolve flood wait {e.seconds}s for @{label} — skipping")
                        return out
                    if not isinstance(channel, Channel):
                        return out

                count = 0
                async for message in client.iter_messages(channel, limit=max_messages_per_channel):
                    if not isinstance(message, Message):
                        continue
                    if message.date.replace(tzinfo=None) < cutoff_date:
                        break
                    if not message.text or len(message.text) < 30:
                        continue
                    msg_key = f"{label}:{message.id}"
                    if _incremental and _incremental.has_seen(msg_key):
                        continue
                    msg_data = {
                        "text": message.text,
                        "date": message.date.isoformat(),
                        "channel": label,
                        "channel_title": getattr(channel, "title", label),
                        "message_id": message.id,
                        "views": getattr(message, "views", 0) or 0,
                        "forwards": getattr(message, "forwards", 0) or 0,
                    }
                    if _archiver:
                        try:
                            _archiver.archive({'source': f'telegram:{label}',
                                               'content': message.text, 'metadata': msg_data})
                        except Exception:
                            pass
                    out.append(msg_data)
                    if _incremental:
                        _incremental.mark_seen(msg_key)
                    count += 1
                if count:
                    logger.info(f"Fetched {count} new messages from @{label}")
            except FloodWaitError as e:
                if e.seconds <= 20:
                    await asyncio.sleep(e.seconds + 1)
                else:
                    logger.warning(f"History flood wait {e.seconds}s for @{label} — skipping")
            except Exception as e:
                logger.debug(f"Error fetching @{label}: {e}")
            return out

        # Fetch channels concurrently in bounded batches. Concurrency turns a
        # ~20 min sequential crawl into a few minutes; the time budget is
        # checked between batches so overrun is at most one batch.
        concurrency = 6
        i = 0
        stopped = False
        while i < len(targets):
            if time_budget_seconds is not None and \
                    (asyncio.get_event_loop().time() - _loop_start) > time_budget_seconds:
                logger.info(f"Time budget {time_budget_seconds}s reached after {i} channels "
                            f"— stopping (rest next run)")
                stopped = True
                break
            batch = targets[i:i + concurrency]
            i += concurrency
            results = await asyncio.gather(
                *[_fetch_one(lbl, peer, trusted) for lbl, peer, trusted in batch]
            )
            for r in results:
                messages.extend(r)
        if not stopped:
            logger.info(f"Fetched all {i} channels within budget")

    # Save incremental state
    if _incremental:
        _incremental.save_state()

    return messages


def parse_telegram_messages(
    messages: List[Dict[str, Any]],
) -> List[InterviewQuestion]:
    """
    Parse Telegram messages into InterviewQuestion objects.

    Args:
        messages: Raw messages from fetch_telegram_messages

    Returns:
        List of InterviewQuestion objects
    """
    questions = []
    seen_ids: Set[str] = set()

    for msg in messages:
        text = msg["text"]
        channel = msg["channel"]
        date = msg.get("date")

        # Detect company
        company = detect_company(text)
        if not company:
            company = "Unknown"

        # Extract individual questions from message
        extracted = extract_questions_from_text(text)

        if not extracted:
            # Use the whole message as a question if no specific questions found
            # but only if it looks like interview content AND reads like a question
            if any(kw in text.lower() for kw in ["interview", "oa", "asked", "question", "problem"]):
                candidate = text.strip().lstrip("*# ").strip()[:500]
                if _looks_like_question(candidate):
                    extracted = [candidate]

        for q_text in extracted:
            # Generate ID
            q_id = generate_question_id(company, q_text)

            # Skip duplicates
            if q_id in seen_ids:
                continue
            seen_ids.add(q_id)

            # Detect attributes
            q_type = detect_question_type(q_text)
            role = detect_role(text)  # Check full message for role context
            difficulty = detect_difficulty(q_text)
            topics = extract_topics(q_text)

            questions.append(InterviewQuestion(
                id=q_id,
                company=company,
                position=role,
                question_type=q_type,
                difficulty=difficulty,
                question_text=q_text.strip(),
                source=f"telegram:{channel}",
                source_url=f"https://t.me/{channel}",
                posted_date=date,
                tags=topics,
            ))

    return questions


def scrape_telegram(
    months_back: int = 5,
    max_messages_per_channel: int = 100,
    channels: Optional[List[str]] = None,
    discover: bool = True,
    max_channels: int = 2000,
    time_budget_seconds: Optional[float] = 1500,
) -> List[Dict[str, Any]]:
    """
    Scrape interview questions from Telegram channels.

    This is the main entry point for the scraper.

    Args:
        months_back: How many months of history to fetch (default: 5)
        max_messages_per_channel: Max messages per channel (default: 100)
        channels: Optional list of channel usernames. Uses defaults if not provided.

    Returns:
        List of InterviewQuestion dicts

    Example:
        >>> questions = scrape_telegram(months_back=3, max_messages_per_channel=50)
        >>> for q in questions:
        ...     print(f"{q['company']}: {q['question_text'][:50]}...")
    """
    if channels is None:
        channels = DEFAULT_CHANNELS

    # Check for credentials
    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        logger.warning(
            "Telegram credentials not configured. "
            "Set TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables. "
            "See https://my.telegram.org/apps to create an app."
        )
        # Return empty list but don't crash
        return []

    try:
        # Run async fetch
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    try:
        messages = loop.run_until_complete(
            fetch_telegram_messages(
                channels=channels,
                months_back=months_back,
                max_messages_per_channel=max_messages_per_channel,
                discover=discover,
                max_channels=max_channels,
                time_budget_seconds=time_budget_seconds,
            )
        )
    except Exception as e:
        logger.error(f"Error fetching Telegram messages: {e}")
        return []

    # Parse messages into questions
    questions = parse_telegram_messages(messages)

    logger.info(f"Extracted {len(questions)} interview questions from Telegram")

    # Convert to dicts for consistency with other scrapers
    return [q.to_dict() for q in questions]


# Alias for consistency with other scrapers
def fetch_telegram_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Alias for scrape_telegram() for consistency with other scrapers."""
    return scrape_telegram(months_back=months)


# Standalone test
if __name__ == "__main__":
    import json

    print("Telegram Interview Question Scraper")
    print("=" * 40)

    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        print("\nMissing credentials. To use this scraper:")
        print("1. Go to https://my.telegram.org/apps")
        print("2. Create an application")
        print("3. Set environment variables:")
        print("   export TELEGRAM_API_ID=<your_api_id>")
        print("   export TELEGRAM_API_HASH=<your_api_hash>")
        print("   export TELEGRAM_PHONE=<your_phone_number>")
        print("\nFor the first run, you'll receive an auth code via Telegram.")
        print("\nExample usage after setup:")
        print("   python telegram_monitor.py")
    else:
        print(f"\nCredentials found. Monitoring channels: {DEFAULT_CHANNELS[:5]}...")
        questions = scrape_telegram(months_back=1, max_messages_per_channel=20)

        if questions:
            print(f"\nFound {len(questions)} questions:")
            for i, q in enumerate(questions[:5], 1):
                print(f"\n{i}. [{q['company']}] {q['question_type']}")
                print(f"   {q['question_text'][:80]}...")

            # Save to file
            output_file = "telegram_questions.json"
            with open(output_file, "w") as f:
                json.dump(questions, f, indent=2, default=str)
            print(f"\nSaved {len(questions)} questions to {output_file}")
        else:
            print("\nNo questions found. Check channel access and permissions.")
