"""
Data Validation Pipeline for Interview Question Scrapers

Comprehensive validation to catch:
- Empty/garbage content
- Incorrect company attribution
- Date parsing errors
- Duplicate questions
- Spam/irrelevant content
- Encoding issues
- Truncated content

Usage:
    from scraper.utils.validation import ValidationPipeline

    pipeline = ValidationPipeline()
    result = pipeline.validate(question_data)
    if result.is_valid:
        save_to_database(result.cleaned_data)
    else:
        log_rejection(result.errors)
"""

import re
import hashlib
import unicodedata
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Set, Tuple
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
import difflib


class ValidationErrorType(Enum):
    """Types of validation errors"""
    EMPTY_CONTENT = "empty_content"
    GARBAGE_CONTENT = "garbage_content"
    TRUNCATED_CONTENT = "truncated_content"
    INVALID_COMPANY = "invalid_company"
    INVALID_DATE = "invalid_date"
    FUTURE_DATE = "future_date"
    ANCIENT_DATE = "ancient_date"
    DUPLICATE = "duplicate"
    NEAR_DUPLICATE = "near_duplicate"
    SPAM = "spam"
    IRRELEVANT = "irrelevant"
    ENCODING_ERROR = "encoding_error"
    MISSING_REQUIRED = "missing_required"
    LOW_QUALITY = "low_quality"
    SUSPICIOUS_PATTERN = "suspicious_pattern"


@dataclass
class ValidationError:
    """A single validation error"""
    error_type: ValidationErrorType
    field: str
    message: str
    severity: str = "error"  # "error", "warning", "info"
    auto_fixed: bool = False
    original_value: Any = None
    fixed_value: Any = None


@dataclass
class ValidationResult:
    """Result of validation pipeline"""
    is_valid: bool
    cleaned_data: Dict[str, Any]
    errors: List[ValidationError] = field(default_factory=list)
    warnings: List[ValidationError] = field(default_factory=list)
    quality_score: float = 0.0
    content_hash: str = ""
    fingerprint: str = ""


class EncodingFixer:
    """Fix common encoding issues in scraped content"""

    ENCODING_FIXES = {
        'â€™': "'",
        'â€œ': '"',
        'â€': '"',
        'â€"': '—',
        'â€"': '–',
        'Ã©': 'é',
        'Ã¨': 'è',
        'Ã ': 'à',
        'Ã¢': 'â',
        'Ã®': 'î',
        'Ã´': 'ô',
        'Ã»': 'û',
        'Ã§': 'ç',
        'Ã±': 'ñ',
        '\x00': '',
        '�': '',
        '​': '',  # Zero-width space
        '‌': '',  # Zero-width non-joiner
        '‍': '',  # Zero-width joiner
        '﻿': '',  # BOM
        '\xa0': ' ',   # Non-breaking space
    }

    MOJIBAKE_PATTERNS = [
        (r'Ã¼', 'ü'),
        (r'Ã¤', 'ä'),
        (r'Ã¶', 'ö'),
        (r'ÃŸ', 'ß'),
        (r'Ã©', 'é'),
        (r'Ã¨', 'è'),
        (r'Ã ', 'à'),
    ]

    @classmethod
    def fix(cls, text: str) -> Tuple[str, bool]:
        """
        Fix encoding issues in text.
        Returns (fixed_text, was_fixed)
        """
        if not text:
            return text, False

        original = text

        # Apply direct replacements
        for bad, good in cls.ENCODING_FIXES.items():
            text = text.replace(bad, good)

        # Apply regex patterns for mojibake
        for pattern, replacement in cls.MOJIBAKE_PATTERNS:
            text = re.sub(pattern, replacement, text)

        # Normalize Unicode
        text = unicodedata.normalize('NFC', text)

        # Remove control characters except newlines/tabs
        text = ''.join(
            c for c in text
            if c in '\n\t' or not unicodedata.category(c).startswith('C')
        )

        # Fix multiple spaces
        text = re.sub(r' +', ' ', text)

        # Fix multiple newlines
        text = re.sub(r'\n{3,}', '\n\n', text)

        return text.strip(), text != original

    @classmethod
    def detect_encoding_issues(cls, text: str) -> List[str]:
        """Detect but don't fix encoding issues"""
        issues = []

        for bad in cls.ENCODING_FIXES.keys():
            if bad in text:
                issues.append(f"Found encoding artifact: {repr(bad)}")

        # Check for high ratio of replacement characters
        if text.count('�') > len(text) * 0.01:
            issues.append("High ratio of replacement characters")

        # Check for suspicious byte sequences
        if re.search(r'[\x80-\x9f]', text):
            issues.append("Contains Windows-1252 control characters")

        return issues


class ContentValidator:
    """Validate question content quality"""

    MIN_QUESTION_LENGTH = 10
    MAX_QUESTION_LENGTH = 10000
    MIN_WORD_COUNT = 3

    GARBAGE_PATTERNS = [
        r'^[\s\W]+$',  # Only whitespace/punctuation
        r'^[0-9\s]+$',  # Only numbers
        r'^(.)\1{10,}',  # Repeated characters
        r'^\[.*\]$',  # Just brackets
        r'^<.*>$',  # Just HTML tags
        r'^(test|testing|asdf|qwerty|lorem ipsum)',  # Test content
        r'^(null|undefined|none|n/a|N/A)$',  # Null values
    ]

    TRUNCATION_PATTERNS = [
        r'\.\.\.$',  # Ends with ellipsis
        r'…$',
        r'\[read more\]$',
        r'\[see more\]$',
        r'\[continue\]$',
        r'\.{3,}$',
        r'<truncated>$',
    ]

    QUESTION_INDICATORS = [
        r'\?',  # Contains question mark
        r'^(how|what|why|when|where|who|which|can|could|would|should|is|are|do|does|will|describe|explain|design|implement|write|given|find|return)',
        r'(problem|question|task|challenge|exercise|coding|algorithm|data structure)',
    ]

    @classmethod
    def validate(cls, text: str, field_name: str = "questionText") -> List[ValidationError]:
        """Validate content, return list of errors"""
        errors = []

        if not text or not text.strip():
            errors.append(ValidationError(
                error_type=ValidationErrorType.EMPTY_CONTENT,
                field=field_name,
                message="Content is empty",
                severity="error"
            ))
            return errors

        text = text.strip()

        # Check length
        if len(text) < cls.MIN_QUESTION_LENGTH:
            errors.append(ValidationError(
                error_type=ValidationErrorType.EMPTY_CONTENT,
                field=field_name,
                message=f"Content too short ({len(text)} < {cls.MIN_QUESTION_LENGTH} chars)",
                severity="error"
            ))

        if len(text) > cls.MAX_QUESTION_LENGTH:
            errors.append(ValidationError(
                error_type=ValidationErrorType.TRUNCATED_CONTENT,
                field=field_name,
                message=f"Content too long ({len(text)} > {cls.MAX_QUESTION_LENGTH} chars)",
                severity="warning"
            ))

        # Check word count
        words = text.split()
        if len(words) < cls.MIN_WORD_COUNT:
            errors.append(ValidationError(
                error_type=ValidationErrorType.EMPTY_CONTENT,
                field=field_name,
                message=f"Too few words ({len(words)} < {cls.MIN_WORD_COUNT})",
                severity="error"
            ))

        # Check for garbage patterns
        for pattern in cls.GARBAGE_PATTERNS:
            if re.match(pattern, text, re.IGNORECASE):
                errors.append(ValidationError(
                    error_type=ValidationErrorType.GARBAGE_CONTENT,
                    field=field_name,
                    message=f"Content matches garbage pattern: {pattern}",
                    severity="error"
                ))
                break

        # Check for truncation
        for pattern in cls.TRUNCATION_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                errors.append(ValidationError(
                    error_type=ValidationErrorType.TRUNCATED_CONTENT,
                    field=field_name,
                    message="Content appears to be truncated",
                    severity="warning"
                ))
                break

        # Check if it looks like a question/problem
        is_question_like = any(
            re.search(p, text, re.IGNORECASE)
            for p in cls.QUESTION_INDICATORS
        )
        if not is_question_like:
            errors.append(ValidationError(
                error_type=ValidationErrorType.IRRELEVANT,
                field=field_name,
                message="Content doesn't appear to be an interview question",
                severity="warning"
            ))

        return errors


class CompanyValidator:
    """Validate and normalize company names"""

    # Known tech companies with aliases
    KNOWN_COMPANIES = {
        'google': ['google', 'alphabet', 'googl', 'goog', 'google llc', 'google inc', 'youtube', 'deepmind', 'waymo'],
        'meta': ['meta', 'facebook', 'fb', 'meta platforms', 'instagram', 'whatsapp', 'oculus'],
        'amazon': ['amazon', 'amzn', 'aws', 'amazon web services', 'prime video', 'twitch', 'whole foods', 'audible'],
        'apple': ['apple', 'aapl', 'apple inc'],
        'microsoft': ['microsoft', 'msft', 'linkedin', 'github', 'azure', 'xbox', 'bing'],
        'netflix': ['netflix', 'nflx'],
        'nvidia': ['nvidia', 'nvda'],
        'tesla': ['tesla', 'tsla', 'spacex'],
        'uber': ['uber', 'uber eats', 'uber technologies'],
        'lyft': ['lyft'],
        'airbnb': ['airbnb', 'air bnb'],
        'stripe': ['stripe'],
        'coinbase': ['coinbase', 'coinbase pro'],
        'robinhood': ['robinhood', 'robin hood'],
        'palantir': ['palantir', 'pltr'],
        'snowflake': ['snowflake', 'snow'],
        'databricks': ['databricks'],
        'doordash': ['doordash', 'door dash'],
        'instacart': ['instacart'],
        'salesforce': ['salesforce', 'crm', 'slack', 'heroku', 'tableau', 'mulesoft'],
        'oracle': ['oracle', 'orcl'],
        'ibm': ['ibm', 'international business machines', 'red hat'],
        'intel': ['intel', 'intc'],
        'amd': ['amd', 'advanced micro devices'],
        'qualcomm': ['qualcomm', 'qcom'],
        'adobe': ['adobe', 'adbe'],
        'vmware': ['vmware'],
        'twitter': ['twitter', 'x', 'x.com', 'twtr'],
        'snap': ['snap', 'snapchat', 'snap inc'],
        'pinterest': ['pinterest', 'pins'],
        'spotify': ['spotify', 'spot'],
        'discord': ['discord'],
        'zoom': ['zoom', 'zoom video', 'zm'],
        'dropbox': ['dropbox', 'dbx'],
        'atlassian': ['atlassian', 'jira', 'confluence', 'trello', 'bitbucket'],
        'splunk': ['splunk', 'splk'],
        'datadog': ['datadog', 'ddog'],
        'mongodb': ['mongodb', 'mongo', 'mdb'],
        'elastic': ['elastic', 'elasticsearch', 'estc'],
        'cloudflare': ['cloudflare', 'net'],
        'okta': ['okta'],
        'twilio': ['twilio', 'twlo'],
        'square': ['square', 'block', 'sq', 'cash app'],
        'paypal': ['paypal', 'pypl', 'venmo'],
        'visa': ['visa', 'v'],
        'mastercard': ['mastercard', 'ma'],
        'goldman sachs': ['goldman sachs', 'gs', 'goldman'],
        'morgan stanley': ['morgan stanley', 'ms'],
        'jp morgan': ['jp morgan', 'jpmorgan', 'jpm', 'chase'],
        'citadel': ['citadel', 'citadel securities'],
        'two sigma': ['two sigma', '2sigma', '2 sigma'],
        'jane street': ['jane street', 'janestreet'],
        'de shaw': ['de shaw', 'd.e. shaw', 'deshaw'],
        'hrt': ['hrt', 'hudson river trading', 'hudson river'],
        'jump trading': ['jump trading', 'jump'],
        'bytedance': ['bytedance', 'tiktok', 'byte dance'],
        'alibaba': ['alibaba', 'baba', 'aliexpress', 'alipay', 'ant group'],
        'tencent': ['tencent', 'wechat', 'qq'],
        'baidu': ['baidu', 'bidu'],
        'jd': ['jd', 'jd.com', 'jingdong'],
        'meituan': ['meituan', '美团'],
        'shopee': ['shopee', 'sea limited', 'garena'],
        'grab': ['grab', 'grabfood'],
        'gojek': ['gojek', 'goto'],
        'samsung': ['samsung', 'ssnlf'],
        'kakao': ['kakao', 'kakaotalk'],
        'line': ['line', 'line corp'],
        'naver': ['naver'],
        'coupang': ['coupang', 'cpng'],
        'flipkart': ['flipkart', 'walmart india'],
        'ola': ['ola', 'ola cabs'],
        'paytm': ['paytm', 'one97'],
        'zomato': ['zomato'],
        'swiggy': ['swiggy'],
        'reliance': ['reliance', 'jio'],
        'infosys': ['infosys', 'infy'],
        'tcs': ['tcs', 'tata consultancy', 'tata'],
        'wipro': ['wipro'],
        'hcl': ['hcl', 'hcl technologies'],
        'cognizant': ['cognizant', 'ctsh'],
    }

    # Invert for lookup
    _ALIAS_TO_CANONICAL = {}
    for canonical, aliases in KNOWN_COMPANIES.items():
        for alias in aliases:
            _ALIAS_TO_CANONICAL[alias.lower()] = canonical

    INVALID_COMPANY_PATTERNS = [
        r'^(unknown|n/a|na|none|null|undefined|company|test|testing)$',
        r'^\d+$',
        r'^[^a-zA-Z]+$',
        r'^.{1,2}$',  # Too short
    ]

    @classmethod
    def normalize(cls, company: str) -> Tuple[str, float]:
        """
        Normalize company name.
        Returns (normalized_name, confidence)
        """
        if not company:
            return "", 0.0

        # Clean up
        company = company.strip().lower()
        company = re.sub(r'\s+', ' ', company)
        company = re.sub(r'[,\.]$', '', company)
        company = re.sub(r'^(the|a|an)\s+', '', company)
        company = re.sub(r'\s*(inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.?)$', '', company, flags=re.IGNORECASE)

        # Direct lookup
        if company in cls._ALIAS_TO_CANONICAL:
            return cls._ALIAS_TO_CANONICAL[company], 1.0

        # Fuzzy match
        best_match = None
        best_score = 0.0
        for alias, canonical in cls._ALIAS_TO_CANONICAL.items():
            score = difflib.SequenceMatcher(None, company, alias).ratio()
            if score > best_score and score > 0.8:
                best_score = score
                best_match = canonical

        if best_match:
            return best_match, best_score

        # Return cleaned version with lower confidence
        return company.title(), 0.5

    @classmethod
    def validate(cls, company: str) -> List[ValidationError]:
        """Validate company name"""
        errors = []

        if not company or not company.strip():
            errors.append(ValidationError(
                error_type=ValidationErrorType.INVALID_COMPANY,
                field="companyName",
                message="Company name is empty",
                severity="error"
            ))
            return errors

        company_lower = company.strip().lower()

        # Check against invalid patterns
        for pattern in cls.INVALID_COMPANY_PATTERNS:
            if re.match(pattern, company_lower, re.IGNORECASE):
                errors.append(ValidationError(
                    error_type=ValidationErrorType.INVALID_COMPANY,
                    field="companyName",
                    message=f"Company name matches invalid pattern: {pattern}",
                    severity="error",
                    original_value=company
                ))
                return errors

        # Normalize and check confidence
        normalized, confidence = cls.normalize(company)
        if confidence < 0.5:
            errors.append(ValidationError(
                error_type=ValidationErrorType.INVALID_COMPANY,
                field="companyName",
                message=f"Unrecognized company with low confidence ({confidence:.2f})",
                severity="warning",
                original_value=company,
                fixed_value=normalized
            ))

        return errors


class DateValidator:
    """Validate dates in scraped data"""

    MAX_FUTURE_DAYS = 7  # Allow slight future dates for timezones
    MAX_AGE_MONTHS = 60  # Reject dates older than 5 years

    @classmethod
    def validate(cls, date: Any, field_name: str = "interviewDate") -> List[ValidationError]:
        """Validate a date field"""
        errors = []

        if date is None:
            # None is acceptable for optional dates
            return errors

        # Convert to datetime if needed
        if isinstance(date, str):
            date = cls._parse_date(date)
            if date is None:
                errors.append(ValidationError(
                    error_type=ValidationErrorType.INVALID_DATE,
                    field=field_name,
                    message="Could not parse date string",
                    severity="error"
                ))
                return errors

        if not isinstance(date, datetime):
            errors.append(ValidationError(
                error_type=ValidationErrorType.INVALID_DATE,
                field=field_name,
                message=f"Invalid date type: {type(date).__name__}",
                severity="error"
            ))
            return errors

        now = datetime.now()

        # Check for future dates
        if date > now + timedelta(days=cls.MAX_FUTURE_DAYS):
            errors.append(ValidationError(
                error_type=ValidationErrorType.FUTURE_DATE,
                field=field_name,
                message=f"Date is in the future: {date.isoformat()}",
                severity="error"
            ))

        # Check for ancient dates
        cutoff = now - timedelta(days=cls.MAX_AGE_MONTHS * 30)
        if date < cutoff:
            errors.append(ValidationError(
                error_type=ValidationErrorType.ANCIENT_DATE,
                field=field_name,
                message=f"Date is too old: {date.isoformat()} (> {cls.MAX_AGE_MONTHS} months)",
                severity="warning"
            ))

        return errors

    @classmethod
    def _parse_date(cls, date_str: str) -> Optional[datetime]:
        """Parse common date formats"""
        formats = [
            "%Y-%m-%d",
            "%Y/%m/%d",
            "%d-%m-%Y",
            "%d/%m/%Y",
            "%m-%d-%Y",
            "%m/%d/%Y",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%M:%S.%f",
            "%Y-%m-%dT%H:%M:%S.%fZ",
            "%B %d, %Y",
            "%b %d, %Y",
            "%d %B %Y",
            "%d %b %Y",
        ]

        for fmt in formats:
            try:
                return datetime.strptime(date_str.strip(), fmt)
            except ValueError:
                continue

        return None


class SpamDetector:
    """Detect spam and irrelevant content"""

    SPAM_PATTERNS = [
        r'(buy|sell|purchase|order|discount|offer|deal|promo|coupon|free|limited time)',
        r'(click here|subscribe|sign up|register now|join now|act now)',
        r'(earn money|make money|work from home|passive income|crypto|bitcoin|nft)',
        r'(\$\d+|\d+\s*dollars|percent off|% off)',
        r'(telegram|whatsapp|dm me|contact me|message me).*(\+\d+|@)',
        r'(http[s]?://[^\s]+){3,}',  # Multiple URLs
        r'(.)\1{5,}',  # Repeated characters (like "aaaaaa")
        r'[A-Z]{10,}',  # ALL CAPS sequences
        r'(\b\w+\b)(\s+\1){4,}',  # Repeated words
    ]

    IRRELEVANT_PATTERNS = [
        r'^(thanks|thank you|helpful|great|awesome|good luck)',
        r'^(i agree|same here|me too|\+1|bump)',
        r'^(following|subscribed|commenting for)',
        r'^(anyone|somebody|someone)\s+(know|have|got)',
        r'(upvote|downvote|like|share|comment|follow)',
    ]

    PROMOTIONAL_KEYWORDS = {
        'buy', 'sell', 'discount', 'offer', 'promo', 'coupon', 'deal',
        'subscribe', 'signup', 'register', 'join', 'click', 'download',
        'limited', 'exclusive', 'special', 'bonus', 'gift', 'free',
    }

    @classmethod
    def detect(cls, text: str) -> List[ValidationError]:
        """Detect spam in text"""
        errors = []

        if not text:
            return errors

        text_lower = text.lower()

        # Check spam patterns
        for pattern in cls.SPAM_PATTERNS:
            if re.search(pattern, text_lower, re.IGNORECASE):
                errors.append(ValidationError(
                    error_type=ValidationErrorType.SPAM,
                    field="questionText",
                    message=f"Content matches spam pattern: {pattern[:50]}...",
                    severity="error"
                ))
                return errors  # One spam match is enough

        # Check irrelevant patterns
        for pattern in cls.IRRELEVANT_PATTERNS:
            if re.search(pattern, text_lower, re.IGNORECASE):
                errors.append(ValidationError(
                    error_type=ValidationErrorType.IRRELEVANT,
                    field="questionText",
                    message=f"Content appears to be irrelevant commentary",
                    severity="warning"
                ))
                break

        # Count promotional keywords
        words = set(re.findall(r'\b\w+\b', text_lower))
        promo_count = len(words & cls.PROMOTIONAL_KEYWORDS)
        if promo_count >= 3:
            errors.append(ValidationError(
                error_type=ValidationErrorType.SPAM,
                field="questionText",
                message=f"Content contains {promo_count} promotional keywords",
                severity="warning"
            ))

        return errors


class DuplicateDetector:
    """Detect exact and near-duplicate content"""

    def __init__(self):
        self._seen_hashes: Set[str] = set()
        self._fingerprints: Dict[str, str] = {}  # fingerprint -> first_id

    def get_content_hash(self, text: str) -> str:
        """Get exact hash of content"""
        normalized = self._normalize_for_hash(text)
        return hashlib.sha256(normalized.encode('utf-8')).hexdigest()

    def get_fingerprint(self, text: str) -> str:
        """Get fuzzy fingerprint for near-duplicate detection"""
        normalized = self._normalize_for_fingerprint(text)
        # Use simhash-style fingerprinting
        words = normalized.split()
        # Take first word, last word, length bucket, and some key terms
        fingerprint_parts = [
            words[0] if words else '',
            words[-1] if words else '',
            str(len(normalized) // 50),  # Length bucket
            str(len(words) // 5),  # Word count bucket
        ]
        return '|'.join(fingerprint_parts)

    def _normalize_for_hash(self, text: str) -> str:
        """Normalize text for exact hash comparison"""
        text = text.lower().strip()
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'[^\w\s]', '', text)
        return text

    def _normalize_for_fingerprint(self, text: str) -> str:
        """Normalize text for fingerprint comparison"""
        text = text.lower().strip()
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'[^\w\s]', '', text)
        # Remove common stop words
        stop_words = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
                     'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
                     'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into',
                     'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'while'}
        words = [w for w in text.split() if w not in stop_words]
        return ' '.join(words)

    def check(self, text: str, question_id: str = "") -> List[ValidationError]:
        """Check for duplicates"""
        errors = []

        content_hash = self.get_content_hash(text)
        fingerprint = self.get_fingerprint(text)

        # Check exact duplicate
        if content_hash in self._seen_hashes:
            errors.append(ValidationError(
                error_type=ValidationErrorType.DUPLICATE,
                field="questionText",
                message="Exact duplicate content detected",
                severity="error"
            ))
            return errors

        # Check near-duplicate
        if fingerprint in self._fingerprints:
            original_id = self._fingerprints[fingerprint]
            errors.append(ValidationError(
                error_type=ValidationErrorType.NEAR_DUPLICATE,
                field="questionText",
                message=f"Near-duplicate of question {original_id}",
                severity="warning"
            ))

        # Store for future checks
        self._seen_hashes.add(content_hash)
        if fingerprint not in self._fingerprints:
            self._fingerprints[fingerprint] = question_id

        return errors

    def clear(self):
        """Clear stored hashes and fingerprints"""
        self._seen_hashes.clear()
        self._fingerprints.clear()


class QualityScorer:
    """Calculate overall quality score for interview questions"""

    WEIGHTS = {
        'content_length': 0.15,
        'has_question_mark': 0.10,
        'technical_terms': 0.15,
        'code_blocks': 0.10,
        'company_confidence': 0.15,
        'date_present': 0.10,
        'source_reliability': 0.15,
        'no_errors': 0.10,
    }

    TECHNICAL_TERMS = {
        'algorithm', 'data structure', 'time complexity', 'space complexity',
        'array', 'linked list', 'tree', 'graph', 'hash', 'heap', 'stack', 'queue',
        'binary search', 'dfs', 'bfs', 'dynamic programming', 'recursion',
        'sorting', 'searching', 'traversal', 'optimization',
        'api', 'rest', 'graphql', 'database', 'sql', 'nosql',
        'microservices', 'distributed', 'scalability', 'latency', 'throughput',
        'cache', 'load balancer', 'sharding', 'replication', 'consistency',
        'concurrency', 'thread', 'mutex', 'deadlock', 'race condition',
        'object oriented', 'design pattern', 'solid', 'inheritance', 'polymorphism',
        'testing', 'unit test', 'integration test', 'ci/cd', 'deployment',
        'kubernetes', 'docker', 'cloud', 'aws', 'gcp', 'azure',
    }

    RELIABLE_SOURCES = {
        'leetcode': 0.95,
        'glassdoor': 0.85,
        'blind': 0.80,
        'geeksforgeeks': 0.85,
        'github': 0.75,
        'reddit': 0.70,
        'careercup': 0.80,
        'levels_fyi': 0.75,
        '1point3acres': 0.80,
        'nowcoder': 0.85,
        'hackerrank': 0.90,
    }

    @classmethod
    def score(cls, question: Dict[str, Any], errors: List[ValidationError]) -> float:
        """Calculate quality score from 0-1"""
        scores = {}

        text = question.get('questionText', '')

        # Content length score (longer is generally better, up to a point)
        length = len(text)
        if length < 50:
            scores['content_length'] = 0.2
        elif length < 100:
            scores['content_length'] = 0.5
        elif length < 500:
            scores['content_length'] = 0.8
        elif length < 2000:
            scores['content_length'] = 1.0
        else:
            scores['content_length'] = 0.9  # Very long might be too verbose

        # Question mark presence
        scores['has_question_mark'] = 1.0 if '?' in text else 0.5

        # Technical terms count
        text_lower = text.lower()
        tech_count = sum(1 for term in cls.TECHNICAL_TERMS if term in text_lower)
        scores['technical_terms'] = min(1.0, tech_count / 3)

        # Code blocks present
        has_code = bool(re.search(r'```|`[^`]+`|def |function |class |public |private ', text))
        scores['code_blocks'] = 1.0 if has_code else 0.5

        # Company confidence
        company = question.get('companyName', '')
        _, confidence = CompanyValidator.normalize(company)
        scores['company_confidence'] = confidence

        # Date presence
        has_date = question.get('interviewDate') is not None or question.get('postedDate') is not None
        scores['date_present'] = 1.0 if has_date else 0.3

        # Source reliability
        source = question.get('source', 'other')
        scores['source_reliability'] = cls.RELIABLE_SOURCES.get(source, 0.5)

        # No validation errors
        error_count = len([e for e in errors if e.severity == 'error'])
        warning_count = len([e for e in errors if e.severity == 'warning'])
        if error_count > 0:
            scores['no_errors'] = 0.0
        elif warning_count > 2:
            scores['no_errors'] = 0.5
        elif warning_count > 0:
            scores['no_errors'] = 0.8
        else:
            scores['no_errors'] = 1.0

        # Weighted average
        total_score = sum(
            scores.get(key, 0) * weight
            for key, weight in cls.WEIGHTS.items()
        )

        return round(total_score, 3)


class ValidationPipeline:
    """Complete validation pipeline for interview questions"""

    def __init__(self, min_quality_score: float = 0.4):
        self.min_quality_score = min_quality_score
        self.duplicate_detector = DuplicateDetector()
        self.stats = defaultdict(int)

    def validate(self, question: Dict[str, Any]) -> ValidationResult:
        """
        Run complete validation pipeline on a question.
        Returns ValidationResult with cleaned data and any errors.
        """
        errors = []
        warnings = []
        cleaned = dict(question)  # Copy to avoid mutating original

        # 1. Fix encoding first
        text = question.get('questionText', '')
        if text:
            fixed_text, was_fixed = EncodingFixer.fix(text)
            if was_fixed:
                cleaned['questionText'] = fixed_text
                warnings.append(ValidationError(
                    error_type=ValidationErrorType.ENCODING_ERROR,
                    field="questionText",
                    message="Encoding issues were auto-fixed",
                    severity="info",
                    auto_fixed=True,
                    original_value=text,
                    fixed_value=fixed_text
                ))
            text = fixed_text

        # 2. Content validation
        content_errors = ContentValidator.validate(text)
        for err in content_errors:
            if err.severity == "error":
                errors.append(err)
            else:
                warnings.append(err)

        # 3. Company validation
        company = question.get('companyName', '')
        company_errors = CompanyValidator.validate(company)
        for err in company_errors:
            if err.severity == "error":
                errors.append(err)
            else:
                warnings.append(err)

        # Normalize company name
        if company:
            normalized, _ = CompanyValidator.normalize(company)
            cleaned['companyNormalized'] = normalized

        # 4. Date validation
        for date_field in ['interviewDate', 'postedDate']:
            date_val = question.get(date_field)
            if date_val:
                date_errors = DateValidator.validate(date_val, date_field)
                for err in date_errors:
                    if err.severity == "error":
                        errors.append(err)
                    else:
                        warnings.append(err)

        # 5. Spam detection
        if text:
            spam_errors = SpamDetector.detect(text)
            for err in spam_errors:
                if err.severity == "error":
                    errors.append(err)
                else:
                    warnings.append(err)

        # 6. Duplicate detection
        if text:
            question_id = question.get('id', '')
            dupe_errors = self.duplicate_detector.check(text, question_id)
            for err in dupe_errors:
                if err.severity == "error":
                    errors.append(err)
                else:
                    warnings.append(err)

        # 7. Calculate quality score
        all_errors = errors + warnings
        quality_score = QualityScorer.score(cleaned, all_errors)
        cleaned['qualityScore'] = quality_score

        # Low quality is an error if below threshold
        if quality_score < self.min_quality_score:
            errors.append(ValidationError(
                error_type=ValidationErrorType.LOW_QUALITY,
                field="overall",
                message=f"Quality score {quality_score:.2f} below threshold {self.min_quality_score}",
                severity="error"
            ))

        # 8. Generate hashes for deduplication
        content_hash = self.duplicate_detector.get_content_hash(text) if text else ""
        fingerprint = self.duplicate_detector.get_fingerprint(text) if text else ""

        # Update stats
        self.stats['total_validated'] += 1
        if errors:
            self.stats['rejected'] += 1
            for err in errors:
                self.stats[f'error_{err.error_type.value}'] += 1
        else:
            self.stats['accepted'] += 1

        return ValidationResult(
            is_valid=len(errors) == 0,
            cleaned_data=cleaned,
            errors=errors,
            warnings=warnings,
            quality_score=quality_score,
            content_hash=content_hash,
            fingerprint=fingerprint
        )

    def validate_batch(self, questions: List[Dict[str, Any]]) -> List[ValidationResult]:
        """Validate a batch of questions"""
        return [self.validate(q) for q in questions]

    def get_stats(self) -> Dict[str, int]:
        """Get validation statistics"""
        return dict(self.stats)

    def reset_duplicates(self):
        """Reset duplicate detection state"""
        self.duplicate_detector.clear()


# Convenience functions
def validate_question(question: Dict[str, Any]) -> ValidationResult:
    """Validate a single question with default settings"""
    pipeline = ValidationPipeline()
    return pipeline.validate(question)


def validate_questions(questions: List[Dict[str, Any]], min_quality: float = 0.4) -> Tuple[List[Dict], List[Dict]]:
    """
    Validate a batch of questions.
    Returns (valid_questions, rejected_questions)
    """
    pipeline = ValidationPipeline(min_quality_score=min_quality)
    results = pipeline.validate_batch(questions)

    valid = []
    rejected = []

    for q, result in zip(questions, results):
        if result.is_valid:
            valid.append(result.cleaned_data)
        else:
            rejected.append({
                'original': q,
                'errors': [{'type': e.error_type.value, 'message': e.message} for e in result.errors]
            })

    return valid, rejected
