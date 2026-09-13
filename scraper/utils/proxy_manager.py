"""
Production-grade proxy rotation system for interview question scrapers.

Supports:
- Multiple proxy providers (BrightData, Oxylabs, SmartProxy, free proxies)
- Residential vs datacenter proxy selection
- Geo-targeting for regional sites (China, Korea, Japan, India, Russia, etc.)
- Health checking with automatic failover
- Cost optimization with tiered proxy selection
- Rate limiting and cooldown management

Environment Variables:
    BRIGHTDATA_USERNAME: BrightData account username
    BRIGHTDATA_PASSWORD: BrightData account password
    BRIGHTDATA_HOST: BrightData proxy host (default: brd.superproxy.io)

    OXYLABS_USERNAME: Oxylabs account username
    OXYLABS_PASSWORD: Oxylabs account password

    SMARTPROXY_USERNAME: SmartProxy account username
    SMARTPROXY_PASSWORD: SmartProxy account password

    PROXY_POOL_FILE: Path to custom proxy list file (one proxy per line)
    PROXY_HEALTH_CHECK_INTERVAL: Seconds between health checks (default: 300)
    PROXY_MAX_FAILURES: Max failures before proxy removal (default: 3)
    PROXY_TIMEOUT: Request timeout in seconds (default: 30)
"""

import os
import time
import random
import logging
import threading
import requests
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple, Callable
from enum import Enum
from collections import defaultdict
from datetime import datetime, timedelta
from urllib.parse import urlparse
import hashlib
import json

logger = logging.getLogger(__name__)


class ProxyType(Enum):
    """Proxy type classification."""
    RESIDENTIAL = "residential"
    DATACENTER = "datacenter"
    MOBILE = "mobile"
    ISP = "isp"
    FREE = "free"


class ProxyProvider(Enum):
    """Supported proxy providers."""
    BRIGHTDATA = "brightdata"
    OXYLABS = "oxylabs"
    SMARTPROXY = "smartproxy"
    FREE = "free"
    CUSTOM = "custom"


class GeoRegion(Enum):
    """Geographic regions for geo-targeting."""
    US = "us"
    CHINA = "cn"
    KOREA = "kr"
    JAPAN = "jp"
    INDIA = "in"
    RUSSIA = "ru"
    UK = "gb"
    GERMANY = "de"
    BRAZIL = "br"
    GLOBAL = "global"


@dataclass
class ProxyConfig:
    """Configuration for a single proxy."""
    url: str
    provider: ProxyProvider
    proxy_type: ProxyType
    region: GeoRegion = GeoRegion.GLOBAL
    username: Optional[str] = None
    password: Optional[str] = None
    port: int = 0
    weight: float = 1.0
    cost_per_gb: float = 0.0

    # Health tracking
    failures: int = 0
    successes: int = 0
    last_used: Optional[datetime] = None
    last_check: Optional[datetime] = None
    is_healthy: bool = True
    avg_response_time: float = 0.0

    def __post_init__(self):
        if self.port == 0:
            parsed = urlparse(self.url)
            self.port = parsed.port or 80

    @property
    def success_rate(self) -> float:
        total = self.failures + self.successes
        return self.successes / total if total > 0 else 1.0

    @property
    def proxy_dict(self) -> Dict[str, str]:
        """Return proxy dict for requests library."""
        if self.username and self.password:
            parsed = urlparse(self.url)
            auth_url = f"{parsed.scheme}://{self.username}:{self.password}@{parsed.netloc}"
            return {"http": auth_url, "https": auth_url}
        return {"http": self.url, "https": self.url}

    def record_success(self, response_time: float):
        self.successes += 1
        self.last_used = datetime.now()
        # Exponential moving average for response time
        alpha = 0.3
        self.avg_response_time = alpha * response_time + (1 - alpha) * self.avg_response_time

    def record_failure(self):
        self.failures += 1
        self.last_used = datetime.now()


class ProxyHealthChecker:
    """Monitors proxy health and manages failover."""

    # Test endpoints for different regions
    TEST_ENDPOINTS = {
        GeoRegion.US: "https://httpbin.org/ip",
        GeoRegion.CHINA: "https://www.baidu.com",
        GeoRegion.KOREA: "https://www.naver.com",
        GeoRegion.JAPAN: "https://www.yahoo.co.jp",
        GeoRegion.INDIA: "https://www.google.co.in",
        GeoRegion.RUSSIA: "https://ya.ru",
        GeoRegion.UK: "https://www.bbc.co.uk",
        GeoRegion.GERMANY: "https://www.google.de",
        GeoRegion.BRAZIL: "https://www.google.com.br",
        GeoRegion.GLOBAL: "https://httpbin.org/ip",
    }

    def __init__(
        self,
        check_interval: int = 300,
        max_failures: int = 3,
        timeout: int = 30,
        min_success_rate: float = 0.5,
    ):
        self.check_interval = check_interval
        self.max_failures = max_failures
        self.timeout = timeout
        self.min_success_rate = min_success_rate
        self._lock = threading.Lock()
        self._checking = False
        self._check_thread: Optional[threading.Thread] = None

    def check_proxy(self, proxy: ProxyConfig) -> Tuple[bool, float]:
        """
        Check if a proxy is healthy.
        Returns (is_healthy, response_time).
        """
        test_url = self.TEST_ENDPOINTS.get(proxy.region, self.TEST_ENDPOINTS[GeoRegion.GLOBAL])

        start = time.time()
        try:
            response = requests.get(
                test_url,
                proxies=proxy.proxy_dict,
                timeout=self.timeout,
                verify=False,  # Some proxies have cert issues
            )
            response_time = time.time() - start

            if response.status_code == 200:
                proxy.last_check = datetime.now()
                proxy.is_healthy = True
                return True, response_time
            else:
                proxy.is_healthy = False
                return False, response_time

        except Exception as e:
            logger.debug(f"Proxy health check failed for {proxy.url}: {e}")
            proxy.is_healthy = False
            return False, self.timeout

    def should_remove(self, proxy: ProxyConfig) -> bool:
        """Determine if a proxy should be removed from the pool."""
        if proxy.failures >= self.max_failures:
            return True
        if proxy.success_rate < self.min_success_rate and (proxy.failures + proxy.successes) >= 10:
            return True
        return False

    def start_background_checks(self, proxy_pool: 'ProxyPool'):
        """Start background health checking thread."""
        if self._checking:
            return

        self._checking = True

        def check_loop():
            while self._checking:
                try:
                    with self._lock:
                        for proxy in list(proxy_pool.proxies):
                            if not self._checking:
                                break
                            is_healthy, response_time = self.check_proxy(proxy)
                            if is_healthy:
                                proxy.record_success(response_time)
                            else:
                                proxy.record_failure()
                except Exception as e:
                    logger.error(f"Background health check error: {e}")

                time.sleep(self.check_interval)

        self._check_thread = threading.Thread(target=check_loop, daemon=True)
        self._check_thread.start()

    def stop_background_checks(self):
        """Stop background health checking."""
        self._checking = False
        if self._check_thread:
            self._check_thread.join(timeout=5)


class GeoProxySelector:
    """Selects optimal proxies based on geographic requirements."""

    # Domain to region mapping
    DOMAIN_REGION_MAP = {
        # Chinese sites
        "zhihu.com": GeoRegion.CHINA,
        "nowcoder.com": GeoRegion.CHINA,
        "1point3acres.com": GeoRegion.CHINA,
        "juejin.cn": GeoRegion.CHINA,
        "csdn.net": GeoRegion.CHINA,
        "bilibili.com": GeoRegion.CHINA,
        "baidu.com": GeoRegion.CHINA,
        "douban.com": GeoRegion.CHINA,
        "xiaohongshu.com": GeoRegion.CHINA,

        # Korean sites
        "programmers.co.kr": GeoRegion.KOREA,
        "jobplanet.co.kr": GeoRegion.KOREA,
        "naver.com": GeoRegion.KOREA,
        "kakao.com": GeoRegion.KOREA,

        # Japanese sites
        "qiita.com": GeoRegion.JAPAN,
        "openwork.jp": GeoRegion.JAPAN,
        "atcoder.jp": GeoRegion.JAPAN,
        "note.com": GeoRegion.JAPAN,
        "yahoo.co.jp": GeoRegion.JAPAN,
        "5ch.net": GeoRegion.JAPAN,

        # Indian sites
        "geeksforgeeks.org": GeoRegion.INDIA,
        "ambitionbox.com": GeoRegion.INDIA,
        "naukri.com": GeoRegion.INDIA,
        "prepinsta.com": GeoRegion.INDIA,

        # Russian sites
        "habr.com": GeoRegion.RUSSIA,
        "dou.ua": GeoRegion.RUSSIA,  # Ukraine, but similar
        "vk.com": GeoRegion.RUSSIA,

        # UK sites
        "wikijob.co.uk": GeoRegion.UK,
        "thestudentroom.co.uk": GeoRegion.UK,
        "glassdoor.co.uk": GeoRegion.UK,

        # German sites
        "kununu.com": GeoRegion.GERMANY,
        "glassdoor.de": GeoRegion.GERMANY,

        # Brazilian sites
        "tabnews.com.br": GeoRegion.BRAZIL,
        "glassdoor.com.br": GeoRegion.BRAZIL,
    }

    # Sites that REQUIRE local proxies (blocked outside region)
    REQUIRES_LOCAL_PROXY = {
        "zhihu.com", "bilibili.com", "douban.com", "xiaohongshu.com",  # China
        "5ch.net",  # Japan (some restrictions)
        "vk.com",  # Russia
    }

    # Sites that work better with local proxies but don't require them
    PREFERS_LOCAL_PROXY = {
        "nowcoder.com", "juejin.cn", "csdn.net", "1point3acres.com",
        "programmers.co.kr", "jobplanet.co.kr",
        "qiita.com", "openwork.jp", "note.com",
        "ambitionbox.com",
        "habr.com",
    }

    def __init__(self, proxy_pool: 'ProxyPool' = None):
        # proxy_pool is optional — callers that only need region detection
        # (not an actual proxy) construct GeoProxySelector() with no args.
        self.proxy_pool = proxy_pool

    def get_region_for_url(self, url: str) -> GeoRegion:
        """Determine required region for a URL."""
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        # Remove www prefix
        if domain.startswith("www."):
            domain = domain[4:]

        # Check for exact match or suffix match
        for pattern, region in self.DOMAIN_REGION_MAP.items():
            if domain == pattern or domain.endswith("." + pattern):
                return region

        return GeoRegion.GLOBAL

    def requires_local_proxy(self, url: str) -> bool:
        """Check if URL requires a proxy from its local region."""
        parsed = urlparse(url)
        domain = parsed.netloc.lower().replace("www.", "")

        for blocked_domain in self.REQUIRES_LOCAL_PROXY:
            if domain == blocked_domain or domain.endswith("." + blocked_domain):
                return True
        return False

    def select_proxy(self, url: str) -> Optional[ProxyConfig]:
        """Select the best proxy for a given URL."""
        region = self.get_region_for_url(url)
        requires_local = self.requires_local_proxy(url)

        # Get proxies for the region
        regional_proxies = self.proxy_pool.get_proxies_for_region(region)

        if requires_local and not regional_proxies:
            logger.warning(f"URL {url} requires {region.value} proxy but none available")
            return None

        if regional_proxies:
            return self._select_best_proxy(regional_proxies)

        # Fall back to global proxies
        global_proxies = self.proxy_pool.get_proxies_for_region(GeoRegion.GLOBAL)
        if global_proxies:
            return self._select_best_proxy(global_proxies)

        # Last resort: any healthy proxy
        return self.proxy_pool.get_best_proxy()

    def _select_best_proxy(self, proxies: List[ProxyConfig]) -> Optional[ProxyConfig]:
        """Select the best proxy from a list based on health and cost."""
        if not proxies:
            return None

        healthy = [p for p in proxies if p.is_healthy]
        if not healthy:
            healthy = proxies  # Use any if none healthy

        # Sort by: success_rate DESC, response_time ASC, cost_per_gb ASC
        healthy.sort(key=lambda p: (-p.success_rate, p.avg_response_time, p.cost_per_gb))

        # Weighted random selection from top 3 to avoid hammering one proxy
        top_n = healthy[:min(3, len(healthy))]
        weights = [p.weight * p.success_rate for p in top_n]
        total = sum(weights)
        if total == 0:
            return random.choice(top_n)

        r = random.uniform(0, total)
        cumulative = 0
        for proxy, weight in zip(top_n, weights):
            cumulative += weight
            if r <= cumulative:
                return proxy

        return top_n[0]


class ProxyPool:
    """Manages a pool of proxies with automatic refresh and cleanup."""

    def __init__(self):
        self.proxies: List[ProxyConfig] = []
        self._lock = threading.Lock()
        self._region_index: Dict[GeoRegion, List[ProxyConfig]] = defaultdict(list)
        self._provider_index: Dict[ProxyProvider, List[ProxyConfig]] = defaultdict(list)
        self._cooldown: Dict[str, datetime] = {}
        self._cooldown_duration = timedelta(seconds=60)

    def add_proxy(self, proxy: ProxyConfig):
        """Add a proxy to the pool."""
        with self._lock:
            self.proxies.append(proxy)
            self._region_index[proxy.region].append(proxy)
            self._provider_index[proxy.provider].append(proxy)

    def remove_proxy(self, proxy: ProxyConfig):
        """Remove a proxy from the pool."""
        with self._lock:
            if proxy in self.proxies:
                self.proxies.remove(proxy)
            if proxy in self._region_index[proxy.region]:
                self._region_index[proxy.region].remove(proxy)
            if proxy in self._provider_index[proxy.provider]:
                self._provider_index[proxy.provider].remove(proxy)

    def get_proxies_for_region(self, region: GeoRegion) -> List[ProxyConfig]:
        """Get all proxies for a specific region."""
        with self._lock:
            return [p for p in self._region_index[region] if p.is_healthy and not self._is_on_cooldown(p)]

    def get_best_proxy(self) -> Optional[ProxyConfig]:
        """Get the best available proxy across all regions."""
        with self._lock:
            available = [p for p in self.proxies if p.is_healthy and not self._is_on_cooldown(p)]
            if not available:
                return None

            # Sort by success rate and response time
            available.sort(key=lambda p: (-p.success_rate, p.avg_response_time))
            return available[0]

    def put_on_cooldown(self, proxy: ProxyConfig):
        """Put a proxy on cooldown after use."""
        self._cooldown[proxy.url] = datetime.now()

    def _is_on_cooldown(self, proxy: ProxyConfig) -> bool:
        """Check if a proxy is on cooldown."""
        if proxy.url not in self._cooldown:
            return False
        return datetime.now() - self._cooldown[proxy.url] < self._cooldown_duration

    def load_from_file(self, filepath: str):
        """Load proxies from a file (one proxy URL per line)."""
        try:
            with open(filepath, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        proxy = ProxyConfig(
                            url=line,
                            provider=ProxyProvider.CUSTOM,
                            proxy_type=ProxyType.DATACENTER,
                        )
                        self.add_proxy(proxy)
            logger.info(f"Loaded {len(self.proxies)} proxies from {filepath}")
        except Exception as e:
            logger.error(f"Failed to load proxies from {filepath}: {e}")

    def load_from_provider(self, provider: ProxyProvider):
        """Load proxies from a commercial provider using env vars."""
        if provider == ProxyProvider.BRIGHTDATA:
            self._load_brightdata_proxies()
        elif provider == ProxyProvider.OXYLABS:
            self._load_oxylabs_proxies()
        elif provider == ProxyProvider.SMARTPROXY:
            self._load_smartproxy_proxies()

    def _load_brightdata_proxies(self):
        """Configure BrightData proxy endpoints."""
        username = os.getenv("BRIGHTDATA_USERNAME")
        password = os.getenv("BRIGHTDATA_PASSWORD")
        host = os.getenv("BRIGHTDATA_HOST", "brd.superproxy.io")

        if not username or not password:
            logger.warning("BrightData credentials not found in environment")
            return

        # BrightData regional endpoints
        regions = {
            GeoRegion.US: "us",
            GeoRegion.CHINA: "cn",
            GeoRegion.KOREA: "kr",
            GeoRegion.JAPAN: "jp",
            GeoRegion.INDIA: "in",
            GeoRegion.RUSSIA: "ru",
            GeoRegion.UK: "gb",
            GeoRegion.GERMANY: "de",
            GeoRegion.BRAZIL: "br",
            GeoRegion.GLOBAL: "",
        }

        for geo_region, country_code in regions.items():
            # Residential proxy
            zone = f"residential{'-' + country_code if country_code else ''}"
            proxy = ProxyConfig(
                url=f"http://{host}:22225",
                provider=ProxyProvider.BRIGHTDATA,
                proxy_type=ProxyType.RESIDENTIAL,
                region=geo_region,
                username=f"{username}-zone-{zone}",
                password=password,
                cost_per_gb=8.0,  # Approximate residential cost
                weight=1.0,
            )
            self.add_proxy(proxy)

            # Datacenter proxy (cheaper, for non-blocked sites)
            if country_code:
                dc_proxy = ProxyConfig(
                    url=f"http://{host}:22225",
                    provider=ProxyProvider.BRIGHTDATA,
                    proxy_type=ProxyType.DATACENTER,
                    region=geo_region,
                    username=f"{username}-zone-datacenter-{country_code}",
                    password=password,
                    cost_per_gb=0.5,
                    weight=0.8,  # Slightly lower weight
                )
                self.add_proxy(dc_proxy)

        logger.info(f"Loaded BrightData proxies for {len(regions)} regions")

    def _load_oxylabs_proxies(self):
        """Configure Oxylabs proxy endpoints."""
        username = os.getenv("OXYLABS_USERNAME")
        password = os.getenv("OXYLABS_PASSWORD")

        if not username or not password:
            logger.warning("Oxylabs credentials not found in environment")
            return

        regions = {
            GeoRegion.US: "us",
            GeoRegion.CHINA: "cn",
            GeoRegion.KOREA: "kr",
            GeoRegion.JAPAN: "jp",
            GeoRegion.INDIA: "in",
            GeoRegion.RUSSIA: "ru",
            GeoRegion.UK: "gb",
            GeoRegion.GERMANY: "de",
            GeoRegion.BRAZIL: "br",
            GeoRegion.GLOBAL: "",
        }

        for geo_region, country_code in regions.items():
            # Residential endpoint
            user_with_geo = f"customer-{username}-cc-{country_code}" if country_code else f"customer-{username}"
            proxy = ProxyConfig(
                url="http://pr.oxylabs.io:7777",
                provider=ProxyProvider.OXYLABS,
                proxy_type=ProxyType.RESIDENTIAL,
                region=geo_region,
                username=user_with_geo,
                password=password,
                cost_per_gb=10.0,
                weight=1.0,
            )
            self.add_proxy(proxy)

        logger.info(f"Loaded Oxylabs proxies for {len(regions)} regions")

    def _load_smartproxy_proxies(self):
        """Configure SmartProxy endpoints."""
        username = os.getenv("SMARTPROXY_USERNAME")
        password = os.getenv("SMARTPROXY_PASSWORD")

        if not username or not password:
            logger.warning("SmartProxy credentials not found in environment")
            return

        regions = {
            GeoRegion.US: "us",
            GeoRegion.CHINA: "cn",
            GeoRegion.KOREA: "kr",
            GeoRegion.JAPAN: "jp",
            GeoRegion.INDIA: "in",
            GeoRegion.RUSSIA: "ru",
            GeoRegion.UK: "gb",
            GeoRegion.GERMANY: "de",
            GeoRegion.BRAZIL: "br",
            GeoRegion.GLOBAL: "",
        }

        for geo_region, country_code in regions.items():
            gate_host = f"{country_code}.smartproxy.com" if country_code else "gate.smartproxy.com"
            proxy = ProxyConfig(
                url=f"http://{gate_host}:7000",
                provider=ProxyProvider.SMARTPROXY,
                proxy_type=ProxyType.RESIDENTIAL,
                region=geo_region,
                username=username,
                password=password,
                cost_per_gb=7.0,
                weight=1.0,
            )
            self.add_proxy(proxy)

        logger.info(f"Loaded SmartProxy proxies for {len(regions)} regions")

    def get_stats(self) -> Dict:
        """Get pool statistics."""
        with self._lock:
            total = len(self.proxies)
            healthy = sum(1 for p in self.proxies if p.is_healthy)
            by_region = {r.value: len(proxies) for r, proxies in self._region_index.items()}
            by_provider = {p.value: len(proxies) for p, proxies in self._provider_index.items()}

            return {
                "total": total,
                "healthy": healthy,
                "by_region": by_region,
                "by_provider": by_provider,
            }


class ProxyRotator:
    """
    Main interface for proxy rotation with automatic selection and failover.

    Usage:
        rotator = ProxyRotator()
        rotator.initialize()  # Load proxies from env vars

        # Get proxy for a specific URL
        proxy = rotator.get_proxy_for_url("https://zhihu.com/question/123")
        response = requests.get(url, proxies=proxy.proxy_dict)

        # Report success/failure
        rotator.report_success(proxy)
        # or
        rotator.report_failure(proxy)
    """

    def __init__(
        self,
        enable_health_checks: bool = True,
        health_check_interval: int = 300,
        max_failures: int = 3,
        timeout: int = 30,
        use_cost_optimization: bool = True,
    ):
        self.pool = ProxyPool()
        self.health_checker = ProxyHealthChecker(
            check_interval=health_check_interval,
            max_failures=max_failures,
            timeout=timeout,
        )
        self.geo_selector = GeoProxySelector(self.pool)
        self.enable_health_checks = enable_health_checks
        self.use_cost_optimization = use_cost_optimization
        self._initialized = False

    def initialize(self):
        """Initialize the rotator by loading proxies from all configured sources."""
        if self._initialized:
            return

        # Load from commercial providers if configured
        if os.getenv("BRIGHTDATA_USERNAME"):
            self.pool.load_from_provider(ProxyProvider.BRIGHTDATA)

        if os.getenv("OXYLABS_USERNAME"):
            self.pool.load_from_provider(ProxyProvider.OXYLABS)

        if os.getenv("SMARTPROXY_USERNAME"):
            self.pool.load_from_provider(ProxyProvider.SMARTPROXY)

        # Load custom proxy list if configured
        proxy_file = os.getenv("PROXY_POOL_FILE")
        if proxy_file and os.path.exists(proxy_file):
            self.pool.load_from_file(proxy_file)

        # Start background health checks
        if self.enable_health_checks and len(self.pool.proxies) > 0:
            self.health_checker.start_background_checks(self.pool)

        self._initialized = True
        logger.info(f"ProxyRotator initialized with {len(self.pool.proxies)} proxies")

    def get_proxy_for_url(self, url: str) -> Optional[ProxyConfig]:
        """Get the best proxy for a given URL."""
        if not self._initialized:
            self.initialize()

        proxy = self.geo_selector.select_proxy(url)

        if proxy:
            self.pool.put_on_cooldown(proxy)

        return proxy

    def get_any_proxy(self) -> Optional[ProxyConfig]:
        """Get any healthy proxy."""
        if not self._initialized:
            self.initialize()

        proxy = self.pool.get_best_proxy()
        if proxy:
            self.pool.put_on_cooldown(proxy)
        return proxy

    def report_success(self, proxy: ProxyConfig, response_time: float = 1.0):
        """Report a successful request through a proxy."""
        proxy.record_success(response_time)

    def report_failure(self, proxy: ProxyConfig):
        """Report a failed request through a proxy."""
        proxy.record_failure()

        if self.health_checker.should_remove(proxy):
            logger.warning(f"Removing unhealthy proxy: {proxy.url}")
            self.pool.remove_proxy(proxy)

    def get_stats(self) -> Dict:
        """Get current proxy pool statistics."""
        return self.pool.get_stats()

    def shutdown(self):
        """Clean up resources."""
        self.health_checker.stop_background_checks()


class RequestsWithProxy:
    """
    Wrapper around requests that automatically uses proxy rotation.

    Usage:
        client = RequestsWithProxy()
        response = client.get("https://zhihu.com/question/123")
    """

    def __init__(self, rotator: Optional[ProxyRotator] = None):
        self.rotator = rotator or ProxyRotator()
        self.rotator.initialize()

    def request(
        self,
        method: str,
        url: str,
        max_retries: int = 3,
        use_proxy: bool = True,
        **kwargs
    ) -> requests.Response:
        """Make a request with automatic proxy rotation and retry."""
        last_error = None

        for attempt in range(max_retries):
            proxy = None
            start_time = time.time()

            try:
                if use_proxy:
                    proxy = self.rotator.get_proxy_for_url(url)
                    if proxy:
                        kwargs["proxies"] = proxy.proxy_dict

                response = requests.request(method, url, **kwargs)
                response_time = time.time() - start_time

                if proxy:
                    self.rotator.report_success(proxy, response_time)

                return response

            except Exception as e:
                last_error = e
                if proxy:
                    self.rotator.report_failure(proxy)

                logger.warning(f"Request failed (attempt {attempt + 1}/{max_retries}): {e}")

                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff

        raise last_error or Exception("All retry attempts failed")

    def get(self, url: str, **kwargs) -> requests.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> requests.Response:
        return self.request("POST", url, **kwargs)


# Singleton instance for easy import
_default_rotator: Optional[ProxyRotator] = None


def get_rotator() -> ProxyRotator:
    """Get the default ProxyRotator instance."""
    global _default_rotator
    if _default_rotator is None:
        _default_rotator = ProxyRotator()
        _default_rotator.initialize()
    return _default_rotator


def get_proxy_for_url(url: str) -> Optional[Dict[str, str]]:
    """
    Convenience function to get proxy dict for a URL.
    Returns None if no proxy available.
    """
    rotator = get_rotator()
    proxy = rotator.get_proxy_for_url(url)
    return proxy.proxy_dict if proxy else None


# Free proxy sources for fallback (use sparingly, unreliable)
FREE_PROXY_SOURCES = [
    "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
]


def load_free_proxies(pool: ProxyPool, max_proxies: int = 50):
    """Load free proxies as a last resort fallback."""
    import requests

    for source in FREE_PROXY_SOURCES:
        try:
            response = requests.get(source, timeout=10)
            if response.status_code == 200:
                lines = response.text.strip().split('\n')
                for line in lines[:max_proxies]:
                    line = line.strip()
                    if line and ':' in line:
                        proxy = ProxyConfig(
                            url=f"http://{line}",
                            provider=ProxyProvider.FREE,
                            proxy_type=ProxyType.DATACENTER,
                            region=GeoRegion.GLOBAL,
                            weight=0.3,  # Low weight for unreliable proxies
                        )
                        pool.add_proxy(proxy)
                break
        except Exception as e:
            logger.debug(f"Failed to load free proxies from {source}: {e}")


if __name__ == "__main__":
    # Example usage
    logging.basicConfig(level=logging.INFO)

    rotator = ProxyRotator()
    rotator.initialize()

    print("Proxy pool stats:", rotator.get_stats())

    # Test URL selection
    test_urls = [
        "https://zhihu.com/question/123",
        "https://programmers.co.kr/learn",
        "https://qiita.com/trending",
        "https://github.com/search",
    ]

    for url in test_urls:
        proxy = rotator.get_proxy_for_url(url)
        if proxy:
            print(f"URL: {url} -> Region: {proxy.region.value}, Type: {proxy.proxy_type.value}")
        else:
            print(f"URL: {url} -> No proxy available")

    rotator.shutdown()
