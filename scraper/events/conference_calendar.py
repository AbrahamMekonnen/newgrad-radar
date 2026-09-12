"""Dynamic conference calendar tracker.

Tracks major tech and diversity conferences to know when to scrape
their job boards and sponsor lists for maximum impact.

Conferences typically open their career fairs and sponsor pages
1-3 months before the event, making timing critical for job seekers.
"""

import json
import re
import requests
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional


# Load conference data from JSON file
CONFERENCE_DATA_FILE = Path(__file__).parent / "conference_dates.json"

# User agent for web requests
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

# Request timeout
REQUEST_TIMEOUT = 15


@dataclass
class Conference:
    """Conference event with dates and URLs."""
    name: str
    url: str
    typical_month: int
    typical_duration_days: int
    sponsor_page_url: Optional[str]
    careers_url: Optional[str]
    category: str
    focus: str
    description: str
    # Dynamic fields
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None

    @property
    def estimated_start_date(self) -> datetime:
        """Estimate start date based on typical month for current/next occurrence."""
        today = datetime.now()
        year = today.year

        # If typical month has passed this year, use next year
        if today.month > self.typical_month:
            year += 1

        # Assume mid-month start (15th)
        return datetime(year, self.typical_month, 15)

    @property
    def estimated_end_date(self) -> datetime:
        """Estimate end date based on typical duration."""
        return self.estimated_start_date + timedelta(days=self.typical_duration_days)

    @property
    def start_date(self) -> datetime:
        """Return actual date if known, otherwise estimated."""
        return self.actual_start_date or self.estimated_start_date

    @property
    def end_date(self) -> datetime:
        """Return actual end date if known, otherwise estimated."""
        return self.actual_end_date or self.estimated_end_date

    def days_until(self) -> int:
        """Days until conference starts (negative if already started)."""
        return (self.start_date - datetime.now()).days

    def is_upcoming(self, days: int = 90) -> bool:
        """Check if conference is within the specified number of days."""
        days_away = self.days_until()
        return 0 <= days_away <= days

    def is_active(self) -> bool:
        """Check if conference is currently happening."""
        now = datetime.now()
        return self.start_date <= now <= self.end_date

    def is_past(self) -> bool:
        """Check if conference has already ended."""
        return datetime.now() > self.end_date

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "url": self.url,
            "typical_month": self.typical_month,
            "sponsor_page_url": self.sponsor_page_url,
            "careers_url": self.careers_url,
            "category": self.category,
            "focus": self.focus,
            "description": self.description,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "days_until": self.days_until(),
            "is_upcoming": self.is_upcoming(),
            "is_active": self.is_active(),
        }


def load_conferences() -> list[Conference]:
    """Load conference data from JSON file.

    Returns:
        List of Conference objects
    """
    try:
        with open(CONFERENCE_DATA_FILE, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error loading conference data: {e}")
        return []

    conferences = []
    for conf in data.get("conferences", []):
        conferences.append(Conference(
            name=conf["name"],
            url=conf["url"],
            typical_month=conf["typical_month"],
            typical_duration_days=conf.get("typical_duration_days", 3),
            sponsor_page_url=conf.get("sponsor_page_url"),
            careers_url=conf.get("careers_url"),
            category=conf.get("category", "general"),
            focus=conf.get("focus", ""),
            description=conf.get("description", ""),
        ))

    return conferences


def fetch_actual_dates(conference: Conference) -> Optional[tuple[datetime, datetime]]:
    """Attempt to fetch actual conference dates from the website.

    Parses common date patterns from conference websites.

    Args:
        conference: Conference object to fetch dates for

    Returns:
        Tuple of (start_date, end_date) if found, None otherwise
    """
    try:
        response = requests.get(
            conference.url,
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT
        )
        response.raise_for_status()
        html = response.text
    except requests.RequestException as e:
        print(f"Error fetching {conference.name} website: {e}")
        return None

    # Common date patterns on conference websites
    date_patterns = [
        # "October 8-11, 2024" or "October 8 - 11, 2024"
        re.compile(
            r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+"
            r"(\d{1,2})\s*[-–—]\s*(\d{1,2}),?\s*(\d{4})",
            re.IGNORECASE
        ),
        # "Oct 8-11, 2024"
        re.compile(
            r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+"
            r"(\d{1,2})\s*[-–—]\s*(\d{1,2}),?\s*(\d{4})",
            re.IGNORECASE
        ),
        # "8-11 October 2024"
        re.compile(
            r"(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+"
            r"(January|February|March|April|May|June|July|August|September|October|November|December),?\s*(\d{4})",
            re.IGNORECASE
        ),
        # ISO-like: "2024-10-08"
        re.compile(r"(\d{4})-(\d{2})-(\d{2})"),
    ]

    month_map = {
        "jan": 1, "january": 1,
        "feb": 2, "february": 2,
        "mar": 3, "march": 3,
        "apr": 4, "april": 4,
        "may": 5,
        "jun": 6, "june": 6,
        "jul": 7, "july": 7,
        "aug": 8, "august": 8,
        "sep": 9, "sept": 9, "september": 9,
        "oct": 10, "october": 10,
        "nov": 11, "november": 11,
        "dec": 12, "december": 12,
    }

    for pattern in date_patterns[:3]:  # Skip ISO pattern for web parsing
        matches = pattern.findall(html)
        for match in matches:
            try:
                if pattern == date_patterns[2]:
                    # Day-range Month Year format
                    start_day = int(match[0])
                    end_day = int(match[1])
                    month = month_map.get(match[2].lower()[:3], 0)
                    year = int(match[3])
                else:
                    # Month Day-range Year format
                    month = month_map.get(match[0].lower()[:3], 0)
                    start_day = int(match[1])
                    end_day = int(match[2])
                    year = int(match[3])

                if month == 0:
                    continue

                # Only accept dates that match expected month
                if month != conference.typical_month:
                    # Allow +/- 1 month variance
                    if abs(month - conference.typical_month) > 1:
                        continue

                start_date = datetime(year, month, start_day)
                end_date = datetime(year, month, end_day)

                # Sanity check: dates should be in the future or recent past
                if start_date.year >= datetime.now().year - 1:
                    return (start_date, end_date)

            except (ValueError, IndexError):
                continue

    return None


def update_conference_dates(conferences: list[Conference]) -> list[Conference]:
    """Update conferences with actual dates from their websites.

    Args:
        conferences: List of conferences to update

    Returns:
        Updated list of conferences
    """
    for conf in conferences:
        dates = fetch_actual_dates(conf)
        if dates:
            conf.actual_start_date, conf.actual_end_date = dates
            print(f"Found dates for {conf.name}: {dates[0].date()} to {dates[1].date()}")

    return conferences


def get_upcoming_conferences(days: int = 90) -> list[dict]:
    """Get conferences happening within the specified number of days.

    This is the main function for finding conferences to scrape.
    Returns conferences ordered by days until start.

    Args:
        days: Number of days to look ahead (default 90)

    Returns:
        List of conference dicts with timing information
    """
    conferences = load_conferences()

    # Filter to upcoming conferences
    upcoming = [c for c in conferences if c.is_upcoming(days) or c.is_active()]

    # Sort by start date
    upcoming.sort(key=lambda c: c.start_date)

    return [c.to_dict() for c in upcoming]


def get_conferences_by_category(category: str) -> list[dict]:
    """Get conferences filtered by category.

    Categories: diversity, language, infrastructure, research, industry, general

    Args:
        category: Category to filter by

    Returns:
        List of matching conference dicts
    """
    conferences = load_conferences()
    filtered = [c for c in conferences if c.category == category]
    filtered.sort(key=lambda c: c.start_date)
    return [c.to_dict() for c in filtered]


def get_conferences_by_focus(focus: str) -> list[dict]:
    """Get conferences filtered by focus area.

    Focus areas: women_in_tech, black_in_tech, hispanic_engineers,
                 lgbtq_in_tech, python, cloud_native, machine_learning, etc.

    Args:
        focus: Focus area to filter by

    Returns:
        List of matching conference dicts
    """
    conferences = load_conferences()
    filtered = [c for c in conferences if c.focus == focus]
    filtered.sort(key=lambda c: c.start_date)
    return [c.to_dict() for c in filtered]


def get_active_conferences() -> list[dict]:
    """Get conferences currently happening.

    These are high-priority for scraping as sponsors are actively hiring.

    Returns:
        List of active conference dicts
    """
    conferences = load_conferences()
    active = [c for c in conferences if c.is_active()]
    return [c.to_dict() for c in active]


def get_scraping_priority() -> list[dict]:
    """Get conferences prioritized for scraping.

    Priority order:
    1. Active conferences (happening now)
    2. Upcoming within 30 days
    3. Upcoming within 60 days
    4. Upcoming within 90 days

    Returns:
        List of conference dicts with priority scores
    """
    conferences = load_conferences()

    prioritized = []
    for conf in conferences:
        if conf.is_past():
            continue

        days = conf.days_until()

        if conf.is_active():
            priority = 1
            reason = "Currently active - high priority scraping"
        elif days <= 30:
            priority = 2
            reason = "Starts within 30 days - sponsors list likely available"
        elif days <= 60:
            priority = 3
            reason = "Starts within 60 days - check for early sponsor announcements"
        elif days <= 90:
            priority = 4
            reason = "Starts within 90 days - monitor for updates"
        else:
            continue  # Skip conferences more than 90 days out

        conf_dict = conf.to_dict()
        conf_dict["priority"] = priority
        conf_dict["priority_reason"] = reason
        prioritized.append(conf_dict)

    # Sort by priority, then by days until
    prioritized.sort(key=lambda c: (c["priority"], c["days_until"]))
    return prioritized


def get_all_conferences() -> list[dict]:
    """Get all conferences with their current status.

    Returns:
        List of all conference dicts
    """
    conferences = load_conferences()
    conferences.sort(key=lambda c: c.typical_month)
    return [c.to_dict() for c in conferences]


def add_conference(
    name: str,
    url: str,
    typical_month: int,
    sponsor_page_url: Optional[str] = None,
    careers_url: Optional[str] = None,
    category: str = "general",
    focus: str = "",
    description: str = "",
    typical_duration_days: int = 3,
) -> bool:
    """Add a new conference to the JSON file.

    Args:
        name: Conference name
        url: Conference website URL
        typical_month: Month number (1-12) when conference typically occurs
        sponsor_page_url: URL to sponsor list page
        careers_url: URL to careers/job fair page
        category: Category (diversity, language, infrastructure, research, industry, general)
        focus: Specific focus area
        description: Brief description
        typical_duration_days: How many days the conference lasts

    Returns:
        True if added successfully, False otherwise
    """
    try:
        with open(CONFERENCE_DATA_FILE, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {"conferences": []}

    new_conf = {
        "name": name,
        "url": url,
        "typical_month": typical_month,
        "typical_duration_days": typical_duration_days,
        "sponsor_page_url": sponsor_page_url,
        "careers_url": careers_url,
        "category": category,
        "focus": focus,
        "description": description,
    }

    data["conferences"].append(new_conf)

    try:
        with open(CONFERENCE_DATA_FILE, "w") as f:
            json.dump(data, f, indent=2)
        return True
    except IOError as e:
        print(f"Error saving conference: {e}")
        return False


if __name__ == "__main__":
    # Demo: Show upcoming conferences
    print("=" * 60)
    print("UPCOMING CONFERENCES (next 90 days)")
    print("=" * 60)

    upcoming = get_upcoming_conferences(days=90)
    if upcoming:
        for conf in upcoming:
            days = conf["days_until"]
            status = "ACTIVE" if conf["is_active"] else f"in {days} days"
            print(f"\n{conf['name']}")
            print(f"  Date: {conf['start_date'][:10]} to {conf['end_date'][:10]} ({status})")
            print(f"  Category: {conf['category']} | Focus: {conf['focus']}")
            if conf.get("sponsor_page_url"):
                print(f"  Sponsors: {conf['sponsor_page_url']}")
            if conf.get("careers_url"):
                print(f"  Careers: {conf['careers_url']}")
    else:
        print("No upcoming conferences in the next 90 days.")

    print("\n" + "=" * 60)
    print("SCRAPING PRIORITY")
    print("=" * 60)

    priority = get_scraping_priority()
    for conf in priority[:5]:
        print(f"\n[P{conf['priority']}] {conf['name']}")
        print(f"  {conf['priority_reason']}")
