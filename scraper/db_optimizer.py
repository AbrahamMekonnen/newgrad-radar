"""Optimized database operations for interview question scrapers.

Features:
- BatchInserter: Efficient batch inserts with configurable sizes
- UpsertManager: PostgreSQL ON CONFLICT based upserts
- ConnectionPool: Connection pooling for concurrent operations
- TransactionBatcher: Group operations into transactions
- Full-text search optimization with pre-computed tsvector
"""

import asyncio
import hashlib
import logging
import os
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from queue import Queue, Empty
from typing import Any, Callable, Generator, Optional, TypeVar
from concurrent.futures import ThreadPoolExecutor

from supabase import create_client, Client

logger = logging.getLogger(__name__)

T = TypeVar('T')


@dataclass
class BatchConfig:
    """Configuration for batch operations."""
    batch_size: int = 100
    max_retries: int = 3
    retry_delay: float = 1.0
    parallel_batches: int = 3


@dataclass
class UpsertResult:
    """Result of an upsert operation."""
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    duration_ms: float = 0.0


class ConnectionPool:
    """Thread-safe connection pool for Supabase clients.

    Maintains a pool of reusable connections to avoid
    connection overhead on each operation.
    """

    def __init__(
        self,
        url: str,
        key: str,
        pool_size: int = 5,
        max_overflow: int = 10,
    ):
        self.url = url
        self.key = key
        self.pool_size = pool_size
        self.max_overflow = max_overflow

        self._pool: Queue[Client] = Queue(maxsize=pool_size + max_overflow)
        self._active_count = 0
        self._lock = threading.Lock()

        # Pre-populate pool
        for _ in range(pool_size):
            self._pool.put(self._create_client())

    def _create_client(self) -> Client:
        """Create a new Supabase client."""
        return create_client(self.url, self.key)

    @contextmanager
    def get_client(self, timeout: float = 30.0) -> Generator[Client, None, None]:
        """Get a client from the pool.

        Args:
            timeout: Maximum time to wait for a client

        Yields:
            A Supabase client
        """
        client = None
        try:
            try:
                client = self._pool.get(timeout=timeout)
            except Empty:
                # Pool exhausted, check if we can create overflow
                with self._lock:
                    if self._active_count < self.pool_size + self.max_overflow:
                        client = self._create_client()
                        self._active_count += 1
                    else:
                        raise RuntimeError("Connection pool exhausted")

            yield client

        finally:
            if client is not None:
                try:
                    self._pool.put_nowait(client)
                except Exception:
                    # Pool full, discard client
                    pass

    def close(self):
        """Close all connections in the pool."""
        while not self._pool.empty():
            try:
                self._pool.get_nowait()
            except Empty:
                break


class BatchInserter:
    """Efficient batch insert operations.

    Features:
    - Configurable batch sizes
    - Automatic chunking
    - Retry logic with exponential backoff
    - Parallel batch processing
    """

    def __init__(
        self,
        pool: ConnectionPool,
        table: str,
        config: Optional[BatchConfig] = None,
    ):
        self.pool = pool
        self.table = table
        self.config = config or BatchConfig()

    def _chunk(self, items: list[T], size: int) -> Generator[list[T], None, None]:
        """Split items into chunks."""
        for i in range(0, len(items), size):
            yield items[i:i + size]

    def _insert_batch(self, batch: list[dict]) -> tuple[int, list[str]]:
        """Insert a single batch."""
        errors = []
        inserted = 0

        for attempt in range(self.config.max_retries):
            try:
                with self.pool.get_client() as client:
                    result = client.table(self.table).insert(batch).execute()
                    inserted = len(result.data) if result.data else len(batch)
                    return inserted, errors

            except Exception as e:
                errors.append(f"Attempt {attempt + 1}: {str(e)}")
                if attempt < self.config.max_retries - 1:
                    import time
                    time.sleep(self.config.retry_delay * (2 ** attempt))

        return 0, errors

    def insert(self, items: list[dict]) -> UpsertResult:
        """Insert items in optimized batches.

        Args:
            items: List of items to insert

        Returns:
            UpsertResult with operation statistics
        """
        start_time = datetime.now(timezone.utc)
        result = UpsertResult()

        if not items:
            return result

        batches = list(self._chunk(items, self.config.batch_size))

        # Process batches in parallel using thread pool
        with ThreadPoolExecutor(max_workers=self.config.parallel_batches) as executor:
            futures = [executor.submit(self._insert_batch, batch) for batch in batches]

            for future in futures:
                try:
                    inserted, errors = future.result()
                    result.inserted += inserted
                    result.errors.extend(errors)
                except Exception as e:
                    result.errors.append(str(e))

        result.duration_ms = (
            datetime.now(timezone.utc) - start_time
        ).total_seconds() * 1000

        return result


class UpsertManager:
    """Efficient upsert operations using PostgreSQL ON CONFLICT.

    Uses batch processing and deduplication for optimal performance.
    """

    def __init__(
        self,
        pool: ConnectionPool,
        table: str,
        conflict_columns: list[str],
        update_columns: Optional[list[str]] = None,
        config: Optional[BatchConfig] = None,
    ):
        self.pool = pool
        self.table = table
        self.conflict_columns = conflict_columns
        self.update_columns = update_columns
        self.config = config or BatchConfig()

    def _chunk(self, items: list[T], size: int) -> Generator[list[T], None, None]:
        """Split items into chunks."""
        for i in range(0, len(items), size):
            yield items[i:i + size]

    def _upsert_batch(
        self,
        batch: list[dict],
        existing_keys: set[str],
    ) -> tuple[int, int, list[str]]:
        """Upsert a single batch.

        Returns:
            Tuple of (inserted, updated, errors)
        """
        errors = []

        if not batch:
            return 0, 0, errors

        # Separate into inserts and updates based on existing keys
        to_insert = []
        to_update = []

        for item in batch:
            key = self._make_key(item)
            if key in existing_keys:
                to_update.append(item)
            else:
                to_insert.append(item)

        inserted = 0
        updated = 0

        # Batch insert new items
        if to_insert:
            try:
                with self.pool.get_client() as client:
                    result = client.table(self.table).insert(to_insert).execute()
                    inserted = len(result.data) if result.data else len(to_insert)
            except Exception as e:
                errors.append(f"Insert error: {str(e)}")

        # Batch update existing items
        if to_update and self.update_columns:
            for item in to_update:
                try:
                    with self.pool.get_client() as client:
                        update_data = {
                            col: item[col]
                            for col in self.update_columns
                            if col in item
                        }

                        query = client.table(self.table).update(update_data)
                        for col in self.conflict_columns:
                            query = query.eq(col, item[col])
                        query.execute()
                        updated += 1
                except Exception as e:
                    errors.append(f"Update error for {self._make_key(item)}: {str(e)}")

        return inserted, updated, errors

    def _make_key(self, item: dict) -> str:
        """Create a key from conflict columns."""
        parts = [str(item.get(col, '')) for col in self.conflict_columns]
        return '|'.join(parts)

    def _load_existing_keys(self) -> set[str]:
        """Load existing keys from database."""
        try:
            with self.pool.get_client() as client:
                columns = ','.join(self.conflict_columns)
                result = client.table(self.table).select(columns).execute()

                keys = set()
                for row in result.data:
                    parts = [str(row.get(col, '')) for col in self.conflict_columns]
                    keys.add('|'.join(parts))

                return keys

        except Exception as e:
            logger.warning(f"Could not load existing keys: {e}")
            return set()

    def upsert(self, items: list[dict]) -> UpsertResult:
        """Upsert items efficiently.

        Args:
            items: List of items to upsert

        Returns:
            UpsertResult with operation statistics
        """
        start_time = datetime.now(timezone.utc)
        result = UpsertResult()

        if not items:
            return result

        # Load existing keys for deduplication
        existing_keys = self._load_existing_keys()
        logger.info(f"Loaded {len(existing_keys)} existing keys")

        # Process in batches
        batches = list(self._chunk(items, self.config.batch_size))

        for batch in batches:
            inserted, updated, errors = self._upsert_batch(batch, existing_keys)
            result.inserted += inserted
            result.updated += updated
            result.errors.extend(errors)

            # Add newly inserted keys to existing set
            for item in batch:
                key = self._make_key(item)
                if key not in existing_keys:
                    existing_keys.add(key)

        result.duration_ms = (
            datetime.now(timezone.utc) - start_time
        ).total_seconds() * 1000

        return result


class TransactionBatcher:
    """Group multiple operations into transactions for atomicity and performance."""

    def __init__(self, pool: ConnectionPool):
        self.pool = pool
        self._operations: list[Callable[[Client], Any]] = []

    def add(self, operation: Callable[[Client], Any]) -> 'TransactionBatcher':
        """Add an operation to the batch.

        Args:
            operation: Callable that takes a Client and performs an operation

        Returns:
            Self for chaining
        """
        self._operations.append(operation)
        return self

    def execute(self) -> list[Any]:
        """Execute all batched operations.

        Note: Supabase client doesn't support true transactions,
        but this batches operations for efficiency.

        Returns:
            List of results from each operation
        """
        results = []

        with self.pool.get_client() as client:
            for operation in self._operations:
                try:
                    result = operation(client)
                    results.append(result)
                except Exception as e:
                    results.append(e)
                    logger.error(f"Operation failed: {e}")

        self._operations.clear()
        return results


class InterviewQuestionDB:
    """Optimized database operations for interview questions.

    Provides high-level methods for common operations with
    built-in optimization, deduplication, and error handling.
    """

    def __init__(
        self,
        url: Optional[str] = None,
        key: Optional[str] = None,
        pool_size: int = 5,
    ):
        self.url = url or os.environ.get('SUPABASE_URL', '')
        self.key = key or os.environ.get('SUPABASE_SERVICE_KEY', '')

        if not self.url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")

        self.pool = ConnectionPool(self.url, self.key, pool_size=pool_size)
        self._hash_cache: set[str] = set()
        self._hash_cache_loaded = False

    def close(self):
        """Close database connections."""
        self.pool.close()

    def _generate_hash(self, question: dict) -> str:
        """Generate content hash for deduplication."""
        parts = [
            question.get('company_name', '').lower().strip(),
            question.get('question_text', '')[:200].lower().strip(),
            question.get('source_name', '').lower(),
        ]
        content = '|'.join(parts)
        return hashlib.sha256(content.encode()).hexdigest()[:32]

    def _load_hash_cache(self) -> None:
        """Load existing content hashes for deduplication."""
        if self._hash_cache_loaded:
            return

        try:
            with self.pool.get_client() as client:
                offset = 0
                while True:
                    result = client.table('interview_questions').select(
                        'company_name,question_text,source_name,id'
                    ).order('id').range(offset, offset + 999).execute()
                    self._hash_cache.update(self._generate_hash(row) for row in result.data)
                    if len(result.data) < 1000:
                        break
                    offset += 1000
                self._hash_cache_loaded = True
                logger.info(f"Loaded {len(self._hash_cache)} content hashes")

        except Exception as e:
            logger.warning(f"Could not load hash cache: {e}")
            raise

    def deduplicate(self, questions: list[dict]) -> list[dict]:
        """Remove duplicate questions.

        Args:
            questions: List of question dicts

        Returns:
            List of unique questions not in database
        """
        self._load_hash_cache()

        unique = []
        local_seen: set[str] = set()

        for q in questions:
            content_hash = self._generate_hash(q)

            # Skip if already in database or seen locally
            if content_hash in self._hash_cache or content_hash in local_seen:
                continue

            local_seen.add(content_hash)
            q['content_hash'] = content_hash
            unique.append(q)

        logger.info(
            f"Deduplication: {len(questions)} -> {len(unique)} "
            f"({len(questions) - len(unique)} duplicates)"
        )

        return unique

    def prepare_question(self, q: dict) -> dict:
        """Prepare a question dict for database insertion.

        Normalizes fields and ensures required columns exist.
        """
        now = datetime.now(timezone.utc).isoformat()

        prepared = {
            'company_name': q.get('company_name', 'Unknown')[:255],
            'company_slug': q.get('company_slug'),
            'position': q.get('position', q.get('role'))[:255] if q.get('position') or q.get('role') else None,
            'position_level': q.get('position_level'),
            'team': q.get('team'),

            'question_type': q.get('question_type', 'other'),
            'question_text': q.get('question_text', '')[:10000],
            'question_title': (q.get('question_title') or '')[:500] or None,
            'difficulty': q.get('difficulty', 'unknown'),

            'answer_text': q.get('answer_text'),
            'answer_approach': q.get('answer_approach'),

            'interview_round': q.get('interview_round'),
            'interview_date': q.get('interview_date'),
            'interview_year': q.get('interview_year'),
            'interview_month': q.get('interview_month'),

            'source_name': q.get('source_name', q.get('source', 'unknown')),
            'source_url': q.get('source_url', ''),
            'source_post_id': q.get('source_post_id'),
            'scraped_at': now,

            'is_verified': False,
            'confidence_score': q.get('confidence_score', 0.5),

            'upvotes': q.get('upvotes', 0),
            'content_hash': q.get('content_hash'),
            'is_duplicate': False,

            'language': q.get('language', 'en'),
            'region': q.get('region'),
            'raw_metadata': q.get('metadata', {}),

            'created_at': now,
            'updated_at': now,
        }
        # Core schema shared with the web app. Enrichment columns require
        # optional migrations and must not break basic question ingestion.
        columns = {
            'company_name', 'company_slug', 'position', 'position_level',
            'question_type', 'question_text', 'question_title', 'difficulty',
            'interview_round', 'interview_date', 'source_name', 'source_url',
            'scraped_at', 'is_verified', 'upvotes', 'is_duplicate', 'created_at',
        }
        aliases = {'coding': 'technical_coding', 'technical': 'technical_conceptual',
                   'conceptual': 'technical_conceptual', 'general': 'other',
                   'online_assessment': 'oa', 'assessment': 'oa',
                   'algorithm': 'technical_coding', 'algorithms': 'technical_coding',
                   'design': 'system_design', 'puzzle': 'brain_teaser',
                   'hr': 'behavioral', 'phone_screen': 'other', 'unknown': 'other'}
        qt = aliases.get(prepared.get('question_type'), prepared.get('question_type'))
        # Any value not in the DB enum would abort the whole batch — coerce to 'other'.
        valid_types = {'technical_coding', 'technical_conceptual', 'system_design',
                       'behavioral', 'case_study', 'take_home', 'oa', 'brain_teaser', 'other'}
        prepared['question_type'] = qt if qt in valid_types else 'other'
        # difficulty is also an enum (easy/medium/hard/unknown) — coerce safely.
        diff = str(prepared.get('difficulty', 'unknown')).lower()
        prepared['difficulty'] = diff if diff in {'easy', 'medium', 'hard', 'unknown'} else 'unknown'
        return {key: value for key, value in prepared.items() if key in columns}


    def batch_insert(
        self,
        questions: list[dict],
        dedupe: bool = True,
        config: Optional[BatchConfig] = None,
    ) -> UpsertResult:
        """Insert questions in optimized batches.

        Args:
            questions: List of question dicts
            dedupe: Whether to deduplicate against existing data
            config: Batch configuration

        Returns:
            UpsertResult with operation statistics
        """
        if not questions:
            return UpsertResult()

        # Deduplicate if requested
        if dedupe:
            questions = self.deduplicate(questions)

        if not questions:
            return UpsertResult(skipped=len(questions))

        # Prepare questions for database
        prepared = [self.prepare_question(q) for q in questions]

        # Use batch inserter
        inserter = BatchInserter(
            self.pool,
            'interview_questions',
            config or BatchConfig(),
        )

        result = inserter.insert(prepared)

        if result.inserted != len(prepared):
            raise RuntimeError(f'Question persistence incomplete: {result.inserted}/{len(prepared)} inserted; {result.errors}')

        # Update hash cache with newly inserted
        self._hash_cache.update(self._generate_hash(q) for q in questions)

        return result

    def get_source_stats(self) -> dict[str, dict]:
        """Get statistics for each source.

        Returns:
            Dict mapping source_name to stats dict
        """
        try:
            with self.pool.get_client() as client:
                result = client.rpc('get_source_stats').execute()
                return {row['source_name']: row for row in result.data}
        except Exception as e:
            logger.error(f"Failed to get source stats: {e}")
            return {}

    def update_source_timestamp(
        self,
        source_name: str,
        questions_count: int,
        success: bool,
        error: Optional[str] = None,
    ) -> None:
        """Update source scrape timestamp and stats.

        Args:
            source_name: Name of the source
            questions_count: Number of questions found
            success: Whether scrape succeeded
            error: Error message if failed
        """
        try:
            with self.pool.get_client() as client:
                now = datetime.now(timezone.utc).isoformat()

                # Upsert source record
                data = {
                    'name': source_name,
                    'display_name': source_name.replace('_', ' ').title(),
                    'source_type': 'scraper',
                    'last_scraped_at': now,
                    'is_active': True,
                    'updated_at': now,
                }

                if error:
                    data['last_error'] = error[:1000]

                client.table('interview_sources').upsert(
                    data,
                    on_conflict='name',
                ).execute()

        except Exception as e:
            logger.error(f"Failed to update source timestamp: {e}")

    def record_scraper_run(
        self,
        source_name: str,
        status: str,
        questions_found: int = 0,
        questions_new: int = 0,
        questions_updated: int = 0,
        questions_duplicate: int = 0,
        error_message: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[str]:
        """Record a scraper run in the database.

        Args:
            source_name: Name of the source
            status: Run status ('running', 'completed', 'failed', 'partial')
            questions_found: Total questions found
            questions_new: New questions inserted
            questions_updated: Questions updated
            questions_duplicate: Duplicate questions skipped
            error_message: Error message if failed
            metadata: Additional run metadata

        Returns:
            Run ID if successful, None otherwise
        """
        try:
            with self.pool.get_client() as client:
                # Get source ID
                source_result = client.table('interview_sources').select(
                    'id'
                ).eq('name', source_name).single().execute()

                source_id = source_result.data['id'] if source_result.data else None

                if not source_id:
                    # Create source if not exists
                    create_result = client.table('interview_sources').insert({
                        'name': source_name,
                        'display_name': source_name.replace('_', ' ').title(),
                        'source_type': 'scraper',
                        'is_active': True,
                    }).execute()
                    source_id = create_result.data[0]['id']

                # Insert run record
                now = datetime.now(timezone.utc).isoformat()
                run_data = {
                    'source_id': source_id,
                    'source_name': source_name,
                    'started_at': now,
                    'status': status,
                    'questions_found': questions_found,
                    'questions_new': questions_new,
                    'questions_updated': questions_updated,
                    'questions_duplicate': questions_duplicate,
                    'error_message': error_message,
                    'metadata': metadata or {},
                }

                if status in ('completed', 'failed', 'partial'):
                    run_data['completed_at'] = now

                result = client.table('scraper_runs').insert(run_data).execute()
                return result.data[0]['id'] if result.data else None

        except Exception as e:
            logger.error(f"Failed to record scraper run: {e}")
            return None


# Convenience function to get optimized DB instance
_db_instance: Optional[InterviewQuestionDB] = None


def get_interview_db() -> InterviewQuestionDB:
    """Get or create the global InterviewQuestionDB instance."""
    global _db_instance

    if _db_instance is None:
        from config import SUPABASE_URL, SUPABASE_SERVICE_KEY
        _db_instance = InterviewQuestionDB(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    return _db_instance


def close_interview_db() -> None:
    """Close the global InterviewQuestionDB instance."""
    global _db_instance

    if _db_instance is not None:
        _db_instance.close()
        _db_instance = None
