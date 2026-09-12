"""
Robust session management for authenticated scrapers.

Handles:
- Cookie persistence across runs (SQLite storage)
- Session refresh before expiry
- Multi-account rotation with health tracking
- OAuth token management with auto-refresh
- Browser cookie extraction (Chrome, Firefox, Safari)
- Session health validation with exponential backoff

Usage:
    from utils.session_manager import SessionManager, Account

    # Single account
    manager = SessionManager('glassdoor')
    session = manager.get_session()

    # Multi-account rotation
    manager = SessionManager('1point3acres', accounts=[
        Account(email='user1@example.com', password='...'),
        Account(email='user2@example.com', password='...'),
    ])
    session = manager.get_healthy_session()
"""

import os
import json
import time
import sqlite3
import hashlib
import logging
import threading
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass, field, asdict
from typing import Optional, Dict, List, Any, Callable
from abc import ABC, abstractmethod
from contextlib import contextmanager
import pickle
import base64

try:
    import requests
    from requests.cookies import RequestsCookieJar
except ImportError:
    requests = None
    RequestsCookieJar = None

try:
    import browser_cookie3
except ImportError:
    browser_cookie3 = None

logger = logging.getLogger(__name__)


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class Account:
    """Represents a scraper account with credentials."""
    email: str
    password: str
    cookies: Optional[Dict[str, str]] = None
    oauth_token: Optional[str] = None
    oauth_refresh_token: Optional[str] = None
    oauth_expiry: Optional[datetime] = None
    last_used: Optional[datetime] = None
    failure_count: int = 0
    is_banned: bool = False
    cooldown_until: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_healthy(self) -> bool:
        """Check if account is usable."""
        if self.is_banned:
            return False
        if self.cooldown_until and datetime.now() < self.cooldown_until:
            return False
        if self.failure_count >= 5:
            return False
        return True

    @property
    def needs_oauth_refresh(self) -> bool:
        """Check if OAuth token needs refresh."""
        if not self.oauth_expiry:
            return False
        buffer = timedelta(minutes=5)
        return datetime.now() >= (self.oauth_expiry - buffer)

    def record_failure(self, cooldown_minutes: int = 30):
        """Record a failed request."""
        self.failure_count += 1
        if self.failure_count >= 3:
            self.cooldown_until = datetime.now() + timedelta(minutes=cooldown_minutes)

    def record_success(self):
        """Record a successful request."""
        self.failure_count = max(0, self.failure_count - 1)
        self.last_used = datetime.now()
        self.cooldown_until = None


@dataclass
class SessionHealth:
    """Health status of a session."""
    is_valid: bool
    checked_at: datetime
    error: Optional[str] = None
    response_time_ms: Optional[float] = None
    rate_limit_remaining: Optional[int] = None
    rate_limit_reset: Optional[datetime] = None


# =============================================================================
# Session Store (SQLite persistence)
# =============================================================================

class SessionStore:
    """Persistent storage for sessions and cookies using SQLite."""

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            cache_dir = Path.home() / '.cache' / 'newgrad-radar' / 'sessions'
            cache_dir.mkdir(parents=True, exist_ok=True)
            db_path = str(cache_dir / 'sessions.db')

        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        """Initialize database schema."""
        with self._get_conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    cookies BLOB,
                    oauth_token TEXT,
                    oauth_refresh_token TEXT,
                    oauth_expiry TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    expires_at TEXT,
                    metadata TEXT,
                    UNIQUE(service, account_id)
                );

                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service TEXT NOT NULL,
                    email TEXT NOT NULL,
                    password_hash TEXT,
                    failure_count INTEGER DEFAULT 0,
                    is_banned INTEGER DEFAULT 0,
                    cooldown_until TEXT,
                    last_used TEXT,
                    metadata TEXT,
                    UNIQUE(service, email)
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_service
                ON sessions(service);

                CREATE INDEX IF NOT EXISTS idx_accounts_service
                ON accounts(service);
            """)

    @contextmanager
    def _get_conn(self):
        """Get a database connection with proper locking."""
        with self._lock:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            try:
                yield conn
                conn.commit()
            finally:
                conn.close()

    def save_session(
        self,
        service: str,
        account_id: str,
        cookies: Optional[Dict[str, str]] = None,
        oauth_token: Optional[str] = None,
        oauth_refresh_token: Optional[str] = None,
        oauth_expiry: Optional[datetime] = None,
        expires_at: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Save or update a session."""
        cookies_blob = pickle.dumps(cookies) if cookies else None
        expiry_str = oauth_expiry.isoformat() if oauth_expiry else None
        expires_str = expires_at.isoformat() if expires_at else None
        meta_str = json.dumps(metadata) if metadata else None

        with self._get_conn() as conn:
            conn.execute("""
                INSERT INTO sessions
                    (service, account_id, cookies, oauth_token, oauth_refresh_token,
                     oauth_expiry, expires_at, metadata, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(service, account_id) DO UPDATE SET
                    cookies = excluded.cookies,
                    oauth_token = excluded.oauth_token,
                    oauth_refresh_token = excluded.oauth_refresh_token,
                    oauth_expiry = excluded.oauth_expiry,
                    expires_at = excluded.expires_at,
                    metadata = excluded.metadata,
                    updated_at = CURRENT_TIMESTAMP
            """, (service, account_id, cookies_blob, oauth_token,
                  oauth_refresh_token, expiry_str, expires_str, meta_str))

    def load_session(self, service: str, account_id: str) -> Optional[Dict[str, Any]]:
        """Load a session if it exists and hasn't expired."""
        with self._get_conn() as conn:
            row = conn.execute("""
                SELECT * FROM sessions
                WHERE service = ? AND account_id = ?
            """, (service, account_id)).fetchone()

            if not row:
                return None

            # Check expiry
            if row['expires_at']:
                expires_at = datetime.fromisoformat(row['expires_at'])
                if datetime.now() >= expires_at:
                    self.delete_session(service, account_id)
                    return None

            result = dict(row)
            if result['cookies']:
                result['cookies'] = pickle.loads(result['cookies'])
            if result['oauth_expiry']:
                result['oauth_expiry'] = datetime.fromisoformat(result['oauth_expiry'])
            if result['metadata']:
                result['metadata'] = json.loads(result['metadata'])

            return result

    def delete_session(self, service: str, account_id: str):
        """Delete a session."""
        with self._get_conn() as conn:
            conn.execute(
                "DELETE FROM sessions WHERE service = ? AND account_id = ?",
                (service, account_id)
            )

    def save_account(self, service: str, account: Account):
        """Save account status."""
        password_hash = hashlib.sha256(account.password.encode()).hexdigest()
        cooldown_str = account.cooldown_until.isoformat() if account.cooldown_until else None
        last_used_str = account.last_used.isoformat() if account.last_used else None
        meta_str = json.dumps(account.metadata)

        with self._get_conn() as conn:
            conn.execute("""
                INSERT INTO accounts
                    (service, email, password_hash, failure_count, is_banned,
                     cooldown_until, last_used, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(service, email) DO UPDATE SET
                    failure_count = excluded.failure_count,
                    is_banned = excluded.is_banned,
                    cooldown_until = excluded.cooldown_until,
                    last_used = excluded.last_used,
                    metadata = excluded.metadata
            """, (service, account.email, password_hash, account.failure_count,
                  int(account.is_banned), cooldown_str, last_used_str, meta_str))

    def load_account_status(self, service: str, email: str) -> Optional[Dict[str, Any]]:
        """Load account status from previous runs."""
        with self._get_conn() as conn:
            row = conn.execute("""
                SELECT * FROM accounts WHERE service = ? AND email = ?
            """, (service, email)).fetchone()

            if not row:
                return None

            result = dict(row)
            if result['cooldown_until']:
                result['cooldown_until'] = datetime.fromisoformat(result['cooldown_until'])
            if result['last_used']:
                result['last_used'] = datetime.fromisoformat(result['last_used'])
            if result['metadata']:
                result['metadata'] = json.loads(result['metadata'])

            return result

    def cleanup_expired(self, max_age_days: int = 30):
        """Remove expired sessions and reset old account cooldowns."""
        cutoff = (datetime.now() - timedelta(days=max_age_days)).isoformat()

        with self._get_conn() as conn:
            conn.execute(
                "DELETE FROM sessions WHERE updated_at < ?", (cutoff,)
            )
            conn.execute("""
                UPDATE accounts SET cooldown_until = NULL, failure_count = 0
                WHERE cooldown_until < CURRENT_TIMESTAMP
            """)


# =============================================================================
# Cookie Manager
# =============================================================================

class CookieManager:
    """Manages cookies with browser extraction and persistence."""

    # Browser cookie domain mappings
    DOMAIN_MAP = {
        '1point3acres': ['.1point3acres.com', '1point3acres.com'],
        'glassdoor': ['.glassdoor.com', 'glassdoor.com', '.glassdoor.co.in'],
        'blind': ['.teamblind.com', 'teamblind.com'],
        'linkedin': ['.linkedin.com', 'linkedin.com'],
        'levels': ['.levels.fyi', 'levels.fyi'],
        'nowcoder': ['.nowcoder.com', 'nowcoder.com'],
        'zhihu': ['.zhihu.com', 'zhihu.com'],
    }

    def __init__(self, service: str, store: Optional[SessionStore] = None):
        self.service = service
        self.store = store or SessionStore()
        self.domains = self.DOMAIN_MAP.get(service, [f'.{service}.com'])

    def extract_from_browser(self, browser: str = 'chrome') -> Optional[Dict[str, str]]:
        """Extract cookies from browser for the service's domain."""
        if browser_cookie3 is None:
            logger.warning("browser_cookie3 not installed, cannot extract browser cookies")
            return None

        try:
            if browser == 'chrome':
                cj = browser_cookie3.chrome(domain_name=self.domains[0])
            elif browser == 'firefox':
                cj = browser_cookie3.firefox(domain_name=self.domains[0])
            elif browser == 'safari':
                cj = browser_cookie3.safari(domain_name=self.domains[0])
            else:
                raise ValueError(f"Unknown browser: {browser}")

            cookies = {}
            for domain in self.domains:
                for cookie in cj:
                    if domain in cookie.domain:
                        cookies[cookie.name] = cookie.value

            if cookies:
                logger.info(f"Extracted {len(cookies)} cookies from {browser} for {self.service}")
                return cookies

            return None

        except Exception as e:
            logger.error(f"Failed to extract cookies from {browser}: {e}")
            return None

    def extract_from_all_browsers(self) -> Optional[Dict[str, str]]:
        """Try extracting from all browsers, return first success."""
        for browser in ['chrome', 'firefox', 'safari']:
            cookies = self.extract_from_browser(browser)
            if cookies:
                return cookies
        return None

    def save(self, account_id: str, cookies: Dict[str, str], expires_in_hours: int = 24):
        """Save cookies to persistent storage."""
        expires_at = datetime.now() + timedelta(hours=expires_in_hours)
        self.store.save_session(
            self.service, account_id,
            cookies=cookies,
            expires_at=expires_at
        )

    def load(self, account_id: str) -> Optional[Dict[str, str]]:
        """Load cookies from persistent storage."""
        session = self.store.load_session(self.service, account_id)
        return session.get('cookies') if session else None

    def apply_to_session(
        self,
        session: 'requests.Session',
        cookies: Dict[str, str]
    ):
        """Apply cookies to a requests session."""
        if requests is None:
            return
        for name, value in cookies.items():
            for domain in self.domains:
                session.cookies.set(name, value, domain=domain)


# =============================================================================
# Auth Refresher (OAuth and session refresh)
# =============================================================================

class AuthRefresher(ABC):
    """Base class for authentication refresh logic."""

    @abstractmethod
    def login(self, account: Account) -> Optional[Dict[str, Any]]:
        """Perform login and return session data."""
        pass

    @abstractmethod
    def refresh_token(self, account: Account) -> Optional[str]:
        """Refresh OAuth token using refresh token."""
        pass

    @abstractmethod
    def validate_session(self, session: 'requests.Session') -> SessionHealth:
        """Validate that a session is still active."""
        pass


class GenericAuthRefresher(AuthRefresher):
    """Generic auth refresher with configurable endpoints."""

    def __init__(
        self,
        login_url: str,
        validate_url: str,
        refresh_url: Optional[str] = None,
        login_payload_builder: Optional[Callable[[Account], Dict]] = None,
        session_valid_check: Optional[Callable[[requests.Response], bool]] = None
    ):
        self.login_url = login_url
        self.validate_url = validate_url
        self.refresh_url = refresh_url
        self.login_payload_builder = login_payload_builder or self._default_login_payload
        self.session_valid_check = session_valid_check or self._default_valid_check

    def _default_login_payload(self, account: Account) -> Dict:
        return {'email': account.email, 'password': account.password}

    def _default_valid_check(self, response: requests.Response) -> bool:
        return response.status_code == 200

    def login(self, account: Account) -> Optional[Dict[str, Any]]:
        if requests is None:
            return None

        try:
            session = requests.Session()
            session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            })

            payload = self.login_payload_builder(account)
            response = session.post(self.login_url, json=payload, timeout=30)

            if response.status_code == 200:
                cookies = dict(session.cookies)
                return {
                    'cookies': cookies,
                    'response': response.json() if response.content else {}
                }

            logger.warning(f"Login failed with status {response.status_code}")
            return None

        except Exception as e:
            logger.error(f"Login error: {e}")
            return None

    def refresh_token(self, account: Account) -> Optional[str]:
        if requests is None or not self.refresh_url or not account.oauth_refresh_token:
            return None

        try:
            response = requests.post(
                self.refresh_url,
                json={'refresh_token': account.oauth_refresh_token},
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                return data.get('access_token')

            return None

        except Exception as e:
            logger.error(f"Token refresh error: {e}")
            return None

    def validate_session(self, session: 'requests.Session') -> SessionHealth:
        if requests is None:
            return SessionHealth(is_valid=False, checked_at=datetime.now(), error="requests not installed")

        start = time.time()
        try:
            response = session.get(self.validate_url, timeout=10)
            elapsed = (time.time() - start) * 1000

            is_valid = self.session_valid_check(response)

            # Check for rate limit headers
            rate_remaining = response.headers.get('X-RateLimit-Remaining')
            rate_reset = response.headers.get('X-RateLimit-Reset')

            return SessionHealth(
                is_valid=is_valid,
                checked_at=datetime.now(),
                response_time_ms=elapsed,
                rate_limit_remaining=int(rate_remaining) if rate_remaining else None,
                rate_limit_reset=datetime.fromtimestamp(int(rate_reset)) if rate_reset else None
            )

        except Exception as e:
            return SessionHealth(
                is_valid=False,
                checked_at=datetime.now(),
                error=str(e)
            )


# =============================================================================
# Pre-configured Auth Refreshers for known services
# =============================================================================

class OnePointThreeAcresAuth(GenericAuthRefresher):
    """Auth refresher for 1Point3Acres (一亩三分地)."""

    def __init__(self):
        super().__init__(
            login_url='https://www.1point3acres.com/bbs/member.php?mod=logging&action=login&loginsubmit=yes',
            validate_url='https://www.1point3acres.com/bbs/home.php?mod=space',
            session_valid_check=lambda r: 'uid' in r.text or '个人空间' in r.text
        )

    def _default_login_payload(self, account: Account) -> Dict:
        return {
            'username': account.email,
            'password': account.password,
            'quickforward': 'yes',
            'handlekey': 'ls'
        }


class GlassdoorAuth(GenericAuthRefresher):
    """Auth refresher for Glassdoor."""

    def __init__(self):
        super().__init__(
            login_url='https://www.glassdoor.com/profile/ajax/loginSec498.htm',
            validate_url='https://www.glassdoor.com/member/home/index.htm',
            session_valid_check=lambda r: r.status_code == 200 and 'logout' in r.text.lower()
        )


class BlindAuth(GenericAuthRefresher):
    """Auth refresher for Blind (TeamBlind)."""

    def __init__(self):
        super().__init__(
            login_url='https://www.teamblind.com/api/v2/auth/signin',
            validate_url='https://www.teamblind.com/api/v2/users/me',
            session_valid_check=lambda r: r.status_code == 200
        )


# =============================================================================
# Multi-Account Pool
# =============================================================================

class MultiAccountPool:
    """Manages a pool of accounts with rotation and health tracking."""

    def __init__(
        self,
        service: str,
        accounts: List[Account],
        store: Optional[SessionStore] = None,
        auth_refresher: Optional[AuthRefresher] = None,
        min_delay_between_uses: int = 60,  # seconds
        max_failures_before_cooldown: int = 3,
        cooldown_minutes: int = 30
    ):
        self.service = service
        self.accounts = accounts
        self.store = store or SessionStore()
        self.auth_refresher = auth_refresher
        self.min_delay = min_delay_between_uses
        self.max_failures = max_failures_before_cooldown
        self.cooldown_minutes = cooldown_minutes
        self._lock = threading.Lock()
        self._current_index = 0

        # Load persisted account statuses
        self._restore_account_statuses()

    def _restore_account_statuses(self):
        """Restore account failure counts and cooldowns from storage."""
        for account in self.accounts:
            status = self.store.load_account_status(self.service, account.email)
            if status:
                account.failure_count = status.get('failure_count', 0)
                account.is_banned = bool(status.get('is_banned', False))
                account.cooldown_until = status.get('cooldown_until')
                account.last_used = status.get('last_used')

    def _save_account_status(self, account: Account):
        """Persist account status."""
        self.store.save_account(self.service, account)

    def get_healthy_account(self) -> Optional[Account]:
        """Get next healthy account using round-robin with health checks."""
        with self._lock:
            healthy = [a for a in self.accounts if a.is_healthy]

            if not healthy:
                # Try to find one that's past cooldown
                now = datetime.now()
                for account in self.accounts:
                    if account.cooldown_until and now >= account.cooldown_until:
                        account.cooldown_until = None
                        account.failure_count = 0
                        healthy.append(account)

                if not healthy:
                    logger.error("No healthy accounts available")
                    return None

            # Sort by least recently used
            healthy.sort(key=lambda a: a.last_used or datetime.min)

            # Respect minimum delay
            for account in healthy:
                if account.last_used:
                    elapsed = (datetime.now() - account.last_used).total_seconds()
                    if elapsed < self.min_delay:
                        continue
                return account

            # If all are within delay, return the one used longest ago
            return healthy[0]

    def report_success(self, account: Account):
        """Report successful request for an account."""
        with self._lock:
            account.record_success()
            self._save_account_status(account)

    def report_failure(self, account: Account, is_ban: bool = False):
        """Report failed request for an account."""
        with self._lock:
            if is_ban:
                account.is_banned = True
                logger.warning(f"Account {account.email} marked as banned")
            else:
                account.record_failure(self.cooldown_minutes)
                if account.failure_count >= self.max_failures:
                    logger.warning(
                        f"Account {account.email} in cooldown until {account.cooldown_until}"
                    )
            self._save_account_status(account)

    def get_stats(self) -> Dict[str, Any]:
        """Get pool statistics."""
        healthy = sum(1 for a in self.accounts if a.is_healthy)
        banned = sum(1 for a in self.accounts if a.is_banned)
        cooldown = sum(1 for a in self.accounts if a.cooldown_until and datetime.now() < a.cooldown_until)

        return {
            'total': len(self.accounts),
            'healthy': healthy,
            'banned': banned,
            'in_cooldown': cooldown,
            'available': healthy
        }


# =============================================================================
# Main Session Manager
# =============================================================================

class SessionManager:
    """Main class for managing authenticated scraper sessions."""

    # Pre-configured auth refreshers
    AUTH_REFRESHERS = {
        '1point3acres': OnePointThreeAcresAuth,
        'glassdoor': GlassdoorAuth,
        'blind': BlindAuth,
    }

    def __init__(
        self,
        service: str,
        accounts: Optional[List[Account]] = None,
        store: Optional[SessionStore] = None,
        auth_refresher: Optional[AuthRefresher] = None,
        auto_refresh: bool = True,
        session_ttl_hours: int = 24
    ):
        self.service = service
        self.store = store or SessionStore()
        self.cookie_manager = CookieManager(service, self.store)
        self.session_ttl_hours = session_ttl_hours
        self.auto_refresh = auto_refresh

        # Setup auth refresher
        if auth_refresher:
            self.auth_refresher = auth_refresher
        elif service in self.AUTH_REFRESHERS:
            self.auth_refresher = self.AUTH_REFRESHERS[service]()
        else:
            self.auth_refresher = None

        # Setup account pool if multiple accounts
        if accounts and len(accounts) > 1:
            self.account_pool = MultiAccountPool(
                service, accounts, self.store, self.auth_refresher
            )
            self.accounts = accounts
        elif accounts and len(accounts) == 1:
            self.account_pool = None
            self.accounts = accounts
        else:
            self.account_pool = None
            self.accounts = []

    def get_session(self, account: Optional[Account] = None) -> Optional['requests.Session']:
        """Get an authenticated session for an account."""
        if requests is None:
            logger.error("requests library not installed")
            return None

        # Determine which account to use
        if account is None:
            if self.account_pool:
                account = self.account_pool.get_healthy_account()
            elif self.accounts:
                account = self.accounts[0]

        if account is None:
            # Try browser cookies
            return self._session_from_browser()

        # Try to load existing session
        session_data = self.store.load_session(self.service, account.email)

        if session_data and session_data.get('cookies'):
            session = requests.Session()
            self.cookie_manager.apply_to_session(session, session_data['cookies'])

            # Validate session if we have a refresher
            if self.auth_refresher and self.auto_refresh:
                health = self.auth_refresher.validate_session(session)
                if health.is_valid:
                    return session
                logger.info(f"Session for {account.email} expired, re-authenticating")

        # Need to authenticate
        return self._authenticate(account)

    def _session_from_browser(self) -> Optional['requests.Session']:
        """Create session from browser cookies."""
        if requests is None:
            return None

        cookies = self.cookie_manager.extract_from_all_browsers()
        if not cookies:
            logger.warning(f"No browser cookies found for {self.service}")
            return None

        session = requests.Session()
        self.cookie_manager.apply_to_session(session, cookies)

        # Save for persistence
        self.cookie_manager.save('browser', cookies, self.session_ttl_hours)

        return session

    def _authenticate(self, account: Account) -> Optional['requests.Session']:
        """Authenticate and create a new session."""
        if requests is None or not self.auth_refresher:
            return None

        result = self.auth_refresher.login(account)
        if not result:
            if self.account_pool:
                self.account_pool.report_failure(account)
            return None

        # Create session with new cookies
        session = requests.Session()
        cookies = result.get('cookies', {})
        self.cookie_manager.apply_to_session(session, cookies)

        # Save session
        self.store.save_session(
            self.service, account.email,
            cookies=cookies,
            expires_at=datetime.now() + timedelta(hours=self.session_ttl_hours)
        )

        if self.account_pool:
            self.account_pool.report_success(account)

        return session

    def get_healthy_session(self) -> Optional['requests.Session']:
        """Get a session from a healthy account (for multi-account setups)."""
        if self.account_pool:
            account = self.account_pool.get_healthy_account()
            if account:
                return self.get_session(account)
        return self.get_session()

    def report_request_success(self, account: Optional[Account] = None):
        """Report successful request."""
        if self.account_pool and account:
            self.account_pool.report_success(account)

    def report_request_failure(self, account: Optional[Account] = None, is_ban: bool = False):
        """Report failed request."""
        if self.account_pool and account:
            self.account_pool.report_failure(account, is_ban)

    def get_pool_stats(self) -> Optional[Dict[str, Any]]:
        """Get account pool statistics."""
        if self.account_pool:
            return self.account_pool.get_stats()
        return None

    def cleanup(self):
        """Cleanup expired sessions and reset cooldowns."""
        self.store.cleanup_expired()


# =============================================================================
# Convenience Functions
# =============================================================================

def create_session_manager(
    service: str,
    accounts: Optional[List[Dict[str, str]]] = None,
    **kwargs
) -> SessionManager:
    """Convenience function to create a session manager."""
    account_list = None
    if accounts:
        account_list = [
            Account(email=a['email'], password=a['password'])
            for a in accounts
        ]
    return SessionManager(service, accounts=account_list, **kwargs)


def get_authenticated_session(
    service: str,
    email: Optional[str] = None,
    password: Optional[str] = None
) -> Optional['requests.Session']:
    """Convenience function to get an authenticated session."""
    accounts = None
    if email and password:
        accounts = [Account(email=email, password=password)]

    manager = SessionManager(service, accounts=accounts)
    return manager.get_session()
