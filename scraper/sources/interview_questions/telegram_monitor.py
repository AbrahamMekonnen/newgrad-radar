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


def detect_company(text: str) -> Optional[str]:
    """Detect company name from text."""
    text_lower = text.lower()
    for company in KNOWN_COMPANIES:
        # Handle multi-word companies
        if company in text_lower:
            return company.title()
        # Handle variations
        if company.replace(" ", "") in text_lower.replace(" ", ""):
            return company.title()
    return None


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
        if q_normalized not in seen and len(q) > 15:
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


async def fetch_telegram_messages(
    channels: List[str],
    months_back: int = 5,
    max_messages_per_channel: int = 100,
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

    async with TelegramClient(
        TELEGRAM_SESSION_FILE,
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

        for channel_name in channels:
            try:
                logger.info(f"Fetching from @{channel_name}")

                # Apply rate limiting before API call
                if _rate_limiter:
                    delay = _rate_limiter.get_delay()
                    if delay > 0:
                        await asyncio.sleep(delay)

                start_time = asyncio.get_event_loop().time()
                channel = await client.get_entity(channel_name)

                if not isinstance(channel, Channel):
                    logger.warning(f"@{channel_name} is not a channel, skipping")
                    if _rate_limiter:
                        _rate_limiter.record_success(0.1)
                    continue

                count = 0
                skipped = 0

                async for message in client.iter_messages(
                    channel,
                    limit=max_messages_per_channel,
                ):
                    if not isinstance(message, Message):
                        continue

                    # Skip old messages
                    if message.date.replace(tzinfo=None) < cutoff_date:
                        break

                    # Skip non-text messages
                    if not message.text:
                        continue

                    # Skip very short messages
                    if len(message.text) < 30:
                        continue

                    # Create unique message ID
                    msg_key = f"{channel_name}:{message.id}"

                    # Skip if already processed (incremental scraping)
                    if _incremental and _incremental.has_seen(msg_key):
                        skipped += 1
                        continue

                    msg_data = {
                        "text": message.text,
                        "date": message.date.isoformat(),
                        "channel": channel_name,
                        "channel_title": getattr(channel, "title", channel_name),
                        "message_id": message.id,
                        "views": getattr(message, "views", 0) or 0,
                        "forwards": getattr(message, "forwards", 0) or 0,
                    }

                    # Archive immediately (ephemeral content!)
                    if _archiver:
                        _archiver.archive({
                            'source': f'telegram:{channel_name}',
                            'content': message.text,
                            'metadata': msg_data
                        })

                    messages.append(msg_data)

                    # Mark as seen for incremental scraping
                    if _incremental:
                        _incremental.mark_seen(msg_key)

                    count += 1

                # Record rate limiter metrics
                elapsed = asyncio.get_event_loop().time() - start_time
                if _rate_limiter:
                    _rate_limiter.record_success(elapsed)

                logger.info(f"Fetched {count} new messages from @{channel_name} (skipped {skipped} seen)")

            except Exception as e:
                logger.error(f"Error fetching @{channel_name}: {e}")
                if _rate_limiter:
                    _rate_limiter.record_failure()
                continue

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
            # but only if it looks like interview content
            if any(kw in text.lower() for kw in ["interview", "oa", "asked", "question", "problem"]):
                extracted = [text[:500]]  # Truncate long messages

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
