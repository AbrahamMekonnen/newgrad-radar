"""Interview Question Scraper Orchestrator.

Coordinates all interview question scrapers, handles deduplication,
tracks scraper timestamps, and saves results to database.

Features:
- Parallel execution with concurrency limit
- Priority-based ordering within parallel batches
- Incremental mode (only new since last run)
- Isolated failure handling per scraper
- Real-time progress reporting
- Resume capability from previous failed runs
"""

import asyncio
import hashlib
import json
import logging
import os
import sys
import tempfile
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

from supabase import create_client, Client

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY
from db_optimizer import (
    InterviewQuestionDB,
    BatchConfig,
    UpsertResult,
    get_interview_db,
    close_interview_db,
)
from sources.interview_questions.quality import classify_question, classify_question_smart

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('interview_scraper.log')
    ]
)
logger = logging.getLogger('interview_orchestrator')


class QuestionType(Enum):
    TECHNICAL = 'technical'
    BEHAVIORAL = 'behavioral'
    SYSTEM_DESIGN = 'system_design'
    OA = 'oa'
    UNKNOWN = 'unknown'


class Difficulty(Enum):
    EASY = 'easy'
    MEDIUM = 'medium'
    HARD = 'hard'
    UNKNOWN = 'unknown'


class ScraperStatus(Enum):
    PENDING = 'pending'
    RUNNING = 'running'
    COMPLETED = 'completed'
    FAILED = 'failed'
    SKIPPED = 'skipped'


@dataclass
class InterviewQuestion:
    """Represents an interview question."""
    id: str
    company_name: str
    company_normalized: str
    role: str
    role_normalized: str
    question_text: str
    question_type: QuestionType
    difficulty: Difficulty
    source: str
    source_url: str
    interview_date: Optional[datetime]
    posted_date: datetime
    scraped_at: datetime
    upvotes: int = 0
    tags: list[str] = field(default_factory=list)
    language: str = 'en'
    original_language: Optional[str] = None
    translated_text: Optional[str] = None
    metadata: dict = field(default_factory=dict)


def _question_to_dict(q: Any) -> dict:
    """Normalize a scraper's question (dict, dataclass, or plain object) to a
    plain dict so downstream code can use .get() uniformly."""
    if isinstance(q, dict):
        return q
    if hasattr(q, "to_dict") and callable(getattr(q, "to_dict")):
        try:
            return q.to_dict()
        except Exception:
            pass
    try:
        return asdict(q)  # dataclass instances
    except Exception:
        pass
    return dict(getattr(q, "__dict__", {}) or {})


def _explode_questions(items: list) -> list:
    """Some scrapers (e.g. leetcode_discuss) return one record per interview
    post carrying a ``questions`` list rather than a single ``question_text``.
    The persistence layer stores one row per question, so explode those into
    individual question dicts. Records that already have ``question_text`` pass
    through unchanged.
    """
    out = []
    for q in items:
        if not isinstance(q, dict):
            out.append(q)
            continue
        if q.get("question_text"):
            out.append(q)
            continue
        qs = q.get("questions")
        if isinstance(qs, list) and qs:
            base = {k: v for k, v in q.items() if k != "questions"}
            # carry a couple of common field-name variants to the row schema
            if not base.get("source_url") and base.get("url"):
                base["source_url"] = base["url"]
            for qt in qs:
                if isinstance(qt, str) and qt.strip():
                    row = dict(base)
                    row["question_text"] = qt.strip()
                    out.append(row)
        else:
            out.append(q)  # no questions at all — let normalize skip it
    return out


@dataclass
class ScraperConfig:
    """Configuration for a scraper."""
    name: str
    source: str
    scraper_type: str  # 'python' or 'typescript'
    module_path: str
    function_name: str
    priority: int = 5  # 1-10, lower = higher priority
    schedule: str = 'daily'  # 'hourly', 'daily', 'weekly'
    enabled: bool = True
    rate_limit_delay: float = 2.0  # seconds between requests
    max_retries: int = 1
    timeout: int = 300  # seconds


@dataclass
class ScraperResult:
    """Result from running a scraper."""
    name: str
    status: ScraperStatus
    questions_found: int
    questions_new: int
    questions_updated: int
    errors: list[str]
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: float = 0.0


@dataclass
class OrchestratorStats:
    """Overall orchestration statistics."""
    run_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    scrapers_total: int = 0
    scrapers_completed: int = 0
    scrapers_failed: int = 0
    scrapers_skipped: int = 0
    questions_found_total: int = 0
    questions_new_total: int = 0
    questions_updated_total: int = 0
    errors: list[str] = field(default_factory=list)


class ProgressReporter:
    """Real-time progress reporting for scraper runs."""

    def __init__(self, total: int, show_bar: bool = True):
        self.total = total
        self.completed = 0
        self.failed = 0
        self.skipped = 0
        self.show_bar = show_bar
        self._lock = asyncio.Lock()
        self._start_time = datetime.now(timezone.utc)
        self._current_scrapers: dict[str, str] = {}  # name -> status

    async def update(self, scraper_name: str, status: str, result: Optional[ScraperResult] = None):
        """Update progress for a scraper."""
        async with self._lock:
            self._current_scrapers[scraper_name] = status

            if result:
                if result.status == ScraperStatus.COMPLETED:
                    self.completed += 1
                elif result.status == ScraperStatus.FAILED:
                    self.failed += 1
                elif result.status == ScraperStatus.SKIPPED:
                    self.skipped += 1

            self._print_progress()

    def _print_progress(self):
        """Print progress bar and status."""
        if not self.show_bar:
            return

        done = self.completed + self.failed + self.skipped
        pct = (done / self.total * 100) if self.total > 0 else 0

        # Running scrapers
        running = [n for n, s in self._current_scrapers.items() if s == 'running']
        running_str = ', '.join(running[:3])
        if len(running) > 3:
            running_str += f" +{len(running)-3} more"

        elapsed = (datetime.now(timezone.utc) - self._start_time).total_seconds()

        bar_len = 30
        filled = int(bar_len * done / self.total) if self.total > 0 else 0
        bar = '█' * filled + '░' * (bar_len - filled)

        status = f"\r[{bar}] {pct:.0f}% | {done}/{self.total} | ✓{self.completed} ✗{self.failed} ⊘{self.skipped} | {elapsed:.0f}s"
        if running:
            status += f" | Running: {running_str}"

        print(status, end='', flush=True)

        if done == self.total:
            print()  # newline when complete


class InterviewQuestionOrchestrator:
    """Orchestrates all interview question scrapers with parallel execution."""

    # Registry of available scrapers
    SCRAPERS: list[ScraperConfig] = [
        # Tier 1: API-based (most reliable)
        ScraperConfig(
            name='devto',
            source='devto',
            scraper_type='python',
            module_path='sources.devto_interviews',
            function_name='scrape_devto',
            priority=1,
            timeout=900,
        ),
        ScraperConfig(
            name='hackernews',
            source='hackernews',
            scraper_type='python',
            module_path='sources.hn_interviews',
            function_name='scrape_hackernews',
            priority=1,
            timeout=1200,
        ),
        ScraperConfig(
            name='reddit',
            source='reddit',
            scraper_type='python',
            module_path='sources.reddit_interviews',
            function_name='scrape_reddit',
            priority=1,
            # Disabled: Reddit's Nov-2025 API policy requires per-app
            # pre-approval, so every run just 401s and wastes calls. Flip back
            # to True if/when an approved Reddit app + credentials are in place.
            enabled=False,
        ),

        # Tier 2: Structured sites (reliable, need parsing)
        ScraperConfig(
            name='github_repos',
            source='github',
            scraper_type='python',
            module_path='sources.interview_questions.github_repos',
            function_name='scrape_github_repos',
            priority=2,
            timeout=2400,   # fetches 550+ company files + parses ~20k rows
            max_retries=1,  # no point re-doing this heavy scrape on timeout
        ),
        ScraperConfig(
            name='github_gists',
            source='github',
            scraper_type='python',
            module_path='sources.interview_questions.github_gists',
            function_name='scrape_github_gists',
            priority=2,
        ),
        ScraperConfig(
            name='geeksforgeeks',
            source='geeksforgeeks',
            scraper_type='python',
            module_path='sources.interview_questions.geeksforgeeks',
            function_name='scrape_geeksforgeeks',
            priority=2,
        ),
        ScraperConfig(
            name='careercup',
            source='careercup',
            scraper_type='python',
            module_path='sources.interview_questions.careercup',
            function_name='scrape_careercup',
            priority=2,
            timeout=1200,
        ),
        ScraperConfig(
            name='leetcode_discuss',
            source='leetcode',
            scraper_type='python',
            module_path='sources.interview_questions.leetcode_discuss',
            function_name='scrape_leetcode_discuss',
            priority=2,
            timeout=900,
        ),

        # Tier 3: International sources (need translation)
        ScraperConfig(
            name='nowcoder',
            source='nowcoder',
            scraper_type='python',
            module_path='sources.interview_questions.nowcoder',
            function_name='scrape_nowcoder',
            priority=3,
        ),
        ScraperConfig(
            name='programmers_kr',
            source='programmers_kr',
            scraper_type='python',
            module_path='sources.interview_questions.programmers_kr',
            function_name='scrape_programmers_kr',
            priority=3,
        ),
        ScraperConfig(
            name='qiita',
            source='qiita',
            scraper_type='python',
            module_path='sources.interview_questions.qiita',
            function_name='scrape_qiita',
            priority=3,
        ),
        ScraperConfig(
            name='habr',
            source='habr',
            scraper_type='python',
            module_path='sources.interview_questions.habr',
            function_name='scrape_habr',
            priority=3,
        ),

        # Tier 4: Indian sources (high volume)
        ScraperConfig(
            name='takeuforward',
            source='takeuforward',
            scraper_type='python',
            module_path='sources.interview_questions.takeuforward',
            function_name='scrape_takeuforward',
            priority=4,
        ),
        ScraperConfig(
            name='codestudio',
            source='codestudio',
            scraper_type='python',
            module_path='sources.interview_questions.codestudio',
            function_name='scrape_codestudio',
            priority=4,
            timeout=1200,
        ),

        # Tier 5: Niche sources
        ScraperConfig(
            name='quantfinance',
            source='quantnet',
            scraper_type='python',
            module_path='sources.interview_questions.quant_finance',
            function_name='scrape_quant_finance',
            priority=5,
        ),
        ScraperConfig(
            name='wikijob_uk',
            source='wikijob',
            scraper_type='python',
            module_path='sources.interview_questions.wikijob',
            function_name='scrape_wikijob',
            priority=5,
        ),
        ScraperConfig(
            name='dou_ukraine',
            source='dou',
            scraper_type='python',
            module_path='sources.interview_questions.dou_ua',
            function_name='scrape_dou',
            priority=5,
        ),
        ScraperConfig(
            name='openwork_japan',
            source='openwork',
            scraper_type='python',
            module_path='sources.interview_questions.openwork',
            function_name='scrape_openwork',
            priority=5,
            schedule='weekly',
        ),

        # Tier 6: Regional / global sources (many bot-block, but attempted).
        # Chronically slow / frequently times out — cap it low and don't retry so
        # it fails fast (5 min, not 20) instead of dominating the run. It's
        # non-fatal now, so a timeout just skips this one source.
        ScraperConfig(name='ambitionbox', source='ambitionbox', scraper_type='python',
                      module_path='sources.interview_questions.ambitionbox',
                      function_name='scrape_ambitionbox', priority=6, timeout=300,
                      max_retries=0),
        ScraperConfig(name='bayt_middleeast', source='bayt', scraper_type='python',
                      module_path='sources.interview_questions.bayt',
                      function_name='scrape_bayt_middleeast', priority=6),
        ScraperConfig(name='kununu_germany', source='kununu', scraper_type='python',
                      module_path='sources.interview_questions.kununu',
                      function_name='scrape_kununu', priority=6),
        ScraperConfig(name='itviec_vietnam', source='itviec', scraper_type='python',
                      module_path='sources.interview_questions.itviec',
                      function_name='scrape_itviec', priority=6),
        ScraperConfig(name='dicoding_indonesia', source='dicoding', scraper_type='python',
                      module_path='sources.interview_questions.dicoding',
                      function_name='scrape_dicoding', priority=6),
        ScraperConfig(name='tabnews_brazil', source='tabnews', scraper_type='python',
                      module_path='sources.interview_questions.tabnews',
                      function_name='scrape_tabnews', priority=6),
        ScraperConfig(name='studentroom_uk', source='studentroom', scraper_type='python',
                      module_path='sources.interview_questions.studentroom',
                      function_name='scrape_studentroom', priority=6),
        ScraperConfig(name='zhihu_china', source='zhihu', scraper_type='python',
                      module_path='sources.interview_questions.zhihu',
                      function_name='scrape_zhihu', priority=6),
        ScraperConfig(name='atcoder', source='atcoder', scraper_type='python',
                      module_path='sources.interview_questions.atcoder',
                      function_name='scrape_atcoder', priority=6),
        ScraperConfig(name='codeforces', source='codeforces', scraper_type='python',
                      module_path='sources.interview_questions.codeforces',
                      function_name='scrape_codeforces', priority=6),
        ScraperConfig(name='youtube', source='youtube', scraper_type='python',
                      module_path='sources.interview_questions.youtube',
                      function_name='scrape_youtube', priority=6),
        ScraperConfig(name='telegram', source='telegram', scraper_type='python',
                      module_path='sources.interview_questions.telegram_monitor',
                      function_name='scrape_telegram', priority=6,
                      # run every 6h CI cycle (not the 'daily' default); the
                      # persisted CI cache keeps discovery warm so this is
                      # cheap and flood-safe.
                      schedule='hourly', timeout=2100),
        ScraperConfig(name='bootcamp_leaked', source='bootcamp', scraper_type='python',
                      module_path='sources.interview_questions.bootcamp_leaked',
                      function_name='scrape_bootcamp_leaked', priority=6),
    ]

    # State file for resume capability
    STATE_FILE = Path(__file__).parent / '.orchestrator_state.json'

    def __init__(
        self,
        months_back: int = 5,
        dry_run: bool = False,
        only_sources: Optional[list[str]] = None,
        exclude_sources: Optional[list[str]] = None,
        max_concurrency: int = 5,
        incremental: bool = False,
        resume: bool = False,
        show_progress: bool = True,
    ):
        """Initialize the orchestrator.

        Args:
            months_back: Number of months of historical data to fetch
            dry_run: If True, don't write to database
            only_sources: If set, only run these scrapers
            exclude_sources: If set, exclude these scrapers
            max_concurrency: Maximum number of scrapers to run in parallel
            incremental: If True, only fetch new data since last successful run
            resume: If True, resume from last incomplete run
            show_progress: If True, show progress bar
        """
        self.months_back = months_back
        self.dry_run = dry_run
        self.only_sources = only_sources
        self.exclude_sources = exclude_sources or []
        self.max_concurrency = max_concurrency
        self.incremental = incremental
        self.resume = resume
        self.show_progress = show_progress

        self.start_date = datetime.now(timezone.utc) - timedelta(days=months_back * 30)
        self.end_date = datetime.now(timezone.utc)

        self._client: Optional[Client] = None
        self._seen_hashes: set[str] = set()
        self._results: list[ScraperResult] = []
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._progress: Optional[ProgressReporter] = None
        self._completed_scrapers: set[str] = set()
        self._lock = asyncio.Lock()

        self.stats = OrchestratorStats(
            run_id=self._generate_run_id(),
            start_time=datetime.now(timezone.utc),
        )

        # Load resume state if requested
        if self.resume:
            self._load_resume_state()

    def _generate_run_id(self) -> str:
        """Generate a unique run ID."""
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        return f"interview_scrape_{timestamp}"

    @property
    def client(self) -> Client:
        """Get or create Supabase client."""
        if self._client is None:
            if not SUPABASE_SERVICE_KEY:
                raise ValueError("SUPABASE_SERVICE_KEY not set")
            self._client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        return self._client

    def _load_resume_state(self) -> None:
        """Load state from previous incomplete run."""
        if not self.STATE_FILE.exists():
            logger.info("No previous state to resume from")
            return

        try:
            with open(self.STATE_FILE) as f:
                state = json.load(f)

            self._completed_scrapers = set(state.get('completed_scrapers', []))
            self.stats.run_id = state.get('run_id', self.stats.run_id)

            logger.info(f"Resuming run {self.stats.run_id}, {len(self._completed_scrapers)} scrapers already complete")
        except Exception as e:
            logger.warning(f"Could not load resume state: {e}")

    def _save_resume_state(self) -> None:
        """Save state for potential resume."""
        try:
            state = {
                'run_id': self.stats.run_id,
                'completed_scrapers': list(self._completed_scrapers),
                'timestamp': datetime.now(timezone.utc).isoformat(),
            }
            with open(self.STATE_FILE, 'w') as f:
                json.dump(state, f)
        except Exception as e:
            logger.warning(f"Could not save resume state: {e}")

    def _clear_resume_state(self) -> None:
        """Clear resume state after successful completion."""
        try:
            if self.STATE_FILE.exists():
                self.STATE_FILE.unlink()
        except Exception as e:
            logger.warning(f"Could not clear resume state: {e}")

    def _get_scrapers_to_run(self) -> list[ScraperConfig]:
        """Get list of scrapers to run based on configuration."""
        scrapers = []

        for scraper in self.SCRAPERS:
            if not scraper.enabled:
                continue
            if self.only_sources and scraper.name not in self.only_sources:
                continue
            if scraper.name in self.exclude_sources:
                continue
            # Skip already completed scrapers if resuming
            if scraper.name in self._completed_scrapers:
                logger.info(f"Skipping {scraper.name} (already completed in this run)")
                continue
            scrapers.append(scraper)

        # Sort by priority (lower = higher priority)
        scrapers.sort(key=lambda s: s.priority)

        return scrapers

    def _get_incremental_start_date(self, scraper: ScraperConfig) -> datetime:
        """Get start date for incremental scraping based on last successful run."""
        if not self.incremental:
            return self.start_date

        try:
            result = self.client.table('interview_sources').select(
                'last_scraped'
            ).eq('source_name', scraper.name).eq('last_status', 'success').single().execute()

            if result.data and result.data.get('last_scraped'):
                last_scraped = datetime.fromisoformat(
                    result.data['last_scraped'].replace('Z', '+00:00')
                )
                # Go back 1 day before last scrape to catch any edge cases
                return last_scraped - timedelta(days=1)

        except Exception as e:
            logger.debug(f"Could not get incremental date for {scraper.name}: {e}")

        return self.start_date

    def _should_run_scraper(self, scraper: ScraperConfig) -> bool:
        """Check if scraper should run based on schedule and last run time."""
        if self.dry_run or self.only_sources:
            return True

        try:
            result = self.client.table('interview_sources').select(
                'last_scraped'
            ).eq('source_name', scraper.name).single().execute()

            if not result.data:
                return True  # Never run before

            last_scraped = datetime.fromisoformat(
                result.data['last_scraped'].replace('Z', '+00:00')
            )
            now = datetime.now(timezone.utc)

            if scraper.schedule == 'hourly':
                return (now - last_scraped) >= timedelta(hours=1)
            elif scraper.schedule == 'daily':
                return (now - last_scraped) >= timedelta(hours=23)
            elif scraper.schedule == 'weekly':
                return (now - last_scraped) >= timedelta(days=6)

            return True

        except Exception as e:
            logger.warning(f"Could not check last run for {scraper.name}: {e}")
            return True

    def _update_scraper_timestamp(self, scraper: ScraperConfig, success: bool) -> None:
        """Update the last_scraped timestamp for a scraper."""
        if self.dry_run:
            return

        try:
            now = datetime.now(timezone.utc).isoformat()
            data = {
                'source_name': scraper.name,
                'source_platform': scraper.source,
                'last_scraped': now,
                'last_status': 'success' if success else 'failed',
                'updated_at': now,
            }

            self.client.table('interview_sources').upsert(
                data, on_conflict='source_name'
            ).execute()

        except Exception as e:
            logger.error(f"Failed to update timestamp for {scraper.name}: {e}")

    @staticmethod
    def _normalize_question(question) -> dict:
        """Adapt scraper models and dictionaries to the persistence contract."""
        if not isinstance(question, dict):
            from dataclasses import is_dataclass
            if callable(getattr(question, 'to_dict', None)):
                question = question.to_dict()
            elif is_dataclass(question):
                question = asdict(question)
            else:
                raise TypeError(f'Unsupported question record: {type(question).__name__}')
        if not isinstance(question, dict):
            raise TypeError('Question serialization must return a dictionary')
        q = dict(question)
        text = q.get('question_text')
        if not isinstance(text, str) or not text.strip():
            raise ValueError('Question text must be a non-empty string')
        q['question_text'] = text.strip()
        q['company_name'] = q.get('company_name') or q.get('company') or 'Unknown'
        # Derive a company_slug so the app's per-company lookups (interview-prep
        # badge) match — otherwise questions land with a null slug.
        if not q.get('company_slug'):
            import re as _re
            q['company_slug'] = _re.sub(r'[^a-z0-9]+', '-', q['company_name'].lower()).strip('-')
        q['source_name'] = q.get('source_name') or q.get('source') or 'unknown'
        q['source'] = q['source_name']
        q['company_normalized'] = q.get('company_normalized') or q['company_name']
        q['role_normalized'] = q.get('role_normalized') or q.get('position') or q.get('role') or ''
        q['tags'] = q.get('tags') or q.get('topics') or []
        # Map a source's real post/ask date into interview_date (a DATE column)
        # so time filters ("last month" vs "last year") reflect WHEN a question
        # was actually asked. Telegram/forum scrapers expose this as
        # posted_date/date/posted; without this it stays null and every time
        # window returns the same rows.
        if not q.get('interview_date'):
            import re as _re_date
            for _k in ('posted_date', 'date', 'posted', 'created_date'):
                _v = q.get(_k)
                if isinstance(_v, str):
                    _m = _re_date.match(r'(\d{4}-\d{2}-\d{2})', _v)
                    if _m:
                        q['interview_date'] = _m.group(1)
                        break
        for key in ('question_type', 'difficulty'):
            value = q.get(key)
            if isinstance(value, Enum):
                q[key] = value.value
        return q

    def _generate_question_hash(self, question: dict) -> str:
        """Generate a unique hash for deduplication."""
        key_parts = [
            question.get('company_normalized', '').lower(),
            question.get('role_normalized', '').lower(),
            question.get('question_text', '')[:100].lower(),
            question.get('source', ''),
        ]
        key = '|'.join(str(p) for p in key_parts)
        return hashlib.sha256(key.encode()).hexdigest()[:32]

    async def _deduplicate_questions(
        self, questions: list[dict]
    ) -> tuple[list[dict], int]:
        """Remove duplicate questions (thread-safe).

        Returns:
            Tuple of (unique_questions, duplicates_removed)
        """
        unique = []
        duplicates = 0

        async with self._lock:
            for question in questions:
                q = self._normalize_question(question)
                q_hash = self._generate_question_hash(q)
                if q_hash not in self._seen_hashes:
                    self._seen_hashes.add(q_hash)
                    q['id'] = q_hash  # Use hash as ID
                    unique.append(q)
                else:
                    duplicates += 1

        return unique, duplicates

    def _load_existing_hashes(self) -> None:
        """Load existing question hashes from database for deduplication."""
        if self.dry_run:
            return

        try:
            # Fetch existing question IDs (which are hashes)
            result = self.client.table('interview_questions').select(
                'id'
            ).execute()

            self._seen_hashes = {row['id'] for row in result.data}
            logger.info(f"Loaded {len(self._seen_hashes)} existing question hashes")

        except Exception as e:
            logger.warning(f"Could not load existing hashes: {e}")
            self._seen_hashes = set()

    async def _run_python_scraper(
        self, scraper: ScraperConfig, start_date: datetime
    ) -> tuple[list[dict], list[str]]:
        """Run a Python scraper in a process that can be killed on timeout."""
        questions = []
        errors = []

        candidate_kwargs = {
            'start_date': start_date,
            'end_date': self.end_date,
            'months_back': getattr(self, 'months_back', None),
        }
        encoded_kwargs = {
            key: (
                {'__scraper_type__': 'datetime', 'value': value.isoformat()}
                if isinstance(value, datetime) else value
            )
            for key, value in candidate_kwargs.items()
            if value is not None
        }

        for attempt in range(scraper.max_retries):
            output_path = None
            process = None
            try:
                with tempfile.NamedTemporaryFile(
                    prefix=f'{scraper.name}-', suffix='.json', delete=False
                ) as output_file:
                    output_path = Path(output_file.name)

                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    str(Path(__file__).with_name('scraper_worker.py')),
                    '--module', scraper.module_path,
                    '--function', scraper.function_name,
                    '--kwargs', json.dumps(encoded_kwargs),
                    '--output', str(output_path),
                    cwd=Path(__file__).parent,
                )
                await asyncio.wait_for(process.wait(), timeout=scraper.timeout)

                payload = json.loads(output_path.read_text(encoding='utf-8'))
                if process.returncode != 0 or not payload.get('ok'):
                    detail = payload.get('error', f'exit code {process.returncode}')
                    trace = payload.get('traceback')
                    if trace:
                        logger.error('%s child traceback:\n%s', scraper.name, trace)
                    raise RuntimeError(detail)

                scraper_result = payload.get('result')
                if isinstance(scraper_result, list):
                    questions = scraper_result
                elif isinstance(scraper_result, dict):
                    questions = scraper_result.get('questions', [])
                    errors = scraper_result.get('errors', [])

                questions = _explode_questions(
                    [_question_to_dict(question) for question in questions]
                )
                break

            except asyncio.CancelledError:
                if process and process.returncode is None:
                    process.kill()
                    await process.wait()
                raise
            except asyncio.TimeoutError:
                if process and process.returncode is None:
                    process.kill()
                    await process.wait()
                message = f'Scraper timed out after {scraper.timeout}s'
                if attempt < scraper.max_retries - 1:
                    logger.warning(
                        '%s; retrying (%d/%d)',
                        message, attempt + 1, scraper.max_retries,
                    )
                    await asyncio.sleep(2 ** attempt)
                else:
                    errors.append(message)
            except Exception as error:
                if attempt < scraper.max_retries - 1:
                    logger.warning(
                        '%s failed: %s; retrying (%d/%d)',
                        scraper.name, error, attempt + 1, scraper.max_retries,
                    )
                    await asyncio.sleep(2 ** attempt)
                else:
                    errors.append(
                        f'Scraper error after {scraper.max_retries} attempt(s): {error}'
                    )
            finally:
                if output_path:
                    output_path.unlink(missing_ok=True)

        return questions, errors

    async def _run_typescript_scraper(
        self, scraper: ScraperConfig, start_date: datetime
    ) -> tuple[list[dict], list[str]]:
        """Run a TypeScript scraper via tsx."""
        questions = []
        errors = []

        try:
            # Build the command to run TypeScript
            cmd = [
                'npx', 'tsx',
                scraper.module_path,
                '--start-date', start_date.isoformat(),
                '--end-date', self.end_date.isoformat(),
                '--output', 'json',
            ]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=Path(__file__).parent,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=scraper.timeout,
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.communicate()
                raise

            if process.returncode != 0:
                errors.append(f"TypeScript scraper failed: {stderr.decode()}")
            else:
                output = stdout.decode()
                result = json.loads(output)
                questions = _explode_questions(
                    [_question_to_dict(q) for q in result.get('questions', [])]
                )
                errors.extend(result.get('errors', []))

        except asyncio.TimeoutError:
            errors.append(f"TypeScript scraper timed out after {scraper.timeout}s")
        except json.JSONDecodeError as e:
            errors.append(f"Invalid JSON output: {e}")
        except Exception as e:
            errors.append(f"TypeScript scraper error: {str(e)}")

        return questions, errors

    async def _run_scraper(self, scraper: ScraperConfig) -> ScraperResult:
        """Run a single scraper with semaphore-controlled concurrency."""
        result = ScraperResult(
            name=scraper.name,
            status=ScraperStatus.RUNNING,
            questions_found=0,
            questions_new=0,
            questions_updated=0,
            errors=[],
            start_time=datetime.now(timezone.utc),
        )

        # Acquire semaphore to limit concurrency
        async with self._semaphore:
            if self._progress:
                await self._progress.update(scraper.name, 'running')

            logger.info(f"Starting scraper: {scraper.name}")

            try:
                # Check if should run
                if not self._should_run_scraper(scraper):
                    result.status = ScraperStatus.SKIPPED
                    result.errors.append("Skipped due to schedule")
                    logger.info(f"Skipping {scraper.name} (already ran recently)")
                    return result

                # Get incremental start date
                start_date = self._get_incremental_start_date(scraper)
                if start_date != self.start_date:
                    logger.info(f"{scraper.name}: Using incremental start date {start_date.date()}")

                # Run the appropriate scraper type
                if scraper.scraper_type == 'python':
                    questions, errors = await self._run_python_scraper(scraper, start_date)
                else:
                    questions, errors = await self._run_typescript_scraper(scraper, start_date)

                result.errors.extend(errors)
                result.questions_found = len(questions)

                if errors and not questions:
                    raise RuntimeError('; '.join(errors))

                # Deduplicate (thread-safe)
                unique_questions, duplicates = await self._deduplicate_questions(questions)
                accepted_questions = []
                rejected_reasons: dict[str, int] = {}
                for question in unique_questions:
                    # Jev arbitrates only borderline "weak keep" rows; obvious
                    # cases stay on the free heuristic. Falls back to heuristic
                    # when Jev is unavailable.
                    decision = classify_question_smart(
                        question.get('question_text', ''),
                        question.get('question_type'),
                    )
                    if decision.is_junk:
                        reason = decision.reason or 'unspecified'
                        rejected_reasons[reason] = rejected_reasons.get(reason, 0) + 1
                    else:
                        accepted_questions.append(question)
                rejected = len(unique_questions) - len(accepted_questions)
                unique_questions = accepted_questions
                logger.info(
                    f"{scraper.name}: Found {len(questions)}, "
                    f"unique {len(unique_questions)}, "
                    f"duplicates {duplicates}, quality-rejected {rejected} "
                    f"({rejected_reasons})"
                )

                # Save to database
                if unique_questions and not self.dry_run:
                    new_count, updated_count = await self._save_questions(unique_questions)
                    result.questions_new = new_count
                    result.questions_updated = updated_count
                else:
                    result.questions_new = len(unique_questions)

                result.status = ScraperStatus.COMPLETED
                self._update_scraper_timestamp(scraper, success=True)

                # Mark as completed for resume capability
                async with self._lock:
                    self._completed_scrapers.add(scraper.name)
                    self._save_resume_state()

            except Exception as e:
                result.status = ScraperStatus.FAILED
                result.errors.append(str(e))
                logger.exception(f"Scraper {scraper.name} failed")
                self._update_scraper_timestamp(scraper, success=False)

            result.end_time = datetime.now(timezone.utc)
            result.duration_seconds = (
                result.end_time - result.start_time
            ).total_seconds()

            # Update progress
            if self._progress:
                await self._progress.update(scraper.name, result.status.value, result)

            return result

    async def _save_questions(
        self, questions: list[dict]
    ) -> tuple[int, int]:
        """Save questions to database using optimized batch operations.

        Uses db_optimizer.InterviewQuestionDB for:
        - Connection pooling
        - Efficient batch inserts
        - Content-hash based deduplication
        - Pre-computed search vectors

        Returns:
            Tuple of (new_count, updated_count)
        """
        if not questions:
            return 0, 0

        try:
            # Use the optimized database module
            db = get_interview_db()

            # Configure batch operations
            config = BatchConfig(
                batch_size=100,
                max_retries=3,
                retry_delay=1.0,
                parallel_batches=3,
            )

            # Batch insert with automatic deduplication
            async with self._lock:
                result = await asyncio.to_thread(
                    db.batch_insert,
                    questions,
                    dedupe=True,
                    config=config,
                )

            if result.errors:
                for error in result.errors[:5]:  # Log first 5 errors
                    logger.warning(f"Insert error: {error}")

            logger.info(
                f"Saved {result.inserted} new, {result.updated} updated questions "
                f"({result.skipped} skipped) in {result.duration_ms:.0f}ms"
            )

            return result.inserted, result.updated

        except Exception as e:
            logger.exception(f"Failed to save questions: {e}")
            raise

    async def run(self) -> OrchestratorStats:
        """Run all scrapers in parallel and return statistics."""
        logger.info(f"Starting orchestrator run: {self.stats.run_id}")
        logger.info(f"Date range: {self.start_date.date()} to {self.end_date.date()}")
        logger.info(f"Max concurrency: {self.max_concurrency}, Incremental: {self.incremental}")

        # Load existing hashes for deduplication
        self._load_existing_hashes()

        # Get scrapers to run
        scrapers = self._get_scrapers_to_run()
        self.stats.scrapers_total = len(scrapers)

        logger.info(f"Running {len(scrapers)} scrapers")

        # Initialize semaphore for concurrency control
        self._semaphore = asyncio.Semaphore(self.max_concurrency)

        # Initialize progress reporter
        if self.show_progress:
            self._progress = ProgressReporter(len(scrapers))

        # Group scrapers by priority for ordered parallel execution
        priority_groups: dict[int, list[ScraperConfig]] = {}
        for scraper in scrapers:
            if scraper.priority not in priority_groups:
                priority_groups[scraper.priority] = []
            priority_groups[scraper.priority].append(scraper)

        # Run each priority group, with scrapers within a group running in parallel
        for priority in sorted(priority_groups.keys()):
            group = priority_groups[priority]
            logger.info(f"Running priority {priority} scrapers: {[s.name for s in group]}")

            # Create tasks for all scrapers in this priority group
            tasks = [self._run_scraper(scraper) for scraper in group]

            # Run them in parallel (limited by semaphore)
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process results
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    # Handle unexpected exceptions
                    error_result = ScraperResult(
                        name=group[i].name,
                        status=ScraperStatus.FAILED,
                        questions_found=0,
                        questions_new=0,
                        questions_updated=0,
                        errors=[str(result)],
                        start_time=datetime.now(timezone.utc),
                        end_time=datetime.now(timezone.utc),
                    )
                    self._results.append(error_result)
                    self.stats.scrapers_failed += 1
                    self.stats.errors.append(str(result))
                else:
                    self._results.append(result)

                    # Update stats
                    if result.status == ScraperStatus.COMPLETED:
                        self.stats.scrapers_completed += 1
                        self.stats.questions_found_total += result.questions_found
                        self.stats.questions_new_total += result.questions_new
                        self.stats.questions_updated_total += result.questions_updated
                    elif result.status == ScraperStatus.FAILED:
                        self.stats.scrapers_failed += 1
                        self.stats.errors.extend(result.errors)
                    elif result.status == ScraperStatus.SKIPPED:
                        self.stats.scrapers_skipped += 1

                    logger.info(
                        f"Completed {result.name}: {result.status.value}, "
                        f"found={result.questions_found}, new={result.questions_new}, "
                        f"duration={result.duration_seconds:.1f}s"
                    )

        self.stats.end_time = datetime.now(timezone.utc)

        # Clear resume state on successful completion
        if self.stats.scrapers_failed == 0:
            self._clear_resume_state()

        # Log summary
        duration = (self.stats.end_time - self.stats.start_time).total_seconds()
        logger.info(
            f"Orchestrator complete: "
            f"{self.stats.scrapers_completed}/{self.stats.scrapers_total} succeeded, "
            f"{self.stats.scrapers_failed} failed, "
            f"{self.stats.scrapers_skipped} skipped, "
            f"total questions: {self.stats.questions_new_total} new, "
            f"duration: {duration:.1f}s"
        )

        return self.stats

    def get_results(self) -> list[ScraperResult]:
        """Get results from all scrapers."""
        return self._results


async def run_all_scrapers(
    months_back: int = 5,
    dry_run: bool = False,
    only_sources: Optional[list[str]] = None,
    exclude_sources: Optional[list[str]] = None,
    max_concurrency: int = 5,
    incremental: bool = False,
    resume: bool = False,
    show_progress: bool = True,
) -> OrchestratorStats:
    """Run all interview question scrapers.

    Args:
        months_back: Number of months of historical data to fetch
        dry_run: If True, don't write to database
        only_sources: If set, only run these scrapers
        exclude_sources: If set, exclude these scrapers
        max_concurrency: Maximum number of scrapers to run in parallel
        incremental: If True, only fetch new data since last successful run
        resume: If True, resume from last incomplete run
        show_progress: If True, show progress bar

    Returns:
        OrchestratorStats with run statistics
    """
    orchestrator = InterviewQuestionOrchestrator(
        months_back=months_back,
        dry_run=dry_run,
        only_sources=only_sources,
        exclude_sources=exclude_sources,
        max_concurrency=max_concurrency,
        incremental=incremental,
        resume=resume,
        show_progress=show_progress,
    )

    try:
        return await orchestrator.run()
    finally:
        # Clean up database connection pool
        close_interview_db()


def run_daily():
    """Entry point for daily scheduled runs."""
    return asyncio.run(run_all_scrapers(months_back=1, incremental=True))


def run_weekly():
    """Entry point for weekly scheduled runs with full history."""
    return asyncio.run(run_all_scrapers(months_back=5))


def run_single(source_name: str, months_back: int = 5, dry_run: bool = False):
    """Run a single scraper."""
    return asyncio.run(run_all_scrapers(
        months_back=months_back,
        dry_run=dry_run,
        only_sources=[source_name],
    ))


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Interview Question Scraper Orchestrator')
    parser.add_argument(
        '--months', '-m',
        type=int,
        default=5,
        help='Number of months of historical data to fetch'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run without saving to database'
    )
    parser.add_argument(
        '--only',
        nargs='+',
        help='Only run these scrapers'
    )
    parser.add_argument(
        '--exclude',
        nargs='+',
        help='Exclude these scrapers'
    )
    parser.add_argument(
        '--list',
        action='store_true',
        help='List available scrapers'
    )
    parser.add_argument(
        '--concurrency', '-c',
        type=int,
        default=5,
        help='Maximum number of scrapers to run in parallel (default: 5)'
    )
    parser.add_argument(
        '--incremental', '-i',
        action='store_true',
        help='Only fetch new data since last successful run'
    )
    parser.add_argument(
        '--resume', '-r',
        action='store_true',
        help='Resume from last incomplete run'
    )
    parser.add_argument(
        '--no-progress',
        action='store_true',
        help='Disable progress bar'
    )

    args = parser.parse_args()

    if args.list:
        print("\nAvailable scrapers:")
        print("-" * 60)
        for s in InterviewQuestionOrchestrator.SCRAPERS:
            status = "enabled" if s.enabled else "disabled"
            print(f"  {s.name:20} | {s.source:15} | P{s.priority} | {s.schedule:8} | {status}")
        print("-" * 60)
        sys.exit(0)

    stats = asyncio.run(run_all_scrapers(
        months_back=args.months,
        dry_run=args.dry_run,
        only_sources=args.only,
        exclude_sources=args.exclude,
        max_concurrency=args.concurrency,
        incremental=args.incremental,
        resume=args.resume,
        show_progress=not args.no_progress,
    ))

    print(f"\n{'='*60}")
    print(f"Run ID: {stats.run_id}")
    print(f"Duration: {(stats.end_time - stats.start_time).total_seconds():.1f}s")
    print(f"Scrapers: {stats.scrapers_completed}/{stats.scrapers_total} succeeded")
    print(f"Questions: {stats.questions_new_total} new, {stats.questions_updated_total} updated")
    if stats.errors:
        print(f"Errors: {len(stats.errors)}")
        for err in stats.errors[:5]:
            print(f"  - {err[:100]}")
    print(f"{'='*60}\n")
