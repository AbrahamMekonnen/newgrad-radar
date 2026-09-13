"""
Intelligent Rate Limiting System for Interview Question Scrapers

Features:
- AdaptiveRateLimiter: Adjusts delays based on response times and error rates
- DomainThrottler: Per-domain rate limits with separate queues
- CircuitBreaker: Prevents hammering failing endpoints
- RequestPool: Concurrent request management with priorities
"""

import asyncio
import time
import random
import hashlib
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Callable, Any, Dict, List, Tuple
from urllib.parse import urlparse
import threading
import heapq


class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if recovered


@dataclass
class RequestMetrics:
    """Track request performance metrics for adaptive limiting."""
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_response_time: float = 0.0
    last_request_time: float = 0.0
    consecutive_failures: int = 0
    consecutive_successes: int = 0

    @property
    def avg_response_time(self) -> float:
        if self.successful_requests == 0:
            return 0.0
        return self.total_response_time / self.successful_requests

    @property
    def error_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return self.failed_requests / self.total_requests

    @property
    def success_rate(self) -> float:
        return 1.0 - self.error_rate


class AdaptiveRateLimiter:
    """
    Dynamically adjusts rate limits based on:
    - Response times (slower = back off more)
    - Error rates (more errors = longer delays)
    - Time of day (optional peak hour awareness)
    """

    def __init__(
        self,
        base_delay: float = 1.0,
        min_delay: float = 0.1,
        max_delay: float = 30.0,
        target_response_time: float = 2.0,
        error_penalty_multiplier: float = 2.0,
        success_reward_divisor: float = 1.1,
        jitter_factor: float = 0.2,
    ):
        self.base_delay = base_delay
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.target_response_time = target_response_time
        self.error_penalty_multiplier = error_penalty_multiplier
        self.success_reward_divisor = success_reward_divisor
        self.jitter_factor = jitter_factor

        self.current_delay = base_delay
        self.metrics = RequestMetrics()
        self._lock = threading.Lock()

    def _add_jitter(self, delay: float) -> float:
        """Add random jitter to prevent thundering herd."""
        jitter = delay * self.jitter_factor * (2 * random.random() - 1)
        return max(self.min_delay, delay + jitter)

    def record_success(self, response_time: float) -> None:
        """Record a successful request and adjust delay."""
        with self._lock:
            self.metrics.total_requests += 1
            self.metrics.successful_requests += 1
            self.metrics.total_response_time += response_time
            self.metrics.last_request_time = time.time()
            self.metrics.consecutive_successes += 1
            self.metrics.consecutive_failures = 0

            # Adjust delay based on response time
            if response_time < self.target_response_time:
                # Fast response - can speed up
                self.current_delay = max(
                    self.min_delay,
                    self.current_delay / self.success_reward_divisor
                )
            elif response_time > self.target_response_time * 2:
                # Slow response - back off
                self.current_delay = min(
                    self.max_delay,
                    self.current_delay * 1.5
                )

    def record_failure(self, is_rate_limit: bool = False) -> None:
        """Record a failed request and increase delay."""
        with self._lock:
            self.metrics.total_requests += 1
            self.metrics.failed_requests += 1
            self.metrics.last_request_time = time.time()
            self.metrics.consecutive_failures += 1
            self.metrics.consecutive_successes = 0

            # Rate limit errors get extra penalty
            multiplier = self.error_penalty_multiplier
            if is_rate_limit:
                multiplier *= 2

            # Exponential backoff with consecutive failures
            backoff = multiplier ** min(self.metrics.consecutive_failures, 5)
            self.current_delay = min(self.max_delay, self.current_delay * backoff)

    def get_delay(self) -> float:
        """Get the current delay with jitter."""
        with self._lock:
            return self._add_jitter(self.current_delay)

    async def wait(self) -> None:
        """Wait the appropriate amount of time before next request."""
        delay = self.get_delay()
        await asyncio.sleep(delay)

    def wait_sync(self) -> None:
        """Synchronous version of wait."""
        delay = self.get_delay()
        time.sleep(delay)

    def reset(self) -> None:
        """Reset to base delay."""
        with self._lock:
            self.current_delay = self.base_delay
            self.metrics = RequestMetrics()

    def get_stats(self) -> Dict[str, Any]:
        """Get current statistics."""
        with self._lock:
            return {
                "current_delay": self.current_delay,
                "total_requests": self.metrics.total_requests,
                "success_rate": self.metrics.success_rate,
                "avg_response_time": self.metrics.avg_response_time,
                "consecutive_failures": self.metrics.consecutive_failures,
            }


class DomainThrottler:
    """
    Per-domain rate limiting with separate queues.
    Different domains can have different rate limits.
    """

    DEFAULT_LIMITS = {
        "github.com": 0.5,           # GitHub API - 2 req/sec
        "api.github.com": 1.0,       # GitHub REST API
        "reddit.com": 1.0,           # Reddit - 1 req/sec
        "oauth.reddit.com": 1.0,
        "leetcode.com": 2.0,         # LeetCode - slower
        "glassdoor.com": 3.0,        # Glassdoor - aggressive anti-bot
        "blind.com": 3.0,            # Blind - similar
        "teamblind.com": 3.0,
        "1point3acres.com": 2.0,     # 1P3A - rate limited
        "nowcoder.com": 1.5,         # Nowcoder
        "zhihu.com": 2.0,            # Zhihu
        "juejin.cn": 1.5,            # Juejin
        "notion.so": 1.0,            # Notion
        "medium.com": 1.5,           # Medium
        "quora.com": 2.0,            # Quora
        "dev.to": 0.5,               # Dev.to - generous
        "hackernews": 0.5,           # HN Algolia API
        "youtube.com": 1.0,          # YouTube API
    }

    def __init__(self, default_delay: float = 1.0):
        self.default_delay = default_delay
        self.domain_limiters: Dict[str, AdaptiveRateLimiter] = {}
        self.domain_limits = dict(self.DEFAULT_LIMITS)
        self._lock = threading.Lock()

    def _get_domain(self, url: str) -> str:
        """Extract domain from URL."""
        parsed = urlparse(url)
        domain = parsed.netloc or parsed.path.split('/')[0]
        # Remove www. prefix
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain.lower()

    def _get_limiter(self, domain: str) -> AdaptiveRateLimiter:
        """Get or create limiter for domain."""
        with self._lock:
            if domain not in self.domain_limiters:
                base_delay = self.domain_limits.get(domain, self.default_delay)
                self.domain_limiters[domain] = AdaptiveRateLimiter(
                    base_delay=base_delay,
                    min_delay=base_delay * 0.5,
                    max_delay=base_delay * 30,
                )
            return self.domain_limiters[domain]

    def set_domain_limit(self, domain: str, delay: float) -> None:
        """Set custom rate limit for a domain."""
        with self._lock:
            self.domain_limits[domain.lower()] = delay
            # Reset limiter if exists
            if domain in self.domain_limiters:
                del self.domain_limiters[domain]

    def get_delay(self, url: str = "") -> float:
        """Return the current delay for a URL's domain.

        Compatibility shim: some source adapters call ``throttler.get_delay()``
        expecting the per-limiter API. Delegates to the domain's limiter when a
        URL is given, otherwise returns the default delay.
        """
        try:
            if url:
                return self._get_limiter(self._get_domain(url)).get_delay()
        except Exception:
            pass
        return self.default_delay

    async def acquire(self, url: str) -> None:
        """Wait for rate limit before making request to URL."""
        domain = self._get_domain(url)
        limiter = self._get_limiter(domain)
        await limiter.wait()

    def acquire_sync(self, url: str) -> None:
        """Synchronous version of acquire."""
        domain = self._get_domain(url)
        limiter = self._get_limiter(domain)
        limiter.wait_sync()

    def record_success(self, url: str, response_time: float) -> None:
        """Record successful request for URL's domain."""
        domain = self._get_domain(url)
        limiter = self._get_limiter(domain)
        limiter.record_success(response_time)

    def record_failure(self, url: str, is_rate_limit: bool = False) -> None:
        """Record failed request for URL's domain."""
        domain = self._get_domain(url)
        limiter = self._get_limiter(domain)
        limiter.record_failure(is_rate_limit)

    def get_all_stats(self) -> Dict[str, Dict[str, Any]]:
        """Get stats for all domains."""
        with self._lock:
            return {
                domain: limiter.get_stats()
                for domain, limiter in self.domain_limiters.items()
            }


class CircuitBreaker:
    """
    Prevents hammering failing endpoints.

    States:
    - CLOSED: Normal operation, requests flow through
    - OPEN: Endpoint failing, reject requests immediately
    - HALF_OPEN: Testing if endpoint recovered
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        success_threshold: int = 3,
        timeout: float = 60.0,
        half_open_max_calls: int = 3,
    ):
        self.failure_threshold = failure_threshold
        self.success_threshold = success_threshold
        self.timeout = timeout
        self.half_open_max_calls = half_open_max_calls

        self.state = CircuitState.CLOSED
        self.failures = 0
        self.successes = 0
        self.last_failure_time: Optional[float] = None
        self.half_open_calls = 0
        self._lock = threading.Lock()

    def _should_allow_request(self) -> bool:
        """Check if request should be allowed based on circuit state."""
        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            # Check if timeout has passed
            if self.last_failure_time and (time.time() - self.last_failure_time) > self.timeout:
                self.state = CircuitState.HALF_OPEN
                self.half_open_calls = 0
                self.successes = 0
                return True
            return False

        if self.state == CircuitState.HALF_OPEN:
            # Allow limited requests in half-open state
            return self.half_open_calls < self.half_open_max_calls

        return False

    def allow_request(self) -> bool:
        """Check if a request should be allowed."""
        with self._lock:
            return self._should_allow_request()

    def record_success(self) -> None:
        """Record a successful request."""
        with self._lock:
            self.failures = 0

            if self.state == CircuitState.HALF_OPEN:
                self.successes += 1
                self.half_open_calls += 1

                if self.successes >= self.success_threshold:
                    # Recovered - close circuit
                    self.state = CircuitState.CLOSED
                    self.successes = 0

    def record_failure(self) -> None:
        """Record a failed request."""
        with self._lock:
            self.failures += 1
            self.successes = 0
            self.last_failure_time = time.time()

            if self.state == CircuitState.HALF_OPEN:
                # Failed during recovery test - open circuit again
                self.state = CircuitState.OPEN
                self.half_open_calls = 0
            elif self.failures >= self.failure_threshold:
                # Too many failures - open circuit
                self.state = CircuitState.OPEN

    def reset(self) -> None:
        """Reset circuit breaker to closed state."""
        with self._lock:
            self.state = CircuitState.CLOSED
            self.failures = 0
            self.successes = 0
            self.last_failure_time = None
            self.half_open_calls = 0

    def get_state(self) -> Dict[str, Any]:
        """Get current circuit breaker state."""
        with self._lock:
            return {
                "state": self.state.value,
                "failures": self.failures,
                "successes": self.successes,
                "time_until_retry": max(0, self.timeout - (time.time() - (self.last_failure_time or 0)))
                    if self.state == CircuitState.OPEN else 0,
            }


class CircuitBreakerRegistry:
    """Manage circuit breakers for multiple endpoints."""

    def __init__(self, **default_kwargs):
        self.breakers: Dict[str, CircuitBreaker] = {}
        self.default_kwargs = default_kwargs
        self._lock = threading.Lock()

    def _get_key(self, url: str) -> str:
        """Get circuit breaker key for URL."""
        parsed = urlparse(url)
        return f"{parsed.netloc}{parsed.path}".lower()

    def get(self, url: str) -> CircuitBreaker:
        """Get or create circuit breaker for endpoint."""
        key = self._get_key(url)
        with self._lock:
            if key not in self.breakers:
                self.breakers[key] = CircuitBreaker(**self.default_kwargs)
            return self.breakers[key]

    def allow_request(self, url: str) -> bool:
        """Check if request to URL should be allowed."""
        return self.get(url).allow_request()

    def record_success(self, url: str) -> None:
        """Record successful request."""
        self.get(url).record_success()

    def record_failure(self, url: str) -> None:
        """Record failed request."""
        self.get(url).record_failure()


class Priority(Enum):
    """Request priority levels."""
    CRITICAL = 0   # Must execute immediately
    HIGH = 1       # High-value sources
    NORMAL = 2     # Default priority
    LOW = 3        # Background/bulk scraping
    IDLE = 4       # Only when nothing else to do


@dataclass(order=True)
class PrioritizedRequest:
    """A request with priority for the queue."""
    priority: int
    timestamp: float = field(compare=False)
    url: str = field(compare=False)
    callback: Optional[Callable] = field(compare=False, default=None)
    retries: int = field(compare=False, default=0)
    max_retries: int = field(compare=False, default=3)
    request_id: str = field(compare=False, default="")

    def __post_init__(self):
        if not self.request_id:
            self.request_id = hashlib.md5(
                f"{self.url}{self.timestamp}{random.random()}".encode()
            ).hexdigest()[:12]


class RequestPool:
    """
    Concurrent request management with priorities.

    Features:
    - Priority queue for requests
    - Concurrent execution with configurable workers
    - Automatic retry with backoff
    - Request deduplication
    """

    def __init__(
        self,
        max_concurrent: int = 10,
        domain_throttler: Optional[DomainThrottler] = None,
        circuit_registry: Optional[CircuitBreakerRegistry] = None,
    ):
        self.max_concurrent = max_concurrent
        self.domain_throttler = domain_throttler or DomainThrottler()
        self.circuit_registry = circuit_registry or CircuitBreakerRegistry()

        self.queue: List[PrioritizedRequest] = []
        self.in_flight: Dict[str, PrioritizedRequest] = {}
        self.completed: Dict[str, Any] = {}
        self.failed: Dict[str, Exception] = {}
        self.seen_urls: set = set()

        self._lock = threading.Lock()
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._running = False

    def add_request(
        self,
        url: str,
        priority: Priority = Priority.NORMAL,
        callback: Optional[Callable] = None,
        deduplicate: bool = True,
        max_retries: int = 3,
    ) -> Optional[str]:
        """
        Add a request to the pool.
        Returns request_id if added, None if deduplicated.
        """
        with self._lock:
            if deduplicate and url in self.seen_urls:
                return None

            self.seen_urls.add(url)

            request = PrioritizedRequest(
                priority=priority.value,
                timestamp=time.time(),
                url=url,
                callback=callback,
                max_retries=max_retries,
            )

            heapq.heappush(self.queue, request)
            return request.request_id

    def add_batch(
        self,
        urls: List[str],
        priority: Priority = Priority.NORMAL,
        callback: Optional[Callable] = None,
    ) -> List[str]:
        """Add multiple requests at once."""
        request_ids = []
        for url in urls:
            req_id = self.add_request(url, priority, callback)
            if req_id:
                request_ids.append(req_id)
        return request_ids

    async def _process_request(
        self,
        request: PrioritizedRequest,
        fetch_fn: Callable,
    ) -> Tuple[str, Optional[Any], Optional[Exception]]:
        """Process a single request."""
        url = request.url

        # Check circuit breaker
        if not self.circuit_registry.allow_request(url):
            return (request.request_id, None, Exception("Circuit open"))

        # Wait for rate limit
        await self.domain_throttler.acquire(url)

        start_time = time.time()
        try:
            result = await fetch_fn(url)
            response_time = time.time() - start_time

            # Record success
            self.domain_throttler.record_success(url, response_time)
            self.circuit_registry.record_success(url)

            # Call callback if provided
            if request.callback:
                try:
                    request.callback(result)
                except Exception:
                    pass  # Don't fail the request due to callback error

            return (request.request_id, result, None)

        except Exception as e:
            response_time = time.time() - start_time

            # Detect rate limit errors
            is_rate_limit = any(
                indicator in str(e).lower()
                for indicator in ["429", "rate limit", "too many requests", "throttle"]
            )

            # Record failure
            self.domain_throttler.record_failure(url, is_rate_limit)
            self.circuit_registry.record_failure(url)

            # Retry logic
            if request.retries < request.max_retries:
                request.retries += 1
                # Re-add with lower priority after a delay
                await asyncio.sleep(2 ** request.retries)  # Exponential backoff
                with self._lock:
                    heapq.heappush(self.queue, request)
                return (request.request_id, None, None)  # Will be retried

            return (request.request_id, None, e)

    async def run(
        self,
        fetch_fn: Callable[[str], Any],
        max_requests: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Process all queued requests.

        Args:
            fetch_fn: Async function that takes URL and returns result
            max_requests: Maximum requests to process (None = all)

        Returns:
            Dict of request_id -> result
        """
        self._running = True
        self._semaphore = asyncio.Semaphore(self.max_concurrent)

        processed = 0
        tasks = []

        async def worker(request: PrioritizedRequest):
            async with self._semaphore:
                return await self._process_request(request, fetch_fn)

        while self._running and self.queue:
            if max_requests and processed >= max_requests:
                break

            with self._lock:
                if not self.queue:
                    break
                request = heapq.heappop(self.queue)

            self.in_flight[request.request_id] = request
            tasks.append(asyncio.create_task(worker(request)))
            processed += 1

            # Process in batches to avoid too many pending tasks
            if len(tasks) >= self.max_concurrent * 2:
                done, tasks_list = await asyncio.wait(
                    tasks,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                tasks = list(tasks_list)

                for task in done:
                    req_id, result, error = task.result()
                    if req_id in self.in_flight:
                        del self.in_flight[req_id]
                    if error:
                        self.failed[req_id] = error
                    elif result is not None:
                        self.completed[req_id] = result

        # Wait for remaining tasks
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, tuple):
                    req_id, result, error = r
                    if req_id in self.in_flight:
                        del self.in_flight[req_id]
                    if error:
                        self.failed[req_id] = error
                    elif result is not None:
                        self.completed[req_id] = result

        self._running = False
        return dict(self.completed)

    def stop(self) -> None:
        """Stop processing requests."""
        self._running = False

    def get_stats(self) -> Dict[str, Any]:
        """Get pool statistics."""
        with self._lock:
            return {
                "queued": len(self.queue),
                "in_flight": len(self.in_flight),
                "completed": len(self.completed),
                "failed": len(self.failed),
                "seen_urls": len(self.seen_urls),
            }

    def clear(self) -> None:
        """Clear all state."""
        with self._lock:
            self.queue.clear()
            self.in_flight.clear()
            self.completed.clear()
            self.failed.clear()
            self.seen_urls.clear()


# Convenience factory functions

def create_scraper_pool(
    max_concurrent: int = 10,
    aggressive: bool = False,
) -> RequestPool:
    """
    Create a configured request pool for scraping.

    Args:
        max_concurrent: Max concurrent requests
        aggressive: If True, use faster rate limits (risky)
    """
    if aggressive:
        throttler = DomainThrottler(default_delay=0.5)
        circuit = CircuitBreakerRegistry(
            failure_threshold=10,
            timeout=30.0,
        )
    else:
        throttler = DomainThrottler(default_delay=1.0)
        circuit = CircuitBreakerRegistry(
            failure_threshold=5,
            timeout=60.0,
        )

    return RequestPool(
        max_concurrent=max_concurrent,
        domain_throttler=throttler,
        circuit_registry=circuit,
    )


# Global instances for convenience
_default_throttler: Optional[DomainThrottler] = None
_default_circuit: Optional[CircuitBreakerRegistry] = None


def get_throttler(*_args, **_kwargs) -> DomainThrottler:
    """Get global domain throttler. Accepts/ignores a domain arg some callers pass."""
    global _default_throttler
    if _default_throttler is None:
        _default_throttler = DomainThrottler()
    return _default_throttler


def get_circuit_registry() -> CircuitBreakerRegistry:
    """Get global circuit breaker registry."""
    global _default_circuit
    if _default_circuit is None:
        _default_circuit = CircuitBreakerRegistry()
    return _default_circuit


async def throttled_fetch(
    url: str,
    fetch_fn: Callable[[str], Any],
) -> Any:
    """
    Convenience function for making a throttled request.

    Example:
        async def fetch(url):
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    return await resp.text()

        result = await throttled_fetch("https://example.com", fetch)
    """
    throttler = get_throttler()
    circuit = get_circuit_registry()

    if not circuit.allow_request(url):
        raise Exception(f"Circuit breaker open for {url}")

    await throttler.acquire(url)

    start = time.time()
    try:
        result = await fetch_fn(url)
        throttler.record_success(url, time.time() - start)
        circuit.record_success(url)
        return result
    except Exception as e:
        is_rate_limit = "429" in str(e) or "rate" in str(e).lower()
        throttler.record_failure(url, is_rate_limit)
        circuit.record_failure(url)
        raise
