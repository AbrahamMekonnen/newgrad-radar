#!/usr/bin/env python3
"""Hackathon Season Tracker.

Tracks upcoming hackathons from MLH and other sources to identify
recruiting opportunities. Hackathon sponsors actively recruit new grads.

Features:
- Fetch MLH event calendar
- Parse hackathon dates and locations
- Extract sponsor lists from each hackathon
- Track hackathon season for recruiting signals
"""

import re
import json
import requests
from datetime import datetime, timedelta
from typing import Optional
from html import unescape
from urllib.parse import urljoin, urlparse

import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import REQUEST_TIMEOUT

# Cache for sponsor lookups (hackathon_name -> sponsors list)
_sponsor_cache: dict[str, list[dict]] = {}

# User agent for requests
USER_AGENT = "Mozilla/5.0 (compatible; NewGradRadar/1.0; +https://github.com)"


def _parse_date(date_str: str) -> Optional[datetime]:
    """Parse various date formats from hackathon pages.

    Args:
        date_str: Date string in various formats

    Returns:
        datetime object or None if parsing fails
    """
    date_str = date_str.strip()

    # Common date formats
    formats = [
        "%B %d, %Y",         # January 15, 2027
        "%b %d, %Y",         # Jan 15, 2027
        "%Y-%m-%d",          # 2027-01-15
        "%m/%d/%Y",          # 01/15/2027
        "%d %B %Y",          # 15 January 2027
        "%d %b %Y",          # 15 Jan 2027
        "%B %d",             # January 15 (assume current/next year)
        "%b %d",             # Jan 15
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            # Handle year-less dates
            if dt.year == 1900:
                now = datetime.now()
                dt = dt.replace(year=now.year)
                # If date is in the past, assume next year
                if dt < now:
                    dt = dt.replace(year=now.year + 1)
            return dt
        except ValueError:
            continue

    return None


def _extract_date_range(text: str) -> tuple[Optional[datetime], Optional[datetime]]:
    """Extract start and end dates from a date range string.

    Args:
        text: Text containing date range like "January 15-17, 2027"

    Returns:
        Tuple of (start_date, end_date) or (None, None)
    """
    # Pattern for date ranges
    patterns = [
        # January 15-17, 2027
        r"(\w+ \d+)-(\d+),?\s*(\d{4})",
        # Jan 15 - Jan 17, 2027
        r"(\w+ \d+)\s*[-to]+\s*(\w+ \d+),?\s*(\d{4})",
        # 2027-01-15 to 2027-01-17
        r"(\d{4}-\d{2}-\d{2})\s*[-to]+\s*(\d{4}-\d{2}-\d{2})",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            groups = match.groups()
            if len(groups) == 3:
                if "-" in groups[0]:
                    # Full ISO dates
                    start = _parse_date(groups[0])
                    end = _parse_date(groups[1])
                else:
                    # Month Day-Day, Year format
                    month_day = groups[0]
                    year = groups[2]
                    start = _parse_date(f"{month_day}, {year}")

                    # Check if second part is just a day number or full date
                    if groups[1].isdigit():
                        # Same month, different day
                        month = month_day.split()[0]
                        end = _parse_date(f"{month} {groups[1]}, {year}")
                    else:
                        end = _parse_date(f"{groups[1]}, {year}")

                return (start, end)

    # Single date
    single = _parse_date(text)
    if single:
        return (single, single)

    return (None, None)


def fetch_mlh_events(season: Optional[str] = None) -> list[dict]:
    """Fetch hackathon events from MLH event calendar.

    MLH (Major League Hacking) is the official hackathon league with
    200+ events per season. Their events page lists all member hackathons.

    Args:
        season: Optional season like "2027" or "2027-2028". Defaults to current.

    Returns:
        List of hackathon dicts with: name, url, start_date, end_date,
        location, is_virtual, mlh_url
    """
    events = []

    # MLH season pages
    if season:
        mlh_urls = [f"https://mlh.io/seasons/{season}/events"]
    else:
        # Try current and next season
        now = datetime.now()
        current_year = now.year
        mlh_urls = [
            f"https://mlh.io/seasons/{current_year}/events",
            f"https://mlh.io/seasons/{current_year + 1}/events",
            "https://mlh.io/events",
        ]

    for mlh_url in mlh_urls:
        try:
            response = requests.get(
                mlh_url,
                timeout=REQUEST_TIMEOUT,
                headers={"User-Agent": USER_AGENT}
            )
            if response.status_code != 200:
                continue

            html = response.text

            # MLH event cards typically have structure like:
            # <div class="event-wrapper">
            #   <a href="hackathon_url">
            #   <h3>Hackathon Name</h3>
            #   <p class="event-date">January 15-17, 2027</p>
            #   <p class="event-location">San Francisco, CA</p>
            # </div>

            # Extract event blocks
            event_patterns = [
                # Full event card pattern
                re.compile(
                    r'<div[^>]*class="[^"]*event[^"]*"[^>]*>.*?'
                    r'<a[^>]*href="([^"]+)"[^>]*>.*?'
                    r'<(?:h\d|span)[^>]*>([^<]+)</(?:h\d|span)>.*?'
                    r'(?:<[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)</[^>]*>)?.*?'
                    r'(?:<[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)</[^>]*>)?',
                    re.IGNORECASE | re.DOTALL
                ),
                # Simpler link-based pattern
                re.compile(
                    r'<a[^>]*href="(https?://[^"]+)"[^>]*class="[^"]*event[^"]*"[^>]*>'
                    r'[^<]*<[^>]*>([^<]+)<',
                    re.IGNORECASE | re.DOTALL
                ),
            ]

            # Also try JSON-LD structured data
            json_ld_pattern = re.compile(
                r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
                re.IGNORECASE | re.DOTALL
            )

            for match in json_ld_pattern.finditer(html):
                try:
                    data = json.loads(match.group(1))
                    if isinstance(data, list):
                        items = data
                    elif data.get("@type") == "ItemList":
                        items = data.get("itemListElement", [])
                    else:
                        items = [data]

                    for item in items:
                        if item.get("@type") == "Event":
                            name = item.get("name", "")
                            url = item.get("url", "")
                            start_date = _parse_date(item.get("startDate", ""))
                            end_date = _parse_date(item.get("endDate", ""))

                            location_obj = item.get("location", {})
                            if isinstance(location_obj, dict):
                                location = location_obj.get("name", "")
                                address = location_obj.get("address", {})
                                if isinstance(address, dict):
                                    city = address.get("addressLocality", "")
                                    region = address.get("addressRegion", "")
                                    if city and region:
                                        location = f"{city}, {region}"
                            else:
                                location = str(location_obj)

                            is_virtual = "virtual" in location.lower() or "online" in location.lower()

                            if name and url:
                                events.append({
                                    "name": unescape(name).strip(),
                                    "url": url,
                                    "start_date": start_date.isoformat() if start_date else None,
                                    "end_date": end_date.isoformat() if end_date else None,
                                    "location": location.strip() if location else None,
                                    "is_virtual": is_virtual,
                                    "mlh_url": mlh_url,
                                    "source": "mlh",
                                })
                except json.JSONDecodeError:
                    continue

            # Fallback to HTML parsing
            for pattern in event_patterns:
                for match in pattern.finditer(html):
                    groups = match.groups()
                    url = groups[0] if len(groups) > 0 else ""
                    name = groups[1] if len(groups) > 1 else ""
                    date_str = groups[2] if len(groups) > 2 else ""
                    location = groups[3] if len(groups) > 3 else ""

                    if not name or not url:
                        continue

                    # Skip if already found via JSON-LD
                    if any(e["name"].lower() == unescape(name).lower().strip() for e in events):
                        continue

                    start_date, end_date = _extract_date_range(date_str) if date_str else (None, None)
                    location = unescape(location).strip() if location else None
                    is_virtual = location and ("virtual" in location.lower() or "online" in location.lower())

                    events.append({
                        "name": unescape(name).strip(),
                        "url": url if url.startswith("http") else urljoin(mlh_url, url),
                        "start_date": start_date.isoformat() if start_date else None,
                        "end_date": end_date.isoformat() if end_date else None,
                        "location": location,
                        "is_virtual": is_virtual or False,
                        "mlh_url": mlh_url,
                        "source": "mlh",
                    })

        except requests.RequestException as e:
            print(f"Error fetching MLH events from {mlh_url}: {e}")
            continue

    # Also add well-known major hackathons with typical dates
    major_hackathons = [
        {
            "name": "HackMIT",
            "url": "https://hackmit.org",
            "location": "Cambridge, MA",
            "typical_month": 9,  # September
        },
        {
            "name": "TreeHacks",
            "url": "https://www.treehacks.com",
            "location": "Stanford, CA",
            "typical_month": 2,  # February
        },
        {
            "name": "PennApps",
            "url": "https://pennapps.com",
            "location": "Philadelphia, PA",
            "typical_month": 9,  # September
        },
        {
            "name": "CalHacks",
            "url": "https://www.calhacks.io",
            "location": "Berkeley, CA",
            "typical_month": 10,  # October
        },
        {
            "name": "HackGT",
            "url": "https://hack.gt",
            "location": "Atlanta, GA",
            "typical_month": 10,  # October
        },
        {
            "name": "LA Hacks",
            "url": "https://lahacks.com",
            "location": "Los Angeles, CA",
            "typical_month": 3,  # March
        },
        {
            "name": "BoilerMake",
            "url": "https://boilermake.org",
            "location": "West Lafayette, IN",
            "typical_month": 1,  # January
        },
        {
            "name": "HackThe6ix",
            "url": "https://hackthe6ix.com",
            "location": "Toronto, ON",
            "typical_month": 8,  # August
        },
        {
            "name": "MHacks",
            "url": "https://mhacks.org",
            "location": "Ann Arbor, MI",
            "typical_month": 10,  # October
        },
        {
            "name": "HackNY",
            "url": "https://hackny.org",
            "location": "New York, NY",
            "typical_month": 4,  # April
        },
    ]

    existing_names = {e["name"].lower() for e in events}
    now = datetime.now()

    for hackathon in major_hackathons:
        if hackathon["name"].lower() not in existing_names:
            # Estimate date based on typical month
            month = hackathon["typical_month"]
            year = now.year if month >= now.month else now.year + 1
            estimated_date = datetime(year, month, 15)  # Mid-month estimate

            events.append({
                "name": hackathon["name"],
                "url": hackathon["url"],
                "start_date": estimated_date.isoformat(),
                "end_date": (estimated_date + timedelta(days=2)).isoformat(),
                "location": hackathon["location"],
                "is_virtual": False,
                "mlh_url": None,
                "source": "known_major",
            })

    # Deduplicate by name
    seen = set()
    unique_events = []
    for event in events:
        key = event["name"].lower()
        if key not in seen:
            seen.add(key)
            unique_events.append(event)

    print(f"Found {len(unique_events)} MLH/major hackathons")
    return unique_events


def fetch_devpost_hackathons(status: str = "upcoming") -> list[dict]:
    """Fetch hackathons from Devpost.

    Args:
        status: "upcoming", "open", or "ended"

    Returns:
        List of hackathon dicts with event details
    """
    events = []

    api_url = f"https://devpost.com/api/hackathons?status={status}"

    try:
        response = requests.get(
            api_url,
            timeout=REQUEST_TIMEOUT,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            }
        )

        if response.status_code == 200:
            data = response.json()
            hackathons = data.get("hackathons", [])

            for h in hackathons:
                name = h.get("title", "")
                url = h.get("url", "")

                # Parse dates
                start_str = h.get("submission_period_dates", "")
                start_date, end_date = _extract_date_range(start_str)

                # Location
                location = h.get("displayed_location", {})
                if isinstance(location, dict):
                    location = location.get("location", "Online")

                is_virtual = h.get("online", False) or "online" in str(location).lower()

                # Organization (potential sponsor)
                org_name = h.get("organization_name", "")

                events.append({
                    "name": name,
                    "url": url,
                    "start_date": start_date.isoformat() if start_date else None,
                    "end_date": end_date.isoformat() if end_date else None,
                    "location": location if isinstance(location, str) else "Online",
                    "is_virtual": is_virtual,
                    "organization": org_name,
                    "prize_amount": h.get("prize_amount"),
                    "registrations_count": h.get("registrations_count"),
                    "source": "devpost",
                })

    except requests.RequestException as e:
        print(f"Error fetching Devpost hackathons: {e}")
    except (ValueError, KeyError) as e:
        print(f"Error parsing Devpost response: {e}")

    print(f"Found {len(events)} Devpost hackathons ({status})")
    return events


def get_upcoming_hackathons(days: int = 60) -> list[dict]:
    """Get hackathons happening in the next N days.

    Combines MLH, Devpost, and known major hackathons into one list,
    filtered to events starting within the specified window.

    Args:
        days: Number of days to look ahead (default: 60)

    Returns:
        List of hackathon dicts sorted by start date, with:
        - name: Hackathon name
        - url: Official website
        - start_date: ISO format start date
        - end_date: ISO format end date
        - location: City, State or "Online"
        - is_virtual: Boolean
        - source: "mlh", "devpost", or "known_major"
        - days_until: Days until the event starts
    """
    all_events = []

    # Fetch from all sources
    all_events.extend(fetch_mlh_events())
    all_events.extend(fetch_devpost_hackathons("upcoming"))
    all_events.extend(fetch_devpost_hackathons("open"))

    # Filter to upcoming events within window
    now = datetime.now()
    cutoff = now + timedelta(days=days)
    upcoming = []

    for event in all_events:
        start_str = event.get("start_date")
        if not start_str:
            continue

        try:
            start_date = datetime.fromisoformat(start_str)
        except ValueError:
            continue

        # Check if within window
        if now <= start_date <= cutoff:
            days_until = (start_date - now).days
            event["days_until"] = days_until
            upcoming.append(event)

    # Deduplicate by name (keep first occurrence)
    seen = set()
    unique = []
    for event in upcoming:
        key = event["name"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(event)

    # Sort by start date
    unique.sort(key=lambda x: x.get("start_date", "9999"))

    print(f"Found {len(unique)} hackathons in the next {days} days")
    return unique


def _fetch_hackathon_page_sponsors(url: str) -> list[dict]:
    """Fetch sponsors from a hackathon's website.

    Args:
        url: Hackathon website URL

    Returns:
        List of sponsor dicts with: name, tier, logo_url, website
    """
    sponsors = []

    # Try main page and /sponsors page
    urls_to_try = [url]
    if not url.endswith("/sponsors"):
        urls_to_try.append(url.rstrip("/") + "/sponsors")

    for page_url in urls_to_try:
        try:
            response = requests.get(
                page_url,
                timeout=REQUEST_TIMEOUT,
                headers={"User-Agent": USER_AGENT}
            )

            if response.status_code != 200:
                continue

            html = response.text

            # Pattern for sponsor sections with tier labels
            tier_patterns = [
                (r'(?:platinum|diamond|title)[^>]*>.*?(?=(?:gold|silver|bronze|partner|</section))', "platinum"),
                (r'(?:gold)[^>]*>.*?(?=(?:silver|bronze|partner|</section))', "gold"),
                (r'(?:silver)[^>]*>.*?(?=(?:bronze|partner|</section))', "silver"),
                (r'(?:bronze|partner|supporter)[^>]*>.*?(?=</section)', "bronze"),
            ]

            # Generic sponsor extraction patterns
            sponsor_patterns = [
                # Image alt text (most common)
                re.compile(r'<img[^>]*alt="([^"]+)"[^>]*class="[^"]*sponsor[^"]*"', re.IGNORECASE),
                re.compile(r'class="[^"]*sponsor[^"]*"[^>]*>[^<]*<img[^>]*alt="([^"]+)"', re.IGNORECASE),
                # Link text
                re.compile(r'<a[^>]*href="([^"]+)"[^>]*class="[^"]*sponsor[^"]*"[^>]*>\s*(?:<[^>]*>)*([^<]+)', re.IGNORECASE),
                # Data attributes
                re.compile(r'data-(?:sponsor|company)-name="([^"]+)"', re.IGNORECASE),
                # Sponsor divs
                re.compile(r'class="[^"]*sponsor[^"]*"[^>]*>\s*<[^>]*>([^<]+)<', re.IGNORECASE),
            ]

            found_sponsors = {}  # name -> sponsor dict

            for pattern in sponsor_patterns:
                for match in pattern.finditer(html):
                    groups = match.groups()

                    # Handle different capture group scenarios
                    if len(groups) == 2:
                        website, name = groups
                    else:
                        name = groups[0]
                        website = None

                    # Clean up name
                    name = unescape(name).strip()

                    # Filter out non-company names
                    skip_words = ["logo", "sponsor", "image", "icon", "button", "close",
                                  "menu", "nav", "footer", "header", "submit", "section"]
                    if any(w in name.lower() for w in skip_words):
                        continue

                    if len(name) < 2 or len(name) > 100:
                        continue

                    key = name.lower()
                    if key not in found_sponsors:
                        found_sponsors[key] = {
                            "name": name,
                            "tier": "sponsor",  # Default tier
                            "website": website if website and website.startswith("http") else None,
                        }

            sponsors.extend(found_sponsors.values())

        except requests.RequestException as e:
            print(f"Error fetching sponsors from {page_url}: {e}")
            continue

    return sponsors


def get_hackathon_sponsors(hackathon_name: str) -> list[dict]:
    """Get sponsors for a specific hackathon.

    Fetches sponsor information from the hackathon's website.
    Results are cached for performance.

    Args:
        hackathon_name: Name of the hackathon (e.g., "HackMIT", "TreeHacks")

    Returns:
        List of sponsor dicts with:
        - name: Company name
        - tier: Sponsorship tier (platinum, gold, silver, bronze, sponsor)
        - website: Company website URL (if found)
        - careers_url: Inferred careers page URL
    """
    global _sponsor_cache

    # Check cache
    cache_key = hackathon_name.lower()
    if cache_key in _sponsor_cache:
        return _sponsor_cache[cache_key]

    sponsors = []

    # Known hackathon URLs
    hackathon_urls = {
        "hackmit": "https://hackmit.org",
        "treehacks": "https://www.treehacks.com",
        "pennapps": "https://pennapps.com",
        "calhacks": "https://www.calhacks.io",
        "hackgt": "https://hack.gt",
        "la hacks": "https://lahacks.com",
        "lahacks": "https://lahacks.com",
        "boilermake": "https://boilermake.org",
        "hackthe6ix": "https://hackthe6ix.com",
        "mhacks": "https://mhacks.org",
        "hackny": "https://hackny.org",
        "hophacks": "https://hophacks.com",
        "hackuci": "https://hackuci.com",
        "tamuhack": "https://tamuhack.org",
        "hackduke": "https://hackduke.org",
        "wildhacks": "https://wildhacks.org",
        "hackillinois": "https://hackillinois.org",
        "hackbeanpot": "https://hackbeanpot.com",
        "bigredhacks": "https://bigredhacks.com",
    }

    # Find URL for this hackathon
    url = hackathon_urls.get(hackathon_name.lower().replace(" ", ""))

    if not url:
        # Try to find in upcoming events
        events = fetch_mlh_events()
        for event in events:
            if hackathon_name.lower() in event["name"].lower():
                url = event["url"]
                break

    if url:
        sponsors = _fetch_hackathon_page_sponsors(url)

        # Add inferred careers URLs
        for sponsor in sponsors:
            name_slug = re.sub(r"[^\w]", "", sponsor["name"].lower())
            sponsor["careers_url"] = f"https://www.{name_slug}.com/careers"

    # Add well-known sponsors for major hackathons
    known_sponsors = {
        "hackmit": [
            {"name": "Jane Street", "tier": "platinum"},
            {"name": "Citadel", "tier": "platinum"},
            {"name": "Two Sigma", "tier": "gold"},
            {"name": "Bloomberg", "tier": "gold"},
            {"name": "Capital One", "tier": "gold"},
            {"name": "Meta", "tier": "silver"},
            {"name": "Google", "tier": "silver"},
        ],
        "treehacks": [
            {"name": "OpenAI", "tier": "platinum"},
            {"name": "Anthropic", "tier": "platinum"},
            {"name": "Google", "tier": "gold"},
            {"name": "Meta", "tier": "gold"},
            {"name": "Databricks", "tier": "gold"},
            {"name": "Scale AI", "tier": "silver"},
            {"name": "Figma", "tier": "silver"},
        ],
        "calhacks": [
            {"name": "Palantir", "tier": "platinum"},
            {"name": "Scale AI", "tier": "gold"},
            {"name": "Cloudflare", "tier": "gold"},
            {"name": "MongoDB", "tier": "silver"},
        ],
        "pennapps": [
            {"name": "Figma", "tier": "gold"},
            {"name": "Notion", "tier": "gold"},
            {"name": "Vercel", "tier": "silver"},
            {"name": "MongoDB", "tier": "silver"},
        ],
    }

    # Add known sponsors if not already present
    key = hackathon_name.lower().replace(" ", "")
    if key in known_sponsors:
        existing_names = {s["name"].lower() for s in sponsors}
        for known in known_sponsors[key]:
            if known["name"].lower() not in existing_names:
                name_slug = re.sub(r"[^\w]", "", known["name"].lower())
                sponsors.append({
                    "name": known["name"],
                    "tier": known["tier"],
                    "website": None,
                    "careers_url": f"https://www.{name_slug}.com/careers",
                })

    # Sort by tier (platinum > gold > silver > bronze > sponsor)
    tier_order = {"platinum": 0, "diamond": 0, "title": 0, "gold": 1, "silver": 2, "bronze": 3, "sponsor": 4}
    sponsors.sort(key=lambda x: tier_order.get(x.get("tier", "sponsor"), 5))

    # Cache results
    _sponsor_cache[cache_key] = sponsors

    print(f"Found {len(sponsors)} sponsors for {hackathon_name}")
    return sponsors


def get_recruiting_signals() -> list[dict]:
    """Get companies actively recruiting at hackathons.

    Returns companies appearing as sponsors at multiple hackathons,
    indicating active new-grad recruiting interest.

    Returns:
        List of company dicts with:
        - name: Company name
        - hackathons: List of hackathons they sponsor
        - sponsor_count: Number of hackathons sponsored
        - careers_url: Careers page URL
    """
    # Get upcoming hackathons
    upcoming = get_upcoming_hackathons(days=90)

    # Get sponsors for each
    company_hackathons = {}  # company_name -> list of hackathon names

    for hackathon in upcoming[:10]:  # Limit to avoid too many requests
        sponsors = get_hackathon_sponsors(hackathon["name"])

        for sponsor in sponsors:
            name = sponsor["name"]
            key = name.lower()

            if key not in company_hackathons:
                company_hackathons[key] = {
                    "name": name,
                    "hackathons": [],
                    "careers_url": sponsor.get("careers_url"),
                }

            company_hackathons[key]["hackathons"].append(hackathon["name"])

    # Convert to list and sort by sponsor count
    signals = list(company_hackathons.values())
    for s in signals:
        s["sponsor_count"] = len(s["hackathons"])

    signals.sort(key=lambda x: x["sponsor_count"], reverse=True)

    print(f"Found {len(signals)} companies sponsoring hackathons")
    return signals


if __name__ == "__main__":
    print("=" * 60)
    print("Hackathon Season Tracker")
    print("=" * 60)

    print("\n--- Upcoming Hackathons (next 60 days) ---")
    upcoming = get_upcoming_hackathons(days=60)
    for h in upcoming[:10]:
        days = h.get("days_until", "?")
        location = h.get("location") or "TBD"
        print(f"  {h['name']}")
        print(f"    Date: {h.get('start_date', 'TBD')[:10] if h.get('start_date') else 'TBD'} ({days} days away)")
        print(f"    Location: {location}")
        print(f"    URL: {h.get('url')}")
        print()

    print("\n--- HackMIT Sponsors ---")
    sponsors = get_hackathon_sponsors("HackMIT")
    for s in sponsors[:10]:
        print(f"  [{s.get('tier', 'sponsor'):8}] {s['name']}")

    print("\n--- TreeHacks Sponsors ---")
    sponsors = get_hackathon_sponsors("TreeHacks")
    for s in sponsors[:10]:
        print(f"  [{s.get('tier', 'sponsor'):8}] {s['name']}")

    print("\n--- Recruiting Signals (companies at multiple hackathons) ---")
    signals = get_recruiting_signals()
    for s in signals[:10]:
        if s["sponsor_count"] > 1:
            print(f"  {s['name']}: {s['sponsor_count']} hackathons")
            print(f"    Hackathons: {', '.join(s['hackathons'])}")

    print("\n" + "=" * 60)
