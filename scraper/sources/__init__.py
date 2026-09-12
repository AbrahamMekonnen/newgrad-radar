"""Job source adapters."""

from .simplify import fetch_simplify
from .greenhouse import fetch_greenhouse
from .lever import fetch_lever
from .ashby import fetch_ashby
from .arbeitnow import fetch_arbeitnow
from .remoteok import fetch_remoteok
from .adzuna import fetch_adzuna, fetch_adzuna_simple
from .usajobs import fetch_usajobs
from .hn_hiring import fetch_hn_hiring
from .workday import (
    fetch_workday,
    fetch_workday_company,
    fetch_workday_all,
    WORKDAY_COMPANIES,
)
from .vc_portfolios import (
    fetch_a16z_jobs,
    fetch_yc_jobs,
    fetch_firstround_jobs,
    fetch_sequoia_jobs,
    fetch_all_vc_jobs,
)
from .deep_crawler import (
    deep_crawl,
    fetch_deep_crawl,
    crawl_custom_companies,
)
from .conferences import (
    fetch_ghc_sponsors,
    fetch_nsbe_jobs,
    fetch_shpe_jobs,
    fetch_afrotech_jobs,
    fetch_all_conference_jobs,
)
from .other_ats import (
    fetch_smartrecruiters,
    fetch_icims,
    fetch_jobvite,
    fetch_bamboohr,
    fetch_breezyhr,
    fetch_jazzhr,
    fetch_recruitee,
)
from .hackathons import (
    fetch_mlh_sponsors,
    fetch_devpost_companies,
    fetch_major_hackathon_sponsors,
    fetch_all_hackathon_sponsors,
    get_greenhouse_sponsors,
    get_lever_sponsors,
    get_ashby_sponsors,
)
from .github_repos import (
    fetch_github_repos,
    fetch_all_github_repos,
    fetch_simplify_readme,
    fetch_pittcsc,
    fetch_zapplyjobs,
    GITHUB_REPOS,
)
from .bootcamps import (
    fetch_flatiron_partners,
    fetch_ga_partners,
    fetch_appacademy_partners,
    fetch_hackreactor_partners,
    fetch_all_bootcamp_partners,
    get_bootcamp_partner_companies,
    get_bootcamp_partner_career_urls,
)
from .h1b_data import (
    is_h1b_sponsor,
    is_known_non_sponsor,
    get_sponsorship_info,
    add_sponsorship_flag,
    add_sponsorship_flags,
    get_sponsor_stats,
    refresh_sponsor_data,
)
from .funding_signals import (
    fetch_funding_signals,
    run_weekly_funding_scan,
    get_hot_hiring_companies,
    discover_career_page,
    get_career_page_for_company,
    FundingRound,
    FUNDED_COMPANY_CAREERS,
)
from .newsletters import (
    fetch_tldr_jobs,
    fetch_diversify_tech,
    fetch_all_newsletter_jobs,
    fetch_newsletters,
    fetch_all_newsletter_rss,
)

__all__ = [
    "fetch_simplify",
    "fetch_greenhouse",
    "fetch_lever",
    "fetch_ashby",
    "fetch_arbeitnow",
    "fetch_remoteok",
    "fetch_adzuna",
    "fetch_adzuna_simple",
    "fetch_usajobs",
    "fetch_hn_hiring",
    "fetch_workday",
    "fetch_workday_company",
    "fetch_workday_all",
    "WORKDAY_COMPANIES",
    # VC Portfolio Job Boards
    "fetch_a16z_jobs",
    "fetch_yc_jobs",
    "fetch_firstround_jobs",
    "fetch_sequoia_jobs",
    "fetch_all_vc_jobs",
    # Deep Crawler (for custom ATS)
    "deep_crawl",
    "fetch_deep_crawl",
    "crawl_custom_companies",
    # Diversity Conference Job Boards
    "fetch_ghc_sponsors",
    "fetch_nsbe_jobs",
    "fetch_shpe_jobs",
    "fetch_afrotech_jobs",
    "fetch_all_conference_jobs",
    # Other ATS Systems (SmartRecruiters, iCIMS, Jobvite, BambooHR, etc.)
    "fetch_smartrecruiters",
    "fetch_icims",
    "fetch_jobvite",
    "fetch_bamboohr",
    "fetch_breezyhr",
    "fetch_jazzhr",
    "fetch_recruitee",
    # Hackathon Sponsors (MLH, Devpost, major hackathons)
    "fetch_mlh_sponsors",
    "fetch_devpost_companies",
    "fetch_major_hackathon_sponsors",
    "fetch_all_hackathon_sponsors",
    "get_greenhouse_sponsors",
    "get_lever_sponsors",
    "get_ashby_sponsors",
    # GitHub New-Grad Repos (community curated lists)
    "fetch_github_repos",
    "fetch_all_github_repos",
    "fetch_simplify_readme",
    "fetch_pittcsc",
    "fetch_zapplyjobs",
    "GITHUB_REPOS",
    # Bootcamp Hiring Partners (Flatiron, GA, App Academy, Hack Reactor)
    "fetch_flatiron_partners",
    "fetch_ga_partners",
    "fetch_appacademy_partners",
    "fetch_hackreactor_partners",
    "fetch_all_bootcamp_partners",
    "get_bootcamp_partner_companies",
    "get_bootcamp_partner_career_urls",
    # H1B Sponsor Data (helps international students)
    "is_h1b_sponsor",
    "is_known_non_sponsor",
    "get_sponsorship_info",
    "add_sponsorship_flag",
    "add_sponsorship_flags",
    "get_sponsor_stats",
    "refresh_sponsor_data",
    # Funding Signals (recently funded companies = hot hiring)
    "fetch_funding_signals",
    "run_weekly_funding_scan",
    "get_hot_hiring_companies",
    "discover_career_page",
    "get_career_page_for_company",
    "FundingRound",
    "FUNDED_COMPANY_CAREERS",
    # Newsletter Job Aggregators (TLDR Jobs, DiversifyTech, RSS feeds)
    "fetch_tldr_jobs",
    "fetch_diversify_tech",
    "fetch_all_newsletter_jobs",
    "fetch_newsletters",
    "fetch_all_newsletter_rss",
]
