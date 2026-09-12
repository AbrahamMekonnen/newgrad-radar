"""
Source Reliability Scoring for Interview Questions

Provides multi-factor scoring to ensure high-quality, accurate interview question data.
Factors: source reputation, recency, cross-source verification, author credibility,
detail level, and engagement metrics.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Set, Tuple, Any
from enum import Enum
import hashlib
import re
from collections import defaultdict


class SourceTier(Enum):
    """Source reputation tiers - higher = more trustworthy"""
    TIER_1 = 5  # LeetCode, official company sources, verified platforms
    TIER_2 = 4  # Glassdoor, Blind (verified), 1Point3Acres
    TIER_3 = 3  # Reddit (high engagement), GeeksforGeeks, CareerCup
    TIER_4 = 2  # Dev.to, HN, YouTube, Telegram channels
    TIER_5 = 1  # Personal blogs, unknown sources, unverified


SOURCE_TIERS: Dict[str, SourceTier] = {
    # Tier 1: Highly trusted, official or verified
    'leetcode': SourceTier.TIER_1,
    'leetcode_discuss': SourceTier.TIER_1,
    'hackerrank': SourceTier.TIER_1,
    'codesignal': SourceTier.TIER_1,
    'levels_fyi': SourceTier.TIER_1,

    # Tier 2: Popular platforms with verification
    'glassdoor': SourceTier.TIER_2,
    'blind': SourceTier.TIER_2,
    '1point3acres': SourceTier.TIER_2,
    'nowcoder': SourceTier.TIER_2,
    'ambitionbox': SourceTier.TIER_2,
    'jobplanet': SourceTier.TIER_2,
    'openwork': SourceTier.TIER_2,

    # Tier 3: Community-driven with moderation
    'reddit': SourceTier.TIER_3,
    'geeksforgeeks': SourceTier.TIER_3,
    'careercup': SourceTier.TIER_3,
    'programmers_kr': SourceTier.TIER_3,
    'studentroom': SourceTier.TIER_3,
    'wikijob': SourceTier.TIER_3,
    'codeforces': SourceTier.TIER_3,

    # Tier 4: Less moderated but useful
    'devto': SourceTier.TIER_4,
    'hackernews': SourceTier.TIER_4,
    'youtube': SourceTier.TIER_4,
    'telegram': SourceTier.TIER_4,
    'discord': SourceTier.TIER_4,
    'zhihu': SourceTier.TIER_4,
    'quora': SourceTier.TIER_4,
    'qiita': SourceTier.TIER_4,
    'habr': SourceTier.TIER_4,
    'medium': SourceTier.TIER_4,

    # Tier 5: Unknown or unverified
    'github': SourceTier.TIER_5,
    'github_gists': SourceTier.TIER_5,
    'pastebin': SourceTier.TIER_5,
    'notion': SourceTier.TIER_5,
    'google_docs': SourceTier.TIER_5,
    'other': SourceTier.TIER_5,
}


@dataclass
class ReliabilityScore:
    """Complete reliability assessment for an interview question"""
    overall_score: float  # 0.0 to 1.0
    source_score: float
    recency_score: float
    verification_score: float
    author_score: float
    detail_score: float
    engagement_score: float
    confidence: float  # How confident we are in this scoring
    flags: List[str] = field(default_factory=list)
    boosters: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'overall': round(self.overall_score, 3),
            'source': round(self.source_score, 3),
            'recency': round(self.recency_score, 3),
            'verification': round(self.verification_score, 3),
            'author': round(self.author_score, 3),
            'detail': round(self.detail_score, 3),
            'engagement': round(self.engagement_score, 3),
            'confidence': round(self.confidence, 3),
            'flags': self.flags,
            'boosters': self.boosters,
        }


class SourceScorer:
    """Scores questions based on source platform reputation"""

    def __init__(self, custom_tiers: Optional[Dict[str, SourceTier]] = None):
        self.tiers = {**SOURCE_TIERS}
        if custom_tiers:
            self.tiers.update(custom_tiers)

    def score(self, source: str, metadata: Optional[Dict] = None) -> Tuple[float, List[str]]:
        """
        Score source reliability (0.0 to 1.0)
        Returns (score, list of notes/flags)
        """
        source_lower = source.lower().replace('-', '_').replace(' ', '_')
        tier = self.tiers.get(source_lower, SourceTier.TIER_5)

        base_score = tier.value / 5.0
        notes = []

        # Apply modifiers based on metadata
        if metadata:
            # Verified source gets a boost
            if metadata.get('verified', False):
                base_score = min(1.0, base_score + 0.1)
                notes.append('verified_source')

            # Official company source gets a boost
            if metadata.get('is_official', False):
                base_score = min(1.0, base_score + 0.15)
                notes.append('official_company_source')

            # Moderated content gets a boost
            if metadata.get('moderated', False):
                base_score = min(1.0, base_score + 0.05)
                notes.append('moderated_content')

            # Paywall sources tend to have higher quality
            if metadata.get('paywall', False):
                base_score = min(1.0, base_score + 0.05)
                notes.append('premium_source')

        return (base_score, notes)

    def get_tier(self, source: str) -> SourceTier:
        """Get the tier for a source"""
        source_lower = source.lower().replace('-', '_').replace(' ', '_')
        return self.tiers.get(source_lower, SourceTier.TIER_5)


class RecencyWeight:
    """Weighs questions by how recent they are"""

    def __init__(
        self,
        max_age_months: int = 12,
        optimal_age_months: int = 3,
        decay_type: str = 'exponential'
    ):
        self.max_age_months = max_age_months
        self.optimal_age_months = optimal_age_months
        self.decay_type = decay_type

    def score(
        self,
        interview_date: Optional[datetime],
        posted_date: Optional[datetime],
        reference_date: Optional[datetime] = None
    ) -> Tuple[float, List[str]]:
        """
        Score based on recency (0.0 to 1.0)
        Prefers recent interview dates, falls back to posted date
        """
        ref = reference_date or datetime.now()
        notes = []

        # Prefer interview date over posted date
        target_date = interview_date or posted_date

        if not target_date:
            return (0.3, ['no_date_available'])

        if interview_date:
            notes.append('has_interview_date')
        else:
            notes.append('using_posted_date')

        age_days = (ref - target_date).days

        if age_days < 0:
            return (0.5, notes + ['future_date_suspicious'])

        age_months = age_days / 30.0

        # Very recent (within optimal window) gets full score
        if age_months <= self.optimal_age_months:
            score = 1.0
            notes.append('recent_interview')
        elif age_months > self.max_age_months:
            score = 0.2  # Old but not worthless
            notes.append('old_interview')
        else:
            # Decay between optimal and max
            if self.decay_type == 'exponential':
                decay_range = self.max_age_months - self.optimal_age_months
                position = (age_months - self.optimal_age_months) / decay_range
                score = 0.2 + 0.8 * (1 - position ** 2)
            else:  # Linear decay
                decay_range = self.max_age_months - self.optimal_age_months
                position = (age_months - self.optimal_age_months) / decay_range
                score = 0.2 + 0.8 * (1 - position)

        return (score, notes)


class CrossSourceVerifier:
    """
    Verifies questions by checking if they appear in multiple sources.
    Questions confirmed by multiple independent sources are more reliable.
    """

    def __init__(self, similarity_threshold: float = 0.85):
        self.similarity_threshold = similarity_threshold
        self.question_index: Dict[str, List[Dict]] = defaultdict(list)
        self.company_questions: Dict[str, Set[str]] = defaultdict(set)

    def _normalize_question(self, text: str) -> str:
        """Normalize question text for comparison"""
        text = text.lower()
        text = re.sub(r'[^\w\s]', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        # Remove common filler words
        stopwords = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
                     'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
                     'would', 'could', 'should', 'may', 'might', 'must', 'shall',
                     'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
                     'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
                     'through', 'during', 'before', 'after', 'above', 'below',
                     'between', 'under', 'again', 'further', 'then', 'once'}
        words = [w for w in text.split() if w not in stopwords]
        return ' '.join(words)

    def _hash_question(self, text: str) -> str:
        """Create a hash for the normalized question"""
        normalized = self._normalize_question(text)
        return hashlib.md5(normalized.encode()).hexdigest()[:12]

    def _compute_similarity(self, text1: str, text2: str) -> float:
        """Compute Jaccard similarity between two normalized texts"""
        words1 = set(self._normalize_question(text1).split())
        words2 = set(self._normalize_question(text2).split())

        if not words1 or not words2:
            return 0.0

        intersection = len(words1 & words2)
        union = len(words1 | words2)
        return intersection / union if union > 0 else 0.0

    def add_question(
        self,
        question_text: str,
        company: str,
        source: str,
        metadata: Optional[Dict] = None
    ):
        """Add a question to the index for cross-verification"""
        q_hash = self._hash_question(question_text)
        company_norm = company.lower().strip()

        entry = {
            'text': question_text,
            'company': company_norm,
            'source': source,
            'hash': q_hash,
            'metadata': metadata or {},
            'added_at': datetime.now(),
        }

        self.question_index[q_hash].append(entry)
        self.company_questions[company_norm].add(q_hash)

    def verify(
        self,
        question_text: str,
        company: str,
        source: str
    ) -> Tuple[float, List[str], List[Dict]]:
        """
        Verify a question against the index.
        Returns (score, notes, matching_sources)
        """
        q_hash = self._hash_question(question_text)
        company_norm = company.lower().strip()
        notes = []
        matching_sources = []

        # Check for exact hash match
        if q_hash in self.question_index:
            matches = self.question_index[q_hash]
            # Filter to different sources
            other_sources = [m for m in matches if m['source'] != source]

            if other_sources:
                unique_sources = set(m['source'] for m in other_sources)
                matching_sources = other_sources

                if len(unique_sources) >= 3:
                    notes.append('verified_3plus_sources')
                    return (1.0, notes, matching_sources)
                elif len(unique_sources) >= 2:
                    notes.append('verified_2_sources')
                    return (0.9, notes, matching_sources)
                else:
                    notes.append('verified_1_other_source')
                    return (0.8, notes, matching_sources)

        # Check for similar questions in same company
        company_hashes = self.company_questions.get(company_norm, set())
        for other_hash in company_hashes:
            if other_hash == q_hash:
                continue

            for entry in self.question_index.get(other_hash, []):
                similarity = self._compute_similarity(question_text, entry['text'])
                if similarity >= self.similarity_threshold:
                    if entry['source'] != source:
                        matching_sources.append(entry)

        if matching_sources:
            unique_sources = set(m['source'] for m in matching_sources)
            if len(unique_sources) >= 2:
                notes.append('similar_multiple_sources')
                return (0.75, notes, matching_sources)
            else:
                notes.append('similar_one_other_source')
                return (0.65, notes, matching_sources)

        # No verification found
        notes.append('unverified')
        return (0.5, notes, [])

    def get_verification_stats(self) -> Dict[str, Any]:
        """Get statistics about the verification index"""
        total_questions = sum(len(v) for v in self.question_index.values())
        unique_hashes = len(self.question_index)
        multi_source = sum(1 for v in self.question_index.values() if len(set(e['source'] for e in v)) > 1)

        return {
            'total_questions': total_questions,
            'unique_questions': unique_hashes,
            'multi_source_verified': multi_source,
            'verification_rate': multi_source / unique_hashes if unique_hashes > 0 else 0,
            'companies_tracked': len(self.company_questions),
        }


class AuthorCredibilityChecker:
    """
    Evaluates author/poster credibility based on:
    - Verified employee status
    - Account age
    - Post history quality
    - Company affiliation
    """

    # Keywords indicating verified/credible authors
    CREDIBILITY_INDICATORS = {
        'high': [
            'verified', 'employee', 'engineer at', 'swe at', 'works at',
            'interviewer', 'hiring manager', 'recruiter at', 'hr at',
            'senior', 'staff', 'principal', 'lead', 'manager', 'director',
        ],
        'medium': [
            'intern at', 'interned at', 'former', 'ex-', 'previously at',
            'offer from', 'accepted at', 'joining', 'starting at',
        ],
        'low': [
            'applied to', 'interviewing at', 'interview with', 'rejected',
            'student', 'new grad', 'fresh grad', 'bootcamp',
        ],
    }

    def __init__(self):
        self.known_authors: Dict[str, Dict] = {}

    def register_author(
        self,
        author_id: str,
        source: str,
        metadata: Optional[Dict] = None
    ):
        """Register an author with their metadata"""
        key = f"{source}:{author_id}"
        if key not in self.known_authors:
            self.known_authors[key] = {
                'id': author_id,
                'source': source,
                'posts': 0,
                'quality_posts': 0,
                'first_seen': datetime.now(),
                'verified': False,
                'company': None,
                'metadata': metadata or {},
            }
        self.known_authors[key]['posts'] += 1

    def score(
        self,
        author_id: Optional[str],
        source: str,
        author_text: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> Tuple[float, List[str]]:
        """
        Score author credibility (0.0 to 1.0)
        """
        notes = []
        meta = metadata or {}

        # No author info = neutral score
        if not author_id and not author_text:
            return (0.5, ['no_author_info'])

        base_score = 0.5

        # Check if we know this author
        if author_id:
            key = f"{source}:{author_id}"
            if key in self.known_authors:
                author_data = self.known_authors[key]

                # Account age boost
                age_days = (datetime.now() - author_data['first_seen']).days
                if age_days > 365:
                    base_score += 0.1
                    notes.append('established_account')
                elif age_days > 90:
                    base_score += 0.05
                    notes.append('active_account')

                # Post history quality
                if author_data['posts'] > 10 and author_data['quality_posts'] > 5:
                    base_score += 0.1
                    notes.append('quality_poster')

                # Verified status
                if author_data['verified']:
                    base_score += 0.2
                    notes.append('verified_author')

        # Check metadata for credibility signals
        if meta.get('verified', False):
            base_score += 0.2
            notes.append('verified_badge')

        if meta.get('company_verified', False):
            base_score += 0.15
            notes.append('company_verified')

        if meta.get('employee_badge', False):
            base_score += 0.1
            notes.append('employee_badge')

        # Parse author text for credibility indicators
        if author_text:
            text_lower = author_text.lower()

            for indicator in self.CREDIBILITY_INDICATORS['high']:
                if indicator in text_lower:
                    base_score += 0.15
                    notes.append(f'high_credibility:{indicator}')
                    break

            for indicator in self.CREDIBILITY_INDICATORS['medium']:
                if indicator in text_lower:
                    base_score += 0.08
                    notes.append(f'medium_credibility:{indicator}')
                    break

        # Check for red flags
        if meta.get('new_account', False):
            base_score -= 0.1
            notes.append('new_account_warning')

        if meta.get('low_karma', False) or meta.get('low_reputation', False):
            base_score -= 0.05
            notes.append('low_reputation')

        return (max(0.0, min(1.0, base_score)), notes)


class EngagementAnalyzer:
    """
    Analyzes engagement metrics to determine question quality.
    Higher engagement often correlates with accuracy/usefulness.
    """

    # Platform-specific engagement thresholds
    THRESHOLDS = {
        'reddit': {'high': 100, 'medium': 25, 'low': 5},
        'leetcode': {'high': 500, 'medium': 100, 'low': 20},
        'blind': {'high': 50, 'medium': 15, 'low': 3},
        'glassdoor': {'high': 20, 'medium': 5, 'low': 1},
        'devto': {'high': 100, 'medium': 30, 'low': 5},
        'youtube': {'high': 10000, 'medium': 1000, 'low': 100},
        'telegram': {'high': 200, 'medium': 50, 'low': 10},
        'default': {'high': 50, 'medium': 15, 'low': 3},
    }

    def __init__(self, custom_thresholds: Optional[Dict] = None):
        self.thresholds = {**self.THRESHOLDS}
        if custom_thresholds:
            self.thresholds.update(custom_thresholds)

    def _get_thresholds(self, source: str) -> Dict[str, int]:
        """Get thresholds for a specific source"""
        source_lower = source.lower()
        return self.thresholds.get(source_lower, self.thresholds['default'])

    def score(
        self,
        source: str,
        upvotes: Optional[int] = None,
        comments: Optional[int] = None,
        views: Optional[int] = None,
        shares: Optional[int] = None,
        helpful_votes: Optional[int] = None,
        metadata: Optional[Dict] = None
    ) -> Tuple[float, List[str]]:
        """
        Score based on engagement metrics (0.0 to 1.0)
        """
        notes = []
        thresholds = self._get_thresholds(source)

        # Calculate primary engagement metric
        primary_engagement = upvotes or helpful_votes or 0

        # Add secondary metrics with lower weight
        if comments:
            primary_engagement += comments * 0.5
        if shares:
            primary_engagement += shares * 2  # Shares are high-value
        if views:
            # Views converted to engagement estimate
            primary_engagement += views * 0.01

        # No engagement data
        if primary_engagement == 0:
            return (0.4, ['no_engagement_data'])

        # Score based on thresholds
        if primary_engagement >= thresholds['high']:
            score = 1.0
            notes.append('high_engagement')
        elif primary_engagement >= thresholds['medium']:
            # Linear interpolation between medium and high
            ratio = (primary_engagement - thresholds['medium']) / (thresholds['high'] - thresholds['medium'])
            score = 0.7 + 0.3 * ratio
            notes.append('medium_engagement')
        elif primary_engagement >= thresholds['low']:
            # Linear interpolation between low and medium
            ratio = (primary_engagement - thresholds['low']) / (thresholds['medium'] - thresholds['low'])
            score = 0.4 + 0.3 * ratio
            notes.append('low_engagement')
        else:
            score = 0.3
            notes.append('minimal_engagement')

        # Bonus for comment engagement (indicates discussion)
        if comments and comments >= 5:
            score = min(1.0, score + 0.05)
            notes.append('active_discussion')

        # Check for viral content (might be noise)
        if primary_engagement > thresholds['high'] * 10:
            notes.append('viral_content_review')

        return (score, notes)


class DetailAnalyzer:
    """
    Analyzes the detail level of interview question reports.
    More detailed reports are generally more reliable.
    """

    DETAIL_PATTERNS = {
        'interview_round': [
            r'phone screen', r'onsite', r'final round', r'coding round',
            r'behavioral round', r'system design round', r'hiring manager',
            r'technical screen', r'hr round', r'team matching',
            r'round [1-5]', r'first round', r'second round', r'final interview',
        ],
        'time_info': [
            r'\d+\s*(min|minute|hour)', r'lasted', r'took about',
            r'spent \d+', r'within \d+', r'time limit',
        ],
        'question_format': [
            r'asked me to', r'given a', r'had to', r'needed to',
            r'implement', r'design', r'explain', r'describe',
            r'write code', r'whiteboard', r'coding challenge',
        ],
        'follow_up': [
            r'follow.?up', r'then asked', r'after that', r'next question',
            r'also asked', r'additionally', r'related question',
        ],
        'outcome': [
            r'got the offer', r'passed', r'failed', r'rejected',
            r'moved forward', r'didn\'t make it', r'accepted',
            r'received offer', r'no offer', r'ghosted',
        ],
        'specific_topic': [
            r'linked list', r'binary tree', r'hash map', r'dynamic programming',
            r'dfs|bfs', r'graph', r'array', r'string', r'recursion',
            r'sql', r'api', r'microservice', r'distributed', r'scalab',
        ],
    }

    def score(
        self,
        question_text: str,
        full_context: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> Tuple[float, List[str]]:
        """
        Score based on detail level (0.0 to 1.0)
        """
        text = (full_context or question_text).lower()
        notes = []

        # Base score from text length
        word_count = len(text.split())
        if word_count < 20:
            base_score = 0.3
            notes.append('very_brief')
        elif word_count < 50:
            base_score = 0.5
            notes.append('brief')
        elif word_count < 150:
            base_score = 0.7
            notes.append('moderate_detail')
        else:
            base_score = 0.85
            notes.append('detailed')

        # Check for detail patterns
        pattern_matches = 0
        for category, patterns in self.DETAIL_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, text):
                    pattern_matches += 1
                    break  # Only count once per category

        # Boost score based on pattern matches
        if pattern_matches >= 5:
            base_score = min(1.0, base_score + 0.15)
            notes.append('comprehensive_detail')
        elif pattern_matches >= 3:
            base_score = min(1.0, base_score + 0.1)
            notes.append('good_detail')
        elif pattern_matches >= 1:
            base_score = min(1.0, base_score + 0.05)
            notes.append('some_detail')

        # Check for actual code snippets
        if re.search(r'```|def |function |class |public |private ', text):
            base_score = min(1.0, base_score + 0.1)
            notes.append('has_code')

        # Check for specific company/role mention
        if metadata:
            if metadata.get('company_mentioned', False):
                base_score = min(1.0, base_score + 0.05)
            if metadata.get('role_mentioned', False):
                base_score = min(1.0, base_score + 0.05)
            if metadata.get('date_mentioned', False):
                base_score = min(1.0, base_score + 0.05)

        return (base_score, notes)


class ReliabilityEngine:
    """
    Main engine that combines all scoring factors into a final reliability score.
    """

    # Weights for each factor (must sum to 1.0)
    DEFAULT_WEIGHTS = {
        'source': 0.20,
        'recency': 0.20,
        'verification': 0.20,
        'author': 0.15,
        'detail': 0.15,
        'engagement': 0.10,
    }

    def __init__(
        self,
        weights: Optional[Dict[str, float]] = None,
        enable_cross_verification: bool = True
    ):
        self.weights = weights or self.DEFAULT_WEIGHTS

        # Initialize components
        self.source_scorer = SourceScorer()
        self.recency_weight = RecencyWeight()
        self.verifier = CrossSourceVerifier() if enable_cross_verification else None
        self.author_checker = AuthorCredibilityChecker()
        self.engagement_analyzer = EngagementAnalyzer()
        self.detail_analyzer = DetailAnalyzer()

    def score(
        self,
        question_text: str,
        company: str,
        source: str,
        interview_date: Optional[datetime] = None,
        posted_date: Optional[datetime] = None,
        author_id: Optional[str] = None,
        author_text: Optional[str] = None,
        upvotes: Optional[int] = None,
        comments: Optional[int] = None,
        views: Optional[int] = None,
        full_context: Optional[str] = None,
        metadata: Optional[Dict] = None,
    ) -> ReliabilityScore:
        """
        Calculate comprehensive reliability score for a question.
        """
        meta = metadata or {}
        all_flags = []
        all_boosters = []

        # 1. Source score
        source_score, source_notes = self.source_scorer.score(source, meta)
        all_flags.extend([n for n in source_notes if 'warning' in n or 'suspicious' in n])
        all_boosters.extend([n for n in source_notes if 'verified' in n or 'official' in n])

        # 2. Recency score
        recency_score, recency_notes = self.recency_weight.score(interview_date, posted_date)
        all_flags.extend([n for n in recency_notes if 'old' in n or 'suspicious' in n])
        all_boosters.extend([n for n in recency_notes if 'recent' in n])

        # 3. Verification score
        if self.verifier:
            verification_score, verify_notes, _ = self.verifier.verify(question_text, company, source)
            all_flags.extend([n for n in verify_notes if 'unverified' in n])
            all_boosters.extend([n for n in verify_notes if 'verified' in n])
        else:
            verification_score = 0.5

        # 4. Author score
        author_score, author_notes = self.author_checker.score(
            author_id, source, author_text, meta
        )
        all_flags.extend([n for n in author_notes if 'warning' in n or 'low' in n])
        all_boosters.extend([n for n in author_notes if 'verified' in n or 'established' in n])

        # 5. Engagement score
        engagement_score, engagement_notes = self.engagement_analyzer.score(
            source, upvotes, comments, views, metadata=meta
        )
        all_flags.extend([n for n in engagement_notes if 'minimal' in n or 'review' in n])
        all_boosters.extend([n for n in engagement_notes if 'high' in n])

        # 6. Detail score
        detail_score, detail_notes = self.detail_analyzer.score(
            question_text, full_context, meta
        )
        all_flags.extend([n for n in detail_notes if 'brief' in n])
        all_boosters.extend([n for n in detail_notes if 'comprehensive' in n or 'detailed' in n])

        # Calculate weighted overall score
        overall = (
            source_score * self.weights['source'] +
            recency_score * self.weights['recency'] +
            verification_score * self.weights['verification'] +
            author_score * self.weights['author'] +
            detail_score * self.weights['detail'] +
            engagement_score * self.weights['engagement']
        )

        # Calculate confidence (higher when more data is available)
        data_points = sum([
            1 if interview_date or posted_date else 0,
            1 if author_id or author_text else 0,
            1 if upvotes or comments or views else 0,
            1 if full_context else 0,
            1 if meta else 0,
        ])
        confidence = 0.5 + (data_points / 5) * 0.5

        return ReliabilityScore(
            overall_score=overall,
            source_score=source_score,
            recency_score=recency_score,
            verification_score=verification_score,
            author_score=author_score,
            detail_score=detail_score,
            engagement_score=engagement_score,
            confidence=confidence,
            flags=list(set(all_flags)),
            boosters=list(set(all_boosters)),
        )

    def add_to_verification_index(
        self,
        question_text: str,
        company: str,
        source: str,
        metadata: Optional[Dict] = None
    ):
        """Add a question to the cross-verification index"""
        if self.verifier:
            self.verifier.add_question(question_text, company, source, metadata)

    def get_verification_stats(self) -> Optional[Dict]:
        """Get cross-verification statistics"""
        if self.verifier:
            return self.verifier.get_verification_stats()
        return None


# Convenience function for quick scoring
def score_question(
    question_text: str,
    company: str,
    source: str,
    **kwargs
) -> ReliabilityScore:
    """Quick function to score a single question"""
    engine = ReliabilityEngine(enable_cross_verification=False)
    return engine.score(question_text, company, source, **kwargs)


# Export all classes
__all__ = [
    'SourceTier',
    'SOURCE_TIERS',
    'ReliabilityScore',
    'SourceScorer',
    'RecencyWeight',
    'CrossSourceVerifier',
    'AuthorCredibilityChecker',
    'EngagementAnalyzer',
    'DetailAnalyzer',
    'ReliabilityEngine',
    'score_question',
]
