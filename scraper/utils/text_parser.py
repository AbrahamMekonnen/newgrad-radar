"""
Intelligent content extraction for interview question scraping.

Provides:
- ContentExtractor: Main content detection, boilerplate removal, structured data extraction
- QAPatternDetector: Find question/answer patterns in text
- InterviewQuestionClassifier: Classify question types and difficulty
- CodeBlockExtractor: Extract code snippets with language detection
"""

import re
import json
import html
from typing import Dict, List, Optional, Tuple, Set, Any
from dataclasses import dataclass, field
from enum import Enum
from collections import Counter
import hashlib


class QuestionType(Enum):
    TECHNICAL = "technical"
    BEHAVIORAL = "behavioral"
    SYSTEM_DESIGN = "system_design"
    CODING = "coding"
    OA = "online_assessment"
    BRAIN_TEASER = "brain_teaser"
    SQL = "sql"
    UNKNOWN = "unknown"


class Difficulty(Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    UNKNOWN = "unknown"


@dataclass
class ExtractedContent:
    """Result of content extraction from a page."""
    main_content: str
    title: Optional[str] = None
    author: Optional[str] = None
    date_published: Optional[str] = None
    company: Optional[str] = None
    role: Optional[str] = None
    questions: List['ExtractedQuestion'] = field(default_factory=list)
    code_blocks: List['CodeBlock'] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0


@dataclass
class ExtractedQuestion:
    """A detected interview question."""
    text: str
    question_type: QuestionType
    difficulty: Difficulty
    company: Optional[str] = None
    role: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    answer: Optional[str] = None
    confidence: float = 0.0
    source_context: str = ""


@dataclass
class CodeBlock:
    """An extracted code block."""
    code: str
    language: str
    context: str = ""
    is_solution: bool = False
    line_count: int = 0


@dataclass
class QAPair:
    """A question-answer pair."""
    question: str
    answer: str
    confidence: float = 0.0


class ContentExtractor:
    """
    Intelligent main content extraction using readability algorithms.

    Features:
    - Boilerplate removal (nav, footer, ads, sidebar)
    - Main content detection using text density
    - Structured data extraction (JSON-LD, microdata, OpenGraph)
    - Table parsing for interview data
    """

    # Tags that typically contain boilerplate
    BOILERPLATE_TAGS = {
        'nav', 'header', 'footer', 'aside', 'sidebar', 'menu',
        'advertisement', 'ad', 'banner', 'popup', 'modal',
        'comment', 'comments', 'related', 'share', 'social'
    }

    # CSS classes/IDs that indicate boilerplate
    BOILERPLATE_PATTERNS = [
        r'nav(bar|igation)?', r'menu', r'header', r'footer',
        r'side(bar)?', r'advert(isement)?', r'ad[-_]?', r'banner',
        r'popup', r'modal', r'cookie', r'gdpr', r'newsletter',
        r'comment', r'share', r'social', r'related', r'recommend',
        r'widget', r'breadcrumb', r'pagination'
    ]

    # Content indicators
    CONTENT_PATTERNS = [
        r'article', r'content', r'main', r'post', r'entry',
        r'story', r'body', r'text', r'interview', r'question'
    ]

    def __init__(self):
        self.boilerplate_re = re.compile(
            '|'.join(self.BOILERPLATE_PATTERNS), re.IGNORECASE
        )
        self.content_re = re.compile(
            '|'.join(self.CONTENT_PATTERNS), re.IGNORECASE
        )

    def extract(self, html_content: str, url: str = "") -> ExtractedContent:
        """Extract main content and metadata from HTML."""
        # Decode HTML entities
        text = html.unescape(html_content)

        # Extract structured data first
        metadata = self._extract_structured_data(text)

        # Remove boilerplate
        cleaned = self._remove_boilerplate(text)

        # Extract main content
        main_content = self._extract_main_content(cleaned)

        # Extract title
        title = self._extract_title(text, metadata)

        # Extract author
        author = self._extract_author(text, metadata)

        # Extract date
        date = self._extract_date(text, metadata)

        # Extract company mentions
        company = self._extract_company(main_content)

        # Extract role mentions
        role = self._extract_role(main_content)

        # Calculate confidence based on content quality
        confidence = self._calculate_confidence(main_content)

        return ExtractedContent(
            main_content=main_content,
            title=title,
            author=author,
            date_published=date,
            company=company,
            role=role,
            metadata=metadata,
            confidence=confidence
        )

    def _remove_boilerplate(self, html_text: str) -> str:
        """Remove boilerplate elements from HTML."""
        # Remove script and style tags
        text = re.sub(r'<script[^>]*>.*?</script>', '', html_text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)

        # Remove common boilerplate tags
        for tag in self.BOILERPLATE_TAGS:
            text = re.sub(rf'<{tag}[^>]*>.*?</{tag}>', '', text, flags=re.DOTALL | re.IGNORECASE)

        # Remove elements with boilerplate class/id
        text = re.sub(
            r'<[^>]+(class|id)=["\'][^"\']*(' + '|'.join(self.BOILERPLATE_PATTERNS) + r')[^"\']*["\'][^>]*>.*?</[^>]+>',
            '', text, flags=re.DOTALL | re.IGNORECASE
        )

        return text

    def _extract_main_content(self, html_text: str) -> str:
        """Extract main content using text density analysis."""
        # Try to find content in semantic tags first
        content_tags = ['article', 'main', 'div[class*=content]', 'div[class*=post]']

        # Strip all HTML tags for text extraction
        text = re.sub(r'<[^>]+>', ' ', html_text)

        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        # Split into paragraphs and filter short ones
        paragraphs = [p.strip() for p in re.split(r'\n\n+|\r\n\r\n+', text) if len(p.strip()) > 50]

        # Calculate text density per paragraph
        scored_paragraphs = []
        for p in paragraphs:
            word_count = len(p.split())
            link_density = len(re.findall(r'http[s]?://', p)) / max(word_count, 1)

            # Higher score for longer paragraphs with fewer links
            score = word_count * (1 - link_density * 2)
            if score > 10:  # Minimum threshold
                scored_paragraphs.append((score, p))

        # Sort by score and join top paragraphs
        scored_paragraphs.sort(reverse=True)
        main_content = '\n\n'.join([p for _, p in scored_paragraphs[:20]])

        return main_content

    def _extract_structured_data(self, html_text: str) -> Dict[str, Any]:
        """Extract JSON-LD, microdata, and OpenGraph metadata."""
        metadata = {}

        # Extract JSON-LD
        json_ld_matches = re.findall(
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html_text, flags=re.DOTALL | re.IGNORECASE
        )
        for match in json_ld_matches:
            try:
                data = json.loads(match)
                if isinstance(data, dict):
                    metadata['json_ld'] = data
                elif isinstance(data, list) and data:
                    metadata['json_ld'] = data[0]
            except json.JSONDecodeError:
                pass

        # Extract OpenGraph tags
        og_matches = re.findall(
            r'<meta[^>]+property=["\']og:([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
            html_text, flags=re.IGNORECASE
        )
        if og_matches:
            metadata['opengraph'] = dict(og_matches)

        # Extract Twitter cards
        twitter_matches = re.findall(
            r'<meta[^>]+name=["\']twitter:([^"\']+)["\'][^>]+content=["\']([^"\']*)["\']',
            html_text, flags=re.IGNORECASE
        )
        if twitter_matches:
            metadata['twitter'] = dict(twitter_matches)

        return metadata

    def _extract_title(self, html_text: str, metadata: Dict) -> Optional[str]:
        """Extract page title from various sources."""
        # Try OpenGraph first
        if 'opengraph' in metadata and 'title' in metadata['opengraph']:
            return metadata['opengraph']['title']

        # Try JSON-LD
        if 'json_ld' in metadata:
            ld = metadata['json_ld']
            if isinstance(ld, dict):
                if 'headline' in ld:
                    return ld['headline']
                if 'name' in ld:
                    return ld['name']

        # Try HTML title tag
        title_match = re.search(r'<title[^>]*>([^<]+)</title>', html_text, re.IGNORECASE)
        if title_match:
            return title_match.group(1).strip()

        # Try h1 tag
        h1_match = re.search(r'<h1[^>]*>([^<]+)</h1>', html_text, re.IGNORECASE)
        if h1_match:
            return h1_match.group(1).strip()

        return None

    def _extract_author(self, html_text: str, metadata: Dict) -> Optional[str]:
        """Extract author information."""
        # Try JSON-LD
        if 'json_ld' in metadata:
            ld = metadata['json_ld']
            if isinstance(ld, dict) and 'author' in ld:
                author = ld['author']
                if isinstance(author, dict):
                    return author.get('name')
                return str(author)

        # Try meta author tag
        author_match = re.search(
            r'<meta[^>]+name=["\']author["\'][^>]+content=["\']([^"\']+)["\']',
            html_text, re.IGNORECASE
        )
        if author_match:
            return author_match.group(1)

        return None

    def _extract_date(self, html_text: str, metadata: Dict) -> Optional[str]:
        """Extract publication date."""
        # Try JSON-LD
        if 'json_ld' in metadata:
            ld = metadata['json_ld']
            if isinstance(ld, dict):
                for key in ['datePublished', 'dateCreated', 'dateModified']:
                    if key in ld:
                        return ld[key]

        # Try OpenGraph
        if 'opengraph' in metadata:
            for key in ['article:published_time', 'published_time']:
                if key in metadata['opengraph']:
                    return metadata['opengraph'][key]

        # Try common date patterns in HTML
        date_patterns = [
            r'(\d{4}-\d{2}-\d{2})',  # ISO format
            r'(\d{1,2}/\d{1,2}/\d{4})',  # US format
            r'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})',  # Month Day, Year
        ]

        for pattern in date_patterns:
            match = re.search(pattern, html_text, re.IGNORECASE)
            if match:
                return match.group(1)

        return None

    def _extract_company(self, text: str) -> Optional[str]:
        """Extract company name from content."""
        # Common company names to look for
        companies = {
            'google': ['google', 'alphabet', 'deepmind', 'waymo'],
            'meta': ['meta', 'facebook', 'instagram', 'whatsapp'],
            'amazon': ['amazon', 'aws', 'amzn'],
            'apple': ['apple'],
            'microsoft': ['microsoft', 'msft', 'azure', 'linkedin', 'github'],
            'netflix': ['netflix'],
            'tesla': ['tesla', 'spacex'],
            'uber': ['uber'],
            'stripe': ['stripe'],
            'airbnb': ['airbnb'],
            'bytedance': ['bytedance', 'tiktok'],
        }

        text_lower = text.lower()
        for normalized, aliases in companies.items():
            for alias in aliases:
                if re.search(rf'\b{alias}\b', text_lower):
                    return normalized

        return None

    def _extract_role(self, text: str) -> Optional[str]:
        """Extract job role from content."""
        role_patterns = [
            (r'\b(software\s*engineer|swe)\b', 'software_engineer'),
            (r'\b(data\s*scientist)\b', 'data_scientist'),
            (r'\b(ml\s*engineer|machine\s*learning)\b', 'ml_engineer'),
            (r'\b(product\s*manager|pm)\b', 'product_manager'),
            (r'\b(frontend|front.?end)\b', 'frontend_engineer'),
            (r'\b(backend|back.?end)\b', 'backend_engineer'),
            (r'\b(devops|sre)\b', 'devops_engineer'),
            (r'\b(quant|quantitative)\b', 'quant'),
        ]

        text_lower = text.lower()
        for pattern, role in role_patterns:
            if re.search(pattern, text_lower):
                return role

        return None

    def _calculate_confidence(self, content: str) -> float:
        """Calculate confidence score based on content quality."""
        if not content:
            return 0.0

        word_count = len(content.split())

        # Base score from word count
        if word_count < 50:
            score = 0.2
        elif word_count < 200:
            score = 0.5
        elif word_count < 500:
            score = 0.7
        else:
            score = 0.85

        # Boost for interview-related keywords
        interview_keywords = ['interview', 'question', 'asked', 'answer', 'coding', 'algorithm']
        keyword_count = sum(1 for kw in interview_keywords if kw in content.lower())
        score += min(keyword_count * 0.03, 0.15)

        return min(score, 1.0)

    def extract_tables(self, html_text: str) -> List[List[List[str]]]:
        """Extract tables from HTML as nested lists."""
        tables = []

        table_matches = re.findall(r'<table[^>]*>(.*?)</table>', html_text, flags=re.DOTALL | re.IGNORECASE)

        for table_html in table_matches:
            rows = []
            row_matches = re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, flags=re.DOTALL | re.IGNORECASE)

            for row_html in row_matches:
                cells = []
                cell_matches = re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row_html, flags=re.DOTALL | re.IGNORECASE)

                for cell_html in cell_matches:
                    # Strip HTML tags from cell content
                    cell_text = re.sub(r'<[^>]+>', '', cell_html).strip()
                    cells.append(cell_text)

                if cells:
                    rows.append(cells)

            if rows:
                tables.append(rows)

        return tables


class QAPatternDetector:
    """
    Detect question-answer patterns in unstructured text.

    Patterns detected:
    - Q: ... A: ... format
    - Numbered questions (1. What is...)
    - Bullet point questions
    - Forum-style (Question: / Answer:)
    - Interview transcript patterns
    """

    # Question indicators
    QUESTION_STARTERS = [
        r'^Q[.:]\s*',
        r'^Question[.:]\s*',
        r'^\d+[.)]\s*',
        r'^[-*•]\s*',
        r'^(?:What|How|Why|When|Where|Which|Who|Can|Could|Would|Should|Is|Are|Do|Does|Did|Have|Has|Tell|Describe|Explain|Give|Write|Implement|Design|Build)\b',
    ]

    # Answer indicators
    ANSWER_STARTERS = [
        r'^A[.:]\s*',
        r'^Answer[.:]\s*',
        r'^(?:The answer is|I would|You should|First|To solve|Solution:)',
    ]

    def __init__(self):
        self.question_re = re.compile(
            '(' + '|'.join(self.QUESTION_STARTERS) + ')',
            re.IGNORECASE | re.MULTILINE
        )
        self.answer_re = re.compile(
            '(' + '|'.join(self.ANSWER_STARTERS) + ')',
            re.IGNORECASE | re.MULTILINE
        )

    def detect_qa_pairs(self, text: str) -> List[QAPair]:
        """Detect all Q&A pairs in text."""
        pairs = []

        # Method 1: Explicit Q:/A: format
        pairs.extend(self._detect_explicit_qa(text))

        # Method 2: Question:/Answer: format
        pairs.extend(self._detect_labeled_qa(text))

        # Method 3: Numbered questions with following answers
        pairs.extend(self._detect_numbered_qa(text))

        # Method 4: Interview transcript pattern
        pairs.extend(self._detect_interview_transcript(text))

        # Deduplicate
        seen = set()
        unique_pairs = []
        for pair in pairs:
            key = hashlib.md5(pair.question.encode()).hexdigest()
            if key not in seen:
                seen.add(key)
                unique_pairs.append(pair)

        return unique_pairs

    def _detect_explicit_qa(self, text: str) -> List[QAPair]:
        """Detect Q: ... A: ... format."""
        pairs = []

        # Pattern: Q: question text A: answer text
        pattern = r'Q[.:]\s*(.+?)\s*A[.:]\s*(.+?)(?=Q[.:]|\Z)'
        matches = re.findall(pattern, text, flags=re.DOTALL | re.IGNORECASE)

        for question, answer in matches:
            pairs.append(QAPair(
                question=question.strip(),
                answer=answer.strip(),
                confidence=0.9
            ))

        return pairs

    def _detect_labeled_qa(self, text: str) -> List[QAPair]:
        """Detect Question:/Answer: format."""
        pairs = []

        pattern = r'Question[.:]\s*(.+?)\s*Answer[.:]\s*(.+?)(?=Question[.:]|\Z)'
        matches = re.findall(pattern, text, flags=re.DOTALL | re.IGNORECASE)

        for question, answer in matches:
            pairs.append(QAPair(
                question=question.strip(),
                answer=answer.strip(),
                confidence=0.85
            ))

        return pairs

    def _detect_numbered_qa(self, text: str) -> List[QAPair]:
        """Detect numbered questions with following content."""
        pairs = []

        # Split by numbered items
        pattern = r'(\d+)[.)]\s*(.+?)(?=\d+[.)]|\Z)'
        matches = re.findall(pattern, text, flags=re.DOTALL)

        for num, content in matches:
            # Check if content looks like a question
            lines = content.strip().split('\n')
            if lines:
                question_text = lines[0].strip()
                if self._looks_like_question(question_text):
                    answer_text = '\n'.join(lines[1:]).strip() if len(lines) > 1 else ""
                    pairs.append(QAPair(
                        question=question_text,
                        answer=answer_text,
                        confidence=0.7
                    ))

        return pairs

    def _detect_interview_transcript(self, text: str) -> List[QAPair]:
        """Detect interview transcript patterns (Interviewer:/Candidate:)."""
        pairs = []

        pattern = r'(?:Interviewer|I)[.:]\s*(.+?)\s*(?:Candidate|Me|C)[.:]\s*(.+?)(?=(?:Interviewer|I)[.:]|\Z)'
        matches = re.findall(pattern, text, flags=re.DOTALL | re.IGNORECASE)

        for question, answer in matches:
            if self._looks_like_question(question.strip()):
                pairs.append(QAPair(
                    question=question.strip(),
                    answer=answer.strip(),
                    confidence=0.8
                ))

        return pairs

    def _looks_like_question(self, text: str) -> bool:
        """Check if text looks like a question."""
        if not text:
            return False

        text = text.strip()

        # Ends with question mark
        if text.endswith('?'):
            return True

        # Starts with question word
        question_words = ['what', 'how', 'why', 'when', 'where', 'which', 'who',
                         'can', 'could', 'would', 'should', 'is', 'are', 'do',
                         'does', 'did', 'have', 'has', 'tell', 'describe',
                         'explain', 'give', 'write', 'implement', 'design', 'build']

        first_word = text.split()[0].lower() if text.split() else ""
        return first_word in question_words

    def detect_standalone_questions(self, text: str) -> List[str]:
        """Detect questions without explicit answers."""
        questions = []

        # Split by sentences
        sentences = re.split(r'[.!?]\s+', text)

        for sentence in sentences:
            sentence = sentence.strip()
            if self._looks_like_question(sentence):
                # Clean up the question
                question = re.sub(r'^[-*•\d.)\s]+', '', sentence).strip()
                if len(question) > 10:  # Minimum length
                    questions.append(question + ('?' if not question.endswith('?') else ''))

        return questions


class InterviewQuestionClassifier:
    """
    Classify interview questions by type and difficulty.

    Uses keyword matching, pattern detection, and heuristics
    to categorize questions without requiring ML models.
    """

    # Keywords for each question type
    TYPE_KEYWORDS = {
        QuestionType.TECHNICAL: [
            'implement', 'code', 'function', 'algorithm', 'data structure',
            'complexity', 'time complexity', 'space complexity', 'big o',
            'array', 'string', 'tree', 'graph', 'hash', 'linked list',
            'binary search', 'sort', 'recursion', 'dynamic programming',
        ],
        QuestionType.BEHAVIORAL: [
            'tell me about', 'describe a time', 'give an example',
            'how do you handle', 'what would you do', 'conflict',
            'challenge', 'difficult situation', 'teamwork', 'leadership',
            'failure', 'success', 'strength', 'weakness', 'mistake',
        ],
        QuestionType.SYSTEM_DESIGN: [
            'design', 'architect', 'scale', 'distributed', 'microservice',
            'database', 'cache', 'load balancer', 'api', 'high availability',
            'million users', 'billion', 'throughput', 'latency', 'storage',
        ],
        QuestionType.CODING: [
            'write code', 'implement a function', 'solve this problem',
            'leetcode', 'hackerrank', 'coding challenge', 'whiteboard',
            'given an array', 'given a string', 'given a list',
        ],
        QuestionType.OA: [
            'online assessment', 'oa', 'hackerrank', 'codesignal',
            'codility', 'take-home', 'assignment', 'proctored',
        ],
        QuestionType.BRAIN_TEASER: [
            'puzzle', 'riddle', 'estimate', 'how many', 'fermi',
            'probability', 'expected value', 'dice', 'coins',
        ],
        QuestionType.SQL: [
            'sql', 'query', 'select', 'join', 'aggregate', 'group by',
            'database query', 'write a query', 'table',
        ],
    }

    # Difficulty indicators
    DIFFICULTY_KEYWORDS = {
        Difficulty.EASY: [
            'simple', 'basic', 'easy', 'beginner', 'trivial',
            'straightforward', 'warm-up', 'intro',
        ],
        Difficulty.MEDIUM: [
            'medium', 'moderate', 'intermediate', 'standard',
        ],
        Difficulty.HARD: [
            'hard', 'difficult', 'challenging', 'complex', 'advanced',
            'tricky', 'tough', 'expert', 'senior',
        ],
    }

    # Tags to extract
    TAG_PATTERNS = {
        'array': r'\b(array|arrays|list)\b',
        'string': r'\b(string|strings|char)\b',
        'tree': r'\b(tree|trees|bst|binary tree|trie)\b',
        'graph': r'\b(graph|graphs|dfs|bfs|dijkstra)\b',
        'hash': r'\b(hash|hashmap|hashtable|dictionary)\b',
        'dp': r'\b(dp|dynamic programming|memoization)\b',
        'greedy': r'\b(greedy)\b',
        'sorting': r'\b(sort|sorting)\b',
        'binary_search': r'\b(binary search)\b',
        'linked_list': r'\b(linked list|linkedlist)\b',
        'stack': r'\b(stack)\b',
        'queue': r'\b(queue)\b',
        'heap': r'\b(heap|priority queue)\b',
        'recursion': r'\b(recursion|recursive)\b',
        'backtracking': r'\b(backtrack|backtracking)\b',
        'two_pointer': r'\b(two pointer|sliding window)\b',
        'bit_manipulation': r'\b(bit|bits|bitwise|xor)\b',
        'math': r'\b(math|mathematical|prime|gcd)\b',
        'sql': r'\b(sql|query|join)\b',
        'system_design': r'\b(design|scale|distributed)\b',
        'behavioral': r'\b(behavioral|star|leadership)\b',
    }

    def classify(self, question: str, context: str = "") -> ExtractedQuestion:
        """Classify a question by type, difficulty, and extract tags."""
        full_text = f"{question} {context}".lower()

        # Determine question type
        question_type = self._classify_type(full_text)

        # Determine difficulty
        difficulty = self._classify_difficulty(full_text, question_type)

        # Extract tags
        tags = self._extract_tags(full_text)

        # Calculate confidence
        confidence = self._calculate_confidence(question, question_type, tags)

        return ExtractedQuestion(
            text=question,
            question_type=question_type,
            difficulty=difficulty,
            tags=tags,
            confidence=confidence,
            source_context=context[:200] if context else ""
        )

    def _classify_type(self, text: str) -> QuestionType:
        """Classify question type based on keywords."""
        scores = Counter()

        for qtype, keywords in self.TYPE_KEYWORDS.items():
            for keyword in keywords:
                if keyword in text:
                    scores[qtype] += 1

        if scores:
            return scores.most_common(1)[0][0]

        return QuestionType.UNKNOWN

    def _classify_difficulty(self, text: str, qtype: QuestionType) -> Difficulty:
        """Classify difficulty based on keywords and heuristics."""
        for difficulty, keywords in self.DIFFICULTY_KEYWORDS.items():
            for keyword in keywords:
                if keyword in text:
                    return difficulty

        # Heuristics based on question type
        if qtype == QuestionType.SYSTEM_DESIGN:
            return Difficulty.HARD
        elif qtype == QuestionType.BRAIN_TEASER:
            return Difficulty.MEDIUM
        elif qtype == QuestionType.BEHAVIORAL:
            return Difficulty.MEDIUM

        # Check for complexity indicators
        if 'o(n^2)' in text or 'o(n log n)' in text:
            return Difficulty.MEDIUM
        if 'o(2^n)' in text or 'np-hard' in text or 'np-complete' in text:
            return Difficulty.HARD

        return Difficulty.UNKNOWN

    def _extract_tags(self, text: str) -> List[str]:
        """Extract topic tags from question."""
        tags = []

        for tag, pattern in self.TAG_PATTERNS.items():
            if re.search(pattern, text, re.IGNORECASE):
                tags.append(tag)

        return tags

    def _calculate_confidence(self, question: str, qtype: QuestionType, tags: List[str]) -> float:
        """Calculate confidence score for classification."""
        confidence = 0.5  # Base confidence

        # Boost if we found a specific type
        if qtype != QuestionType.UNKNOWN:
            confidence += 0.2

        # Boost for each tag found
        confidence += min(len(tags) * 0.05, 0.2)

        # Boost if question is well-formed
        if question.strip().endswith('?'):
            confidence += 0.05

        if len(question) > 30:
            confidence += 0.05

        return min(confidence, 1.0)

    def batch_classify(self, questions: List[str], context: str = "") -> List[ExtractedQuestion]:
        """Classify multiple questions."""
        return [self.classify(q, context) for q in questions]


class CodeBlockExtractor:
    """
    Extract code blocks from text with language detection.

    Handles:
    - Markdown code fences (```)
    - HTML pre/code tags
    - Indented code blocks
    - Inline code snippets
    """

    # Language detection patterns
    LANGUAGE_INDICATORS = {
        'python': [
            r'\bdef\s+\w+\s*\(', r'\bclass\s+\w+\s*:', r'\bimport\s+\w+',
            r'\bfrom\s+\w+\s+import', r'print\s*\(', r'self\.',
            r'__init__', r'lambda\s+\w+:', r'\bif\s+__name__\s*==',
        ],
        'javascript': [
            r'\bfunction\s+\w+\s*\(', r'\bconst\s+\w+\s*=', r'\blet\s+\w+\s*=',
            r'\bvar\s+\w+\s*=', r'=>\s*\{', r'console\.log',
            r'\bexport\s+(default|const|function)', r'\bimport\s+.*\s+from',
            r'async\s+function', r'\bawait\s+',
        ],
        'java': [
            r'\bpublic\s+class\s+\w+', r'\bprivate\s+\w+\s+\w+',
            r'\bpublic\s+static\s+void\s+main', r'System\.out\.print',
            r'\bnew\s+\w+\s*\(', r'@Override', r'\binterface\s+\w+',
        ],
        'cpp': [
            r'#include\s*<', r'\bstd::', r'\bvector<', r'\bcout\s*<<',
            r'\bcin\s*>>', r'\bint\s+main\s*\(', r'\busing\s+namespace',
        ],
        'sql': [
            r'\bSELECT\s+', r'\bFROM\s+', r'\bWHERE\s+', r'\bJOIN\s+',
            r'\bGROUP\s+BY\s+', r'\bORDER\s+BY\s+', r'\bINSERT\s+INTO',
            r'\bCREATE\s+TABLE', r'\bALTER\s+TABLE',
        ],
        'go': [
            r'\bfunc\s+\w+\s*\(', r'\bpackage\s+\w+', r'\bimport\s*\(',
            r'\btype\s+\w+\s+struct', r'\bgo\s+\w+\(', r'\bdefer\s+',
        ],
        'rust': [
            r'\bfn\s+\w+\s*\(', r'\blet\s+mut\s+', r'\bimpl\s+\w+',
            r'\bstruct\s+\w+', r'\benum\s+\w+', r'\bpub\s+fn',
        ],
    }

    # Solution indicators
    SOLUTION_INDICATORS = [
        r'\bsolution\b', r'\bsolve\b', r'\banswer\b', r'\bresult\b',
        r'\bapproach\b', r'\balgorithm\b', r'\bimplementation\b',
    ]

    def extract(self, text: str) -> List[CodeBlock]:
        """Extract all code blocks from text."""
        blocks = []

        # Method 1: Markdown code fences
        blocks.extend(self._extract_markdown_fenced(text))

        # Method 2: HTML pre/code tags
        blocks.extend(self._extract_html_code(text))

        # Method 3: Indented blocks (4 spaces or tab)
        blocks.extend(self._extract_indented(text))

        # Deduplicate
        seen = set()
        unique_blocks = []
        for block in blocks:
            key = hashlib.md5(block.code.encode()).hexdigest()
            if key not in seen and len(block.code.strip()) > 10:
                seen.add(key)
                unique_blocks.append(block)

        return unique_blocks

    def _extract_markdown_fenced(self, text: str) -> List[CodeBlock]:
        """Extract markdown code fences (``` ... ```)."""
        blocks = []

        # Pattern: ```language\ncode\n```
        pattern = r'```(\w*)\n(.*?)```'
        matches = re.findall(pattern, text, flags=re.DOTALL)

        for lang_hint, code in matches:
            language = lang_hint.lower() if lang_hint else self._detect_language(code)
            context = self._get_context(text, code)

            blocks.append(CodeBlock(
                code=code.strip(),
                language=language,
                context=context,
                is_solution=self._is_solution(context),
                line_count=len(code.strip().split('\n'))
            ))

        return blocks

    def _extract_html_code(self, text: str) -> List[CodeBlock]:
        """Extract HTML pre/code tags."""
        blocks = []

        # Pattern: <pre><code>...</code></pre> or <pre>...</pre>
        patterns = [
            r'<pre[^>]*><code[^>]*(?:class=["\']([^"\']*)["\'])?[^>]*>(.*?)</code></pre>',
            r'<pre[^>]*(?:class=["\']([^"\']*)["\'])?[^>]*>(.*?)</pre>',
            r'<code[^>]*(?:class=["\']([^"\']*)["\'])?[^>]*>(.*?)</code>',
        ]

        for pattern in patterns:
            matches = re.findall(pattern, text, flags=re.DOTALL | re.IGNORECASE)

            for match in matches:
                class_attr = match[0] if match[0] else ""
                code = match[1] if len(match) > 1 else match[0]

                # Strip HTML tags from code
                code = re.sub(r'<[^>]+>', '', code)
                code = html.unescape(code)

                # Try to get language from class
                language = ""
                lang_match = re.search(r'language-(\w+)|lang-(\w+)', class_attr)
                if lang_match:
                    language = lang_match.group(1) or lang_match.group(2)
                else:
                    language = self._detect_language(code)

                context = self._get_context(text, code)

                if len(code.strip()) > 10:  # Minimum length
                    blocks.append(CodeBlock(
                        code=code.strip(),
                        language=language,
                        context=context,
                        is_solution=self._is_solution(context),
                        line_count=len(code.strip().split('\n'))
                    ))

        return blocks

    def _extract_indented(self, text: str) -> List[CodeBlock]:
        """Extract indented code blocks (4 spaces or tab)."""
        blocks = []
        lines = text.split('\n')

        current_block = []
        in_block = False

        for line in lines:
            # Check if line is indented (4 spaces or tab)
            is_indented = line.startswith('    ') or line.startswith('\t')
            is_empty = not line.strip()

            if is_indented:
                # Remove leading indentation
                code_line = line[4:] if line.startswith('    ') else line[1:]
                current_block.append(code_line)
                in_block = True
            elif is_empty and in_block:
                # Allow empty lines within code block
                current_block.append('')
            elif in_block:
                # End of block
                code = '\n'.join(current_block).strip()
                if len(code) > 20 and self._looks_like_code(code):
                    blocks.append(CodeBlock(
                        code=code,
                        language=self._detect_language(code),
                        context="",
                        is_solution=False,
                        line_count=len(code.split('\n'))
                    ))
                current_block = []
                in_block = False

        # Don't forget the last block
        if current_block:
            code = '\n'.join(current_block).strip()
            if len(code) > 20 and self._looks_like_code(code):
                blocks.append(CodeBlock(
                    code=code,
                    language=self._detect_language(code),
                    context="",
                    is_solution=False,
                    line_count=len(code.split('\n'))
                ))

        return blocks

    def _detect_language(self, code: str) -> str:
        """Detect programming language from code patterns."""
        scores = Counter()

        for language, patterns in self.LANGUAGE_INDICATORS.items():
            for pattern in patterns:
                if re.search(pattern, code, re.IGNORECASE):
                    scores[language] += 1

        if scores:
            return scores.most_common(1)[0][0]

        return "unknown"

    def _looks_like_code(self, text: str) -> bool:
        """Check if text looks like code."""
        indicators = [
            r'[{}\[\]();]',  # Brackets and semicolons
            r'\b(if|for|while|return|def|function|class)\b',  # Keywords
            r'[a-z_]\w*\s*\(',  # Function calls
            r'=\s*["\'\d\[\{]',  # Assignments
        ]

        for pattern in indicators:
            if re.search(pattern, text):
                return True

        return False

    def _get_context(self, full_text: str, code: str) -> str:
        """Get surrounding context for a code block."""
        # Find position of code in text
        pos = full_text.find(code[:50])  # Use first 50 chars to find
        if pos == -1:
            return ""

        # Get 200 chars before code
        start = max(0, pos - 200)
        context = full_text[start:pos].strip()

        # Clean up context
        context = re.sub(r'\s+', ' ', context)

        return context[-200:]  # Last 200 chars

    def _is_solution(self, context: str) -> bool:
        """Check if code block is a solution."""
        context_lower = context.lower()

        for pattern in self.SOLUTION_INDICATORS:
            if re.search(pattern, context_lower):
                return True

        return False


# Convenience functions for quick extraction

def extract_interview_questions(text: str) -> List[ExtractedQuestion]:
    """Extract and classify all interview questions from text."""
    qa_detector = QAPatternDetector()
    classifier = InterviewQuestionClassifier()

    questions = []

    # Get Q&A pairs
    qa_pairs = qa_detector.detect_qa_pairs(text)
    for pair in qa_pairs:
        eq = classifier.classify(pair.question, pair.answer)
        eq.answer = pair.answer
        questions.append(eq)

    # Get standalone questions
    standalone = qa_detector.detect_standalone_questions(text)
    for q in standalone:
        # Check if we already have this question
        if not any(eq.text.lower() == q.lower() for eq in questions):
            questions.append(classifier.classify(q, ""))

    return questions


def extract_all_content(html: str, url: str = "") -> ExtractedContent:
    """Extract all content, questions, and code from HTML."""
    extractor = ContentExtractor()
    qa_detector = QAPatternDetector()
    classifier = InterviewQuestionClassifier()
    code_extractor = CodeBlockExtractor()

    # Extract main content
    content = extractor.extract(html, url)

    # Extract questions from main content
    questions = []
    qa_pairs = qa_detector.detect_qa_pairs(content.main_content)
    for pair in qa_pairs:
        eq = classifier.classify(pair.question, pair.answer)
        eq.answer = pair.answer
        eq.company = content.company
        eq.role = content.role
        questions.append(eq)

    standalone = qa_detector.detect_standalone_questions(content.main_content)
    for q in standalone:
        if not any(eq.text.lower() == q.lower() for eq in questions):
            eq = classifier.classify(q, "")
            eq.company = content.company
            eq.role = content.role
            questions.append(eq)

    content.questions = questions

    # Extract code blocks
    content.code_blocks = code_extractor.extract(html)

    return content


# ============================================================================
# ROBUST COMPANY DETECTION SYSTEM
# ============================================================================
# Includes: CompanyAliasResolver, SubsidiaryMapper, InternationalCompanyNER,
# FuzzyCompanyMatcher, ticker/domain detection

from difflib import SequenceMatcher

@dataclass
class CompanyMatch:
    """Result of company detection."""
    name: str
    normalized: str
    confidence: float
    aliases: List[str]
    parent_company: Optional[str] = None
    is_subsidiary: bool = False
    ticker: Optional[str] = None
    domain: Optional[str] = None


# Comprehensive company database with aliases, subsidiaries, international names
COMPANY_DATABASE: Dict[str, Dict] = {
    # FAANG / Big Tech
    'google': {
        'aliases': ['google', 'alphabet', 'googl', 'goog', 'gugl', 'gogle', 'goolge'],
        'subsidiaries': ['deepmind', 'waymo', 'youtube', 'fitbit', 'nest', 'waze', 'verily', 'calico', 'x development', 'wing', 'google cloud', 'gcp'],
        'international': {'谷歌': 'zh', '구글': 'ko', 'グーグル': 'ja', 'Гугл': 'ru', 'جوجل': 'ar'},
        'ticker': 'GOOGL', 'domain': 'google.com',
    },
    'meta': {
        'aliases': ['meta', 'facebook', 'fb', 'meta platforms', 'fbook'],
        'subsidiaries': ['instagram', 'whatsapp', 'oculus', 'reality labs', 'messenger', 'threads'],
        'international': {'脸书': 'zh', '메타': 'ko', 'フェイスブック': 'ja', 'Фейсбук': 'ru'},
        'ticker': 'META', 'domain': 'meta.com',
    },
    'amazon': {
        'aliases': ['amazon', 'amzn', 'amazn', 'a]mazon', 'amazonn'],
        'subsidiaries': ['aws', 'amazon web services', 'twitch', 'whole foods', 'ring', 'audible', 'imdb', 'goodreads', 'zappos', 'mgm', 'prime video', 'alexa', 'kindle', 'amazon robotics', 'amazon lab126'],
        'international': {'亚马逊': 'zh', '아마존': 'ko', 'アマゾン': 'ja', 'Амазон': 'ru'},
        'ticker': 'AMZN', 'domain': 'amazon.com',
    },
    'apple': {
        'aliases': ['apple', 'aapl', 'appl'],
        'subsidiaries': ['beats', 'shazam', 'apple music', 'apple tv', 'apple pay'],
        'international': {'苹果': 'zh', '애플': 'ko', 'アップル': 'ja', 'Эппл': 'ru'},
        'ticker': 'AAPL', 'domain': 'apple.com',
    },
    'microsoft': {
        'aliases': ['microsoft', 'msft', 'ms', 'microsfot', 'mircosoft'],
        'subsidiaries': ['azure', 'linkedin', 'github', 'xbox', 'bing', 'office 365', 'teams', 'activision', 'blizzard', 'nuance', 'openai'],
        'international': {'微软': 'zh', '마이크로소프트': 'ko', 'マイクロソフト': 'ja', 'Майкрософт': 'ru'},
        'ticker': 'MSFT', 'domain': 'microsoft.com',
    },
    'netflix': {
        'aliases': ['netflix', 'nflx', 'netfix'],
        'subsidiaries': [],
        'international': {'网飞': 'zh', '넷플릭스': 'ko', 'ネットフリックス': 'ja'},
        'ticker': 'NFLX', 'domain': 'netflix.com',
    },
    # Unicorns / Tech
    'uber': {
        'aliases': ['uber', 'ubr'],
        'subsidiaries': ['uber eats', 'uber freight', 'postmates'],
        'international': {'优步': 'zh', '우버': 'ko', 'ウーバー': 'ja'},
        'ticker': 'UBER', 'domain': 'uber.com',
    },
    'airbnb': {
        'aliases': ['airbnb', 'abnb', 'air bnb'],
        'subsidiaries': [],
        'international': {'爱彼迎': 'zh', '에어비앤비': 'ko'},
        'ticker': 'ABNB', 'domain': 'airbnb.com',
    },
    'stripe': {
        'aliases': ['stripe'],
        'subsidiaries': ['stripe atlas', 'stripe connect'],
        'international': {},
        'ticker': None, 'domain': 'stripe.com',
    },
    'coinbase': {
        'aliases': ['coinbase', 'coin'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'COIN', 'domain': 'coinbase.com',
    },
    'doordash': {
        'aliases': ['doordash', 'door dash', 'dash'],
        'subsidiaries': ['caviar', 'wolt'],
        'international': {},
        'ticker': 'DASH', 'domain': 'doordash.com',
    },
    'snap': {
        'aliases': ['snap', 'snapchat', 'snap inc'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'SNAP', 'domain': 'snap.com',
    },
    'twitter': {
        'aliases': ['twitter', 'x corp', 'x.com', 'x'],
        'subsidiaries': [],
        'international': {'推特': 'zh', '트위터': 'ko', 'ツイッター': 'ja'},
        'ticker': None, 'domain': 'x.com',
    },
    'salesforce': {
        'aliases': ['salesforce', 'sfdc', 'crm'],
        'subsidiaries': ['slack', 'tableau', 'mulesoft', 'heroku'],
        'international': {},
        'ticker': 'CRM', 'domain': 'salesforce.com',
    },
    'nvidia': {
        'aliases': ['nvidia', 'nvda', 'nvdia'],
        'subsidiaries': ['mellanox'],
        'international': {'英伟达': 'zh', '엔비디아': 'ko', 'エヌビディア': 'ja'},
        'ticker': 'NVDA', 'domain': 'nvidia.com',
    },
    'databricks': {
        'aliases': ['databricks'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'databricks.com',
    },
    'snowflake': {
        'aliases': ['snowflake', 'snow'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'SNOW', 'domain': 'snowflake.com',
    },
    'shopify': {
        'aliases': ['shopify', 'shop'],
        'subsidiaries': ['deliverr'],
        'international': {},
        'ticker': 'SHOP', 'domain': 'shopify.com',
    },
    'square': {
        'aliases': ['square', 'block', 'sq'],
        'subsidiaries': ['cash app', 'tidal', 'afterpay'],
        'international': {},
        'ticker': 'SQ', 'domain': 'block.xyz',
    },
    'dropbox': {
        'aliases': ['dropbox', 'dbx'],
        'subsidiaries': ['docusend', 'hellosign'],
        'international': {},
        'ticker': 'DBX', 'domain': 'dropbox.com',
    },
    'zoom': {
        'aliases': ['zoom', 'zm', 'zoom video'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'ZM', 'domain': 'zoom.us',
    },
    'reddit': {
        'aliases': ['reddit', 'rddt'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'RDDT', 'domain': 'reddit.com',
    },
    'discord': {
        'aliases': ['discord'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'discord.com',
    },
    'spotify': {
        'aliases': ['spotify', 'spot'],
        'subsidiaries': ['anchor', 'gimlet'],
        'international': {},
        'ticker': 'SPOT', 'domain': 'spotify.com',
    },
    'plaid': {
        'aliases': ['plaid'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'plaid.com',
    },
    'roblox': {
        'aliases': ['roblox', 'rblx'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'RBLX', 'domain': 'roblox.com',
    },
    'instacart': {
        'aliases': ['instacart', 'cart'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'CART', 'domain': 'instacart.com',
    },
    'figma': {
        'aliases': ['figma'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'figma.com',
    },
    'notion': {
        'aliases': ['notion'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'notion.so',
    },
    'datadog': {
        'aliases': ['datadog', 'ddog'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'DDOG', 'domain': 'datadoghq.com',
    },
    'cloudflare': {
        'aliases': ['cloudflare', 'net'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'NET', 'domain': 'cloudflare.com',
    },
    # Chinese Tech Giants
    'bytedance': {
        'aliases': ['bytedance', 'byte dance'],
        'subsidiaries': ['tiktok', 'douyin', 'toutiao', 'lark', 'feishu', 'pico'],
        'international': {'字节跳动': 'zh', '바이트댄스': 'ko', 'バイトダンス': 'ja'},
        'ticker': None, 'domain': 'bytedance.com',
    },
    'alibaba': {
        'aliases': ['alibaba', 'baba', 'ali'],
        'subsidiaries': ['aliyun', 'alibaba cloud', 'taobao', 'tmall', 'lazada', 'ele.me', 'ant group', 'alipay', 'cainiao', 'youku'],
        'international': {'阿里巴巴': 'zh', '알리바바': 'ko', 'アリババ': 'ja'},
        'ticker': 'BABA', 'domain': 'alibaba.com',
    },
    'tencent': {
        'aliases': ['tencent', 'tecent'],
        'subsidiaries': ['wechat', 'weixin', 'qq', 'tencent cloud', 'tencent games', 'riot games', 'epic games'],
        'international': {'腾讯': 'zh', '텐센트': 'ko', 'テンセント': 'ja'},
        'ticker': '0700.HK', 'domain': 'tencent.com',
    },
    'baidu': {
        'aliases': ['baidu'],
        'subsidiaries': ['apollo', 'iqiyi'],
        'international': {'百度': 'zh', '바이두': 'ko', 'バイドゥ': 'ja'},
        'ticker': 'BIDU', 'domain': 'baidu.com',
    },
    'meituan': {
        'aliases': ['meituan', 'mei tuan'],
        'subsidiaries': ['meituan dianping'],
        'international': {'美团': 'zh'},
        'ticker': '3690.HK', 'domain': 'meituan.com',
    },
    'xiaomi': {
        'aliases': ['xiaomi', 'mi'],
        'subsidiaries': [],
        'international': {'小米': 'zh', '샤오미': 'ko', 'シャオミ': 'ja'},
        'ticker': '1810.HK', 'domain': 'xiaomi.com',
    },
    'pinduoduo': {
        'aliases': ['pinduoduo', 'pdd', 'temu'],
        'subsidiaries': ['temu'],
        'international': {'拼多多': 'zh'},
        'ticker': 'PDD', 'domain': 'pinduoduo.com',
    },
    'didi': {
        'aliases': ['didi', 'didi chuxing'],
        'subsidiaries': [],
        'international': {'滴滴': 'zh', '디디추싱': 'ko'},
        'ticker': 'DIDI', 'domain': 'didiglobal.com',
    },
    'huawei': {
        'aliases': ['huawei'],
        'subsidiaries': ['honor'],
        'international': {'华为': 'zh', '화웨이': 'ko', 'ファーウェイ': 'ja'},
        'ticker': None, 'domain': 'huawei.com',
    },
    # Korean Tech
    'samsung': {
        'aliases': ['samsung', 'ssnlf'],
        'subsidiaries': ['samsung electronics', 'samsung sds'],
        'international': {'삼성': 'ko', '三星': 'zh', 'サムスン': 'ja'},
        'ticker': '005930.KS', 'domain': 'samsung.com',
    },
    'naver': {
        'aliases': ['naver'],
        'subsidiaries': ['line', 'snow', 'webtoon', 'naver z'],
        'international': {'네이버': 'ko'},
        'ticker': '035420.KS', 'domain': 'naver.com',
    },
    'kakao': {
        'aliases': ['kakao', 'kakao corp'],
        'subsidiaries': ['kakaotalk', 'kakao pay', 'kakao bank', 'kakao games'],
        'international': {'카카오': 'ko'},
        'ticker': '035720.KS', 'domain': 'kakaocorp.com',
    },
    'coupang': {
        'aliases': ['coupang', 'cpng'],
        'subsidiaries': ['coupang play', 'coupang eats'],
        'international': {'쿠팡': 'ko'},
        'ticker': 'CPNG', 'domain': 'coupang.com',
    },
    # Japanese Tech
    'rakuten': {
        'aliases': ['rakuten'],
        'subsidiaries': ['rakuten mobile', 'viber'],
        'international': {'楽天': 'ja'},
        'ticker': '4755.T', 'domain': 'rakuten.co.jp',
    },
    'mercari': {
        'aliases': ['mercari'],
        'subsidiaries': ['merpay'],
        'international': {'メルカリ': 'ja'},
        'ticker': '4385.T', 'domain': 'mercari.com',
    },
    'sony': {
        'aliases': ['sony', 'sne'],
        'subsidiaries': ['playstation', 'sony music', 'sony pictures'],
        'international': {'索尼': 'zh', '소니': 'ko', 'ソニー': 'ja'},
        'ticker': 'SONY', 'domain': 'sony.com',
    },
    # Quant / Finance
    'jane_street': {
        'aliases': ['jane street', 'janestreet', 'js capital', 'jane st'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'janestreet.com',
    },
    'citadel': {
        'aliases': ['citadel', 'citadel securities', 'citadel llc'],
        'subsidiaries': ['citadel securities'],
        'international': {},
        'ticker': None, 'domain': 'citadel.com',
    },
    'two_sigma': {
        'aliases': ['two sigma', 'twosigma', '2sigma', '2 sigma'],
        'subsidiaries': ['two sigma investments', 'two sigma securities'],
        'international': {},
        'ticker': None, 'domain': 'twosigma.com',
    },
    'de_shaw': {
        'aliases': ['d.e. shaw', 'de shaw', 'deshaw', 'd e shaw'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'deshaw.com',
    },
    'hrt': {
        'aliases': ['hudson river trading', 'hrt'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'hudsonrivertrading.com',
    },
    'jump_trading': {
        'aliases': ['jump trading', 'jump', 'jump crypto'],
        'subsidiaries': ['jump crypto'],
        'international': {},
        'ticker': None, 'domain': 'jumptrading.com',
    },
    'optiver': {
        'aliases': ['optiver'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'optiver.com',
    },
    'akuna': {
        'aliases': ['akuna', 'akuna capital'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'akunacapital.com',
    },
    'imc': {
        'aliases': ['imc', 'imc trading'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'imc.com',
    },
    'susquehanna': {
        'aliases': ['susquehanna', 'sig', 'susquehanna international'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'sig.com',
    },
    'drw': {
        'aliases': ['drw', 'drw trading'],
        'subsidiaries': ['cumberland'],
        'international': {},
        'ticker': None, 'domain': 'drw.com',
    },
    'five_rings': {
        'aliases': ['five rings', 'five rings capital', '5 rings'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'fiverings.com',
    },
    # Banks
    'goldman_sachs': {
        'aliases': ['goldman sachs', 'goldman', 'gs'],
        'subsidiaries': ['marcus'],
        'international': {'高盛': 'zh', '골드만삭스': 'ko'},
        'ticker': 'GS', 'domain': 'goldmansachs.com',
    },
    'morgan_stanley': {
        'aliases': ['morgan stanley', 'ms'],
        'subsidiaries': ['e*trade'],
        'international': {'摩根士丹利': 'zh', '모건스탠리': 'ko'},
        'ticker': 'MS', 'domain': 'morganstanley.com',
    },
    'jpmorgan': {
        'aliases': ['jpmorgan', 'jp morgan', 'jpm', 'chase', 'jpmorgan chase'],
        'subsidiaries': ['chase bank'],
        'international': {'摩根大通': 'zh', 'JP모건': 'ko'},
        'ticker': 'JPM', 'domain': 'jpmorgan.com',
    },
    'bloomberg': {
        'aliases': ['bloomberg', 'bberg'],
        'subsidiaries': ['bloomberg lp'],
        'international': {'彭博': 'zh'},
        'ticker': None, 'domain': 'bloomberg.com',
    },
    'capital_one': {
        'aliases': ['capital one', 'cap one', 'c1'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'COF', 'domain': 'capitalone.com',
    },
    # Enterprise / Legacy Tech
    'oracle': {
        'aliases': ['oracle', 'orcl'],
        'subsidiaries': ['netsuite', 'cerner'],
        'international': {'甲骨文': 'zh', '오라클': 'ko'},
        'ticker': 'ORCL', 'domain': 'oracle.com',
    },
    'ibm': {
        'aliases': ['ibm', 'international business machines'],
        'subsidiaries': ['red hat'],
        'international': {},
        'ticker': 'IBM', 'domain': 'ibm.com',
    },
    'intel': {
        'aliases': ['intel', 'intc'],
        'subsidiaries': ['mobileye'],
        'international': {'英特尔': 'zh', '인텔': 'ko'},
        'ticker': 'INTC', 'domain': 'intel.com',
    },
    'amd': {
        'aliases': ['amd', 'advanced micro devices'],
        'subsidiaries': ['xilinx'],
        'international': {},
        'ticker': 'AMD', 'domain': 'amd.com',
    },
    'adobe': {
        'aliases': ['adobe', 'adbe'],
        'subsidiaries': ['figma', 'magento', 'marketo'],
        'international': {},
        'ticker': 'ADBE', 'domain': 'adobe.com',
    },
    'atlassian': {
        'aliases': ['atlassian', 'team'],
        'subsidiaries': ['jira', 'confluence', 'trello', 'bitbucket'],
        'international': {},
        'ticker': 'TEAM', 'domain': 'atlassian.com',
    },
    'cisco': {
        'aliases': ['cisco', 'csco'],
        'subsidiaries': ['webex'],
        'international': {'思科': 'zh'},
        'ticker': 'CSCO', 'domain': 'cisco.com',
    },
    # Defense / Aerospace / EV
    'spacex': {
        'aliases': ['spacex', 'space x'],
        'subsidiaries': ['starlink'],
        'international': {},
        'ticker': None, 'domain': 'spacex.com',
    },
    'tesla': {
        'aliases': ['tesla', 'tsla'],
        'subsidiaries': [],
        'international': {'特斯拉': 'zh', '테슬라': 'ko'},
        'ticker': 'TSLA', 'domain': 'tesla.com',
    },
    'anduril': {
        'aliases': ['anduril', 'anduril industries'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'anduril.com',
    },
    'rivian': {
        'aliases': ['rivian', 'rivn'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'RIVN', 'domain': 'rivian.com',
    },
    'cruise': {
        'aliases': ['cruise', 'cruise automation'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'getcruise.com',
    },
    'waymo': {
        'aliases': ['waymo'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'waymo.com',
    },
    # AI / ML Focused
    'openai': {
        'aliases': ['openai', 'open ai', 'chatgpt'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'openai.com',
    },
    'anthropic': {
        'aliases': ['anthropic', 'claude'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'anthropic.com',
    },
    'scale': {
        'aliases': ['scale ai', 'scale'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'scale.com',
    },
    'hugging_face': {
        'aliases': ['hugging face', 'huggingface', 'hf'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'huggingface.co',
    },
    # Indian Tech
    'flipkart': {
        'aliases': ['flipkart'],
        'subsidiaries': ['myntra', 'phonepe'],
        'international': {},
        'ticker': None, 'domain': 'flipkart.com',
    },
    'razorpay': {
        'aliases': ['razorpay'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'razorpay.com',
    },
    'swiggy': {
        'aliases': ['swiggy'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'swiggy.com',
    },
    'zomato': {
        'aliases': ['zomato'],
        'subsidiaries': ['blinkit'],
        'international': {},
        'ticker': 'ZOMATO.NS', 'domain': 'zomato.com',
    },
    'infosys': {
        'aliases': ['infosys', 'infy'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'INFY', 'domain': 'infosys.com',
    },
    'tcs': {
        'aliases': ['tcs', 'tata consultancy services', 'tata'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'TCS.NS', 'domain': 'tcs.com',
    },
    'wipro': {
        'aliases': ['wipro'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'WIT', 'domain': 'wipro.com',
    },
    # European Tech
    'klarna': {
        'aliases': ['klarna'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'klarna.com',
    },
    'revolut': {
        'aliases': ['revolut'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'revolut.com',
    },
    'deliveroo': {
        'aliases': ['deliveroo'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'ROO.L', 'domain': 'deliveroo.com',
    },
    'n26': {
        'aliases': ['n26'],
        'subsidiaries': [],
        'international': {},
        'ticker': None, 'domain': 'n26.com',
    },
    'zalando': {
        'aliases': ['zalando'],
        'subsidiaries': [],
        'international': {},
        'ticker': 'ZAL.DE', 'domain': 'zalando.com',
    },
}


class CompanyAliasResolver:
    """Resolves company name variations to canonical form."""

    def __init__(self):
        self._alias_to_canonical: Dict[str, str] = {}
        self._build_alias_index()

    def _build_alias_index(self):
        for canonical, data in COMPANY_DATABASE.items():
            for alias in data['aliases']:
                self._alias_to_canonical[alias.lower()] = canonical
            for subsidiary in data.get('subsidiaries', []):
                self._alias_to_canonical[subsidiary.lower()] = canonical
            for intl_name in data.get('international', {}).keys():
                self._alias_to_canonical[intl_name.lower()] = canonical

    def resolve(self, name: str) -> Optional[str]:
        return self._alias_to_canonical.get(name.lower().strip())

    def get_all_aliases(self, canonical: str) -> List[str]:
        if canonical not in COMPANY_DATABASE:
            return []
        data = COMPANY_DATABASE[canonical]
        aliases = list(data['aliases'])
        aliases.extend(data.get('subsidiaries', []))
        aliases.extend(data.get('international', {}).keys())
        return aliases


class SubsidiaryMapper:
    """Maps subsidiary companies to their parent companies."""

    def __init__(self):
        self._subsidiary_to_parent: Dict[str, str] = {}
        self._build_subsidiary_index()

    def _build_subsidiary_index(self):
        for parent, data in COMPANY_DATABASE.items():
            for subsidiary in data.get('subsidiaries', []):
                self._subsidiary_to_parent[subsidiary.lower()] = parent

    def get_parent(self, company: str) -> Optional[str]:
        return self._subsidiary_to_parent.get(company.lower().strip())

    def is_subsidiary(self, company: str) -> bool:
        return company.lower().strip() in self._subsidiary_to_parent

    def get_all_subsidiaries(self, parent: str) -> List[str]:
        if parent not in COMPANY_DATABASE:
            return []
        return COMPANY_DATABASE[parent].get('subsidiaries', [])


class InternationalCompanyNER:
    """Recognizes company names in various languages (Chinese, Korean, Japanese, Russian, Arabic)."""

    def __init__(self):
        self._intl_to_canonical: Dict[str, Tuple[str, str]] = {}
        self._build_intl_index()

    def _build_intl_index(self):
        for canonical, data in COMPANY_DATABASE.items():
            for intl_name, lang in data.get('international', {}).items():
                self._intl_to_canonical[intl_name] = (canonical, lang)

    def detect_language(self, text: str) -> Optional[str]:
        chinese_chars = len(re.findall(r'[一-鿿]', text))
        korean_chars = len(re.findall(r'[가-힯]', text))
        japanese_chars = len(re.findall(r'[぀-ヿㇰ-ㇿ]', text))
        cyrillic_chars = len(re.findall(r'[Ѐ-ӿ]', text))
        arabic_chars = len(re.findall(r'[؀-ۿ]', text))

        max_count = max(chinese_chars, korean_chars, japanese_chars, cyrillic_chars, arabic_chars)
        if max_count == 0:
            return None
        if max_count == chinese_chars:
            return 'zh'
        if max_count == korean_chars:
            return 'ko'
        if max_count == japanese_chars:
            return 'ja'
        if max_count == cyrillic_chars:
            return 'ru'
        if max_count == arabic_chars:
            return 'ar'
        return None

    def resolve(self, name: str) -> Optional[Tuple[str, str]]:
        return self._intl_to_canonical.get(name)

    def find_companies_in_text(self, text: str) -> List[Tuple[str, str, str]]:
        matches = []
        for intl_name, (canonical, lang) in self._intl_to_canonical.items():
            if intl_name in text:
                matches.append((intl_name, canonical, lang))
        return matches


class FuzzyCompanyMatcher:
    """Fuzzy matches company names to handle typos and variations."""

    def __init__(self, threshold: float = 0.85):
        self.threshold = threshold
        self._all_names: Set[str] = set()
        self._name_to_canonical: Dict[str, str] = {}
        self._build_name_index()

    def _build_name_index(self):
        for canonical, data in COMPANY_DATABASE.items():
            for alias in data['aliases']:
                self._all_names.add(alias.lower())
                self._name_to_canonical[alias.lower()] = canonical

    def _similarity(self, a: str, b: str) -> float:
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()

    def match(self, query: str) -> Optional[Tuple[str, str, float]]:
        query_lower = query.lower().strip()
        if query_lower in self._name_to_canonical:
            return (query_lower, self._name_to_canonical[query_lower], 1.0)

        best_match = None
        best_score = 0.0
        for name in self._all_names:
            score = self._similarity(query_lower, name)
            if score > best_score and score >= self.threshold:
                best_score = score
                best_match = name

        if best_match:
            return (best_match, self._name_to_canonical[best_match], best_score)
        return None

    def match_all(self, text: str) -> List[Tuple[str, str, float]]:
        matches = []
        words = re.findall(r'\b[A-Za-z]{3,}\b', text)
        for word in words:
            result = self.match(word)
            if result:
                matches.append(result)
        return matches


# Initialize global instances
_alias_resolver = CompanyAliasResolver()
_subsidiary_mapper = SubsidiaryMapper()
_intl_ner = InternationalCompanyNER()
_fuzzy_matcher = FuzzyCompanyMatcher()


def detect_company_robust(text: str) -> Optional[CompanyMatch]:
    """
    Robust company detection with all strategies:
    - Exact alias matching
    - Subsidiary detection (Instagram -> Meta)
    - International names (字节跳动 -> ByteDance)
    - Fuzzy matching for typos
    - Domain extraction
    - Ticker symbol detection
    """
    lower_text = text.lower()

    # Try exact alias match first (highest confidence)
    for canonical, data in COMPANY_DATABASE.items():
        for alias in data['aliases']:
            pattern = rf'\b{re.escape(alias)}\b'
            if re.search(pattern, lower_text, re.IGNORECASE):
                return CompanyMatch(
                    name=alias,
                    normalized=canonical,
                    confidence=0.95 if len(alias) > 3 else 0.8,
                    aliases=data['aliases'],
                    parent_company=None,
                    is_subsidiary=False,
                    ticker=data.get('ticker'),
                    domain=data.get('domain'),
                )

        # Check subsidiaries
        for subsidiary in data.get('subsidiaries', []):
            pattern = rf'\b{re.escape(subsidiary)}\b'
            if re.search(pattern, lower_text, re.IGNORECASE):
                return CompanyMatch(
                    name=subsidiary,
                    normalized=canonical,
                    confidence=0.9,
                    aliases=data['aliases'],
                    parent_company=canonical,
                    is_subsidiary=True,
                    ticker=data.get('ticker'),
                    domain=data.get('domain'),
                )

    # Try international names
    intl_matches = _intl_ner.find_companies_in_text(text)
    if intl_matches:
        match, canonical, lang = intl_matches[0]
        data = COMPANY_DATABASE.get(canonical, {})
        return CompanyMatch(
            name=match,
            normalized=canonical,
            confidence=0.9,
            aliases=data.get('aliases', []),
            parent_company=None,
            is_subsidiary=False,
            ticker=data.get('ticker'),
            domain=data.get('domain'),
        )

    # Try fuzzy matching for typos
    fuzzy_result = _fuzzy_matcher.match(text)
    if fuzzy_result:
        matched, canonical, confidence = fuzzy_result
        data = COMPANY_DATABASE.get(canonical, {})
        return CompanyMatch(
            name=matched,
            normalized=canonical,
            confidence=confidence * 0.9,
            aliases=data.get('aliases', []),
            parent_company=None,
            is_subsidiary=False,
            ticker=data.get('ticker'),
            domain=data.get('domain'),
        )

    # Try pattern-based extraction for unknown companies
    company_patterns = [
        r'(?:at|@|for|with|from)\s+([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)?)',
        r'([A-Z][a-zA-Z0-9]+)\s+(?:interview|onsite|phone screen|oa|online assessment)',
        r'(?:interviewed|interviewing|worked)\s+(?:at|with|for)\s+([A-Z][a-zA-Z0-9]+)',
    ]

    for pattern in company_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            company_name = match.group(1).strip()
            if 2 <= len(company_name) <= 50:
                return CompanyMatch(
                    name=company_name,
                    normalized=company_name.lower().replace(' ', '_'),
                    confidence=0.5,
                    aliases=[],
                    parent_company=None,
                    is_subsidiary=False,
                    ticker=None,
                    domain=None,
                )

    return None


def detect_all_companies_robust(text: str) -> List[CompanyMatch]:
    """Detect all company mentions in text with full context."""
    matches: List[CompanyMatch] = []
    seen: Set[str] = set()
    lower_text = text.lower()

    # Check all known companies
    for canonical, data in COMPANY_DATABASE.items():
        if canonical in seen:
            continue

        for alias in data['aliases']:
            pattern = rf'\b{re.escape(alias)}\b'
            if re.search(pattern, lower_text, re.IGNORECASE):
                seen.add(canonical)
                matches.append(CompanyMatch(
                    name=alias,
                    normalized=canonical,
                    confidence=0.95 if len(alias) > 3 else 0.8,
                    aliases=data['aliases'],
                    parent_company=None,
                    is_subsidiary=False,
                    ticker=data.get('ticker'),
                    domain=data.get('domain'),
                ))
                break

        if canonical not in seen:
            for subsidiary in data.get('subsidiaries', []):
                pattern = rf'\b{re.escape(subsidiary)}\b'
                if re.search(pattern, lower_text, re.IGNORECASE):
                    seen.add(canonical)
                    matches.append(CompanyMatch(
                        name=subsidiary,
                        normalized=canonical,
                        confidence=0.9,
                        aliases=data['aliases'],
                        parent_company=canonical,
                        is_subsidiary=True,
                        ticker=data.get('ticker'),
                        domain=data.get('domain'),
                    ))
                    break

    # Check international names
    intl_matches = _intl_ner.find_companies_in_text(text)
    for match, canonical, lang in intl_matches:
        if canonical not in seen:
            seen.add(canonical)
            data = COMPANY_DATABASE.get(canonical, {})
            matches.append(CompanyMatch(
                name=match,
                normalized=canonical,
                confidence=0.9,
                aliases=data.get('aliases', []),
                parent_company=None,
                is_subsidiary=False,
                ticker=data.get('ticker'),
                domain=data.get('domain'),
            ))

    return matches


def detect_company_from_domain(url: str) -> Optional[CompanyMatch]:
    """Extract company from a URL domain."""
    url_lower = url.lower()

    for canonical, data in COMPANY_DATABASE.items():
        company_domain = data.get('domain', '')
        if company_domain:
            # Check if company domain appears in URL
            domain_base = company_domain.replace('www.', '').split('/')[0]
            if domain_base in url_lower:
                return CompanyMatch(
                    name=canonical,
                    normalized=canonical,
                    confidence=0.95,
                    aliases=data['aliases'],
                    parent_company=None,
                    is_subsidiary=False,
                    ticker=data.get('ticker'),
                    domain=data.get('domain'),
                )

    return None


def detect_company_from_ticker(ticker: str) -> Optional[CompanyMatch]:
    """Extract company from a stock ticker symbol."""
    ticker_upper = ticker.upper().strip()

    for canonical, data in COMPANY_DATABASE.items():
        if data.get('ticker') and data['ticker'].upper() == ticker_upper:
            return CompanyMatch(
                name=canonical,
                normalized=canonical,
                confidence=0.99,
                aliases=data['aliases'],
                parent_company=None,
                is_subsidiary=False,
                ticker=data.get('ticker'),
                domain=data.get('domain'),
            )

    return None


# Export utility class instances for direct use
alias_resolver = _alias_resolver
subsidiary_mapper = _subsidiary_mapper
intl_ner = _intl_ner
fuzzy_matcher = _fuzzy_matcher
