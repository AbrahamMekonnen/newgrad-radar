"""Events tracking module.

Provides calendar tracking for major tech and diversity conferences
and YC Demo Day tracking to optimize timing of job board scraping.
"""

from .conference_calendar import (
    Conference,
    get_upcoming_conferences,
    get_conferences_by_category,
    get_conferences_by_focus,
    get_active_conferences,
    get_scraping_priority,
    get_all_conferences,
    add_conference,
    load_conferences,
    update_conference_dates,
)

from .yc_tracker import (
    YCCompany,
    get_recent_yc_batch,
    is_recent_yc_company,
    get_current_batch_name,
    get_batch_demo_day_date,
    get_yc_company_info,
    get_companies_by_batch,
    get_hiring_yc_companies,
    get_upcoming_demo_day,
    days_since_last_demo_day,
)

from .hackathon_calendar import (
    get_upcoming_hackathons,
    get_hackathon_sponsors,
    get_recruiting_signals,
    fetch_mlh_events,
    fetch_devpost_hackathons,
)

from .event_alerts import (
    EventAlertSystem,
    EventCalendar,
    FundingEventDetector,
    EventActionExecutor,
    Event,
    ScrapeAction,
    get_event_triggered_companies,
    check_for_event_triggers,
)

from .career_fairs import (
    get_upcoming_career_fairs,
    get_all_career_fairs,
    get_virtual_platforms,
    get_common_sponsors,
    get_career_fair_companies,
    fetch_handshake_events,
    fetch_mit_career_fair_companies,
    fetch_stanford_career_fair_companies,
    fetch_all_career_fair_companies,
    get_career_fair_stats,
    convert_to_job_leads,
)

__all__ = [
    # Conference calendar
    "Conference",
    "get_upcoming_conferences",
    "get_conferences_by_category",
    "get_conferences_by_focus",
    "get_active_conferences",
    "get_scraping_priority",
    "get_all_conferences",
    "add_conference",
    "load_conferences",
    "update_conference_dates",
    # YC Demo Day tracker
    "YCCompany",
    "get_recent_yc_batch",
    "is_recent_yc_company",
    "get_current_batch_name",
    "get_batch_demo_day_date",
    "get_yc_company_info",
    "get_companies_by_batch",
    "get_hiring_yc_companies",
    "get_upcoming_demo_day",
    "days_since_last_demo_day",
    # Hackathon calendar
    "get_upcoming_hackathons",
    "get_hackathon_sponsors",
    "get_recruiting_signals",
    "fetch_mlh_events",
    "fetch_devpost_hackathons",
    # Event alert system (proactive scraping)
    "EventAlertSystem",
    "EventCalendar",
    "FundingEventDetector",
    "EventActionExecutor",
    "Event",
    "ScrapeAction",
    "get_event_triggered_companies",
    "check_for_event_triggers",
    # Career fairs (university and virtual)
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
