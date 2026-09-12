/**
 * Answer Cache Implementation
 *
 * Tiered caching (L1 memory + L2 file) for pre-generated answers.
 * Integrates with the TieredCache system for job applications.
 *
 * Features:
 * - L1 (memory): Fast access for hot answers during session
 * - L2 (file): Persistent storage across restarts
 * - TTL management: 30 days for stories, 7 days for companies
 * - Cache warming on initialization
 * - Key builders for story/company answers
 */

import { createHash } from 'crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync
} from 'fs';
import { join } from 'path';

// =============================================================================
// TYPES
// =============================================================================

export interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number | null;
  ttl: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  errors?: number;
  size?: number;
  calculatedSize?: number;
  fileCount?: number;
  totalSize?: number;
  hitRate: number;
}

export interface AnswerVariants {
  short?: string;
  standard?: string;
  long?: string;
}

export interface StoryAnswer extends AnswerVariants {
  storyId: string;
  category: string;
  structure?: string;
  generatedAt: string;
}

export interface CompanyAnswer extends AnswerVariants {
  companySlug: string;
  companyName: string;
  detailsUsed?: string[];
  connections?: string[];
  generatedAt: string;
}

export interface WarmupTask<T = unknown> {
  name: string;
  fetchFn: () => Promise<{ keys: string[]; values: T[] }>;
  options?: { ttl?: number };
}

// =============================================================================
// TTL CONSTANTS (in seconds)
// =============================================================================

export const CACHE_TTL = {
  /** Story-based answers - rarely change (30 days) */
  STORY_ANSWERS: 30 * 24 * 60 * 60,

  /** Company-specific answers - may need updates (7 days) */
  COMPANY_ANSWERS: 7 * 24 * 60 * 60,

  /** Compiled profile data (24 hours) */
  PROFILE_COMPILED: 24 * 60 * 60,

  /** L1 memory cache default (1 hour) */
  L1_DEFAULT: 60 * 60,

  /** Session-only data (30 minutes) */
  SESSION: 30 * 60,
} as const;

// =============================================================================
// L1 CACHE: In-Memory LRU Implementation
// =============================================================================

interface L1CacheOptions {
  max?: number;
  maxSize?: number;
  ttl?: number;
}

class L1Cache<T = unknown> {
  private cache: Map<string, { value: T; expiresAt: number | null; size: number }>;
  private readonly max: number;
  private readonly maxSize: number;
  private readonly defaultTtl: number;
  private currentSize: number = 0;
  private stats: { hits: number; misses: number; sets: number; evictions: number };

  constructor(options: L1CacheOptions = {}) {
    const {
      max = 500,
      maxSize = 50 * 1024 * 1024, // 50MB
      ttl = 5 * 60 * 1000, // 5 minutes default
    } = options;

    this.max = max;
    this.maxSize = maxSize;
    this.defaultTtl = ttl;
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  private estimateSize(value: T): number {
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 1000; // Default estimate for non-serializable values
    }
  }

  private isExpired(entry: { expiresAt: number | null }): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private evictIfNeeded(): void {
    // Evict if over max items
    while (this.cache.size >= this.max) {
      const keys = Array.from(this.cache.keys());
      const firstKey = keys[0];
      if (firstKey) {
        this.delete(firstKey);
        this.stats.evictions++;
      } else {
        break;
      }
    }

    // Evict if over max size
    while (this.currentSize > this.maxSize && this.cache.size > 0) {
      const keys = Array.from(this.cache.keys());
      const firstKey = keys[0];
      if (firstKey) {
        this.delete(firstKey);
        this.stats.evictions++;
      } else {
        break;
      }
    }
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: T, options: { ttl?: number } = {}): void {
    const ttl = options.ttl !== undefined ? options.ttl * 1000 : this.defaultTtl;
    const size = this.estimateSize(value);
    const expiresAt = ttl > 0 ? Date.now() + ttl : null;

    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Evict old entries if needed
    this.evictIfNeeded();

    this.cache.set(key, { value, expiresAt, size });
    this.currentSize += size;
    this.stats.sets++;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      calculatedSize: this.currentSize,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }
}

// =============================================================================
// L2 CACHE: File-Based Persistent Cache
// =============================================================================

interface L2CacheOptions {
  cacheDir?: string;
  name?: string;
  ttl?: number;
  maxSize?: number;
  maxFiles?: number;
}

class L2Cache<T = unknown> {
  private readonly cacheDir: string;
  private readonly defaultTtl: number;
  private readonly maxSize: number;
  private readonly maxFiles: number;
  private stats: { hits: number; misses: number; sets: number; errors: number };

  constructor(options: L2CacheOptions = {}) {
    const {
      cacheDir = '.cache',
      name = 'answers',
      ttl = 24 * 60 * 60,
      maxSize = 500 * 1024 * 1024,
      maxFiles = 10000,
    } = options;

    this.cacheDir = join(process.cwd(), cacheDir, name);
    this.defaultTtl = ttl;
    this.maxSize = maxSize;
    this.maxFiles = maxFiles;
    this.stats = { hits: 0, misses: 0, sets: 0, errors: 0 };

    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').substring(0, 32);
  }

  private getFilePath(key: string): string {
    const hash = this.hashKey(key);
    const subdir = hash.substring(0, 2);
    const dir = join(this.cacheDir, subdir);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    return join(dir, `${hash}.json`);
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const filePath = this.getFilePath(key);

      if (!existsSync(filePath)) {
        this.stats.misses++;
        return undefined;
      }

      const content = readFileSync(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Check TTL
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        try { unlinkSync(filePath); } catch { /* ignore */ }
        this.stats.misses++;
        return undefined;
      }

      this.stats.hits++;
      return entry.value;
    } catch (error) {
      this.stats.errors++;
      console.error(`[L2Cache] Error reading ${key}:`, (error as Error).message);
      return undefined;
    }
  }

  async set(key: string, value: T, options: { ttl?: number } = {}): Promise<boolean> {
    try {
      const ttl = options.ttl ?? this.defaultTtl;
      const filePath = this.getFilePath(key);

      const entry: CacheEntry<T> = {
        key,
        value,
        createdAt: Date.now(),
        expiresAt: ttl > 0 ? Date.now() + (ttl * 1000) : null,
        ttl,
      };

      writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
      this.stats.sets++;

      // Trigger cleanup occasionally
      this.maybeCleanup();

      return true;
    } catch (error) {
      this.stats.errors++;
      console.error(`[L2Cache] Error writing ${key}:`, (error as Error).message);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(key);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  async clear(): Promise<void> {
    const { rmSync } = await import('fs');
    try {
      rmSync(this.cacheDir, { recursive: true, force: true });
      this.ensureDir();
    } catch { /* ignore */ }
  }

  private maybeCleanup(): void {
    // 1% chance per write to trigger cleanup
    if (Math.random() < 0.01) {
      setImmediate(() => this.cleanup());
    }
  }

  private async cleanup(): Promise<void> {
    try {
      const files = this.getAllFiles();
      const now = Date.now();
      let removed = 0;

      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf-8');
          const entry: CacheEntry<unknown> = JSON.parse(content);

          if (entry.expiresAt && now > entry.expiresAt) {
            unlinkSync(file);
            removed++;
          }
        } catch {
          // Invalid file, remove it
          try { unlinkSync(file); removed++; } catch { /* ignore */ }
        }
      }

      if (removed > 0) {
        console.log(`[L2Cache] Cleanup: removed ${removed} expired entries`);
      }
    } catch (error) {
      console.error('[L2Cache] Cleanup error:', (error as Error).message);
    }
  }

  private getAllFiles(): string[] {
    const files: string[] = [];

    const walk = (dir: string): void => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.name.endsWith('.json')) {
            files.push(fullPath);
          }
        }
      } catch { /* ignore */ }
    };

    walk(this.cacheDir);
    return files;
  }

  getStats(): CacheStats {
    const files = this.getAllFiles();
    let totalSize = 0;

    for (const file of files) {
      try {
        totalSize += statSync(file).size;
      } catch { /* ignore */ }
    }

    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      fileCount: files.length,
      totalSize,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }
}

// =============================================================================
// ANSWER CACHE: Specialized Cache for Story and Company Answers
// =============================================================================

export interface AnswerCacheOptions {
  name?: string;
  cacheDir?: string;
  l1Ttl?: number;
  l2Ttl?: number;
  promoteOnL2Hit?: boolean;
  enableL2?: boolean;
}

export class AnswerCache {
  private readonly l1: L1Cache<StoryAnswer | CompanyAnswer | unknown>;
  private readonly l2: L2Cache<StoryAnswer | CompanyAnswer | unknown>;
  private readonly promoteOnL2Hit: boolean;
  private readonly enableL2: boolean;
  private readonly l1Ttl: number;
  private readonly l2Ttl: number;
  private readonly name: string;

  constructor(options: AnswerCacheOptions = {}) {
    const {
      name = 'answers',
      cacheDir = '.cache',
      l1Ttl = CACHE_TTL.L1_DEFAULT,
      l2Ttl = CACHE_TTL.STORY_ANSWERS,
      promoteOnL2Hit = true,
      enableL2 = true,
    } = options;

    this.name = name;
    this.l1Ttl = l1Ttl;
    this.l2Ttl = l2Ttl;
    this.promoteOnL2Hit = promoteOnL2Hit;
    this.enableL2 = enableL2;

    this.l1 = new L1Cache({
      max: 500,
      maxSize: 50 * 1024 * 1024,
      ttl: l1Ttl * 1000,
    });

    this.l2 = new L2Cache({
      name,
      cacheDir,
      ttl: l2Ttl,
    });
  }

  // ===========================================================================
  // CACHE KEY BUILDERS
  // ===========================================================================

  /**
   * Build cache key for story-based answers
   */
  static storyAnswerKey(userId: string, storyId: string, category: string, length: string = 'standard'): string {
    return `story:${userId}:${storyId}:${category}:${length}`;
  }

  /**
   * Build cache key for company-specific answers
   */
  static companyAnswerKey(userId: string, companySlug: string, length: string = 'standard'): string {
    return `company:${userId}:${companySlug}:${length}`;
  }

  /**
   * Build cache key for question category answers
   */
  static categoryAnswerKey(userId: string, category: string, length: string = 'standard'): string {
    return `category:${userId}:${category}:${length}`;
  }

  /**
   * Build cache key for compiled answer bank
   */
  static answerBankKey(userId: string): string {
    return `bank:${userId}`;
  }

  // ===========================================================================
  // CORE CACHE OPERATIONS
  // ===========================================================================

  /**
   * Get value from cache (L1 -> L2 with promotion)
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    // Try L1 first
    let value = this.l1.get(key) as T | undefined;
    if (value !== undefined) {
      return value;
    }

    // Try L2
    if (this.enableL2) {
      value = await this.l2.get(key) as T | undefined;
      if (value !== undefined) {
        // Promote to L1 on hit
        if (this.promoteOnL2Hit) {
          this.l1.set(key, value, { ttl: this.l1Ttl });
        }
        return value;
      }
    }

    return undefined;
  }

  /**
   * Set value in both cache tiers
   */
  async set<T = unknown>(key: string, value: T, options: { l1Ttl?: number; l2Ttl?: number; ttl?: number } = {}): Promise<void> {
    const l1Ttl = options.l1Ttl ?? options.ttl ?? this.l1Ttl;
    const l2Ttl = options.l2Ttl ?? options.ttl ?? this.l2Ttl;

    // Set in L1
    this.l1.set(key, value, { ttl: l1Ttl });

    // Set in L2 (async, don't wait)
    if (this.enableL2) {
      this.l2.set(key, value, { ttl: l2Ttl }).catch(() => { /* ignore */ });
    }
  }

  /**
   * Delete from both tiers
   */
  async delete(key: string): Promise<void> {
    this.l1.delete(key);
    if (this.enableL2) {
      await this.l2.delete(key);
    }
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    if (this.l1.has(key)) return true;
    if (this.enableL2) {
      return await this.l2.has(key);
    }
    return false;
  }

  /**
   * Clear both tiers
   */
  async clear(): Promise<void> {
    this.l1.clear();
    if (this.enableL2) {
      await this.l2.clear();
    }
  }

  // ===========================================================================
  // STORY ANSWER METHODS
  // ===========================================================================

  /**
   * Get story-based answer from cache
   */
  async getStoryAnswer(userId: string, storyId: string, category: string, length: string = 'standard'): Promise<StoryAnswer | undefined> {
    const key = AnswerCache.storyAnswerKey(userId, storyId, category, length);
    return this.get<StoryAnswer>(key);
  }

  /**
   * Cache a story-based answer
   */
  async setStoryAnswer(userId: string, storyId: string, category: string, answer: StoryAnswer, length: string = 'standard'): Promise<void> {
    const key = AnswerCache.storyAnswerKey(userId, storyId, category, length);
    await this.set(key, answer, {
      l1Ttl: CACHE_TTL.L1_DEFAULT,
      l2Ttl: CACHE_TTL.STORY_ANSWERS,
    });
  }

  /**
   * Get all variants of a story answer
   */
  async getStoryAnswerVariants(userId: string, storyId: string, category: string): Promise<AnswerVariants> {
    const [short, standard, long] = await Promise.all([
      this.getStoryAnswer(userId, storyId, category, 'short'),
      this.getStoryAnswer(userId, storyId, category, 'standard'),
      this.getStoryAnswer(userId, storyId, category, 'long'),
    ]);

    return {
      short: short?.short,
      standard: standard?.standard,
      long: long?.long,
    };
  }

  // ===========================================================================
  // COMPANY ANSWER METHODS
  // ===========================================================================

  /**
   * Get company-specific answer from cache
   */
  async getCompanyAnswer(userId: string, companySlug: string, length: string = 'standard'): Promise<CompanyAnswer | undefined> {
    const key = AnswerCache.companyAnswerKey(userId, companySlug, length);
    return this.get<CompanyAnswer>(key);
  }

  /**
   * Cache a company-specific answer
   */
  async setCompanyAnswer(userId: string, companySlug: string, answer: CompanyAnswer, length: string = 'standard'): Promise<void> {
    const key = AnswerCache.companyAnswerKey(userId, companySlug, length);
    await this.set(key, answer, {
      l1Ttl: CACHE_TTL.L1_DEFAULT,
      l2Ttl: CACHE_TTL.COMPANY_ANSWERS,
    });
  }

  /**
   * Get all variants of a company answer
   */
  async getCompanyAnswerVariants(userId: string, companySlug: string): Promise<AnswerVariants> {
    const [short, standard, long] = await Promise.all([
      this.getCompanyAnswer(userId, companySlug, 'short'),
      this.getCompanyAnswer(userId, companySlug, 'standard'),
      this.getCompanyAnswer(userId, companySlug, 'long'),
    ]);

    return {
      short: short?.short,
      standard: standard?.standard,
      long: long?.long,
    };
  }

  // ===========================================================================
  // ANSWER BANK METHODS
  // ===========================================================================

  /**
   * Get the full answer bank for a user
   */
  async getAnswerBank(userId: string): Promise<Record<string, AnswerVariants> | undefined> {
    const key = AnswerCache.answerBankKey(userId);
    return this.get<Record<string, AnswerVariants>>(key);
  }

  /**
   * Cache the full answer bank for a user
   */
  async setAnswerBank(userId: string, bank: Record<string, AnswerVariants>): Promise<void> {
    const key = AnswerCache.answerBankKey(userId);
    await this.set(key, bank, {
      l1Ttl: CACHE_TTL.L1_DEFAULT,
      l2Ttl: CACHE_TTL.STORY_ANSWERS,
    });
  }

  // ===========================================================================
  // CACHE-ASIDE PATTERN
  // ===========================================================================

  /**
   * Get value from cache or fetch from origin
   */
  async getOrFetch<T>(key: string, fetchFn: () => Promise<T>, options: { ttl?: number } = {}): Promise<T> {
    // Try cache first
    let value = await this.get<T>(key);
    if (value !== undefined) {
      return value;
    }

    // Fetch from origin
    value = await fetchFn();

    // Cache the result
    if (value !== undefined && value !== null) {
      await this.set(key, value, options);
    }

    return value;
  }

  // ===========================================================================
  // BATCH OPERATIONS
  // ===========================================================================

  /**
   * Get multiple keys at once
   */
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const missingKeys: string[] = [];

    // Check L1 for all keys
    for (const key of keys) {
      const value = this.l1.get(key) as T | undefined;
      if (value !== undefined) {
        results.set(key, value);
      } else {
        missingKeys.push(key);
      }
    }

    // Check L2 for missing keys
    if (this.enableL2 && missingKeys.length > 0) {
      for (const key of missingKeys) {
        const value = await this.l2.get(key) as T | undefined;
        if (value !== undefined) {
          results.set(key, value);
          if (this.promoteOnL2Hit) {
            this.l1.set(key, value, { ttl: this.l1Ttl });
          }
        }
      }
    }

    return results;
  }

  /**
   * Set multiple key-value pairs
   */
  async setMany<T>(entries: [string, T][], options: { ttl?: number } = {}): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value, options);
    }
  }

  // ===========================================================================
  // STATS AND DIAGNOSTICS
  // ===========================================================================

  /**
   * Get cache statistics from both tiers
   */
  getStats(): { l1: CacheStats; l2: CacheStats | null } {
    return {
      l1: this.l1.getStats(),
      l2: this.enableL2 ? this.l2.getStats() : null,
    };
  }
}

// =============================================================================
// CACHE WARMER
// =============================================================================

export class AnswerCacheWarmer {
  private readonly cache: AnswerCache;
  private warmupTasks: WarmupTask[] = [];

  constructor(cache: AnswerCache) {
    this.cache = cache;
  }

  /**
   * Register a warmup task
   */
  register<T>(name: string, fetchFn: () => Promise<{ keys: string[]; values: T[] }>, options?: { ttl?: number }): void {
    this.warmupTasks.push({ name, fetchFn, options });
  }

  /**
   * Run all warmup tasks
   */
  async warmup(): Promise<{ succeeded: number; failed: number; duration: number }> {
    console.log(`[AnswerCacheWarmer] Starting warmup with ${this.warmupTasks.length} tasks...`);
    const startTime = Date.now();
    let succeeded = 0;
    let failed = 0;

    for (const task of this.warmupTasks) {
      try {
        console.log(`[AnswerCacheWarmer] Warming: ${task.name}`);
        const { keys, values } = await task.fetchFn();

        for (let i = 0; i < keys.length; i++) {
          await this.cache.set(keys[i], values[i], task.options);
        }

        console.log(`[AnswerCacheWarmer] Warmed ${keys.length} entries for ${task.name}`);
        succeeded += keys.length;
      } catch (error) {
        console.error(`[AnswerCacheWarmer] Failed: ${task.name}:`, (error as Error).message);
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[AnswerCacheWarmer] Complete: ${succeeded} entries in ${duration}ms`);

    return { succeeded, failed, duration };
  }

  /**
   * Warm L1 from L2 for specific keys
   */
  async warmL1FromL2(keys: string[]): Promise<number> {
    console.log(`[AnswerCacheWarmer] Warming L1 from L2 with ${keys.length} keys...`);
    let warmed = 0;

    for (const key of keys) {
      const value = await this.cache.get(key);
      if (value !== undefined) {
        warmed++;
      }
    }

    console.log(`[AnswerCacheWarmer] Warmed ${warmed}/${keys.length} L1 entries from L2`);
    return warmed;
  }

  /**
   * Warm common answer categories for a user
   */
  async warmUserAnswers(userId: string, categories: string[]): Promise<number> {
    const keys = categories.flatMap(category => [
      AnswerCache.categoryAnswerKey(userId, category, 'short'),
      AnswerCache.categoryAnswerKey(userId, category, 'standard'),
      AnswerCache.categoryAnswerKey(userId, category, 'long'),
    ]);

    return this.warmL1FromL2(keys);
  }
}

// =============================================================================
// FACTORY AND SINGLETON
// =============================================================================

let defaultCache: AnswerCache | null = null;

/**
 * Get or create the default AnswerCache instance
 */
export function getAnswerCache(options?: AnswerCacheOptions): AnswerCache {
  if (!defaultCache) {
    defaultCache = new AnswerCache(options);
  }
  return defaultCache;
}

/**
 * Create a new AnswerCache instance with cache warming
 */
export async function createWarmedAnswerCache(options?: AnswerCacheOptions): Promise<AnswerCache> {
  const cache = new AnswerCache(options);
  const warmer = new AnswerCacheWarmer(cache);

  // Register default warmup tasks
  warmer.register('common-categories', async () => {
    // This would typically load from database or file
    // For now, return empty to be populated by the caller
    return { keys: [], values: [] };
  });

  await warmer.warmup();
  return cache;
}

// =============================================================================
// SEMANTIC CACHE - Deduplicates similar questions
// =============================================================================

/**
 * SemanticCache provides fuzzy matching for similar questions to maximize cache hits.
 *
 * Problem: Same question asked different ways:
 * - "Tell me about a challenging project"
 * - "Describe a difficult project you worked on"
 * - "What's a complex project you completed?"
 *
 * Solution: Normalize questions to canonical forms and cache by normalized key.
 */
export class SemanticAnswerCache {
  private cache: AnswerCache;
  private normalizationMap: Map<string, string>;

  constructor(cache?: AnswerCache) {
    this.cache = cache || getAnswerCache();
    this.normalizationMap = new Map();
  }

  /**
   * Normalize a question to its canonical form for cache lookup.
   */
  private normalizeQuestion(question: string): string {
    let normalized = question.toLowerCase().trim();

    // Remove common prefixes
    const prefixes = [
      'tell me about',
      'describe',
      'can you tell me',
      'please describe',
      'what is',
      'what are',
      "what's",
      'share',
      'provide an example of',
    ];
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length).trim();
        break;
      }
    }

    // Normalize common synonyms
    const synonyms: Record<string, string> = {
      'difficult': 'challenging',
      'complex': 'challenging',
      'tough': 'challenging',
      'hard': 'challenging',
      'failure': 'mistake',
      'setback': 'mistake',
      'error': 'mistake',
      'accomplishment': 'achievement',
      'success': 'achievement',
      'collaboration': 'teamwork',
      'working with others': 'teamwork',
      'group work': 'teamwork',
    };

    for (const [synonym, canonical] of Object.entries(synonyms)) {
      normalized = normalized.replace(new RegExp(synonym, 'g'), canonical);
    }

    // Remove punctuation and extra whitespace
    normalized = normalized.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

    // Take first 50 characters as key (questions with same start are likely same)
    return normalized.slice(0, 50);
  }

  /**
   * Get answer using semantic matching
   */
  async get(
    userId: string,
    question: string,
    length: 'short' | 'standard' | 'long' = 'standard'
  ): Promise<{ short?: string; standard?: string; long?: string } | undefined> {
    const normalized = this.normalizeQuestion(question);
    const key = `semantic:${userId}:${normalized}:${length}`;

    // Check if we have a mapping to a category answer
    const mappedCategory = this.normalizationMap.get(normalized);
    if (mappedCategory) {
      const categoryKey = AnswerCache.categoryAnswerKey(userId, mappedCategory, length);
      const answer = await this.cache.get<StoryAnswer>(categoryKey);
      if (answer) {
        return { short: answer.short, standard: answer.standard, long: answer.long };
      }
    }

    // Try direct key lookup
    return this.cache.get(key);
  }

  /**
   * Set answer with semantic key
   */
  async set(
    userId: string,
    question: string,
    answer: { short?: string; standard?: string; long?: string },
    category?: string
  ): Promise<void> {
    const normalized = this.normalizeQuestion(question);
    const key = `semantic:${userId}:${normalized}:all`;

    await this.cache.set(key, answer, { ttl: CACHE_TTL.STORY_ANSWERS });

    // Store mapping to category for future lookups
    if (category) {
      this.normalizationMap.set(normalized, category);
    }
  }

  /**
   * Get semantic cache hit rate estimate
   */
  getHitRateEstimate(): number {
    const stats = this.cache.getStats();
    const l1Stats = stats.l1;
    return l1Stats.hitRate;
  }
}

// =============================================================================
// PREFETCH MANAGER - Anticipates needed answers
// =============================================================================

/**
 * PrefetchManager predicts which answers will be needed and pre-loads them.
 *
 * Strategies:
 * 1. When user views a company, prefetch "Why Company" answers
 * 2. When user starts application, prefetch all behavioral answers
 * 3. Based on ATS type, prefetch commonly asked question categories
 */
export class PrefetchManager {
  private cache: AnswerCache;
  private prefetchQueue: Set<string>;
  private isPrefetching: boolean;

  constructor(cache?: AnswerCache) {
    this.cache = cache || getAnswerCache();
    this.prefetchQueue = new Set();
    this.isPrefetching = false;
  }

  /**
   * Queue a key for prefetch
   */
  queuePrefetch(key: string): void {
    this.prefetchQueue.add(key);
    this.processPrefetchQueue();
  }

  /**
   * Prefetch answers for starting an application
   */
  async prefetchForApplication(userId: string, companySlug: string): Promise<void> {
    // Queue common behavioral categories
    const categories = [
      'challenging_project',
      'teamwork',
      'problem_solving',
      'achievement',
      'failure_learning',
    ];

    for (const category of categories) {
      const keys = [
        AnswerCache.categoryAnswerKey(userId, category, 'short'),
        AnswerCache.categoryAnswerKey(userId, category, 'standard'),
      ];
      keys.forEach((k) => this.queuePrefetch(k));
    }

    // Queue company-specific answer
    const companyKeys = [
      AnswerCache.companyAnswerKey(userId, companySlug, 'short'),
      AnswerCache.companyAnswerKey(userId, companySlug, 'standard'),
      AnswerCache.companyAnswerKey(userId, companySlug, 'long'),
    ];
    companyKeys.forEach((k) => this.queuePrefetch(k));
  }

  /**
   * Prefetch based on ATS type (different ATS ask different questions)
   */
  async prefetchForATS(userId: string, atsType: string): Promise<void> {
    const atsCategoryMap: Record<string, string[]> = {
      greenhouse: ['challenging_project', 'teamwork', 'why_role'],
      lever: ['achievement', 'problem_solving', 'career_goals'],
      ashby: ['teamwork', 'leadership', 'why_company'],
      jobvite: ['challenging_project', 'strengths', 'weaknesses'],
    };

    const categories = atsCategoryMap[atsType] || ['challenging_project', 'teamwork'];

    for (const category of categories) {
      const key = AnswerCache.categoryAnswerKey(userId, category, 'standard');
      this.queuePrefetch(key);
    }
  }

  /**
   * Process the prefetch queue in background
   */
  private async processPrefetchQueue(): Promise<void> {
    if (this.isPrefetching || this.prefetchQueue.size === 0) {
      return;
    }

    this.isPrefetching = true;

    try {
      const keys = Array.from(this.prefetchQueue);
      this.prefetchQueue.clear();

      // Process in batches of 10
      const batchSize = 10;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await this.cache.getMany<unknown>(batch);
        // Small delay between batches
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      this.isPrefetching = false;
    }

    // Process any new items added during prefetch
    if (this.prefetchQueue.size > 0) {
      setImmediate(() => this.processPrefetchQueue());
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

let semanticCache: SemanticAnswerCache | null = null;
let prefetchManager: PrefetchManager | null = null;

export function getSemanticCache(): SemanticAnswerCache {
  if (!semanticCache) {
    semanticCache = new SemanticAnswerCache();
  }
  return semanticCache;
}

export function getPrefetchManager(): PrefetchManager {
  if (!prefetchManager) {
    prefetchManager = new PrefetchManager();
  }
  return prefetchManager;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default AnswerCache;
