"""
Blind User Submission Integration

Blind (teamblind.com) requires authentication and cannot be scraped directly.
This module provides utilities for users to manually submit Blind interview links,
with URL parsing to extract company and post metadata.

Enhanced with:
- ValidationPipeline for content quality checks
- CompanyValidator for robust company name normalization (208 aliases)
- DuplicateDetector for submission deduplication
- StealthSession for anti-detection (CRITICAL for Blind)
- SessionManager for authenticated requests
- ResponseCache for caching
- Monitoring integration

Usage:
    from blind_submission import parse_blind_url, validate_blind_url, BlindSubmission

    url = "https://www.teamblind.com/post/Google-Interview-Experience-L4-abc123"
    if validate_blind_url(url):
        submission = parse_blind_url(url)
        print(f"Company: {submission.company}, Post ID: {submission.post_id}")
"""

import re
import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Tuple, Any
from urllib.parse import urlparse, unquote

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
            logger.warning("[blind_submission] Infrastructure modules not available, using basic mode")
        StealthSession = None

# Treat unified infra as full infra
if UNIFIED_INFRA and not INFRA_AVAILABLE:
    INFRA_AVAILABLE = True

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
            _checkpoint = CheckpointManager("blind_submission")
        except Exception:
            pass
    return _checkpoint


# Ensure fallback variables are defined
if not INFRA_AVAILABLE:
    create_stealth_session = None
    SessionManager = None
    get_authenticated_session = None
    ResponseCache = None
    get_cache = None
    monitor_scraper = None

# Import validation modules
try:
    from scraper.utils.validation import (
        ValidationPipeline,
        CompanyValidator,
        DuplicateDetector,
        ContentValidator,
        ValidationResult
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
                min_delay=2.0,  # Blind is very sensitive to scraping
                max_delay=5.0,
                requests_per_minute=10  # Very conservative for Blind
            )
            logger.info("[blind_submission] StealthSession initialized")
        except Exception as e:
            logger.warning(f"[blind_submission] Could not initialize StealthSession: {e}")

    if _session_manager is None:
        try:
            _session_manager = SessionManager('blind')
            logger.info("[blind_submission] SessionManager initialized")
        except Exception as e:
            logger.warning(f"[blind_submission] Could not initialize SessionManager: {e}")

    if _response_cache is None:
        try:
            _response_cache = get_cache()
            logger.info("[blind_submission] ResponseCache initialized")
        except Exception as e:
            logger.warning(f"[blind_submission] Could not initialize ResponseCache: {e}")


def get_stealth_session() -> Optional['StealthSession']:
    """Get the stealth session for Blind requests."""
    _init_infrastructure()
    return _stealth_session


def get_blind_session_manager() -> Optional['SessionManager']:
    """Get the session manager for authenticated Blind requests."""
    _init_infrastructure()
    return _session_manager


@dataclass
class BlindSubmission:
    """Data structure for user-submitted Blind interview links."""

    id: str
    url: str
    company: Optional[str]
    post_id: Optional[str]
    post_title: Optional[str]
    post_type: str  # 'interview', 'compensation', 'general', 'unknown'
    submitted_at: datetime
    submitted_by: Optional[str] = None

    # User-provided metadata (optional)
    role: Optional[str] = None
    interview_date: Optional[datetime] = None
    question_summary: Optional[str] = None
    tags: List[str] = field(default_factory=list)

    # Validation
    is_verified: bool = False
    verification_note: Optional[str] = None

    def to_dict(self) -> Dict:
        """Convert to dictionary for database storage."""
        return {
            'id': self.id,
            'url': self.url,
            'company': self.company,
            'post_id': self.post_id,
            'post_title': self.post_title,
            'post_type': self.post_type,
            'submitted_at': self.submitted_at.isoformat() if self.submitted_at else None,
            'submitted_by': self.submitted_by,
            'role': self.role,
            'interview_date': self.interview_date.isoformat() if self.interview_date else None,
            'question_summary': self.question_summary,
            'tags': self.tags,
            'is_verified': self.is_verified,
            'verification_note': self.verification_note,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'BlindSubmission':
        """Create from dictionary."""
        return cls(
            id=data['id'],
            url=data['url'],
            company=data.get('company'),
            post_id=data.get('post_id'),
            post_title=data.get('post_title'),
            post_type=data.get('post_type', 'unknown'),
            submitted_at=datetime.fromisoformat(data['submitted_at']) if data.get('submitted_at') else datetime.now(),
            submitted_by=data.get('submitted_by'),
            role=data.get('role'),
            interview_date=datetime.fromisoformat(data['interview_date']) if data.get('interview_date') else None,
            question_summary=data.get('question_summary'),
            tags=data.get('tags', []),
            is_verified=data.get('is_verified', False),
            verification_note=data.get('verification_note'),
        )


# Valid Blind URL patterns
BLIND_DOMAINS = [
    'teamblind.com',
    'www.teamblind.com',
    'blind.com',
    'www.blind.com',
]

# Company name normalization mapping
COMPANY_ALIASES: Dict[str, str] = {
    # FAANG
    'meta': 'Meta',
    'facebook': 'Meta',
    'fb': 'Meta',
    'google': 'Google',
    'goog': 'Google',
    'alphabet': 'Google',
    'amazon': 'Amazon',
    'amzn': 'Amazon',
    'aws': 'Amazon',
    'apple': 'Apple',
    'aapl': 'Apple',
    'netflix': 'Netflix',
    'nflx': 'Netflix',
    'microsoft': 'Microsoft',
    'msft': 'Microsoft',

    # Big Tech
    'uber': 'Uber',
    'lyft': 'Lyft',
    'airbnb': 'Airbnb',
    'stripe': 'Stripe',
    'square': 'Square',
    'block': 'Block',
    'twitter': 'X',
    'x': 'X',
    'linkedin': 'LinkedIn',
    'salesforce': 'Salesforce',
    'oracle': 'Oracle',
    'ibm': 'IBM',
    'intel': 'Intel',
    'nvidia': 'NVIDIA',
    'amd': 'AMD',
    'tesla': 'Tesla',
    'spacex': 'SpaceX',
    'palantir': 'Palantir',
    'databricks': 'Databricks',
    'snowflake': 'Snowflake',
    'coinbase': 'Coinbase',
    'robinhood': 'Robinhood',
    'doordash': 'DoorDash',
    'instacart': 'Instacart',
    'snap': 'Snap',
    'snapchat': 'Snap',
    'pinterest': 'Pinterest',
    'reddit': 'Reddit',
    'dropbox': 'Dropbox',
    'zoom': 'Zoom',
    'slack': 'Slack',
    'atlassian': 'Atlassian',
    'shopify': 'Shopify',
    'twilio': 'Twilio',
    'cloudflare': 'Cloudflare',
    'datadog': 'Datadog',
    'splunk': 'Splunk',
    'mongodb': 'MongoDB',
    'elastic': 'Elastic',
    'github': 'GitHub',
    'gitlab': 'GitLab',
    'figma': 'Figma',
    'notion': 'Notion',
    'asana': 'Asana',
    'monday': 'Monday.com',
    'plaid': 'Plaid',
    'roblox': 'Roblox',
    'epic': 'Epic Games',
    'epicgames': 'Epic Games',
    'unity': 'Unity',
    'activision': 'Activision Blizzard',
    'blizzard': 'Activision Blizzard',
    'ea': 'EA',
    'electronic arts': 'EA',
    'riot': 'Riot Games',
    'riotgames': 'Riot Games',

    # Quant/Finance
    'citadel': 'Citadel',
    'janestreet': 'Jane Street',
    'jane street': 'Jane Street',
    'twosigma': 'Two Sigma',
    'two sigma': 'Two Sigma',
    'de shaw': 'D.E. Shaw',
    'deshaw': 'D.E. Shaw',
    'hrt': 'Hudson River Trading',
    'hudsonriver': 'Hudson River Trading',
    'jump': 'Jump Trading',
    'jumptrading': 'Jump Trading',
    'optiver': 'Optiver',
    'imc': 'IMC Trading',
    'akuna': 'Akuna Capital',
    'drw': 'DRW',
    'susquehanna': 'Susquehanna',
    'sig': 'Susquehanna',
    'goldmansachs': 'Goldman Sachs',
    'goldman': 'Goldman Sachs',
    'gs': 'Goldman Sachs',
    'morganstanley': 'Morgan Stanley',
    'morgan stanley': 'Morgan Stanley',
    'jpmorgan': 'JPMorgan',
    'jp morgan': 'JPMorgan',
    'jpm': 'JPMorgan',
    'bofa': 'Bank of America',
    'bankofamerica': 'Bank of America',
    'citi': 'Citigroup',
    'citigroup': 'Citigroup',
    'barclays': 'Barclays',

    # Startups & Others
    'bytedance': 'ByteDance',
    'tiktok': 'TikTok',
    'grab': 'Grab',
    'shopee': 'Shopee',
    'sea': 'Sea Limited',
    'lazada': 'Lazada',
}

# Post type detection patterns
POST_TYPE_PATTERNS: Dict[str, List[str]] = {
    'interview': [
        r'interview',
        r'onsite',
        r'phone\s*screen',
        r'coding\s*round',
        r'system\s*design',
        r'behavioral',
        r'offer',
        r'rejection',
        r'hired',
        r'oa\b',
        r'online\s*assessment',
        r'technical\s*round',
        r'loop',
        r'virtual\s*onsite',
    ],
    'compensation': [
        r'tc\b',
        r'total\s*comp',
        r'salary',
        r'offer\s*details',
        r'compensation',
        r'rsu',
        r'stock',
        r'bonus',
        r'sign\s*on',
        r'signing',
        r'yoe',
        r'years?\s*of\s*experience',
    ],
}


def validate_blind_url(url: str) -> Tuple[bool, Optional[str]]:
    """
    Validate if a URL is a valid Blind post URL.

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not url:
        return False, "URL is empty"

    try:
        parsed = urlparse(url)
    except Exception as e:
        return False, f"Invalid URL format: {e}"

    # Check scheme
    if parsed.scheme not in ('http', 'https'):
        return False, f"Invalid scheme: {parsed.scheme}. Expected http or https"

    # Check domain
    domain = parsed.netloc.lower()
    if domain not in BLIND_DOMAINS:
        return False, f"Not a Blind domain: {domain}"

    # Check path - must have /post/ segment
    path = parsed.path.lower()
    if not path:
        return False, "No path in URL"

    # Valid paths: /post/xxx, /company/xxx, /polls/xxx
    valid_prefixes = ['/post/', '/company/', '/polls/']
    if not any(path.startswith(prefix) for prefix in valid_prefixes):
        return False, f"Invalid Blind path: {path}. Expected /post/, /company/, or /polls/"

    return True, None


def extract_company_from_title(title: str) -> Optional[str]:
    """
    Extract company name from a Blind post title.

    Examples:
        "Google-Interview-Experience-L4" -> "Google"
        "Amazon-SDE2-Onsite-Questions" -> "Amazon"
        "Meta-E5-Offer-TC-Discussion" -> "Meta"
        "Two-Sigma-Quant-Interview" -> "Two Sigma"
    """
    if not title:
        return None

    # Clean title
    title = unquote(title)
    title_lower = title.lower()

    # First, try to match multi-word company names (e.g., "Two Sigma", "Jane Street")
    # Check both hyphenated and space-separated versions
    multi_word_companies = [
        ('two-sigma', 'Two Sigma'),
        ('twosigma', 'Two Sigma'),
        ('jane-street', 'Jane Street'),
        ('janestreet', 'Jane Street'),
        ('de-shaw', 'D.E. Shaw'),
        ('deshaw', 'D.E. Shaw'),
        ('hudson-river', 'Hudson River Trading'),
        ('jump-trading', 'Jump Trading'),
        ('goldman-sachs', 'Goldman Sachs'),
        ('morgan-stanley', 'Morgan Stanley'),
        ('jp-morgan', 'JPMorgan'),
        ('jpmorgan', 'JPMorgan'),
        ('bank-of-america', 'Bank of America'),
        ('epic-games', 'Epic Games'),
        ('riot-games', 'Riot Games'),
        ('activision-blizzard', 'Activision Blizzard'),
    ]

    for pattern, company_name in multi_word_companies:
        if pattern in title_lower.replace(' ', '-'):
            return company_name

    # Split by common delimiters
    parts = re.split(r'[-_\s]+', title)

    if not parts:
        return None

    # First part is usually the company
    first_part = parts[0].lower().strip()

    # Check against aliases
    if first_part in COMPANY_ALIASES:
        return COMPANY_ALIASES[first_part]

    # Check if first part looks like a company name (capitalized, reasonable length)
    if len(first_part) >= 2 and first_part.isalpha():
        return parts[0].capitalize()

    # Try matching any part against known companies
    for part in parts:
        part_lower = part.lower()
        if part_lower in COMPANY_ALIASES:
            return COMPANY_ALIASES[part_lower]

    return None


def detect_post_type(title: str, url: str) -> str:
    """
    Detect the type of Blind post based on title and URL.

    Returns: 'interview', 'compensation', 'general', or 'unknown'
    """
    text = f"{title} {url}".lower()

    # Check interview patterns first (higher priority)
    for pattern in POST_TYPE_PATTERNS['interview']:
        if re.search(pattern, text, re.IGNORECASE):
            return 'interview'

    # Check compensation patterns
    for pattern in POST_TYPE_PATTERNS['compensation']:
        if re.search(pattern, text, re.IGNORECASE):
            return 'compensation'

    # Check URL path
    parsed = urlparse(url)
    path = parsed.path.lower()

    if '/company/' in path:
        return 'general'  # Company-specific discussion
    elif '/polls/' in path:
        return 'general'

    return 'unknown'


def extract_role_from_title(title: str) -> Optional[str]:
    """
    Extract role/level from Blind post title.

    Examples:
        "Google-L4-Interview" -> "L4"
        "Amazon-SDE2-Onsite" -> "SDE2"
        "Meta-E5-Offer" -> "E5"
    """
    if not title:
        return None

    title = unquote(title)

    # Level patterns
    level_patterns = [
        r'\b(L[0-9]+)\b',           # Google levels: L3, L4, L5, L6, L7
        r'\b(E[0-9]+)\b',           # Meta levels: E3, E4, E5, E6
        r'\b(SDE\s*[I1-3]+)\b',     # Amazon: SDE1, SDE2, SDE3, SDE II
        r'\b(IC[0-9]+)\b',          # IC levels: IC3, IC4, IC5
        r'\b(Senior|Staff|Principal|Distinguished)\b',
        r'\b(Junior|Entry|New\s*Grad|Intern)\b',
        r'\b(T[0-9]+)\b',           # Microsoft levels: T59, T60, etc (first digit)
    ]

    for pattern in level_patterns:
        match = re.search(pattern, title, re.IGNORECASE)
        if match:
            return match.group(1).upper()

    return None


def parse_blind_url(url: str, submitted_by: Optional[str] = None) -> BlindSubmission:
    """
    Parse a Blind URL and extract available metadata.

    Args:
        url: The Blind post URL
        submitted_by: Optional user ID who submitted the link

    Returns:
        BlindSubmission object with extracted metadata

    Raises:
        ValueError: If the URL is not a valid Blind URL
    """
    is_valid, error = validate_blind_url(url)
    if not is_valid:
        raise ValueError(f"Invalid Blind URL: {error}")

    parsed = urlparse(url)
    path = parsed.path

    # Extract post ID and title from path
    # Pattern: /post/Title-With-Dashes-PostId
    post_id = None
    post_title = None

    path_parts = path.strip('/').split('/')
    if len(path_parts) >= 2:
        # Last segment often contains title-postid
        last_segment = path_parts[-1]

        # Post ID is often the last alphanumeric segment
        id_match = re.search(r'([a-zA-Z0-9]{6,})$', last_segment)
        if id_match:
            post_id = id_match.group(1)
            # Title is everything before the post ID
            post_title = last_segment[:id_match.start()].rstrip('-_')
        else:
            post_title = last_segment

    # Extract company from title
    company = extract_company_from_title(post_title) if post_title else None

    # Detect post type
    post_type = detect_post_type(post_title or '', url)

    # Extract role if present
    role = extract_role_from_title(post_title) if post_title else None

    # Generate unique ID
    content_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
    submission_id = f"blind_{content_hash}"

    return BlindSubmission(
        id=submission_id,
        url=url,
        company=company,
        post_id=post_id,
        post_title=post_title,
        post_type=post_type,
        submitted_at=datetime.now(),
        submitted_by=submitted_by,
        role=role,
    )


def create_submission_from_user_input(
    url: str,
    user_id: Optional[str] = None,
    company: Optional[str] = None,
    role: Optional[str] = None,
    interview_date: Optional[datetime] = None,
    question_summary: Optional[str] = None,
    tags: Optional[List[str]] = None,
    check_duplicates: bool = True,
    validate_content: bool = True,
) -> Tuple[BlindSubmission, List[str]]:
    """
    Create a BlindSubmission with user-provided metadata overrides.

    Enhanced with:
    - CompanyValidator for robust company normalization
    - DuplicateDetector to catch duplicate submissions
    - ContentValidator for quality checks

    The URL is parsed first, then user-provided values override extracted ones.

    Args:
        url: Blind post URL
        user_id: Optional user ID who submitted
        company: Override extracted company name
        role: Override extracted role
        interview_date: Interview date
        question_summary: Summary of interview questions
        tags: List of tags
        check_duplicates: Whether to check for duplicates
        validate_content: Whether to validate content quality

    Returns:
        Tuple of (submission, errors) - errors is empty list if valid
    """
    errors = []

    try:
        submission = parse_blind_url(url, submitted_by=user_id)
    except ValueError as e:
        return None, [str(e)]

    # Override with user-provided values, using enhanced normalization
    if company:
        normalized_company, confidence = normalize_company_name(company)
        submission.company = normalized_company
        if confidence < 0.5:
            errors.append(f"Low confidence company match: {company} -> {normalized_company}")
    elif submission.company:
        # Also normalize the extracted company
        normalized_company, _ = normalize_company_name(submission.company)
        submission.company = normalized_company

    if role:
        submission.role = role

    if interview_date:
        submission.interview_date = interview_date

    if question_summary:
        submission.question_summary = question_summary

    if tags:
        submission.tags = tags

    # Check for duplicates
    if check_duplicates:
        is_dup, existing_id = check_duplicate_submission(submission)
        if is_dup:
            errors.append("This submission appears to be a duplicate")

    # Validate content quality
    if validate_content:
        content_errors = validate_submission_content(submission)
        errors.extend(content_errors)

    return submission, errors


def create_submission_from_user_input_simple(
    url: str,
    user_id: Optional[str] = None,
    company: Optional[str] = None,
    role: Optional[str] = None,
    interview_date: Optional[datetime] = None,
    question_summary: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> BlindSubmission:
    """
    Backwards-compatible version without validation.
    Returns just the submission, raises on URL error.
    """
    submission, errors = create_submission_from_user_input(
        url=url,
        user_id=user_id,
        company=company,
        role=role,
        interview_date=interview_date,
        question_summary=question_summary,
        tags=tags,
        check_duplicates=False,
        validate_content=False,
    )
    if submission is None:
        raise ValueError(errors[0] if errors else "Unknown error")
    return submission


# Global validators (lazy initialization)
_company_validator: Optional['CompanyValidator'] = None
_duplicate_detector: Optional['DuplicateDetector'] = None
_content_validator: Optional['ContentValidator'] = None


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


def normalize_company_name(name: str) -> Tuple[str, float]:
    """
    Normalize company name using CompanyValidator if available,
    otherwise fall back to COMPANY_ALIASES.

    Returns:
        Tuple of (normalized_name, confidence)
    """
    if not name:
        return name, 0.0

    name_lower = name.lower().strip()

    # Try CompanyValidator first (208+ aliases, fuzzy matching)
    validator = _get_company_validator()
    if validator:
        result = validator.validate(name)
        if result.normalized_name:
            return result.normalized_name, result.confidence

    # Fall back to local COMPANY_ALIASES
    if name_lower in COMPANY_ALIASES:
        return COMPANY_ALIASES[name_lower], 1.0

    return name, 0.5


def check_duplicate_submission(submission: 'BlindSubmission') -> Tuple[bool, Optional[str]]:
    """
    Check if this submission is a duplicate.

    Returns:
        Tuple of (is_duplicate, existing_id if duplicate)
    """
    detector = _get_duplicate_detector()
    if not detector:
        return False, None

    # Create a text representation for duplicate check
    text = f"{submission.company or ''} {submission.post_title or ''} {submission.question_summary or ''}"

    if detector.is_duplicate(text):
        return True, None  # No way to get existing ID with current API

    # Register this submission
    detector.register(text, submission.id)
    return False, None


def validate_submission_content(submission: 'BlindSubmission') -> List[str]:
    """
    Validate submission content quality.

    Returns:
        List of validation error messages (empty if valid)
    """
    errors = []
    validator = _get_content_validator()

    if not validator:
        # Basic validation without infrastructure
        if submission.question_summary and len(submission.question_summary.strip()) < 10:
            errors.append("Question summary is too short")
        return errors

    # Use content validator for thorough checks
    if submission.question_summary:
        result = validator.validate(submission.question_summary)
        if not result.is_valid:
            errors.append(result.error_message or "Invalid content")

    return errors


# Export main functions
__all__ = [
    'BlindSubmission',
    'parse_blind_url',
    'validate_blind_url',
    'create_submission_from_user_input',
    'extract_company_from_title',
    'detect_post_type',
    'normalize_company_name',
    'check_duplicate_submission',
    'validate_submission_content',
    'COMPANY_ALIASES',
    'HAS_VALIDATION',
    'INFRA_AVAILABLE',
    'get_stealth_session',
    'get_blind_session_manager',
]


if __name__ == '__main__':
    # Test the parser
    test_urls = [
        "https://www.teamblind.com/post/Google-L4-Interview-Experience-abc123",
        "https://www.teamblind.com/post/Amazon-SDE2-Onsite-Questions-def456",
        "https://www.teamblind.com/post/Meta-E5-Offer-TC-Discussion-ghi789",
        "https://www.teamblind.com/company/Google",
        "https://www.teamblind.com/post/Two-Sigma-Quant-Interview-jkl012",
    ]

    print("Testing Blind URL Parser\n" + "=" * 50)

    for url in test_urls:
        print(f"\nURL: {url}")
        is_valid, error = validate_blind_url(url)
        print(f"Valid: {is_valid}")

        if is_valid:
            try:
                submission = parse_blind_url(url)
                print(f"  Company: {submission.company}")
                print(f"  Post ID: {submission.post_id}")
                print(f"  Title: {submission.post_title}")
                print(f"  Type: {submission.post_type}")
                print(f"  Role: {submission.role}")
            except ValueError as e:
                print(f"  Error: {e}")
        else:
            print(f"  Error: {error}")
