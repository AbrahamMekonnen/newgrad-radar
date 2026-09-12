/**
 * Pre-generation Module for Answer Bank
 *
 * Provides scheduled and batch pre-generation of answers to:
 * 1. Reduce real-time AI costs during job applications
 * 2. Generate answers during off-peak/lower-cost periods
 * 3. Warm caches before application sessions
 *
 * Cost Optimization Strategy:
 * - Generate bulk answers during off-peak hours (2-6 AM)
 * - Pre-generate common behavioral questions (90% reuse rate)
 * - Generate company-specific answers when user adds to "My List"
 * - Use batched prompts to reduce API call count
 */

import {
  GenerationService,
  type Story,
  type UserProfile,
  type CompanyData,
  type BulkAnswerResult,
  type CostTracker,
} from './generation-service';
import { AnswerCache, getAnswerCache, CACHE_TTL } from './cache';

// =============================================================================
// TYPES
// =============================================================================

export interface PreGenerationConfig {
  /** Categories to pre-generate (default: all behavioral) */
  categories?: string[];
  /** Word count variants to generate */
  wordCounts?: ('short' | 'standard' | 'long')[];
  /** Maximum stories to process per batch */
  maxStoriesPerBatch?: number;
  /** Delay between batches (ms) to respect rate limits */
  batchDelayMs?: number;
  /** Whether to skip if answers already exist in cache */
  skipExisting?: boolean;
}

export interface PreGenerationResult {
  userId: string;
  storiesProcessed: number;
  answersGenerated: number;
  categoriesCovered: string[];
  costEstimate: CostTracker;
  errors: string[];
  durationMs: number;
}

export interface ScheduledJobConfig {
  /** Time of day to run (24h format, e.g., "02:00") */
  runAt: string;
  /** Days of week (0=Sun, 1=Mon, etc.) */
  daysOfWeek?: number[];
  /** User IDs to process, or 'all' for all users */
  userScope: string[] | 'all';
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default behavioral categories that have high reuse across applications */
const DEFAULT_BEHAVIORAL_CATEGORIES = [
  'challenging_project',
  'teamwork',
  'failure_learning',
  'problem_solving',
  'achievement',
  'leadership',
];

/** Off-peak hours (UTC) when AI costs may be lower */
const OFF_PEAK_HOURS = {
  start: 2,  // 2 AM UTC
  end: 6,    // 6 AM UTC
};

// =============================================================================
// PRE-GENERATION SERVICE
// =============================================================================

export class PreGenerationService {
  private generationService: GenerationService;
  private cache: AnswerCache;

  constructor(apiKey?: string) {
    this.generationService = new GenerationService(apiKey);
    this.cache = getAnswerCache();
  }

  /**
   * Pre-generate answer bank for a user from their story bank.
   *
   * Best called:
   * - After user completes story bank setup
   * - On a nightly schedule
   * - Before user starts an application session
   */
  async preGenerateForUser(
    userId: string,
    stories: Story[],
    userProfile: UserProfile,
    config: PreGenerationConfig = {}
  ): Promise<PreGenerationResult> {
    const startTime = Date.now();
    const {
      categories = DEFAULT_BEHAVIORAL_CATEGORIES,
      maxStoriesPerBatch = 5,
      batchDelayMs = 2000,
      skipExisting = true,
    } = config;

    const result: PreGenerationResult = {
      userId,
      storiesProcessed: 0,
      answersGenerated: 0,
      categoriesCovered: [],
      costEstimate: { totalInputTokens: 0, totalOutputTokens: 0, totalCalls: 0, estimatedCostUSD: 0 },
      errors: [],
      durationMs: 0,
    };

    console.log(`[PreGeneration] Starting for user ${userId} with ${stories.length} stories`);

    // Check existing cache coverage
    const existingBank = skipExisting ? await this.cache.getAnswerBank(userId) : null;
    const categoriesToGenerate = existingBank
      ? categories.filter((cat) => !existingBank[cat])
      : categories;

    if (categoriesToGenerate.length === 0) {
      console.log(`[PreGeneration] All categories already cached for user ${userId}`);
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Process stories in batches
    const storyBatches = this.chunkArray(stories, maxStoriesPerBatch);

    for (const batch of storyBatches) {
      try {
        const batchResult = await this.generationService.bulkGenerateAnswerBank(
          batch,
          userProfile
        );

        // Cache the results
        await this.cacheGeneratedAnswers(userId, batchResult);

        result.storiesProcessed += batch.length;
        result.answersGenerated += Object.keys(batchResult.answers).length;

        // Add delay between batches to respect rate limits
        if (batchDelayMs > 0) {
          await this.sleep(batchDelayMs);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[PreGeneration] Batch failed:`, errorMsg);
        result.errors.push(errorMsg);
      }
    }

    // Get final cost stats
    result.costEstimate = this.generationService.getCostStats();
    result.categoriesCovered = categoriesToGenerate;
    result.durationMs = Date.now() - startTime;

    console.log(`[PreGeneration] Complete: ${result.answersGenerated} answers in ${result.durationMs}ms`);
    return result;
  }

  /**
   * Pre-generate company-specific answers for user's tracked companies.
   *
   * Best called:
   * - When user adds a company to their "My List"
   * - Before user applies to a specific company
   */
  async preGenerateForCompanies(
    userId: string,
    companies: CompanyData[],
    userProfile: UserProfile,
    relevantStory?: Story
  ): Promise<{ generated: number; errors: string[] }> {
    const errors: string[] = [];
    let generated = 0;

    for (const company of companies) {
      try {
        // Check if already cached
        const cached = await this.cache.getCompanyAnswer(userId, company.slug);
        if (cached) {
          console.log(`[PreGeneration] Skipping ${company.name} - already cached`);
          continue;
        }

        const result = await this.generationService.generateWhyCompany(
          company,
          userProfile,
          relevantStory
        );

        // Cache the result
        await this.cache.setCompanyAnswer(userId, company.slug, {
          companySlug: company.slug,
          companyName: company.name,
          short: result.short,
          standard: result.standard,
          long: result.long,
          detailsUsed: result.details_used,
          connections: result.connections,
          generatedAt: result.generated_at,
        });

        generated++;
        console.log(`[PreGeneration] Generated "Why ${company.name}" answer`);
      } catch (error) {
        const errorMsg = `${company.name}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
      }
    }

    return { generated, errors };
  }

  /**
   * Check if current time is during off-peak hours (cheaper API costs).
   */
  isOffPeakTime(): boolean {
    const hour = new Date().getUTCHours();
    return hour >= OFF_PEAK_HOURS.start && hour < OFF_PEAK_HOURS.end;
  }

  /**
   * Wait until off-peak hours to run generation.
   * Returns immediately if already in off-peak window.
   */
  async waitForOffPeak(): Promise<void> {
    if (this.isOffPeakTime()) {
      return;
    }

    const now = new Date();
    const targetHour = OFF_PEAK_HOURS.start;
    let target = new Date(now);
    target.setUTCHours(targetHour, 0, 0, 0);

    // If target is in the past, add a day
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const waitMs = target.getTime() - now.getTime();
    console.log(`[PreGeneration] Waiting ${Math.round(waitMs / 60000)} minutes for off-peak window`);
    await this.sleep(waitMs);
  }

  /**
   * Estimate cost for pre-generating answers.
   */
  estimateCost(storyCount: number, categoryCount: number = 6): {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
  } {
    // Approximate token counts based on typical prompts and responses
    const tokensPerStory = 500;        // Input context per story
    const tokensPerPrompt = 800;       // Base prompt template
    const tokensPerResponse = 400;     // Average response per category

    const totalInputTokens = storyCount * (tokensPerStory + tokensPerPrompt);
    const totalOutputTokens = categoryCount * tokensPerResponse;

    // Gemini Flash pricing
    const inputCost = totalInputTokens * 0.000000075;
    const outputCost = totalOutputTokens * 0.0000003;

    return {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUSD: inputCost + outputCost,
    };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async cacheGeneratedAnswers(
    userId: string,
    result: BulkAnswerResult
  ): Promise<void> {
    const bank: Record<string, { short?: string; standard?: string; long?: string }> = {};

    for (const [category, answers] of Object.entries(result.answers)) {
      bank[category] = {
        short: answers.short,
        standard: answers.standard,
      };
    }

    await this.cache.setAnswerBank(userId, bank);
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

let defaultPreGenService: PreGenerationService | null = null;

/**
 * Get or create the default PreGenerationService
 */
export function getPreGenerationService(apiKey?: string): PreGenerationService {
  if (!defaultPreGenService) {
    defaultPreGenService = new PreGenerationService(apiKey);
  }
  return defaultPreGenService;
}

// =============================================================================
// EXPORTS
// =============================================================================

export { DEFAULT_BEHAVIORAL_CATEGORIES, OFF_PEAK_HOURS };
export default PreGenerationService;
