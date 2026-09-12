/**
 * Question Classifier Module
 *
 * Classifies job application questions into known categories for answer matching.
 * Uses rule-based pattern matching with regex and keyword detection.
 */

// ============================================================================
// Types
// ============================================================================

/** Supported question types for classification */
export type QuestionType =
  | 'project'          // "Describe a challenging project"
  | 'teamwork'         // "Tell us about team experience"
  | 'conflict'         // "How do you handle disagreements?"
  | 'leadership'       // "Describe a time you led"
  | 'failure'          // "Tell us about a mistake"
  | 'achievement'      // "What's your proudest accomplishment?"
  | 'problem_solving'  // "How do you approach problems?"
  | 'why_company'      // "Why do you want to work here?"
  | 'why_role'         // "Why are you interested in this role?"
  | 'career_goals'     // "What are your career goals?"
  | 'availability'     // "When can you start?"
  | 'work_auth'        // "Are you authorized to work?"
  | 'relocation'       // "Are you willing to relocate?"
  | 'salary'           // "What are your salary expectations?"
  | 'additional_info'  // "Anything else you'd like to share?"
  | 'unknown';         // Unclassified question

/** Question category groupings */
export type QuestionCategory =
  | 'behavioral'
  | 'motivation'
  | 'logistics'
  | 'freeform';

/** Pattern configuration for a question type */
export interface QuestionPattern {
  type: QuestionType;
  category: QuestionCategory;
  patterns: RegExp[];
  keywords: string[];
  weight: number; // 1-10 importance for scoring
}

/** Result of question classification */
export interface ClassificationResult {
  type: QuestionType;
  category: QuestionCategory;
  confidence: number; // 0-1 confidence score
  matchedPatterns: number;
  matchedKeywords: number;
  wordCountHint: number | null;
  charCountHint: number | null;
  requiresLLM: boolean;
}

/** Word count category for answer length */
export type WordCountCategory = 'short' | 'standard' | 'long';

// ============================================================================
// Question Patterns (15 Types)
// ============================================================================

const questionPatterns: QuestionPattern[] = [
  // Behavioral Questions
  {
    type: 'project',
    category: 'behavioral',
    patterns: [
      /challenging.*project/i,
      /difficult.*project/i,
      /complex.*project/i,
      /describe.*project/i,
      /tell.*about.*project/i,
      /proud.*project/i,
      /recent.*project/i,
      /significant.*project/i,
      /technical.*project/i,
      /side.*project/i,
      /personal.*project/i,
    ],
    keywords: ['project', 'built', 'developed', 'created', 'implemented', 'designed'],
    weight: 8,
  },
  {
    type: 'teamwork',
    category: 'behavioral',
    patterns: [
      /work.*team/i,
      /team.*experience/i,
      /collaborate/i,
      /group.*project/i,
      /cross-functional/i,
      /worked.*others/i,
      /team.*environment/i,
      /working.*with.*others/i,
    ],
    keywords: ['team', 'collaborate', 'together', 'group', 'colleagues', 'cooperation'],
    weight: 7,
  },
  {
    type: 'conflict',
    category: 'behavioral',
    patterns: [
      /conflict/i,
      /disagree/i,
      /difficult.*colleague/i,
      /handle.*disagreement/i,
      /resolve.*conflict/i,
      /challenging.*relationship/i,
      /difficult.*situation.*person/i,
      /dealt.*with.*difficult/i,
    ],
    keywords: ['conflict', 'disagree', 'difficult', 'resolve', 'tension', 'dispute'],
    weight: 9,
  },
  {
    type: 'leadership',
    category: 'behavioral',
    patterns: [
      /lead/i,
      /leadership/i,
      /mentor/i,
      /manage/i,
      /influence/i,
      /initiative/i,
      /took.*charge/i,
      /guided.*team/i,
      /delegat/i,
    ],
    keywords: ['lead', 'leader', 'mentor', 'manage', 'guide', 'direct', 'initiative'],
    weight: 7,
  },
  {
    type: 'failure',
    category: 'behavioral',
    patterns: [
      /fail/i,
      /mistake/i,
      /didn.*work/i,
      /wrong/i,
      /learn.*from/i,
      /setback/i,
      /overcome.*obstacle/i,
      /challenge.*faced/i,
      /went.*wrong/i,
      /handle.*failure/i,
    ],
    keywords: ['fail', 'mistake', 'wrong', 'learned', 'setback', 'obstacle', 'error'],
    weight: 9,
  },
  {
    type: 'achievement',
    category: 'behavioral',
    patterns: [
      /accomplishment/i,
      /achievement/i,
      /proud.*of/i,
      /success/i,
      /impact/i,
      /contribution/i,
      /greatest.*achievement/i,
      /proudest.*moment/i,
    ],
    keywords: ['accomplish', 'achieve', 'proud', 'success', 'impact', 'contribution'],
    weight: 7,
  },
  {
    type: 'problem_solving',
    category: 'behavioral',
    patterns: [
      /problem.*solv/i,
      /approach.*problem/i,
      /debug/i,
      /troubleshoot/i,
      /figure.*out/i,
      /overcome.*challenge/i,
      /analytical/i,
      /complex.*issue/i,
      /difficult.*bug/i,
    ],
    keywords: ['problem', 'solve', 'debug', 'troubleshoot', 'analyze', 'solution'],
    weight: 8,
  },

  // Motivation Questions
  {
    type: 'why_company',
    category: 'motivation',
    patterns: [
      /why.*company/i,
      /why.*us/i,
      /interest.*company/i,
      /attract.*to/i,
      /why.*join/i,
      /what.*excites.*about/i,
      /why.*want.*work.*here/i,
      /why.*apply.*to/i,
      /interest.*in.*our.*company/i,
    ],
    keywords: ['why', 'company', 'interest', 'join', 'attract', 'mission', 'culture'],
    weight: 10,
  },
  {
    type: 'why_role',
    category: 'motivation',
    patterns: [
      /why.*role/i,
      /why.*position/i,
      /interested.*position/i,
      /what.*appeal/i,
      /why.*apply/i,
      /interest.*this.*job/i,
      /what.*draws.*you/i,
    ],
    keywords: ['role', 'position', 'apply', 'interest', 'job', 'opportunity'],
    weight: 9,
  },
  {
    type: 'career_goals',
    category: 'motivation',
    patterns: [
      /career.*goal/i,
      /where.*see.*yourself/i,
      /five.*years/i,
      /long.*term/i,
      /aspiration/i,
      /future.*plans/i,
      /professional.*goals/i,
      /career.*path/i,
    ],
    keywords: ['career', 'goal', 'future', 'aspire', 'years', 'ambition', 'plan'],
    weight: 7,
  },

  // Logistics Questions
  {
    type: 'availability',
    category: 'logistics',
    patterns: [
      /start.*date/i,
      /when.*start/i,
      /availability/i,
      /notice.*period/i,
      /available.*begin/i,
      /earliest.*start/i,
      /how.*soon/i,
    ],
    keywords: ['start', 'availability', 'begin', 'notice', 'available', 'when'],
    weight: 8,
  },
  {
    type: 'work_auth',
    category: 'logistics',
    patterns: [
      /authorized.*work/i,
      /work.*authorization/i,
      /legally.*authorized/i,
      /sponsorship/i,
      /visa/i,
      /require.*sponsor/i,
      /employment.*eligib/i,
      /right.*work/i,
    ],
    keywords: ['authorized', 'authorization', 'sponsorship', 'visa', 'legal', 'eligible'],
    weight: 10,
  },
  {
    type: 'relocation',
    category: 'logistics',
    patterns: [
      /willing.*relocate/i,
      /open.*relocat/i,
      /relocate.*office/i,
      /move.*to/i,
      /work.*from.*office/i,
      /on.*site/i,
      /willing.*to.*move/i,
    ],
    keywords: ['relocate', 'relocation', 'move', 'location', 'office', 'onsite'],
    weight: 8,
  },
  {
    type: 'salary',
    category: 'logistics',
    patterns: [
      /salary/i,
      /compensation/i,
      /expected.*salary/i,
      /desired.*salary/i,
      /pay.*expectation/i,
      /salary.*requirement/i,
      /desired.*compensation/i,
    ],
    keywords: ['salary', 'compensation', 'pay', 'money', 'wage', 'expectation'],
    weight: 8,
  },

  // Freeform Questions
  {
    type: 'additional_info',
    category: 'freeform',
    patterns: [
      /anything.*else/i,
      /additional.*information/i,
      /share.*with.*us/i,
      /want.*us.*know/i,
      /other.*comments/i,
      /anything.*add/i,
      /anything.*share/i,
      /final.*thoughts/i,
    ],
    keywords: ['additional', 'else', 'share', 'comments', 'other', 'anything'],
    weight: 5,
  },
];

// Category mapping for quick lookup
const typeToCategory: Record<QuestionType, QuestionCategory> = {
  project: 'behavioral',
  teamwork: 'behavioral',
  conflict: 'behavioral',
  leadership: 'behavioral',
  failure: 'behavioral',
  achievement: 'behavioral',
  problem_solving: 'behavioral',
  why_company: 'motivation',
  why_role: 'motivation',
  career_goals: 'motivation',
  availability: 'logistics',
  work_auth: 'logistics',
  relocation: 'logistics',
  salary: 'logistics',
  additional_info: 'freeform',
  unknown: 'freeform',
};

// ============================================================================
// Word/Character Limit Detection
// ============================================================================

/**
 * Extract word limit from question text
 * @param text - The question text
 * @returns Word limit if found, null otherwise
 */
export function detectWordLimit(text: string): number | null {
  const patterns: Array<{ regex: RegExp; isCharLimit: boolean }> = [
    { regex: /(\d+)\s*words?(?:\s+or\s+less)?/i, isCharLimit: false },
    { regex: /max(?:imum)?\s*(?:of\s*)?(\d+)\s*words?/i, isCharLimit: false },
    { regex: /limit(?:ed)?\s*to\s*(\d+)\s*words?/i, isCharLimit: false },
    { regex: /up\s*to\s*(\d+)\s*words?/i, isCharLimit: false },
    { regex: /(\d+)\s*word\s*limit/i, isCharLimit: false },
    { regex: /(\d+)\s*characters?(?:\s+or\s+less)?/i, isCharLimit: true },
    { regex: /max(?:imum)?\s*(?:of\s*)?(\d+)\s*char/i, isCharLimit: true },
    { regex: /limit(?:ed)?\s*to\s*(\d+)\s*char/i, isCharLimit: true },
    { regex: /up\s*to\s*(\d+)\s*char/i, isCharLimit: true },
    { regex: /(\d+)\s*char(?:acter)?\s*limit/i, isCharLimit: true },
  ];

  for (const { regex, isCharLimit } of patterns) {
    const match = text.match(regex);
    if (match) {
      const limit = parseInt(match[1], 10);
      // Convert character limit to approximate word count (avg 5 chars/word)
      return isCharLimit ? Math.floor(limit / 5) : limit;
    }
  }

  return null;
}

/**
 * Extract character limit from question text
 * @param text - The question text
 * @returns Character limit if found, null otherwise
 */
export function detectCharLimit(text: string): number | null {
  const patterns = [
    /(\d+)\s*characters?(?:\s+or\s+less)?/i,
    /max(?:imum)?\s*(?:of\s*)?(\d+)\s*char/i,
    /limit(?:ed)?\s*to\s*(\d+)\s*char/i,
    /up\s*to\s*(\d+)\s*char/i,
    /(\d+)\s*char(?:acter)?\s*limit/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Get word count category from word limit
 * @param wordCount - Word count or null
 * @returns Category: 'short' (<=100), 'standard' (101-200), 'long' (>200)
 */
export function getWordCountCategory(wordCount: number | null): WordCountCategory {
  if (!wordCount || wordCount <= 100) return 'short';
  if (wordCount <= 200) return 'standard';
  return 'long';
}

// ============================================================================
// Classification Functions
// ============================================================================

/**
 * Classify a question using rule-based pattern matching
 * @param questionText - The question to classify
 * @returns Classification result with type, confidence, and metadata
 */
export function classifyQuestion(questionText: string): ClassificationResult {
  const normalizedText = questionText.toLowerCase().trim();

  // Detect word/character limits
  const wordCountHint = detectWordLimit(questionText);
  const charCountHint = detectCharLimit(questionText);

  // Score each question type
  const scores: Array<{
    type: QuestionType;
    category: QuestionCategory;
    score: number;
    patterns: number;
    keywords: number;
  }> = [];

  for (const pattern of questionPatterns) {
    let patternMatches = 0;
    let keywordMatches = 0;

    // Count regex pattern matches
    for (const regex of pattern.patterns) {
      if (regex.test(normalizedText)) {
        patternMatches++;
      }
    }

    // Count keyword matches
    for (const keyword of pattern.keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        keywordMatches++;
      }
    }

    if (patternMatches > 0 || keywordMatches > 0) {
      // Calculate weighted score
      // Pattern matches are weighted more heavily than keywords
      const patternScore = (patternMatches / pattern.patterns.length) * pattern.weight;
      const keywordScore = (keywordMatches / pattern.keywords.length) * (pattern.weight * 0.5);
      const totalScore = patternScore + keywordScore;

      scores.push({
        type: pattern.type,
        category: pattern.category,
        score: totalScore,
        patterns: patternMatches,
        keywords: keywordMatches,
      });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Return unknown if no matches
  if (scores.length === 0) {
    return {
      type: 'unknown',
      category: 'freeform',
      confidence: 0,
      matchedPatterns: 0,
      matchedKeywords: 0,
      wordCountHint,
      charCountHint,
      requiresLLM: true,
    };
  }

  const best = scores[0];
  // Maximum possible score is roughly weight + (weight * 0.5) = 15 for weight 10
  const maxPossibleScore = 15;
  const confidence = Math.min(best.score / maxPossibleScore, 1);

  return {
    type: best.type,
    category: best.category,
    confidence,
    matchedPatterns: best.patterns,
    matchedKeywords: best.keywords,
    wordCountHint,
    charCountHint,
    requiresLLM: confidence < 0.6,
  };
}

/**
 * Get all classification scores for a question (useful for debugging)
 * @param questionText - The question to classify
 * @returns Array of all scored types, sorted by confidence
 */
export function getClassificationScores(
  questionText: string
): Array<{ type: QuestionType; confidence: number }> {
  const normalizedText = questionText.toLowerCase().trim();
  const scores: Array<{ type: QuestionType; score: number }> = [];

  for (const pattern of questionPatterns) {
    let patternMatches = 0;
    let keywordMatches = 0;

    for (const regex of pattern.patterns) {
      if (regex.test(normalizedText)) {
        patternMatches++;
      }
    }

    for (const keyword of pattern.keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        keywordMatches++;
      }
    }

    const patternScore = (patternMatches / pattern.patterns.length) * pattern.weight;
    const keywordScore = (keywordMatches / pattern.keywords.length) * (pattern.weight * 0.5);
    const totalScore = patternScore + keywordScore;

    scores.push({ type: pattern.type, score: totalScore });
  }

  const maxPossibleScore = 15;
  return scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => ({
      type: s.type,
      confidence: Math.min(s.score / maxPossibleScore, 1),
    }));
}

/**
 * Check if a question is a logistics/FAQ type that may have a cached response
 * @param type - The question type
 * @returns True if this is a simple logistics question
 */
export function isLogisticsQuestion(type: QuestionType): boolean {
  return typeToCategory[type] === 'logistics';
}

/**
 * Check if a question requires company-specific context
 * @param type - The question type
 * @returns True if the answer should be customized per company
 */
export function requiresCompanyContext(type: QuestionType): boolean {
  return type === 'why_company' || type === 'why_role';
}

/**
 * Get the category for a question type
 * @param type - The question type
 * @returns The category
 */
export function getCategoryForType(type: QuestionType): QuestionCategory {
  return typeToCategory[type];
}

// ============================================================================
// Classification Cache (reduces redundant classification work)
// ============================================================================

/** LRU cache for classification results */
const classificationCache = new Map<string, { result: ClassificationResult; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 500;

/**
 * Classify a question with caching to avoid redundant pattern matching.
 * Many job applications ask similar questions, so caching saves CPU cycles.
 *
 * @param questionText - The question to classify
 * @returns Cached or fresh classification result
 */
export function classifyQuestionCached(questionText: string): ClassificationResult {
  const normalizedKey = questionText.toLowerCase().trim().slice(0, 200); // Cap key length
  const now = Date.now();

  // Check cache
  const cached = classificationCache.get(normalizedKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  // Classify fresh
  const result = classifyQuestion(questionText);

  // Evict oldest entries if cache is full
  if (classificationCache.size >= MAX_CACHE_SIZE) {
    const oldest = Array.from(classificationCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 50);
    for (const [key] of oldest) {
      classificationCache.delete(key);
    }
  }

  // Cache the result
  classificationCache.set(normalizedKey, { result, timestamp: now });
  return result;
}

/**
 * Batch classify multiple questions efficiently.
 * Deduplicates similar questions and reuses cached results.
 *
 * @param questions - Array of question texts
 * @returns Map of question text to classification result
 */
export function classifyQuestionsBatch(questions: string[]): Map<string, ClassificationResult> {
  const results = new Map<string, ClassificationResult>();
  const seen = new Map<string, string>(); // Normalized -> original

  for (const q of questions) {
    const normalized = q.toLowerCase().trim();
    if (!seen.has(normalized)) {
      seen.set(normalized, q);
    }
  }

  // Classify unique questions
  seen.forEach((original, normalized) => {
    const result = classifyQuestionCached(original);
    results.set(original, result);
  });

  // Map back to original questions
  for (const q of questions) {
    const normalized = q.toLowerCase().trim();
    const original = seen.get(normalized)!;
    if (original !== q) {
      results.set(q, results.get(original)!);
    }
  }

  return results;
}

/**
 * Get cache statistics for monitoring
 */
export function getClassificationCacheStats(): {
  size: number;
  maxSize: number;
  hitRate: number;
} {
  return {
    size: classificationCache.size,
    maxSize: MAX_CACHE_SIZE,
    hitRate: 0, // Would need to track hits/misses for accurate rate
  };
}

/**
 * Clear the classification cache (useful for testing)
 */
export function clearClassificationCache(): void {
  classificationCache.clear();
}

// ============================================================================
// Exports
// ============================================================================

export {
  questionPatterns,
  typeToCategory,
};

export default classifyQuestion;
