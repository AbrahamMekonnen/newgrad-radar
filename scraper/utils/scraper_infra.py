"""
Unified Scraper Infrastructure Module

Provides easy access to all production-grade scraping utilities:
- GeoProxySelector: Auto-selects regional proxies
- ResponseCache: HTTP response caching with TTL
- ValidationPipeline: Data quality validation
- BatchTranslator: Efficient translation with caching
- StealthSession: Anti-detection with fingerprint rotation
- AdaptiveRateLimiter: Smart rate limiting with backoff
"""

import os
from typing import Optional, Dict, Any, List
from datetime import datetime

# Lazy imports to avoid circular dependencies
_cache = None
_proxy_selector = None
_rate_limiter = None
_validation_pipeline = None


def get_cache(ttl: int = 21600, cache_dir: str = ".scraper_cache", **_kwargs):
    """Get or create ResponseCache singleton.

    Extra kwargs (e.g. ttl_hours) from various callers are accepted and
    ignored for backward compatibility.
    """
    global _cache
    if "ttl_hours" in _kwargs and _kwargs.get("ttl_hours"):
        try:
            ttl = int(_kwargs["ttl_hours"]) * 3600
        except (ValueError, TypeError):
            pass
    if _cache is None:
        try:
            from .cache import ResponseCache
            # ResponseCache takes (base_dir, shard_count); ttl is applied
            # per-entry on set(), not in the constructor.
            _cache = ResponseCache()
        except (ImportError, Exception):
            _cache = _FallbackCache()
    return _cache


def get_proxy_selector():
    """Get or create GeoProxySelector singleton."""
    global _proxy_selector
    if _proxy_selector is None:
        try:
            from .proxy_manager import GeoProxySelector
            _proxy_selector = GeoProxySelector()
        except ImportError:
            _proxy_selector = _FallbackProxySelector()
    return _proxy_selector


def get_rate_limiter(domain: str = "default"):
    """Get rate limiter for a specific domain."""
    global _rate_limiter
    if _rate_limiter is None:
        try:
            from .rate_limiter import DomainThrottler
            _rate_limiter = DomainThrottler()
        except ImportError:
            _rate_limiter = _FallbackRateLimiter()
    return _rate_limiter


def get_validation_pipeline(min_quality: float = 0.4):
    """Get or create ValidationPipeline singleton."""
    global _validation_pipeline
    if _validation_pipeline is None:
        try:
            from .validation import ValidationPipeline
            _validation_pipeline = ValidationPipeline(min_quality_score=min_quality)
        except ImportError:
            _validation_pipeline = _FallbackValidation()
    return _validation_pipeline


def translate_batch(texts: List[str], target_lang: str = "en") -> List[str]:
    """Translate a batch of texts efficiently.

    Uses BatchTranslator with caching for efficiency.
    """
    if not texts:
        return []

    try:
        from .translation import translate_batch as _translate_batch
        return _translate_batch(texts, target_lang)
    except ImportError:
        # Fallback: return original texts with language marker
        return [f"[{target_lang}] {t}" if _has_non_latin(t) else t for t in texts]


def translate_single(text: str, target_lang: str = "en") -> str:
    """Translate a single text with caching."""
    if not text:
        return text

    results = translate_batch([text], target_lang)
    return results[0] if results else text


def _has_non_latin(text: str) -> bool:
    """Check if text contains non-Latin characters."""
    import re
    return bool(re.search(r'[^\x00-\x7F]', text))


def get_stealth_headers(url: str = "") -> Dict[str, str]:
    """Get anti-detection headers for a URL."""
    try:
        from .anti_detection import create_stealth_session
        session = create_stealth_session()
        config = session.get_request_config(url)
        return config.get('headers', _default_headers())
    except ImportError:
        return _default_headers()


def _default_headers() -> Dict[str, str]:
    """Default browser-like headers."""
    return {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }


def get_proxy_for_url(url: str) -> Optional[Dict[str, str]]:
    """Get appropriate proxy for a URL based on its region."""
    selector = get_proxy_selector()
    proxy = selector.get_proxy_for_url(url)
    if proxy:
        return {"http": proxy, "https": proxy}
    return None


def validate_question(question_data: Dict[str, Any]) -> tuple[bool, Dict[str, Any], List[str]]:
    """Validate a scraped interview question.

    Returns:
        (is_valid, cleaned_data, errors)
    """
    pipeline = get_validation_pipeline()
    result = pipeline.validate(question_data)
    return result.is_valid, result.cleaned_data, result.errors


def validate_batch(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Validate and clean a batch of questions, returning only valid ones."""
    pipeline = get_validation_pipeline()
    valid_questions = []

    for q in questions:
        result = pipeline.validate(q)
        if result.is_valid:
            valid_questions.append(result.cleaned_data)

    return valid_questions


def cached_request(url: str, fetch_fn, ttl: int = 21600) -> Optional[str]:
    """Make a cached HTTP request.

    Args:
        url: URL to fetch
        fetch_fn: Function that takes URL and returns response text
        ttl: Cache TTL in seconds

    Returns:
        Response text or None
    """
    cache = get_cache(ttl=ttl)

    # Check cache first. ResponseCache.get() returns a CachedResponse object,
    # so unwrap it to the text/body the callers expect.
    cached = cache.get(url)
    if cached:
        content = getattr(cached, "content", cached)
        if isinstance(content, (bytes, bytearray)):
            try:
                content = content.decode("utf-8", "ignore")
            except Exception:
                pass
        return content

    # Fetch and cache
    try:
        response = fetch_fn(url)
        if response:
            cache.set(url, response)
        return response
    except Exception:
        return None


def wait_for_rate_limit(domain: str):
    """Wait for rate limit before making a request."""
    import time
    limiter = get_rate_limiter(domain)
    delay = limiter.get_delay(domain)
    if delay > 0:
        time.sleep(delay)


class InfrastructureContext:
    """Context manager for scraper infrastructure.

    Usage:
        with InfrastructureContext(source="habr.com", region="ru") as ctx:
            response = ctx.fetch(url)
            validated = ctx.validate(question_data)
    """

    def __init__(self, source: str, region: str = "us", ttl: int = 21600):
        self.source = source
        self.region = region
        self.ttl = ttl
        self._session = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def get_headers(self) -> Dict[str, str]:
        """Get stealth headers."""
        return get_stealth_headers(f"https://{self.source}")

    def get_proxy(self) -> Optional[Dict[str, str]]:
        """Get regional proxy."""
        return get_proxy_for_url(f"https://{self.source}")

    def fetch(self, url: str, fetch_fn=None) -> Optional[str]:
        """Fetch with caching and rate limiting."""
        wait_for_rate_limit(self.source)

        if fetch_fn:
            return cached_request(url, fetch_fn, self.ttl)

        # Default fetch
        import requests
        try:
            response = requests.get(
                url,
                headers=self.get_headers(),
                proxies=self.get_proxy(),
                timeout=30,
                verify=True
            )
            response.raise_for_status()
            return response.text
        except Exception:
            return None

    def validate(self, question_data: Dict[str, Any]) -> tuple[bool, Dict[str, Any], List[str]]:
        """Validate question data."""
        return validate_question(question_data)

    def translate(self, text: str, target: str = "en") -> str:
        """Translate text."""
        return translate_single(text, target)

    def translate_batch(self, texts: List[str], target: str = "en") -> List[str]:
        """Translate texts in batch."""
        return translate_batch(texts, target)


# Fallback implementations for when modules aren't available

class _FallbackCache:
    """In-memory cache fallback."""
    def __init__(self):
        self._cache = {}

    def get(self, key: str):
        return self._cache.get(key)

    def set(self, key: str, value: str):
        self._cache[key] = value


class _FallbackProxySelector:
    """No-op proxy selector fallback."""
    def get_proxy_for_url(self, url: str):
        return None


class _FallbackRateLimiter:
    """Simple delay-based rate limiter fallback."""
    def get_delay(self, domain: str) -> float:
        return 1.0


class _FallbackValidation:
    """Pass-through validation fallback."""
    class Result:
        def __init__(self, data):
            self.is_valid = True
            self.cleaned_data = data
            self.errors = []

    def validate(self, data):
        return self.Result(data)


# Export convenience functions
__all__ = [
    'get_cache',
    'get_proxy_selector',
    'get_rate_limiter',
    'get_validation_pipeline',
    'translate_batch',
    'translate_single',
    'get_stealth_headers',
    'get_proxy_for_url',
    'validate_question',
    'validate_batch',
    'cached_request',
    'wait_for_rate_limit',
    'InfrastructureContext',
]
