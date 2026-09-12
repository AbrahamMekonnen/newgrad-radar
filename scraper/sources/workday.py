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


@dataclass
class WorkdayConfig:
    """Configuration for a Workday company instance."""
    subdomain: str
    datacenter: int
    tenant: str
    display_name: str


# Known Workday company configurations
WORKDAY_COMPANIES = [
    # Tech Giants
    WorkdayConfig("amazon", 5, "amazon", "Amazon"),
    WorkdayConfig("salesforce", 3, "salesforce", "Salesforce"),
    WorkdayConfig("adobe", 1, "adobe", "Adobe"),
    WorkdayConfig("nvidia", 5, "nvidia", "NVIDIA"),
    WorkdayConfig("qualcomm", 5, "qualcomm", "Qualcomm"),
    WorkdayConfig("cisco", 5, "cisco", "Cisco"),
    WorkdayConfig("vmware", 2, "broadcom", "VMware"),
    WorkdayConfig("broadcom", 2, "broadcom", "Broadcom"),
    WorkdayConfig("servicenow", 1, "servicenow", "ServiceNow"),
    WorkdayConfig("intuit", 1, "intuit", "Intuit"),
    WorkdayConfig("autodesk", 1, "autodesk", "Autodesk"),
    WorkdayConfig("atlassian", 5, "atlassian", "Atlassian"),
    WorkdayConfig("zendesk", 1, "zendesk", "Zendesk"),
    WorkdayConfig("splunk", 1, "splunk", "Splunk"),
    WorkdayConfig("paloaltonetworks", 1, "paloaltonetworks", "Palo Alto Networks"),
    WorkdayConfig("docusign", 1, "docusign", "DocuSign"),
    WorkdayConfig("okta", 1, "okta", "Okta"),
    WorkdayConfig("crowdstrike", 1, "crowdstrike", "CrowdStrike"),
    WorkdayConfig("twilio", 1, "twilio", "Twilio"),
    WorkdayConfig("fortinet", 1, "fortinet", "Fortinet"),
    WorkdayConfig("akamai", 1, "akamai", "Akamai"),
    WorkdayConfig("netapp", 1, "netapp", "NetApp"),
    WorkdayConfig("f5", 1, "f5", "F5"),

    # Finance / Fintech
    WorkdayConfig("jpmorgan", 5, "jpmc", "JPMorgan Chase"),
    WorkdayConfig("bankofamerica", 5, "ghr", "Bank of America"),
    WorkdayConfig("goldmansachs", 2, "gs", "Goldman Sachs"),
    WorkdayConfig("morganstanley", 5, "mscareers", "Morgan Stanley"),
    WorkdayConfig("blackrock", 3, "blackrock", "BlackRock"),
    WorkdayConfig("capitalgroup", 1, "capitalgroup", "Capital Group"),
    WorkdayConfig("visa", 5, "visa", "Visa"),
    WorkdayConfig("mastercard", 5, "mastercard", "Mastercard"),
    WorkdayConfig("paypal", 1, "paypal", "PayPal"),
    WorkdayConfig("square", 2, "block", "Block (Square)"),
    WorkdayConfig("fidelity", 1, "fmr", "Fidelity"),
    WorkdayConfig("vanguard", 1, "vanguard", "Vanguard"),
    WorkdayConfig("schwab", 1, "schwab", "Charles Schwab"),
    WorkdayConfig("americanexpress", 5, "aexp", "American Express"),

    # Healthcare / Pharma
    WorkdayConfig("unitedhealth", 2, "uhg", "UnitedHealth Group"),
    WorkdayConfig("jnj", 5, "jnjfamilyofcompanies", "Johnson & Johnson"),
    WorkdayConfig("pfizer", 1, "pfizer", "Pfizer"),
    WorkdayConfig("merck", 1, "msd", "Merck"),
    WorkdayConfig("abbvie", 1, "abbvie", "AbbVie"),
    WorkdayConfig("bms", 5, "bms", "Bristol-Myers Squibb"),
    WorkdayConfig("lilly", 1, "lilly", "Eli Lilly"),
    WorkdayConfig("elevancehealth", 1, "anthemcareers", "Elevance Health"),
    WorkdayConfig("cvs", 1, "cvshealth", "CVS Health"),

    # Retail / Consumer
    WorkdayConfig("walmart", 5, "walmartexternal", "Walmart"),
    WorkdayConfig("target", 5, "target", "Target"),
    WorkdayConfig("homedepot", 5, "careers-homedepot", "Home Depot"),
    WorkdayConfig("lowes", 1, "lowes", "Lowes"),
    WorkdayConfig("costco", 1, "costco", "Costco"),
    WorkdayConfig("nike", 5, "nike", "Nike"),
    WorkdayConfig("starbucks", 5, "starbucks", "Starbucks"),
    WorkdayConfig("disney", 1, "disney", "Disney"),
    WorkdayConfig("pg", 5, "pg", "Procter & Gamble"),
    WorkdayConfig("coca-cola", 1, "cocacola", "Coca-Cola"),
    WorkdayConfig("pepsico", 1, "pepsico", "PepsiCo"),
    WorkdayConfig("unilever", 1, "unilever", "Unilever"),

    # Consulting / Services
    WorkdayConfig("deloitte", 1, "deloitte", "Deloitte"),
    WorkdayConfig("mckinsey", 5, "mckinsey", "McKinsey"),
    WorkdayConfig("accenture", 5, "accenture", "Accenture"),
    WorkdayConfig("ey", 5, "ey", "EY"),
    WorkdayConfig("pwc", 1, "pwc", "PwC"),
    WorkdayConfig("kpmg", 5, "kpmg", "KPMG"),
    WorkdayConfig("bcg", 1, "bcg", "Boston Consulting Group"),
    WorkdayConfig("bain", 1, "bain", "Bain & Company"),

    # Industrial / Manufacturing
    WorkdayConfig("ge", 5, "ge", "GE"),
    WorkdayConfig("boeing", 5, "boeing", "Boeing"),
    WorkdayConfig("lockheedmartin", 5, "lockheed", "Lockheed Martin"),
    WorkdayConfig("raytheon", 5, "rtx", "Raytheon"),
    WorkdayConfig("northropgrumman", 5, "northropgrumman", "Northrop Grumman"),
    WorkdayConfig("3m", 5, "3m", "3M"),
    WorkdayConfig("honeywell", 5, "honeywell", "Honeywell"),
    WorkdayConfig("caterpillar", 1, "cat", "Caterpillar"),
    WorkdayConfig("deere", 5, "johndeere", "John Deere"),

    # Energy / Utilities
    WorkdayConfig("exxonmobil", 5, "exxonmobil", "ExxonMobil"),
    WorkdayConfig("chevron", 5, "chevron", "Chevron"),
    WorkdayConfig("conocophillips", 1, "conoco", "ConocoPhillips"),
    WorkdayConfig("shell", 5, "shell", "Shell"),
    WorkdayConfig("bp", 5, "bp", "BP"),

    # Telecom / Media
    WorkdayConfig("att", 5, "att", "AT&T"),
    WorkdayConfig("verizon", 1, "vzn", "Verizon"),
    WorkdayConfig("tmobile", 5, "tmobile", "T-Mobile"),
    WorkdayConfig("comcast", 5, "comcast", "Comcast"),
    WorkdayConfig("wbd", 1, "wbd", "Warner Bros. Discovery"),
    WorkdayConfig("paramount", 1, "paramount", "Paramount"),
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
        circuit = self.circuit_registry.get_or_create(self._get_circuit_key(config))
        return circuit.allow_request()

    def _record_circuit_result(self, config: WorkdayConfig, success: bool) -> None:
        """Record result to circuit breaker."""
        if not self.circuit_registry:
            return
        circuit = self.circuit_registry.get_or_create(self._get_circuit_key(config))
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
        return f"https://{config.subdomain}.wd{config.datacenter}.myworkdayjobs.com/wday/cxs/{config.tenant}/External/jobs"

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
            cached = self.cache.get(cache_key)
            if cached:
                return cached

        # Get stealth headers
        headers = self._get_stealth_headers()
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        payload = {
            "appliedFacets": {},
            "limit": limit,
            "offset": offset,
            "searchText": "",
        }

        # Apply rate limiting
        self._apply_rate_limit(config)

        def _do_request():
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=REQUEST_TIMEOUT
            )
            response.raise_for_status()
            return response.json()

        try:
            if self.retry:
                data = self.retry.execute(_do_request)
            else:
                data = _do_request()

            # Record success
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

        # Cache results
        if self.cache and jobs:
            self.cache.set(cache_key, jobs, ttl=3600)

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
