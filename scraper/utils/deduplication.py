"""
Advanced Deduplication System for Interview Questions

Provides multi-layer deduplication:
1. Exact hash matching (SHA-256)
2. Fuzzy text matching (Levenshtein, Jaccard, n-gram)
3. Semantic similarity (sentence embeddings)
4. Cross-language deduplication
5. Source priority ranking

Usage:
    deduper = InterviewDeduplicator()
    unique_questions = deduper.deduplicate(questions)
"""

import hashlib
import re
from typing import List, Dict, Set, Tuple, Optional, Any, Callable
from dataclasses import dataclass, field
from collections import defaultdict
from functools import lru_cache
import unicodedata
import math


@dataclass
class InterviewQuestion:
    """Standardized interview question structure."""
    id: Optional[str] = None
    content: str = ""
    company: str = ""
    role: str = ""
    question_type: str = ""  # technical, behavioral, system_design, oa
    difficulty: str = ""  # easy, medium, hard
    source: str = ""
    source_url: str = ""
    language: str = "en"
    is_verified: bool = False
    upvotes: int = 0
    date_posted: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    original_content: str = ""  # For translated content, keep original


# Source reliability rankings (higher = more trusted)
SOURCE_PRIORITY = {
    # Verified/Official sources
    "leetcode_discuss": 95,
    "glassdoor": 90,
    "blind": 88,
    "levels_fyi": 85,

    # Curated platforms
    "geeksforgeeks": 82,
    "takeuforward": 80,
    "codestudio": 78,
    "interviewbit": 76,

    # Community with moderation
    "reddit": 70,
    "stackoverflow": 72,
    "hackernews": 68,

    # Regional platforms (high volume, variable quality)
    "nowcoder": 75,  # Chinese, well-moderated
    "1point3acres": 78,  # Chinese, verified users
    "ambitionbox": 70,  # India
    "jobplanet": 72,  # Korea

    # Social/messaging (less verified)
    "telegram": 50,
    "discord": 48,
    "whatsapp": 45,

    # User submissions (unverified)
    "user_submission": 40,

    # Scraped/aggregated
    "github_gist": 55,
    "pastebin": 35,
    "notion": 45,

    # Default
    "unknown": 30,
}


class TextNormalizer:
    """Normalize text for comparison, handling multiple languages."""

    # Common stop words to remove for comparison
    STOP_WORDS = {
        'en': {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
               'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
               'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
               'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
               'before', 'after', 'above', 'below', 'between', 'under', 'again',
               'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
               'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
               'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
               'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until',
               'while', 'this', 'that', 'these', 'those', 'what', 'which', 'who'},
        'zh': {'的', '是', '在', '有', '和', '与', '了', '不', '也', '就', '都', '而',
               '及', '或', '一个', '这', '那', '这个', '那个', '什么', '怎么', '如何'},
    }

    # Technical term normalization (synonyms -> canonical form)
    TECH_SYNONYMS = {
        # Data structures
        'linkedlist': 'linked_list',
        'linked list': 'linked_list',
        'hashmap': 'hash_map',
        'hash map': 'hash_map',
        'hashtable': 'hash_table',
        'hash table': 'hash_table',
        'bst': 'binary_search_tree',
        'binary search tree': 'binary_search_tree',
        'dll': 'doubly_linked_list',
        'doubly linked list': 'doubly_linked_list',

        # Algorithms
        'bfs': 'breadth_first_search',
        'breadth first search': 'breadth_first_search',
        'dfs': 'depth_first_search',
        'depth first search': 'depth_first_search',
        'dp': 'dynamic_programming',
        'dynamic programming': 'dynamic_programming',
        'two pointer': 'two_pointers',
        'two pointers': 'two_pointers',
        '2 pointer': 'two_pointers',

        # Complexity
        'o(n)': 'linear_time',
        'o(1)': 'constant_time',
        'o(log n)': 'logarithmic_time',
        'o(n^2)': 'quadratic_time',
        'o(n log n)': 'linearithmic_time',

        # Companies
        'fb': 'facebook',
        'meta': 'facebook',
        'msft': 'microsoft',
        'amzn': 'amazon',
        'goog': 'google',
        'aapl': 'apple',
    }

    @classmethod
    def normalize(cls, text: str, language: str = 'en',
                  remove_stopwords: bool = True,
                  normalize_tech_terms: bool = True) -> str:
        """Normalize text for comparison."""
        if not text:
            return ""

        # Unicode normalization
        text = unicodedata.normalize('NFKC', text)

        # Lowercase
        text = text.lower()

        # Remove URLs
        text = re.sub(r'https?://\S+', '', text)

        # Remove code blocks but keep content
        text = re.sub(r'```[\s\S]*?```', ' ', text)
        text = re.sub(r'`[^`]+`', lambda m: m.group(0)[1:-1], text)

        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)

        # Normalize tech terms
        if normalize_tech_terms:
            for term, canonical in cls.TECH_SYNONYMS.items():
                text = re.sub(r'\b' + re.escape(term) + r'\b', canonical, text, flags=re.IGNORECASE)

        # Remove stopwords
        if remove_stopwords:
            stop_words = cls.STOP_WORDS.get(language, cls.STOP_WORDS['en'])
            words = text.split()
            words = [w for w in words if w not in stop_words]
            text = ' '.join(words)

        # Remove punctuation except underscores (for normalized terms)
        text = re.sub(r'[^\w\s_]', '', text)

        # Final whitespace cleanup
        text = text.strip()

        return text

    @classmethod
    def extract_key_phrases(cls, text: str) -> Set[str]:
        """Extract key technical phrases from text."""
        normalized = cls.normalize(text)

        # Extract n-grams (1-3 words)
        words = normalized.split()
        phrases = set()

        for n in range(1, 4):
            for i in range(len(words) - n + 1):
                phrase = '_'.join(words[i:i+n])
                if len(phrase) > 3:  # Skip very short phrases
                    phrases.add(phrase)

        return phrases


class FuzzyMatcher:
    """Fuzzy text matching using multiple algorithms."""

    def __init__(self, threshold: float = 0.85):
        self.threshold = threshold

    @staticmethod
    @lru_cache(maxsize=10000)
    def levenshtein_distance(s1: str, s2: str) -> int:
        """Calculate Levenshtein edit distance between two strings."""
        if len(s1) < len(s2):
            return FuzzyMatcher.levenshtein_distance(s2, s1)

        if len(s2) == 0:
            return len(s1)

        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row

        return previous_row[-1]

    @classmethod
    def levenshtein_similarity(cls, s1: str, s2: str) -> float:
        """Calculate Levenshtein similarity (0-1 scale)."""
        if not s1 or not s2:
            return 0.0

        max_len = max(len(s1), len(s2))
        if max_len == 0:
            return 1.0

        distance = cls.levenshtein_distance(s1, s2)
        return 1.0 - (distance / max_len)

    @staticmethod
    def jaccard_similarity(s1: str, s2: str, n: int = 3) -> float:
        """Calculate Jaccard similarity using n-gram shingling."""
        if not s1 or not s2:
            return 0.0

        # Generate n-grams
        def get_ngrams(s: str, n: int) -> Set[str]:
            s = s.lower()
            return set(s[i:i+n] for i in range(len(s) - n + 1))

        ngrams1 = get_ngrams(s1, n)
        ngrams2 = get_ngrams(s2, n)

        if not ngrams1 or not ngrams2:
            return 0.0

        intersection = len(ngrams1 & ngrams2)
        union = len(ngrams1 | ngrams2)

        return intersection / union if union > 0 else 0.0

    @staticmethod
    def word_overlap_similarity(s1: str, s2: str) -> float:
        """Calculate word-level overlap similarity."""
        words1 = set(s1.lower().split())
        words2 = set(s2.lower().split())

        if not words1 or not words2:
            return 0.0

        intersection = len(words1 & words2)
        min_len = min(len(words1), len(words2))

        return intersection / min_len if min_len > 0 else 0.0

    def combined_similarity(self, s1: str, s2: str) -> float:
        """Calculate combined similarity using multiple metrics."""
        # Normalize texts first
        n1 = TextNormalizer.normalize(s1)
        n2 = TextNormalizer.normalize(s2)

        if not n1 or not n2:
            return 0.0

        # Calculate individual similarities
        levenshtein = self.levenshtein_similarity(n1, n2)
        jaccard = self.jaccard_similarity(n1, n2)
        word_overlap = self.word_overlap_similarity(n1, n2)

        # Weighted combination (Jaccard and word overlap are more robust for longer texts)
        if len(n1) > 100 or len(n2) > 100:
            # For longer texts, rely more on word overlap and Jaccard
            return 0.2 * levenshtein + 0.4 * jaccard + 0.4 * word_overlap
        else:
            # For shorter texts, Levenshtein is more reliable
            return 0.4 * levenshtein + 0.35 * jaccard + 0.25 * word_overlap

    def is_duplicate(self, s1: str, s2: str) -> bool:
        """Check if two strings are duplicates based on threshold."""
        return self.combined_similarity(s1, s2) >= self.threshold

    def find_duplicates(self, texts: List[str]) -> List[Tuple[int, int, float]]:
        """Find all duplicate pairs in a list of texts."""
        duplicates = []
        n = len(texts)

        for i in range(n):
            for j in range(i + 1, n):
                similarity = self.combined_similarity(texts[i], texts[j])
                if similarity >= self.threshold:
                    duplicates.append((i, j, similarity))

        return duplicates


class SemanticDeduplicator:
    """Semantic similarity using lightweight embeddings (no external dependencies)."""

    def __init__(self, threshold: float = 0.80):
        self.threshold = threshold
        self.vocab: Dict[str, int] = {}
        self.idf: Dict[str, float] = {}
        self.doc_count = 0

    def _tokenize(self, text: str) -> List[str]:
        """Simple tokenization."""
        text = TextNormalizer.normalize(text)
        return text.split()

    def _compute_tf(self, tokens: List[str]) -> Dict[str, float]:
        """Compute term frequency."""
        tf = defaultdict(float)
        for token in tokens:
            tf[token] += 1

        # Normalize by document length
        length = len(tokens)
        if length > 0:
            for token in tf:
                tf[token] /= length

        return dict(tf)

    def fit(self, documents: List[str]) -> None:
        """Build vocabulary and IDF from documents."""
        self.doc_count = len(documents)
        doc_freq: Dict[str, int] = defaultdict(int)

        for doc in documents:
            tokens = set(self._tokenize(doc))
            for token in tokens:
                doc_freq[token] += 1
                if token not in self.vocab:
                    self.vocab[token] = len(self.vocab)

        # Compute IDF
        for token, freq in doc_freq.items():
            self.idf[token] = math.log((self.doc_count + 1) / (freq + 1)) + 1

    def _compute_tfidf(self, text: str) -> Dict[str, float]:
        """Compute TF-IDF vector for a document."""
        tokens = self._tokenize(text)
        tf = self._compute_tf(tokens)

        tfidf = {}
        for token, tf_val in tf.items():
            idf_val = self.idf.get(token, math.log(self.doc_count + 1) + 1)
            tfidf[token] = tf_val * idf_val

        return tfidf

    def _cosine_similarity(self, vec1: Dict[str, float], vec2: Dict[str, float]) -> float:
        """Compute cosine similarity between two sparse vectors."""
        # Get common keys
        common_keys = set(vec1.keys()) & set(vec2.keys())

        if not common_keys:
            return 0.0

        # Dot product
        dot_product = sum(vec1[k] * vec2[k] for k in common_keys)

        # Magnitudes
        mag1 = math.sqrt(sum(v ** 2 for v in vec1.values()))
        mag2 = math.sqrt(sum(v ** 2 for v in vec2.values()))

        if mag1 == 0 or mag2 == 0:
            return 0.0

        return dot_product / (mag1 * mag2)

    def similarity(self, text1: str, text2: str) -> float:
        """Compute semantic similarity between two texts."""
        # If vocabulary not built, use simple word overlap
        if not self.vocab:
            # Fall back to enhanced Jaccard
            words1 = set(self._tokenize(text1))
            words2 = set(self._tokenize(text2))

            if not words1 or not words2:
                return 0.0

            intersection = len(words1 & words2)
            union = len(words1 | words2)
            return intersection / union if union > 0 else 0.0

        vec1 = self._compute_tfidf(text1)
        vec2 = self._compute_tfidf(text2)

        return self._cosine_similarity(vec1, vec2)

    def is_duplicate(self, text1: str, text2: str) -> bool:
        """Check if two texts are semantic duplicates."""
        return self.similarity(text1, text2) >= self.threshold


class CrossLanguageDedup:
    """Cross-language deduplication for interview questions."""

    # Common interview question patterns across languages
    PATTERN_TEMPLATES = {
        'reverse_linked_list': {
            'en': r'reverse.*linked\s*list',
            'zh': r'反转.*链表|翻转.*链表',
            'ja': r'リンクリスト.*反転|連結リスト.*逆',
            'ko': r'링크드\s*리스트.*뒤집',
        },
        'two_sum': {
            'en': r'two\s*sum|pair.*sum.*target',
            'zh': r'两数之和|两.*数.*和',
            'ja': r'二つの数.*合計|ツーサム',
            'ko': r'두.*수.*합|투.*섬',
        },
        'binary_search': {
            'en': r'binary\s*search',
            'zh': r'二分.*查找|二分.*搜索',
            'ja': r'二分探索|バイナリ.*サーチ',
            'ko': r'이진.*탐색|바이너리.*서치',
        },
        'tree_traversal': {
            'en': r'(inorder|preorder|postorder|level\s*order).*traversal',
            'zh': r'(中序|前序|后序|层序).*遍历',
            'ja': r'(中間順|前順|後順|レベル順).*走査',
            'ko': r'(중위|전위|후위|레벨).*순회',
        },
        'dynamic_programming': {
            'en': r'dynamic\s*programming|dp\s*(problem|solution)',
            'zh': r'动态规划|DP.*题',
            'ja': r'動的計画法|DP.*問題',
            'ko': r'동적.*프로그래밍|DP.*문제',
        },
        'system_design': {
            'en': r'design.*(system|service|architecture)',
            'zh': r'设计.*(系统|服务|架构)',
            'ja': r'設計.*(システム|サービス|アーキテクチャ)',
            'ko': r'설계.*(시스템|서비스|아키텍처)',
        },
    }

    def __init__(self):
        self._compiled_patterns: Dict[str, Dict[str, re.Pattern]] = {}
        self._compile_patterns()

    def _compile_patterns(self) -> None:
        """Pre-compile regex patterns."""
        for template_name, patterns in self.PATTERN_TEMPLATES.items():
            self._compiled_patterns[template_name] = {}
            for lang, pattern in patterns.items():
                self._compiled_patterns[template_name][lang] = re.compile(
                    pattern, re.IGNORECASE | re.UNICODE
                )

    def detect_language(self, text: str) -> str:
        """Simple language detection based on character ranges."""
        if not text:
            return 'en'

        # Count character types
        cjk_count = 0
        hangul_count = 0
        hiragana_katakana_count = 0
        latin_count = 0

        for char in text:
            code = ord(char)
            if 0x4E00 <= code <= 0x9FFF:  # CJK Unified Ideographs
                cjk_count += 1
            elif 0xAC00 <= code <= 0xD7AF:  # Hangul syllables
                hangul_count += 1
            elif (0x3040 <= code <= 0x309F) or (0x30A0 <= code <= 0x30FF):  # Hiragana/Katakana
                hiragana_katakana_count += 1
            elif code < 128:  # Basic Latin
                latin_count += 1

        total = max(cjk_count + hangul_count + hiragana_katakana_count + latin_count, 1)

        if hangul_count / total > 0.1:
            return 'ko'
        elif hiragana_katakana_count / total > 0.05:
            return 'ja'
        elif cjk_count / total > 0.1:
            return 'zh'
        else:
            return 'en'

    def extract_pattern_signature(self, text: str) -> Set[str]:
        """Extract pattern signatures from text (language-agnostic)."""
        signatures = set()

        # Detect language
        lang = self.detect_language(text)

        # Check against all patterns
        for template_name, lang_patterns in self._compiled_patterns.items():
            # Check the detected language pattern
            if lang in lang_patterns:
                if lang_patterns[lang].search(text):
                    signatures.add(template_name)

            # Also check English patterns (often mixed)
            if 'en' in lang_patterns and lang != 'en':
                if lang_patterns['en'].search(text):
                    signatures.add(template_name)

        return signatures

    def are_cross_language_duplicates(self, text1: str, text2: str) -> bool:
        """Check if two texts are duplicates across languages."""
        lang1 = self.detect_language(text1)
        lang2 = self.detect_language(text2)

        # Same language - defer to other deduplication
        if lang1 == lang2:
            return False  # Let FuzzyMatcher handle same-language

        # Different languages - check pattern signatures
        sig1 = self.extract_pattern_signature(text1)
        sig2 = self.extract_pattern_signature(text2)

        # If both have signatures and they overlap significantly
        if sig1 and sig2:
            overlap = len(sig1 & sig2)
            min_sigs = min(len(sig1), len(sig2))

            # If more than half the signatures match, likely duplicates
            if overlap > 0 and overlap >= min_sigs * 0.5:
                return True

        return False


class SourcePrioritizer:
    """Prioritize and select best source when duplicates found."""

    def __init__(self, custom_priorities: Optional[Dict[str, int]] = None):
        self.priorities = {**SOURCE_PRIORITY}
        if custom_priorities:
            self.priorities.update(custom_priorities)

    def get_priority(self, source: str) -> int:
        """Get priority score for a source."""
        source_lower = source.lower().replace(' ', '_').replace('-', '_')

        # Direct match
        if source_lower in self.priorities:
            return self.priorities[source_lower]

        # Partial match
        for known_source, priority in self.priorities.items():
            if known_source in source_lower or source_lower in known_source:
                return priority

        return self.priorities.get('unknown', 30)

    def compute_quality_score(self, question: InterviewQuestion) -> float:
        """Compute overall quality score for a question."""
        score = 0.0

        # Source priority (0-100, normalized to 0-40)
        source_priority = self.get_priority(question.source)
        score += (source_priority / 100) * 40

        # Verification bonus (0-20)
        if question.is_verified:
            score += 20

        # Upvotes (logarithmic, 0-15)
        if question.upvotes > 0:
            score += min(15, math.log(question.upvotes + 1) * 3)

        # Content quality (0-15)
        content_len = len(question.content)
        if 50 <= content_len <= 500:
            score += 15  # Optimal length
        elif 20 <= content_len < 50 or 500 < content_len <= 1000:
            score += 10
        elif content_len > 1000:
            score += 5  # Very long might be verbose

        # Has company info (0-5)
        if question.company:
            score += 5

        # Has structured fields (0-5)
        if question.question_type:
            score += 2.5
        if question.difficulty:
            score += 2.5

        return score

    def select_best(self, questions: List[InterviewQuestion]) -> InterviewQuestion:
        """Select the best question from a list of duplicates."""
        if not questions:
            raise ValueError("Cannot select from empty list")

        if len(questions) == 1:
            return questions[0]

        # Score each question
        scored = [(q, self.compute_quality_score(q)) for q in questions]
        scored.sort(key=lambda x: x[1], reverse=True)

        return scored[0][0]

    def merge_duplicates(self, questions: List[InterviewQuestion]) -> InterviewQuestion:
        """Merge duplicate questions, keeping best content from each."""
        if not questions:
            raise ValueError("Cannot merge empty list")

        if len(questions) == 1:
            return questions[0]

        # Start with the best quality question
        best = self.select_best(questions)

        # Merge in additional data from others
        all_tags = set(best.tags)
        all_sources = [best.source]
        max_upvotes = best.upvotes

        for q in questions:
            if q is not best:
                all_tags.update(q.tags)
                all_sources.append(q.source)
                max_upvotes = max(max_upvotes, q.upvotes)

                # Take verified status if any source is verified
                if q.is_verified:
                    best.is_verified = True

                # Keep original content if this is a translation
                if q.original_content and not best.original_content:
                    best.original_content = q.original_content

        best.tags = list(all_tags)
        best.upvotes = max_upvotes

        return best


class InterviewDeduplicator:
    """Main deduplication orchestrator combining all methods."""

    def __init__(
        self,
        fuzzy_threshold: float = 0.85,
        semantic_threshold: float = 0.80,
        use_semantic: bool = True,
        use_cross_language: bool = True,
    ):
        self.fuzzy_matcher = FuzzyMatcher(threshold=fuzzy_threshold)
        self.semantic_dedup = SemanticDeduplicator(threshold=semantic_threshold)
        self.cross_lang_dedup = CrossLanguageDedup()
        self.prioritizer = SourcePrioritizer()

        self.use_semantic = use_semantic
        self.use_cross_language = use_cross_language

        # Cache for content hashes
        self._hash_cache: Dict[str, str] = {}
        self._seen_hashes: Set[str] = set()

    def _compute_hash(self, content: str) -> str:
        """Compute content hash with caching."""
        if content in self._hash_cache:
            return self._hash_cache[content]

        normalized = TextNormalizer.normalize(content)
        hash_val = hashlib.sha256(normalized.encode('utf-8')).hexdigest()
        self._hash_cache[content] = hash_val

        return hash_val

    def _is_exact_duplicate(self, content: str) -> bool:
        """Check for exact duplicate using hash."""
        hash_val = self._compute_hash(content)
        return hash_val in self._seen_hashes

    def _mark_seen(self, content: str) -> None:
        """Mark content as seen."""
        hash_val = self._compute_hash(content)
        self._seen_hashes.add(hash_val)

    def _find_duplicate_groups(
        self,
        questions: List[InterviewQuestion]
    ) -> List[List[InterviewQuestion]]:
        """Find groups of duplicate questions."""
        n = len(questions)
        parent = list(range(n))  # Union-Find

        def find(x: int) -> int:
            if parent[x] != x:
                parent[x] = find(parent[x])
            return parent[x]

        def union(x: int, y: int) -> None:
            px, py = find(x), find(y)
            if px != py:
                parent[px] = py

        # Compare all pairs
        for i in range(n):
            for j in range(i + 1, n):
                q1, q2 = questions[i], questions[j]

                # 1. Exact hash match
                if self._compute_hash(q1.content) == self._compute_hash(q2.content):
                    union(i, j)
                    continue

                # 2. Fuzzy match
                if self.fuzzy_matcher.is_duplicate(q1.content, q2.content):
                    union(i, j)
                    continue

                # 3. Semantic match
                if self.use_semantic:
                    if self.semantic_dedup.is_duplicate(q1.content, q2.content):
                        union(i, j)
                        continue

                # 4. Cross-language match
                if self.use_cross_language:
                    if self.cross_lang_dedup.are_cross_language_duplicates(
                        q1.content, q2.content
                    ):
                        union(i, j)
                        continue

        # Build groups
        groups: Dict[int, List[InterviewQuestion]] = defaultdict(list)
        for i in range(n):
            groups[find(i)].append(questions[i])

        return list(groups.values())

    def deduplicate(
        self,
        questions: List[InterviewQuestion],
        merge: bool = True
    ) -> List[InterviewQuestion]:
        """
        Deduplicate a list of interview questions.

        Args:
            questions: List of questions to deduplicate
            merge: If True, merge duplicates; if False, just select best

        Returns:
            Deduplicated list of questions
        """
        if not questions:
            return []

        # Build semantic model if enabled
        if self.use_semantic:
            contents = [q.content for q in questions]
            self.semantic_dedup.fit(contents)

        # Find duplicate groups
        groups = self._find_duplicate_groups(questions)

        # Process each group
        result = []
        for group in groups:
            if len(group) == 1:
                result.append(group[0])
            elif merge:
                merged = self.prioritizer.merge_duplicates(group)
                result.append(merged)
            else:
                best = self.prioritizer.select_best(group)
                result.append(best)

        return result

    def is_new(self, question: InterviewQuestion) -> bool:
        """Check if a question is new (not seen before)."""
        if self._is_exact_duplicate(question.content):
            return False

        self._mark_seen(question.content)
        return True

    def get_stats(self) -> Dict[str, Any]:
        """Get deduplication statistics."""
        return {
            "unique_hashes": len(self._seen_hashes),
            "cache_size": len(self._hash_cache),
        }

    def clear_cache(self) -> None:
        """Clear all caches."""
        self._hash_cache.clear()
        self._seen_hashes.clear()


# Convenience functions for common operations
def deduplicate_questions(
    questions: List[Dict[str, Any]],
    fuzzy_threshold: float = 0.85,
    merge: bool = True
) -> List[Dict[str, Any]]:
    """
    Convenience function to deduplicate question dictionaries.

    Args:
        questions: List of question dicts with 'content' key
        fuzzy_threshold: Similarity threshold (0-1)
        merge: Whether to merge duplicates

    Returns:
        Deduplicated list of question dicts
    """
    # Convert to InterviewQuestion objects
    question_objects = []
    for q in questions:
        question_objects.append(InterviewQuestion(
            id=q.get('id'),
            content=q.get('content', q.get('question', '')),
            company=q.get('company', q.get('company_name', '')),
            role=q.get('role', q.get('position', '')),
            question_type=q.get('question_type', q.get('type', '')),
            difficulty=q.get('difficulty', ''),
            source=q.get('source', q.get('source_name', '')),
            source_url=q.get('source_url', q.get('url', '')),
            language=q.get('language', 'en'),
            is_verified=q.get('is_verified', False),
            upvotes=q.get('upvotes', 0),
            date_posted=q.get('date_posted', q.get('interview_date')),
            tags=q.get('tags', []),
            original_content=q.get('original_content', ''),
        ))

    # Deduplicate
    deduper = InterviewDeduplicator(fuzzy_threshold=fuzzy_threshold)
    unique = deduper.deduplicate(question_objects, merge=merge)

    # Convert back to dicts
    return [
        {
            'id': q.id,
            'content': q.content,
            'company': q.company,
            'role': q.role,
            'question_type': q.question_type,
            'difficulty': q.difficulty,
            'source': q.source,
            'source_url': q.source_url,
            'language': q.language,
            'is_verified': q.is_verified,
            'upvotes': q.upvotes,
            'date_posted': q.date_posted,
            'tags': q.tags,
            'original_content': q.original_content,
        }
        for q in unique
    ]


def quick_dedup(texts: List[str], threshold: float = 0.85) -> List[str]:
    """
    Quick deduplication of text strings.

    Args:
        texts: List of text strings
        threshold: Similarity threshold (0-1)

    Returns:
        Deduplicated list of texts
    """
    if not texts:
        return []

    matcher = FuzzyMatcher(threshold=threshold)
    unique = []

    for text in texts:
        is_duplicate = False
        for existing in unique:
            if matcher.is_duplicate(text, existing):
                is_duplicate = True
                break

        if not is_duplicate:
            unique.append(text)

    return unique
