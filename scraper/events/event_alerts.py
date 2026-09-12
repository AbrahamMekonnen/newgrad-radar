"""Event-Based Job Alert System.

Proactive scraping based on external events:
- Conference/Hackathon proximity (2 weeks before -> scrape sponsors)
- YC Demo Day -> refresh all YC company jobs
- Funding announcements -> add company to priority scrape queue

This module monitors events and triggers targeted scraping actions.
"""

import json
import os
import time
import hashlib
import requests
from datetime import datetime, timedelta
from typing import Optional, Callable
from dataclasses import dataclass, field
from pathlib import Path

# Import existing scrapers
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import REQUEST_TIMEOUT


# =============================================================================
# Event Types and Data Classes
# =============================================================================

@dataclass
class Event:
    """Represents a triggering event."""
    event_id: str
    event_type: str  # "conference", "hackathon", "demo_day", "funding"
    name: str
    date: datetime
    source_url: Optional[str] = None
    metadata: dict = field(default_factory=dict)
    triggered: bool = False
    trigger_date: Optional[datetime] = None


@dataclass
class ScrapeAction:
    """Represents a scraping action triggered by an event."""
    action_type: str  # "scrape_sponsors", "refresh_yc", "priority_company"
    target: str  # Company name, event name, or "all"
    priority: int = 1  # 1-5, higher = more urgent
    triggered_by: str = ""  # Event ID
    metadata: dict = field(default_factory=dict)


# =============================================================================
# Event Data Sources
# =============================================================================

# Major tech conferences (dates approximate, updated annually)
MAJOR_CONFERENCES = [
    {
        "name": "Grace Hopper Celebration (GHC)",
        "typical_month": 10,  # October
        "url": "https://ghc.anitab.org",
        "sponsor_page": "https://ghc.anitab.org/attend/sponsor-list/",
        "type": "diversity_conference",
    },
    {
        "name": "NSBE National Convention",
        "typical_month": 3,  # March
        "url": "https://convention.nsbe.org",
        "sponsor_page": "https://convention.nsbe.org/sponsors",
        "type": "diversity_conference",
    },
    {
        "name": "SHPE National Convention",
        "typical_month": 11,  # November
        "url": "https://shpe.org/national-convention",
        "sponsor_page": "https://shpe.org/national-convention/sponsors",
        "type": "diversity_conference",
    },
    {
        "name": "AfroTech Conference",
        "typical_month": 11,  # November
        "url": "https://afrotech.com",
        "sponsor_page": "https://afrotech.com/career-fair",
        "type": "diversity_conference",
    },
    {
        "name": "PyCon US",
        "typical_month": 5,  # May
        "url": "https://pycon.org",
        "sponsor_page": "https://us.pycon.org/sponsors/",
        "type": "tech_conference",
    },
    {
        "name": "KubeCon NA",
        "typical_month": 11,  # November
        "url": "https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/",
        "sponsor_page": None,
        "type": "tech_conference",
    },
    {
        "name": "AWS re:Invent",
        "typical_month": 12,  # December
        "url": "https://reinvent.awsevents.com",
        "sponsor_page": None,
        "type": "tech_conference",
    },
    {
        "name": "Google I/O",
        "typical_month": 5,  # May
        "url": "https://io.google",
        "sponsor_page": None,
        "type": "tech_conference",
    },
]

# Major hackathons with known dates
MAJOR_HACKATHONS = [
    {
        "name": "HackMIT",
        "typical_month": 9,  # September
        "url": "https://hackmit.org",
        "sponsor_page": "https://hackmit.org/sponsors",
        "type": "university_hackathon",
    },
    {
        "name": "TreeHacks (Stanford)",
        "typical_month": 2,  # February
        "url": "https://www.treehacks.com",
        "sponsor_page": "https://www.treehacks.com/sponsors",
        "type": "university_hackathon",
    },
    {
        "name": "PennApps",
        "typical_month": 9,  # September
        "url": "https://pennapps.com",
        "sponsor_page": "https://pennapps.com/sponsors",
        "type": "university_hackathon",
    },
    {
        "name": "CalHacks",
        "typical_month": 10,  # October
        "url": "https://www.calhacks.io",
        "sponsor_page": None,
        "type": "university_hackathon",
    },
    {
        "name": "HackGT",
        "typical_month": 10,  # October
        "url": "https://hack.gt",
        "sponsor_page": None,
        "type": "university_hackathon",
    },
    {
        "name": "LA Hacks",
        "typical_month": 4,  # April
        "url": "https://lahacks.com",
        "sponsor_page": None,
        "type": "university_hackathon",
    },
]

# YC Demo Day schedules (twice yearly)
YC_DEMO_DAYS = [
    {
        "name": "YC Winter Demo Day",
        "typical_month": 4,  # April (Winter batch demos)
        "url": "https://www.ycombinator.com/blog",
        "type": "demo_day",
    },
    {
        "name": "YC Summer Demo Day",
        "typical_month": 9,  # September (Summer batch demos)
        "url": "https://www.ycombinator.com/blog",
        "type": "demo_day",
    },
]


# =============================================================================
# Event Calendar and Detection
# =============================================================================

class EventCalendar:
    """Manages event detection and tracking."""

    def __init__(self, triggers_file: Optional[str] = None):
        """Initialize the event calendar.

        Args:
            triggers_file: Path to event_triggers.json config
        """
        self.triggers_file = triggers_file or str(
            Path(__file__).parent / "event_triggers.json"
        )
        self.triggers_config = self._load_triggers()
        self.events: list[Event] = []
        self.processed_events: set[str] = set()

    def _load_triggers(self) -> dict:
        """Load trigger configuration from JSON."""
        try:
            with open(self.triggers_file, "r") as f:
                return json.load(f)
        except FileNotFoundError:
            return self._default_triggers()

    def _default_triggers(self) -> dict:
        """Return default trigger configuration."""
        return {
            "conference": {
                "days_before": 14,
                "days_after": 7,
                "actions": ["scrape_sponsors", "priority_scrape"],
            },
            "hackathon": {
                "days_before": 14,
                "days_after": 3,
                "actions": ["scrape_sponsors"],
            },
            "demo_day": {
                "days_before": 7,
                "days_after": 14,
                "actions": ["refresh_yc_jobs"],
            },
            "funding": {
                "days_after": 7,  # Window after announcement
                "min_amount_millions": 5,
                "priority_rounds": ["Series A", "Series B", "Series C"],
                "actions": ["priority_company_scrape"],
            },
        }

    def _generate_event_id(self, event_type: str, name: str, date: datetime) -> str:
        """Generate a stable event ID."""
        id_string = f"{event_type}|{name}|{date.strftime('%Y-%m')}"
        return hashlib.md5(id_string.encode()).hexdigest()[:12]

    def _estimate_event_date(self, typical_month: int, year: int = None) -> datetime:
        """Estimate event date based on typical month."""
        if year is None:
            year = datetime.now().year
            # If the month has passed this year, assume next year
            if typical_month < datetime.now().month:
                year += 1

        # Assume middle of month
        return datetime(year, typical_month, 15)

    def detect_upcoming_events(self, days_ahead: int = 30) -> list[Event]:
        """Detect events happening in the next N days.

        Args:
            days_ahead: How many days ahead to check

        Returns:
            List of upcoming events
        """
        now = datetime.now()
        cutoff = now + timedelta(days=days_ahead)
        events = []

        # Check conferences
        for conf in MAJOR_CONFERENCES:
            estimated_date = self._estimate_event_date(conf["typical_month"])

            if now <= estimated_date <= cutoff:
                event_id = self._generate_event_id("conference", conf["name"], estimated_date)
                events.append(Event(
                    event_id=event_id,
                    event_type="conference",
                    name=conf["name"],
                    date=estimated_date,
                    source_url=conf.get("sponsor_page") or conf["url"],
                    metadata={
                        "url": conf["url"],
                        "sponsor_page": conf.get("sponsor_page"),
                        "conference_type": conf["type"],
                    }
                ))

        # Check hackathons
        for hackathon in MAJOR_HACKATHONS:
            estimated_date = self._estimate_event_date(hackathon["typical_month"])

            if now <= estimated_date <= cutoff:
                event_id = self._generate_event_id("hackathon", hackathon["name"], estimated_date)
                events.append(Event(
                    event_id=event_id,
                    event_type="hackathon",
                    name=hackathon["name"],
                    date=estimated_date,
                    source_url=hackathon.get("sponsor_page") or hackathon["url"],
                    metadata={
                        "url": hackathon["url"],
                        "sponsor_page": hackathon.get("sponsor_page"),
                    }
                ))

        # Check YC Demo Days
        for demo_day in YC_DEMO_DAYS:
            estimated_date = self._estimate_event_date(demo_day["typical_month"])

            if now <= estimated_date <= cutoff:
                event_id = self._generate_event_id("demo_day", demo_day["name"], estimated_date)
                events.append(Event(
                    event_id=event_id,
                    event_type="demo_day",
                    name=demo_day["name"],
                    date=estimated_date,
                    source_url=demo_day["url"],
                    metadata={"batch": demo_day["name"].split()[1]}  # "Winter" or "Summer"
                ))

        self.events = events
        return events

    def get_triggered_actions(self, events: list[Event] = None) -> list[ScrapeAction]:
        """Get scraping actions that should be triggered by events.

        Args:
            events: Events to process (uses self.events if None)

        Returns:
            List of ScrapeAction objects to execute
        """
        if events is None:
            events = self.events

        actions = []
        now = datetime.now()

        for event in events:
            if event.event_id in self.processed_events:
                continue

            event_config = self.triggers_config.get(event.event_type, {})
            days_before = event_config.get("days_before", 14)
            days_after = event_config.get("days_after", 7)

            # Calculate trigger window
            trigger_start = event.date - timedelta(days=days_before)
            trigger_end = event.date + timedelta(days=days_after)

            # Check if we're in the trigger window
            if trigger_start <= now <= trigger_end:
                configured_actions = event_config.get("actions", [])

                for action_type in configured_actions:
                    # Calculate priority based on proximity to event
                    days_until = (event.date - now).days
                    if days_until <= 7:
                        priority = 5
                    elif days_until <= 14:
                        priority = 4
                    elif days_until <= 21:
                        priority = 3
                    else:
                        priority = 2

                    action = ScrapeAction(
                        action_type=action_type,
                        target=event.name,
                        priority=priority,
                        triggered_by=event.event_id,
                        metadata={
                            "event_name": event.name,
                            "event_date": event.date.isoformat(),
                            "days_until_event": days_until,
                            "source_url": event.source_url,
                            **event.metadata,
                        }
                    )
                    actions.append(action)

                # Mark as processed
                self.processed_events.add(event.event_id)
                event.triggered = True
                event.trigger_date = now

        # Sort by priority (highest first)
        actions.sort(key=lambda a: -a.priority)
        return actions


# =============================================================================
# Funding Event Detection
# =============================================================================

class FundingEventDetector:
    """Detects funding announcements and creates priority scrape events."""

    def __init__(self, triggers_config: dict = None):
        self.config = triggers_config or {
            "min_amount_millions": 5,
            "priority_rounds": ["Series A", "Series B", "Series C"],
        }
        self.detected_companies: set[str] = set()

    def check_funding_rss(self) -> list[Event]:
        """Check RSS feeds for new funding announcements.

        Returns:
            List of funding events
        """
        from sources.funding_signals import fetch_funding_from_rss, is_growth_stage

        events = []

        try:
            funding_rounds = fetch_funding_from_rss()

            for funding in funding_rounds:
                company_key = funding.company_name.lower().strip()

                if company_key in self.detected_companies:
                    continue

                # Check if this is a priority round
                is_priority = is_growth_stage(funding.round_type)

                # Parse amount
                amount_m = 0
                if funding.amount:
                    try:
                        amount_str = funding.amount.replace("$", "").upper()
                        if "B" in amount_str:
                            amount_m = float(amount_str.replace("B", "")) * 1000
                        elif "M" in amount_str:
                            amount_m = float(amount_str.replace("M", ""))
                    except ValueError:
                        pass

                min_amount = self.config.get("min_amount_millions", 5)

                if is_priority or amount_m >= min_amount:
                    event_id = hashlib.md5(
                        f"funding|{company_key}|{funding.date.isoformat()}".encode()
                    ).hexdigest()[:12]

                    events.append(Event(
                        event_id=event_id,
                        event_type="funding",
                        name=funding.company_name,
                        date=funding.date,
                        source_url=funding.source_url,
                        metadata={
                            "amount": funding.amount,
                            "round_type": funding.round_type,
                            "investors": funding.investors,
                            "source": funding.source,
                            "is_growth_stage": is_priority,
                        }
                    ))

                    self.detected_companies.add(company_key)

        except ImportError:
            print("Warning: Could not import funding_signals module")
        except Exception as e:
            print(f"Error checking funding RSS: {e}")

        return events


# =============================================================================
# Action Executors
# =============================================================================

class EventActionExecutor:
    """Executes scraping actions triggered by events."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.executed_actions: list[dict] = []

    def execute_action(self, action: ScrapeAction) -> dict:
        """Execute a single scraping action.

        Args:
            action: The ScrapeAction to execute

        Returns:
            Result dict with status and data
        """
        executor_map = {
            "scrape_sponsors": self._scrape_sponsors,
            "priority_scrape": self._priority_scrape,
            "refresh_yc_jobs": self._refresh_yc_jobs,
            "priority_company_scrape": self._priority_company_scrape,
        }

        executor = executor_map.get(action.action_type)
        if not executor:
            return {"status": "error", "message": f"Unknown action type: {action.action_type}"}

        if self.dry_run:
            return {
                "status": "dry_run",
                "action": action.action_type,
                "target": action.target,
                "would_execute": True,
            }

        try:
            result = executor(action)
            self.executed_actions.append({
                "action": action.action_type,
                "target": action.target,
                "result": result,
                "timestamp": datetime.now().isoformat(),
            })
            return result
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def _scrape_sponsors(self, action: ScrapeAction) -> dict:
        """Scrape sponsors from a conference/hackathon."""
        sponsors = []

        sponsor_url = action.metadata.get("sponsor_page")
        event_name = action.metadata.get("event_name", action.target)

        # Try to use existing conference scrapers
        try:
            from sources.conferences import (
                fetch_ghc_sponsors, fetch_nsbe_jobs,
                fetch_shpe_jobs, fetch_afrotech_jobs
            )
            from sources.hackathons import fetch_major_hackathon_sponsors

            event_lower = event_name.lower()

            if "ghc" in event_lower or "grace hopper" in event_lower:
                sponsors = fetch_ghc_sponsors()
            elif "nsbe" in event_lower:
                sponsors = fetch_nsbe_jobs()
            elif "shpe" in event_lower:
                sponsors = fetch_shpe_jobs()
            elif "afrotech" in event_lower:
                sponsors = fetch_afrotech_jobs()
            else:
                sponsors = fetch_major_hackathon_sponsors()

        except ImportError as e:
            return {"status": "error", "message": f"Could not import scrapers: {e}"}

        return {
            "status": "success",
            "sponsors_found": len(sponsors),
            "event": event_name,
            "sponsors": sponsors[:10] if sponsors else [],  # Return first 10 as sample
        }

    def _priority_scrape(self, action: ScrapeAction) -> dict:
        """Add companies to priority scrape queue."""
        # This would integrate with the main radar.py scheduler
        # For now, return the action for the scheduler to process
        return {
            "status": "queued",
            "event": action.target,
            "priority": action.priority,
            "message": f"Priority scrape queued for {action.target} sponsors",
        }

    def _refresh_yc_jobs(self, action: ScrapeAction) -> dict:
        """Refresh jobs from YC companies after Demo Day."""
        companies = []

        try:
            from sources.funding_signals import fetch_yc_recent_companies

            yc_companies = fetch_yc_recent_companies()
            companies = [
                {
                    "name": c.company_name,
                    "investors": c.investors,
                }
                for c in yc_companies
            ]

        except ImportError as e:
            return {"status": "error", "message": f"Could not import YC scraper: {e}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

        return {
            "status": "success",
            "companies_found": len(companies),
            "batch": action.metadata.get("batch", "Unknown"),
            "companies": companies[:20] if companies else [],  # Return first 20 as sample
        }

    def _priority_company_scrape(self, action: ScrapeAction) -> dict:
        """Add a recently funded company to priority scrape list."""
        company_name = action.target
        funding_info = action.metadata

        # Look up career page info
        try:
            from sources.funding_signals import get_career_page_for_company

            career_info = get_career_page_for_company(company_name)

            return {
                "status": "queued",
                "company": company_name,
                "funding": funding_info.get("amount"),
                "round": funding_info.get("round_type"),
                "careers_url": career_info.get("careers_url") if career_info else None,
                "ats_type": career_info.get("ats") if career_info else None,
                "priority": action.priority,
            }

        except ImportError:
            return {
                "status": "queued",
                "company": company_name,
                "funding": funding_info.get("amount"),
                "message": "Queued without career page lookup",
            }


# =============================================================================
# Main Event Alert System
# =============================================================================

class EventAlertSystem:
    """Main event-based job alert system.

    Coordinates event detection and triggered scraping actions.
    """

    def __init__(self, triggers_file: Optional[str] = None, dry_run: bool = False):
        self.calendar = EventCalendar(triggers_file)
        self.funding_detector = FundingEventDetector(
            self.calendar.triggers_config.get("funding", {})
        )
        self.executor = EventActionExecutor(dry_run)
        self.dry_run = dry_run

    def check_all_events(self, days_ahead: int = 30) -> list[Event]:
        """Check all event sources for upcoming events.

        Args:
            days_ahead: How many days ahead to check for events

        Returns:
            Combined list of all detected events
        """
        events = []

        # Check calendar events (conferences, hackathons, demo days)
        print("Checking calendar events...")
        calendar_events = self.calendar.detect_upcoming_events(days_ahead)
        events.extend(calendar_events)
        print(f"  Found {len(calendar_events)} calendar events")

        # Check funding events
        print("Checking funding announcements...")
        funding_events = self.funding_detector.check_funding_rss()
        events.extend(funding_events)
        print(f"  Found {len(funding_events)} funding events")

        return events

    def get_pending_actions(self, events: list[Event] = None) -> list[ScrapeAction]:
        """Get all scraping actions that should be executed.

        Args:
            events: Events to process (checks all if None)

        Returns:
            List of pending scraping actions
        """
        if events is None:
            events = self.check_all_events()

        # Get calendar-triggered actions
        actions = self.calendar.get_triggered_actions(events)

        # Add funding-triggered actions
        for event in events:
            if event.event_type == "funding":
                actions.append(ScrapeAction(
                    action_type="priority_company_scrape",
                    target=event.name,
                    priority=4 if event.metadata.get("is_growth_stage") else 3,
                    triggered_by=event.event_id,
                    metadata=event.metadata,
                ))

        # Dedupe and sort by priority
        seen = set()
        unique_actions = []
        for action in actions:
            key = f"{action.action_type}|{action.target}"
            if key not in seen:
                seen.add(key)
                unique_actions.append(action)

        unique_actions.sort(key=lambda a: -a.priority)
        return unique_actions

    def run(self, days_ahead: int = 30) -> dict:
        """Run the event alert system.

        Detects events, triggers actions, and executes scraping.

        Args:
            days_ahead: How many days ahead to check

        Returns:
            Summary of events and actions
        """
        print("=" * 60)
        print("EVENT-BASED JOB ALERT SYSTEM")
        print("=" * 60)

        if self.dry_run:
            print("[DRY RUN MODE - No actual scraping will occur]")
        print()

        # Detect events
        events = self.check_all_events(days_ahead)

        # Get triggered actions
        actions = self.get_pending_actions(events)

        print(f"\nPending actions: {len(actions)}")
        for i, action in enumerate(actions, 1):
            print(f"  {i}. [{action.priority}] {action.action_type}: {action.target}")

        # Execute actions
        results = []
        if actions:
            print("\nExecuting actions...")
            for action in actions:
                print(f"  -> {action.action_type}: {action.target}")
                result = self.executor.execute_action(action)
                results.append({
                    "action": action.action_type,
                    "target": action.target,
                    "result": result,
                })

        # Summary
        summary = {
            "timestamp": datetime.now().isoformat(),
            "dry_run": self.dry_run,
            "events_detected": len(events),
            "actions_triggered": len(actions),
            "results": results,
            "events": [
                {
                    "type": e.event_type,
                    "name": e.name,
                    "date": e.date.isoformat(),
                    "triggered": e.triggered,
                }
                for e in events
            ],
        }

        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Events detected: {summary['events_detected']}")
        print(f"Actions triggered: {summary['actions_triggered']}")

        if results:
            successful = sum(1 for r in results if r["result"].get("status") in ["success", "queued", "dry_run"])
            print(f"Actions completed: {successful}/{len(results)}")

        return summary


# =============================================================================
# Integration with Scheduler
# =============================================================================

def get_event_triggered_companies() -> list[dict]:
    """Get companies that should be priority scraped based on events.

    This is the main integration point for radar.py scheduler.

    Returns:
        List of company dicts with scraping priority info
    """
    system = EventAlertSystem(dry_run=True)
    events = system.check_all_events(days_ahead=14)
    actions = system.get_pending_actions(events)

    companies = []

    for action in actions:
        if action.action_type in ["priority_company_scrape", "priority_scrape"]:
            companies.append({
                "name": action.target,
                "priority": action.priority,
                "trigger_reason": action.action_type,
                "event_id": action.triggered_by,
                "metadata": action.metadata,
            })

    return companies


def check_for_event_triggers() -> dict:
    """Quick check for any pending event triggers.

    Returns a summary suitable for scheduler integration.
    """
    system = EventAlertSystem(dry_run=True)
    events = system.check_all_events(days_ahead=14)

    return {
        "has_triggers": len(events) > 0,
        "event_count": len(events),
        "event_types": list(set(e.event_type for e in events)),
        "next_event": min([e.date for e in events]).isoformat() if events else None,
    }


# =============================================================================
# CLI Entry Point
# =============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Event-Based Job Alert System")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without executing actual scraping"
    )
    parser.add_argument(
        "--days-ahead",
        type=int,
        default=30,
        help="How many days ahead to check for events (default: 30)"
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only check for events, don't execute actions"
    )
    args = parser.parse_args()

    system = EventAlertSystem(dry_run=args.dry_run or args.check_only)

    if args.check_only:
        events = system.check_all_events(args.days_ahead)
        print(f"\nFound {len(events)} upcoming events:")
        for event in events:
            days_until = (event.date - datetime.now()).days
            print(f"  - [{event.event_type}] {event.name}")
            print(f"    Date: {event.date.strftime('%Y-%m-%d')} ({days_until} days away)")
    else:
        summary = system.run(args.days_ahead)
        print(f"\nDone! Processed {summary['events_detected']} events.")
