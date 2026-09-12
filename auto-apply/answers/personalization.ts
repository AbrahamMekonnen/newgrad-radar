/**
 * Personalization Engine for Answer Templates
 *
 * Handles runtime variable interpolation, answer selection,
 * and context building for pre-generated answer templates.
 */

// ============================================================================
// Types
// ============================================================================

/** Variables that can be interpolated at runtime */
export interface RuntimeVariables {
  company: string | null;
  company_name: string | null;
  product: string | null;
  team: string | null;
  role: string | null;
  mission: string | null;
  requirement: string | null;
  technology: string | null;
  timeline: string | null;
}

/** Context used for personalizing answers */
export interface PersonalizationContext extends Partial<RuntimeVariables> {
  [key: string]: string | null | undefined;
}

/** Answer length variants */
export type AnswerLength = 'short' | 'standard' | 'long';

/** Answer bank structure by category */
export interface AnswerBank {
  [category: string]: {
    short?: string;
    standard?: string;
    long?: string;
  };
}

/** Job data for building runtime context */
export interface JobData {
  title?: string;
  team?: string;
  requirements?: string[];
  technologies?: string[];
  description?: string;
}

/** Company data for building runtime context */
export interface CompanyData {
  name?: string;
  slug?: string;
  products?: string[];
  mission?: string;
  technicalFocus?: string[];
  recentNews?: string[];
}

/** Result from question classification */
export interface ClassificationResult {
  category: string;
  confidence: number;
  suggestedLength: number;
}

/** Result from answer selection */
export interface AnswerSelectionResult {
  answer: string | null;
  category: string;
  lengthKey: AnswerLength;
  matched: boolean;
}

// ============================================================================
// Question Classification (minimal implementation)
// ============================================================================

/** Question category patterns for matching */
const QUESTION_PATTERNS: Record<string, RegExp[]> = {
  why_company: [
    /why.*(?:interested|want|applying|work).*(?:here|company|organization)/i,
    /what.*(?:excites|attracts|interests).*(?:about|regarding).*(?:company|role)/i,
    /why.*(?:this|our).*company/i,
    /what.*drew.*to.*(?:this|our)/i,
  ],
  why_role: [
    /why.*(?:interested|want).*(?:this|the).*(?:role|position|job)/i,
    /what.*(?:excites|interests).*about.*(?:this|the).*(?:role|position)/i,
    /why.*(?:software|engineering|developer)/i,
  ],
  challenging_project: [
    /(?:challenging|difficult|complex).*project/i,
    /project.*(?:proud|significant|impactful)/i,
    /describe.*(?:technical|engineering).*project/i,
    /tell.*about.*project/i,
  ],
  teamwork: [
    /(?:work|collaborate).*(?:team|group)/i,
    /team.*(?:experience|project)/i,
    /describe.*(?:collaboration|teamwork)/i,
    /cross-functional/i,
  ],
  conflict_resolution: [
    /(?:conflict|disagreement|difficult).*(?:colleague|coworker|team)/i,
    /(?:resolve|handle).*(?:conflict|disagreement)/i,
    /time.*(?:disagreed|conflict)/i,
  ],
  failure_learning: [
    /(?:fail|mistake|wrong).*(?:learn|teach)/i,
    /time.*(?:failed|made.*mistake)/i,
    /learn.*from.*(?:failure|mistake)/i,
    /biggest.*(?:failure|mistake)/i,
  ],
  leadership: [
    /(?:lead|leadership|led).*(?:team|project|initiative)/i,
    /(?:mentor|manage|influence)/i,
    /take.*(?:initiative|charge|lead)/i,
  ],
  problem_solving: [
    /(?:solve|approach|tackle).*(?:problem|challenge|issue)/i,
    /(?:debug|troubleshoot)/i,
    /difficult.*(?:technical|engineering).*(?:problem|challenge)/i,
  ],
  strengths: [
    /(?:strength|strong.*point|best.*quality)/i,
    /what.*(?:make|makes).*(?:good|great|strong)/i,
    /why.*(?:hire|should.*hire)/i,
  ],
  weaknesses: [
    /(?:weakness|area.*improvement|growth.*area)/i,
    /what.*(?:improve|working.*on)/i,
    /constructive.*feedback/i,
  ],
  career_goals: [
    /(?:career|professional).*(?:goal|aspiration)/i,
    /where.*(?:see.*yourself|want.*be).*(?:years|future)/i,
    /long.*term.*(?:goal|plan)/i,
  ],
  achievement: [
    /(?:accomplishment|achievement|proud)/i,
    /greatest.*(?:success|achievement)/i,
    /impact.*(?:made|had)/i,
  ],
};

/**
 * Detect word/character limits from question text
 */
function detectWordLimit(text: string): number | null {
  const patterns = [
    /(\d+)\s*(?:words?|characters?)\s*(?:max|limit|or less)/i,
    /(?:max|limit|under)\s*(\d+)\s*(?:words?|characters?)/i,
    /\((\d+)\s*(?:words?|characters?)\)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const limit = parseInt(match[1], 10);
      // If characters, convert to approximate word count (5 chars per word)
      return limit > 500 ? Math.floor(limit / 5) : limit;
    }
  }

  return null;
}

/**
 * Classify a question into a category based on pattern matching
 */
export function classifyQuestion(questionText: string): ClassificationResult {
  const normalized = questionText.toLowerCase().trim();

  // Detect character/word limits
  const wordLimit = detectWordLimit(questionText);

  // Match against patterns
  const matches = Object.entries(QUESTION_PATTERNS)
    .map(([category, patterns]) => {
      const matchCount = patterns.filter((p) => p.test(normalized)).length;
      return {
        category,
        confidence: matchCount / patterns.length,
        matchCount,
      };
    })
    .filter((m) => m.matchCount > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 0) {
    return {
      category: 'generic',
      confidence: 0,
      suggestedLength: wordLimit || 150,
    };
  }

  return {
    category: matches[0].category,
    confidence: matches[0].confidence,
    suggestedLength: wordLimit || 150,
  };
}

// ============================================================================
// Core Personalization Functions
// ============================================================================

/**
 * Personalize a pre-generated answer with runtime context.
 *
 * Replaces template variables like {company}, {role}, {product}, etc.
 * with actual values from the context, then cleans up any unfilled variables.
 *
 * Supported variable formats:
 * - {variable}
 * - [variable]
 * - ${variable}
 *
 * @param template - The answer template with variables
 * @param context - Runtime context with variable values
 * @returns Personalized answer string
 */
export function personalizeAnswer(
  template: string,
  context: PersonalizationContext
): string {
  let personalized = template;

  // Replace known variables with their values
  for (const [key, value] of Object.entries(context)) {
    if (value) {
      // Support multiple variable formats: {key}, [key], ${key}
      const patterns = [
        new RegExp(`\\{${key}\\}`, 'g'),
        new RegExp(`\\[${key}\\]`, 'g'),
        new RegExp(`\\$\\{${key}\\}`, 'g'),
      ];

      for (const pattern of patterns) {
        personalized = personalized.replace(pattern, value);
      }
    }
  }

  // Clean up any remaining unfilled variables
  personalized = cleanUnfilledVariables(personalized);

  return personalized;
}

/**
 * Remove unfilled template variables and clean up resulting whitespace
 */
function cleanUnfilledVariables(text: string): string {
  let cleaned = text;

  // Remove {variable} style placeholders
  cleaned = cleaned.replace(/\{[^}]+\}/g, '');

  // Remove [variable] style placeholders
  cleaned = cleaned.replace(/\[[^\]]+\]/g, '');

  // Remove ${variable} style placeholders
  cleaned = cleaned.replace(/\$\{[^}]+\}/g, '');

  // Clean up double spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Clean up orphaned punctuation (e.g., ", ," or ". .")
  cleaned = cleaned.replace(/,\s*,/g, ',');
  cleaned = cleaned.replace(/\.\s*\./g, '.');

  return cleaned;
}

/**
 * Determine the appropriate length variant based on suggested word count
 */
export function selectLengthVariant(suggestedLength: number): AnswerLength {
  if (suggestedLength <= 100) {
    return 'short';
  } else if (suggestedLength >= 250) {
    return 'long';
  }
  return 'standard';
}

/**
 * Select the best answer based on question context and available answers.
 *
 * Process:
 * 1. Classify the question to determine category
 * 2. Look up answers for that category in the answer bank
 * 3. Select appropriate length variant based on question requirements
 * 4. Personalize the answer with runtime context
 *
 * @param question - The question text from the application form
 * @param answerBank - Pre-generated answers organized by category
 * @param context - Runtime context for personalization
 * @returns Selection result with the personalized answer
 */
export function selectBestAnswer(
  question: string,
  answerBank: AnswerBank,
  context: PersonalizationContext
): AnswerSelectionResult {
  // Classify the question
  const { category, suggestedLength } = classifyQuestion(question);

  // Get answers for this category
  const categoryAnswers = answerBank[category];
  if (!categoryAnswers) {
    return {
      answer: null,
      category,
      lengthKey: 'standard',
      matched: false,
    };
  }

  // Select length variant
  const lengthKey = selectLengthVariant(suggestedLength);

  // Get template, falling back to standard if preferred length unavailable
  const template =
    categoryAnswers[lengthKey] || categoryAnswers.standard || categoryAnswers.short;

  if (!template) {
    return {
      answer: null,
      category,
      lengthKey,
      matched: false,
    };
  }

  // Personalize with runtime context
  const personalized = personalizeAnswer(template, context);

  return {
    answer: personalized,
    category,
    lengthKey,
    matched: true,
  };
}

/**
 * Build runtime context from job posting and company data.
 *
 * Extracts relevant values from job and company data structures
 * to create a context object for answer personalization.
 *
 * @param jobData - Job posting data
 * @param companyData - Company information
 * @returns Context object with populated values
 */
export function buildRuntimeContext(
  jobData: JobData = {},
  companyData: CompanyData = {}
): PersonalizationContext {
  return {
    // Company-specific
    company: companyData.name || null,
    company_name: companyData.name || null,
    product: companyData.products?.[0] || null,
    mission: companyData.mission || null,

    // Job-specific
    role: jobData.title || 'Software Engineer',
    team: jobData.team || null,
    requirement: jobData.requirements?.[0] || null,
    technology: jobData.technologies?.[0] || null,

    // Defaults
    timeline: 'recently',
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an answer template contains unfilled variables
 */
export function hasUnfilledVariables(text: string): boolean {
  return (
    /\{[^}]+\}/.test(text) ||
    /\[[^\]]+\]/.test(text) ||
    /\$\{[^}]+\}/.test(text)
  );
}

/**
 * Extract variable names from a template
 */
export function extractVariables(template: string): string[] {
  const variables: Set<string> = new Set();

  // Match {variable}
  const braceMatches = template.matchAll(/\{([^}]+)\}/g);
  for (const match of braceMatches) {
    variables.add(match[1]);
  }

  // Match [variable]
  const bracketMatches = template.matchAll(/\[([^\]]+)\]/g);
  for (const match of bracketMatches) {
    variables.add(match[1]);
  }

  // Match ${variable}
  const dollarMatches = template.matchAll(/\$\{([^}]+)\}/g);
  for (const match of dollarMatches) {
    variables.add(match[1]);
  }

  return Array.from(variables);
}

/**
 * Get word count for an answer
 */
export function getWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validate that an answer meets length requirements
 */
export function validateAnswerLength(
  answer: string,
  minWords?: number,
  maxWords?: number
): { valid: boolean; wordCount: number; message?: string } {
  const wordCount = getWordCount(answer);

  if (minWords && wordCount < minWords) {
    return {
      valid: false,
      wordCount,
      message: `Answer is too short (${wordCount} words, minimum ${minWords})`,
    };
  }

  if (maxWords && wordCount > maxWords) {
    return {
      valid: false,
      wordCount,
      message: `Answer is too long (${wordCount} words, maximum ${maxWords})`,
    };
  }

  return { valid: true, wordCount };
}

// ============================================================================
// Default Runtime Variables
// ============================================================================

/**
 * Default/empty runtime variables structure
 */
export const RUNTIME_VARIABLES: RuntimeVariables = {
  company: null,
  company_name: null,
  product: null,
  team: null,
  role: null,
  mission: null,
  requirement: null,
  technology: null,
  timeline: null,
};

// ============================================================================
// Exports
// ============================================================================

export default {
  personalizeAnswer,
  selectBestAnswer,
  buildRuntimeContext,
  classifyQuestion,
  selectLengthVariant,
  hasUnfilledVariables,
  extractVariables,
  getWordCount,
  validateAnswerLength,
  RUNTIME_VARIABLES,
  QUESTION_PATTERNS,
};
