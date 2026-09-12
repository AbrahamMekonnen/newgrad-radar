"""
Real-time monitoring infrastructure for ephemeral interview question sources.
Handles: Pastebin, Telegram, Discord, Reddit new, and other sources where content expires quickly.
"""

import asyncio
import hashlib
import json
import time
import threading
import queue
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Set
from urllib.parse import urljoin
import os

try:
    import aiohttp
    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False

try:
    import feedparser
    HAS_FEEDPARSER = True
except ImportError:
    HAS_FEEDPARSER = False

try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False


@dataclass
class MonitoredContent:
    """Represents content that was captured from an ephemeral source."""
    source: str
    url: str
    content: str
    content_hash: str
    captured_at: datetime
    expires_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'source': self.source,
            'url': self.url,
            'content': self.content,
            'content_hash': self.content_hash,
            'captured_at': self.captured_at.isoformat(),
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'metadata': self.metadata
        }


@dataclass
class SourceConfig:
    """Configuration for a monitored source."""
    name: str
    source_type: str  # 'rss', 'webhook', 'poll', 'websocket'
    url: str
    poll_interval_seconds: int = 60
    content_ttl_hours: Optional[int] = None
    auth_headers: Dict[str, str] = field(default_factory=dict)
    keywords: List[str] = field(default_factory=list)
    enabled: bool = True


class ContentArchiver:
    """Archives captured content to prevent data loss from ephemeral sources."""

    def __init__(self, archive_dir: str = None):
        self.archive_dir = archive_dir or os.path.join(
            os.path.dirname(__file__), '..', 'archive'
        )
        self.seen_hashes: Set[str] = set()
        self._load_seen_hashes()

    def _load_seen_hashes(self):
        """Load previously seen content hashes to avoid duplicates."""
        hash_file = os.path.join(self.archive_dir, '.seen_hashes')
        if os.path.exists(hash_file):
            with open(hash_file, 'r') as f:
                self.seen_hashes = set(line.strip() for line in f)

    def _save_seen_hash(self, content_hash: str):
        """Persist a new content hash."""
        os.makedirs(self.archive_dir, exist_ok=True)
        hash_file = os.path.join(self.archive_dir, '.seen_hashes')
        with open(hash_file, 'a') as f:
            f.write(f"{content_hash}\n")
        self.seen_hashes.add(content_hash)

    def is_duplicate(self, content: str) -> bool:
        """Check if content has been seen before."""
        content_hash = hashlib.sha256(content.encode()).hexdigest()
        return content_hash in self.seen_hashes

    def archive(self, content: MonitoredContent) -> bool:
        """Archive content immediately. Returns True if new content was archived."""
        if content.content_hash in self.seen_hashes:
            return False

        os.makedirs(self.archive_dir, exist_ok=True)

        date_str = content.captured_at.strftime('%Y-%m-%d')
        source_dir = os.path.join(self.archive_dir, content.source, date_str)
        os.makedirs(source_dir, exist_ok=True)

        filename = f"{content.content_hash[:16]}_{int(content.captured_at.timestamp())}.json"
        filepath = os.path.join(source_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(content.to_dict(), f, ensure_ascii=False, indent=2)

        self._save_seen_hash(content.content_hash)
        return True


class InstantArchiver(ContentArchiver):
    """
    Enhanced archiver that captures content immediately and queues for processing.
    Uses background thread to avoid blocking the main scraping loop.
    """

    def __init__(self, archive_dir: str = None, callback: Callable[[MonitoredContent], None] = None):
        super().__init__(archive_dir)
        self.callback = callback
        self.queue: queue.Queue = queue.Queue()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Start the background archiver thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._process_queue, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop the background archiver thread."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _process_queue(self):
        """Background thread that processes queued content."""
        while self._running:
            try:
                content = self.queue.get(timeout=1)
                if self.archive(content):
                    if self.callback:
                        self.callback(content)
            except queue.Empty:
                continue
            except Exception as e:
                print(f"[InstantArchiver] Error processing: {e}")

    def capture(self, source: str, url: str, content: str,
                expires_in_hours: Optional[int] = None,
                metadata: Dict[str, Any] = None) -> Optional[MonitoredContent]:
        """
        Capture content immediately and queue for archival.
        Returns MonitoredContent if new, None if duplicate.
        """
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        if content_hash in self.seen_hashes:
            return None

        captured = MonitoredContent(
            source=source,
            url=url,
            content=content,
            content_hash=content_hash,
            captured_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=expires_in_hours) if expires_in_hours else None,
            metadata=metadata or {}
        )

        self.queue.put(captured)
        return captured


class ChangeDetector:
    """Monitors URLs for changes and triggers callbacks when content changes."""

    def __init__(self, check_interval: int = 60):
        self.check_interval = check_interval
        self.tracked_urls: Dict[str, str] = {}  # url -> last_hash
        self.callbacks: Dict[str, List[Callable]] = {}
        self._running = False

    def track(self, url: str, callback: Callable[[str, str], None]):
        """Add a URL to track. Callback receives (url, new_content) on change."""
        if url not in self.callbacks:
            self.callbacks[url] = []
        self.callbacks[url].append(callback)

    def _compute_hash(self, content: str) -> str:
        return hashlib.sha256(content.encode()).hexdigest()

    async def _check_url(self, session: 'aiohttp.ClientSession', url: str) -> Optional[str]:
        """Check a URL and return new content if changed."""
        if not HAS_AIOHTTP:
            return None
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 200:
                    content = await resp.text()
                    content_hash = self._compute_hash(content)

                    if url not in self.tracked_urls:
                        self.tracked_urls[url] = content_hash
                        return content  # First time seeing this URL

                    if self.tracked_urls[url] != content_hash:
                        self.tracked_urls[url] = content_hash
                        return content  # Content changed
        except Exception as e:
            print(f"[ChangeDetector] Error checking {url}: {e}")
        return None

    async def check_all(self) -> List[tuple]:
        """Check all tracked URLs for changes. Returns list of (url, new_content)."""
        if not HAS_AIOHTTP:
            print("[ChangeDetector] aiohttp not installed")
            return []

        changes = []
        async with aiohttp.ClientSession() as session:
            for url in self.callbacks.keys():
                new_content = await self._check_url(session, url)
                if new_content:
                    changes.append((url, new_content))
                    for callback in self.callbacks[url]:
                        try:
                            callback(url, new_content)
                        except Exception as e:
                            print(f"[ChangeDetector] Callback error for {url}: {e}")
        return changes

    async def run_forever(self):
        """Continuously monitor tracked URLs."""
        self._running = True
        while self._running:
            await self.check_all()
            await asyncio.sleep(self.check_interval)

    def stop(self):
        self._running = False


class RSSPoller:
    """
    Enhanced RSS feed poller with change detection and instant archiving.
    Monitors interview-related RSS feeds for new content.
    """

    # Known interview-related RSS feeds
    DEFAULT_FEEDS = {
        'reddit_csmajors': 'https://www.reddit.com/r/csMajors/new.rss',
        'reddit_cscareerquestions': 'https://www.reddit.com/r/cscareerquestions/new.rss',
        'reddit_leetcode': 'https://www.reddit.com/r/leetcode/new.rss',
        'hn_interviews': 'https://hnrss.org/newest?q=interview',
        'medium_interview': 'https://medium.com/feed/tag/interview',
        'medium_coding_interview': 'https://medium.com/feed/tag/coding-interview',
        'devto_interview': 'https://dev.to/feed/tag/interview',
    }

    INTERVIEW_KEYWORDS = [
        'interview', 'oa', 'online assessment', 'coding round', 'technical screen',
        'phone screen', 'onsite', 'system design', 'behavioral', 'offer',
        'leetcode', 'hackerrank', 'codesignal', 'rejection', 'accepted',
        'google', 'meta', 'amazon', 'apple', 'microsoft', 'faang', 'startup'
    ]

    def __init__(self, archiver: InstantArchiver = None, poll_interval: int = 300):
        self.feeds: Dict[str, str] = dict(self.DEFAULT_FEEDS)
        self.archiver = archiver or InstantArchiver()
        self.poll_interval = poll_interval
        self.seen_ids: Set[str] = set()
        self._running = False

    def add_feed(self, name: str, url: str):
        """Add a custom RSS feed to monitor."""
        self.feeds[name] = url

    def _is_interview_related(self, title: str, content: str) -> bool:
        """Check if content is interview-related based on keywords."""
        text = f"{title} {content}".lower()
        return any(kw in text for kw in self.INTERVIEW_KEYWORDS)

    def _get_entry_id(self, entry: Dict) -> str:
        """Get a unique identifier for an RSS entry."""
        return entry.get('id') or entry.get('link') or hashlib.md5(
            entry.get('title', '').encode()
        ).hexdigest()

    async def poll_feed(self, name: str, url: str) -> List[MonitoredContent]:
        """Poll a single RSS feed for new interview-related content."""
        if not HAS_FEEDPARSER:
            return []

        captured = []
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                entry_id = self._get_entry_id(entry)

                if entry_id in self.seen_ids:
                    continue

                self.seen_ids.add(entry_id)

                title = entry.get('title', '')
                content = entry.get('summary', '') or entry.get('description', '')
                link = entry.get('link', '')

                if not self._is_interview_related(title, content):
                    continue

                full_content = f"# {title}\n\n{content}\n\nSource: {link}"

                result = self.archiver.capture(
                    source=f"rss_{name}",
                    url=link,
                    content=full_content,
                    expires_in_hours=168,  # RSS content typically lasts a week
                    metadata={
                        'title': title,
                        'feed_name': name,
                        'published': entry.get('published', ''),
                    }
                )

                if result:
                    captured.append(result)

        except Exception as e:
            print(f"[RSSPoller] Error polling {name}: {e}")

        return captured

    async def poll_all(self) -> List[MonitoredContent]:
        """Poll all registered feeds."""
        all_captured = []
        for name, url in self.feeds.items():
            captured = await self.poll_feed(name, url)
            all_captured.extend(captured)
        return all_captured

    async def run_forever(self):
        """Continuously poll all feeds."""
        self._running = True
        self.archiver.start()

        while self._running:
            captured = await self.poll_all()
            if captured:
                print(f"[RSSPoller] Captured {len(captured)} new items")
            await asyncio.sleep(self.poll_interval)

    def stop(self):
        self._running = False
        self.archiver.stop()


class WebhookListener:
    """
    HTTP webhook server for receiving push notifications from sources.
    Supports: Discord webhooks, custom POST endpoints, GitHub webhooks.
    """

    def __init__(self, host: str = '0.0.0.0', port: int = 8765,
                 archiver: InstantArchiver = None,
                 secret_token: str = None):
        self.host = host
        self.port = port
        self.archiver = archiver or InstantArchiver()
        self.secret_token = secret_token or os.environ.get('WEBHOOK_SECRET', '')
        self.handlers: Dict[str, Callable] = {}
        self._server = None

    def register_handler(self, path: str, handler: Callable[[Dict], Optional[MonitoredContent]]):
        """Register a handler for a webhook path."""
        self.handlers[path] = handler

    def _verify_signature(self, payload: bytes, signature: str) -> bool:
        """Verify webhook signature (for GitHub-style webhooks)."""
        if not self.secret_token:
            return True
        expected = hashlib.sha256(
            f"{self.secret_token}{payload.decode()}".encode()
        ).hexdigest()
        return signature == f"sha256={expected}"

    async def _handle_webhook(self, request) -> 'aiohttp.web.Response':
        """Handle incoming webhook request."""
        if not HAS_AIOHTTP:
            return None

        from aiohttp import web

        path = request.path

        if path not in self.handlers:
            return web.Response(status=404, text="Not found")

        try:
            payload = await request.read()
            signature = request.headers.get('X-Hub-Signature-256', '')

            if self.secret_token and not self._verify_signature(payload, signature):
                return web.Response(status=401, text="Invalid signature")

            data = json.loads(payload)
            handler = self.handlers[path]
            result = handler(data)

            if result and self.archiver:
                self.archiver.queue.put(result)

            return web.Response(status=200, text="OK")

        except json.JSONDecodeError:
            return web.Response(status=400, text="Invalid JSON")
        except Exception as e:
            print(f"[WebhookListener] Error: {e}")
            return web.Response(status=500, text="Internal error")

    async def start(self):
        """Start the webhook server."""
        if not HAS_AIOHTTP:
            print("[WebhookListener] aiohttp not installed")
            return

        from aiohttp import web

        app = web.Application()
        app.router.add_post('/{path:.*}', self._handle_webhook)

        runner = web.AppRunner(app)
        await runner.setup()

        self._server = web.TCPSite(runner, self.host, self.port)
        await self._server.start()
        print(f"[WebhookListener] Server started on {self.host}:{self.port}")

        self.archiver.start()

    async def stop(self):
        """Stop the webhook server."""
        if self._server:
            await self._server.stop()
        self.archiver.stop()


class WebSocketMonitor:
    """
    WebSocket client for real-time monitoring of streaming sources.
    Supports: Discord Gateway (read-only), custom WebSocket feeds.
    """

    def __init__(self, archiver: InstantArchiver = None):
        self.archiver = archiver or InstantArchiver()
        self.connections: Dict[str, str] = {}  # name -> ws_url
        self.message_handlers: Dict[str, Callable] = {}
        self._running = False

    def add_connection(self, name: str, ws_url: str,
                       handler: Callable[[Dict], Optional[MonitoredContent]]):
        """Add a WebSocket connection to monitor."""
        self.connections[name] = ws_url
        self.message_handlers[name] = handler

    async def _monitor_connection(self, name: str, ws_url: str):
        """Monitor a single WebSocket connection."""
        if not HAS_WEBSOCKETS:
            print(f"[WebSocketMonitor] websockets not installed")
            return

        handler = self.message_handlers.get(name)
        if not handler:
            return

        while self._running:
            try:
                async with websockets.connect(ws_url) as ws:
                    print(f"[WebSocketMonitor] Connected to {name}")
                    async for message in ws:
                        try:
                            data = json.loads(message)
                            result = handler(data)
                            if result and self.archiver:
                                self.archiver.queue.put(result)
                        except json.JSONDecodeError:
                            pass
                        except Exception as e:
                            print(f"[WebSocketMonitor] Handler error: {e}")
            except Exception as e:
                print(f"[WebSocketMonitor] Connection error for {name}: {e}")
                await asyncio.sleep(5)  # Reconnect delay

    async def run_forever(self):
        """Run all WebSocket monitors."""
        self._running = True
        self.archiver.start()

        tasks = [
            self._monitor_connection(name, url)
            for name, url in self.connections.items()
        ]

        await asyncio.gather(*tasks)

    def stop(self):
        self._running = False
        self.archiver.stop()


class PastebinMonitor:
    """
    Specialized monitor for Pastebin-like services.
    Captures ephemeral content before it expires.
    """

    SERVICES = {
        'pastebin': {
            'recent_url': 'https://pastebin.com/api_scraping.php?limit=100',
            'raw_url': 'https://pastebin.com/raw/{key}',
            'api_key_env': 'PASTEBIN_API_KEY',
        },
        'gist': {
            'api_url': 'https://api.github.com/gists/public',
            'raw_url': 'https://gist.githubusercontent.com/{user}/{id}/raw',
        },
        'rentry': {
            'base_url': 'https://rentry.co',
        }
    }

    INTERVIEW_PATTERNS = [
        'interview', 'oa', 'online assessment', 'leetcode', 'hackerrank',
        'coding test', 'technical interview', 'system design', 'faang',
        'google', 'meta', 'amazon', 'apple', 'microsoft', 'offer', 'rejected'
    ]

    def __init__(self, archiver: InstantArchiver = None, poll_interval: int = 120):
        self.archiver = archiver or InstantArchiver()
        self.poll_interval = poll_interval
        self.seen_keys: Set[str] = set()
        self._running = False

    def _is_interview_related(self, content: str) -> bool:
        """Check if paste content is interview-related."""
        content_lower = content.lower()
        return any(pattern in content_lower for pattern in self.INTERVIEW_PATTERNS)

    async def _poll_pastebin(self, session: 'aiohttp.ClientSession') -> List[MonitoredContent]:
        """Poll Pastebin for new interview-related pastes."""
        captured = []
        api_key = os.environ.get('PASTEBIN_API_KEY')

        if not api_key:
            return captured

        try:
            url = f"{self.SERVICES['pastebin']['recent_url']}&api_dev_key={api_key}"
            async with session.get(url) as resp:
                if resp.status == 200:
                    pastes = await resp.json()
                    for paste in pastes:
                        key = paste.get('key')
                        if not key or key in self.seen_keys:
                            continue

                        self.seen_keys.add(key)

                        raw_url = self.SERVICES['pastebin']['raw_url'].format(key=key)
                        async with session.get(raw_url) as raw_resp:
                            if raw_resp.status == 200:
                                content = await raw_resp.text()

                                if self._is_interview_related(content):
                                    result = self.archiver.capture(
                                        source='pastebin',
                                        url=f"https://pastebin.com/{key}",
                                        content=content,
                                        expires_in_hours=paste.get('expire', 24),
                                        metadata={
                                            'title': paste.get('title', ''),
                                            'syntax': paste.get('syntax', ''),
                                        }
                                    )
                                    if result:
                                        captured.append(result)
        except Exception as e:
            print(f"[PastebinMonitor] Error: {e}")

        return captured

    async def _poll_gists(self, session: 'aiohttp.ClientSession') -> List[MonitoredContent]:
        """Poll GitHub Gists for interview-related content."""
        captured = []

        try:
            headers = {}
            github_token = os.environ.get('GITHUB_TOKEN')
            if github_token:
                headers['Authorization'] = f'token {github_token}'

            async with session.get(
                self.SERVICES['gist']['api_url'],
                headers=headers,
                params={'per_page': 100}
            ) as resp:
                if resp.status == 200:
                    gists = await resp.json()
                    for gist in gists:
                        gist_id = gist.get('id')
                        if not gist_id or gist_id in self.seen_keys:
                            continue

                        self.seen_keys.add(gist_id)

                        description = gist.get('description', '')
                        files = gist.get('files', {})

                        file_contents = []
                        for filename, file_info in files.items():
                            if file_info.get('size', 0) < 100000:  # Skip large files
                                raw_url = file_info.get('raw_url')
                                if raw_url:
                                    async with session.get(raw_url) as file_resp:
                                        if file_resp.status == 200:
                                            file_contents.append(await file_resp.text())

                        full_content = f"{description}\n\n" + "\n---\n".join(file_contents)

                        if self._is_interview_related(full_content):
                            result = self.archiver.capture(
                                source='github_gist',
                                url=gist.get('html_url'),
                                content=full_content,
                                expires_in_hours=None,  # Gists don't expire
                                metadata={
                                    'description': description,
                                    'owner': gist.get('owner', {}).get('login', 'anonymous'),
                                    'files': list(files.keys()),
                                }
                            )
                            if result:
                                captured.append(result)
        except Exception as e:
            print(f"[PastebinMonitor] Gist error: {e}")

        return captured

    async def poll_all(self) -> List[MonitoredContent]:
        """Poll all paste services."""
        if not HAS_AIOHTTP:
            return []

        all_captured = []
        async with aiohttp.ClientSession() as session:
            pastebin_results = await self._poll_pastebin(session)
            all_captured.extend(pastebin_results)

            gist_results = await self._poll_gists(session)
            all_captured.extend(gist_results)

        return all_captured

    async def run_forever(self):
        """Continuously poll paste services."""
        self._running = True
        self.archiver.start()

        while self._running:
            captured = await self.poll_all()
            if captured:
                print(f"[PastebinMonitor] Captured {len(captured)} new pastes")
            await asyncio.sleep(self.poll_interval)

    def stop(self):
        self._running = False
        self.archiver.stop()


class RedditStreamMonitor:
    """
    Real-time Reddit monitoring using the Reddit API stream endpoint.
    Captures new posts from interview-related subreddits immediately.
    """

    TARGET_SUBREDDITS = [
        'csMajors', 'cscareerquestions', 'leetcode', 'SWE', 'FAANG',
        'datascience', 'MachineLearning', 'ExperiencedDevs', 'jobs'
    ]

    def __init__(self, archiver: InstantArchiver = None,
                 client_id: str = None, client_secret: str = None):
        self.archiver = archiver or InstantArchiver()
        self.client_id = client_id or os.environ.get('REDDIT_CLIENT_ID')
        self.client_secret = client_secret or os.environ.get('REDDIT_CLIENT_SECRET')
        self.seen_ids: Set[str] = set()
        self._running = False
        self._access_token: Optional[str] = None
        self._token_expires: float = 0

    async def _get_access_token(self, session: 'aiohttp.ClientSession') -> Optional[str]:
        """Get Reddit OAuth access token."""
        if not self.client_id or not self.client_secret:
            return None

        if self._access_token and time.time() < self._token_expires:
            return self._access_token

        try:
            auth = aiohttp.BasicAuth(self.client_id, self.client_secret)
            async with session.post(
                'https://www.reddit.com/api/v1/access_token',
                auth=auth,
                data={'grant_type': 'client_credentials'},
                headers={'User-Agent': 'NewGradRadar/1.0'}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self._access_token = data.get('access_token')
                    self._token_expires = time.time() + data.get('expires_in', 3600) - 60
                    return self._access_token
        except Exception as e:
            print(f"[RedditStream] Token error: {e}")

        return None

    async def poll_subreddit(self, session: 'aiohttp.ClientSession',
                            subreddit: str) -> List[MonitoredContent]:
        """Poll a subreddit for new posts."""
        captured = []

        headers = {'User-Agent': 'NewGradRadar/1.0'}
        token = await self._get_access_token(session)

        if token:
            headers['Authorization'] = f'Bearer {token}'
            base_url = 'https://oauth.reddit.com'
        else:
            base_url = 'https://www.reddit.com'

        try:
            url = f"{base_url}/r/{subreddit}/new.json?limit=25"
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    posts = data.get('data', {}).get('children', [])

                    for post in posts:
                        post_data = post.get('data', {})
                        post_id = post_data.get('id')

                        if not post_id or post_id in self.seen_ids:
                            continue

                        self.seen_ids.add(post_id)

                        title = post_data.get('title', '')
                        selftext = post_data.get('selftext', '')
                        url = f"https://reddit.com{post_data.get('permalink', '')}"

                        content = f"# {title}\n\n{selftext}"

                        result = self.archiver.capture(
                            source=f'reddit_{subreddit}',
                            url=url,
                            content=content,
                            expires_in_hours=None,
                            metadata={
                                'title': title,
                                'subreddit': subreddit,
                                'author': post_data.get('author', '[deleted]'),
                                'score': post_data.get('score', 0),
                                'created_utc': post_data.get('created_utc'),
                            }
                        )

                        if result:
                            captured.append(result)
        except Exception as e:
            print(f"[RedditStream] Error for r/{subreddit}: {e}")

        return captured

    async def poll_all(self) -> List[MonitoredContent]:
        """Poll all target subreddits."""
        if not HAS_AIOHTTP:
            return []

        all_captured = []
        async with aiohttp.ClientSession() as session:
            for subreddit in self.TARGET_SUBREDDITS:
                captured = await self.poll_subreddit(session, subreddit)
                all_captured.extend(captured)
                await asyncio.sleep(1)  # Rate limiting

        return all_captured

    async def run_forever(self, poll_interval: int = 60):
        """Continuously poll subreddits."""
        self._running = True
        self.archiver.start()

        while self._running:
            captured = await self.poll_all()
            if captured:
                print(f"[RedditStream] Captured {len(captured)} new posts")
            await asyncio.sleep(poll_interval)

    def stop(self):
        self._running = False
        self.archiver.stop()


class RealtimeOrchestrator:
    """
    Orchestrates all real-time monitors and provides a unified interface.
    """

    def __init__(self, archive_dir: str = None):
        self.archiver = InstantArchiver(archive_dir)

        self.rss_poller = RSSPoller(self.archiver)
        self.change_detector = ChangeDetector()
        self.pastebin_monitor = PastebinMonitor(self.archiver)
        self.reddit_monitor = RedditStreamMonitor(self.archiver)
        self.webhook_listener = WebhookListener(archiver=self.archiver)
        self.websocket_monitor = WebSocketMonitor(self.archiver)

        self._running = False

    def add_rss_feed(self, name: str, url: str):
        """Add an RSS feed to monitor."""
        self.rss_poller.add_feed(name, url)

    def track_url(self, url: str, callback: Callable):
        """Track a URL for changes."""
        self.change_detector.track(url, callback)

    def register_webhook(self, path: str, handler: Callable):
        """Register a webhook handler."""
        self.webhook_listener.register_handler(path, handler)

    def add_websocket(self, name: str, url: str, handler: Callable):
        """Add a WebSocket connection to monitor."""
        self.websocket_monitor.add_connection(name, url, handler)

    async def run_all(self):
        """Run all monitors concurrently."""
        self._running = True
        self.archiver.start()

        tasks = [
            self.rss_poller.run_forever(),
            self.change_detector.run_forever(),
            self.pastebin_monitor.run_forever(),
            self.reddit_monitor.run_forever(),
        ]

        # Optionally start webhook server
        # await self.webhook_listener.start()

        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            pass
        finally:
            self.stop()

    def stop(self):
        """Stop all monitors."""
        self._running = False
        self.rss_poller.stop()
        self.change_detector.stop()
        self.pastebin_monitor.stop()
        self.reddit_monitor.stop()
        self.websocket_monitor.stop()
        self.archiver.stop()


# Convenience function to start all monitors
async def start_realtime_monitoring(archive_dir: str = None):
    """Start the complete real-time monitoring system."""
    orchestrator = RealtimeOrchestrator(archive_dir)

    print("[Realtime] Starting all monitors...")
    print(f"  - RSS Poller: {len(orchestrator.rss_poller.feeds)} feeds")
    print(f"  - Reddit: {len(orchestrator.reddit_monitor.TARGET_SUBREDDITS)} subreddits")
    print(f"  - Pastebin: Monitoring for interview content")

    await orchestrator.run_all()


if __name__ == '__main__':
    asyncio.run(start_realtime_monitoring())
