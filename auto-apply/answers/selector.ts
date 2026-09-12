/**
 * Answer Selector with Rotation
 *
 * Smart answer selection that:
 * - Avoids recently used stories/answers
 * - Prefers higher-rated answers
 * - Adds randomization among top candidates
 * - Tracks usage persistently via database
 */

import { createClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export type QuestionCategory =
  | 'why_company'
  | 'why_role'
  | 'challenging_project'
  | 'teamwork'
  | 'conflict_resolution'
  | 'failure_learning'
  | 'leadership'
  | 'problem_solving'
  | 'strengths'
  | 'weaknesses'
  | 'career_goals'
  | 'achievement'
  | 'generic';

export type AnswerLength = 'short' | 'standard' | 'long';

export interface Story {
  id: string;
  user_id: string;
  story_type: string;
  title: string;
  context: string | null;
  organization: string | null;
  situation: string;
  task: string;
  actions: string[];
  results: { metric: string; value: string; description?: string }[];
  technologies: string[] | null;
  skills_demonstrated: string[] | null;
  applicable_categories: QuestionCategory[];
  strength_rating: number;
  times_used: number;
  last_used_at: string | null;
  last_used_company: string | null;
}

export interface StoredAnswer {
  id: string;
  user_id: string;
  story_id: string;
  question_category: QuestionCategory;
  word_count_target: number;
  variation_index: number;
  answer_text: string;
  answer_structure: string | null;
  times_used: number;
  last_used_at: string | null;
  strength_rating?: number;
  short?: string;
  standard?: string;
  long?: string;
}

export interface UsageRecord {
  id: string;
  user_id: string;
  story_id: string;
  question_category: QuestionCategory;
  company_slug: string;
  used_at: string;
}

export interface RuntimeContext {
  company?: string;
  company_slug?: string;
  product?: string;
  team?: string;
  role?: string;
  mission?: string;
  requirement?: string;
  technology?: string;
}

export interface SelectionOptions {
  /** Number of recent uses to exclude (default: 3) */
  excludeRecent?: number;
  /** Prefer higher strength ratings (default: true) */
  preferHighRating?: boolean;
  /** Target word count for length selection */
  targetWordCount?: number;
}

export interface SelectedAnswer {
  answer: string;
  storyId: string;
  category: QuestionCategory;
  lengthKey: AnswerLength;
  source: 'cached' | 'fallback';
}

// =============================================================================
// QUESTION CLASSIFIER
// =============================================================================

const QUESTION_PATTERNS: Record<QuestionCategory, RegExp[]> = {
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
  generic: [],
};

/**
 * Classify a question into a category
 */
export function classifyQuestion(questionText: string): {
  category: QuestionCategory;
  confidence: number;
  suggestedLength: number;
} {
  const normalized = questionText.toLowerCase().trim();
  const wordLimit = detectWordLimit(questionText);

  const matches = Object.entries(QUESTION_PATTERNS)
    .filter(([category]) => category !== 'generic')
    .map(([category, patterns]) => {
      const matchCount = patterns.filter((p) => p.test(normalized)).length;
      return {
        category: category as QuestionCategory,
        confidence: patterns.length > 0 ? matchCount / patterns.length : 0,
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
      const limit = parseInt(match[1]);
      // If characters, convert to approximate word count
      return limit > 500 ? Math.floor(limit / 5) : limit;
    }
  }

  return null;
}

// =============================================================================
// PERSONALIZATION
// =============================================================================

/**
 * Personalize a template with runtime context variables
 */
export function personalizeAnswer(template: string, context: RuntimeContext): string {
  let personalized = template;

  for (const [key, value] of Object.entries(context)) {
    if (value) {
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
  personalized = personalized.replace(/\{[^}]+\}/g, '');
  personalized = personalized.replace(/\[[^\]]+\]/g, '');

  // Clean up double spaces
  personalized = personalized.replace(/\s+/g, ' ').trim();

  return personalized;
}

// =============================================================================
// USAGE TRACKER - PERSISTENT
// =============================================================================

export class UsageTracker {
  private supabase;
  private userId: string;
  private memoryCache: Map<QuestionCategory, string[]> = new Map();

  constructor(supabaseUrl: string, supabaseKey: string, userId: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.userId = userId;
  }

  /**
   * Record that a story was used for a category at a company
   */
  async recordUsage(
    storyId: string,
    category: QuestionCategory,
    companySlug: string
  ): Promise<void> {
    try {
      // Insert usage record
      await this.supabase.from('answer_usage').insert({
        user_id: this.userId,
        story_id: storyId,
        question_category: category,
        company_slug: companySlug,
        used_at: new Date().toISOString(),
      });

      // Update story's usage stats
      await this.supabase
        .from('user_story_bank')
        .update({
          times_used: this.supabase.rpc('increment_times_used'),
          last_used_at: new Date().toISOString(),
          last_used_company: companySlug,
        })
        .eq('id', storyId);

      // Update memory cache
      const recent = this.memoryCache.get(category) || [];
      recent.unshift(storyId);
      this.memoryCache.set(category, recent.slice(0, 10));
    } catch (error) {
      console.error('[UsageTracker] Failed to record usage:', error);
    }
  }

  /**
   * Get recently used story IDs for a category
   */
  async getRecentlyUsed(category: QuestionCategory, limit: number = 5): Promise<string[]> {
    // Check memory cache first
    const cached = this.memoryCache.get(category);
    if (cached && cached.length >= limit) {
      return cached.slice(0, limit);
    }

    try {
      const { data, error } = await this.supabase
        .from('answer_usage')
        .select('story_id')
        .eq('user_id', this.userId)
        .eq('question_category', category)
        .order('used_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const storyIds = data?.map((r) => r.story_id) || [];

      // Update cache
      this.memoryCache.set(category, storyIds);

      return storyIds;
    } catch (error) {
      console.error('[UsageTracker] Failed to get recent usage:', error);
      return [];
    }
  }

  /**
   * Check if a story was recently used for a category
   */
  async isRecentlyUsed(
    storyId: string,
    category: QuestionCategory,
    limit: number
  ): Promise<boolean> {
    const recent = await this.getRecentlyUsed(category, limit);
    return recent.includes(storyId);
  }

  /**
   * Get usage statistics for all stories
   */
  async getUsageStats(): Promise<Map<string, number>> {
    try {
      const { data, error } = await this.supabase
        .from('answer_usage')
        .select('story_id')
        .eq('user_id', this.userId);

      if (error) throw error;

      const stats = new Map<string, number>();
      for (const record of data || []) {
        stats.set(record.story_id, (stats.get(record.story_id) || 0) + 1);
      }

      return stats;
    } catch (error) {
      console.error('[UsageTracker] Failed to get usage stats:', error);
      return new Map();
    }
  }

  /**
   * Clear memory cache (useful for testing)
   */
  clearCache(): void {
    this.memoryCache.clear();
  }
}

// =============================================================================
// ANSWER SELECTOR
// =============================================================================

export class AnswerSelector {
  private answerBank: StoredAnswer[];
  private usageTracker: UsageTracker;
  private recentlyUsedCache: Map<QuestionCategory, string[]> = new Map();

  constructor(answerBank: StoredAnswer[], usageTracker: UsageTracker) {
    this.answerBank = answerBank;
    this.usageTracker = usageTracker;
  }

  /**
   * Select an answer for a question, avoiding recently used stories
   */
  async selectAnswer(
    question: string,
    context: RuntimeContext,
    options: SelectionOptions = {}
  ): Promise<SelectedAnswer | null> {
    const { excludeRecent = 3, preferHighRating = true, targetWordCount } = options;

    // Classify the question
    const { category, suggestedLength } = classifyQuestion(question);

    // Get recently used stories for this category
    const recentStoryIds = await this.usageTracker.getRecentlyUsed(category, excludeRecent);

    // Filter answers by category and exclude recently used
    let candidates = this.answerBank.filter(
      (a) =>
        a.question_category === category && !recentStoryIds.includes(a.story_id)
    );

    // If all answers have been used recently, fall back to any answer in category
    if (candidates.length === 0) {
      candidates = this.answerBank.filter((a) => a.question_category === category);

      if (candidates.length === 0) {
        console.log(`[AnswerSelector] No answers found for category: ${category}`);
        return null;
      }

      console.log(
        `[AnswerSelector] All answers recently used for ${category}, falling back to any answer`
      );
    }

    // Sort by strength rating if enabled
    if (preferHighRating) {
      candidates.sort((a, b) => (b.strength_rating || 0) - (a.strength_rating || 0));
    }

    // Add randomization among top candidates
    // Take top 3 (or fewer) and randomly select one
    const topCandidates = candidates.slice(0, Math.min(3, candidates.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    // Determine length key based on target or suggested length
    const effectiveWordCount = targetWordCount || suggestedLength;
    const lengthKey = this.wordCountToLength(effectiveWordCount);

    // Get the answer text for the appropriate length
    const answerText = this.getAnswerByLength(selected, lengthKey);

    if (!answerText) {
      console.log(`[AnswerSelector] No answer text for length ${lengthKey}`);
      return null;
    }

    // Track usage
    if (context.company_slug) {
      await this.usageTracker.recordUsage(selected.story_id, category, context.company_slug);
    }

    // Personalize the answer with runtime context
    const personalizedAnswer = personalizeAnswer(answerText, context);

    return {
      answer: personalizedAnswer,
      storyId: selected.story_id,
      category,
      lengthKey,
      source: recentStoryIds.includes(selected.story_id) ? 'fallback' : 'cached',
    };
  }

  /**
   * Select multiple diverse answers for a set of questions
   * Ensures different stories are used for different questions when possible
   */
  async selectMultipleAnswers(
    questions: { question: string; context: RuntimeContext }[],
    options: SelectionOptions = {}
  ): Promise<Map<string, SelectedAnswer | null>> {
    const results = new Map<string, SelectedAnswer | null>();
    const usedStories = new Set<string>();

    for (const { question, context } of questions) {
      // Temporarily add used stories to exclusion
      const recentIds = await this.usageTracker.getRecentlyUsed(
        classifyQuestion(question).category,
        options.excludeRecent || 3
      );
      const excludeIds = [...recentIds, ...Array.from(usedStories)];

      const answer = await this.selectAnswerWithExclusions(
        question,
        context,
        excludeIds,
        options
      );

      results.set(question, answer);

      if (answer) {
        usedStories.add(answer.storyId);
      }
    }

    return results;
  }

  /**
   * Internal method to select answer with specific exclusions
   */
  private async selectAnswerWithExclusions(
    question: string,
    context: RuntimeContext,
    excludeStoryIds: string[],
    options: SelectionOptions = {}
  ): Promise<SelectedAnswer | null> {
    const { preferHighRating = true, targetWordCount } = options;
    const { category, suggestedLength } = classifyQuestion(question);

    // Filter candidates
    let candidates = this.answerBank.filter(
      (a) =>
        a.question_category === category && !excludeStoryIds.includes(a.story_id)
    );

    // Fall back if no candidates
    if (candidates.length === 0) {
      candidates = this.answerBank.filter((a) => a.question_category === category);
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort and select
    if (preferHighRating) {
      candidates.sort((a, b) => (b.strength_rating || 0) - (a.strength_rating || 0));
    }

    const topCandidates = candidates.slice(0, Math.min(3, candidates.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    const effectiveWordCount = targetWordCount || suggestedLength;
    const lengthKey = this.wordCountToLength(effectiveWordCount);
    const answerText = this.getAnswerByLength(selected, lengthKey);

    if (!answerText) return null;

    if (context.company_slug) {
      await this.usageTracker.recordUsage(selected.story_id, category, context.company_slug);
    }

    return {
      answer: personalizeAnswer(answerText, context),
      storyId: selected.story_id,
      category,
      lengthKey,
      source: excludeStoryIds.includes(selected.story_id) ? 'fallback' : 'cached',
    };
  }

  /**
   * Get answer text by length preference
   */
  private getAnswerByLength(answer: StoredAnswer, lengthKey: AnswerLength): string | null {
    // Try the requested length first
    if (lengthKey === 'short' && answer.short) return answer.short;
    if (lengthKey === 'standard' && answer.standard) return answer.standard;
    if (lengthKey === 'long' && answer.long) return answer.long;

    // Check answer_text as fallback
    if (answer.answer_text) return answer.answer_text;

    // Fall back to any available length
    return answer.standard || answer.short || answer.long || null;
  }

  /**
   * Convert word count to length key
   */
  private wordCountToLength(wordCount: number): AnswerLength {
    if (wordCount <= 100) return 'short';
    if (wordCount <= 200) return 'standard';
    return 'long';
  }

  /**
   * Get statistics about answer bank coverage
   */
  getStats(): {
    totalAnswers: number;
    byCategory: Record<QuestionCategory, number>;
    avgRating: number;
    coverageComplete: boolean;
  } {
    const byCategory = {} as Record<QuestionCategory, number>;
    let totalRating = 0;
    let ratedCount = 0;

    for (const answer of this.answerBank) {
      byCategory[answer.question_category] =
        (byCategory[answer.question_category] || 0) + 1;

      if (answer.strength_rating) {
        totalRating += answer.strength_rating;
        ratedCount++;
      }
    }

    // Check if all major categories are covered
    const majorCategories: QuestionCategory[] = [
      'challenging_project',
      'teamwork',
      'problem_solving',
      'achievement',
    ];
    const coverageComplete = majorCategories.every((cat) => (byCategory[cat] || 0) > 0);

    return {
      totalAnswers: this.answerBank.length,
      byCategory,
      avgRating: ratedCount > 0 ? totalRating / ratedCount : 0,
      coverageComplete,
    };
  }

  /**
   * Reload answer bank (e.g., after generating new answers)
   */
  updateAnswerBank(newAnswerBank: StoredAnswer[]): void {
    this.answerBank = newAnswerBank;
    console.log(`[AnswerSelector] Answer bank updated with ${newAnswerBank.length} answers`);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create an AnswerSelector with database connection
 */
export async function createAnswerSelector(
  supabaseUrl: string,
  supabaseKey: string,
  userId: string
): Promise<AnswerSelector> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const usageTracker = new UsageTracker(supabaseUrl, supabaseKey, userId);

  // Load answer bank from database
  const { data: answers, error } = await supabase
    .from('answer_bank')
    .select(
      `
      *,
      user_story_bank!inner (
        strength_rating
      )
    `
    )
    .eq('user_id', userId);

  if (error) {
    console.error('[createAnswerSelector] Failed to load answers:', error);
    throw error;
  }

  // Map strength ratings from story
  const answersWithRating = (answers || []).map((a) => ({
    ...a,
    strength_rating: a.user_story_bank?.strength_rating || 0,
  }));

  console.log(`[createAnswerSelector] Loaded ${answersWithRating.length} answers for user`);

  return new AnswerSelector(answersWithRating, usageTracker);
}

export default AnswerSelector;
