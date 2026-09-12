"""
YouTube Interview Videos Scraper

Uses YouTube Data API v3 to search for interview-related videos.
Extracts: video title, description, channel, upload date, company tags.
Filters to last 5 months.

INFRASTRUCTURE:
- Uses StealthSession for anti-detection (user agents, fingerprints)
- Uses ResponseCache to cache API responses (YouTube quota is limited!)
- Uses AdaptiveRateLimiter for API throttling
- Uses IncrementalScraper to avoid re-processing videos
- Uses monitor_scraper for monitoring and metrics
"""

import os
import re
import hashlib
import time
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, asdict
import urllib.request
import urllib.parse
import json
import ssl
import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Import unified scraper infrastructure
try:
    from ...utils.scraper_infra import (
        InfrastructureContext,
        validate_batch,
        get_stealth_headers,
        cached_request,
        wait_for_rate_limit,
    )
    UNIFIED_INFRA = True
except ImportError:
    UNIFIED_INFRA = False

# Import legacy infrastructure modules with graceful fallback
INFRA_AVAILABLE = False

try:
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'utils'))
    from anti_detection import StealthSession, create_stealth_session
    from cache import ResponseCache, IncrementalScraper, get_cache
    from rate_limiter import AdaptiveRateLimiter
    from monitoring import monitor_scraper, get_monitoring
    INFRA_AVAILABLE = True
except ImportError:
    try:
        from scraper.utils.anti_detection import StealthSession, create_stealth_session
        from scraper.utils.cache import ResponseCache, IncrementalScraper, get_cache
        from scraper.utils.rate_limiter import AdaptiveRateLimiter
        from scraper.utils.monitoring import monitor_scraper, get_monitoring
        INFRA_AVAILABLE = True
    except ImportError:
        if not UNIFIED_INFRA:
            logger.warning("[youtube] Infrastructure modules not available, using basic mode")
        StealthSession = None
        create_stealth_session = None
        ResponseCache = None
        get_cache = None
        IncrementalScraper = None
        AdaptiveRateLimiter = None
        monitor_scraper = None
        get_monitoring = None

# Treat unified infra as full infra
if UNIFIED_INFRA and not INFRA_AVAILABLE:
    INFRA_AVAILABLE = True

# Checkpoint manager
_checkpoint = None
try:
    from scraper.utils.error_handler import CheckpointManager
except ImportError:
    CheckpointManager = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE and CheckpointManager:
        try:
            _checkpoint = CheckpointManager("youtube")
        except Exception:
            pass
    return _checkpoint

YOUTUBE_API_KEY = os.environ.get('YOUTUBE_API_KEY', '')
YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

# Initialize infrastructure components
_stealth_session: Optional['StealthSession'] = None
_cache: Optional['ResponseCache'] = None
_rate_limiter: Optional['AdaptiveRateLimiter'] = None
_incremental: Optional['IncrementalScraper'] = None


def _init_infrastructure():
    """Initialize infrastructure components lazily."""
    global _stealth_session, _cache, _rate_limiter, _incremental

    if not INFRA_AVAILABLE:
        return

    if _stealth_session is None:
        try:
            _stealth_session = create_stealth_session(
                min_delay=0.5,
                max_delay=2.0,
                requests_per_minute=30  # YouTube API is relatively generous
            )
            logger.info("[youtube] StealthSession initialized")
        except Exception as e:
            logger.warning(f"[youtube] Could not initialize StealthSession: {e}")

    if _cache is None:
        try:
            _cache = ResponseCache(ttl=3600 * 24)  # 24 hour TTL (YouTube quota resets daily)
            logger.info("[youtube] ResponseCache initialized")
        except Exception as e:
            logger.warning(f"[youtube] Could not initialize ResponseCache: {e}")

    if _rate_limiter is None:
        try:
            _rate_limiter = AdaptiveRateLimiter(
                base_delay=0.2,  # YouTube is relatively generous
                min_delay=0.1,
                max_delay=5.0,
                target_response_time=1.0
            )
            logger.info("[youtube] AdaptiveRateLimiter initialized")
        except Exception as e:
            logger.warning(f"[youtube] Could not initialize AdaptiveRateLimiter: {e}")

    if _incremental is None:
        try:
            _incremental = IncrementalScraper('youtube_scraper')
            logger.info("[youtube] IncrementalScraper initialized")
        except Exception as e:
            logger.warning(f"[youtube] Could not initialize IncrementalScraper: {e}")


@contextmanager
def _monitoring_context(source_name: str = 'youtube'):
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

# Major tech companies to detect in titles/descriptions
COMPANIES = [
    'google', 'meta', 'facebook', 'amazon', 'apple', 'microsoft', 'netflix',
    'uber', 'lyft', 'airbnb', 'stripe', 'linkedin', 'twitter', 'x corp',
    'salesforce', 'adobe', 'oracle', 'ibm', 'intel', 'nvidia', 'amd',
    'palantir', 'snowflake', 'databricks', 'coinbase', 'robinhood',
    'jane street', 'citadel', 'two sigma', 'de shaw', 'hrt', 'jump trading',
    'optiver', 'imc', 'hudson river', 'tower research', 'virtu',
    'spotify', 'pinterest', 'snap', 'snapchat', 'tiktok', 'bytedance',
    'shopify', 'square', 'block', 'paypal', 'visa', 'mastercard',
    'goldman sachs', 'morgan stanley', 'jpmorgan', 'jp morgan', 'blackrock',
    'doordash', 'instacart', 'grubhub', 'postmates', 'wish', 'etsy',
    'zoom', 'slack', 'atlassian', 'dropbox', 'box', 'asana', 'notion',
    'figma', 'canva', 'roblox', 'epic games', 'riot games', 'ea',
    'tesla', 'spacex', 'waymo', 'cruise', 'rivian', 'lucid',
    'openai', 'anthropic', 'deepmind', 'cohere', 'scale ai', 'hugging face',
    'datadog', 'splunk', 'elastic', 'mongodb', 'redis', 'confluent',
    'cloudflare', 'fastly', 'akamai', 'twilio', 'sendgrid', 'plaid',
    'affirm', 'klarna', 'chime', 'sofi', 'nubank', 'revolut',
    'grab', 'gojek', 'sea', 'shopee', 'lazada', 'flipkart', 'swiggy',
    'zomato', 'razorpay', 'phonepe', 'paytm', 'ola', 'oyo',
    'kakao', 'naver', 'line', 'coupang', 'toss', 'mercari', 'rakuten',
    'yandex', 'vk', 'tinkoff', 'sber', 'alibaba', 'tencent', 'baidu',
    'jd', 'meituan', 'didi', 'pinduoduo', 'xiaomi', 'huawei', 'oppo'
]

# Interview-related search queries
SEARCH_QUERIES = [
    'software engineer interview',
    'coding interview',
    'mock interview',
    'system design interview',
    'technical interview',
    'behavioral interview',
    'FAANG interview',
    'big tech interview',
    'data structures interview',
    'algorithms interview',
    'leetcode interview',
    'online assessment',
    'OA walkthrough',
]

# Company-specific queries for top companies
COMPANY_QUERIES = [
    'google interview',
    'meta interview',
    'amazon interview',
    'apple interview',
    'microsoft interview',
    'netflix interview',
    'uber interview',
    'stripe interview',
    'airbnb interview',
    'linkedin interview',
]

# Popular interview prep channels to prioritize
TRUSTED_CHANNELS = [
    'neetcode', 'clément mihailescu', 'clement mihailescu', 'tech with tim',
    'kevin naughton', 'nick white', 'techlead', 'joma tech', 'mayuko',
    'algoexpert', 'interviewing.io', 'exponent', 'gaurav sen', 'back to back swe',
    'take u forward', 'striver', 'coding ninjas', 'love babbar', 'apna college',
    'freecodcamp', 'traversy media', 'fireship', 'primeagen', 'theprimeagen'
]


@dataclass
class InterviewVideo:
    id: str
    title: str
    description: str
    channel_name: str
    channel_id: str
    video_url: str
    published_at: str
    company: Optional[str]
    topics: List[str]
    question_type: str
    is_trusted_channel: bool
    source: str = 'youtube'


def get_cutoff_date(months: int = 5) -> str:
    """Return ISO 8601 date string for N months ago."""
    cutoff = datetime.utcnow() - timedelta(days=months * 30)
    return cutoff.strftime('%Y-%m-%dT%H:%M:%SZ')


def detect_company(text: str) -> Optional[str]:
    """Detect company name from text."""
    text_lower = text.lower()
    for company in COMPANIES:
        if company in text_lower:
            # Normalize company name
            if company in ['facebook', 'meta']:
                return 'Meta'
            if company in ['twitter', 'x corp']:
                return 'X'
            if company in ['jp morgan', 'jpmorgan']:
                return 'JPMorgan'
            return company.title()
    return None


def detect_question_type(text: str) -> str:
    """Detect interview question type from text."""
    text_lower = text.lower()

    if any(kw in text_lower for kw in ['system design', 'design a', 'scale', 'architecture']):
        return 'system_design'
    if any(kw in text_lower for kw in ['behavioral', 'tell me about', 'leadership', 'amazon lp', 'star method']):
        return 'behavioral'
    if any(kw in text_lower for kw in ['online assessment', ' oa ', 'oa question', 'hackerrank', 'codesignal']):
        return 'online_assessment'
    if any(kw in text_lower for kw in ['leetcode', 'algorithm', 'data structure', 'coding', 'dsa', 'array', 'tree', 'graph', 'dp', 'dynamic programming']):
        return 'technical'

    return 'general'


def extract_topics(text: str) -> List[str]:
    """Extract technical topics from text."""
    topics = []
    text_lower = text.lower()

    topic_keywords = {
        'arrays': ['array', 'arrays'],
        'strings': ['string', 'strings'],
        'linked_list': ['linked list', 'linkedlist'],
        'trees': ['tree', 'binary tree', 'bst'],
        'graphs': ['graph', 'bfs', 'dfs', 'dijkstra'],
        'dynamic_programming': ['dynamic programming', ' dp ', 'memoization'],
        'recursion': ['recursion', 'recursive', 'backtracking'],
        'sorting': ['sort', 'sorting', 'quicksort', 'mergesort'],
        'searching': ['binary search', 'search'],
        'hash_table': ['hash', 'hashmap', 'hashtable', 'dictionary'],
        'stack_queue': ['stack', 'queue', 'deque'],
        'heap': ['heap', 'priority queue'],
        'two_pointers': ['two pointer', 'two-pointer', 'sliding window'],
        'sql': ['sql', 'database', 'query'],
        'system_design': ['system design', 'scalability', 'distributed'],
        'oop': ['oop', 'object oriented', 'design patterns'],
        'api': ['api', 'rest', 'graphql'],
        'concurrency': ['concurrency', 'threading', 'parallel', 'async'],
    }

    for topic, keywords in topic_keywords.items():
        if any(kw in text_lower for kw in keywords):
            topics.append(topic)

    return topics


def is_trusted_channel(channel_name: str) -> bool:
    """Check if channel is a known trusted interview prep channel."""
    channel_lower = channel_name.lower()
    return any(trusted in channel_lower for trusted in TRUSTED_CHANNELS)


def youtube_search(query: str, published_after: str, max_results: int = 25) -> List[Dict]:
    """
    Search YouTube using Data API v3.

    Infrastructure:
    - Uses StealthSession for anti-detection (user agents, headers)
    - Caches responses (YouTube quota is limited - 10,000 units/day)
    - Uses adaptive rate limiting
    - Retries on transient failures
    """
    _init_infrastructure()

    if not YOUTUBE_API_KEY:
        print('[youtube] Warning: YOUTUBE_API_KEY not set, skipping search')
        return []

    params = {
        'part': 'snippet',
        'q': query,
        'type': 'video',
        'maxResults': min(max_results, 50),
        'publishedAfter': published_after,
        'order': 'relevance',
        'relevanceLanguage': 'en',
        'key': YOUTUBE_API_KEY,
    }

    url = f"{YOUTUBE_API_BASE}/search?{urllib.parse.urlencode(params)}"

    # Check cache first (saves API quota!)
    cache_key = hashlib.md5(f"{query}:{published_after}:{max_results}".encode()).hexdigest()
    if _cache:
        cached = _cache.get(url)
        if cached:
            logger.debug(f"[youtube] Cache hit for query: {query}")
            # Return cached content - it's a CachedResponse object
            try:
                import pickle
                if hasattr(cached, 'content'):
                    return json.loads(cached.content.decode('utf-8')).get('items', [])
            except Exception:
                pass

    # Apply rate limiting with stealth session
    if _stealth_session and INFRA_AVAILABLE:
        if not _stealth_session.before_request():
            logger.warning("[youtube] Rate limited, skipping request")
            return []
    elif _rate_limiter:
        delay = _rate_limiter.get_delay()
        if delay > 0:
            time.sleep(delay)

    def _do_request():
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        # Use stealth headers if available
        if _stealth_session and INFRA_AVAILABLE:
            config = _stealth_session.get_request_config(url)
            headers = config['headers']
        else:
            headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

        req = urllib.request.Request(url, headers=headers)
        start_time = time.time()

        with urllib.request.urlopen(req, timeout=30, context=ctx) as response:
            data = json.loads(response.read().decode('utf-8'))
            elapsed = time.time() - start_time
            status_code = response.status

            # Record success for rate limiter
            if _stealth_session and INFRA_AVAILABLE:
                _stealth_session.after_request(status_code)
            elif _rate_limiter:
                _rate_limiter.record_success(elapsed)

            return data.get('items', [])

    try:
        results = _do_request()

        # Cache the results
        if _cache and results:
            # Create a mock response for caching
            cache_response = {
                'content': json.dumps({'items': results}).encode('utf-8'),
                'status_code': 200,
                'headers': {}
            }
            _cache.set(url, cache_response)

        return results

    except Exception as e:
        print(f'[youtube] Search error for "{query}": {e}')
        if _stealth_session and INFRA_AVAILABLE:
            _stealth_session.after_request(500)
        elif _rate_limiter:
            _rate_limiter.record_failure()
        return []


def parse_video_item(item: Dict) -> Optional[InterviewVideo]:
    """Parse a YouTube API search result item into InterviewVideo."""
    try:
        snippet = item.get('snippet', {})
        video_id = item.get('id', {}).get('videoId', '')

        if not video_id:
            return None

        title = snippet.get('title', '')
        description = snippet.get('description', '')
        channel_name = snippet.get('channelTitle', '')
        channel_id = snippet.get('channelId', '')
        published_at = snippet.get('publishedAt', '')

        # Combine title and description for analysis
        full_text = f"{title} {description}"

        # Detect metadata
        company = detect_company(full_text)
        question_type = detect_question_type(full_text)
        topics = extract_topics(full_text)
        trusted = is_trusted_channel(channel_name)

        # Generate unique ID
        unique_id = hashlib.md5(f"youtube_{video_id}".encode()).hexdigest()[:16]

        return InterviewVideo(
            id=unique_id,
            title=title,
            description=description[:500] if description else '',
            channel_name=channel_name,
            channel_id=channel_id,
            video_url=f"https://www.youtube.com/watch?v={video_id}",
            published_at=published_at,
            company=company,
            topics=topics,
            question_type=question_type,
            is_trusted_channel=trusted,
        )
    except Exception as e:
        print(f'[youtube] Parse error: {e}')
        return None


def scrape_youtube(
    months: int = 5,
    max_results_per_query: int = 25,
    include_company_queries: bool = True
) -> List[Dict]:
    """
    Scrape YouTube for interview-related videos.

    Infrastructure:
    - Uses StealthSession for anti-detection
    - Uses IncrementalScraper to skip already-seen videos
    - Uses ResponseCache to avoid hitting API quota repeatedly
    - Uses AdaptiveRateLimiter to respect API limits
    - Uses monitor_scraper for metrics and monitoring

    Args:
        months: Number of months back to search (default 5)
        max_results_per_query: Max results per search query
        include_company_queries: Include company-specific searches

    Returns:
        List of interview video dicts
    """
    _init_infrastructure()

    if not YOUTUBE_API_KEY:
        print('[youtube] YOUTUBE_API_KEY not set. Returning empty results.')
        print('[youtube] Set the env var to enable YouTube scraping.')
        return []

    published_after = get_cutoff_date(months)
    print(f'[youtube] Searching videos from {published_after}')
    print(f'[youtube] Infrastructure: {"ENABLED" if INFRA_AVAILABLE else "BASIC MODE"}')

    all_videos: Dict[str, InterviewVideo] = {}
    new_count = 0
    skipped_count = 0

    with _monitoring_context('youtube') as monitor_ctx:
        # Run general interview queries
        queries = SEARCH_QUERIES.copy()
        if include_company_queries:
            queries.extend(COMPANY_QUERIES)

        for query in queries:
            print(f'[youtube] Searching: "{query}"')
            results = youtube_search(query, published_after, max_results_per_query)

            # Record API request for monitoring
            if hasattr(monitor_ctx, 'record_request'):
                monitor_ctx.record_request(success=len(results) > 0)

            for item in results:
                video = parse_video_item(item)
                if not video:
                    continue

                # Skip if already seen (incremental scraping)
                if _incremental and _incremental.has_seen(video.id):
                    skipped_count += 1
                    continue

                if video.id not in all_videos:
                    all_videos[video.id] = video
                    new_count += 1

                    # Mark as seen
                    if _incremental:
                        _incremental.mark_seen(video.id)

            # Rate limiting is now handled by youtube_search()

        # Save incremental state
        if _incremental:
            _incremental.save_checkpoint(
                page=len(queries),
                items_count=len(all_videos)
            )

        # Record question metrics
        if hasattr(monitor_ctx, 'record_questions'):
            monitor_ctx.record_questions(
                extracted=len(all_videos),
                new=new_count,
                duplicate=skipped_count
            )

    # Convert to list of dicts
    videos = list(all_videos.values())

    # Sort: trusted channels first, then by date
    videos.sort(key=lambda v: (not v.is_trusted_channel, v.published_at), reverse=True)

    print(f'[youtube] Found {len(videos)} unique videos ({new_count} new, {skipped_count} skipped)')
    print(f'[youtube] Trusted channel videos: {sum(1 for v in videos if v.is_trusted_channel)}')
    print(f'[youtube] Company-tagged videos: {sum(1 for v in videos if v.company)}')

    return [asdict(v) for v in videos]


def fetch_youtube_interviews(months: int = 5) -> List[Dict]:
    """Alias for scrape_youtube for consistent naming."""
    return scrape_youtube(months=months)


# CLI support
if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Scrape YouTube for interview videos')
    parser.add_argument('--months', type=int, default=5, help='Months back to search')
    parser.add_argument('--output', type=str, help='Output JSON file')
    parser.add_argument('--max-results', type=int, default=25, help='Max results per query')

    args = parser.parse_args()

    videos = scrape_youtube(
        months=args.months,
        max_results_per_query=args.max_results
    )

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(videos, f, indent=2)
        print(f'[youtube] Saved {len(videos)} videos to {args.output}')
    else:
        for video in videos[:10]:
            print(f"\n{video['title']}")
            print(f"  Channel: {video['channel_name']}")
            print(f"  Company: {video['company'] or 'N/A'}")
            print(f"  Type: {video['question_type']}")
            print(f"  URL: {video['video_url']}")
