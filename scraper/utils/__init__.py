"""Utility modules for the job scraper."""

from .rss_parser import (
    parse_rss_feed,
    parse_rss_item,
    RSSItem,
    RSSFeed,
)

try:
    from .rate_limiter import (
        AdaptiveRateLimiter,
        DomainThrottler,
        CircuitBreaker,
        CircuitBreakerRegistry,
        CircuitState,
        RequestPool,
        Priority,
        PrioritizedRequest,
        RequestMetrics,
        create_scraper_pool,
        get_throttler,
        get_circuit_registry,
        throttled_fetch,
    )
except ImportError:
    pass  # rate_limiter may not be present

from .proxy_manager import (
    ProxyRotator,
    ProxyPool,
    ProxyHealthChecker,
    GeoProxySelector,
    ProxyConfig,
    ProxyType,
    ProxyProvider,
    GeoRegion,
    RequestsWithProxy,
    get_rotator,
    get_proxy_for_url,
    load_free_proxies,
)

from .cache import (
    ResponseCache,
    ContentHashCache,
    IncrementalScraper,
    CacheWarmer,
    CacheBackend,
    FileBackend,
    SQLiteBackend,
    CachedResponse,
    ScraperState,
    get_cache,
    get_hash_cache,
    cached_request,
)

from .session_manager import (
    SessionManager,
    SessionStore,
    CookieManager,
    AuthRefresher,
    MultiAccountPool,
    Account,
    SessionHealth,
    GenericAuthRefresher,
    OnePointThreeAcresAuth,
    GlassdoorAuth,
    BlindAuth,
    create_session_manager,
    get_authenticated_session,
)

from .deduplication import (
    InterviewQuestion,
    TextNormalizer,
    FuzzyMatcher,
    SemanticDeduplicator,
    CrossLanguageDedup,
    SourcePrioritizer,
    InterviewDeduplicator,
    deduplicate_questions,
    quick_dedup,
    SOURCE_PRIORITY,
)

__all__ = [
    # RSS
    "parse_rss_feed",
    "parse_rss_item",
    "RSSItem",
    "RSSFeed",
    # Rate limiting
    "AdaptiveRateLimiter",
    "DomainThrottler",
    "CircuitBreaker",
    "CircuitBreakerRegistry",
    "CircuitState",
    "RequestPool",
    "Priority",
    "PrioritizedRequest",
    "RequestMetrics",
    "create_scraper_pool",
    "get_throttler",
    "get_circuit_registry",
    "throttled_fetch",
    # Proxy management
    "ProxyRotator",
    "ProxyPool",
    "ProxyHealthChecker",
    "GeoProxySelector",
    "ProxyConfig",
    "ProxyType",
    "ProxyProvider",
    "GeoRegion",
    "RequestsWithProxy",
    "get_rotator",
    "get_proxy_for_url",
    "load_free_proxies",
    # Cache
    "ResponseCache",
    "ContentHashCache",
    "IncrementalScraper",
    "CacheWarmer",
    "CacheBackend",
    "FileBackend",
    "SQLiteBackend",
    "CachedResponse",
    "ScraperState",
    "get_cache",
    "get_hash_cache",
    "cached_request",
    # Session management
    "SessionManager",
    "SessionStore",
    "CookieManager",
    "AuthRefresher",
    "MultiAccountPool",
    "Account",
    "SessionHealth",
    "GenericAuthRefresher",
    "OnePointThreeAcresAuth",
    "GlassdoorAuth",
    "BlindAuth",
    "create_session_manager",
    "get_authenticated_session",
    # Deduplication
    "InterviewQuestion",
    "TextNormalizer",
    "FuzzyMatcher",
    "SemanticDeduplicator",
    "CrossLanguageDedup",
    "SourcePrioritizer",
    "InterviewDeduplicator",
    "deduplicate_questions",
    "quick_dedup",
    "SOURCE_PRIORITY",
]

# Anti-detection utilities
from .anti_detection import (
    UserAgentRotator,
    HeaderRandomizer,
    TimingJitter,
    FingerprintManager,
    BrowserFingerprint,
    Proxy as StealthProxy,
    ProxyRotator as StealthProxyRotator,
    CloudflareBypass,
    HeadlessDetectionBypass,
    AdaptiveRateLimiter as StealthRateLimiter,
    StealthSession,
    create_stealth_session,
    get_stealth_headers,
    random_delay,
)

__all__.extend([
    # Anti-detection
    "UserAgentRotator",
    "HeaderRandomizer",
    "TimingJitter",
    "FingerprintManager",
    "BrowserFingerprint",
    "StealthProxy",
    "StealthProxyRotator",
    "CloudflareBypass",
    "HeadlessDetectionBypass",
    "StealthRateLimiter",
    "StealthSession",
    "create_stealth_session",
    "get_stealth_headers",
    "random_delay",
])

# Reliability scoring
from .reliability import (
    SourceTier,
    SOURCE_TIERS,
    ReliabilityScore,
    SourceScorer,
    RecencyWeight,
    CrossSourceVerifier,
    AuthorCredibilityChecker,
    EngagementAnalyzer,
    DetailAnalyzer,
    ReliabilityEngine,
    score_question,
)

__all__.extend([
    # Reliability
    "SourceTier",
    "SOURCE_TIERS",
    "ReliabilityScore",
    "SourceScorer",
    "RecencyWeight",
    "CrossSourceVerifier",
    "AuthorCredibilityChecker",
    "EngagementAnalyzer",
    "DetailAnalyzer",
    "ReliabilityEngine",
    "score_question",
])

# Date parsing
from .date_parser import (
    UniversalDateParser,
    RelativeDateResolver,
    InterviewDateExtractor,
    ParsedDate,
    DateRange,
    DateFormat,
    parse_date,
    extract_interview_date,
    is_within_months,
)

__all__.extend([
    # Date parsing
    "UniversalDateParser",
    "RelativeDateResolver",
    "InterviewDateExtractor",
    "ParsedDate",
    "DateRange",
    "DateFormat",
    "parse_date",
    "extract_interview_date",
    "is_within_months",
])

# Error handling and recovery
from .error_handler import (
    ErrorType,
    ErrorRecord,
    ErrorClassifier,
    RetryConfig,
    RetryManager,
    Checkpoint,
    CheckpointManager,
    DeadLetterItem,
    DeadLetterQueue,
    GracefulDegrader,
    CircuitOpenError,
    ScraperErrorHandler,
    with_retry,
)

__all__.extend([
    # Error handling
    "ErrorType",
    "ErrorRecord",
    "ErrorClassifier",
    "RetryConfig",
    "RetryManager",
    "Checkpoint",
    "CheckpointManager",
    "DeadLetterItem",
    "DeadLetterQueue",
    "GracefulDegrader",
    "CircuitOpenError",
    "ScraperErrorHandler",
    "with_retry",
])

# Text parsing and content extraction
from .text_parser import (
    QuestionType,
    Difficulty,
    ExtractedContent,
    ExtractedQuestion,
    CodeBlock,
    QAPair,
    ContentExtractor,
    QAPatternDetector,
    InterviewQuestionClassifier,
    CodeBlockExtractor,
    extract_interview_questions,
    extract_all_content,
    # Robust company detection
    CompanyMatch,
    COMPANY_DATABASE,
    CompanyAliasResolver,
    SubsidiaryMapper,
    InternationalCompanyNER,
    FuzzyCompanyMatcher,
    detect_company_robust,
    detect_all_companies_robust,
    detect_company_from_domain,
    detect_company_from_ticker,
    alias_resolver,
    subsidiary_mapper,
    intl_ner,
    fuzzy_matcher,
)

__all__.extend([
    # Text parsing
    "QuestionType",
    "Difficulty",
    "ExtractedContent",
    "ExtractedQuestion",
    "CodeBlock",
    "QAPair",
    "ContentExtractor",
    "QAPatternDetector",
    "InterviewQuestionClassifier",
    "CodeBlockExtractor",
    "extract_interview_questions",
    "extract_all_content",
    # Robust company detection
    "CompanyMatch",
    "COMPANY_DATABASE",
    "CompanyAliasResolver",
    "SubsidiaryMapper",
    "InternationalCompanyNER",
    "FuzzyCompanyMatcher",
    "detect_company_robust",
    "detect_all_companies_robust",
    "detect_company_from_domain",
    "detect_company_from_ticker",
    "alias_resolver",
    "subsidiary_mapper",
    "intl_ner",
    "fuzzy_matcher",
])

# Monitoring
from .monitoring import (
    MetricsCollector,
    SourceHealthDashboard,
    CostTracker,
    AnomalyDetector,
    MonitoringSystem,
    ScraperMetrics,
    SourceHealth,
    Alert,
    AlertSeverity,
    CostEntry,
    MetricType,
    ScraperMonitoringContext,
    get_monitoring,
    monitor_scraper,
)

__all__.extend([
    # Monitoring
    "MetricsCollector",
    "SourceHealthDashboard",
    "CostTracker",
    "AnomalyDetector",
    "MonitoringSystem",
    "ScraperMetrics",
    "SourceHealth",
    "Alert",
    "AlertSeverity",
    "CostEntry",
    "MetricType",
    "ScraperMonitoringContext",
    "get_monitoring",
    "monitor_scraper",
])

# Real-time monitoring for ephemeral sources
from .realtime import (
    MonitoredContent,
    SourceConfig,
    ContentArchiver,
    InstantArchiver,
    ChangeDetector,
    RSSPoller,
    WebhookListener,
    WebSocketMonitor,
    PastebinMonitor,
    RedditStreamMonitor,
    RealtimeOrchestrator,
    start_realtime_monitoring,
)

__all__.extend([
    # Real-time monitoring
    "MonitoredContent",
    "SourceConfig",
    "ContentArchiver",
    "InstantArchiver",
    "ChangeDetector",
    "RSSPoller",
    "WebhookListener",
    "WebSocketMonitor",
    "PastebinMonitor",
    "RedditStreamMonitor",
    "RealtimeOrchestrator",
    "start_realtime_monitoring",
])

# Data validation pipeline
from .validation import (
    ValidationErrorType,
    ValidationError,
    ValidationResult,
    EncodingFixer,
    ContentValidator,
    CompanyValidator,
    DateValidator,
    SpamDetector,
    DuplicateDetector,
    QualityScorer,
    ValidationPipeline,
    validate_question,
    validate_questions,
)

__all__.extend([
    # Validation
    "ValidationErrorType",
    "ValidationError",
    "ValidationResult",
    "EncodingFixer",
    "ContentValidator",
    "CompanyValidator",
    "DateValidator",
    "SpamDetector",
    "DuplicateDetector",
    "QualityScorer",
    "ValidationPipeline",
    "validate_question",
    "validate_questions",
])

# Queue system for multi-scraper coordination
try:
    from .queue import (
        ScrapeQueue,
        WorkerPool,
        URLDeduplicator,
        Scheduler,
        ResultAggregator,
        ScraperSystem,
        ScrapeTask,
        Priority,
        Schedule,
        TaskState,
        StorageBackend,
        FileStorageBackend,
        RedisStorageBackend,
        RateLimiter,
        get_storage_backend,
    )

    __all__.extend([
        # Queue system
        "ScrapeQueue",
        "WorkerPool",
        "URLDeduplicator",
        "Scheduler",
        "ResultAggregator",
        "ScraperSystem",
        "ScrapeTask",
        "Priority",
        "Schedule",
        "TaskState",
        "StorageBackend",
        "FileStorageBackend",
        "RedisStorageBackend",
        "RateLimiter",
        "get_storage_backend",
    ])
except ImportError:
    pass  # queue module has no external dependencies, but wrap for safety
