"""
Glassdoor User Submission System

Since scraping Glassdoor is legally risky (ToS violation, anti-bot measures),
this module provides tools for users to submit Glassdoor interview links
and extract metadata from URLs.

Enhanced with:
- ValidationPipeline for content quality checks
- CompanyValidator for robust company name normalization (208 aliases)
- DuplicateDetector for submission deduplication
- StealthSession for anti-detection (CRITICAL for Glassdoor)
- SessionManager for authenticated requests
- ResponseCache for caching
- Monitoring integration

Exports:
- GlassdoorSubmission: TypedDict for user submissions
- GlassdoorInterviewURL: Parsed URL data
- parse_glassdoor_url(): Extract company/metadata from Glassdoor URLs
- validate_glassdoor_url(): Check if URL is valid Glassdoor interview URL
- create_submission(): Helper to create a validated submission
"""

import re
import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, TypedDict, Literal, Tuple, List, Any
from urllib.parse import urlparse, parse_qs, unquote

logger = logging.getLogger(__name__)

# Import unified scraper infrastructure
try:
    from ...utils.scraper_infra import (
        InfrastructureContext,
        validate_batch,
        get_stealth_headers,
        cached_request,
        wait_for_rate_limit,
    )
    UNIFIED_INFRA = True
except ImportError:
    UNIFIED_INFRA = False

# Import legacy infrastructure modules (graceful fallback if not available)
INFRA_AVAILABLE = False

try:
    from scraper.utils.anti_detection import StealthSession, create_stealth_session
    from scraper.utils.session_manager import SessionManager, MultiAccountPool, get_authenticated_session
    from scraper.utils.cache import ResponseCache, get_cache
    from scraper.utils.rate_limiter import AdaptiveRateLimiter
    from scraper.utils.monitoring import monitor_scraper
    INFRA_AVAILABLE = True
except ImportError:
    try:
        # Try relative import
        import sys
        import os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'utils'))
        from anti_detection import StealthSession, create_stealth_session
        from session_manager import SessionManager, MultiAccountPool, get_authenticated_session
        from cache import ResponseCache, get_cache
        from rate_limiter import AdaptiveRateLimiter
        from monitoring import monitor_scraper
        INFRA_AVAILABLE = True
    except ImportError:
        if not UNIFIED_INFRA:
            logger.warning("[glassdoor_submission] Infrastructure modules not available, using basic mode")
        StealthSession = None
        create_stealth_session = None

# Treat unified infra as full infra
if UNIFIED_INFRA and not INFRA_AVAILABLE:
    INFRA_AVAILABLE = True

# Ensure fallback variables are defined
if not INFRA_AVAILABLE:
    SessionManager = None
    get_authenticated_session = None
    ResponseCache = None
    get_cache = None
    monitor_scraper = None

# Checkpoint manager
_checkpoint = None
try:
    from scraper.utils.error_handler import CheckpointManager
except ImportError:
    CheckpointManager = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE and CheckpointManager:
        try:
            _checkpoint = CheckpointManager("glassdoor_submission")
        except Exception:
            pass
    return _checkpoint

# Import validation modules
try:
    from scraper.utils.validation import (
        ValidationPipeline,
        CompanyValidator,
        DuplicateDetector,
        ContentValidator,
        SpamDetector,
        QualityScorer,
    )
    HAS_VALIDATION = True
except ImportError:
    HAS_VALIDATION = False
    ValidationPipeline = None
    CompanyValidator = None
    DuplicateDetector = None

# Infrastructure singletons (lazy initialization)
_stealth_session: Optional['StealthSession'] = None
_session_manager: Optional['SessionManager'] = None
_response_cache: Optional['ResponseCache'] = None


def _init_infrastructure():
    """Initialize infrastructure components lazily."""
    global _stealth_session, _session_manager, _response_cache

    if not INFRA_AVAILABLE:
        return

    if _stealth_session is None:
        try:
            _stealth_session = create_stealth_session(
                min_delay=2.0,  # Glassdoor is very aggressive with anti-bot
                max_delay=6.0,
                requests_per_minute=8  # Very conservative for Glassdoor
            )
            logger.info("[glassdoor_submission] StealthSession initialized")
        except Exception as e:
            logger.warning(f"[glassdoor_submission] Could not initialize StealthSession: {e}")

    if _session_manager is None:
        try:
            _session_manager = SessionManager('glassdoor')
            logger.info("[glassdoor_submission] SessionManager initialized")
        except Exception as e:
            logger.warning(f"[glassdoor_submission] Could not initialize SessionManager: {e}")

    if _response_cache is None:
        try:
            _response_cache = get_cache()
            logger.info("[glassdoor_submission] ResponseCache initialized")
        except Exception as e:
            logger.warning(f"[glassdoor_submission] Could not initialize ResponseCache: {e}")


def get_stealth_session() -> Optional['StealthSession']:
    """Get the stealth session for Glassdoor requests (CRITICAL - Glassdoor blocks scrapers)."""
    _init_infrastructure()
    return _stealth_session


def get_glassdoor_session_manager() -> Optional['SessionManager']:
    """Get the session manager for authenticated Glassdoor requests."""
    _init_infrastructure()
    return _session_manager


# Valid Glassdoor domains
GLASSDOOR_DOMAINS = [
    'glassdoor.com',
    'www.glassdoor.com',
    'glassdoor.co.uk',
    'www.glassdoor.co.uk',
    'glassdoor.ca',
    'www.glassdoor.ca',
    'glassdoor.com.au',
    'www.glassdoor.com.au',
    'glassdoor.de',
    'www.glassdoor.de',
    'glassdoor.fr',
    'www.glassdoor.fr',
    'glassdoor.in',
    'www.glassdoor.in',
    'glassdoor.sg',
    'www.glassdoor.sg',
]

# URL patterns for different Glassdoor pages
URL_PATTERNS = {
    # /Interview/Google-Interview-Questions-E9079.htm
    'interview_questions': re.compile(
        r'/Interview/([A-Za-z0-9\-]+)-Interview-Questions-E(\d+)(?:_P\d+)?\.htm',
        re.IGNORECASE
    ),
    # /Interview/Google-Software-Engineer-Interview-Questions-EI_IE9079.0,5_KO6,23.htm
    'interview_questions_role': re.compile(
        r'/Interview/([A-Za-z0-9\-]+)-([A-Za-z0-9\-]+)-Interview-Questions-EI_IE(\d+)',
        re.IGNORECASE
    ),
    # /Reviews/Google-Reviews-E9079.htm
    'reviews': re.compile(
        r'/Reviews/([A-Za-z0-9\-]+)-Reviews-E(\d+)',
        re.IGNORECASE
    ),
    # /Overview/Working-at-Google-EI_IE9079.htm
    'overview': re.compile(
        r'/Overview/Working-at-([A-Za-z0-9\-]+)-EI_IE(\d+)',
        re.IGNORECASE
    ),
    # /Salary/Google-Salaries-E9079.htm
    'salary': re.compile(
        r'/Salary/([A-Za-z0-9\-]+)-Salaries-E(\d+)',
        re.IGNORECASE
    ),
}

# Known company ID to name mappings for common companies
COMPANY_ID_MAP = {
    '9079': 'Google',
    '10788': 'Microsoft',
    '40772': 'Meta',
    '6036': 'Apple',
    '1651': 'Amazon',
    '21753': 'Netflix',
    '7550': 'Goldman Sachs',
    '40261': 'Stripe',
    '661571': 'Airbnb',
    '700480': 'Uber',
    '26039': 'JPMorgan Chase',
    '1737': 'Intel',
    '1815': 'IBM',
    '7753': 'Morgan Stanley',
    '3096': 'Salesforce',
    '456': 'Oracle',
    '9286': 'Adobe',
    '28138': 'LinkedIn',
    '20805': 'Twitter',
    '460665': 'Lyft',
    '8876': 'Nvidia',
    '1138': 'Cisco',
    '30758': 'Tesla',
    '13315': 'Palantir',
    '6134': 'Bloomberg',
    '40585': 'Two Sigma',
    '43888': 'Jane Street',
    '18627': 'Citadel',
    '433396': 'Databricks',
    '879453': 'Snowflake',
    '675161': 'DoorDash',
    '1068094': 'Coinbase',
    '5868': 'Accenture',
    '2800': 'Deloitte',
    '2784': 'McKinsey',
    '402': 'BCG',
    '4058': 'Bain',
    '1448': 'KPMG',
    '573': 'PwC',
    '2783': 'EY',
}


class GlassdoorInterviewURL(TypedDict):
    """Parsed data from a Glassdoor interview URL."""
    url: str
    is_valid: bool
    domain: str
    company_slug: str
    company_name: Optional[str]
    company_id: Optional[str]
    role: Optional[str]
    page_type: Literal['interview_questions', 'interview_questions_role', 'reviews', 'overview', 'salary', 'unknown']
    error: Optional[str]


class GlassdoorSubmission(TypedDict):
    """User-submitted Glassdoor interview data."""
    id: str
    glassdoor_url: str
    company_name: str
    company_id: Optional[str]
    role: Optional[str]
    question_text: str
    question_type: Literal['technical', 'behavioral', 'system_design', 'oa', 'general']
    difficulty: Optional[Literal['easy', 'medium', 'hard']]
    interview_date: Optional[str]
    outcome: Optional[Literal['offer', 'rejected', 'no_response', 'withdrew']]
    submitted_by: Optional[str]
    submitted_at: str
    verified: bool
    upvotes: int
    tags: list[str]


def _normalize_company_name(slug: str) -> str:
    """Convert URL slug to readable company name."""
    name = slug.replace('-', ' ')
    words = name.split()
    capitalized = []
    for word in words:
        if word.lower() in ['and', 'or', 'the', 'of', 'in', 'at', 'for']:
            capitalized.append(word.lower())
        elif word.upper() in ['IBM', 'HP', 'AWS', 'GE', 'AI', 'ML', 'IT', 'UK', 'US', 'EU']:
            capitalized.append(word.upper())
        else:
            capitalized.append(word.capitalize())
    return ' '.join(capitalized)


def _normalize_role(role_slug: str) -> str:
    """Convert role slug to readable format."""
    role = role_slug.replace('-', ' ')
    return role.title()


def validate_glassdoor_url(url: str) -> tuple[bool, Optional[str]]:
    """
    Validate if a URL is a legitimate Glassdoor URL.

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not url:
        return False, "URL is empty"

    url = url.strip()

    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    try:
        parsed = urlparse(url)
    except Exception as e:
        return False, f"Invalid URL format: {e}"

    domain = parsed.netloc.lower()

    is_glassdoor = any(
        domain == gd or domain.endswith('.' + gd.replace('www.', ''))
        for gd in GLASSDOOR_DOMAINS
    )

    if not is_glassdoor:
        return False, f"Not a Glassdoor domain: {domain}"

    path = parsed.path
    if not path or path == '/':
        return False, "URL has no path - please provide a specific page URL"

    has_pattern = any(
        pattern.search(path)
        for pattern in URL_PATTERNS.values()
    )

    if not has_pattern:
        if '/Interview/' not in path and '/Reviews/' not in path:
            return False, "URL doesn't appear to be an interview or reviews page"

    return True, None


def parse_glassdoor_url(url: str) -> GlassdoorInterviewURL:
    """
    Parse a Glassdoor URL to extract company and metadata.

    Args:
        url: Glassdoor URL string

    Returns:
        GlassdoorInterviewURL with parsed data
    """
    url = url.strip()
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    is_valid, error = validate_glassdoor_url(url)

    if not is_valid:
        return GlassdoorInterviewURL(
            url=url,
            is_valid=False,
            domain='',
            company_slug='',
            company_name=None,
            company_id=None,
            role=None,
            page_type='unknown',
            error=error
        )

    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        path = unquote(parsed.path)

        page_type: Literal['interview_questions', 'interview_questions_role', 'reviews', 'overview', 'salary', 'unknown'] = 'unknown'
        company_slug = ''
        company_name = None
        company_id = None
        role = None

        for ptype, pattern in URL_PATTERNS.items():
            match = pattern.search(path)
            if match:
                page_type = ptype  # type: ignore
                groups = match.groups()

                if ptype == 'interview_questions':
                    company_slug = groups[0]
                    company_id = groups[1]
                elif ptype == 'interview_questions_role':
                    company_slug = groups[0]
                    role = _normalize_role(groups[1])
                    company_id = groups[2]
                elif ptype in ('reviews', 'salary'):
                    company_slug = groups[0]
                    company_id = groups[1]
                elif ptype == 'overview':
                    company_slug = groups[0]
                    company_id = groups[1]

                break

        if company_id and company_id in COMPANY_ID_MAP:
            company_name = COMPANY_ID_MAP[company_id]
        elif company_slug:
            company_name = _normalize_company_name(company_slug)

        return GlassdoorInterviewURL(
            url=url,
            is_valid=True,
            domain=domain,
            company_slug=company_slug,
            company_name=company_name,
            company_id=company_id,
            role=role,
            page_type=page_type,
            error=None
        )

    except Exception as e:
        return GlassdoorInterviewURL(
            url=url,
            is_valid=False,
            domain='',
            company_slug='',
            company_name=None,
            company_id=None,
            role=None,
            page_type='unknown',
            error=str(e)
        )


def create_submission(
    glassdoor_url: str,
    question_text: str,
    question_type: Literal['technical', 'behavioral', 'system_design', 'oa', 'general'] = 'general',
    company_name: Optional[str] = None,
    role: Optional[str] = None,
    difficulty: Optional[Literal['easy', 'medium', 'hard']] = None,
    interview_date: Optional[str] = None,
    outcome: Optional[Literal['offer', 'rejected', 'no_response', 'withdrew']] = None,
    submitted_by: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> tuple[Optional[GlassdoorSubmission], Optional[str]]:
    """
    Create a validated Glassdoor submission.

    Returns:
        Tuple of (submission, error_message)
    """
    parsed_url = parse_glassdoor_url(glassdoor_url)

    if not parsed_url['is_valid']:
        return None, parsed_url['error']

    if not question_text or len(question_text.strip()) < 10:
        return None, "Question text is too short (minimum 10 characters)"

    question_text = question_text.strip()

    final_company = company_name or parsed_url['company_name'] or 'Unknown'
    final_role = role or parsed_url['role']

    submission_id = hashlib.sha256(
        f"{final_company}:{question_text}".encode()
    ).hexdigest()[:16]

    submission = GlassdoorSubmission(
        id=submission_id,
        glassdoor_url=glassdoor_url,
        company_name=final_company,
        company_id=parsed_url['company_id'],
        role=final_role,
        question_text=question_text,
        question_type=question_type,
        difficulty=difficulty,
        interview_date=interview_date,
        outcome=outcome,
        submitted_by=submitted_by,
        submitted_at=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        verified=False,
        upvotes=0,
        tags=tags or []
    )

    return submission, None


def get_glassdoor_interview_url(company_name: str, company_id: Optional[str] = None) -> str:
    """
    Generate a Glassdoor interview questions URL for a company.

    Args:
        company_name: Company name (will be slugified)
        company_id: Optional Glassdoor company ID

    Returns:
        Glassdoor interview questions URL
    """
    slug = company_name.replace(' ', '-').replace('&', 'and')
    slug = re.sub(r'[^A-Za-z0-9\-]', '', slug)

    if company_id:
        return f"https://www.glassdoor.com/Interview/{slug}-Interview-Questions-E{company_id}.htm"
    else:
        return f"https://www.glassdoor.com/Interview/{slug}-Interview-Questions.htm"


# Global validators (lazy initialization)
_company_validator: Optional['CompanyValidator'] = None
_duplicate_detector: Optional['DuplicateDetector'] = None
_content_validator: Optional['ContentValidator'] = None
_spam_detector: Optional['SpamDetector'] = None
_quality_scorer: Optional['QualityScorer'] = None


def _get_company_validator() -> Optional['CompanyValidator']:
    """Get or create company validator instance."""
    global _company_validator
    if _company_validator is None and HAS_VALIDATION:
        _company_validator = CompanyValidator()
    return _company_validator


def _get_duplicate_detector() -> Optional['DuplicateDetector']:
    """Get or create duplicate detector instance."""
    global _duplicate_detector
    if _duplicate_detector is None and HAS_VALIDATION:
        _duplicate_detector = DuplicateDetector()
    return _duplicate_detector


def _get_content_validator() -> Optional['ContentValidator']:
    """Get or create content validator instance."""
    global _content_validator
    if _content_validator is None and HAS_VALIDATION:
        _content_validator = ContentValidator()
    return _content_validator


def _get_spam_detector() -> Optional['SpamDetector']:
    """Get or create spam detector instance."""
    global _spam_detector
    if _spam_detector is None and HAS_VALIDATION:
        _spam_detector = SpamDetector()
    return _spam_detector


def _get_quality_scorer() -> Optional['QualityScorer']:
    """Get or create quality scorer instance."""
    global _quality_scorer
    if _quality_scorer is None and HAS_VALIDATION:
        _quality_scorer = QualityScorer()
    return _quality_scorer


def normalize_company_name(name: str) -> Tuple[str, float]:
    """
    Normalize company name using CompanyValidator if available.

    Returns:
        Tuple of (normalized_name, confidence)
    """
    if not name:
        return name, 0.0

    # Try CompanyValidator first (208+ aliases, fuzzy matching, international names)
    validator = _get_company_validator()
    if validator:
        result = validator.validate(name)
        if result.normalized_name:
            return result.normalized_name, result.confidence

    # No validator available, return as-is
    return name, 0.5


def check_duplicate_question(question_text: str, company: str) -> Tuple[bool, Optional[str]]:
    """
    Check if this question is a duplicate.

    Returns:
        Tuple of (is_duplicate, existing_id if duplicate)
    """
    detector = _get_duplicate_detector()
    if not detector:
        return False, None

    # Create a composite key for duplicate check
    key = f"{company}:{question_text}"

    if detector.is_duplicate(key):
        return True, None

    # Register this question
    detector.register(key, hashlib.sha256(key.encode()).hexdigest()[:16])
    return False, None


def validate_question_content(question_text: str) -> Tuple[bool, List[str], float]:
    """
    Validate question content quality.

    Returns:
        Tuple of (is_valid, errors, quality_score)
    """
    errors = []
    quality_score = 0.5

    if not question_text or len(question_text.strip()) < 10:
        return False, ["Question text is too short (minimum 10 characters)"], 0.0

    # Content validation
    content_validator = _get_content_validator()
    if content_validator:
        result = content_validator.validate(question_text)
        if not result.is_valid:
            errors.append(result.error_message or "Invalid content")

    # Spam detection
    spam_detector = _get_spam_detector()
    if spam_detector and spam_detector.is_spam(question_text):
        errors.append("Content appears to be spam or promotional")

    # Quality scoring
    quality_scorer = _get_quality_scorer()
    if quality_scorer:
        quality_score = quality_scorer.score({'question': question_text})

    return len(errors) == 0, errors, quality_score


def create_submission_validated(
    glassdoor_url: str,
    question_text: str,
    question_type: Literal['technical', 'behavioral', 'system_design', 'oa', 'general'] = 'general',
    company_name: Optional[str] = None,
    role: Optional[str] = None,
    difficulty: Optional[Literal['easy', 'medium', 'hard']] = None,
    interview_date: Optional[str] = None,
    outcome: Optional[Literal['offer', 'rejected', 'no_response', 'withdrew']] = None,
    submitted_by: Optional[str] = None,
    tags: Optional[list[str]] = None,
    check_duplicates: bool = True,
    validate_content: bool = True,
) -> Tuple[Optional[GlassdoorSubmission], List[str], float]:
    """
    Create a validated Glassdoor submission with enhanced validation.

    Returns:
        Tuple of (submission, errors, quality_score)
    """
    errors = []
    quality_score = 0.0

    parsed_url = parse_glassdoor_url(glassdoor_url)

    if not parsed_url['is_valid']:
        return None, [parsed_url['error'] or "Invalid URL"], 0.0

    # Validate and score content
    if validate_content:
        is_valid, content_errors, quality_score = validate_question_content(question_text)
        errors.extend(content_errors)
        if not is_valid and quality_score < 0.3:
            return None, errors, quality_score

    question_text = question_text.strip()

    # Normalize company name using CompanyValidator
    extracted_company = parsed_url['company_name'] or 'Unknown'
    if company_name:
        final_company, confidence = normalize_company_name(company_name)
    else:
        final_company, confidence = normalize_company_name(extracted_company)

    final_role = role or parsed_url['role']

    # Check for duplicates
    if check_duplicates:
        is_dup, _ = check_duplicate_question(question_text, final_company)
        if is_dup:
            errors.append("This question appears to be a duplicate")

    submission_id = hashlib.sha256(
        f"{final_company}:{question_text}".encode()
    ).hexdigest()[:16]

    submission = GlassdoorSubmission(
        id=submission_id,
        glassdoor_url=glassdoor_url,
        company_name=final_company,
        company_id=parsed_url['company_id'],
        role=final_role,
        question_text=question_text,
        question_type=question_type,
        difficulty=difficulty,
        interview_date=interview_date,
        outcome=outcome,
        submitted_by=submitted_by,
        submitted_at=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        verified=False,
        upvotes=0,
        tags=tags or []
    )

    return submission, errors, quality_score


__all__ = [
    'GlassdoorSubmission',
    'GlassdoorInterviewURL',
    'parse_glassdoor_url',
    'validate_glassdoor_url',
    'create_submission',
    'create_submission_validated',
    'get_glassdoor_interview_url',
    'normalize_company_name',
    'check_duplicate_question',
    'validate_question_content',
    'COMPANY_ID_MAP',
    'HAS_VALIDATION',
    'INFRA_AVAILABLE',
    'get_stealth_session',
    'get_glassdoor_session_manager',
]


if __name__ == '__main__':
    test_urls = [
        'https://www.glassdoor.com/Interview/Google-Interview-Questions-E9079.htm',
        'https://www.glassdoor.com/Interview/Google-Software-Engineer-Interview-Questions-EI_IE9079.0,5_KO6,23.htm',
        'https://www.glassdoor.com/Reviews/Meta-Reviews-E40772.htm',
        'https://glassdoor.com/Interview/Stripe-Interview-Questions-E40261_P2.htm',
        'https://www.glassdoor.com/Overview/Working-at-Apple-EI_IE6036.htm',
        'https://www.glassdoor.co.uk/Interview/Amazon-Interview-Questions-E1651.htm',
        'https://example.com/not-glassdoor',
        'not a url',
        '',
    ]

    print("Testing URL parsing:\n")
    for url in test_urls:
        result = parse_glassdoor_url(url)
        print(f"URL: {url[:60]}...")
        print(f"  Valid: {result['is_valid']}")
        if result['is_valid']:
            print(f"  Company: {result['company_name']} (ID: {result['company_id']})")
            print(f"  Type: {result['page_type']}")
            if result['role']:
                print(f"  Role: {result['role']}")
        else:
            print(f"  Error: {result['error']}")
        print()

    print("\nTesting submission creation:\n")
    submission, error = create_submission(
        glassdoor_url='https://www.glassdoor.com/Interview/Google-Interview-Questions-E9079.htm',
        question_text='Design a system that can handle 1 million requests per second',
        question_type='system_design',
        difficulty='hard',
        interview_date='2026-08-15',
        tags=['system-design', 'scalability']
    )

    if submission:
        print("Created submission:")
        for key, value in submission.items():
            print(f"  {key}: {value}")
    else:
        print(f"Error: {error}")
