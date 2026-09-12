"""
Scraper Queue System - Coordinated Multi-Scraper Architecture

Provides:
- ScrapeQueue: Priority queue with persistence (file/Redis)
- WorkerPool: Distributed work coordination
- URLDeduplicator: Prevent duplicate URL processing with bloom filters
- Scheduler: Scheduled + on-demand scraping
- ResultAggregator: Collect, dedupe, and batch results

Works locally (file-based) and scales to Redis.
"""

import asyncio
import hashlib
import heapq
import json
import logging
import os
import pickle
import threading
import time
from abc import ABC, abstractmethod
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union
import uuid

logger = logging.getLogger('scraper.queue')


# ============================================================================
# PRIORITY LEVELS & TASK STATES
# ============================================================================

class Priority(Enum):
    """Task priority levels - lower number = higher priority."""
    CRITICAL = 1      # Real-time user submissions
    HIGH = 2          # High-value sources (1Point3Acres OA, deleted Reddit)
    NORMAL = 3        # Standard scrapers
    LOW = 4           # Bulk/background scrapers
    BACKGROUND = 5    # Low-value, high-volume sources


class TaskState(Enum):
    """Lifecycle states for scrape tasks."""
    PENDING = 'pending'
    QUEUED = 'queued'
    RUNNING = 'running'
    COMPLETED = 'completed'
    FAILED = 'failed'
    RETRYING = 'retrying'
    DEAD_LETTER = 'dead_letter'  # Failed after max retries


@dataclass(order=True)
class ScrapeTask:
    """A single scrape task with priority ordering."""
    priority: int
    created_at: float = field(compare=True)
    task_id: str = field(compare=False, default_factory=lambda: str(uuid.uuid4()))
    source_name: str = field(compare=False, default='')
    url: str = field(compare=False, default='')
    scraper_type: str = field(compare=False, default='python')
    module_path: str = field(compare=False, default='')
    function_name: str = field(compare=False, default='')
    params: Dict = field(compare=False, default_factory=dict)
    state: TaskState = field(compare=False, default=TaskState.PENDING)
    retries: int = field(compare=False, default=0)
    max_retries: int = field(compare=False, default=3)
    rate_limit_key: str = field(compare=False, default='default')
    timeout: int = field(compare=False, default=300)
    result: Any = field(compare=False, default=None)
    error: str = field(compare=False, default='')
    started_at: Optional[float] = field(compare=False, default=None)
    completed_at: Optional[float] = field(compare=False, default=None)

    def to_dict(self) -> Dict:
        return {
            **asdict(self),
            'state': self.state.value,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'ScrapeTask':
        data = data.copy()
        data['state'] = TaskState(data.get('state', 'pending'))
        return cls(**data)


# ============================================================================
# STORAGE BACKENDS (File & Redis)
# ============================================================================

class StorageBackend(ABC):
    """Abstract storage backend for queue persistence."""

    @abstractmethod
    def save_queue(self, queue_name: str, tasks: List[ScrapeTask]) -> None:
        pass

    @abstractmethod
    def load_queue(self, queue_name: str) -> List[ScrapeTask]:
        pass

    @abstractmethod
    def save_set(self, set_name: str, items: Set[str]) -> None:
        pass

    @abstractmethod
    def load_set(self, set_name: str) -> Set[str]:
        pass

    @abstractmethod
    def get(self, key: str) -> Optional[str]:
        pass

    @abstractmethod
    def set(self, key: str, value: str, ttl: Optional[int] = None) -> None:
        pass

    @abstractmethod
    def incr(self, key: str) -> int:
        pass


class FileStorageBackend(StorageBackend):
    """File-based storage for local development."""

    def __init__(self, base_dir: str = '.scraper_queue'):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._locks: Dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._counters: Dict[str, int] = {}

    def _get_path(self, name: str, ext: str = 'json') -> Path:
        return self.base_dir / f"{name}.{ext}"

    def save_queue(self, queue_name: str, tasks: List[ScrapeTask]) -> None:
        with self._locks[queue_name]:
            path = self._get_path(f"queue_{queue_name}")
            data = [t.to_dict() for t in tasks]
            path.write_text(json.dumps(data, indent=2, default=str))

    def load_queue(self, queue_name: str) -> List[ScrapeTask]:
        path = self._get_path(f"queue_{queue_name}")
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text())
            return [ScrapeTask.from_dict(t) for t in data]
        except Exception as e:
            logger.error(f"Failed to load queue {queue_name}: {e}")
            return []

    def save_set(self, set_name: str, items: Set[str]) -> None:
        with self._locks[set_name]:
            path = self._get_path(f"set_{set_name}")
            path.write_text(json.dumps(list(items)))

    def load_set(self, set_name: str) -> Set[str]:
        path = self._get_path(f"set_{set_name}")
        if not path.exists():
            return set()
        try:
            return set(json.loads(path.read_text()))
        except:
            return set()

    def get(self, key: str) -> Optional[str]:
        path = self._get_path(f"kv_{key}", 'txt')
        if path.exists():
            return path.read_text()
        return None

    def set(self, key: str, value: str, ttl: Optional[int] = None) -> None:
        path = self._get_path(f"kv_{key}", 'txt')
        path.write_text(value)
        # TTL not implemented for file backend (would need cleanup job)

    def incr(self, key: str) -> int:
        with self._locks[key]:
            current = self._counters.get(key, 0)
            self._counters[key] = current + 1
            return self._counters[key]


class RedisStorageBackend(StorageBackend):
    """Redis-based storage for production scaling."""

    def __init__(self, redis_url: str = None):
        try:
            import redis
            self.redis_url = redis_url or os.getenv('REDIS_URL', 'redis://localhost:6379/0')
            self.client = redis.from_url(self.redis_url)
            self.client.ping()
            logger.info(f"Connected to Redis: {self.redis_url}")
        except Exception as e:
            logger.warning(f"Redis not available, falling back to file storage: {e}")
            raise

    def save_queue(self, queue_name: str, tasks: List[ScrapeTask]) -> None:
        key = f"scraper:queue:{queue_name}"
        self.client.delete(key)
        if tasks:
            pipeline = self.client.pipeline()
            for task in tasks:
                pipeline.rpush(key, json.dumps(task.to_dict(), default=str))
            pipeline.execute()

    def load_queue(self, queue_name: str) -> List[ScrapeTask]:
        key = f"scraper:queue:{queue_name}"
        items = self.client.lrange(key, 0, -1)
        return [ScrapeTask.from_dict(json.loads(item)) for item in items]

    def save_set(self, set_name: str, items: Set[str]) -> None:
        key = f"scraper:set:{set_name}"
        self.client.delete(key)
        if items:
            self.client.sadd(key, *items)

    def load_set(self, set_name: str) -> Set[str]:
        key = f"scraper:set:{set_name}"
        return set(s.decode() if isinstance(s, bytes) else s
                   for s in self.client.smembers(key))

    def get(self, key: str) -> Optional[str]:
        value = self.client.get(f"scraper:kv:{key}")
        return value.decode() if value else None

    def set(self, key: str, value: str, ttl: Optional[int] = None) -> None:
        full_key = f"scraper:kv:{key}"
        if ttl:
            self.client.setex(full_key, ttl, value)
        else:
            self.client.set(full_key, value)

    def incr(self, key: str) -> int:
        return self.client.incr(f"scraper:counter:{key}")


def get_storage_backend() -> StorageBackend:
    """Get the appropriate storage backend based on environment."""
    redis_url = os.getenv('REDIS_URL')
    if redis_url:
        try:
            return RedisStorageBackend(redis_url)
        except:
            pass
    return FileStorageBackend()


# ============================================================================
# URL DEDUPLICATOR (Bloom Filter + Exact Match)
# ============================================================================

class URLDeduplicator:
    """
    Prevents duplicate URL processing using a two-tier approach:
    1. Bloom filter for fast probabilistic check (memory efficient)
    2. Exact URL hash set for confirmed duplicates

    Persists state to avoid reprocessing across restarts.
    """

    def __init__(self, storage: StorageBackend, capacity: int = 1_000_000,
                 error_rate: float = 0.01):
        self.storage = storage
        self.capacity = capacity
        self.error_rate = error_rate

        # Simple hash-based bloom filter simulation
        # For production, use pybloom_live or similar
        import math
        # k = (m/n) * ln(2), where m = bit array size, n = capacity
        self._bit_array_size = int(capacity * 10)
        self._num_hashes = max(1, int((self._bit_array_size / capacity) * math.log(2)))
        self._bit_array: Set[int] = set()

        # Exact match set for confirmed URLs
        self._exact_urls: Set[str] = set()

        # Load persisted state
        self._load_state()

    def _hash_url(self, url: str, seed: int) -> int:
        """Generate a hash for the bloom filter."""
        h = hashlib.md5(f"{seed}:{url}".encode()).hexdigest()
        return int(h[:8], 16) % self._bit_array_size

    def _normalize_url(self, url: str) -> str:
        """Normalize URL for deduplication."""
        # Remove trailing slashes, fragments, common tracking params
        url = url.lower().rstrip('/')
        # Remove common tracking parameters
        for param in ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source']:
            if f'{param}=' in url:
                parts = url.split('?')
                if len(parts) > 1:
                    base = parts[0]
                    params = '&'.join(p for p in parts[1].split('&')
                                     if not p.startswith(f'{param}='))
                    url = f"{base}?{params}" if params else base
        return url

    def _url_hash(self, url: str) -> str:
        """Generate a stable hash for exact matching."""
        return hashlib.sha256(self._normalize_url(url).encode()).hexdigest()[:16]

    def is_duplicate(self, url: str) -> bool:
        """Check if URL has been seen before."""
        normalized = self._normalize_url(url)
        url_hash = self._url_hash(normalized)

        # Check exact match first
        if url_hash in self._exact_urls:
            return True

        # Check bloom filter
        for seed in range(self._num_hashes):
            if self._hash_url(normalized, seed) not in self._bit_array:
                return False

        # Bloom filter says probably seen - add to exact set
        self._exact_urls.add(url_hash)
        return True

    def mark_seen(self, url: str) -> None:
        """Mark a URL as processed."""
        normalized = self._normalize_url(url)
        url_hash = self._url_hash(normalized)

        # Add to bloom filter
        for seed in range(self._num_hashes):
            self._bit_array.add(self._hash_url(normalized, seed))

        # Add to exact set
        self._exact_urls.add(url_hash)

    def mark_batch(self, urls: List[str]) -> None:
        """Mark multiple URLs as processed."""
        for url in urls:
            self.mark_seen(url)
        self._save_state()

    def _load_state(self) -> None:
        """Load persisted state from storage."""
        self._exact_urls = self.storage.load_set('url_dedup_exact')
        bloom_data = self.storage.load_set('url_dedup_bloom')
        self._bit_array = {int(x) for x in bloom_data if x.isdigit()}

    def _save_state(self) -> None:
        """Persist state to storage."""
        self.storage.save_set('url_dedup_exact', self._exact_urls)
        self.storage.save_set('url_dedup_bloom', {str(x) for x in self._bit_array})

    def clear(self) -> None:
        """Clear all deduplication state."""
        self._bit_array.clear()
        self._exact_urls.clear()
        self._save_state()

    @property
    def stats(self) -> Dict:
        return {
            'exact_urls_count': len(self._exact_urls),
            'bloom_bits_set': len(self._bit_array),
            'bloom_fill_ratio': len(self._bit_array) / self._bit_array_size,
        }


# ============================================================================
# RATE LIMITER (Per-Domain/Source Coordination)
# ============================================================================

class RateLimiter:
    """
    Coordinates rate limits across workers for different sources.
    Uses token bucket algorithm with per-source configuration.
    """

    DEFAULT_RATE = 1.0  # requests per second
    DEFAULT_BURST = 5   # max burst

    def __init__(self, storage: StorageBackend):
        self.storage = storage
        self._locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._last_request: Dict[str, float] = {}
        self._tokens: Dict[str, float] = {}

        # Rate limits per source (requests per second)
        self._rate_limits = {
            'default': (1.0, 5),           # 1 req/s, burst 5
            'github': (0.5, 3),             # GitHub API limits
            'reddit': (0.5, 2),             # Reddit API
            'leetcode': (0.2, 2),           # LeetCode GraphQL
            '1point3acres': (0.3, 2),       # 1Point3Acres
            'glassdoor': (0.2, 1),          # Glassdoor (aggressive blocking)
            'nowcoder': (0.5, 3),           # Nowcoder
            'telegram': (1.0, 10),          # Telegram API
            'twitter': (0.3, 2),            # Twitter/X API
            'youtube': (1.0, 5),            # YouTube Data API
        }

    def configure_rate(self, source: str, rate: float, burst: int) -> None:
        """Configure rate limit for a source."""
        self._rate_limits[source] = (rate, burst)

    async def acquire(self, source: str = 'default') -> None:
        """Acquire permission to make a request (blocks if needed)."""
        rate, burst = self._rate_limits.get(source, (self.DEFAULT_RATE, self.DEFAULT_BURST))

        async with self._locks[source]:
            now = time.time()
            last = self._last_request.get(source, 0)
            tokens = self._tokens.get(source, burst)

            # Refill tokens based on time elapsed
            elapsed = now - last
            tokens = min(burst, tokens + elapsed * rate)

            if tokens < 1:
                # Need to wait
                wait_time = (1 - tokens) / rate
                logger.debug(f"Rate limiting {source}: waiting {wait_time:.2f}s")
                await asyncio.sleep(wait_time)
                tokens = 1

            # Consume one token
            self._tokens[source] = tokens - 1
            self._last_request[source] = time.time()

    def get_wait_time(self, source: str = 'default') -> float:
        """Get estimated wait time for a source."""
        rate, burst = self._rate_limits.get(source, (self.DEFAULT_RATE, self.DEFAULT_BURST))
        now = time.time()
        last = self._last_request.get(source, 0)
        tokens = self._tokens.get(source, burst)

        elapsed = now - last
        tokens = min(burst, tokens + elapsed * rate)

        if tokens >= 1:
            return 0
        return (1 - tokens) / rate


# ============================================================================
# SCRAPE QUEUE (Priority Queue with Persistence)
# ============================================================================

class ScrapeQueue:
    """
    Priority queue for scrape tasks with persistence and work stealing.

    Features:
    - Multi-priority task scheduling
    - Persistence across restarts
    - Work stealing for load balancing
    - Dead letter queue for failed tasks
    """

    def __init__(self, storage: StorageBackend, queue_name: str = 'main'):
        self.storage = storage
        self.queue_name = queue_name
        self._heap: List[ScrapeTask] = []
        self._task_map: Dict[str, ScrapeTask] = {}
        self._lock = asyncio.Lock()
        self._dead_letter: List[ScrapeTask] = []

        # Load persisted state
        self._load_state()

    def _load_state(self) -> None:
        """Load queue state from storage."""
        tasks = self.storage.load_queue(self.queue_name)
        for task in tasks:
            if task.state in (TaskState.PENDING, TaskState.QUEUED, TaskState.RETRYING):
                heapq.heappush(self._heap, task)
                self._task_map[task.task_id] = task

        # Load dead letter queue
        dead_tasks = self.storage.load_queue(f"{self.queue_name}_dead")
        self._dead_letter = dead_tasks

    def _save_state(self) -> None:
        """Persist queue state to storage."""
        all_tasks = list(self._heap) + [t for t in self._task_map.values()
                                         if t.state == TaskState.RUNNING]
        self.storage.save_queue(self.queue_name, all_tasks)
        self.storage.save_queue(f"{self.queue_name}_dead", self._dead_letter)

    async def enqueue(self, task: ScrapeTask) -> str:
        """Add a task to the queue."""
        async with self._lock:
            task.state = TaskState.QUEUED
            heapq.heappush(self._heap, task)
            self._task_map[task.task_id] = task
            self._save_state()
            logger.debug(f"Enqueued task {task.task_id} for {task.source_name}")
            return task.task_id

    async def enqueue_batch(self, tasks: List[ScrapeTask]) -> List[str]:
        """Add multiple tasks to the queue."""
        async with self._lock:
            task_ids = []
            for task in tasks:
                task.state = TaskState.QUEUED
                heapq.heappush(self._heap, task)
                self._task_map[task.task_id] = task
                task_ids.append(task.task_id)
            self._save_state()
            return task_ids

    async def dequeue(self) -> Optional[ScrapeTask]:
        """Get the next task from the queue."""
        async with self._lock:
            while self._heap:
                task = heapq.heappop(self._heap)
                if task.state == TaskState.QUEUED:
                    task.state = TaskState.RUNNING
                    task.started_at = time.time()
                    self._save_state()
                    return task
            return None

    async def complete(self, task_id: str, result: Any = None) -> None:
        """Mark a task as completed."""
        async with self._lock:
            if task_id in self._task_map:
                task = self._task_map[task_id]
                task.state = TaskState.COMPLETED
                task.result = result
                task.completed_at = time.time()
                self._save_state()

    async def fail(self, task_id: str, error: str) -> None:
        """Mark a task as failed, potentially requeueing for retry."""
        async with self._lock:
            if task_id not in self._task_map:
                return

            task = self._task_map[task_id]
            task.error = error
            task.retries += 1

            if task.retries < task.max_retries:
                # Requeue with backoff
                task.state = TaskState.RETRYING
                task.priority += 1  # Lower priority on retry
                task.created_at = time.time() + (2 ** task.retries)  # Exponential backoff
                heapq.heappush(self._heap, task)
                logger.warning(f"Task {task_id} failed, retry {task.retries}/{task.max_retries}")
            else:
                # Move to dead letter queue
                task.state = TaskState.DEAD_LETTER
                self._dead_letter.append(task)
                logger.error(f"Task {task_id} moved to dead letter after {task.retries} retries")

            self._save_state()

    async def get_status(self, task_id: str) -> Optional[TaskState]:
        """Get the status of a task."""
        if task_id in self._task_map:
            return self._task_map[task_id].state
        return None

    @property
    def size(self) -> int:
        return len([t for t in self._heap if t.state == TaskState.QUEUED])

    @property
    def stats(self) -> Dict:
        states = defaultdict(int)
        for task in self._task_map.values():
            states[task.state.value] += 1
        return {
            'queue_size': self.size,
            'total_tasks': len(self._task_map),
            'dead_letter_count': len(self._dead_letter),
            'states': dict(states),
        }


# ============================================================================
# WORKER POOL (Distributed Work Execution)
# ============================================================================

class WorkerPool:
    """
    Manages a pool of workers executing scrape tasks.

    Features:
    - Configurable concurrency per source
    - Rate-limit aware scheduling
    - Graceful shutdown
    - Worker health monitoring
    """

    def __init__(self, queue: ScrapeQueue, deduplicator: URLDeduplicator,
                 rate_limiter: RateLimiter, max_workers: int = 10):
        self.queue = queue
        self.deduplicator = deduplicator
        self.rate_limiter = rate_limiter
        self.max_workers = max_workers

        self._workers: List[asyncio.Task] = []
        self._running = False
        self._results: List[Any] = []
        self._lock = asyncio.Lock()

        # Track active workers per source for concurrency limits
        self._source_workers: Dict[str, int] = defaultdict(int)
        self._source_limits = {
            'default': 5,
            'github': 3,
            'reddit': 2,
            'leetcode': 1,
            'glassdoor': 1,
        }

    def configure_source_limit(self, source: str, limit: int) -> None:
        """Configure max concurrent workers for a source."""
        self._source_limits[source] = limit

    async def _execute_task(self, task: ScrapeTask) -> Any:
        """Execute a single scrape task."""
        # Check URL deduplication
        if task.url and self.deduplicator.is_duplicate(task.url):
            logger.debug(f"Skipping duplicate URL: {task.url}")
            return None

        # Acquire rate limit
        await self.rate_limiter.acquire(task.rate_limit_key)

        try:
            # Import and execute the scraper
            if task.scraper_type == 'python':
                result = await self._execute_python_scraper(task)
            else:
                result = await self._execute_typescript_scraper(task)

            # Mark URL as seen
            if task.url:
                self.deduplicator.mark_seen(task.url)

            return result
        except Exception as e:
            logger.error(f"Task {task.task_id} failed: {e}")
            raise

    async def _execute_python_scraper(self, task: ScrapeTask) -> Any:
        """Execute a Python scraper function."""
        import importlib

        module = importlib.import_module(task.module_path)
        func = getattr(module, task.function_name)

        # Execute with timeout
        if asyncio.iscoroutinefunction(func):
            result = await asyncio.wait_for(
                func(**task.params),
                timeout=task.timeout
            )
        else:
            # Run sync function in executor
            loop = asyncio.get_event_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: func(**task.params)),
                timeout=task.timeout
            )

        return result

    async def _execute_typescript_scraper(self, task: ScrapeTask) -> Any:
        """Execute a TypeScript scraper via subprocess."""
        import subprocess

        cmd = [
            'npx', 'tsx', task.module_path,
            '--function', task.function_name,
            '--params', json.dumps(task.params)
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=task.timeout
            )

            if proc.returncode != 0:
                raise RuntimeError(f"Scraper failed: {stderr.decode()}")

            return json.loads(stdout.decode())
        except asyncio.TimeoutError:
            proc.kill()
            raise

    async def _worker(self, worker_id: int) -> None:
        """Worker coroutine that processes tasks from the queue."""
        logger.info(f"Worker {worker_id} started")

        while self._running:
            task = await self.queue.dequeue()

            if task is None:
                # No tasks, wait a bit
                await asyncio.sleep(0.5)
                continue

            # Check source concurrency limit
            source = task.rate_limit_key
            limit = self._source_limits.get(source, self._source_limits['default'])

            if self._source_workers[source] >= limit:
                # Requeue and wait
                await self.queue.enqueue(task)
                await asyncio.sleep(0.5)
                continue

            self._source_workers[source] += 1

            try:
                result = await self._execute_task(task)
                await self.queue.complete(task.task_id, result)

                async with self._lock:
                    self._results.append({
                        'task_id': task.task_id,
                        'source': task.source_name,
                        'result': result,
                        'duration': time.time() - task.started_at,
                    })

            except Exception as e:
                await self.queue.fail(task.task_id, str(e))
            finally:
                self._source_workers[source] -= 1

        logger.info(f"Worker {worker_id} stopped")

    async def start(self) -> None:
        """Start the worker pool."""
        self._running = True
        self._workers = [
            asyncio.create_task(self._worker(i))
            for i in range(self.max_workers)
        ]
        logger.info(f"Started {self.max_workers} workers")

    async def stop(self, graceful: bool = True, timeout: float = 30) -> None:
        """Stop the worker pool."""
        self._running = False

        if graceful:
            # Wait for workers to finish current tasks
            try:
                await asyncio.wait_for(
                    asyncio.gather(*self._workers, return_exceptions=True),
                    timeout=timeout
                )
            except asyncio.TimeoutError:
                logger.warning("Graceful shutdown timed out, cancelling workers")
                for worker in self._workers:
                    worker.cancel()
        else:
            for worker in self._workers:
                worker.cancel()

        logger.info("Worker pool stopped")

    def get_results(self) -> List[Dict]:
        """Get collected results."""
        return self._results.copy()

    def clear_results(self) -> None:
        """Clear collected results."""
        self._results.clear()


# ============================================================================
# SCHEDULER (Cron-like + On-Demand)
# ============================================================================

class Schedule(Enum):
    """Predefined schedules."""
    HOURLY = 'hourly'
    DAILY = 'daily'
    WEEKLY = 'weekly'
    ON_DEMAND = 'on_demand'


@dataclass
class ScheduledTask:
    """A scheduled scrape job."""
    name: str
    schedule: Schedule
    task_template: ScrapeTask
    last_run: Optional[float] = None
    next_run: Optional[float] = None
    enabled: bool = True


class Scheduler:
    """
    Manages scheduled and on-demand scraping.

    Features:
    - Cron-like scheduling (hourly, daily, weekly)
    - On-demand triggering
    - Missed job recovery
    - Schedule persistence
    """

    SCHEDULE_INTERVALS = {
        Schedule.HOURLY: 3600,
        Schedule.DAILY: 86400,
        Schedule.WEEKLY: 604800,
    }

    def __init__(self, queue: ScrapeQueue, storage: StorageBackend):
        self.queue = queue
        self.storage = storage
        self._schedules: Dict[str, ScheduledTask] = {}
        self._running = False
        self._task: Optional[asyncio.Task] = None

        self._load_schedules()

    def _load_schedules(self) -> None:
        """Load scheduled tasks from storage."""
        data = self.storage.get('schedules')
        if data:
            try:
                schedules = json.loads(data)
                for name, s in schedules.items():
                    self._schedules[name] = ScheduledTask(
                        name=s['name'],
                        schedule=Schedule(s['schedule']),
                        task_template=ScrapeTask.from_dict(s['task_template']),
                        last_run=s.get('last_run'),
                        next_run=s.get('next_run'),
                        enabled=s.get('enabled', True),
                    )
            except Exception as e:
                logger.error(f"Failed to load schedules: {e}")

    def _save_schedules(self) -> None:
        """Persist schedules to storage."""
        data = {}
        for name, s in self._schedules.items():
            data[name] = {
                'name': s.name,
                'schedule': s.schedule.value,
                'task_template': s.task_template.to_dict(),
                'last_run': s.last_run,
                'next_run': s.next_run,
                'enabled': s.enabled,
            }
        self.storage.set('schedules', json.dumps(data, default=str))

    def add_schedule(self, name: str, schedule: Schedule,
                     task_template: ScrapeTask) -> None:
        """Add a new scheduled task."""
        now = time.time()
        interval = self.SCHEDULE_INTERVALS.get(schedule, 0)

        self._schedules[name] = ScheduledTask(
            name=name,
            schedule=schedule,
            task_template=task_template,
            next_run=now + interval if interval else None,
        )
        self._save_schedules()

    def remove_schedule(self, name: str) -> None:
        """Remove a scheduled task."""
        if name in self._schedules:
            del self._schedules[name]
            self._save_schedules()

    def enable_schedule(self, name: str, enabled: bool) -> None:
        """Enable or disable a schedule."""
        if name in self._schedules:
            self._schedules[name].enabled = enabled
            self._save_schedules()

    async def trigger_now(self, name: str) -> Optional[str]:
        """Trigger a scheduled task immediately."""
        if name not in self._schedules:
            return None

        sched = self._schedules[name]
        task = ScrapeTask(
            priority=sched.task_template.priority,
            created_at=time.time(),
            source_name=sched.task_template.source_name,
            url=sched.task_template.url,
            scraper_type=sched.task_template.scraper_type,
            module_path=sched.task_template.module_path,
            function_name=sched.task_template.function_name,
            params=sched.task_template.params.copy(),
            rate_limit_key=sched.task_template.rate_limit_key,
            timeout=sched.task_template.timeout,
        )

        return await self.queue.enqueue(task)

    async def _check_schedules(self) -> None:
        """Check and enqueue due scheduled tasks."""
        now = time.time()

        for name, sched in self._schedules.items():
            if not sched.enabled or sched.schedule == Schedule.ON_DEMAND:
                continue

            if sched.next_run and now >= sched.next_run:
                # Task is due
                task_id = await self.trigger_now(name)
                if task_id:
                    interval = self.SCHEDULE_INTERVALS[sched.schedule]
                    sched.last_run = now
                    sched.next_run = now + interval
                    self._save_schedules()
                    logger.info(f"Scheduled task '{name}' enqueued as {task_id}")

    async def _scheduler_loop(self) -> None:
        """Main scheduler loop."""
        while self._running:
            await self._check_schedules()
            await asyncio.sleep(60)  # Check every minute

    async def start(self) -> None:
        """Start the scheduler."""
        self._running = True
        self._task = asyncio.create_task(self._scheduler_loop())
        logger.info("Scheduler started")

    async def stop(self) -> None:
        """Stop the scheduler."""
        self._running = False
        if self._task:
            self._task.cancel()
        logger.info("Scheduler stopped")

    @property
    def schedules(self) -> Dict[str, Dict]:
        """Get all schedules."""
        return {
            name: {
                'schedule': s.schedule.value,
                'enabled': s.enabled,
                'last_run': s.last_run,
                'next_run': s.next_run,
            }
            for name, s in self._schedules.items()
        }


# ============================================================================
# RESULT AGGREGATOR (Deduplication & Batching)
# ============================================================================

class ResultAggregator:
    """
    Collects, deduplicates, and batches scrape results.

    Features:
    - Content-based deduplication (fuzzy matching)
    - Batch aggregation for DB writes
    - Result normalization
    - Statistics tracking
    """

    def __init__(self, storage: StorageBackend, batch_size: int = 100):
        self.storage = storage
        self.batch_size = batch_size

        self._pending: List[Dict] = []
        self._seen_hashes: Set[str] = set()
        self._stats = {
            'total_received': 0,
            'duplicates_filtered': 0,
            'batches_written': 0,
            'items_written': 0,
        }
        self._lock = asyncio.Lock()

        # Load seen hashes
        self._seen_hashes = self.storage.load_set('result_hashes')

    def _content_hash(self, item: Dict) -> str:
        """Generate a hash for content deduplication."""
        # Use company + question text for interview questions
        key_fields = ['company_name', 'question_text', 'role', 'source']
        content = '|'.join(str(item.get(f, '')) for f in key_fields)
        return hashlib.sha256(content.lower().encode()).hexdigest()[:16]

    def _normalize_item(self, item: Dict) -> Dict:
        """Normalize result item for consistency."""
        normalized = item.copy()

        # Normalize company name
        if 'company_name' in normalized:
            normalized['company_name'] = normalized['company_name'].strip().title()

        # Normalize question text
        if 'question_text' in normalized:
            text = normalized['question_text'].strip()
            # Remove excessive whitespace
            text = ' '.join(text.split())
            normalized['question_text'] = text

        # Ensure required fields
        normalized.setdefault('scraped_at', datetime.now(timezone.utc).isoformat())

        return normalized

    async def add(self, item: Dict) -> bool:
        """
        Add a result item. Returns True if added, False if duplicate.
        """
        async with self._lock:
            self._stats['total_received'] += 1

            # Normalize and hash
            normalized = self._normalize_item(item)
            content_hash = self._content_hash(normalized)

            # Check for duplicate
            if content_hash in self._seen_hashes:
                self._stats['duplicates_filtered'] += 1
                return False

            self._seen_hashes.add(content_hash)
            normalized['content_hash'] = content_hash
            self._pending.append(normalized)

            return True

    async def add_batch(self, items: List[Dict]) -> Tuple[int, int]:
        """
        Add multiple items. Returns (added_count, duplicate_count).
        """
        added = 0
        duplicates = 0

        for item in items:
            if await self.add(item):
                added += 1
            else:
                duplicates += 1

        return added, duplicates

    async def flush(self, writer: Callable[[List[Dict]], Any] = None) -> List[Dict]:
        """
        Get pending items and clear the buffer.
        Optionally pass to a writer function.
        """
        async with self._lock:
            items = self._pending.copy()
            self._pending.clear()

            if items:
                self._stats['batches_written'] += 1
                self._stats['items_written'] += len(items)

                # Persist seen hashes
                self.storage.save_set('result_hashes', self._seen_hashes)

            if writer and items:
                await writer(items) if asyncio.iscoroutinefunction(writer) else writer(items)

            return items

    async def get_batch(self) -> Optional[List[Dict]]:
        """Get a batch if we have enough items."""
        async with self._lock:
            if len(self._pending) >= self.batch_size:
                batch = self._pending[:self.batch_size]
                self._pending = self._pending[self.batch_size:]
                return batch
            return None

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    @property
    def stats(self) -> Dict:
        return {
            **self._stats,
            'pending_items': self.pending_count,
            'unique_hashes': len(self._seen_hashes),
        }


# ============================================================================
# CONVENIENCE: FULL SYSTEM ORCHESTRATOR
# ============================================================================

class ScraperSystem:
    """
    High-level orchestrator combining all components.

    Usage:
        system = ScraperSystem()
        await system.start()

        # Add tasks
        await system.add_task(ScrapeTask(...))

        # Wait for completion
        results = await system.wait_for_results()

        await system.stop()
    """

    def __init__(self, max_workers: int = 10, use_redis: bool = False):
        # Initialize storage
        if use_redis:
            try:
                self.storage = RedisStorageBackend()
            except:
                self.storage = FileStorageBackend()
        else:
            self.storage = FileStorageBackend()

        # Initialize components
        self.queue = ScrapeQueue(self.storage)
        self.deduplicator = URLDeduplicator(self.storage)
        self.rate_limiter = RateLimiter(self.storage)
        self.aggregator = ResultAggregator(self.storage)
        self.pool = WorkerPool(
            self.queue, self.deduplicator,
            self.rate_limiter, max_workers
        )
        self.scheduler = Scheduler(self.queue, self.storage)

    async def start(self) -> None:
        """Start all components."""
        await self.pool.start()
        await self.scheduler.start()
        logger.info("Scraper system started")

    async def stop(self) -> None:
        """Stop all components."""
        await self.scheduler.stop()
        await self.pool.stop()
        logger.info("Scraper system stopped")

    async def add_task(self, task: ScrapeTask) -> str:
        """Add a single task."""
        return await self.queue.enqueue(task)

    async def add_tasks(self, tasks: List[ScrapeTask]) -> List[str]:
        """Add multiple tasks."""
        return await self.queue.enqueue_batch(tasks)

    async def add_scraper(self, source_name: str, module_path: str,
                          function_name: str, priority: Priority = Priority.NORMAL,
                          params: Dict = None, schedule: Schedule = None) -> str:
        """Convenience method to add a scraper task."""
        task = ScrapeTask(
            priority=priority.value,
            created_at=time.time(),
            source_name=source_name,
            module_path=module_path,
            function_name=function_name,
            params=params or {},
            rate_limit_key=source_name,
        )

        if schedule:
            self.scheduler.add_schedule(source_name, schedule, task)
            return f"scheduled:{source_name}"

        return await self.queue.enqueue(task)

    async def wait_for_completion(self, timeout: float = None) -> None:
        """Wait for the queue to empty."""
        start = time.time()
        while self.queue.size > 0:
            if timeout and (time.time() - start) > timeout:
                raise TimeoutError("Queue did not empty in time")
            await asyncio.sleep(1)

    def get_stats(self) -> Dict:
        """Get system-wide statistics."""
        return {
            'queue': self.queue.stats,
            'deduplicator': self.deduplicator.stats,
            'aggregator': self.aggregator.stats,
        }


# ============================================================================
# CLI INTERFACE
# ============================================================================

async def main():
    """Demo/test the queue system."""
    import argparse

    parser = argparse.ArgumentParser(description='Scraper Queue System')
    parser.add_argument('--workers', type=int, default=5, help='Number of workers')
    parser.add_argument('--redis', action='store_true', help='Use Redis backend')
    args = parser.parse_args()

    # Initialize system
    system = ScraperSystem(max_workers=args.workers, use_redis=args.redis)

    print("Scraper Queue System initialized")
    print(f"Storage: {'Redis' if args.redis else 'File-based'}")
    print(f"Workers: {args.workers}")
    print(f"Stats: {json.dumps(system.get_stats(), indent=2)}")


if __name__ == '__main__':
    asyncio.run(main())
