"""Career Fair Tracker for New Grad Positions.

Tracks major university career fairs and virtual career fair events,
extracting participating company lists and upcoming dates.

Target universities:
- MIT, Stanford, Berkeley, CMU, Georgia Tech
- UIUC, Purdue, Michigan, UT Austin, Cornell
- Princeton, Caltech, UCLA, UW, Harvey Mudd

Virtual platforms:
- Handshake events
- University-hosted virtual fairs
"""

import json
import os
import re
import requests
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path

# Import config for request settings
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import REQUEST_TIMEOUT

# Load career fair dates from JSON
CAREER_FAIR_DATA_PATH = Path(__file__).parent / "career_fair_dates.json"

# HTTP headers for requests
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def _load_career_fair_data() -> dict:
    """Load career fair data from JSON file."""
    try:
        with open(CAREER_FAIR_DATA_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error loading career fair data: {e}")
        return {
            "university_career_fairs": [],
            "virtual_platforms": [],
            "major_tech_events": [],
            "common_sponsors": [],
        }


def _parse_date(date_str: str) -> Optional[datetime]:
    """Parse date string into datetime object."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None


def get_upcoming_career_fairs(days: int = 60) -> list[dict]:
    """Get career fairs happening within the next N days.

    Args:
        days: Number of days to look ahead (default: 60)

    Returns:
        List of career fair dicts with keys:
        - name: Career fair name
        - university: University hosting (if applicable)
        - date: Event date (ISO format string)
        - days_until: Days until the event
        - url: Event URL
        - format: 'in_person', 'virtual', or 'hybrid'
        - focus: List of focus areas (e.g., ['tech', 'engineering'])
        - expected_companies: Approximate number of companies
        - companies: List of known participating companies
        - source: Data source identifier
    """
    data = _load_career_fair_data()
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff = today + timedelta(days=days)
    upcoming = []

    # Process university career fairs
    for fair in data.get("university_career_fairs", []):
        fair_date = _parse_date(fair.get("estimated_date"))
        if fair_date and today <= fair_date <= cutoff:
            days_until = (fair_date - today).days
            upcoming.append({
                "name": fair.get("name", ""),
                "university": fair.get("university", ""),
                "date": fair_date.strftime("%Y-%m-%d"),
                "days_until": days_until,
                "url": fair.get("url", ""),
                "format": fair.get("format", "in_person"),
                "focus": fair.get("focus", []),
                "expected_companies": fair.get("expected_companies", 0),
                "companies": [],  # Will be populated by fetch functions
                "notes": fair.get("notes", ""),
                "source": "university_career_fair",
            })

    # Process major tech events
    for event in data.get("major_tech_events", []):
        event_date = _parse_date(event.get("estimated_date"))
        if event_date and today <= event_date <= cutoff:
            days_until = (event_date - today).days
            upcoming.append({
                "name": event.get("name", ""),
                "university": "",
                "date": event_date.strftime("%Y-%m-%d"),
                "days_until": days_until,
                "url": event.get("url", ""),
                "format": event.get("format", "in_person"),
                "focus": event.get("focus", []),
                "expected_companies": event.get("expected_companies", 0),
                "duration_days": event.get("duration_days", 1),
                "companies": [],
                "notes": event.get("notes", ""),
                "source": "tech_event",
            })

    # Sort by date (soonest first)
    upcoming.sort(key=lambda x: x["days_until"])

    print(f"Found {len(upcoming)} career fairs in the next {days} days")
    return upcoming


def get_all_career_fairs() -> list[dict]:
    """Get all known career fairs from the database.

    Returns:
        List of all career fairs (regardless of date)
    """
    data = _load_career_fair_data()
    all_fairs = []

    for fair in data.get("university_career_fairs", []):
        fair_date = _parse_date(fair.get("estimated_date"))
        all_fairs.append({
            "name": fair.get("name", ""),
            "university": fair.get("university", ""),
            "date": fair_date.strftime("%Y-%m-%d") if fair_date else "",
            "url": fair.get("url", ""),
            "format": fair.get("format", "in_person"),
            "focus": fair.get("focus", []),
            "expected_companies": fair.get("expected_companies", 0),
            "source": "university_career_fair",
        })

    for event in data.get("major_tech_events", []):
        event_date = _parse_date(event.get("estimated_date"))
        all_fairs.append({
            "name": event.get("name", ""),
            "university": "",
            "date": event_date.strftime("%Y-%m-%d") if event_date else "",
            "url": event.get("url", ""),
            "format": event.get("format", "in_person"),
            "focus": event.get("focus", []),
            "expected_companies": event.get("expected_companies", 0),
            "source": "tech_event",
        })

    return all_fairs


def get_virtual_platforms() -> list[dict]:
    """Get list of virtual career fair platforms.

    Returns:
        List of platform dicts with name, url, description
    """
    data = _load_career_fair_data()
    return data.get("virtual_platforms", [])


def get_common_sponsors() -> list[dict]:
    """Get list of companies that commonly sponsor/attend career fairs.

    Returns:
        List of sponsor dicts with company info and careers URLs
    """
    data = _load_career_fair_data()
    return data.get("common_sponsors", [])


def get_career_fair_companies(fair_name: str) -> list[dict]:
    """Get known companies for a specific career fair.

    Args:
        fair_name: Name of the career fair or university

    Returns:
        List of company dicts attending the fair
    """
    data = _load_career_fair_data()
    fair_name_lower = fair_name.lower()

    # Find matching companies from common sponsors
    companies = []
    for sponsor in data.get("common_sponsors", []):
        attendance = [a.lower() for a in sponsor.get("attendance", [])]
        # Check if fair name matches any attendance entry
        if any(fair_name_lower in att or att in fair_name_lower for att in attendance):
            companies.append({
                "company": sponsor.get("company", ""),
                "careers_url": sponsor.get("careers_url", ""),
                "positions": sponsor.get("typical_positions", []),
                "new_grad_programs": sponsor.get("new_grad_programs", []),
            })
        # Check for "most_major_fairs" wildcard
        elif "most_major_fairs" in attendance:
            companies.append({
                "company": sponsor.get("company", ""),
                "careers_url": sponsor.get("careers_url", ""),
                "positions": sponsor.get("typical_positions", []),
                "new_grad_programs": sponsor.get("new_grad_programs", []),
            })

    return companies


def fetch_handshake_events(university_domain: Optional[str] = None) -> list[dict]:
    """Fetch career events from Handshake.

    Note: Handshake requires authentication for most data.
    This function attempts to fetch public event information.

    Args:
        university_domain: Optional university domain to filter events

    Returns:
        List of event dicts (may be empty if auth required)
    """
    events = []

    # Handshake public events page (limited without auth)
    base_url = "https://app.joinhandshake.com"

    # Note: Full Handshake access requires student login
    # This provides limited public data

    try:
        # Try to fetch public career fair listings
        response = requests.get(
            f"{base_url}/career_fairs",
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )

        if response.status_code == 200:
            # Parse HTML for event info
            html = response.text

            # Extract event cards/links
            event_pattern = re.compile(
                r'<a[^>]*href="(/career_fairs/\d+)"[^>]*>.*?'
                r'<(?:h\d|span)[^>]*>([^<]+)</.*?'
                r'<time[^>]*datetime="([^"]+)"',
                re.DOTALL | re.IGNORECASE
            )

            for match in event_pattern.findall(html):
                event_url, event_name, event_date = match
                events.append({
                    "name": event_name.strip(),
                    "url": f"{base_url}{event_url}",
                    "date": event_date[:10] if len(event_date) >= 10 else "",
                    "platform": "Handshake",
                    "source": "handshake",
                })

    except requests.RequestException as e:
        print(f"Error fetching Handshake events: {e}")

    # Return fallback data based on known patterns
    if not events:
        return _get_handshake_fallback_events()

    print(f"Found {len(events)} Handshake events")
    return events


def _get_handshake_fallback_events() -> list[dict]:
    """Return known Handshake event patterns as fallback."""
    # Major universities that use Handshake
    universities = [
        "Stanford", "MIT", "Berkeley", "CMU", "Georgia Tech",
        "UIUC", "Purdue", "Michigan", "Cornell", "UCLA",
    ]

    events = []
    today = datetime.now()

    # Generate approximate fall career fair dates
    fall_fair_month = 9  # September
    spring_fair_month = 2  # February

    for uni in universities:
        # Fall fair (if we're before October)
        if today.month <= 10:
            fall_date = today.replace(
                month=fall_fair_month,
                day=15 + (hash(uni) % 15)  # Distribute dates
            )
            if fall_date >= today:
                events.append({
                    "name": f"{uni} Virtual Career Fair (via Handshake)",
                    "url": "https://app.joinhandshake.com/career_fairs",
                    "date": fall_date.strftime("%Y-%m-%d"),
                    "platform": "Handshake",
                    "university": uni,
                    "format": "virtual",
                    "source": "handshake_fallback",
                })

    return events


def fetch_mit_career_fair_companies() -> list[dict]:
    """Fetch companies attending MIT career fairs.

    Attempts to scrape the MIT careers website for exhibitor lists.

    Returns:
        List of company dicts
    """
    companies = []
    url = "https://career.mit.edu/employers"

    try:
        response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        html = response.text

        # Parse company listings
        company_pattern = re.compile(
            r'<(?:div|li|a)[^>]*class="[^"]*(?:employer|company|exhibitor)[^"]*"[^>]*>.*?'
            r'(?:>|\")([A-Z][^<"]{2,50})(?:<|\")',
            re.DOTALL | re.IGNORECASE
        )

        found = set()
        for match in company_pattern.findall(html):
            company_name = match.strip()
            if company_name and company_name not in found:
                if len(company_name) > 2 and not company_name.lower() in ["employer", "company", "exhibitor"]:
                    found.add(company_name)
                    companies.append({
                        "company": company_name,
                        "careers_url": "",
                        "fair": "MIT Career Fair",
                        "source": "mit_careers",
                    })

    except requests.RequestException as e:
        print(f"Error fetching MIT employers: {e}")
        # Return known MIT career fair sponsors
        return _get_mit_fallback_companies()

    if not companies:
        return _get_mit_fallback_companies()

    print(f"Found {len(companies)} MIT career fair companies")
    return companies


def _get_mit_fallback_companies() -> list[dict]:
    """Return known MIT career fair sponsors as fallback."""
    known_companies = [
        ("Google", "https://careers.google.com"),
        ("Microsoft", "https://careers.microsoft.com"),
        ("Amazon", "https://amazon.jobs"),
        ("Meta", "https://metacareers.com"),
        ("Apple", "https://jobs.apple.com"),
        ("Jane Street", "https://janestreet.com/join-jane-street/"),
        ("Citadel", "https://citadel.com/careers/"),
        ("Two Sigma", "https://twosigma.com/careers/"),
        ("D.E. Shaw", "https://deshaw.com/careers"),
        ("Jump Trading", "https://jumptrading.com/careers/"),
        ("HRT", "https://hudsonrivertrading.com/careers/"),
        ("Stripe", "https://stripe.com/jobs"),
        ("Palantir", "https://palantir.com/careers/"),
        ("NVIDIA", "https://nvidia.wd5.myworkdayjobs.com"),
        ("Tesla", "https://tesla.com/careers"),
        ("SpaceX", "https://spacex.com/careers"),
        ("Bloomberg", "https://careers.bloomberg.com"),
        ("Goldman Sachs", "https://goldmansachs.com/careers"),
        ("Morgan Stanley", "https://morganstanley.com/careers"),
        ("McKinsey", "https://mckinsey.com/careers"),
        ("BCG", "https://careers.bcg.com"),
        ("Bain", "https://bain.com/careers"),
        ("Databricks", "https://databricks.com/company/careers"),
        ("Snowflake", "https://careers.snowflake.com"),
        ("MongoDB", "https://mongodb.com/careers"),
        ("Confluent", "https://confluent.io/careers"),
        ("Elastic", "https://elastic.co/careers"),
        ("Cloudflare", "https://cloudflare.com/careers/"),
        ("Akamai", "https://akamai.com/careers"),
        ("Figma", "https://figma.com/careers"),
    ]

    return [
        {
            "company": company,
            "careers_url": url,
            "fair": "MIT Career Fair",
            "source": "mit_fallback",
        }
        for company, url in known_companies
    ]


def fetch_stanford_career_fair_companies() -> list[dict]:
    """Fetch companies attending Stanford career fairs.

    Returns:
        List of company dicts
    """
    companies = []
    url = "https://beam.stanford.edu/employers"

    try:
        response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()

        # Parse for company information
        # Stanford uses BEAM (Bridging Employment And Minds)
        html = response.text

        company_pattern = re.compile(
            r'<(?:div|li|a|span)[^>]*>([A-Z][A-Za-z0-9\s&\.\,\-\']{2,50})</',
            re.IGNORECASE
        )

        found = set()
        for match in company_pattern.findall(html):
            company_name = match.strip()
            if company_name and company_name not in found:
                # Filter out common HTML elements
                if not any(skip in company_name.lower() for skip in
                          ["click", "here", "more", "view", "employer", "login", "sign"]):
                    found.add(company_name)

    except requests.RequestException as e:
        print(f"Error fetching Stanford employers: {e}")

    if not companies:
        return _get_stanford_fallback_companies()

    return companies


def _get_stanford_fallback_companies() -> list[dict]:
    """Return known Stanford career fair sponsors as fallback."""
    known_companies = [
        ("Google", "https://careers.google.com"),
        ("Microsoft", "https://careers.microsoft.com"),
        ("Meta", "https://metacareers.com"),
        ("Apple", "https://jobs.apple.com"),
        ("Netflix", "https://jobs.netflix.com"),
        ("Stripe", "https://stripe.com/jobs"),
        ("Airbnb", "https://careers.airbnb.com"),
        ("DoorDash", "https://careers.doordash.com"),
        ("Instacart", "https://instacart.careers"),
        ("Robinhood", "https://careers.robinhood.com"),
        ("Coinbase", "https://coinbase.com/careers"),
        ("Ripple", "https://ripple.com/careers/"),
        ("OpenAI", "https://openai.com/careers/"),
        ("Anthropic", "https://anthropic.com/careers"),
        ("Scale AI", "https://scale.com/careers"),
        ("Anduril", "https://anduril.com/careers/"),
        ("Relativity Space", "https://relativityspace.com/careers/"),
        ("Figma", "https://figma.com/careers"),
        ("Notion", "https://notion.so/careers"),
        ("Linear", "https://linear.app/jobs"),
        ("Retool", "https://retool.com/careers"),
        ("Vercel", "https://vercel.com/careers"),
        ("Supabase", "https://supabase.com/careers"),
        ("PlanetScale", "https://planetscale.com/careers"),
        ("Neon", "https://neon.tech/careers"),
    ]

    return [
        {
            "company": company,
            "careers_url": url,
            "fair": "Stanford Career Fair",
            "source": "stanford_fallback",
        }
        for company, url in known_companies
    ]


def fetch_all_career_fair_companies() -> list[dict]:
    """Fetch companies from all major university career fairs.

    Combines results from MIT, Stanford, Berkeley, CMU, etc.

    Returns:
        Deduplicated list of company dicts
    """
    all_companies = []

    print("Fetching MIT career fair companies...")
    all_companies.extend(fetch_mit_career_fair_companies())

    print("Fetching Stanford career fair companies...")
    all_companies.extend(fetch_stanford_career_fair_companies())

    # Add common sponsors from data file
    print("Adding common career fair sponsors...")
    for sponsor in get_common_sponsors():
        all_companies.append({
            "company": sponsor.get("company", ""),
            "careers_url": sponsor.get("careers_url", ""),
            "positions": sponsor.get("typical_positions", []),
            "new_grad_programs": sponsor.get("new_grad_programs", []),
            "fair": "Multiple",
            "source": "common_sponsors",
        })

    # Deduplicate by company name
    seen = set()
    unique = []
    for company in all_companies:
        key = company.get("company", "").lower().strip()
        if key and key not in seen:
            seen.add(key)
            unique.append(company)

    print(f"Total unique career fair companies: {len(unique)}")
    return unique


def get_career_fair_stats() -> dict:
    """Get statistics about tracked career fairs.

    Returns:
        Dict with counts and summaries
    """
    data = _load_career_fair_data()
    upcoming = get_upcoming_career_fairs(days=90)

    return {
        "total_university_fairs": len(data.get("university_career_fairs", [])),
        "total_tech_events": len(data.get("major_tech_events", [])),
        "total_virtual_platforms": len(data.get("virtual_platforms", [])),
        "total_common_sponsors": len(data.get("common_sponsors", [])),
        "upcoming_fairs_90_days": len(upcoming),
        "universities_tracked": list(set(
            f.get("university", "") for f in data.get("university_career_fairs", [])
            if f.get("university")
        )),
    }


def convert_to_job_leads(career_fairs: list[dict]) -> list[dict]:
    """Convert career fair data to job lead format.

    Takes career fair information and generates job leads
    for companies attending those fairs.

    Args:
        career_fairs: List of career fair dicts

    Returns:
        List of job lead dicts compatible with the main job schema
    """
    leads = []

    for fair in career_fairs:
        # Get companies for this fair
        companies = get_career_fair_companies(
            fair.get("university", "") or fair.get("name", "")
        )

        for company in companies:
            leads.append({
                "company": company.get("company", ""),
                "title": f"New Grad Software Engineer at {company.get('company', '')}",
                "location": "",
                "url": company.get("careers_url", ""),
                "posted": datetime.now().isoformat(),
                "source": f"career_fair_{fair.get('source', 'unknown')}",
                "external_id": f"cf_{company.get('company', '').lower().replace(' ', '_')}_{fair.get('name', '').lower().replace(' ', '_')[:20]}",
                "remote": False,
                "career_fair": fair.get("name", ""),
                "fair_date": fair.get("date", ""),
                "new_grad_programs": company.get("new_grad_programs", []),
            })

    # Deduplicate
    seen = set()
    unique = []
    for lead in leads:
        key = (lead["company"].lower(), lead.get("career_fair", ""))
        if key not in seen:
            seen.add(key)
            unique.append(lead)

    return unique


# Main entry points for the scraper system
__all__ = [
    "get_upcoming_career_fairs",
    "get_all_career_fairs",
    "get_virtual_platforms",
    "get_common_sponsors",
    "get_career_fair_companies",
    "fetch_handshake_events",
    "fetch_mit_career_fair_companies",
    "fetch_stanford_career_fair_companies",
    "fetch_all_career_fair_companies",
    "get_career_fair_stats",
    "convert_to_job_leads",
]
