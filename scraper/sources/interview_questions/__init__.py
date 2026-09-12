"""Interview questions scrapers.

This module contains scrapers for various interview question sources,
organized by category (quant finance, tech, behavioral, etc.).

Shared types are defined here to avoid circular imports.
"""

from enum import Enum
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Any


class QuestionType(str, Enum):
    """Types of interview questions."""
    TECHNICAL = "technical"
    BEHAVIORAL = "behavioral"
    SYSTEM_DESIGN = "system_design"
    CODING = "coding"
    OA = "oa"  # Online Assessment
    BRAIN_TEASER = "brain_teaser"
    PROBABILITY = "probability"
    STATISTICS = "statistics"
    MATH = "math"
    FINANCE = "finance"
    MENTAL_MATH = "mental_math"
    GENERAL = "general"

    def __str__(self) -> str:
        return self.value


class Difficulty(str, Enum):
    """Difficulty levels for interview questions."""
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    UNKNOWN = "unknown"

    def __str__(self) -> str:
        return self.value


@dataclass
class InterviewQuestion:
    """Represents a single interview question."""
    id: str
    company: str
    position: str
    question_type: str  # Use string to allow flexibility (enum value or raw string)
    difficulty: str  # Use string to allow flexibility
    question_text: str
    source: str
    source_url: str
    posted_date: Optional[str] = None
    tags: Optional[List[str]] = None
    interview_date: Optional[str] = None
    role: Optional[str] = None
    context: Optional[str] = None
    upvotes: Optional[int] = None
    round_info: Optional[str] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Import scraper functions - use lazy imports to avoid circular dependencies
def _get_scraper_module(name: str):
    """Lazy import of scraper modules."""
    import importlib
    return importlib.import_module(f".{name}", __package__)


def scrape_quant_finance(*args, **kwargs):
    """Scrape quant finance interview questions from QuantNet and Brainstellar."""
    mod = _get_scraper_module("quant_finance")
    return mod.scrape_quant_finance(*args, **kwargs)


def scrape_github_gists(*args, **kwargs):
    """Scrape interview questions from GitHub Gists."""
    mod = _get_scraper_module("github_gists")
    return mod.scrape_github_gists(*args, **kwargs)


def scrape_geeksforgeeks(*args, **kwargs):
    """Scrape interview experiences from GeeksforGeeks."""
    mod = _get_scraper_module("geeksforgeeks")
    return mod.scrape_geeksforgeeks(*args, **kwargs)


def fetch_gfg_interviews(*args, **kwargs):
    """Alias for scrape_geeksforgeeks."""
    mod = _get_scraper_module("geeksforgeeks")
    return mod.fetch_gfg_interviews(*args, **kwargs)


def scrape_leetcode_discuss(*args, **kwargs):
    """Scrape interview experiences from LeetCode Discuss."""
    mod = _get_scraper_module("leetcode_discuss")
    return mod.scrape_leetcode_discuss(*args, **kwargs)


def scrape_leetcode_by_company(*args, **kwargs):
    """Scrape LeetCode Discuss filtered by company."""
    mod = _get_scraper_module("leetcode_discuss")
    return mod.scrape_leetcode_by_company(*args, **kwargs)


def scrape_nowcoder(*args, **kwargs):
    """Scrape interview experiences from Nowcoder (牛客网)."""
    mod = _get_scraper_module("nowcoder")
    return mod.scrape_nowcoder(*args, **kwargs)


def scrape_dou(*args, **kwargs):
    """Scrape interview experiences from DOU.ua (Ukraine)."""
    mod = _get_scraper_module("dou_ua")
    return mod.scrape_dou(*args, **kwargs)


def scrape_dou_company(*args, **kwargs):
    """Scrape DOU.ua filtered by company."""
    mod = _get_scraper_module("dou_ua")
    return mod.scrape_dou_company(*args, **kwargs)


def scrape_openwork(*args, **kwargs):
    """Scrape interview experiences from OpenWork (Japan)."""
    mod = _get_scraper_module("openwork")
    return mod.scrape_openwork(*args, **kwargs)


def scrape_careercup(*args, **kwargs):
    """Scrape interview questions from CareerCup."""
    mod = _get_scraper_module("careercup")
    return mod.scrape_careercup(*args, **kwargs)


def scrape_careercup_search(*args, **kwargs):
    """Search CareerCup for interview questions."""
    mod = _get_scraper_module("careercup")
    return mod.scrape_careercup_search(*args, **kwargs)


def scrape_programmers_kr(*args, **kwargs):
    """Scrape interview problems from Programmers.co.kr (Korea)."""
    mod = _get_scraper_module("programmers_kr")
    return mod.scrape_programmers_kr(*args, **kwargs)


def scrape_habr(*args, **kwargs):
    """Scrape interview experiences from Habr.com (Russia) - async."""
    mod = _get_scraper_module("habr")
    return mod.scrape_habr(*args, **kwargs)


def scrape_habr_sync(*args, **kwargs):
    """Scrape interview experiences from Habr.com (Russia) - sync."""
    mod = _get_scraper_module("habr")
    return mod.scrape_habr_sync(*args, **kwargs)


def scrape_qiita(*args, **kwargs):
    """Scrape interview experiences from Qiita (Japan)."""
    mod = _get_scraper_module("qiita")
    return mod.scrape_qiita(*args, **kwargs)


def scrape_qiita_by_company(*args, **kwargs):
    """Scrape Qiita filtered by company."""
    mod = _get_scraper_module("qiita")
    return mod.scrape_qiita_by_company(*args, **kwargs)


def scrapeWikiJob(*args, **kwargs):
    """Scrape interview questions from WikiJob UK."""
    mod = _get_scraper_module("wikijob")
    return mod.scrapeWikiJob(*args, **kwargs)


def scrape_wikijob_uk(*args, **kwargs):
    """Alias for scrapeWikiJob."""
    mod = _get_scraper_module("wikijob")
    return mod.scrape_wikijob_uk(*args, **kwargs)


def scrape_takeuforward(*args, **kwargs):
    """Scrape DSA problems from TakeUForward/Striver sheets."""
    mod = _get_scraper_module("takeuforward")
    return mod.scrape_takeuforward(*args, **kwargs)


def scrape_github_repos(*args, **kwargs):
    """Scrape interview questions from GitHub repos (tech-interview-handbook, etc.)."""
    mod = _get_scraper_module("github_repos")
    return mod.scrape_github_repos(*args, **kwargs)


def scrape_codestudio(*args, **kwargs):
    """Scrape company-tagged problems from CodeStudio."""
    mod = _get_scraper_module("codestudio")
    return mod.scrape_codestudio(*args, **kwargs)


def scrape_youtube(*args, **kwargs):
    """Scrape interview content from YouTube."""
    mod = _get_scraper_module("youtube")
    return mod.scrape_youtube(*args, **kwargs)


def fetch_youtube_interviews(*args, **kwargs):
    """Alias for scrape_youtube."""
    mod = _get_scraper_module("youtube")
    return mod.fetch_youtube_interviews(*args, **kwargs)


def scrape_tabnews(*args, **kwargs):
    """Scrape interview experiences from TabNews (Brazil)."""
    mod = _get_scraper_module("tabnews")
    return mod.scrape_tabnews(*args, **kwargs)


def scrape_tabnews_by_company(*args, **kwargs):
    """Scrape TabNews filtered by company."""
    mod = _get_scraper_module("tabnews")
    return mod.scrape_tabnews_by_company(*args, **kwargs)


def fetch_tabnews_interviews(*args, **kwargs):
    """Alias for scrape_tabnews."""
    mod = _get_scraper_module("tabnews")
    return mod.fetch_tabnews_interviews(*args, **kwargs)


def scrape_dicoding(*args, **kwargs):
    """Scrape interview experiences from Dicoding (Indonesia)."""
    mod = _get_scraper_module("dicoding")
    return mod.scrape_dicoding(*args, **kwargs)


def fetch_dicoding_interviews(*args, **kwargs):
    """Alias for scrape_dicoding."""
    mod = _get_scraper_module("dicoding")
    return mod.fetch_dicoding_interviews(*args, **kwargs)


def scrape_telegram(*args, **kwargs):
    """Scrape interview questions from Telegram channels (@leetcode_daily, @faang_oa, etc.)."""
    mod = _get_scraper_module("telegram_monitor")
    return mod.scrape_telegram(*args, **kwargs)


def fetch_telegram_interviews(*args, **kwargs):
    """Alias for scrape_telegram."""
    mod = _get_scraper_module("telegram_monitor")
    return mod.fetch_telegram_interviews(*args, **kwargs)


def scrape_bootcamp_leaked(*args, **kwargs):
    """Scrape leaked bootcamp interview materials (App Academy, Hack Reactor, Lambda, etc.)."""
    mod = _get_scraper_module("bootcamp_leaked")
    return mod.scrape_bootcamp_leaked(*args, **kwargs)


def fetch_bootcamp_leaked(*args, **kwargs):
    """Alias for scrape_bootcamp_leaked."""
    mod = _get_scraper_module("bootcamp_leaked")
    return mod.fetch_bootcamp_leaked(*args, **kwargs)


def scrape_ambitionbox(*args, **kwargs):
    """Scrape interview experiences from AmbitionBox (India)."""
    mod = _get_scraper_module("ambitionbox")
    return mod.scrape_ambitionbox(*args, **kwargs)


def fetch_ambitionbox_interviews(*args, **kwargs):
    """Alias for scrape_ambitionbox."""
    mod = _get_scraper_module("ambitionbox")
    return mod.fetch_ambitionbox_interviews(*args, **kwargs)


def scrape_bayt(*args, **kwargs):
    """Scrape interview experiences from Bayt.com (Middle East)."""
    mod = _get_scraper_module("bayt")
    return mod.scrape_bayt(*args, **kwargs)


def fetch_bayt_interviews(*args, **kwargs):
    """Alias for scrape_bayt."""
    mod = _get_scraper_module("bayt")
    return mod.fetch_bayt_interviews(*args, **kwargs)


def scrape_zhihu(*args, **kwargs):
    """Scrape interview experiences from Zhihu (China)."""
    mod = _get_scraper_module("zhihu")
    return mod.scrape_zhihu(*args, **kwargs)


def scrape_zhihu_by_company(*args, **kwargs):
    """Scrape Zhihu filtered by company."""
    mod = _get_scraper_module("zhihu")
    return mod.scrape_zhihu_by_company(*args, **kwargs)


def scrape_atcoder(*args, **kwargs):
    """Scrape competitive programming problems from AtCoder (Japan)."""
    mod = _get_scraper_module("atcoder")
    return mod.scrape_atcoder(*args, **kwargs)


def scrape_codeforces(*args, **kwargs):
    """Scrape competitive programming problems from Codeforces."""
    mod = _get_scraper_module("codeforces")
    return mod.scrape_codeforces(*args, **kwargs)


def scrape_studentroom(*args, **kwargs):
    """Scrape interview experiences from The Student Room (UK)."""
    mod = _get_scraper_module("studentroom")
    return mod.scrape_studentroom(*args, **kwargs)


def scrape_itviec(*args, **kwargs):
    """Scrape interview experiences from ITviec (Vietnam)."""
    mod = _get_scraper_module("itviec")
    return mod.scrape_itviec(*args, **kwargs)


def scrape_kununu(*args, **kwargs):
    """Scrape interview experiences from Kununu (Germany/DACH)."""
    mod = _get_scraper_module("kununu")
    return mod.scrape_kununu(*args, **kwargs)


def scrape_kununu_search(*args, **kwargs):
    """Search Kununu for interview experiences."""
    mod = _get_scraper_module("kununu")
    return mod.scrape_kununu_search(*args, **kwargs)


def fetch_kununu_interviews(*args, **kwargs):
    """Alias for scrape_kununu."""
    mod = _get_scraper_module("kununu")
    return mod.fetch_kununu_interviews(*args, **kwargs)


def scrape_blind(*args, **kwargs):
    """Scrape interview experiences from Blind (requires auth)."""
    mod = _get_scraper_module("blind_submission")
    return mod.scrape_blind(*args, **kwargs)


def scrape_glassdoor(*args, **kwargs):
    """Scrape interview experiences from Glassdoor (requires auth)."""
    mod = _get_scraper_module("glassdoor_submission")
    return mod.scrape_glassdoor(*args, **kwargs)


__all__ = [
    # Types
    "QuestionType",
    "Difficulty",
    "InterviewQuestion",
    # Scrapers - Global/US
    "scrape_quant_finance",
    "scrape_github_gists",
    "scrape_github_repos",
    "scrape_geeksforgeeks",
    "fetch_gfg_interviews",
    "scrape_leetcode_discuss",
    "scrape_leetcode_by_company",
    "scrape_careercup",
    "scrape_careercup_search",
    "scrape_takeuforward",
    "scrape_codestudio",
    "scrape_codeforces",
    "scrape_youtube",
    "fetch_youtube_interviews",
    "scrape_bootcamp_leaked",
    "fetch_bootcamp_leaked",
    "scrape_blind",
    "scrape_glassdoor",
    # Scrapers - Japan
    "scrape_openwork",
    "scrape_qiita",
    "scrape_qiita_by_company",
    "scrape_atcoder",
    # Scrapers - China
    "scrape_nowcoder",
    "scrape_zhihu",
    "scrape_zhihu_by_company",
    # Scrapers - Korea
    "scrape_programmers_kr",
    # Scrapers - Russia/Ukraine
    "scrape_dou",
    "scrape_dou_company",
    "scrape_habr",
    "scrape_habr_sync",
    # Scrapers - Germany/Europe
    "scrape_kununu",
    "scrape_kununu_search",
    "fetch_kununu_interviews",
    "scrapeWikiJob",
    "scrape_wikijob_uk",
    "scrape_studentroom",
    # Scrapers - India
    "scrape_ambitionbox",
    "fetch_ambitionbox_interviews",
    # Scrapers - Middle East
    "scrape_bayt",
    "fetch_bayt_interviews",
    # Scrapers - Southeast Asia
    "scrape_itviec",
    "scrape_dicoding",
    "fetch_dicoding_interviews",
    # Scrapers - Latin America
    "scrape_tabnews",
    "scrape_tabnews_by_company",
    "fetch_tabnews_interviews",
    # Scrapers - Messaging/Social
    "scrape_telegram",
    "fetch_telegram_interviews",
]
