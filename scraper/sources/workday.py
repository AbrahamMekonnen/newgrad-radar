"""Workday ATS scraper.

Workday is used by many Fortune 500 companies. Each company has their own
Workday instance at: {company}.wd{1-5}.myworkdayjobs.com

The API endpoint is: POST /wday/cxs/{tenant}/External/jobs
No authentication required for public job listings.

Upgraded to use production infrastructure:
- StealthSession for anti-detection
- CircuitBreaker for rate limit handling
- ResponseCache for caching
- CheckpointManager for resumable scraping

Uses unified infrastructure from scraper_infra.py when available.
"""

import time
from datetime import datetime
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

try:
    import requests
except ImportError:
    requests = None

from config import REQUEST_TIMEOUT

# Infrastructure availability flag
INFRA_AVAILABLE = False

# Import production infrastructure utilities
try:
    from scraper.utils.anti_detection import StealthSession, create_stealth_session, UserAgentRotator
    from scraper.utils.rate_limiter import CircuitBreaker, CircuitState, get_circuit_registry
    from scraper.utils.cache import ResponseCache, get_cache
    from scraper.utils.error_handler import CheckpointManager, RetryManager, RetryConfig
    from scraper.utils.monitoring import MetricsCollector, monitor_scraper
    INFRA_AVAILABLE = True
except ImportError:
    try:
        # Fallback to relative imports when running from scraper directory
        from utils.anti_detection import StealthSession, create_stealth_session, UserAgentRotator
        from utils.rate_limiter import CircuitBreaker, CircuitState, get_circuit_registry
        from utils.cache import ResponseCache, get_cache
        from utils.error_handler import CheckpointManager, RetryManager, RetryConfig
        from utils.monitoring import MetricsCollector, monitor_scraper
        INFRA_AVAILABLE = True
    except ImportError:
        pass

# Alias used throughout this module (kept in sync with INFRA_AVAILABLE)
HAS_INFRASTRUCTURE = INFRA_AVAILABLE


def wait_for_rate_limit(domain: str = "") -> None:
    """Best-effort per-request pacing fallback."""
    time.sleep(0.4)


def get_stealth_headers(url: str = "") -> dict:
    """Return browser-like request headers (fallback)."""
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
    }


@dataclass
class WorkdayConfig:
    """Configuration for a Workday company instance."""
    subdomain: str
    datacenter: int
    tenant: str
    display_name: str
    site: str = "External"  # the career-site path segment; varies per tenant


# Known Workday company configurations
WORKDAY_COMPANIES = [
    # Verified live against the Workday CXS API (subdomain, datacenter,
    # tenant, display_name, site). Each site path was auto-discovered — they
    # differ per tenant (nvidiaexternalcareersite, External_Career_Site, jobs...).
    WorkdayConfig('nvidia', 5, 'nvidia', 'NVIDIA', 'nvidiaexternalcareersite'),  # ~2000 jobs
    WorkdayConfig('target', 5, 'target', 'Target', 'targetcareers'),  # ~2000 jobs
    WorkdayConfig('tmobile', 1, 'tmobile', 'T-Mobile', 'External'),  # ~2000 jobs
    WorkdayConfig('salesforce', 12, 'salesforce', 'Salesforce', 'External_Career_Site'),  # ~1445 jobs
    WorkdayConfig('cisco', 5, 'cisco', 'Cisco', 'cisco_careers'),  # ~1331 jobs
    WorkdayConfig('caterpillar', 5, 'cat', 'Caterpillar', 'caterpillarcareers'),  # ~885 jobs
    WorkdayConfig('fidelity', 1, 'fmr', 'Fidelity', 'fidelitycareers'),  # ~633 jobs
    WorkdayConfig('pfizer', 1, 'pfizer', 'Pfizer', 'pfizercareers'),  # ~577 jobs
    WorkdayConfig('vanguard', 5, 'vanguard', 'Vanguard', 'vanguard_external'),  # ~433 jobs
    WorkdayConfig('crowdstrike', 5, 'crowdstrike', 'CrowdStrike', 'crowdstrikecareers'),  # ~393 jobs
    WorkdayConfig('shell', 3, 'shell', 'Shell', 'shellcareers'),  # ~140 jobs
    WorkdayConfig('paypal', 1, 'paypal', 'PayPal', 'jobs'),  # ~134 jobs
    WorkdayConfig('chevron', 5, 'chevron', 'Chevron', 'jobs'),  # ~124 jobs
    WorkdayConfig('cadence', 1, 'cadence', 'Cadence', 'University_Talent_NCG'),  # ~3 jobs
    WorkdayConfig('micron', 1, 'micron', 'Micron', 'External'),  # ~2917 jobs
    WorkdayConfig('synnex', 5, 'synnex', 'Hyve (Synnex)', 'hyvecareers'),  # ~468 jobs
    WorkdayConfig('hpe', 5, 'hpe', 'HPE', 'acjobsite'),  # ~1294 jobs
    WorkdayConfig('kla', 1, 'kla', 'KLA', 'Search'),  # ~999 jobs
    WorkdayConfig('collegeboard', 1, 'collegeboard', 'College Board', 'Careers'),  # ~37 jobs
    WorkdayConfig('visa', 5, 'visa', 'Visa', 'Visa_Early_Careers'),  # ~20 jobs
    WorkdayConfig('aig', 1, 'aig', 'AIG', 'aig'),  # ~493 jobs
    WorkdayConfig('amat', 1, 'amat', 'Applied Materials', 'External'),  # ~2000 jobs
    WorkdayConfig('thomsonreuters', 5, 'thomsonreuters', 'Thomson Reuters', 'External_Career_Site'),  # ~438 jobs
    WorkdayConfig('devonenergy', 5, 'devonenergy', 'Devon Energy', 'Careers'),  # ~53 jobs
    WorkdayConfig('barclays', 3, 'barclays', 'Barclays', 'External_Career_Site_Barclays'),  # ~980 jobs
    WorkdayConfig('blackstone', 1, 'blackstone', 'Blackstone', 'Blackstone_Careers'),  # ~177 jobs
    WorkdayConfig('spgi', 5, 'spgi', 'S&P Global', 'SPGI_Careers'),  # ~300 jobs
    WorkdayConfig('capgroup', 1, 'capgroup', 'Capital Group', 'capitalgroupcareers'),  # ~154 jobs
    WorkdayConfig('uline', 1, 'uline', 'Uline', 'Uline_Careers'),  # ~428 jobs
    WorkdayConfig('aspentech', 5, 'aspentech', 'AspenTech', 'AspenTech'),  # ~137 jobs
    WorkdayConfig('becu', 1, 'becu', 'BECU', 'External'),  # ~20 jobs
    WorkdayConfig('connexuscu', 1, 'connexuscu', 'Connexus', 'connexuscareers'),  # ~13 jobs
    WorkdayConfig('nasdaq', 1, 'nasdaq', 'Nasdaq', 'Global_External_Site'),  # ~175 jobs
    WorkdayConfig('workiva', 503, 'workiva', 'Workiva', 'careers'),  # ~110 jobs
    WorkdayConfig('avav', 1, 'avav', 'AeroVironment', 'AVAV'),  # ~362 jobs
    WorkdayConfig('snc', 1, 'snc', 'Sierra Nevada', 'SNC_External_Career_Site'),  # ~361 jobs
    WorkdayConfig('ntst', 1, 'ntst', 'Netsmart', 'Careers'),  # ~58 jobs
    WorkdayConfig('bah', 1, 'bah', 'Booz Allen Hamilton', 'BAH_Jobs'),  # ~2000 jobs
    WorkdayConfig('zendesk', 1, 'zendesk', 'Zendesk', 'zendesk'),  # ~88 jobs
    WorkdayConfig('shipt', 1, 'shipt', 'Shipt', 'Shipt_External'),  # ~8 jobs
    WorkdayConfig('worldpay', 5, 'worldpay', 'Worldpay', 'Worldpay_External_Careers_Site'),  # ~207 jobs
    WorkdayConfig('quickenloans', 5, 'quickenloans', 'Rocket', 'rocket_careers'),  # ~381 jobs
    WorkdayConfig('bloomberg', 1, 'bloomberg', 'Bloomberg', 'Bloombergindustrygroup_External_Career_Site'),  # ~65 jobs
    WorkdayConfig('csiweb', 1, 'csiweb', 'CSI', 'csi_careers'),  # ~18 jobs
    WorkdayConfig('modernatx', 1, 'modernatx', 'Moderna', 'M_tx'),  # ~192 jobs
    WorkdayConfig('owensminor', 1, 'owensminor', 'Owens & Minor', 'OMCareers'),  # ~152 jobs
    WorkdayConfig('dupont', 5, 'dupont', 'DuPont', 'Jobs'),  # ~210 jobs
    WorkdayConfig('qnity', 503, 'qnity', 'Qnity', 'jobs'),  # ~426 jobs
]


class WorkdayScraper:
    """Enhanced Workday scraper with anti-detection and caching."""

    def __init__(self, use_stealth: bool = True, use_cache: bool = True):
        # Use legacy infrastructure for components that aren't in unified infra
        self.use_stealth = use_stealth and HAS_INFRASTRUCTURE
        self.use_cache = use_cache and HAS_INFRASTRUCTURE

        # Initialize legacy infrastructure
        if self.use_stealth:
            self.stealth = create_stealth_session(
                min_delay=1.5,
                max_delay=4.0,
                requests_per_minute=15  # Conservative for Workday
            )
        else:
            self.stealth = None

        if self.use_cache:
            self.cache = get_cache()
        else:
            self.cache = None

        # Circuit breaker for each Workday instance (legacy)
        if HAS_INFRASTRUCTURE:
            self.circuit_registry = get_circuit_registry()
        else:
            self.circuit_registry = None

        # Checkpoint manager for resume capability (legacy)
        if HAS_INFRASTRUCTURE:
            self.checkpoint = CheckpointManager('workday_scraper')
        else:
            self.checkpoint = None

        # Retry manager (legacy)
        if HAS_INFRASTRUCTURE:
            self.retry = RetryManager(RetryConfig(max_retries=3, base_delay=2.0))
        else:
            self.retry = None

    def _get_circuit_key(self, config: WorkdayConfig) -> str:
        return f"workday_{config.subdomain}_{config.tenant}"

    def _check_circuit(self, config: WorkdayConfig) -> bool:
        """Check if circuit breaker allows request."""
        if not self.circuit_registry:
            return True
        circuit = self.circuit_registry.get(self._get_circuit_key(config))
        return circuit.allow_request()

    def _record_circuit_result(self, config: WorkdayConfig, success: bool) -> None:
        """Record result to circuit breaker."""
        if not self.circuit_registry:
            return
        circuit = self.circuit_registry.get(self._get_circuit_key(config))
        if success:
            circuit.record_success()
        else:
            circuit.record_failure()

    def _get_stealth_headers(self) -> Dict[str, str]:
        """Get stealth headers for request."""
        # Prefer unified infrastructure
        if INFRA_AVAILABLE:
            headers = get_stealth_headers("https://workday.com")
            headers["Content-Type"] = "application/json"
            headers["Accept"] = "application/json"
            return headers
        # Fallback to legacy infrastructure
        if self.stealth:
            config = self.stealth.get_request_config("https://workday.com")
            headers = config.get('headers', {})
            headers["Content-Type"] = "application/json"
            headers["Accept"] = "application/json"
            return headers
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }

    def _apply_rate_limit(self, config: WorkdayConfig = None) -> None:
        """Apply stealth delay before request."""
        # Prefer unified infrastructure
        if INFRA_AVAILABLE:
            domain = f"{config.subdomain}.wd{config.datacenter}.myworkdayjobs.com" if config else "myworkdayjobs.com"
            wait_for_rate_limit(domain)
        elif self.stealth:
            self.stealth.before_request()
        else:
            import random
            time.sleep(1.5 + 0.5 * (2 * random.random() - 1))

    def _build_url(self, config: WorkdayConfig) -> str:
        """Build the Workday jobs API URL."""
        return f"https://{config.subdomain}.wd{config.datacenter}.myworkdayjobs.com/wday/cxs/{config.tenant}/{config.site}/jobs"

    def _build_job_url(self, config: WorkdayConfig, job_path: str) -> str:
        """Build the URL for a specific job posting."""
        base = f"https://{config.subdomain}.wd{config.datacenter}.myworkdayjobs.com/en-US/{config.tenant}/job"
        if job_path.startswith("/"):
            job_path = job_path[1:]
        if job_path.startswith("job/"):
            job_path = job_path[4:]
        return f"{base}/{job_path}"

    def _parse_date(self, date_str: Optional[str]) -> Optional[str]:
        """Parse Workday date format to ISO string."""
        if not date_str:
            return None
        if "ago" in date_str.lower() or "posted" in date_str.lower():
            return None
        try:
            if "T" in date_str:
                dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            else:
                dt = datetime.fromisoformat(date_str)
            return dt.isoformat()
        except (ValueError, AttributeError):
            return None

    def fetch_company(
        self,
        config: WorkdayConfig,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Fetch jobs from a single Workday instance with infrastructure support."""
        if not requests:
            print("requests module not available")
            return []

        # Check circuit breaker
        if not self._check_circuit(config):
            print(f"Circuit open for {config.display_name}, skipping")
            return []

        url = self._build_url(config)

        # Check cache first
        cache_key = f"workday:{config.subdomain}:{config.tenant}:{offset}:{limit}"
        if self.cache:
            try:
                cached = self.cache.get(cache_key)
            except Exception:
                cached = None
            if cached:
                # We store {"content": [jobs...]}; unwrap to the job list.
                if isinstance(cached, dict) and "content" in cached:
                    cached = cached["content"]
                if isinstance(cached, list):
                    return cached

        # Get stealth headers
        headers = self._get_stealth_headers()
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        self._apply_rate_limit(config)

        # Workday's CXS API caps `limit` at 20 per request (>20 returns HTTP
        # 400), so page through in chunks of 20 up to the requested total.
        PAGE = 20
        want = max(1, limit)
        all_postings: List[Dict[str, Any]] = []
        cur = offset
        try:
            while len(all_postings) < want:
                payload = {
                    "appliedFacets": {},
                    "limit": min(PAGE, want - len(all_postings)),
                    "offset": cur,
                    "searchText": "",
                }

                def _do_request(_pl=payload):
                    response = requests.post(url, json=_pl, headers=headers, timeout=REQUEST_TIMEOUT)
                    response.raise_for_status()
                    return response.json()

                page = self.retry.execute(_do_request) if self.retry else _do_request()
                postings = page.get("jobPostings", []) or []
                all_postings.extend(postings)
                total = page.get("total", 0)
                cur += PAGE
                if not postings or cur >= total:
                    break
                self._apply_rate_limit(config)

            self._record_circuit_result(config, True)
            if self.stealth:
                self.stealth.after_request(200)

        except requests.RequestException as e:
            print(f"Error fetching Workday {config.display_name}: {e}")
            self._record_circuit_result(config, False)
            if self.stealth:
                self.stealth.after_request(getattr(e.response, 'status_code', 500) if hasattr(e, 'response') else 500)
            return []
        except Exception as e:
            print(f"Error parsing Workday {config.display_name}: {e}")
            self._record_circuit_result(config, False)
            return []

        data = {"jobPostings": all_postings}
        jobs = []
        job_postings = data.get("jobPostings", [])

        for job in job_postings:
            location = ""
            if "locationsText" in job:
                location = job["locationsText"]
            elif "locations" in job and job["locations"]:
                if isinstance(job["locations"], list):
                    location = ", ".join(job["locations"][:3])
                else:
                    location = str(job["locations"])

            external_path = job.get("externalPath", "")
            if external_path:
                job_url = self._build_job_url(config, external_path)
            else:
                job_url = f"https://{config.subdomain}.wd{config.datacenter}.myworkdayjobs.com/en-US/{config.tenant}/job/{job.get('bulletFields', [''])[0]}"

            posted = self._parse_date(job.get("postedOn"))

            jobs.append({
                "company": config.display_name,
                "title": job.get("title", ""),
                "location": location,
                "url": job_url,
                "apply_url": job_url,
                "posted": posted,
                "source": "workday",
                "external_id": job.get("bulletFields", [""])[0] if job.get("bulletFields") else "",
            })

        # Cache results (best-effort — the shared ResponseCache expects a
        # dict-shaped payload; never let a cache quirk drop fetched jobs).
        if self.cache and jobs:
            try:
                self.cache.set(cache_key, {"content": jobs})
            except Exception:
                pass

        return jobs

    def fetch_all(self, limit_per_company: int = 50, resume: bool = True) -> List[Dict[str, Any]]:
        """Fetch jobs from all known Workday companies with resume capability."""
        # Use monitoring context manager if available
        if INFRA_AVAILABLE:
            with monitor_scraper('workday_all') as ctx:
                return self._fetch_all_impl(limit_per_company, resume, ctx)
        else:
            return self._fetch_all_impl(limit_per_company, resume, None)

    def _fetch_all_impl(self, limit_per_company: int, resume: bool, ctx) -> List[Dict[str, Any]]:
        """Internal implementation of fetch_all."""
        all_jobs = []

        # Load checkpoint if resuming
        completed_companies = set()
        if resume and self.checkpoint:
            state = self.checkpoint.load('workday_scraper', 'all')
            if state:
                completed_companies = set(state.progress.get('completed', []))

        for config in WORKDAY_COMPANIES:
            company_key = f"{config.subdomain}:{config.tenant}"

            # Skip if already completed
            if company_key in completed_companies:
                continue

            # Record request if monitoring context available
            if ctx:
                ctx.record_request(success=True)

            jobs = self.fetch_company(config, limit=limit_per_company)
            all_jobs.extend(jobs)
            print(f"Fetched {len(jobs)} jobs from {config.display_name}")

            # Save checkpoint
            if self.checkpoint:
                completed_companies.add(company_key)
                self.checkpoint.update_progress(
                    scraper_id='workday_scraper',
                    source_name='all',
                    items_processed=len(all_jobs),
                    progress={'completed': list(completed_companies)}
                )

        # Record jobs found via monitoring
        if ctx:
            ctx.record_questions(extracted=len(all_jobs), new=len(all_jobs))

        # Clear checkpoint on success
        if self.checkpoint and len(all_jobs) > 0:
            self.checkpoint.clear('workday_scraper', 'all')

        return all_jobs


# Global scraper instance
_scraper: Optional[WorkdayScraper] = None


def get_scraper() -> WorkdayScraper:
    """Get or create global scraper instance."""
    global _scraper
    if _scraper is None:
        _scraper = WorkdayScraper()
    return _scraper


# ============================================================================
# Legacy API (backward compatible)
# ============================================================================

def parse_workday_date(date_str: Optional[str]) -> Optional[str]:
    """Parse Workday date format to ISO string."""
    return WorkdayScraper()._parse_date(date_str)


def build_workday_url(subdomain: str, datacenter: int, tenant: str) -> str:
    """Build the Workday jobs API URL."""
    return f"https://{subdomain}.wd{datacenter}.myworkdayjobs.com/wday/cxs/{tenant}/External/jobs"


def build_job_url(subdomain: str, datacenter: int, tenant: str, job_path: str) -> str:
    """Build the URL for a specific job posting."""
    base = f"https://{subdomain}.wd{datacenter}.myworkdayjobs.com/en-US/{tenant}/job"
    if job_path.startswith("/"):
        job_path = job_path[1:]
    if job_path.startswith("job/"):
        job_path = job_path[4:]
    return f"{base}/{job_path}"


def fetch_workday_company(
    subdomain: str,
    datacenter: int,
    tenant: str,
    company_name: str,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict]:
    """Fetch jobs from a single Workday instance (legacy API)."""
    config = WorkdayConfig(subdomain, datacenter, tenant, company_name)
    return get_scraper().fetch_company(config, limit, offset)


def fetch_workday_all(limit_per_company: int = 50) -> List[Dict]:
    """Fetch jobs from all known Workday companies (legacy API)."""
    return get_scraper().fetch_all(limit_per_company)


def fetch_workday(
    subdomain: str = None,
    datacenter: int = None,
    tenant: str = None,
    company_name: str = None,
) -> List[Dict]:
    """Fetch jobs from Workday (legacy API)."""
    if subdomain and datacenter and tenant:
        return fetch_workday_company(
            subdomain=subdomain,
            datacenter=datacenter,
            tenant=tenant,
            company_name=company_name or subdomain,
        )
    else:
        return fetch_workday_all()


# Company-specific convenience functions
def fetch_workday_amazon() -> List[Dict]:
    return fetch_workday_company("amazon", 5, "amazon", "Amazon")


def fetch_workday_salesforce() -> List[Dict]:
    return fetch_workday_company("salesforce", 3, "salesforce", "Salesforce")


def fetch_workday_nvidia() -> List[Dict]:
    return fetch_workday_company("nvidia", 5, "nvidia", "NVIDIA")


def fetch_workday_adobe() -> List[Dict]:
    return fetch_workday_company("adobe", 1, "adobe", "Adobe")


def fetch_workday_visa() -> List[Dict]:
    return fetch_workday_company("visa", 5, "visa", "Visa")


def fetch_workday_jpmorgan() -> List[Dict]:
    return fetch_workday_company("jpmorgan", 5, "jpmc", "JPMorgan Chase")
