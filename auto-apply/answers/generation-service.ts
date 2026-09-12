/**
 * Answer Generation Service
 *
 * Integrates with Google Gemini API to generate personalized answers
 * for job application questions from user stories.
 *
 * Features:
 * - Single story to multiple answer lengths (short/standard/long)
 * - Company-specific "Why Company" answers
 * - Bulk generation of entire answer bank
 * - Rate limiting (60 RPM for Gemini Flash free tier)
 * - Exponential backoff retries
 * - Cost tracking
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// ============================================================================
// Types
// ============================================================================

export interface Story {
  id: string;
  title: string;
  context: string; // 'internship', 'class', 'personal', 'hackathon', 'work'
  organization?: string;
  situation: string;
  task: string;
  actions: string[];
  results: { metric: string; value: string; description?: string }[];
  technologies?: string[];
  skillsDemonstrated?: string[];
  story_type?: string;
}

export interface UserProfile {
  userId: string;
  education?: {
    degree: string;
    major: string;
    school: string;
    graduation?: string;
  };
  interests?: string[];
  goals?: string[];
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

export interface GeneratedAnswer {
  short: string;
  standard: string;
  long: string;
  structure_used?: 'result_first' | 'challenge_first' | 'standard_star';
}

export interface StoryAnswerResult {
  story_id: string;
  short: string;
  standard: string;
  long: string;
  structure?: string;
  generated_at: string;
  error?: string;
}

export interface CompanyAnswerResult {
  company_slug: string;
  company_name: string;
  short: string;
  standard: string;
  long: string;
  details_used?: string[];
  connections?: string[];
  generated_at: string;
}

export interface BulkAnswerResult {
  answers: Record<
    string,
    {
      story_used: string;
      short: string;
      standard: string;
    }
  >;
  generated_at: string;
  model: string;
}

export interface CostTracker {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  estimatedCostUSD: number;
}

// ============================================================================
// Configuration
// ============================================================================

const MODEL_NAME = 'gemini-1.5-flash';

// Gemini Flash pricing (as of 2024)
// Input: $0.075 per 1M tokens, Output: $0.30 per 1M tokens
const COST_PER_INPUT_TOKEN = 0.000000075;
const COST_PER_OUTPUT_TOKEN = 0.0000003;

// Rate limiting: 60 RPM = 1 request per second
const MIN_REQUEST_INTERVAL_MS = 1100;

// Retry configuration
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

// Prompt optimization: Condensed guidelines to reduce token usage
const CONDENSED_WRITING_GUIDELINES = `Write naturally: use contractions, vary sentences, lead with impact.
Avoid: "passionate about", "leverage", "thrive in", "Furthermore", "I believe", "excited".
Include: specific numbers, concrete examples, active voice.`;

// Response cache for deduplication within a session
const responseCache = new Map<string, { response: unknown; timestamp: number }>();
const RESPONSE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// Prompt Builders
// ============================================================================

function buildStoryToAnswerPrompt(
  story: Story,
  category: string,
  userProfile: UserProfile
): string {
  return `You are helping a job applicant generate answers for their applications.

TASK: Generate 3 variations of an answer for the "${category}" question category, using the provided story.

USER STORY:
- Title: ${story.title}
- Context: ${story.context} at ${story.organization || 'a tech company'}
- Situation: ${story.situation}
- Task: ${story.task}
- Actions: ${story.actions.join('; ')}
- Results: ${story.results.map((r) => `${r.metric}: ${r.value}`).join('; ')}
- Technologies: ${story.technologies?.join(', ') || 'N/A'}
- Skills: ${story.skillsDemonstrated?.join(', ') || 'N/A'}

CANDIDATE BACKGROUND:
- Education: ${userProfile.education?.degree || 'N/A'} in ${userProfile.education?.major || 'Computer Science'} from ${userProfile.education?.school || 'University'}
- Interests: ${userProfile.interests?.slice(0, 3).join(', ') || 'building great software'}

REQUIREMENTS:
1. Generate 3 answer lengths: SHORT (75 words), STANDARD (150-200 words), LONG (300-350 words)
2. Each answer MUST follow STAR format: Situation, Task, Action, Result
3. Use first-person "I" statements for actions
4. Include specific metrics/numbers from the story
5. Sound natural and conversational, not robotic
6. Use contractions naturally ("I'm", "I've", "didn't")
7. Vary sentence lengths for rhythm

DO NOT use these phrases:
- "I am passionate about"
- "I thrive in fast-paced environments"
- "I am confident that"
- "leverage my skills"
- "Furthermore" / "Moreover" / "In addition"

OUTPUT FORMAT (JSON):
{
  "short": "...",
  "standard": "...",
  "long": "...",
  "structure_used": "result_first" | "challenge_first" | "standard_star"
}

Generate the answers:`;
}

function buildWhyCompanyPrompt(
  companyData: CompanyData,
  userProfile: UserProfile,
  relevantStory?: Story
): string {
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
- Background: ${userProfile.education?.degree || 'BS'} in ${userProfile.education?.major || 'Computer Science'} from ${userProfile.education?.school || 'University'}
- Interests: ${userProfile.interests?.join(', ') || 'building impactful products'}
- Goals: ${userProfile.goals?.slice(0, 2).join(', ') || 'learn and grow'}
${relevantStory ? `- Relevant Experience: ${relevantStory.title} - ${relevantStory.results?.map((r) => r.value).join(', ')}` : ''}
${companyData.personalConnection ? `- Personal Connection: ${companyData.personalConnection}` : ''}

REQUIREMENTS:
1. Generate 3 lengths: SHORT (75w), STANDARD (150-200w), LONG (300w)
2. Reference at least 2 specific company details (product, mission, recent news)
3. Connect candidate's experience to company needs
4. Balance: ~60% about company, ~40% about candidate
5. Sound genuine and conversational, not sycophantic
6. Include specific technical connections if applicable

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

function buildBulkGenerationPrompt(
  stories: Story[],
  userProfile: UserProfile
): string {
  const storyList = stories
    .map(
      (s, i) =>
        `Story ${i + 1} (${s.story_type || 'general'}): ${s.title}
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
- Education: ${userProfile.education?.degree || 'BS'} in ${userProfile.education?.major || 'Computer Science'}
- Interests: ${userProfile.interests?.slice(0, 3).join(', ') || 'building software'}
- Goals: ${userProfile.goals?.slice(0, 2).join(', ') || 'learn and grow'}

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

// ============================================================================
// Generation Service Class
// ============================================================================

export class GenerationService {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private lastRequestTime: number = 0;
  private costTracker: CostTracker = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCalls: 0,
    estimatedCostUSD: 0,
  };

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        'GEMINI_API_KEY is required. Set it in environment or pass to constructor.'
      );
    }

    this.genAI = new GoogleGenerativeAI(key);
    this.model = this.genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });
  }

  /**
   * Get current cost tracking stats
   */
  getCostStats(): CostTracker {
    return { ...this.costTracker };
  }

  /**
   * Reset cost tracking
   */
  resetCostStats(): void {
    this.costTracker = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCalls: 0,
      estimatedCostUSD: 0,
    };
  }

  /**
   * Generate answers from a single story for multiple categories.
   *
   * OPTIMIZATION: For 3+ categories, uses batched prompting to reduce API calls.
   * Single call generates all categories vs. N separate calls.
   */
  async generateFromStory(
    story: Story,
    categories: string[],
    userProfile: UserProfile
  ): Promise<Record<string, StoryAnswerResult>> {
    const results: Record<string, StoryAnswerResult> = {};

    // OPTIMIZATION: Check response cache for identical requests
    const cacheKey = `story:${story.id}:${categories.sort().join(',')}`;
    const cached = this.checkResponseCache<Record<string, StoryAnswerResult>>(cacheKey);
    if (cached) {
      console.log(`[GenerationService] Cache hit for story ${story.id}`);
      return cached;
    }

    // OPTIMIZATION: If multiple categories, batch into single prompt
    if (categories.length >= 3) {
      try {
        const batchedResults = await this.generateBatchedFromStory(story, categories, userProfile);
        this.setResponseCache(cacheKey, batchedResults);
        return batchedResults;
      } catch (error) {
        console.warn('[GenerationService] Batched generation failed, falling back to sequential');
        // Fall through to sequential generation
      }
    }

    for (const category of categories) {
      const prompt = buildStoryToAnswerPrompt(story, category, userProfile);

      try {
        const parsed = await this.generateWithRetry<GeneratedAnswer>(prompt);

        results[category] = {
          story_id: story.id,
          short: parsed.short,
          standard: parsed.standard,
          long: parsed.long,
          structure: parsed.structure_used,
          generated_at: new Date().toISOString(),
        };
      } catch (error) {
        console.error(
          `Failed to generate ${category} from story ${story.id}:`,
          error
        );
        results[category] = {
          story_id: story.id,
          short: '',
          standard: '',
          long: '',
          generated_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Rate limiting between requests
      await this.enforceRateLimit();
    }

    this.setResponseCache(cacheKey, results);
    return results;
  }

  /**
   * OPTIMIZATION: Batch multiple categories into a single LLM call.
   * Reduces API calls from N to 1 for multi-category generation.
   */
  private async generateBatchedFromStory(
    story: Story,
    categories: string[],
    userProfile: UserProfile
  ): Promise<Record<string, StoryAnswerResult>> {
    const prompt = this.buildBatchedStoryPrompt(story, categories, userProfile);

    await this.enforceRateLimit();
    const result = await this.model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    this.trackCosts(response);

    const parsed = JSON.parse(text) as Record<string, GeneratedAnswer>;
    const results: Record<string, StoryAnswerResult> = {};

    for (const category of categories) {
      const categoryResult = parsed[category];
      if (categoryResult) {
        results[category] = {
          story_id: story.id,
          short: categoryResult.short,
          standard: categoryResult.standard,
          long: categoryResult.long,
          structure: categoryResult.structure_used,
          generated_at: new Date().toISOString(),
        };
      } else {
        results[category] = {
          story_id: story.id,
          short: '',
          standard: '',
          long: '',
          generated_at: new Date().toISOString(),
          error: 'Category not returned in batch response',
        };
      }
    }

    return results;
  }

  /**
   * Build a batched prompt for multiple categories from a single story.
   * Uses condensed guidelines to minimize token usage.
   */
  private buildBatchedStoryPrompt(
    story: Story,
    categories: string[],
    userProfile: UserProfile
  ): string {
    return `Generate STAR-format answers for these categories using the story below.
${CONDENSED_WRITING_GUIDELINES}

STORY: ${story.title}
Context: ${story.context} at ${story.organization || 'tech company'}
Situation: ${story.situation}
Task: ${story.task}
Actions: ${story.actions.join('; ')}
Results: ${story.results.map((r) => `${r.metric}: ${r.value}`).join('; ')}
Tech: ${story.technologies?.join(', ') || 'N/A'}

CANDIDATE: ${userProfile.education?.degree || 'BS'} in ${userProfile.education?.major || 'CS'} from ${userProfile.education?.school || 'University'}

Generate SHORT (75w), STANDARD (150w), LONG (300w) for: ${categories.join(', ')}

OUTPUT (JSON):
{
  "${categories[0]}": { "short": "...", "standard": "...", "long": "...", "structure_used": "result_first|challenge_first|standard_star" },
  ...
}`;
  }

  /**
   * Check the response cache for a previous result
   */
  private checkResponseCache<T>(key: string): T | null {
    const cached = responseCache.get(key);
    if (cached && Date.now() - cached.timestamp < RESPONSE_CACHE_TTL_MS) {
      return cached.response as T;
    }
    return null;
  }

  /**
   * Store a response in the cache
   */
  private setResponseCache(key: string, response: unknown): void {
    // Evict old entries if cache grows too large
    if (responseCache.size > 100) {
      const oldest = Array.from(responseCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 20);
      for (const [k] of oldest) {
        responseCache.delete(k);
      }
    }
    responseCache.set(key, { response, timestamp: Date.now() });
  }

  /**
   * Generate "Why Company" answers for a specific company
   */
  async generateWhyCompany(
    companyData: CompanyData,
    userProfile: UserProfile,
    relevantStory?: Story
  ): Promise<CompanyAnswerResult> {
    const prompt = buildWhyCompanyPrompt(
      companyData,
      userProfile,
      relevantStory
    );

    try {
      const parsed = await this.generateWithRetry<{
        short: string;
        standard: string;
        long: string;
        company_details_used?: string[];
        candidate_connections?: string[];
      }>(prompt);

      return {
        company_slug: companyData.slug,
        company_name: companyData.name,
        short: parsed.short,
        standard: parsed.standard,
        long: parsed.long,
        details_used: parsed.company_details_used,
        connections: parsed.candidate_connections,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        `Failed to generate Why Company for ${companyData.name}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Bulk generate all answer categories from story bank
   */
  async bulkGenerateAnswerBank(
    storyBank: Story[],
    userProfile: UserProfile
  ): Promise<BulkAnswerResult> {
    // Use a higher token limit for bulk generation
    const bulkModel = this.genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      },
    });

    const prompt = buildBulkGenerationPrompt(storyBank, userProfile);

    try {
      await this.enforceRateLimit();

      const result = await bulkModel.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      // Track costs
      this.trackCosts(response);

      const parsed = JSON.parse(text);

      return {
        answers: parsed,
        generated_at: new Date().toISOString(),
        model: MODEL_NAME,
      };
    } catch (error) {
      console.error('Bulk generation failed:', error);
      throw error;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Generate content with automatic retry on failure
   */
  private async generateWithRetry<T>(prompt: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.enforceRateLimit();

        const result = await this.model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        // Track costs
        this.trackCosts(response);

        return JSON.parse(text) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if it's a rate limit error (429) or server error (5xx)
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable) {
          throw lastError;
        }

        // Exponential backoff
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `Attempt ${attempt + 1}/${MAX_RETRIES} failed, retrying in ${delay}ms...`
        );
        await sleep(delay);
      }
    }

    throw lastError || new Error('Generation failed after max retries');
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('quota') ||
        message.includes('500') ||
        message.includes('503') ||
        message.includes('overloaded') ||
        message.includes('timeout')
      );
    }
    return false;
  }

  /**
   * Enforce rate limiting between requests
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
      const waitTime = MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
      await sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Track token usage and estimated costs
   */
  private trackCosts(response: {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  }): void {
    const usage = response.usageMetadata;
    if (usage) {
      const inputTokens = usage.promptTokenCount || 0;
      const outputTokens = usage.candidatesTokenCount || 0;

      this.costTracker.totalInputTokens += inputTokens;
      this.costTracker.totalOutputTokens += outputTokens;
      this.costTracker.totalCalls += 1;
      this.costTracker.estimatedCostUSD +=
        inputTokens * COST_PER_INPUT_TOKEN +
        outputTokens * COST_PER_OUTPUT_TOKEN;
    }
  }
}

// ============================================================================
// Standalone Functions (for backward compatibility)
// ============================================================================

let defaultService: GenerationService | null = null;

function getDefaultService(): GenerationService {
  if (!defaultService) {
    defaultService = new GenerationService();
  }
  return defaultService;
}

/**
 * Generate answers from a single story for multiple categories
 */
export async function generateFromStory(
  story: Story,
  categories: string[],
  userProfile: UserProfile
): Promise<Record<string, StoryAnswerResult>> {
  return getDefaultService().generateFromStory(story, categories, userProfile);
}

/**
 * Generate "Why Company" answers for a specific company
 */
export async function generateWhyCompany(
  companyData: CompanyData,
  userProfile: UserProfile,
  relevantStory?: Story
): Promise<CompanyAnswerResult> {
  return getDefaultService().generateWhyCompany(
    companyData,
    userProfile,
    relevantStory
  );
}

/**
 * Bulk generate all answer categories from story bank
 */
export async function bulkGenerateAnswerBank(
  storyBank: Story[],
  userProfile: UserProfile
): Promise<BulkAnswerResult> {
  return getDefaultService().bulkGenerateAnswerBank(storyBank, userProfile);
}

/**
 * Get cost tracking stats from default service
 */
export function getCostStats(): CostTracker {
  return getDefaultService().getCostStats();
}

/**
 * Reset cost tracking on default service
 */
export function resetCostStats(): void {
  getDefaultService().resetCostStats();
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  GenerationService,
  generateFromStory,
  generateWhyCompany,
  bulkGenerateAnswerBank,
  getCostStats,
  resetCostStats,
};
