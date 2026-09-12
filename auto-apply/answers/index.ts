/**
 * AnswerManager - Main entry point for the answer generation and retrieval system
 *
 * Handles:
 * - Loading pre-generated answers from database
 * - Bulk generation of answers from user's story bank
 * - Company-specific "Why Company" answer generation
 * - Answer retrieval with category matching and personalization
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export type StoryType =
  | 'project'
  | 'teamwork'
  | 'conflict'
  | 'leadership'
  | 'failure'
  | 'achievement'
  | 'technical'
  | 'growth';

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

export interface StoryResult {
  metric: string;
  value: string;
  description?: string;
}

export interface UserStory {
  id: string;
  user_id: string;
  story_type: StoryType;
  title: string;
  context: string | null;
  organization: string | null;
  situation: string;
  task: string;
  actions: string[];
  results: StoryResult[];
  team_size: number | null;
  duration: string | null;
  technologies: string[];
  skills_demonstrated: string[];
  challenges_faced: string[];
  lessons_learned: string[];
  applicable_categories: QuestionCategory[];
  strength_rating: number;
  times_used: number;
  last_used_at: string | null;
  last_used_company: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnswerBankEntry {
  id: string;
  user_id: string;
  story_id: string | null;
  question_category: QuestionCategory;
  word_count_target: number;
  variation_index: number;
  answer_text: string;
  answer_structure: string | null;
  variable_slots: Record<string, string | null> | null;
  generation_model: string | null;
  generation_prompt_version: string | null;
  times_used: number;
  last_used_at: string | null;
  created_at: string;
}

export interface CompanyAnswer {
  id: string;
  user_id: string;
  company_slug: string;
  company_name: string;
  why_company_short: string | null;
  why_company_standard: string | null;
  why_company_long: string | null;
  company_mission: string | null;
  company_products: string[] | null;
  recent_news: string[] | null;
  user_connection: string | null;
  relevant_experience: string | null;
  generated_at: string;
  generation_model: string | null;
}

export interface UserProfile {
  userId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  education?: {
    degree?: string;
    major?: string;
    school?: string;
  };
  interests?: string[];
  goals?: string[];
  customAnswers?: Record<string, string>;
}

export interface CompanyData {
  slug: string;
  name: string;
  mission?: string;
  products?: string[];
  recentNews?: string[];
  technicalFocus?: string[];
  roleTitle?: string;
  team?: string;
  requirements?: string[];
  personalConnection?: string;
}

export interface JobData {
  title?: string;
  team?: string;
  requirements?: string[];
  technologies?: string[];
}

export interface RuntimeContext {
  company?: string;
  company_name?: string;
  product?: string;
  team?: string;
  role?: string;
  mission?: string;
  requirement?: string;
  technology?: string;
  timeline?: string;
}

export interface AnswerResult {
  source: 'cached' | 'template' | 'company' | 'none';
  answer: string | null;
  category: QuestionCategory;
  lengthKey?: AnswerLength;
  matched?: boolean;
}

export interface GenerationResult {
  answers: Record<QuestionCategory, {
    story_used?: string;
    short: string;
    standard: string;
    long?: string;
    structure_used?: string;
  }>;
  generated_at: string;
  model: string;
}

// =============================================================================
// QUESTION PATTERNS - for classifying questions into categories
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

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Classify a question into a category based on pattern matching
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
      const limit = parseInt(match[1], 10);
      // If characters, convert to approximate word count
      return limit > 500 ? Math.floor(limit / 5) : limit;
    }
  }

  return null;
}

/**
 * Personalize a template answer with runtime context variables
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

/**
 * Build runtime context from job and company data
 */
export function buildRuntimeContext(
  jobData: JobData,
  companyData: Partial<CompanyData>
): RuntimeContext {
  return {
    company: companyData?.name || '',
    company_name: companyData?.name || '',
    product: companyData?.products?.[0] || '',
    team: jobData?.team || '',
    role: jobData?.title || 'Software Engineer',
    mission: companyData?.mission || '',
    requirement: jobData?.requirements?.[0] || '',
    technology: jobData?.technologies?.[0] || '',
    timeline: 'recently',
  };
}

/**
 * Convert length key to word count target
 */
function lengthToWordCount(length: AnswerLength): number {
  const map: Record<AnswerLength, number> = { short: 75, standard: 150, long: 300 };
  return map[length] || 150;
}

/**
 * Convert word count to length key
 */
function wordCountToLength(wordCount: number): AnswerLength {
  if (wordCount <= 100) return 'short';
  if (wordCount <= 200) return 'standard';
  return 'long';
}

// =============================================================================
// ANSWER SELECTOR
// =============================================================================

/**
 * Smart answer selection with usage tracking and rotation
 */
export class AnswerSelector {
  private answerBank: AnswerBankEntry[];
  private recentlyUsed: Map<QuestionCategory, string[]>;

  constructor(answerBank: AnswerBankEntry[]) {
    this.answerBank = answerBank;
    this.recentlyUsed = new Map();
  }

  /**
   * Select an answer for a question, avoiding recently used stories
   */
  selectAnswer(
    question: string,
    context: RuntimeContext,
    options: { excludeRecent?: number; preferHighRating?: boolean } = {}
  ): string | null {
    const { excludeRecent = 3 } = options;
    const { category, suggestedLength } = classifyQuestion(question);

    // Get all answers for this category
    const candidates = this.answerBank
      .filter((a) => a.question_category === category)
      .filter((a) => !this.isRecentlyUsed(a.story_id, category, excludeRecent));

    if (candidates.length === 0) {
      // Fall back to any answer in category
      const anyAnswer = this.answerBank.find((a) => a.question_category === category);
      return anyAnswer ? this.formatAnswer(anyAnswer, suggestedLength, context) : null;
    }

    // Add some randomness among top candidates
    const topCandidates = candidates.slice(0, Math.min(3, candidates.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    // Track usage
    if (selected.story_id) {
      this.recordUsage(selected.story_id, category);
    }

    return this.formatAnswer(selected, suggestedLength, context);
  }

  private isRecentlyUsed(
    storyId: string | null,
    category: QuestionCategory,
    limit: number
  ): boolean {
    if (!storyId) return false;
    const recent = this.recentlyUsed.get(category) || [];
    return recent.slice(0, limit).includes(storyId);
  }

  private recordUsage(storyId: string, category: QuestionCategory): void {
    const recent = this.recentlyUsed.get(category) || [];
    recent.unshift(storyId);
    this.recentlyUsed.set(category, recent.slice(0, 10));
  }

  private formatAnswer(
    answer: AnswerBankEntry,
    targetLength: number,
    context: RuntimeContext
  ): string {
    const template = answer.answer_text;
    return personalizeAnswer(template, context);
  }
}

// =============================================================================
// ANSWER MANAGER
// =============================================================================

/**
 * Main Answer Manager - handles generation, caching, and retrieval of answers
 */
export class AnswerManager {
  private db: SupabaseClient;
  private profile: UserProfile;
  private answerBank: Record<QuestionCategory, Record<AnswerLength, string>> | null = null;
  private selector: AnswerSelector | null = null;
  private initialized = false;

  constructor(supabaseClient: SupabaseClient, userProfile: UserProfile) {
    this.db = supabaseClient;
    this.profile = userProfile;
  }

  /**
   * Initialize: Load existing answers from database
   */
  async init(): Promise<AnswerManager> {
    const { data: answers, error } = await this.db
      .from('answer_bank')
      .select('*')
      .eq('user_id', this.profile.userId);

    if (error) {
      console.error('[AnswerManager] Failed to load answers:', error.message);
    }

    if (answers && answers.length > 0) {
      this.answerBank = this.organizeAnswers(answers);
      this.selector = new AnswerSelector(answers);
      console.log(`[AnswerManager] Loaded ${answers.length} pre-generated answers`);
    } else {
      console.log('[AnswerManager] No existing answers found');
    }

    this.initialized = true;
    return this;
  }

  /**
   * Generate all answers from user's story bank
   * Call this once after user fills out their stories
   */
  async generateAllAnswers(): Promise<GenerationResult> {
    console.log('[AnswerManager] Starting bulk answer generation...');

    // Load story bank
    const { data: stories, error: storiesError } = await this.db
      .from('user_story_bank')
      .select('*')
      .eq('user_id', this.profile.userId);

    if (storiesError) {
      throw new Error(`Failed to load stories: ${storiesError.message}`);
    }

    if (!stories || stories.length === 0) {
      throw new Error('No stories in story bank. Please add experiences first.');
    }

    // Build the prompt for bulk generation
    const prompt = this.buildBulkGenerationPrompt(stories);

    // Generate answers using LLM (Gemini)
    const result = await this.callGenerationAPI(prompt);

    // Save to database
    const inserts: Partial<AnswerBankEntry>[] = [];
    for (const [category, answers] of Object.entries(result.answers)) {
      for (const [lengthKey, text] of Object.entries(answers)) {
        if (lengthKey === 'story_used' || lengthKey === 'structure_used') continue;

        inserts.push({
          user_id: this.profile.userId,
          story_id: this.findStoryId(stories, answers.story_used),
          question_category: category as QuestionCategory,
          word_count_target: lengthToWordCount(lengthKey as AnswerLength),
          variation_index: 1,
          answer_text: text as string,
          generation_model: 'gemini-1.5-flash',
        });
      }
    }

    const { error: insertError } = await this.db.from('answer_bank').upsert(inserts);

    if (insertError) {
      console.error('[AnswerManager] Failed to save answers:', insertError.message);
    }

    // Reload answers
    await this.init();

    console.log(`[AnswerManager] Generated ${inserts.length} answers`);
    return result;
  }

  /**
   * Generate company-specific "Why Company" answers
   */
  async generateCompanyAnswers(companyData: CompanyData): Promise<CompanyAnswer> {
    console.log(`[AnswerManager] Generating answers for ${companyData.name}...`);

    // Find most relevant story
    const { data: stories } = await this.db
      .from('user_story_bank')
      .select('*')
      .eq('user_id', this.profile.userId)
      .order('strength_rating', { ascending: false })
      .limit(1);

    const relevantStory = stories?.[0] as UserStory | undefined;

    // Build prompt
    const prompt = this.buildWhyCompanyPrompt(companyData, relevantStory);

    // Generate answers
    const generatedAnswers = await this.callWhyCompanyAPI(prompt);

    // Save to database
    const companyAnswer: Partial<CompanyAnswer> = {
      user_id: this.profile.userId,
      company_slug: companyData.slug,
      company_name: companyData.name,
      why_company_short: generatedAnswers.short,
      why_company_standard: generatedAnswers.standard,
      why_company_long: generatedAnswers.long,
      company_mission: companyData.mission,
      company_products: companyData.products,
      generation_model: 'gemini-1.5-flash',
    };

    const { data, error } = await this.db
      .from('company_answers')
      .upsert(companyAnswer)
      .select()
      .single();

    if (error) {
      console.error('[AnswerManager] Failed to save company answer:', error.message);
      throw error;
    }

    return data as CompanyAnswer;
  }

  /**
   * Get an answer for a question (main retrieval API)
   */
  async getAnswer(questionText: string, context: RuntimeContext = {}): Promise<AnswerResult> {
    // Ensure initialized
    if (!this.initialized) {
      await this.init();
    }

    const { category, suggestedLength } = classifyQuestion(questionText);

    // Try pre-generated answers first using selector
    if (this.selector) {
      const answer = this.selector.selectAnswer(questionText, context);
      if (answer) {
        return {
          source: 'cached',
          answer,
          category,
          matched: true,
        };
      }
    }

    // Try direct lookup from organized answer bank
    if (this.answerBank && this.answerBank[category]) {
      let lengthKey: AnswerLength = 'standard';
      if (suggestedLength <= 100) lengthKey = 'short';
      else if (suggestedLength >= 250) lengthKey = 'long';

      const template =
        this.answerBank[category][lengthKey] || this.answerBank[category].standard;
      if (template) {
        const answer = personalizeAnswer(template, context);
        return {
          source: 'cached',
          answer,
          category,
          lengthKey,
          matched: true,
        };
      }
    }

    return {
      source: 'none',
      answer: null,
      category,
      matched: false,
    };
  }

  /**
   * Get company-specific "Why Company" answer
   */
  async getCompanyAnswer(
    companySlug: string,
    length: AnswerLength = 'standard'
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from('company_answers')
      .select('*')
      .eq('user_id', this.profile.userId)
      .eq('company_slug', companySlug)
      .single();

    if (error || !data) {
      return null;
    }

    const fieldMap: Record<AnswerLength, keyof CompanyAnswer> = {
      short: 'why_company_short',
      standard: 'why_company_standard',
      long: 'why_company_long',
    };

    const field = fieldMap[length];
    return (data[field] as string) || (data.why_company_standard as string) || null;
  }

  /**
   * Check if answers exist for user
   */
  hasAnswers(): boolean {
    return this.answerBank !== null && Object.keys(this.answerBank).length > 0;
  }

  /**
   * Get available question categories
   */
  getAvailableCategories(): QuestionCategory[] {
    if (!this.answerBank) return [];
    return Object.keys(this.answerBank) as QuestionCategory[];
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private organizeAnswers(
    answers: AnswerBankEntry[]
  ): Record<QuestionCategory, Record<AnswerLength, string>> {
    const organized: Record<string, Record<string, string>> = {};

    for (const answer of answers) {
      if (!organized[answer.question_category]) {
        organized[answer.question_category] = {};
      }
      const lengthKey = wordCountToLength(answer.word_count_target);
      organized[answer.question_category][lengthKey] = answer.answer_text;
    }

    return organized as Record<QuestionCategory, Record<AnswerLength, string>>;
  }

  private findStoryId(stories: UserStory[], storyTitle?: string): string | null {
    if (!storyTitle) return null;
    const story = stories.find((s) => storyTitle.includes(s.title));
    return story?.id || null;
  }

  private buildBulkGenerationPrompt(stories: UserStory[]): string {
    const storyList = stories
      .map(
        (s, i) =>
          `Story ${i + 1} (${s.story_type}): ${s.title}
     - Situation: ${s.situation}
     - Actions: ${s.actions.slice(0, 3).join('; ')}
     - Results: ${s.results
       .slice(0, 2)
       .map((r) => r.value)
       .join('; ')}`
      )
      .join('\n\n');

    return `Generate a complete answer bank for a job applicant.

CANDIDATE PROFILE:
- Education: ${this.profile.education?.degree || 'Computer Science'} in ${this.profile.education?.major || 'CS'}
- Interests: ${this.profile.interests?.slice(0, 3).join(', ') || 'software engineering'}
- Goals: ${this.profile.goals?.slice(0, 2).join(', ') || 'build impactful products'}

USER STORIES:
${storyList}

TASK: For each question category below, select the most appropriate story and generate SHORT (75w) and STANDARD (150w) answers.

CATEGORIES:
1. challenging_project - Use a project/technical story
2. teamwork - Use a teamwork/collaboration story
3. failure_learning - Use a failure/growth story
4. problem_solving - Use a technical/challenge story
5. achievement - Use the strongest story overall

OUTPUT FORMAT (JSON):
{
  "challenging_project": {
    "story_used": "Story X",
    "short": "...",
    "standard": "..."
  },
  "teamwork": {...},
  "failure_learning": {...},
  "problem_solving": {...},
  "achievement": {...}
}

Generate all answers:`;
  }

  private buildWhyCompanyPrompt(companyData: CompanyData, relevantStory?: UserStory): string {
    return `Generate a "Why do you want to work at ${companyData.name}?" answer for a job application.

COMPANY CONTEXT:
- Company: ${companyData.name}
- Mission: ${companyData.mission || 'Not provided'}
- Key Products: ${companyData.products?.join(', ') || 'Not provided'}
- Recent News: ${companyData.recentNews?.join('; ') || 'None provided'}
- Technical Focus: ${companyData.technicalFocus?.join(', ') || 'Not provided'}

ROLE CONTEXT:
- Job Title: ${companyData.roleTitle || 'Software Engineer'}
- Team: ${companyData.team || 'Engineering'}
- Key Requirements: ${companyData.requirements?.slice(0, 3).join(', ') || 'Not specified'}

CANDIDATE PROFILE:
- Background: ${this.profile.education?.degree || 'CS'} in ${this.profile.education?.major || 'Computer Science'} from ${this.profile.education?.school || 'University'}
- Interests: ${this.profile.interests?.join(', ') || 'building impactful products'}
- Goals: ${this.profile.goals?.slice(0, 2).join(', ') || 'learn and grow'}
${relevantStory ? `- Relevant Experience: ${relevantStory.title} - ${relevantStory.results?.map((r) => r.value).join(', ')}` : ''}
${companyData.personalConnection ? `- Personal Connection: ${companyData.personalConnection}` : ''}

REQUIREMENTS:
1. Generate 3 lengths: SHORT (75w), STANDARD (150-200w), LONG (300w)
2. Reference at least 2 specific company details (product, mission, recent news)
3. Connect candidate's experience to company needs
4. Balance: ~60% about company, ~40% about candidate
5. Sound genuine and conversational, not sycophantic

DO NOT use:
- "I am passionate about technology"
- "leader in the industry"
- "I believe I would be a great fit"
- "aligned with my goals"
- Generic flattery without specifics

OUTPUT FORMAT (JSON):
{
  "short": "...",
  "standard": "...",
  "long": "...",
  "company_details_used": ["product X", "mission Y"],
  "candidate_connections": ["experience A", "interest B"]
}

Generate the answers:`;
  }

  /**
   * Call the Gemini API for bulk generation
   * This is a placeholder - actual implementation depends on your API setup
   */
  private async callGenerationAPI(prompt: string): Promise<GenerationResult> {
    // TODO: Implement actual Gemini API call
    // For now, return a placeholder that indicates the prompt was built
    console.log('[AnswerManager] Would call Gemini API with prompt length:', prompt.length);

    // This would be replaced with actual API call:
    // const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    // const result = await model.generateContent(prompt);
    // return JSON.parse(result.response.text());

    throw new Error(
      'Generation API not configured. Set GEMINI_API_KEY and implement callGenerationAPI.'
    );
  }

  /**
   * Call the Gemini API for "Why Company" generation
   */
  private async callWhyCompanyAPI(
    prompt: string
  ): Promise<{ short: string; standard: string; long: string }> {
    console.log('[AnswerManager] Would call Gemini API with prompt length:', prompt.length);

    throw new Error(
      'Generation API not configured. Set GEMINI_API_KEY and implement callWhyCompanyAPI.'
    );
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

// Re-export cache module
export {
  AnswerCache,
  AnswerCacheWarmer,
  getAnswerCache,
  createWarmedAnswerCache,
  CACHE_TTL,
  type CacheEntry,
  type CacheStats,
  type AnswerVariants,
  type StoryAnswer,
  type CompanyAnswer as CachedCompanyAnswer,
  type AnswerCacheOptions,
} from './cache';

// Re-export enhanced selector with persistent tracking
export {
  AnswerSelector as PersistentAnswerSelector,
  UsageTracker,
  createAnswerSelector,
  classifyQuestion as classifyQuestionEnhanced,
  personalizeAnswer as personalizeAnswerEnhanced,
  type Story,
  type StoredAnswer,
  type UsageRecord,
  type RuntimeContext as SelectorRuntimeContext,
  type SelectionOptions,
  type SelectedAnswer,
} from './selector';

// Re-export question classifier with caching
export {
  classifyQuestion as classifyQuestionBase,
  classifyQuestionCached,
  classifyQuestionsBatch,
  getClassificationCacheStats,
  clearClassificationCache,
  detectWordLimit,
  detectCharLimit,
  getWordCountCategory,
  isLogisticsQuestion,
  requiresCompanyContext,
  getCategoryForType,
  type QuestionType,
  type QuestionCategory as ClassifierQuestionCategory,
  type ClassificationResult as ClassifierResult,
} from './question-classifier';

// Re-export pre-generation utilities
export {
  PreGenerationService,
  getPreGenerationService,
  DEFAULT_BEHAVIORAL_CATEGORIES,
  OFF_PEAK_HOURS,
  type PreGenerationConfig,
  type PreGenerationResult,
  type ScheduledJobConfig,
} from './pregeneration';

// Re-export optimized prompts
export {
  buildOptimizedStoryPrompt,
  buildOptimizedWhyCompanyPrompt,
  estimateTokenCount,
  getPromptEfficiencyStats,
  CONDENSED_GUIDELINES,
} from './prompts';

// Re-export semantic cache and prefetch manager
export {
  SemanticAnswerCache,
  PrefetchManager,
  getSemanticCache,
  getPrefetchManager,
} from './cache';

export default AnswerManager;

export { QUESTION_PATTERNS };

// =============================================================================
// OPTIMIZATION SUMMARY
// =============================================================================
/**
 * ANSWER GENERATION OPTIMIZATION FEATURES:
 *
 * 1. CLASSIFICATION CACHING (question-classifier.ts)
 *    - LRU cache for classification results
 *    - Batch classification for multiple questions
 *    - 1-hour TTL, 500 entry limit
 *
 * 2. RESPONSE CACHING (generation-service.ts)
 *    - In-session response cache for duplicate requests
 *    - Batched prompts for 3+ categories (N calls -> 1 call)
 *    - 30-minute TTL
 *
 * 3. TOKEN OPTIMIZATION (prompts.ts)
 *    - Condensed guidelines: ~200 tokens -> ~50 tokens
 *    - Optimized prompt builders: ~40% token reduction
 *    - Token count estimation utilities
 *
 * 4. PRE-GENERATION (pregeneration.ts)
 *    - Off-peak scheduling (2-6 AM UTC)
 *    - Batch processing with rate limiting
 *    - Cost estimation before API calls
 *    - Skip existing cache entries
 *
 * 5. SEMANTIC CACHING (cache.ts)
 *    - Question normalization for fuzzy matching
 *    - Maps similar questions to same answer
 *    - Synonym handling (difficult -> challenging)
 *
 * 6. PREFETCH MANAGER (cache.ts)
 *    - Anticipates needed answers
 *    - ATS-specific prefetch patterns
 *    - Background queue processing
 *
 * USAGE EXAMPLE:
 * ```typescript
 * // Pre-generate at setup time (off-peak preferred)
 * const preGen = getPreGenerationService();
 * if (preGen.isOffPeakTime()) {
 *   await preGen.preGenerateForUser(userId, stories, profile);
 * }
 *
 * // Use semantic cache for retrieval
 * const semanticCache = getSemanticCache();
 * const answer = await semanticCache.get(userId, question);
 *
 * // Prefetch when application starts
 * const prefetch = getPrefetchManager();
 * await prefetch.prefetchForApplication(userId, companySlug);
 * ```
 */
