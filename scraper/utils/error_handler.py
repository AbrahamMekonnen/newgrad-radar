"""
Robust error recovery system for interview question scrapers.

Provides:
- RetryManager: Automatic retry with exponential backoff
- CheckpointManager: Checkpoint/resume for long scrapes
- DeadLetterQueue: Failed items tracking and replay
- ErrorClassifier: Transient vs permanent error classification
- GracefulDegrader: Fallback strategies and partial results
"""

import json
import time
import hashlib
import logging
import traceback
from pathlib import Path
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, TypeVar, Generic
from dataclasses import dataclass, field, asdict
from enum import Enum
from functools import wraps
import threading
import os

T = TypeVar('T')

logger = logging.getLogger(__name__)


class ErrorType(Enum):
    """Classification of error types for retry decisions."""
    TRANSIENT = "transient"  # Network timeout, rate limit - worth retrying
    PERMANENT = "permanent"  # 404, invalid data - don't retry
    UNKNOWN = "unknown"      # Unclassified errors


@dataclass
class ErrorRecord:
    """Record of a single error occurrence."""
    timestamp: str
    error_type: str
    error_class: str
    message: str
    traceback: Optional[str] = None
    url: Optional[str] = None
    context: Dict[str, Any] = field(default_factory=dict)
    retry_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_exception(cls, exc: Exception, url: Optional[str] = None,
                       context: Optional[Dict] = None, retry_count: int = 0) -> 'ErrorRecord':
        return cls(
            timestamp=datetime.utcnow().isoformat(),
            error_type=ErrorClassifier.classify(exc).value,
            error_class=exc.__class__.__name__,
            message=str(exc),
            traceback=traceback.format_exc(),
            url=url,
            context=context or {},
            retry_count=retry_count
        )


class ErrorClassifier:
    """Classifies errors as transient or permanent to inform retry decisions."""

    # HTTP status codes that indicate transient errors
    TRANSIENT_STATUS_CODES = {
        408,  # Request Timeout
        429,  # Too Many Requests (rate limit)
        500,  # Internal Server Error
        502,  # Bad Gateway
        503,  # Service Unavailable
        504,  # Gateway Timeout
        520,  # Cloudflare errors
        521,
        522,
        523,
        524,
    }

    # HTTP status codes that indicate permanent errors
    PERMANENT_STATUS_CODES = {
        400,  # Bad Request
        401,  # Unauthorized
        403,  # Forbidden
        404,  # Not Found
        405,  # Method Not Allowed
        410,  # Gone
        422,  # Unprocessable Entity
        451,  # Unavailable for Legal Reasons
    }

    # Exception types that are transient
    TRANSIENT_EXCEPTIONS = {
        'TimeoutError',
        'ConnectionError',
        'ConnectionResetError',
        'ConnectionRefusedError',
        'ConnectionAbortedError',
        'BrokenPipeError',
        'OSError',
        'IOError',
        'SocketError',
        'SSLError',
        'ChunkedEncodingError',
        'ContentDecodingError',
        'ReadTimeout',
        'ConnectTimeout',
        'Timeout',
        'TooManyRedirects',
        'RetryError',
    }

    # Exception types that are permanent
    PERMANENT_EXCEPTIONS = {
        'ValueError',
        'KeyError',
        'TypeError',
        'AttributeError',
        'JSONDecodeError',
        'UnicodeDecodeError',
        'ParseError',
        'ValidationError',
    }

    @classmethod
    def classify(cls, error: Exception) -> ErrorType:
        """Classify an error as transient, permanent, or unknown."""
        error_name = error.__class__.__name__

        # Check exception type first
        if error_name in cls.TRANSIENT_EXCEPTIONS:
            return ErrorType.TRANSIENT
        if error_name in cls.PERMANENT_EXCEPTIONS:
            return ErrorType.PERMANENT

        # Check for HTTP status codes in common exception patterns
        error_str = str(error).lower()

        # Check for rate limiting patterns
        if any(pattern in error_str for pattern in ['rate limit', 'too many requests', '429', 'throttl']):
            return ErrorType.TRANSIENT

        # Check for timeout patterns
        if any(pattern in error_str for pattern in ['timeout', 'timed out', 'connection reset']):
            return ErrorType.TRANSIENT

        # Check for not found patterns
        if any(pattern in error_str for pattern in ['404', 'not found', 'does not exist']):
            return ErrorType.PERMANENT

        # Check for authentication patterns
        if any(pattern in error_str for pattern in ['401', '403', 'unauthorized', 'forbidden', 'access denied']):
            return ErrorType.PERMANENT

        # Check if error has status_code attribute (requests.HTTPError, etc.)
        status_code = getattr(error, 'status_code', None) or getattr(error, 'code', None)
        if status_code:
            if status_code in cls.TRANSIENT_STATUS_CODES:
                return ErrorType.TRANSIENT
            if status_code in cls.PERMANENT_STATUS_CODES:
                return ErrorType.PERMANENT

        # Check response attribute for status code
        response = getattr(error, 'response', None)
        if response is not None:
            status = getattr(response, 'status_code', None)
            if status:
                if status in cls.TRANSIENT_STATUS_CODES:
                    return ErrorType.TRANSIENT
                if status in cls.PERMANENT_STATUS_CODES:
                    return ErrorType.PERMANENT

        return ErrorType.UNKNOWN

    @classmethod
    def should_retry(cls, error: Exception, retry_count: int = 0, max_retries: int = 3) -> bool:
        """Determine if an error should trigger a retry."""
        if retry_count >= max_retries:
            return False

        error_type = cls.classify(error)

        # Always retry transient errors
        if error_type == ErrorType.TRANSIENT:
            return True

        # Never retry permanent errors
        if error_type == ErrorType.PERMANENT:
            return False

        # For unknown errors, retry once or twice
        return retry_count < min(2, max_retries)


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""
    max_retries: int = 3
    base_delay: float = 1.0  # seconds
    max_delay: float = 60.0  # seconds
    exponential_base: float = 2.0
    jitter: float = 0.1  # 10% jitter
    retry_transient_only: bool = False


class RetryManager:
    """Manages automatic retries with exponential backoff."""

    def __init__(self, config: Optional[RetryConfig] = None):
        self.config = config or RetryConfig()
        self._stats = {
            'total_attempts': 0,
            'successful': 0,
            'failed_permanent': 0,
            'failed_exhausted': 0,
            'retries_used': 0,
        }
        self._lock = threading.Lock()

    def calculate_delay(self, retry_count: int) -> float:
        """Calculate delay for a given retry attempt with exponential backoff and jitter."""
        delay = self.config.base_delay * (self.config.exponential_base ** retry_count)
        delay = min(delay, self.config.max_delay)

        # Add jitter to prevent thundering herd
        import random
        jitter = delay * self.config.jitter * (2 * random.random() - 1)
        return max(0.1, delay + jitter)

    def execute(self, func: Callable[[], T],
                on_retry: Optional[Callable[[Exception, int], None]] = None,
                context: Optional[Dict] = None) -> T:
        """Execute a function with automatic retry on failure."""
        last_error = None

        for attempt in range(self.config.max_retries + 1):
            with self._lock:
                self._stats['total_attempts'] += 1

            try:
                result = func()
                with self._lock:
                    self._stats['successful'] += 1
                    if attempt > 0:
                        self._stats['retries_used'] += attempt
                return result

            except Exception as e:
                last_error = e
                error_type = ErrorClassifier.classify(e)

                # Don't retry permanent errors
                if error_type == ErrorType.PERMANENT:
                    with self._lock:
                        self._stats['failed_permanent'] += 1
                    raise

                # Don't retry if we've exhausted attempts
                if attempt >= self.config.max_retries:
                    with self._lock:
                        self._stats['failed_exhausted'] += 1
                    raise

                # Don't retry unknown errors if configured to only retry transient
                if self.config.retry_transient_only and error_type != ErrorType.TRANSIENT:
                    with self._lock:
                        self._stats['failed_permanent'] += 1
                    raise

                # Calculate and apply backoff delay
                delay = self.calculate_delay(attempt)

                if on_retry:
                    on_retry(e, attempt + 1)

                logger.warning(
                    f"Retry {attempt + 1}/{self.config.max_retries} after error: {e}. "
                    f"Waiting {delay:.2f}s..."
                )

                time.sleep(delay)

        # Should not reach here, but just in case
        raise last_error

    def decorator(self, on_retry: Optional[Callable[[Exception, int], None]] = None):
        """Decorator version of retry logic."""
        def wrapper(func: Callable[..., T]) -> Callable[..., T]:
            @wraps(func)
            def wrapped(*args, **kwargs) -> T:
                return self.execute(lambda: func(*args, **kwargs), on_retry=on_retry)
            return wrapped
        return wrapper

    @property
    def stats(self) -> Dict[str, int]:
        with self._lock:
            return dict(self._stats)

    def reset_stats(self):
        with self._lock:
            for key in self._stats:
                self._stats[key] = 0


@dataclass
class Checkpoint:
    """Represents a scraping checkpoint."""
    scraper_id: str
    source_name: str
    timestamp: str
    progress: Dict[str, Any]
    last_processed_id: Optional[str] = None
    items_processed: int = 0
    items_failed: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Checkpoint':
        return cls(**data)


class CheckpointManager:
    """Manages checkpointing and resumption for long-running scrapes."""

    def __init__(self, checkpoint_dir: Optional[str] = None, name: Optional[str] = None):
        # Many scrapers call CheckpointManager("scrapername") — a plain scope
        # name, not a directory. Detect that and treat it as the scope.
        scope = name
        if checkpoint_dir and not name and ('/' not in checkpoint_dir and '\\' not in checkpoint_dir):
            scope = checkpoint_dir
            checkpoint_dir = None
        self._scope = scope or 'default'
        default_dir = Path(__file__).resolve().parent.parent / '.scraper_state' / 'checkpoints'
        self.checkpoint_dir = Path(checkpoint_dir or os.environ.get(
            'SCRAPER_CHECKPOINT_DIR', str(default_dir)
        ))
        try:
            self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            self.checkpoint_dir = default_dir
            self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self._current_checkpoint: Optional[Checkpoint] = None
        self._auto_save_interval = 100  # Save every N items
        self._items_since_save = 0

    def _scope_path(self) -> Path:
        safe = str(self._scope).replace('/', '_').replace('\\', '_')
        return self.checkpoint_dir / f"{safe}.checkpoint.json"

    def _checkpoint_path(self, scraper_id: str, source_name: str) -> Path:
        """Get the path for a checkpoint file."""
        safe_name = f"{scraper_id}_{source_name}".replace('/', '_').replace('\\', '_')
        return self.checkpoint_dir / f"{safe_name}.checkpoint.json"

    def save(self, checkpoint) -> None:
        """Save a checkpoint to disk.

        Accepts either a Checkpoint object (strict API) or a plain dict
        (simple per-scope API used by the interview scrapers)."""
        if isinstance(checkpoint, dict):
            path = self._scope_path()
            temp_path = path.with_suffix('.tmp')
            with open(temp_path, 'w') as f:
                json.dump(checkpoint, f, indent=2, default=str)
            temp_path.rename(path)
            self._items_since_save = 0
            return
        path = self._checkpoint_path(checkpoint.scraper_id, checkpoint.source_name)
        checkpoint.timestamp = datetime.utcnow().isoformat()

        # Write atomically using temp file + rename
        temp_path = path.with_suffix('.tmp')
        with open(temp_path, 'w') as f:
            json.dump(checkpoint.to_dict(), f, indent=2)
        temp_path.rename(path)

        self._current_checkpoint = checkpoint
        self._items_since_save = 0
        logger.debug(f"Checkpoint saved: {path}")

    def load(self, scraper_id: Optional[str] = None, source_name: Optional[str] = None):
        """Load a checkpoint from disk if it exists.

        No-arg call (simple API) returns the raw progress dict; the strict
        two-arg call returns a Checkpoint object."""
        if scraper_id is None:
            path = self._scope_path()
            if not path.exists():
                return None
            try:
                with open(path, 'r') as f:
                    return json.load(f)
            except Exception:
                return None
        path = self._checkpoint_path(scraper_id, source_name)

        if not path.exists():
            return None

        try:
            with open(path, 'r') as f:
                data = json.load(f)
            checkpoint = Checkpoint.from_dict(data)
            self._current_checkpoint = checkpoint
            logger.info(f"Checkpoint loaded: {checkpoint.items_processed} items processed previously")
            return checkpoint
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.warning(f"Failed to load checkpoint: {e}")
            return None

    def clear(self, scraper_id: Optional[str] = None, source_name: Optional[str] = None) -> None:
        """Clear a checkpoint after successful completion (both APIs)."""
        if scraper_id is None:
            path = self._scope_path()
        else:
            path = self._checkpoint_path(scraper_id, source_name)
        if path.exists():
            path.unlink()
            logger.debug(f"Checkpoint cleared: {path}")
        self._current_checkpoint = None

    def update_progress(self, scraper_id: str, source_name: str,
                        last_processed_id: Optional[str] = None,
                        items_processed: int = 0,
                        items_failed: int = 0,
                        progress: Optional[Dict] = None,
                        metadata: Optional[Dict] = None) -> None:
        """Update progress and auto-save checkpoint if threshold reached."""
        if self._current_checkpoint is None:
            self._current_checkpoint = Checkpoint(
                scraper_id=scraper_id,
                source_name=source_name,
                timestamp=datetime.utcnow().isoformat(),
                progress=progress or {},
                last_processed_id=last_processed_id,
                items_processed=items_processed,
                items_failed=items_failed,
                metadata=metadata or {}
            )
        else:
            if last_processed_id:
                self._current_checkpoint.last_processed_id = last_processed_id
            self._current_checkpoint.items_processed = items_processed
            self._current_checkpoint.items_failed = items_failed
            if progress:
                self._current_checkpoint.progress.update(progress)
            if metadata:
                self._current_checkpoint.metadata.update(metadata)

        self._items_since_save += 1

        # Auto-save if threshold reached
        if self._items_since_save >= self._auto_save_interval:
            self.save(self._current_checkpoint)

    def should_skip(self, item_id: str) -> bool:
        """Check if an item was already processed (based on checkpoint)."""
        if not self._current_checkpoint:
            return False

        last_id = self._current_checkpoint.last_processed_id
        if not last_id:
            return False

        # Simple string comparison - may need customization per scraper
        return item_id <= last_id

    def list_checkpoints(self) -> List[Dict[str, Any]]:
        """List all existing checkpoints."""
        checkpoints = []
        for path in self.checkpoint_dir.glob('*.checkpoint.json'):
            try:
                with open(path, 'r') as f:
                    data = json.load(f)
                data['_path'] = str(path)
                checkpoints.append(data)
            except Exception:
                pass
        return checkpoints


@dataclass
class DeadLetterItem:
    """An item that failed processing and is in the dead letter queue."""
    item_id: str
    item_data: Any
    error_records: List[ErrorRecord]
    first_failed: str
    last_failed: str
    retry_count: int
    source_name: str
    scraper_id: str

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data['error_records'] = [e.to_dict() if hasattr(e, 'to_dict') else e for e in self.error_records]
        return data


class DeadLetterQueue:
    """Tracks failed items for later replay or manual inspection."""

    def __init__(self, storage_path: Optional[str] = None, max_items: int = 10000):
        _default_dlq = Path(__file__).resolve().parent.parent / '.scraper_state' / 'dlq'
        self.storage_path = Path(storage_path or os.environ.get(
            'SCRAPER_DLQ_PATH', str(_default_dlq)
        ))
        try:
            self.storage_path.mkdir(parents=True, exist_ok=True)
        except Exception:
            self.storage_path = _default_dlq
            self.storage_path.mkdir(parents=True, exist_ok=True)
        self.max_items = max_items
        self._items: Dict[str, DeadLetterItem] = {}
        self._lock = threading.Lock()
        self._load_from_disk()

    def _dlq_file(self) -> Path:
        return self.storage_path / 'dead_letter_queue.json'

    def _load_from_disk(self) -> None:
        """Load DLQ from disk on initialization."""
        dlq_file = self._dlq_file()
        if dlq_file.exists():
            try:
                with open(dlq_file, 'r') as f:
                    data = json.load(f)
                for item_id, item_data in data.items():
                    # Convert error_records back to ErrorRecord objects
                    error_records = [
                        ErrorRecord(**er) if isinstance(er, dict) else er
                        for er in item_data.get('error_records', [])
                    ]
                    item_data['error_records'] = error_records
                    self._items[item_id] = DeadLetterItem(**item_data)
                logger.info(f"Loaded {len(self._items)} items from DLQ")
            except Exception as e:
                logger.warning(f"Failed to load DLQ: {e}")

    def _save_to_disk(self) -> None:
        """Persist DLQ to disk."""
        dlq_file = self._dlq_file()
        temp_file = dlq_file.with_suffix('.tmp')

        with open(temp_file, 'w') as f:
            json.dump({k: v.to_dict() for k, v in self._items.items()}, f, indent=2)
        temp_file.rename(dlq_file)

    def _generate_id(self, item_data: Any, source_name: str) -> str:
        """Generate a unique ID for an item."""
        content = json.dumps(item_data, sort_keys=True, default=str)
        return hashlib.sha256(f"{source_name}:{content}".encode()).hexdigest()[:16]

    def add(self, item_data: Any, error: Exception, source_name: str,
            scraper_id: str, item_id: Optional[str] = None) -> str:
        """Add a failed item to the dead letter queue."""
        with self._lock:
            if item_id is None:
                item_id = self._generate_id(item_data, source_name)

            now = datetime.utcnow().isoformat()
            error_record = ErrorRecord.from_exception(error, context={'item_id': item_id})

            if item_id in self._items:
                # Update existing item
                item = self._items[item_id]
                item.error_records.append(error_record)
                item.last_failed = now
                item.retry_count += 1
            else:
                # Create new item
                if len(self._items) >= self.max_items:
                    # Remove oldest items to make room
                    oldest = sorted(self._items.items(),
                                   key=lambda x: x[1].first_failed)[:len(self._items) // 10]
                    for old_id, _ in oldest:
                        del self._items[old_id]

                self._items[item_id] = DeadLetterItem(
                    item_id=item_id,
                    item_data=item_data,
                    error_records=[error_record],
                    first_failed=now,
                    last_failed=now,
                    retry_count=1,
                    source_name=source_name,
                    scraper_id=scraper_id
                )

            self._save_to_disk()
            return item_id

    def remove(self, item_id: str) -> bool:
        """Remove an item from the DLQ (after successful replay)."""
        with self._lock:
            if item_id in self._items:
                del self._items[item_id]
                self._save_to_disk()
                return True
            return False

    def get(self, item_id: str) -> Optional[DeadLetterItem]:
        """Get a specific item from the DLQ."""
        with self._lock:
            return self._items.get(item_id)

    def list_items(self, source_name: Optional[str] = None,
                   max_retries: Optional[int] = None,
                   limit: int = 100) -> List[DeadLetterItem]:
        """List items in the DLQ with optional filtering."""
        with self._lock:
            items = list(self._items.values())

            if source_name:
                items = [i for i in items if i.source_name == source_name]

            if max_retries is not None:
                items = [i for i in items if i.retry_count <= max_retries]

            # Sort by last_failed (oldest first for replay)
            items.sort(key=lambda x: x.last_failed)

            return items[:limit]

    def get_replay_batch(self, source_name: str, batch_size: int = 10,
                         max_retries: int = 5) -> List[DeadLetterItem]:
        """Get a batch of items ready for replay."""
        return self.list_items(
            source_name=source_name,
            max_retries=max_retries,
            limit=batch_size
        )

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._items)

    def stats(self) -> Dict[str, Any]:
        """Get statistics about the DLQ."""
        with self._lock:
            if not self._items:
                return {'total': 0}

            by_source = {}
            by_error_type = {}
            total_retries = 0

            for item in self._items.values():
                by_source[item.source_name] = by_source.get(item.source_name, 0) + 1
                total_retries += item.retry_count

                for er in item.error_records:
                    error_type = er.error_type if isinstance(er, ErrorRecord) else er.get('error_type', 'unknown')
                    by_error_type[error_type] = by_error_type.get(error_type, 0) + 1

            return {
                'total': len(self._items),
                'by_source': by_source,
                'by_error_type': by_error_type,
                'avg_retries': total_retries / len(self._items) if self._items else 0,
            }


class GracefulDegrader:
    """Implements graceful degradation and fallback strategies."""

    def __init__(self,
                 failure_threshold: int = 5,
                 failure_window_seconds: int = 60,
                 cooldown_seconds: int = 300):
        self.failure_threshold = failure_threshold
        self.failure_window = timedelta(seconds=failure_window_seconds)
        self.cooldown = timedelta(seconds=cooldown_seconds)

        self._source_failures: Dict[str, List[datetime]] = {}
        self._circuit_open: Dict[str, datetime] = {}
        self._fallback_handlers: Dict[str, Callable[[], Any]] = {}
        self._lock = threading.Lock()

    def register_fallback(self, source_name: str, fallback: Callable[[], Any]) -> None:
        """Register a fallback handler for a source."""
        self._fallback_handlers[source_name] = fallback

    def record_failure(self, source_name: str) -> None:
        """Record a failure for a source."""
        with self._lock:
            now = datetime.utcnow()

            if source_name not in self._source_failures:
                self._source_failures[source_name] = []

            # Add failure and clean old ones
            self._source_failures[source_name].append(now)
            cutoff = now - self.failure_window
            self._source_failures[source_name] = [
                t for t in self._source_failures[source_name] if t > cutoff
            ]

            # Check if we should open the circuit
            if len(self._source_failures[source_name]) >= self.failure_threshold:
                self._circuit_open[source_name] = now
                logger.warning(
                    f"Circuit breaker opened for {source_name}: "
                    f"{len(self._source_failures[source_name])} failures in window"
                )

    def record_success(self, source_name: str) -> None:
        """Record a success, which can help close the circuit."""
        with self._lock:
            # Clear failures on success
            self._source_failures[source_name] = []

            # Close circuit if it was open
            if source_name in self._circuit_open:
                del self._circuit_open[source_name]
                logger.info(f"Circuit breaker closed for {source_name}")

    def is_available(self, source_name: str) -> bool:
        """Check if a source is available (circuit not open)."""
        with self._lock:
            if source_name not in self._circuit_open:
                return True

            # Check if cooldown has passed
            opened_at = self._circuit_open[source_name]
            if datetime.utcnow() - opened_at > self.cooldown:
                # Half-open: allow one request through
                del self._circuit_open[source_name]
                return True

            return False

    def execute_with_fallback(self, source_name: str,
                               primary: Callable[[], T],
                               fallback: Optional[Callable[[], T]] = None) -> T:
        """Execute a function with automatic fallback on failure or circuit open."""
        fallback = fallback or self._fallback_handlers.get(source_name)

        if not self.is_available(source_name):
            if fallback:
                logger.info(f"Circuit open for {source_name}, using fallback")
                return fallback()
            raise CircuitOpenError(f"Circuit breaker is open for {source_name}")

        try:
            result = primary()
            self.record_success(source_name)
            return result
        except Exception as e:
            self.record_failure(source_name)

            if fallback:
                logger.warning(f"Primary failed for {source_name}, using fallback: {e}")
                return fallback()
            raise

    def get_status(self) -> Dict[str, Any]:
        """Get the status of all monitored sources."""
        with self._lock:
            status = {}
            now = datetime.utcnow()

            all_sources = set(self._source_failures.keys()) | set(self._circuit_open.keys())

            for source in all_sources:
                failures = self._source_failures.get(source, [])
                circuit_opened = self._circuit_open.get(source)

                if circuit_opened:
                    time_left = (circuit_opened + self.cooldown - now).total_seconds()
                    status[source] = {
                        'status': 'circuit_open',
                        'recent_failures': len(failures),
                        'cooldown_remaining': max(0, time_left),
                    }
                else:
                    status[source] = {
                        'status': 'healthy' if len(failures) < self.failure_threshold // 2 else 'degraded',
                        'recent_failures': len(failures),
                    }

            return status


class CircuitOpenError(Exception):
    """Raised when trying to access a source with an open circuit breaker."""
    pass


class ScraperErrorHandler:
    """Unified error handling for scrapers - combines all error management components."""

    def __init__(self,
                 scraper_id: str,
                 checkpoint_dir: Optional[str] = None,
                 dlq_path: Optional[str] = None,
                 retry_config: Optional[RetryConfig] = None):
        self.scraper_id = scraper_id
        self.retry_manager = RetryManager(retry_config)
        self.checkpoint_manager = CheckpointManager(checkpoint_dir)
        self.dlq = DeadLetterQueue(dlq_path)
        self.degrader = GracefulDegrader()

        self._stats = {
            'items_processed': 0,
            'items_failed': 0,
            'items_skipped': 0,
        }

    def process_item(self,
                     item_data: Any,
                     processor: Callable[[Any], T],
                     source_name: str,
                     item_id: Optional[str] = None) -> Optional[T]:
        """Process a single item with full error handling."""
        # Generate item ID if not provided
        if item_id is None:
            item_id = hashlib.sha256(
                json.dumps(item_data, sort_keys=True, default=str).encode()
            ).hexdigest()[:16]

        # Check if already processed (via checkpoint)
        if self.checkpoint_manager.should_skip(item_id):
            self._stats['items_skipped'] += 1
            return None

        # Check if source is available (circuit breaker)
        if not self.degrader.is_available(source_name):
            logger.warning(f"Skipping {item_id}: circuit open for {source_name}")
            self._stats['items_skipped'] += 1
            return None

        try:
            # Execute with retry
            result = self.retry_manager.execute(
                lambda: processor(item_data),
                on_retry=lambda e, count: logger.warning(
                    f"Retry {count} for item {item_id}: {e}"
                )
            )

            self._stats['items_processed'] += 1
            self.degrader.record_success(source_name)

            # Update checkpoint
            self.checkpoint_manager.update_progress(
                scraper_id=self.scraper_id,
                source_name=source_name,
                last_processed_id=item_id,
                items_processed=self._stats['items_processed'],
                items_failed=self._stats['items_failed']
            )

            return result

        except Exception as e:
            self._stats['items_failed'] += 1
            self.degrader.record_failure(source_name)

            # Add to DLQ for later replay
            self.dlq.add(
                item_data=item_data,
                error=e,
                source_name=source_name,
                scraper_id=self.scraper_id,
                item_id=item_id
            )

            logger.error(f"Failed to process item {item_id}: {e}")
            return None

    def process_batch(self,
                      items: List[Any],
                      processor: Callable[[Any], T],
                      source_name: str,
                      id_extractor: Optional[Callable[[Any], str]] = None) -> List[T]:
        """Process a batch of items with full error handling."""
        results = []

        for item in items:
            item_id = id_extractor(item) if id_extractor else None
            result = self.process_item(item, processor, source_name, item_id)
            if result is not None:
                results.append(result)

        return results

    def replay_failed(self,
                      processor: Callable[[Any], T],
                      source_name: str,
                      batch_size: int = 10,
                      max_retries: int = 5) -> List[T]:
        """Replay failed items from the DLQ."""
        items = self.dlq.get_replay_batch(source_name, batch_size, max_retries)
        results = []

        for item in items:
            try:
                result = processor(item.item_data)
                results.append(result)
                self.dlq.remove(item.item_id)
                logger.info(f"Successfully replayed item {item.item_id}")
            except Exception as e:
                self.dlq.add(
                    item_data=item.item_data,
                    error=e,
                    source_name=source_name,
                    scraper_id=self.scraper_id,
                    item_id=item.item_id
                )
                logger.warning(f"Replay failed for item {item.item_id}: {e}")

        return results

    def finish(self, source_name: str, success: bool = True) -> None:
        """Call when scraping is complete."""
        if success:
            self.checkpoint_manager.clear(self.scraper_id, source_name)
            logger.info(f"Scraping complete: {self._stats}")
        else:
            # Save final checkpoint for resume
            self.checkpoint_manager.save(Checkpoint(
                scraper_id=self.scraper_id,
                source_name=source_name,
                timestamp=datetime.utcnow().isoformat(),
                progress={'status': 'incomplete'},
                items_processed=self._stats['items_processed'],
                items_failed=self._stats['items_failed']
            ))
            logger.warning(f"Scraping incomplete: {self._stats}")

    @property
    def stats(self) -> Dict[str, Any]:
        return {
            **self._stats,
            'retry_stats': self.retry_manager.stats,
            'dlq_size': self.dlq.size,
            'degrader_status': self.degrader.get_status(),
        }


# Convenience decorators
def with_retry(max_retries: int = 3, base_delay: float = 1.0):
    """Decorator for automatic retry with exponential backoff."""
    manager = RetryManager(RetryConfig(max_retries=max_retries, base_delay=base_delay))
    return manager.decorator()


# Export all public classes
__all__ = [
    'ErrorType',
    'ErrorRecord',
    'ErrorClassifier',
    'RetryConfig',
    'RetryManager',
    'Checkpoint',
    'CheckpointManager',
    'DeadLetterItem',
    'DeadLetterQueue',
    'GracefulDegrader',
    'CircuitOpenError',
    'ScraperErrorHandler',
    'with_retry',
]
