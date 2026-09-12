/**
 * Tiered Cache Implementation
 * L1: In-memory LRU cache (fast, limited)
 * L2: File-based persistent cache (slower, larger)
 *
 * Usage:
 *   import { TieredCache } from './cache';
 *   const cache = new TieredCache({ name: 'jobs' });
 *
 *   await cache.set('key', { data: 'value' }, { ttl: 3600 });
 *   const value = await cache.get('key');
 */

import { LRUCache } from 'lru-cache';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions?: number;
  errors?: number;
  size?: number;
  calculatedSize?: number;
  hitRate: number;
  fileCount?: number;
  totalSize?: number;
}

interface L1CacheOptions {
  max?: number;
  maxSize?: number;
  ttl?: number;
}

interface L2CacheOptions {
  cacheDir?: string;
  name?: string;
  ttl?: number;
  maxSize?: number;
  maxFiles?: number;
}

interface TieredCacheOptions {
  name?: string;
  l1Options?: L1CacheOptions;
  l2Options?: L2CacheOptions;
  l1Ttl?: number;
  l2Ttl?: number;
  promoteOnL2Hit?: boolean;
  enableL2?: boolean;
}

interface SetOptions {
  ttl?: number;
  l1Ttl?: number;
  l2Ttl?: number;
  tags?: string[];
}

interface CacheEntry<T extends object> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number | null;
  ttl: number;
}

interface WarmupTask<T extends object> {
  name: string;
  fetchFn: () => Promise<{ keys: string[]; values: T[] }>;
  options?: SetOptions;
}

// =============================================================================
// L1 CACHE: In-Memory LRU
// =============================================================================

/**
 * L1 Memory Cache using LRU eviction
 */
export class L1Cache<T extends object = object> {
  private cache: LRUCache<string, T>;
  private stats: { hits: number; misses: number; sets: number; evictions: number };

  constructor(options: L1CacheOptions = {}) {
    const {
      max = 500, // Max items
      maxSize = 50 * 1024 * 1024, // 50MB max
      ttl = 5 * 60 * 1000, // 5 minute default TTL
    } = options;

    this.cache = new LRUCache<string, T>({
      max,
      maxSize,
      ttl,
      sizeCalculation: (value: T): number => {
        // Estimate size of cached value
        return JSON.stringify(value).length * 2; // ~2 bytes per char
      },
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });

    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.stats.hits++;
      return value;
    }
    this.stats.misses++;
    return undefined;
  }

  set(key: string, value: T, options: { ttl?: number } = {}): void {
    const ttl = options.ttl ? options.ttl * 1000 : undefined;
    this.cache.set(key, value, { ttl });
    this.stats.sets++;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
    };
  }

  keys(): string[] {
    return [...this.cache.keys()];
  }
}

// =============================================================================
// L2 CACHE: File-Based Persistent Cache
// =============================================================================

/**
 * L2 File Cache with JSON persistence
 */
export class L2Cache<T extends object = object> {
  private cacheDir: string;
  private ttl: number;
  private maxSize: number;
  private maxFiles: number;
  private stats: { hits: number; misses: number; sets: number; errors: number };

  constructor(options: L2CacheOptions = {}) {
    const {
      cacheDir = '.cache',
      name = 'default',
      ttl = 24 * 60 * 60, // 24 hour default TTL
      maxSize = 500 * 1024 * 1024, // 500MB max
      maxFiles = 10000,
    } = options;

    this.cacheDir = join(process.cwd(), cacheDir, name);
    this.ttl = ttl;
    this.maxSize = maxSize;
    this.maxFiles = maxFiles;
    this.stats = { hits: 0, misses: 0, sets: 0, errors: 0 };

    // Ensure cache directory exists
    this._ensureDir();
  }

  private _ensureDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private _hashKey(key: string): string {
    // Create a safe filename from key
    return createHash('sha256').update(key).digest('hex').substring(0, 32);
  }

  private _getFilePath(key: string): string {
    const hash = this._hashKey(key);
    // Use first 2 chars as subdirectory for better filesystem performance
    const subdir = hash.substring(0, 2);
    const dir = join(this.cacheDir, subdir);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    return join(dir, `${hash}.json`);
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const filePath = this._getFilePath(key);

      if (!existsSync(filePath)) {
        this.stats.misses++;
        return undefined;
      }

      const content = readFileSync(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Check TTL
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        // Expired - delete and return undefined
        try {
          unlinkSync(filePath);
        } catch {
          // Ignore deletion errors
        }
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
      const ttl = options.ttl || this.ttl;
      const filePath = this._getFilePath(key);

      const entry: CacheEntry<T> = {
        key,
        value,
        createdAt: Date.now(),
        expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
        ttl,
      };

      writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
      this.stats.sets++;

      // Trigger cleanup if needed (async, don't wait)
      this._maybeCleanup();

      return true;
    } catch (error) {
      this.stats.errors++;
      console.error(`[L2Cache] Error writing ${key}:`, (error as Error).message);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const filePath = this._getFilePath(key);
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
    try {
      rmSync(this.cacheDir, { recursive: true, force: true });
      this._ensureDir();
    } catch {
      // Ignore errors
    }
  }

  private _maybeCleanup(): void {
    // Run cleanup periodically (1% chance per write)
    if (Math.random() < 0.01) {
      setImmediate(() => this._cleanup());
    }
  }

  private async _cleanup(): Promise<void> {
    try {
      const files = this._getAllFiles();

      // Remove expired files
      let removed = 0;
      const now = Date.now();

      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf-8');
          const entry: CacheEntry<T> = JSON.parse(content);

          if (entry.expiresAt && now > entry.expiresAt) {
            unlinkSync(file);
            removed++;
          }
        } catch {
          // Invalid file, remove it
          try {
            unlinkSync(file);
            removed++;
          } catch {
            // Ignore
          }
        }
      }

      if (removed > 0) {
        console.log(`[L2Cache] Cleanup: removed ${removed} expired entries`);
      }
    } catch (error) {
      console.error('[L2Cache] Cleanup error:', (error as Error).message);
    }
  }

  private _getAllFiles(): string[] {
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
      } catch {
        // Ignore errors
      }
    };

    walk(this.cacheDir);
    return files;
  }

  getStats(): CacheStats {
    const files = this._getAllFiles();
    let totalSize = 0;

    for (const file of files) {
      try {
        totalSize += statSync(file).size;
      } catch {
        // Ignore errors
      }
    }

    return {
      ...this.stats,
      fileCount: files.length,
      totalSize,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
    };
  }
}

// =============================================================================
// TIERED CACHE: L1 + L2 Combined
// =============================================================================

/**
 * Tiered Cache combining L1 (memory) and L2 (file) caches
 *
 * Flow:
 * GET: L1 -> L2 -> origin (with automatic promotion)
 * SET: L1 + L2 simultaneously
 */
export class TieredCache<T extends object = object> {
  readonly name: string;
  readonly promoteOnL2Hit: boolean;
  readonly enableL2: boolean;
  readonly l1Ttl: number;
  readonly l2Ttl: number;
  readonly l1: L1Cache<T>;
  readonly l2: L2Cache<T> | null;

  constructor(options: TieredCacheOptions = {}) {
    const {
      name = 'default',
      l1Options = {},
      l2Options = {},
      l1Ttl = 5 * 60, // 5 minutes for L1
      l2Ttl = 24 * 60 * 60, // 24 hours for L2
      promoteOnL2Hit = true,
      enableL2 = true,
    } = options;

    this.name = name;
    this.promoteOnL2Hit = promoteOnL2Hit;
    this.enableL2 = enableL2;
    this.l1Ttl = l1Ttl;
    this.l2Ttl = l2Ttl;

    // Initialize caches
    this.l1 = new L1Cache<T>({
      ttl: l1Ttl * 1000,
      ...l1Options,
    });

    if (enableL2) {
      this.l2 = new L2Cache<T>({
        name,
        ttl: l2Ttl,
        ...l2Options,
      });
    } else {
      this.l2 = null;
    }
  }

  /**
   * Get value from cache (L1 -> L2 with promotion)
   */
  async get(key: string): Promise<T | undefined> {
    // Try L1 first
    let value = this.l1.get(key);
    if (value !== undefined) {
      return value;
    }

    // Try L2
    if (this.enableL2 && this.l2) {
      value = await this.l2.get(key);
      if (value !== undefined) {
        // Promote to L1 on L2 hit
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
  async set(key: string, value: T, options: SetOptions = {}): Promise<void> {
    const l1Ttl = options.l1Ttl || options.ttl || this.l1Ttl;
    const l2Ttl = options.l2Ttl || options.ttl || this.l2Ttl;

    // Set in L1
    this.l1.set(key, value, { ttl: l1Ttl });

    // Set in L2 (async, don't wait)
    if (this.enableL2 && this.l2) {
      this.l2.set(key, value, { ttl: l2Ttl }).catch(() => {
        // Ignore L2 write errors
      });
    }
  }

  /**
   * Delete from both tiers
   */
  async delete(key: string): Promise<void> {
    this.l1.delete(key);
    if (this.enableL2 && this.l2) {
      await this.l2.delete(key);
    }
  }

  /**
   * Check if key exists (checks both tiers)
   */
  async has(key: string): Promise<boolean> {
    if (this.l1.has(key)) return true;
    if (this.enableL2 && this.l2) {
      return await this.l2.has(key);
    }
    return false;
  }

  /**
   * Clear both tiers
   */
  async clear(): Promise<void> {
    this.l1.clear();
    if (this.enableL2 && this.l2) {
      await this.l2.clear();
    }
  }

  /**
   * Get stats from both tiers
   */
  getStats(): { l1: CacheStats; l2: CacheStats | null } {
    return {
      l1: this.l1.getStats(),
      l2: this.enableL2 && this.l2 ? this.l2.getStats() : null,
    };
  }

  /**
   * Cache-aside pattern: get with automatic fetch on miss
   */
  async getOrFetch(key: string, fetchFn: () => Promise<T>, options: SetOptions = {}): Promise<T> {
    // Try to get from cache
    let value = await this.get(key);
    if (value !== undefined) {
      return value;
    }

    // Cache miss - fetch from origin
    value = await fetchFn();

    // Store in cache
    if (value !== undefined && value !== null) {
      await this.set(key, value, options);
    }

    return value;
  }

  /**
   * Batch get multiple keys
   */
  async getMany(keys: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const missingKeys: string[] = [];

    // Check L1 for all keys
    for (const key of keys) {
      const value = this.l1.get(key);
      if (value !== undefined) {
        results.set(key, value);
      } else {
        missingKeys.push(key);
      }
    }

    // Check L2 for missing keys
    if (this.enableL2 && this.l2 && missingKeys.length > 0) {
      for (const key of missingKeys) {
        const value = await this.l2.get(key);
        if (value !== undefined) {
          results.set(key, value);
          // Promote to L1
          if (this.promoteOnL2Hit) {
            this.l1.set(key, value, { ttl: this.l1Ttl });
          }
        }
      }
    }

    return results;
  }

  /**
   * Batch set multiple key-value pairs
   */
  async setMany(entries: Array<[string, T]>, options: SetOptions = {}): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value, options);
    }
  }
}

// =============================================================================
// CACHE WARMING
// =============================================================================

/**
 * Cache warmer for pre-loading data on startup
 */
export class CacheWarmer<T extends object = object> {
  private cache: TieredCache<T>;
  private warmupTasks: WarmupTask<T>[] = [];

  constructor(cache: TieredCache<T>) {
    this.cache = cache;
  }

  /**
   * Register a warmup task
   */
  register(name: string, fetchFn: () => Promise<{ keys: string[]; values: T[] }>, options: SetOptions = {}): void {
    this.warmupTasks.push({ name, fetchFn, options });
  }

  /**
   * Run all warmup tasks
   */
  async warmup(): Promise<{ succeeded: number; failed: number; duration: number }> {
    console.log(`[CacheWarmer] Starting warmup with ${this.warmupTasks.length} tasks...`);
    const startTime = Date.now();
    let succeeded = 0;
    let failed = 0;

    for (const task of this.warmupTasks) {
      try {
        console.log(`[CacheWarmer] Warming: ${task.name}`);
        const { keys, values } = await task.fetchFn();

        for (let i = 0; i < keys.length; i++) {
          await this.cache.set(keys[i], values[i], task.options);
        }

        console.log(`[CacheWarmer] Warmed ${keys.length} entries for ${task.name}`);
        succeeded += keys.length;
      } catch (error) {
        console.error(`[CacheWarmer] Failed: ${task.name}:`, (error as Error).message);
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[CacheWarmer] Complete: ${succeeded} entries in ${duration}ms`);

    return { succeeded, failed, duration };
  }

  /**
   * Warm from L2 to L1 (restore hot cache from disk)
   */
  async warmL1FromL2(keys: string[]): Promise<number> {
    if (!this.cache.enableL2 || !this.cache.l2) return 0;

    console.log(`[CacheWarmer] Warming L1 from L2 with ${keys.length} keys...`);
    let warmed = 0;

    for (const key of keys) {
      const value = await this.cache.l2.get(key);
      if (value !== undefined) {
        this.cache.l1.set(key, value);
        warmed++;
      }
    }

    console.log(`[CacheWarmer] Warmed ${warmed}/${keys.length} L1 entries from L2`);
    return warmed;
  }
}

// =============================================================================
// SPECIALIZED CACHES FOR AUTO-APPLY
// =============================================================================

/**
 * Job Application Cache
 * Caches job page data, form field mappings, company info
 */
export class JobApplicationCache extends TieredCache<Record<string, unknown>> {
  constructor() {
    super({
      name: 'job-applications',
      l1Ttl: 30 * 60, // 30 min L1 (active session)
      l2Ttl: 7 * 24 * 60 * 60, // 7 days L2 (job listings change)
    });
  }

  // Cache keys
  static jobKey(url: string): string {
    return `job:${createHash('md5').update(url).digest('hex')}`;
  }

  static formKey(url: string): string {
    return `form:${createHash('md5').update(url).digest('hex')}`;
  }

  static companyKey(company: string): string {
    return `company:${company.toLowerCase().replace(/\s+/g, '-')}`;
  }

  // Convenience methods
  async getJobData(url: string): Promise<Record<string, unknown> | undefined> {
    return this.get(JobApplicationCache.jobKey(url));
  }

  async setJobData(url: string, data: Record<string, unknown>): Promise<void> {
    return this.set(JobApplicationCache.jobKey(url), data);
  }

  async getFormFields(url: string): Promise<Record<string, unknown> | undefined> {
    return this.get(JobApplicationCache.formKey(url));
  }

  async setFormFields(url: string, fields: Record<string, unknown>): Promise<void> {
    return this.set(JobApplicationCache.formKey(url), fields, {
      l1Ttl: 60 * 60, // 1 hour in L1
      l2Ttl: 30 * 24 * 60 * 60, // 30 days in L2 (forms rarely change)
    });
  }

  async getCompanyInfo(company: string): Promise<Record<string, unknown> | undefined> {
    return this.get(JobApplicationCache.companyKey(company));
  }

  async setCompanyInfo(company: string, info: Record<string, unknown>): Promise<void> {
    return this.set(JobApplicationCache.companyKey(company), info, {
      l1Ttl: 24 * 60 * 60, // 24 hours L1
      l2Ttl: 90 * 24 * 60 * 60, // 90 days L2
    });
  }
}

/**
 * ATS Pattern Cache
 * Caches ATS-specific field mappings and selectors
 */
export class ATSPatternCache extends TieredCache<Record<string, unknown>> {
  constructor() {
    super({
      name: 'ats-patterns',
      l1Ttl: 24 * 60 * 60, // 24 hours (patterns rarely change)
      l2Ttl: 90 * 24 * 60 * 60, // 90 days
    });
  }

  async getFieldMapping(ats: string, fieldType: string): Promise<Record<string, unknown> | undefined> {
    const key = `${ats}:field:${fieldType}`;
    return this.get(key);
  }

  async setFieldMapping(ats: string, fieldType: string, mapping: Record<string, unknown>): Promise<void> {
    const key = `${ats}:field:${fieldType}`;
    return this.set(key, mapping);
  }

  async getSelector(ats: string, element: string): Promise<Record<string, unknown> | undefined> {
    const key = `${ats}:selector:${element}`;
    return this.get(key);
  }

  async setSelector(ats: string, element: string, selector: Record<string, unknown>): Promise<void> {
    const key = `${ats}:selector:${element}`;
    return this.set(key, selector);
  }
}

/**
 * H1B Salary Cache
 * Caches salary data from H1B lookups
 */
export class SalaryCache extends TieredCache<Record<string, unknown>> {
  constructor() {
    super({
      name: 'salary-data',
      l1Ttl: 60 * 60, // 1 hour L1
      l2Ttl: 30 * 24 * 60 * 60, // 30 days L2 (salary data is quarterly)
    });
  }

  async getSalaryRange(company: string, title?: string): Promise<Record<string, unknown> | undefined> {
    const key = `salary:${company.toLowerCase()}:${(title || 'all').toLowerCase()}`;
    return this.get(key);
  }

  async setSalaryRange(company: string, title: string | undefined, range: Record<string, unknown>): Promise<void> {
    const key = `salary:${company.toLowerCase()}:${(title || 'all').toLowerCase()}`;
    return this.set(key, range);
  }
}

// =============================================================================
// TTL CONSTANTS
// =============================================================================

export const TTL = {
  // Hot data - changes frequently or during session
  SESSION: 30 * 60, // 30 minutes
  ACTIVE_JOB: 1 * 60 * 60, // 1 hour

  // Warm data - changes daily
  DAILY: 24 * 60 * 60, // 24 hours

  // Cold data - rarely changes
  WEEKLY: 7 * 24 * 60 * 60, // 7 days
  MONTHLY: 30 * 24 * 60 * 60, // 30 days
  QUARTERLY: 90 * 24 * 60 * 60, // 90 days
} as const;

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default TieredCache;
