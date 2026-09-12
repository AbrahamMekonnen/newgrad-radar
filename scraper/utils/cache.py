"""
Intelligent Caching Layer for Interview Question Scrapers

Features:
- HTTP response caching with configurable TTL
- Content-based cache invalidation (hash comparison)
- Incremental scraping (only fetch new content)
- Cache warming strategies
- File-based caching (Redis-optional)
- LZ4/gzip compression for large responses
- Cache sharing across scraper instances via locks
"""

import os
import json
import time
import hashlib
import gzip
import pickle
import threading
import sqlite3
from pathlib import Path
from typing import Optional, Any, Dict, List, Callable, TypeVar, Generic
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from contextlib import contextmanager
from abc import ABC, abstractmethod
import logging

try:
    import lz4.frame as lz4
    HAS_LZ4 = True
except ImportError:
    HAS_LZ4 = False

try:
    import redis
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

logger = logging.getLogger(__name__)

T = TypeVar('T')

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

CACHE_DIR = Path(os.environ.get('SCRAPER_CACHE_DIR',
    Path(__file__).parent.parent / '.cache'))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_TTL_SECONDS = 3600 * 6  # 6 hours
COMPRESSION_THRESHOLD = 1024  # Compress responses > 1KB


# -----------------------------------------------------------------------------
# Cache Backend Abstraction
# -----------------------------------------------------------------------------

class CacheBackend(ABC):
    """Abstract base for cache backends (file, Redis, SQLite)"""

    @abstractmethod
    def get(self, key: str) -> Optional[bytes]:
        pass

    @abstractmethod
    def set(self, key: str, value: bytes, ttl: Optional[int] = None) -> bool:
        pass

    @abstractmethod
    def delete(self, key: str) -> bool:
        pass

    @abstractmethod
    def exists(self, key: str) -> bool:
        pass

    @abstractmethod
    def clear(self) -> int:
        pass

    @abstractmethod
    def keys(self, pattern: str = "*") -> List[str]:
        pass


class FileBackend(CacheBackend):
    """File-based cache with directory sharding for performance"""

    def __init__(self, base_dir: Path = CACHE_DIR, shard_count: int = 256):
        self.base_dir = base_dir
        self.shard_count = shard_count
        self._locks: Dict[str, threading.Lock] = {}
        self._global_lock = threading.Lock()

    def _get_shard_dir(self, key: str) -> Path:
        shard = int(hashlib.md5(key.encode()).hexdigest()[:2], 16) % self.shard_count
        shard_dir = self.base_dir / f"shard_{shard:03d}"
        shard_dir.mkdir(parents=True, exist_ok=True)
        return shard_dir

    def _get_path(self, key: str) -> Path:
        safe_key = hashlib.sha256(key.encode()).hexdigest()
        return self._get_shard_dir(key) / f"{safe_key}.cache"

    def _get_meta_path(self, key: str) -> Path:
        return self._get_path(key).with_suffix('.meta')

    def _get_lock(self, key: str) -> threading.Lock:
        with self._global_lock:
            if key not in self._locks:
                self._locks[key] = threading.Lock()
            return self._locks[key]

    def get(self, key: str) -> Optional[bytes]:
        path = self._get_path(key)
        meta_path = self._get_meta_path(key)

        if not path.exists():
            return None

        # Check TTL
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
                if meta.get('expires_at') and time.time() > meta['expires_at']:
                    self.delete(key)
                    return None
            except (json.JSONDecodeError, OSError):
                pass

        try:
            with self._get_lock(key):
                return path.read_bytes()
        except OSError:
            return None

    def set(self, key: str, value: bytes, ttl: Optional[int] = None) -> bool:
        path = self._get_path(key)
        meta_path = self._get_meta_path(key)

        try:
            with self._get_lock(key):
                path.write_bytes(value)

                meta = {
                    'created_at': time.time(),
                    'size': len(value),
                }
                if ttl:
                    meta['expires_at'] = time.time() + ttl

                meta_path.write_text(json.dumps(meta))
            return True
        except OSError as e:
            logger.error(f"Cache write error for {key}: {e}")
            return False

    def delete(self, key: str) -> bool:
        path = self._get_path(key)
        meta_path = self._get_meta_path(key)

        deleted = False
        with self._get_lock(key):
            if path.exists():
                path.unlink()
                deleted = True
            if meta_path.exists():
                meta_path.unlink()
        return deleted

    def exists(self, key: str) -> bool:
        return self._get_path(key).exists()

    def clear(self) -> int:
        count = 0
        for shard_dir in self.base_dir.glob("shard_*"):
            for cache_file in shard_dir.glob("*.cache"):
                cache_file.unlink()
                meta_file = cache_file.with_suffix('.meta')
                if meta_file.exists():
                    meta_file.unlink()
                count += 1
        return count

    def keys(self, pattern: str = "*") -> List[str]:
        # File backend doesn't store original keys, return cache file hashes
        result = []
        for shard_dir in self.base_dir.glob("shard_*"):
            for cache_file in shard_dir.glob("*.cache"):
                result.append(cache_file.stem)
        return result


class SQLiteBackend(CacheBackend):
    """SQLite-based cache for better performance and querying"""

    def __init__(self, db_path: Path = CACHE_DIR / "cache.db"):
        self.db_path = db_path
        self._init_db()
        self._local = threading.local()

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, 'conn'):
            self._local.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        return self._local.conn

    def _init_db(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL,
                content_hash TEXT,
                source TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_expires ON cache(expires_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_source ON cache(source)")
        conn.commit()
        conn.close()

    def get(self, key: str) -> Optional[bytes]:
        conn = self._get_conn()
        cursor = conn.execute(
            "SELECT value, expires_at FROM cache WHERE key = ?", (key,)
        )
        row = cursor.fetchone()

        if not row:
            return None

        value, expires_at = row
        if expires_at and time.time() > expires_at:
            self.delete(key)
            return None

        return value

    def set(self, key: str, value: bytes, ttl: Optional[int] = None,
            content_hash: str = None, source: str = None) -> bool:
        conn = self._get_conn()
        expires_at = time.time() + ttl if ttl else None

        conn.execute("""
            INSERT OR REPLACE INTO cache (key, value, created_at, expires_at, content_hash, source)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (key, value, time.time(), expires_at, content_hash, source))
        conn.commit()
        return True

    def delete(self, key: str) -> bool:
        conn = self._get_conn()
        cursor = conn.execute("DELETE FROM cache WHERE key = ?", (key,))
        conn.commit()
        return cursor.rowcount > 0

    def exists(self, key: str) -> bool:
        return self.get(key) is not None

    def clear(self) -> int:
        conn = self._get_conn()
        cursor = conn.execute("DELETE FROM cache")
        conn.commit()
        return cursor.rowcount

    def keys(self, pattern: str = "*") -> List[str]:
        conn = self._get_conn()
        if pattern == "*":
            cursor = conn.execute("SELECT key FROM cache")
        else:
            cursor = conn.execute(
                "SELECT key FROM cache WHERE key LIKE ?",
                (pattern.replace("*", "%"),)
            )
        return [row[0] for row in cursor.fetchall()]

    def cleanup_expired(self) -> int:
        """Remove expired entries"""
        conn = self._get_conn()
        cursor = conn.execute(
            "DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at < ?",
            (time.time(),)
        )
        conn.commit()
        return cursor.rowcount


class RedisBackend(CacheBackend):
    """Redis-based cache for distributed scraping"""

    def __init__(self, host: str = 'localhost', port: int = 6379,
                 db: int = 0, prefix: str = 'scraper:'):
        if not HAS_REDIS:
            raise ImportError("redis package required: pip install redis")

        self.client = redis.Redis(host=host, port=port, db=db)
        self.prefix = prefix

    def _key(self, key: str) -> str:
        return f"{self.prefix}{key}"

    def get(self, key: str) -> Optional[bytes]:
        return self.client.get(self._key(key))

    def set(self, key: str, value: bytes, ttl: Optional[int] = None) -> bool:
        if ttl:
            return self.client.setex(self._key(key), ttl, value)
        return self.client.set(self._key(key), value)

    def delete(self, key: str) -> bool:
        return self.client.delete(self._key(key)) > 0

    def exists(self, key: str) -> bool:
        return self.client.exists(self._key(key)) > 0

    def clear(self) -> int:
        keys = self.client.keys(f"{self.prefix}*")
        if keys:
            return self.client.delete(*keys)
        return 0

    def keys(self, pattern: str = "*") -> List[str]:
        full_pattern = f"{self.prefix}{pattern}"
        keys = self.client.keys(full_pattern)
        prefix_len = len(self.prefix)
        return [k.decode()[prefix_len:] for k in keys]


# -----------------------------------------------------------------------------
# ResponseCache - Main HTTP Response Caching
# -----------------------------------------------------------------------------

@dataclass
class CachedResponse:
    """Cached HTTP response with metadata"""
    content: bytes
    status_code: int
    headers: Dict[str, str]
    url: str
    fetched_at: float
    content_hash: str
    compressed: bool = False
    compression_type: str = None  # 'gzip' or 'lz4'


class ResponseCache:
    """
    HTTP Response cache with intelligent TTL and compression.

    Usage:
        cache = ResponseCache(ttl=3600)

        # Try cache first
        cached = cache.get(url)
        if cached:
            return cached.content

        # Fetch and cache
        response = requests.get(url)
        cache.set(url, response)
        return response.content
    """

    def __init__(self,
                 backend: CacheBackend = None,
                 ttl: int = DEFAULT_TTL_SECONDS,
                 compress: bool = True,
                 compression_threshold: int = COMPRESSION_THRESHOLD):
        self.backend = backend or SQLiteBackend()
        self.default_ttl = ttl
        self.compress = compress
        self.compression_threshold = compression_threshold

    def _make_key(self, url: str, params: Dict = None) -> str:
        key_parts = [url]
        if params:
            key_parts.append(json.dumps(params, sort_keys=True))
        return hashlib.sha256(":".join(key_parts).encode()).hexdigest()

    def _compress(self, data: bytes) -> tuple[bytes, str]:
        """Compress data, preferring LZ4 for speed"""
        if HAS_LZ4:
            return lz4.compress(data), 'lz4'
        return gzip.compress(data), 'gzip'

    def _decompress(self, data: bytes, compression_type: str) -> bytes:
        if compression_type == 'lz4':
            return lz4.decompress(data)
        return gzip.decompress(data)

    def get(self, url: str, params: Dict = None) -> Optional[CachedResponse]:
        """Get cached response if available and not expired"""
        key = self._make_key(url, params)
        data = self.backend.get(key)

        if not data:
            return None

        try:
            cached: CachedResponse = pickle.loads(data)

            # Decompress if needed
            if cached.compressed and cached.compression_type:
                cached.content = self._decompress(cached.content, cached.compression_type)
                cached.compressed = False

            return cached
        except (pickle.PickleError, Exception) as e:
            logger.warning(f"Cache deserialize error for {url}: {e}")
            self.backend.delete(key)
            return None

    def set(self, url: str, response: Any, params: Dict = None,
            ttl: int = None) -> bool:
        """
        Cache an HTTP response.

        Args:
            url: Request URL
            response: requests.Response or dict with 'content', 'status_code', 'headers'
            params: Request parameters
            ttl: Time-to-live in seconds (default: self.default_ttl)
        """
        key = self._make_key(url, params)

        # Handle both requests.Response and dict
        if hasattr(response, 'content'):
            content = response.content
            status_code = response.status_code
            headers = dict(response.headers)
        else:
            content = response.get('content', b'')
            status_code = response.get('status_code', 200)
            headers = response.get('headers', {})

        # Content may be raw bytes (requests.Response) or already-parsed
        # structured data (e.g. a JSON dict from a source adapter). Hash a
        # bytes view of it, and only byte-compress raw bytes/str payloads.
        if isinstance(content, (bytes, bytearray)):
            content_bytes = bytes(content)
        elif isinstance(content, str):
            content_bytes = content.encode('utf-8')
        else:
            content_bytes = repr(content).encode('utf-8')

        content_hash = hashlib.sha256(content_bytes).hexdigest()
        compressed = False
        compression_type = None

        # Compress large responses (only for raw byte/str payloads)
        if (self.compress
                and isinstance(content, (bytes, bytearray, str))
                and len(content_bytes) > self.compression_threshold):
            content, compression_type = self._compress(content_bytes)
            compressed = True

        cached = CachedResponse(
            content=content,
            status_code=status_code,
            headers=headers,
            url=url,
            fetched_at=time.time(),
            content_hash=content_hash,
            compressed=compressed,
            compression_type=compression_type
        )

        data = pickle.dumps(cached)
        return self.backend.set(key, data, ttl or self.default_ttl)

    def invalidate(self, url: str, params: Dict = None) -> bool:
        """Invalidate a cached response"""
        key = self._make_key(url, params)
        return self.backend.delete(key)

    def invalidate_pattern(self, url_pattern: str) -> int:
        """Invalidate all URLs matching a pattern"""
        count = 0
        for key in self.backend.keys("*"):
            if url_pattern in key:
                self.backend.delete(key)
                count += 1
        return count


# -----------------------------------------------------------------------------
# ContentHashCache - Detect Content Changes
# -----------------------------------------------------------------------------

class ContentHashCache:
    """
    Track content hashes to detect changes and avoid re-processing unchanged content.

    Usage:
        hash_cache = ContentHashCache()

        for url in urls:
            content = fetch(url)
            if hash_cache.has_changed(url, content):
                process(content)
                hash_cache.update(url, content)
            else:
                logger.info(f"Skipping unchanged: {url}")
    """

    def __init__(self, backend: CacheBackend = None):
        self.backend = backend or SQLiteBackend(CACHE_DIR / "content_hashes.db")

    def _compute_hash(self, content: bytes | str) -> str:
        if isinstance(content, str):
            content = content.encode()
        return hashlib.sha256(content).hexdigest()

    def get_hash(self, key: str) -> Optional[str]:
        """Get stored hash for a key"""
        data = self.backend.get(f"hash:{key}")
        if data:
            return data.decode()
        return None

    def update(self, key: str, content: bytes | str) -> str:
        """Store hash for content, return the hash"""
        content_hash = self._compute_hash(content)
        self.backend.set(f"hash:{key}", content_hash.encode())
        return content_hash

    def has_changed(self, key: str, content: bytes | str) -> bool:
        """Check if content has changed since last seen"""
        stored_hash = self.get_hash(key)
        current_hash = self._compute_hash(content)
        return stored_hash != current_hash

    def delete(self, key: str) -> bool:
        return self.backend.delete(f"hash:{key}")


# -----------------------------------------------------------------------------
# IncrementalScraper - Fetch Only New Content
# -----------------------------------------------------------------------------

@dataclass
class ScraperState:
    """State for incremental scraping"""
    last_run: float = 0
    last_page: int = 0
    last_item_id: str = ""
    total_items: int = 0
    checkpoints: Dict[str, Any] = field(default_factory=dict)


class IncrementalScraper:
    """
    Manages incremental scraping state to avoid re-fetching old content.

    Usage:
        incremental = IncrementalScraper('reddit_interviews')

        # Resume from last checkpoint
        state = incremental.load_state()
        start_page = state.last_page

        for page in range(start_page, max_pages):
            items = scrape_page(page)

            for item in items:
                # Skip if we've seen this before
                if incremental.has_seen(item['id']):
                    continue

                process(item)
                incremental.mark_seen(item['id'])

            # Save checkpoint after each page
            incremental.save_checkpoint(page=page, items_count=len(items))
    """

    def __init__(self, source_name: str, backend: CacheBackend = None):
        self.source_name = source_name
        self.backend = backend or SQLiteBackend(CACHE_DIR / "incremental.db")
        self._seen_ids: set = set()
        self._load_seen_ids()

    def _state_key(self) -> str:
        return f"state:{self.source_name}"

    def _seen_key(self) -> str:
        return f"seen:{self.source_name}"

    def _load_seen_ids(self):
        """Load previously seen item IDs"""
        data = self.backend.get(self._seen_key())
        if data:
            try:
                self._seen_ids = set(json.loads(data.decode()))
            except json.JSONDecodeError:
                self._seen_ids = set()

    def _save_seen_ids(self):
        """Persist seen IDs"""
        # Limit size to prevent unbounded growth
        if len(self._seen_ids) > 100000:
            # Keep only the most recent 50k (assuming IDs are sortable)
            self._seen_ids = set(sorted(self._seen_ids)[-50000:])

        data = json.dumps(list(self._seen_ids)).encode()
        self.backend.set(self._seen_key(), data)

    def load_state(self) -> ScraperState:
        """Load scraper state from cache"""
        data = self.backend.get(self._state_key())
        if data:
            try:
                state_dict = json.loads(data.decode())
                return ScraperState(**state_dict)
            except (json.JSONDecodeError, TypeError):
                pass
        return ScraperState()

    def save_state(self, state: ScraperState):
        """Save scraper state"""
        data = json.dumps({
            'last_run': state.last_run,
            'last_page': state.last_page,
            'last_item_id': state.last_item_id,
            'total_items': state.total_items,
            'checkpoints': state.checkpoints
        }).encode()
        self.backend.set(self._state_key(), data)

    def save_checkpoint(self, **kwargs):
        """Save a checkpoint with current progress"""
        state = self.load_state()
        state.last_run = time.time()
        state.checkpoints.update(kwargs)

        if 'page' in kwargs:
            state.last_page = kwargs['page']
        if 'item_id' in kwargs:
            state.last_item_id = kwargs['item_id']

        self.save_state(state)
        self._save_seen_ids()

    def has_seen(self, item_id: str) -> bool:
        """Check if we've processed this item before"""
        return item_id in self._seen_ids

    def mark_seen(self, item_id: str):
        """Mark an item as processed"""
        self._seen_ids.add(item_id)

    def clear_seen(self):
        """Clear all seen items (for full re-scrape)"""
        self._seen_ids.clear()
        self.backend.delete(self._seen_key())

    def get_new_items(self, items: List[Dict], id_field: str = 'id') -> List[Dict]:
        """Filter a list to only new items"""
        return [item for item in items if not self.has_seen(str(item.get(id_field, '')))]


# -----------------------------------------------------------------------------
# CacheWarmer - Preload Cache
# -----------------------------------------------------------------------------

class CacheWarmer:
    """
    Warm cache by pre-fetching commonly accessed resources.

    Usage:
        warmer = CacheWarmer(response_cache)

        # Define URLs to warm
        urls = [
            'https://api.example.com/interviews?company=google',
            'https://api.example.com/interviews?company=meta',
        ]

        # Warm cache (runs in background threads)
        warmer.warm(urls, fetch_fn=requests.get)

        # Or use scheduled warming
        warmer.schedule_warming(urls, interval=3600)  # Every hour
    """

    def __init__(self, cache: ResponseCache, max_workers: int = 4):
        self.cache = cache
        self.max_workers = max_workers
        self._warming_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def warm(self, urls: List[str], fetch_fn: Callable[[str], Any],
             force: bool = False) -> Dict[str, bool]:
        """
        Warm cache for given URLs.

        Args:
            urls: URLs to cache
            fetch_fn: Function to fetch URL (e.g., requests.get)
            force: If True, refresh even if cached

        Returns:
            Dict mapping URL to success status
        """
        from concurrent.futures import ThreadPoolExecutor

        results = {}

        def warm_url(url: str) -> tuple[str, bool]:
            try:
                # Skip if already cached and not forcing
                if not force and self.cache.get(url):
                    return url, True

                response = fetch_fn(url)
                self.cache.set(url, response)
                return url, True
            except Exception as e:
                logger.error(f"Failed to warm {url}: {e}")
                return url, False

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            for url, success in executor.map(warm_url, urls):
                results[url] = success

        return results

    def schedule_warming(self, urls: List[str], fetch_fn: Callable[[str], Any],
                         interval: int = 3600):
        """
        Schedule periodic cache warming.

        Args:
            urls: URLs to warm
            fetch_fn: Function to fetch URL
            interval: Seconds between warming cycles
        """
        self._stop_event.clear()

        def warming_loop():
            while not self._stop_event.is_set():
                logger.info(f"Warming cache for {len(urls)} URLs")
                self.warm(urls, fetch_fn, force=True)
                self._stop_event.wait(interval)

        self._warming_thread = threading.Thread(target=warming_loop, daemon=True)
        self._warming_thread.start()

    def stop_warming(self):
        """Stop scheduled warming"""
        self._stop_event.set()
        if self._warming_thread:
            self._warming_thread.join(timeout=5)


# -----------------------------------------------------------------------------
# Convenience Functions
# -----------------------------------------------------------------------------

_default_cache: Optional[ResponseCache] = None
_default_hash_cache: Optional[ContentHashCache] = None


def get_cache() -> ResponseCache:
    """Get the default response cache instance"""
    global _default_cache
    if _default_cache is None:
        _default_cache = ResponseCache()
    return _default_cache


def get_hash_cache() -> ContentHashCache:
    """Get the default content hash cache instance"""
    global _default_hash_cache
    if _default_hash_cache is None:
        _default_hash_cache = ContentHashCache()
    return _default_hash_cache


def cached_request(url: str, fetch_fn: Callable[[], Any],
                   ttl: int = DEFAULT_TTL_SECONDS,
                   params: Dict = None) -> Any:
    """
    Fetch with caching - convenience wrapper.

    Usage:
        response = cached_request(
            'https://api.example.com/data',
            lambda: requests.get('https://api.example.com/data'),
            ttl=3600
        )
    """
    cache = get_cache()

    # Try cache first
    cached = cache.get(url, params)
    if cached:
        logger.debug(f"Cache hit: {url}")
        return cached

    # Fetch and cache
    logger.debug(f"Cache miss: {url}")
    response = fetch_fn()
    cache.set(url, response, params, ttl)

    return response


# -----------------------------------------------------------------------------
# CLI for cache management
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Cache management CLI")
    parser.add_argument('command', choices=['stats', 'clear', 'cleanup'])
    parser.add_argument('--backend', choices=['file', 'sqlite'], default='sqlite')

    args = parser.parse_args()

    if args.backend == 'sqlite':
        backend = SQLiteBackend()
    else:
        backend = FileBackend()

    if args.command == 'stats':
        keys = backend.keys()
        print(f"Cache entries: {len(keys)}")
        print(f"Cache directory: {CACHE_DIR}")

    elif args.command == 'clear':
        count = backend.clear()
        print(f"Cleared {count} cache entries")

    elif args.command == 'cleanup':
        if isinstance(backend, SQLiteBackend):
            count = backend.cleanup_expired()
            print(f"Removed {count} expired entries")
        else:
            print("Cleanup only supported for SQLite backend")
