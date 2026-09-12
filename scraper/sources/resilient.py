"""Resilient source wrapper - ensures no source can crash the pipeline.

Provides error handling and optional integration with infrastructure monitoring.
"""

import traceback
from typing import Callable, Any, Optional
from functools import wraps

# =============================================================================
# Infrastructure Integration
# =============================================================================

INFRA_AVAILABLE = False
HAS_MONITORING = False

try:
    from scraper.utils.monitoring import monitor_scraper, get_monitoring
    HAS_MONITORING = True
    INFRA_AVAILABLE = True
except ImportError:
    try:
        from utils.monitoring import monitor_scraper, get_monitoring
        HAS_MONITORING = True
        INFRA_AVAILABLE = True
    except ImportError:
        pass

try:
    from scraper.utils.error_handler import RetryManager, RetryConfig
    HAS_RETRY = True
except ImportError:
    try:
        from utils.error_handler import RetryManager, RetryConfig
        HAS_RETRY = True
    except ImportError:
        HAS_RETRY = False


class SourceError:
    """Captures error info without stopping the pipeline."""

    def __init__(self, source_name: str, error: Exception):
        self.source_name = source_name
        self.error = error
        self.traceback = traceback.format_exc()

    def __str__(self):
        return f"{self.source_name}: {type(self.error).__name__}: {self.error}"


def safe_fetch(source_name: str, fetch_fn: Callable[[], list[dict]], default: list = None,
                use_monitoring: bool = True, max_retries: int = 0) -> tuple[list[dict], SourceError | None]:
    """Safely fetch from a source, catching ALL exceptions.

    Args:
        source_name: Name of the source for logging
        fetch_fn: Function that returns list of jobs
        default: Default return value on error (empty list)
        use_monitoring: Whether to use infrastructure monitoring if available
        max_retries: Number of retries (0 = no retries, requires infrastructure)

    Returns:
        Tuple of (jobs list, error or None)
    """
    if default is None:
        default = []

    # Wrap with retry if available and requested
    actual_fn = fetch_fn
    if max_retries > 0 and HAS_RETRY:
        retry_mgr = RetryManager(RetryConfig(max_retries=max_retries, base_delay=1.0))
        actual_fn = lambda: retry_mgr.execute(fetch_fn)

    # Use monitoring context if available
    ctx = None
    if use_monitoring and HAS_MONITORING:
        ctx = monitor_scraper(source_name)

    try:
        if ctx:
            ctx.__enter__()

        result = actual_fn()
        if result is None:
            return default, None

        # Record success metrics
        if ctx:
            ctx.record_questions(extracted=len(result), new=len(result))

        return result, None
    except KeyboardInterrupt:
        raise  # Allow Ctrl+C to stop
    except Exception as e:
        error = SourceError(source_name, e)
        print(f"  [WARN] {source_name} failed: {e}")
        return default, error
    finally:
        if ctx:
            ctx.__exit__(None, None, None)


def resilient_source(name: str = None):
    """Decorator to make any source function resilient.

    Usage:
        @resilient_source("adzuna")
        def fetch_adzuna():
            ...

    The decorated function will:
    - Never raise exceptions (returns empty list on error)
    - Log errors but continue
    - Return empty list if None is returned
    """
    def decorator(fn: Callable) -> Callable:
        source_name = name or fn.__name__

        @wraps(fn)
        def wrapper(*args, **kwargs) -> list[dict]:
            try:
                result = fn(*args, **kwargs)
                return result if result is not None else []
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"  [WARN] {source_name} failed: {type(e).__name__}: {e}")
                return []

        return wrapper
    return decorator


def run_sources_safely(sources: dict[str, Callable[[], list[dict]]],
                       use_monitoring: bool = True) -> tuple[list[dict], dict[str, SourceError]]:
    """Run multiple sources safely, collecting all results and errors.

    Args:
        sources: Dict mapping source name to fetch function
        use_monitoring: Whether to use infrastructure monitoring if available

    Returns:
        Tuple of (all jobs combined, dict of source errors)
    """
    all_jobs = []
    errors = {}

    # Use overall monitoring context if available
    overall_ctx = None
    if use_monitoring and HAS_MONITORING:
        overall_ctx = monitor_scraper("multi_source_fetch")

    try:
        if overall_ctx:
            overall_ctx.__enter__()

        for source_name, fetch_fn in sources.items():
            # Pass use_monitoring=False to avoid double monitoring
            jobs, error = safe_fetch(source_name, fetch_fn, use_monitoring=False)

            if jobs:
                print(f"  {source_name}: {len(jobs)} jobs")
                all_jobs.extend(jobs)
            elif error:
                errors[source_name] = error
                print(f"  {source_name}: FAILED - {error.error}")
            else:
                print(f"  {source_name}: 0 jobs")

        # Record overall metrics
        if overall_ctx:
            overall_ctx.record_questions(extracted=len(all_jobs), new=len(all_jobs))

        return all_jobs, errors

    finally:
        if overall_ctx:
            overall_ctx.__exit__(None, None, None)


def check_api_key(key_name: str, key_value: str | None, source_name: str) -> bool:
    """Check if an API key is set, log warning if not.

    Args:
        key_name: Name of the environment variable
        key_value: The value of the key (or None)
        source_name: Name of the source for logging

    Returns:
        True if key is set, False otherwise
    """
    if not key_value:
        print(f"  [SKIP] {source_name}: {key_name} not set (add to .env or GitHub Secrets)")
        return False
    return True
