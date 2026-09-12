"""
Anti-detection utilities for web scraping interview data.
Provides stealth techniques to avoid blocks while scraping at scale.
"""

import random
import time
import hashlib
import json
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import threading
from collections import deque
import os

# ============================================================================
# USER AGENT ROTATION
# ============================================================================

class UserAgentRotator:
    """
    Rotates through realistic, current user agents.
    Weighted toward common browsers to appear natural.
    """

    # Updated user agents (2024-2025 versions)
    CHROME_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    ]

    FIREFOX_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    ]

    SAFARI_AGENTS = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    ]

    EDGE_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
    ]

    MOBILE_AGENTS = [
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
    ]

    # Weights based on real browser market share
    BROWSER_WEIGHTS = {
        'chrome': 65,
        'firefox': 10,
        'safari': 15,
        'edge': 8,
        'mobile': 2,
    }

    def __init__(self, include_mobile: bool = False):
        self.include_mobile = include_mobile
        self._build_weighted_pool()
        self._lock = threading.Lock()
        self._last_used: Dict[str, datetime] = {}

    def _build_weighted_pool(self):
        """Build weighted pool of user agents."""
        self.pool = []
        for ua in self.CHROME_AGENTS:
            self.pool.extend([(ua, 'chrome')] * self.BROWSER_WEIGHTS['chrome'])
        for ua in self.FIREFOX_AGENTS:
            self.pool.extend([(ua, 'firefox')] * self.BROWSER_WEIGHTS['firefox'])
        for ua in self.SAFARI_AGENTS:
            self.pool.extend([(ua, 'safari')] * self.BROWSER_WEIGHTS['safari'])
        for ua in self.EDGE_AGENTS:
            self.pool.extend([(ua, 'edge')] * self.BROWSER_WEIGHTS['edge'])
        if self.include_mobile:
            for ua in self.MOBILE_AGENTS:
                self.pool.extend([(ua, 'mobile')] * self.BROWSER_WEIGHTS['mobile'])

    def get(self) -> str:
        """Get a random user agent."""
        ua, _ = random.choice(self.pool)
        return ua

    def get_with_browser_type(self) -> Tuple[str, str]:
        """Get user agent with browser type identifier."""
        return random.choice(self.pool)

    def get_consistent_for_session(self, session_id: str) -> str:
        """Get consistent UA for a session (don't rotate mid-session)."""
        with self._lock:
            if session_id not in self._last_used:
                ua, _ = random.choice(self.pool)
                self._last_used[session_id] = ua
            return self._last_used[session_id]


# ============================================================================
# HEADER RANDOMIZATION
# ============================================================================

class HeaderRandomizer:
    """
    Generates realistic, consistent HTTP headers.
    Headers must match the user agent to avoid detection.
    """

    ACCEPT_LANGUAGES = [
        "en-US,en;q=0.9",
        "en-US,en;q=0.9,es;q=0.8",
        "en-GB,en;q=0.9,en-US;q=0.8",
        "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        "en-US,en;q=0.9,ja;q=0.8",
        "en-US,en;q=0.9,ko;q=0.8",
        "en-US,en;q=0.9,de;q=0.8",
        "en-US,en;q=0.9,fr;q=0.8",
    ]

    ACCEPT_ENCODINGS = [
        "gzip, deflate, br",
        "gzip, deflate, br, zstd",
        "gzip, deflate",
    ]

    SEC_CH_UA_PLATFORMS = {
        'windows': '"Windows"',
        'macos': '"macOS"',
        'linux': '"Linux"',
    }

    def __init__(self, ua_rotator: Optional[UserAgentRotator] = None):
        self.ua_rotator = ua_rotator or UserAgentRotator()

    def get_headers(self,
                    url: Optional[str] = None,
                    referer: Optional[str] = None,
                    custom_headers: Optional[Dict] = None) -> Dict[str, str]:
        """Generate realistic headers for a request."""
        ua, browser_type = self.ua_rotator.get_with_browser_type()

        # Determine platform from UA
        if 'Windows' in ua:
            platform = 'windows'
        elif 'Macintosh' in ua or 'Mac OS' in ua:
            platform = 'macos'
        else:
            platform = 'linux'

        headers = {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': random.choice(self.ACCEPT_LANGUAGES),
            'Accept-Encoding': random.choice(self.ACCEPT_ENCODINGS),
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0',
        }

        # Add Chrome-specific headers
        if browser_type in ('chrome', 'edge'):
            # Extract version from UA
            version = '120'
            if 'Chrome/' in ua:
                try:
                    version = ua.split('Chrome/')[1].split('.')[0]
                except:
                    pass

            headers.update({
                'Sec-Ch-Ua': f'"Not_A Brand";v="8", "Chromium";v="{version}", "Google Chrome";v="{version}"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': self.SEC_CH_UA_PLATFORMS.get(platform, '"Windows"'),
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none' if not referer else 'same-origin',
                'Sec-Fetch-User': '?1',
            })

        # Add referer if provided
        if referer:
            headers['Referer'] = referer

        # Merge custom headers
        if custom_headers:
            headers.update(custom_headers)

        return headers

    def get_api_headers(self,
                        content_type: str = 'application/json',
                        auth_token: Optional[str] = None) -> Dict[str, str]:
        """Generate headers for API requests."""
        ua = self.ua_rotator.get()

        headers = {
            'User-Agent': ua,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': random.choice(self.ACCEPT_LANGUAGES),
            'Accept-Encoding': random.choice(self.ACCEPT_ENCODINGS),
            'Content-Type': content_type,
            'Connection': 'keep-alive',
        }

        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'

        return headers


# ============================================================================
# TIMING JITTER
# ============================================================================

class TimingJitter:
    """
    Implements human-like request timing patterns.
    Avoids detection by varying delays realistically.
    """

    def __init__(self,
                 min_delay: float = 1.0,
                 max_delay: float = 5.0,
                 burst_probability: float = 0.1,
                 long_pause_probability: float = 0.05):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.burst_probability = burst_probability
        self.long_pause_probability = long_pause_probability
        self._request_times: deque = deque(maxlen=100)
        self._lock = threading.Lock()

    def get_delay(self) -> float:
        """Get a randomized delay that mimics human behavior."""
        # Occasional burst (quick succession)
        if random.random() < self.burst_probability:
            return random.uniform(0.2, 0.8)

        # Occasional long pause (reading/thinking)
        if random.random() < self.long_pause_probability:
            return random.uniform(10.0, 30.0)

        # Normal delay with gaussian distribution
        mean = (self.min_delay + self.max_delay) / 2
        std = (self.max_delay - self.min_delay) / 4
        delay = random.gauss(mean, std)

        # Clamp to bounds
        return max(self.min_delay, min(self.max_delay, delay))

    def wait(self) -> float:
        """Wait for a randomized delay. Returns actual delay used."""
        delay = self.get_delay()
        time.sleep(delay)

        with self._lock:
            self._request_times.append(time.time())

        return delay

    def adaptive_wait(self, response_code: int = 200) -> float:
        """Adaptive wait based on response codes."""
        base_delay = self.get_delay()

        # Back off on rate limiting signals
        if response_code == 429:
            delay = base_delay * random.uniform(5, 10)
        elif response_code >= 500:
            delay = base_delay * random.uniform(2, 4)
        elif response_code == 403:
            delay = base_delay * random.uniform(3, 6)
        else:
            delay = base_delay

        time.sleep(delay)
        return delay

    def get_requests_per_minute(self) -> float:
        """Calculate current request rate."""
        with self._lock:
            if len(self._request_times) < 2:
                return 0.0

            now = time.time()
            recent = [t for t in self._request_times if now - t < 60]
            return len(recent)


# ============================================================================
# FINGERPRINT MANAGER
# ============================================================================

@dataclass
class BrowserFingerprint:
    """Represents a consistent browser fingerprint."""
    user_agent: str
    platform: str
    screen_width: int
    screen_height: int
    color_depth: int
    timezone: str
    language: str
    webgl_vendor: str
    webgl_renderer: str
    canvas_hash: str
    audio_hash: str
    fonts: List[str]
    plugins: List[str]
    do_not_track: Optional[str]
    hardware_concurrency: int
    device_memory: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            'userAgent': self.user_agent,
            'platform': self.platform,
            'screen': {'width': self.screen_width, 'height': self.screen_height},
            'colorDepth': self.color_depth,
            'timezone': self.timezone,
            'language': self.language,
            'webgl': {'vendor': self.webgl_vendor, 'renderer': self.webgl_renderer},
            'canvas': self.canvas_hash,
            'audio': self.audio_hash,
            'fonts': self.fonts,
            'plugins': self.plugins,
            'doNotTrack': self.do_not_track,
            'hardwareConcurrency': self.hardware_concurrency,
            'deviceMemory': self.device_memory,
        }


class FingerprintManager:
    """
    Manages consistent browser fingerprints for scraping sessions.
    Generates realistic fingerprints that pass detection.
    """

    SCREEN_RESOLUTIONS = [
        (1920, 1080), (1366, 768), (1536, 864), (1440, 900),
        (1280, 720), (2560, 1440), (1600, 900), (1280, 800),
        (3840, 2160), (2560, 1080),
    ]

    TIMEZONES = [
        'America/New_York', 'America/Chicago', 'America/Denver',
        'America/Los_Angeles', 'Europe/London', 'Europe/Paris',
        'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Singapore',
    ]

    WEBGL_CONFIGS = [
        ('Google Inc. (NVIDIA)', 'ANGLE (NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)'),
        ('Google Inc. (NVIDIA)', 'ANGLE (NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)'),
        ('Google Inc. (AMD)', 'ANGLE (AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)'),
        ('Google Inc. (Intel)', 'ANGLE (Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)'),
        ('Apple Inc.', 'Apple M1 Pro'),
        ('Apple Inc.', 'Apple M2'),
    ]

    COMMON_FONTS = [
        'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Cambria Math',
        'Comic Sans MS', 'Consolas', 'Courier', 'Courier New', 'Georgia',
        'Helvetica', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
        'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe UI', 'Tahoma',
        'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana',
    ]

    def __init__(self, ua_rotator: Optional[UserAgentRotator] = None):
        self.ua_rotator = ua_rotator or UserAgentRotator()
        self._fingerprints: Dict[str, BrowserFingerprint] = {}
        self._lock = threading.Lock()

    def generate_fingerprint(self, seed: Optional[str] = None) -> BrowserFingerprint:
        """Generate a realistic browser fingerprint."""
        if seed:
            random.seed(hashlib.md5(seed.encode()).hexdigest())

        ua = self.ua_rotator.get()

        # Determine platform from UA
        if 'Windows' in ua:
            platform = 'Win32'
        elif 'Macintosh' in ua:
            platform = 'MacIntel'
        elif 'Linux' in ua:
            platform = 'Linux x86_64'
        else:
            platform = 'Win32'

        width, height = random.choice(self.SCREEN_RESOLUTIONS)
        webgl_vendor, webgl_renderer = random.choice(self.WEBGL_CONFIGS)

        # Generate consistent hashes
        canvas_hash = hashlib.md5(f"{seed or random.random()}_canvas".encode()).hexdigest()[:16]
        audio_hash = hashlib.md5(f"{seed or random.random()}_audio".encode()).hexdigest()[:16]

        # Select random subset of fonts
        num_fonts = random.randint(15, len(self.COMMON_FONTS))
        fonts = random.sample(self.COMMON_FONTS, num_fonts)

        fingerprint = BrowserFingerprint(
            user_agent=ua,
            platform=platform,
            screen_width=width,
            screen_height=height,
            color_depth=24,
            timezone=random.choice(self.TIMEZONES),
            language=random.choice(['en-US', 'en-GB', 'en']),
            webgl_vendor=webgl_vendor,
            webgl_renderer=webgl_renderer,
            canvas_hash=canvas_hash,
            audio_hash=audio_hash,
            fonts=fonts,
            plugins=['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer'],
            do_not_track=random.choice([None, '1', None, None]),  # Most don't use DNT
            hardware_concurrency=random.choice([4, 8, 12, 16]),
            device_memory=random.choice([4, 8, 16, 32]),
        )

        # Reset random seed
        if seed:
            random.seed()

        return fingerprint

    def get_or_create(self, session_id: str) -> BrowserFingerprint:
        """Get existing fingerprint or create consistent one for session."""
        with self._lock:
            if session_id not in self._fingerprints:
                self._fingerprints[session_id] = self.generate_fingerprint(seed=session_id)
            return self._fingerprints[session_id]

    def clear_session(self, session_id: str):
        """Clear fingerprint for a session."""
        with self._lock:
            self._fingerprints.pop(session_id, None)


# ============================================================================
# PROXY ROTATION
# ============================================================================

@dataclass
class Proxy:
    """Represents a proxy server."""
    host: str
    port: int
    username: Optional[str] = None
    password: Optional[str] = None
    protocol: str = 'http'
    country: Optional[str] = None
    last_used: Optional[datetime] = None
    fail_count: int = 0
    success_count: int = 0

    @property
    def url(self) -> str:
        if self.username and self.password:
            return f"{self.protocol}://{self.username}:{self.password}@{self.host}:{self.port}"
        return f"{self.protocol}://{self.host}:{self.port}"

    @property
    def dict(self) -> Dict[str, str]:
        return {
            'http': self.url,
            'https': self.url,
        }


class ProxyRotator:
    """
    Manages proxy rotation for distributed scraping.
    Supports residential and datacenter proxies.
    """

    def __init__(self, proxies: Optional[List[Proxy]] = None):
        self.proxies: List[Proxy] = proxies or []
        self._lock = threading.Lock()
        self._current_index = 0
        self._blacklist: Dict[str, datetime] = {}
        self._blacklist_duration = timedelta(minutes=30)

    def add_proxy(self, proxy: Proxy):
        """Add a proxy to the pool."""
        with self._lock:
            self.proxies.append(proxy)

    def add_from_env(self):
        """Load proxies from environment variables."""
        # Format: PROXY_1=http://user:pass@host:port
        for key, value in os.environ.items():
            if key.startswith('PROXY_') or key.startswith('HTTP_PROXY_'):
                try:
                    # Parse proxy URL
                    if '://' in value:
                        protocol, rest = value.split('://', 1)
                    else:
                        protocol, rest = 'http', value

                    if '@' in rest:
                        auth, hostport = rest.rsplit('@', 1)
                        username, password = auth.split(':', 1)
                    else:
                        hostport = rest
                        username, password = None, None

                    host, port = hostport.rsplit(':', 1)

                    self.add_proxy(Proxy(
                        host=host,
                        port=int(port),
                        username=username,
                        password=password,
                        protocol=protocol,
                    ))
                except Exception:
                    pass

    def get_proxy(self, country: Optional[str] = None) -> Optional[Proxy]:
        """Get next available proxy."""
        with self._lock:
            if not self.proxies:
                return None

            # Clean expired blacklist entries
            now = datetime.now()
            self._blacklist = {
                k: v for k, v in self._blacklist.items()
                if now - v < self._blacklist_duration
            }

            # Filter available proxies
            available = [
                p for p in self.proxies
                if p.url not in self._blacklist
                and (country is None or p.country == country)
            ]

            if not available:
                return None

            # Round-robin selection
            proxy = available[self._current_index % len(available)]
            self._current_index = (self._current_index + 1) % len(available)
            proxy.last_used = now

            return proxy

    def report_success(self, proxy: Proxy):
        """Report successful request through proxy."""
        with self._lock:
            proxy.success_count += 1
            proxy.fail_count = max(0, proxy.fail_count - 1)

    def report_failure(self, proxy: Proxy, blacklist: bool = False):
        """Report failed request through proxy."""
        with self._lock:
            proxy.fail_count += 1

            if blacklist or proxy.fail_count >= 3:
                self._blacklist[proxy.url] = datetime.now()

    def get_stats(self) -> Dict[str, Any]:
        """Get proxy pool statistics."""
        with self._lock:
            return {
                'total': len(self.proxies),
                'blacklisted': len(self._blacklist),
                'available': len(self.proxies) - len(self._blacklist),
                'proxies': [
                    {
                        'host': p.host,
                        'success': p.success_count,
                        'fail': p.fail_count,
                        'country': p.country,
                    }
                    for p in self.proxies
                ]
            }


# ============================================================================
# CLOUDFLARE / AKAMAI BYPASS
# ============================================================================

class CloudflareBypass:
    """
    Techniques for bypassing Cloudflare protection.
    Note: For educational purposes only.
    """

    @staticmethod
    def get_cf_clearance_headers(cf_clearance: str, cf_bm: Optional[str] = None) -> Dict[str, str]:
        """
        Get headers with Cloudflare clearance cookies.
        Clearance must be obtained from a real browser session.
        """
        cookies = f"cf_clearance={cf_clearance}"
        if cf_bm:
            cookies += f"; __cf_bm={cf_bm}"

        return {
            'Cookie': cookies,
        }

    @staticmethod
    def should_use_browser(response_code: int, response_text: str) -> bool:
        """Check if Cloudflare challenge is present."""
        if response_code == 403 or response_code == 503:
            cf_indicators = [
                'cf-browser-verification',
                'cf_clearance',
                'Checking your browser',
                'Just a moment...',
                '_cf_chl_opt',
                'challenge-platform',
            ]
            return any(indicator in response_text for indicator in cf_indicators)
        return False

    @staticmethod
    def get_undetected_chrome_options() -> Dict[str, Any]:
        """
        Options for undetected-chromedriver.
        Use with: pip install undetected-chromedriver
        """
        return {
            'headless': False,  # Headless is more detectable
            'disable_gpu': False,
            'no_sandbox': True,
            'disable_dev_shm_usage': True,
            'excludeSwitches': ['enable-automation'],
            'useAutomationExtension': False,
        }


class HeadlessDetectionBypass:
    """
    Techniques to avoid headless browser detection.
    For use with Playwright/Puppeteer/Selenium.
    """

    @staticmethod
    def get_stealth_js() -> str:
        """JavaScript to inject for stealth mode."""
        return '''
        // Override webdriver property
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });

        // Override languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });

        // Override plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });

        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );

        // Override chrome runtime
        window.chrome = {
            runtime: {},
        };

        // Override iframe contentWindow
        const originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(init) {
            if (init && init.mode === 'closed') {
                init.mode = 'open';
            }
            return originalAttachShadow.call(this, init);
        };
        '''

    @staticmethod
    def get_playwright_stealth_context_options() -> Dict[str, Any]:
        """Context options for Playwright to appear human."""
        return {
            'viewport': {'width': 1920, 'height': 1080},
            'user_agent': UserAgentRotator().get(),
            'locale': 'en-US',
            'timezone_id': 'America/New_York',
            'geolocation': {'latitude': 40.7128, 'longitude': -74.0060},
            'permissions': ['geolocation'],
            'color_scheme': 'light',
            'device_scale_factor': 1,
            'is_mobile': False,
            'has_touch': False,
            'java_script_enabled': True,
        }


# ============================================================================
# RATE LIMITER
# ============================================================================

class AdaptiveRateLimiter:
    """
    Adaptive rate limiter that adjusts based on response codes.
    Implements exponential backoff and circuit breaker patterns.
    """

    def __init__(self,
                 requests_per_minute: int = 30,
                 burst_size: int = 5,
                 backoff_factor: float = 2.0,
                 max_backoff: float = 300.0):
        self.base_rpm = requests_per_minute
        self.current_rpm = requests_per_minute
        self.burst_size = burst_size
        self.backoff_factor = backoff_factor
        self.max_backoff = max_backoff

        self._tokens = burst_size
        self._last_refill = time.time()
        self._backoff_until: Optional[float] = None
        self._consecutive_failures = 0
        self._lock = threading.Lock()

    def _refill_tokens(self):
        """Refill tokens based on elapsed time."""
        now = time.time()
        elapsed = now - self._last_refill

        # Calculate tokens to add
        tokens_to_add = elapsed * (self.current_rpm / 60.0)
        self._tokens = min(self.burst_size, self._tokens + tokens_to_add)
        self._last_refill = now

    def acquire(self, timeout: float = 60.0) -> bool:
        """Acquire a token to make a request."""
        start = time.time()

        while time.time() - start < timeout:
            with self._lock:
                # Check if in backoff period
                if self._backoff_until and time.time() < self._backoff_until:
                    wait_time = self._backoff_until - time.time()
                    if wait_time > timeout - (time.time() - start):
                        return False
                    time.sleep(min(wait_time, 1.0))
                    continue

                self._refill_tokens()

                if self._tokens >= 1:
                    self._tokens -= 1
                    return True

            time.sleep(0.1)

        return False

    def report_response(self, status_code: int):
        """Report response to adjust rate limiting."""
        with self._lock:
            if status_code == 429:
                # Rate limited - back off significantly
                self._consecutive_failures += 1
                backoff_time = min(
                    self.max_backoff,
                    (self.backoff_factor ** self._consecutive_failures) * 10
                )
                self._backoff_until = time.time() + backoff_time
                self.current_rpm = max(1, self.current_rpm // 2)

            elif status_code >= 500:
                # Server error - moderate backoff
                self._consecutive_failures += 1
                backoff_time = min(
                    self.max_backoff / 2,
                    (self.backoff_factor ** self._consecutive_failures) * 5
                )
                self._backoff_until = time.time() + backoff_time

            elif status_code >= 400:
                # Client error - small backoff
                self._consecutive_failures += 1
                self._backoff_until = time.time() + 2.0

            else:
                # Success - gradually recover
                self._consecutive_failures = 0
                self._backoff_until = None
                self.current_rpm = min(self.base_rpm, self.current_rpm + 1)


# ============================================================================
# UNIFIED STEALTH SESSION
# ============================================================================

class StealthSession:
    """
    Unified stealth session combining all anti-detection techniques.
    Use this as the main interface for stealth scraping.
    """

    def __init__(self,
                 session_id: Optional[str] = None,
                 use_proxies: bool = False,
                 min_delay: float = 1.0,
                 max_delay: float = 5.0,
                 requests_per_minute: int = 30):

        self.session_id = session_id or hashlib.md5(str(time.time()).encode()).hexdigest()[:16]

        self.ua_rotator = UserAgentRotator()
        self.header_randomizer = HeaderRandomizer(self.ua_rotator)
        self.timing = TimingJitter(min_delay=min_delay, max_delay=max_delay)
        self.fingerprint_manager = FingerprintManager(self.ua_rotator)
        self.rate_limiter = AdaptiveRateLimiter(requests_per_minute=requests_per_minute)

        self.proxy_rotator = ProxyRotator() if use_proxies else None
        if use_proxies:
            self.proxy_rotator.add_from_env()

        # Get consistent fingerprint for session
        self.fingerprint = self.fingerprint_manager.get_or_create(self.session_id)

    def get_request_config(self,
                          url: str,
                          referer: Optional[str] = None) -> Dict[str, Any]:
        """Get complete request configuration."""
        config = {
            'headers': self.header_randomizer.get_headers(url=url, referer=referer),
            'timeout': random.uniform(10, 30),
        }

        if self.proxy_rotator:
            proxy = self.proxy_rotator.get_proxy()
            if proxy:
                config['proxies'] = proxy.dict
                config['_proxy'] = proxy

        return config

    def before_request(self, timeout: float = 60.0) -> bool:
        """Call before making a request. Returns False if rate limited."""
        if not self.rate_limiter.acquire(timeout):
            return False

        self.timing.wait()
        return True

    def after_request(self, status_code: int, proxy: Optional[Proxy] = None):
        """Call after request completes."""
        self.rate_limiter.report_response(status_code)

        if proxy and self.proxy_rotator:
            if status_code < 400:
                self.proxy_rotator.report_success(proxy)
            else:
                self.proxy_rotator.report_failure(proxy, blacklist=(status_code == 403))

    def get_stats(self) -> Dict[str, Any]:
        """Get session statistics."""
        stats = {
            'session_id': self.session_id,
            'requests_per_minute': self.timing.get_requests_per_minute(),
            'current_rpm_limit': self.rate_limiter.current_rpm,
        }

        if self.proxy_rotator:
            stats['proxies'] = self.proxy_rotator.get_stats()

        return stats


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def create_stealth_session(**kwargs) -> StealthSession:
    """Create a new stealth session with default settings."""
    return StealthSession(**kwargs)


def get_stealth_headers(url: Optional[str] = None) -> Dict[str, str]:
    """Quick function to get stealth headers."""
    return HeaderRandomizer().get_headers(url=url)


def random_delay(min_seconds: float = 1.0, max_seconds: float = 5.0):
    """Sleep for a random human-like delay."""
    TimingJitter(min_delay=min_seconds, max_delay=max_seconds).wait()
