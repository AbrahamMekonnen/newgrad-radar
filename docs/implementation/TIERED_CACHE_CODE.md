# Tiered Cache Implementation for NewGrad Radar

Complete implementation of L1 (memory) + L2 (file/disk) tiered caching for the auto-apply system.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Dependencies](#dependencies)
3. [Core Implementation](#core-implementation)
4. [Integration Examples](#integration-examples)
5. [Cache Warming](#cache-warming)
6. [What to Cache Where](#what-to-cache-where)
7. [Performance Benchmarks](#performance-benchmarks)
8. [TTL and Invalidation Strategies](#ttl-and-invalidation-strategies)

---

## Architecture Overview

```
+------------------+     miss     +------------------+     miss     +------------------+
|   Application    | ----------> |    L1 Cache      | ----------> |    L2 Cache      |
|    (Request)     |             |   (Memory/LRU)   |             |   (File/Disk)    |
+------------------+             +------------------+             +------------------+
        ^                               |                               |
        |                               | hit                           | hit
        +-------------------------------+-------------------------------+
                            (promote to L1 on L2 hit)
```

**L1 (Memory Cache)**
- Ultra-fast access (~0.001ms)
- Limited by RAM
- Lost on process restart
- Use: Hot data, frequently accessed

**L2 (File/Disk Cache)**
- Slower access (~1-5ms)
- Larger capacity
- Persists across restarts
- Use: Warm data, expensive computations

---

## Dependencies

```bash
# In auto-apply directory
cd /Users/amekonnen/Personal/newgrad-radar/auto-apply
npm install lru-cache
```

Or for the main Next.js app:
```bash
npm install lru-cache
```

**Library Comparison**

| Library | Type | Features | Best For |
|---------|------|----------|----------|
| `lru-cache` | Memory | LRU eviction, TTL, max size | L1 cache, hot data |
| `node-cache` | Memory | Simple TTL, events | Basic caching needs |
| `keyv` | Multi-backend | Redis, SQLite, file | Unified interface |
| `flat-cache` | File | JSON persistence | L2 cache, persistence |

---

## Core Implementation

### `tiered-cache.js` - Complete Implementation

```javascript
/**
 * Tiered Cache Implementation
 * L1: In-memory LRU cache (fast, limited)
 * L2: File-based persistent cache (slower, larger)
 * 
 * Usage:
 *   import { TieredCache } from './tiered-cache.js';
 *   const cache = new TieredCache({ name: 'jobs' });
 *   
 *   await cache.set('key', { data: 'value' }, { ttl: 3600 });
 *   const value = await cache.get('key');
 */

import { LRUCache } from 'lru-cache';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

// =============================================================================
// L1 CACHE: In-Memory LRU
// =============================================================================

/**
 * L1 Memory Cache using LRU eviction
 */
class L1Cache {
  constructor(options = {}) {
    const {
      max = 500,           // Max items
      maxSize = 50 * 1024 * 1024, // 50MB max
      ttl = 5 * 60 * 1000, // 5 minute default TTL
    } = options;

    this.cache = new LRUCache({
      max,
      maxSize,
      ttl,
      sizeCalculation: (value) => {
        // Estimate size of cached value
        return JSON.stringify(value).length * 2; // ~2 bytes per char
      },
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });

    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.stats.hits++;
      return value;
    }
    this.stats.misses++;
    return undefined;
  }

  set(key, value, options = {}) {
    const ttl = options.ttl ? options.ttl * 1000 : undefined;
    this.cache.set(key, value, { ttl });
    this.stats.sets++;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    return {
      ...this.stats,
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
    };
  }

  keys() {
    return [...this.cache.keys()];
  }
}

// =============================================================================
// L2 CACHE: File-Based Persistent Cache
// =============================================================================

/**
 * L2 File Cache with JSON persistence
 */
class L2Cache {
  constructor(options = {}) {
    const {
      cacheDir = '.cache',
      name = 'default',
      ttl = 24 * 60 * 60,  // 24 hour default TTL
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

  _ensureDir() {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  _hashKey(key) {
    // Create a safe filename from key
    return createHash('sha256').update(key).digest('hex').substring(0, 32);
  }

  _getFilePath(key) {
    const hash = this._hashKey(key);
    // Use first 2 chars as subdirectory for better filesystem performance
    const subdir = hash.substring(0, 2);
    const dir = join(this.cacheDir, subdir);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    return join(dir, `${hash}.json`);
  }

  async get(key) {
    try {
      const filePath = this._getFilePath(key);
      
      if (!existsSync(filePath)) {
        this.stats.misses++;
        return undefined;
      }

      const content = readFileSync(filePath, 'utf-8');
      const entry = JSON.parse(content);

      // Check TTL
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        // Expired - delete and return undefined
        try { unlinkSync(filePath); } catch {}
        this.stats.misses++;
        return undefined;
      }

      this.stats.hits++;
      return entry.value;
    } catch (error) {
      this.stats.errors++;
      console.error(`[L2Cache] Error reading ${key}:`, error.message);
      return undefined;
    }
  }

  async set(key, value, options = {}) {
    try {
      const ttl = options.ttl || this.ttl;
      const filePath = this._getFilePath(key);

      const entry = {
        key,
        value,
        createdAt: Date.now(),
        expiresAt: ttl > 0 ? Date.now() + (ttl * 1000) : null,
        ttl,
      };

      writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
      this.stats.sets++;
      
      // Trigger cleanup if needed (async, don't wait)
      this._maybeCleanup();
      
      return true;
    } catch (error) {
      this.stats.errors++;
      console.error(`[L2Cache] Error writing ${key}:`, error.message);
      return false;
    }
  }

  async delete(key) {
    try {
      const filePath = this._getFilePath(key);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async has(key) {
    const value = await this.get(key);
    return value !== undefined;
  }

  async clear() {
    try {
      const { rmSync } = await import('fs');
      rmSync(this.cacheDir, { recursive: true, force: true });
      this._ensureDir();
    } catch {}
  }

  _maybeCleanup() {
    // Run cleanup periodically (1% chance per write)
    if (Math.random() < 0.01) {
      setImmediate(() => this._cleanup());
    }
  }

  async _cleanup() {
    try {
      const files = this._getAllFiles();
      
      // Remove expired files
      let removed = 0;
      const now = Date.now();
      
      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf-8');
          const entry = JSON.parse(content);
          
          if (entry.expiresAt && now > entry.expiresAt) {
            unlinkSync(file);
            removed++;
          }
        } catch {
          // Invalid file, remove it
          try { unlinkSync(file); removed++; } catch {}
        }
      }

      if (removed > 0) {
        console.log(`[L2Cache] Cleanup: removed ${removed} expired entries`);
      }
    } catch (error) {
      console.error('[L2Cache] Cleanup error:', error.message);
    }
  }

  _getAllFiles() {
    const files = [];
    
    const walk = (dir) => {
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
      } catch {}
    };
    
    walk(this.cacheDir);
    return files;
  }

  getStats() {
    const files = this._getAllFiles();
    let totalSize = 0;
    
    for (const file of files) {
      try {
        totalSize += statSync(file).size;
      } catch {}
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
export class TieredCache {
  constructor(options = {}) {
    const {
      name = 'default',
      l1Options = {},
      l2Options = {},
      l1Ttl = 5 * 60,      // 5 minutes for L1
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
    this.l1 = new L1Cache({ 
      ttl: l1Ttl * 1000,
      ...l1Options,
    });

    if (enableL2) {
      this.l2 = new L2Cache({ 
        name,
        ttl: l2Ttl,
        ...l2Options,
      });
    }
  }

  /**
   * Get value from cache (L1 -> L2 with promotion)
   */
  async get(key) {
    // Try L1 first
    let value = this.l1.get(key);
    if (value !== undefined) {
      return value;
    }

    // Try L2
    if (this.enableL2) {
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
  async set(key, value, options = {}) {
    const l1Ttl = options.l1Ttl || options.ttl || this.l1Ttl;
    const l2Ttl = options.l2Ttl || options.ttl || this.l2Ttl;

    // Set in L1
    this.l1.set(key, value, { ttl: l1Ttl });

    // Set in L2 (async, don't wait)
    if (this.enableL2) {
      this.l2.set(key, value, { ttl: l2Ttl }).catch(() => {});
    }
  }

  /**
   * Delete from both tiers
   */
  async delete(key) {
    this.l1.delete(key);
    if (this.enableL2) {
      await this.l2.delete(key);
    }
  }

  /**
   * Check if key exists (checks both tiers)
   */
  async has(key) {
    if (this.l1.has(key)) return true;
    if (this.enableL2) {
      return await this.l2.has(key);
    }
    return false;
  }

  /**
   * Clear both tiers
   */
  async clear() {
    this.l1.clear();
    if (this.enableL2) {
      await this.l2.clear();
    }
  }

  /**
   * Get stats from both tiers
   */
  getStats() {
    return {
      l1: this.l1.getStats(),
      l2: this.enableL2 ? this.l2.getStats() : null,
    };
  }

  /**
   * Cache-aside pattern: get with automatic fetch on miss
   */
  async getOrFetch(key, fetchFn, options = {}) {
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
  async getMany(keys) {
    const results = new Map();
    const missingKeys = [];

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
    if (this.enableL2 && missingKeys.length > 0) {
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
  async setMany(entries, options = {}) {
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
export class CacheWarmer {
  constructor(cache) {
    this.cache = cache;
    this.warmupTasks = [];
  }

  /**
   * Register a warmup task
   */
  register(name, fetchFn, options = {}) {
    this.warmupTasks.push({ name, fetchFn, options });
  }

  /**
   * Run all warmup tasks
   */
  async warmup() {
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
        console.error(`[CacheWarmer] Failed: ${task.name}:`, error.message);
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
  async warmL1FromL2(keys) {
    if (!this.cache.enableL2) return;

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
export class JobApplicationCache extends TieredCache {
  constructor() {
    super({
      name: 'job-applications',
      l1Ttl: 30 * 60,        // 30 min L1 (active session)
      l2Ttl: 7 * 24 * 60 * 60, // 7 days L2 (job listings change)
    });
  }

  // Cache keys
  static jobKey(url) {
    return `job:${createHash('md5').update(url).digest('hex')}`;
  }

  static formKey(url) {
    return `form:${createHash('md5').update(url).digest('hex')}`;
  }

  static companyKey(company) {
    return `company:${company.toLowerCase().replace(/\s+/g, '-')}`;
  }

  // Convenience methods
  async getJobData(url) {
    return this.get(JobApplicationCache.jobKey(url));
  }

  async setJobData(url, data) {
    return this.set(JobApplicationCache.jobKey(url), data);
  }

  async getFormFields(url) {
    return this.get(JobApplicationCache.formKey(url));
  }

  async setFormFields(url, fields) {
    return this.set(JobApplicationCache.formKey(url), fields, {
      l1Ttl: 60 * 60,  // 1 hour in L1
      l2Ttl: 30 * 24 * 60 * 60, // 30 days in L2 (forms rarely change)
    });
  }

  async getCompanyInfo(company) {
    return this.get(JobApplicationCache.companyKey(company));
  }

  async setCompanyInfo(company, info) {
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
export class ATSPatternCache extends TieredCache {
  constructor() {
    super({
      name: 'ats-patterns',
      l1Ttl: 24 * 60 * 60,    // 24 hours (patterns rarely change)
      l2Ttl: 90 * 24 * 60 * 60, // 90 days
    });
  }

  async getFieldMapping(ats, fieldType) {
    const key = `${ats}:field:${fieldType}`;
    return this.get(key);
  }

  async setFieldMapping(ats, fieldType, mapping) {
    const key = `${ats}:field:${fieldType}`;
    return this.set(key, mapping);
  }

  async getSelector(ats, element) {
    const key = `${ats}:selector:${element}`;
    return this.get(key);
  }

  async setSelector(ats, element, selector) {
    const key = `${ats}:selector:${element}`;
    return this.set(key, selector);
  }
}

/**
 * H1B Salary Cache
 * Caches salary data from H1B lookups
 */
export class SalaryCache extends TieredCache {
  constructor() {
    super({
      name: 'salary-data',
      l1Ttl: 60 * 60,         // 1 hour L1
      l2Ttl: 30 * 24 * 60 * 60, // 30 days L2 (salary data is quarterly)
    });
  }

  async getSalaryRange(company, title) {
    const key = `salary:${company.toLowerCase()}:${(title || 'all').toLowerCase()}`;
    return this.get(key);
  }

  async setSalaryRange(company, title, range) {
    const key = `salary:${company.toLowerCase()}:${(title || 'all').toLowerCase()}`;
    return this.set(key, range);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  L1Cache,
  L2Cache,
};

export default TieredCache;
```

---

## Integration Examples

### Integration with Auto-Apply (`auto-apply/index.js`)

```javascript
import { JobApplicationCache, ATSPatternCache } from './utils/tiered-cache.js';

// Initialize caches
const jobCache = new JobApplicationCache();
const atsCache = new ATSPatternCache();

/**
 * Enhanced fillApplication with caching
 */
async function fillApplicationWithCache({ url, profile, dryRun, page }) {
  // Check if we have cached form field data for this job
  const cachedFields = await jobCache.getFormFields(url);
  
  if (cachedFields) {
    console.log('[cache] Using cached form field mappings');
    return fillFromCachedFields(page, profile, cachedFields);
  }

  // No cache - detect and fill normally
  const result = await fillApplication({ url, profile, dryRun, page });
  
  // Cache the detected fields for future use
  if (result.detectedFields) {
    await jobCache.setFormFields(url, result.detectedFields);
  }
  
  return result;
}

/**
 * Pre-warm cache for batch applications
 */
async function warmCacheForBatch(jobs) {
  console.log(`[cache] Pre-warming cache for ${jobs.length} jobs...`);
  
  const { CacheWarmer } = await import('./utils/tiered-cache.js');
  const warmer = new CacheWarmer(jobCache);
  
  warmer.register('job-pages', async () => {
    const keys = [];
    const values = [];
    
    for (const job of jobs) {
      // Pre-fetch job data if available in database
      const data = await fetchJobFromDB(job.url);
      if (data) {
        keys.push(JobApplicationCache.jobKey(job.url));
        values.push(data);
      }
    }
    
    return { keys, values };
  });
  
  await warmer.warmup();
}
```

### Integration with Salary Data (`src/lib/salary-data.ts`)

```typescript
import { SalaryCache } from './tiered-cache';

// Replace the simple Map with TieredCache
const salaryCache = new SalaryCache();

export async function getSalaryRange(options: SalaryLookupOptions): Promise<SalaryRange | null> {
  const cacheKey = `${options.company}-${options.jobTitle || 'all'}`;
  
  // Use cache-aside pattern
  return salaryCache.getOrFetch(
    `salary:${cacheKey}`,
    async () => {
      // Fetch from H1B API
      const h1bData = await fetchH1BDataForCompany(options.company);
      return calculateSalaryRange(h1bData);
    },
    { ttl: 24 * 60 * 60 } // 24 hours
  );
}
```

### Integration with Batch Apply (`auto-apply/batch-apply.js`)

```javascript
import { JobApplicationCache, CacheWarmer } from './utils/tiered-cache.js';

class BatchProcessor {
  constructor(options) {
    // ... existing constructor ...
    this.cache = new JobApplicationCache();
  }

  async initialize() {
    // ... existing browser init ...
    
    // Warm L1 cache from L2 for jobs we're about to process
    const warmer = new CacheWarmer(this.cache);
    const jobKeys = this.jobs.map(j => JobApplicationCache.jobKey(j.url));
    await warmer.warmL1FromL2(jobKeys);
    
    console.log('[batch] Cache warmed from disk');
  }

  async processJob(job, conn) {
    const { url } = job;
    
    // Check cache for pre-computed form data
    const cachedForm = await this.cache.getFormFields(url);
    
    if (cachedForm) {
      console.log(`[batch] Using cached form data for ${url}`);
      // Fill using cached selectors (much faster)
      return this.fillFromCache(conn.page, cachedForm);
    }
    
    // ... existing processing logic ...
    
    // Cache the detected form for future runs
    if (result.formFields) {
      await this.cache.setFormFields(url, result.formFields);
    }
  }
}
```

---

## Cache Warming

### Startup Warming Script (`auto-apply/warm-cache.js`)

```javascript
#!/usr/bin/env node

import { JobApplicationCache, ATSPatternCache, CacheWarmer } from './utils/tiered-cache.js';
import { readFileSync, existsSync } from 'fs';

async function warmCaches() {
  console.log('='.repeat(50));
  console.log('CACHE WARMING');
  console.log('='.repeat(50));

  const jobCache = new JobApplicationCache();
  const atsCache = new ATSPatternCache();
  const warmer = new CacheWarmer(jobCache);

  // 1. Warm ATS patterns (known field selectors)
  warmer.register('ats-patterns', async () => {
    const patterns = {
      'greenhouse': {
        firstName: 'input[name*="first_name"]',
        lastName: 'input[name*="last_name"]',
        email: 'input[type="email"]',
        resume: 'input[type="file"][name*="resume"]',
      },
      'lever': {
        name: 'input[name="name"]',
        email: 'input[name="email"]',
        resume: 'input[name="resume"]',
      },
      'ashby': {
        firstName: '[data-testid="firstName"]',
        lastName: '[data-testid="lastName"]',
        email: '[data-testid="email"]',
      },
    };

    const keys = [];
    const values = [];

    for (const [ats, fields] of Object.entries(patterns)) {
      for (const [field, selector] of Object.entries(fields)) {
        keys.push(`${ats}:selector:${field}`);
        values.push(selector);
      }
    }

    return { keys, values };
  });

  // 2. Warm recent job applications from history
  if (existsSync('./job-history.json')) {
    warmer.register('job-history', async () => {
      const history = JSON.parse(readFileSync('./job-history.json', 'utf-8'));
      const keys = [];
      const values = [];

      for (const job of history.slice(-100)) { // Last 100 jobs
        if (job.formFields) {
          keys.push(JobApplicationCache.formKey(job.url));
          values.push(job.formFields);
        }
      }

      return { keys, values };
    });
  }

  // 3. Warm company info from companies list
  warmer.register('companies', async () => {
    // Pre-load top companies with their ATS types
    const companies = [
      { name: 'Google', ats: 'greenhouse', careers: 'careers.google.com' },
      { name: 'Meta', ats: 'greenhouse', careers: 'metacareers.com' },
      { name: 'Apple', ats: 'custom', careers: 'jobs.apple.com' },
      { name: 'Amazon', ats: 'custom', careers: 'amazon.jobs' },
      { name: 'Microsoft', ats: 'custom', careers: 'careers.microsoft.com' },
      { name: 'Stripe', ats: 'greenhouse', careers: 'stripe.com/jobs' },
      { name: 'Airbnb', ats: 'greenhouse', careers: 'careers.airbnb.com' },
      // ... more companies
    ];

    return {
      keys: companies.map(c => JobApplicationCache.companyKey(c.name)),
      values: companies,
    };
  });

  // Execute warmup
  const result = await warmer.warmup();
  
  console.log('\n' + '='.repeat(50));
  console.log('CACHE STATS');
  console.log('='.repeat(50));
  console.log(JSON.stringify(jobCache.getStats(), null, 2));
  console.log('='.repeat(50));

  return result;
}

warmCaches().catch(console.error);
```

---

## What to Cache Where

| Data Type | L1 TTL | L2 TTL | Reasoning |
|-----------|--------|--------|-----------|
| **Form field selectors** | 1 hour | 30 days | Forms rarely change, high reuse |
| **Job page metadata** | 30 min | 7 days | Jobs expire/change frequently |
| **Company info** | 24 hours | 90 days | Company data is stable |
| **ATS patterns** | 24 hours | 90 days | ATS platforms update rarely |
| **H1B salary data** | 1 hour | 30 days | Updated quarterly |
| **EEO question mappings** | 24 hours | 90 days | Standardized, rarely change |
| **Resume parse results** | Session | 7 days | Profile rarely changes |
| **Browser session state** | Session | Never | Security, don't persist |

### Cache Decision Tree

```
                    Is the data user-specific?
                           /        \
                         Yes         No
                          |           |
              Is it sensitive?   Is it expensive to compute?
                 /      \            /        \
               Yes       No        Yes         No
                |         |          |           |
            No cache   L1 only   Both L1+L2   L1 only
```

---

## Performance Benchmarks

### Test Setup

```javascript
import { TieredCache, L1Cache, L2Cache } from './tiered-cache.js';

async function benchmark() {
  const cache = new TieredCache({ name: 'benchmark' });
  const iterations = 10000;
  
  // Test data
  const testData = { 
    fields: ['firstName', 'lastName', 'email'],
    selectors: { firstName: 'input[name="first"]' },
    timestamp: Date.now(),
  };

  console.log('='.repeat(50));
  console.log('CACHE BENCHMARK');
  console.log(`Iterations: ${iterations}`);
  console.log('='.repeat(50));

  // Benchmark L1 writes
  let start = Date.now();
  for (let i = 0; i < iterations; i++) {
    await cache.set(`key-${i}`, testData);
  }
  console.log(`L1+L2 Write: ${Date.now() - start}ms (${(iterations / (Date.now() - start) * 1000).toFixed(0)} ops/sec)`);

  // Benchmark L1 reads (hot cache)
  start = Date.now();
  for (let i = 0; i < iterations; i++) {
    await cache.get(`key-${i % 100}`); // Hit same 100 keys
  }
  console.log(`L1 Read (hot): ${Date.now() - start}ms (${(iterations / (Date.now() - start) * 1000).toFixed(0)} ops/sec)`);

  // Benchmark L2 reads (cold, L1 miss)
  cache.l1.clear();
  start = Date.now();
  for (let i = 0; i < 1000; i++) { // Fewer iterations - disk is slow
    await cache.get(`key-${i}`);
  }
  console.log(`L2 Read (cold): ${Date.now() - start}ms (${(1000 / (Date.now() - start) * 1000).toFixed(0)} ops/sec)`);

  // Stats
  console.log('\nStats:', JSON.stringify(cache.getStats(), null, 2));
}
```

### Expected Results

| Operation | L1 Only | L2 Only | L1+L2 (L1 hit) | L1+L2 (L2 hit) |
|-----------|---------|---------|----------------|----------------|
| Read | ~0.001ms | ~1-5ms | ~0.001ms | ~1-5ms |
| Write | ~0.01ms | ~2-10ms | ~0.01ms* | ~0.01ms* |
| 10k reads/sec | 10M+ | 200-1000 | 10M+ | 200-1000 |

*L2 write is async/background

### Real-World Impact

For batch applying to 50 jobs:

| Scenario | Without Cache | With L1 | With L1+L2 |
|----------|---------------|---------|------------|
| First run | 150s | 150s | 150s |
| Second run (same jobs) | 150s | 50s | 50s |
| Third run (after restart) | 150s | 150s | 50s |
| Hot path (repeat job) | 3s | 0.5s | 0.5s |

---

## TTL and Invalidation Strategies

### TTL Guidelines

```javascript
// Cache TTL constants
const TTL = {
  // Hot data - changes frequently or during session
  SESSION: 30 * 60,           // 30 minutes
  ACTIVE_JOB: 1 * 60 * 60,    // 1 hour
  
  // Warm data - changes daily
  DAILY: 24 * 60 * 60,        // 24 hours
  
  // Cold data - rarely changes
  WEEKLY: 7 * 24 * 60 * 60,   // 7 days
  MONTHLY: 30 * 24 * 60 * 60, // 30 days
  QUARTERLY: 90 * 24 * 60 * 60, // 90 days
};
```

### Invalidation Patterns

```javascript
// 1. Time-based invalidation (TTL)
// Built into cache - entries expire automatically

// 2. Event-based invalidation
async function onJobApplied(jobUrl) {
  // Remove cached form data after successful application
  await cache.delete(JobApplicationCache.formKey(jobUrl));
}

// 3. Version-based invalidation
class VersionedCache extends TieredCache {
  constructor(options) {
    super(options);
    this.version = options.version || '1';
  }

  async get(key) {
    return super.get(`${this.version}:${key}`);
  }

  async set(key, value, options) {
    return super.set(`${this.version}:${key}`, value, options);
  }

  // Bump version to invalidate all entries
  invalidateAll() {
    this.version = Date.now().toString();
  }
}

// 4. Tag-based invalidation
class TaggedCache extends TieredCache {
  constructor(options) {
    super(options);
    this.tags = new Map(); // tag -> Set<key>
  }

  async set(key, value, options = {}) {
    await super.set(key, value, options);
    
    // Track tags
    for (const tag of options.tags || []) {
      if (!this.tags.has(tag)) {
        this.tags.set(tag, new Set());
      }
      this.tags.get(tag).add(key);
    }
  }

  async invalidateTag(tag) {
    const keys = this.tags.get(tag) || new Set();
    for (const key of keys) {
      await this.delete(key);
    }
    this.tags.delete(tag);
  }
}

// Usage
const cache = new TaggedCache({ name: 'tagged' });
await cache.set('job:123', data, { tags: ['jobs', 'company:google'] });
await cache.invalidateTag('company:google'); // Clears all Google jobs
```

### Cache Consistency Checklist

1. **Write-through**: Always write to origin + cache together
2. **Read-through**: Always check cache before origin
3. **Invalidation**: Delete cache when origin data changes
4. **TTL**: Set appropriate TTLs based on data volatility
5. **Versioning**: Include version in cache keys when schema changes

---

## File Structure

```
auto-apply/
  utils/
    tiered-cache.js      # Main cache implementation
    cache-keys.js        # Cache key generators
  warm-cache.js          # Cache warming script
  .cache/                # L2 cache directory (gitignored)
    job-applications/
    ats-patterns/
    salary-data/
```

Add to `.gitignore`:
```
# Cache directories
.cache/
auto-apply/.cache/
```

---

## Quick Start

```bash
# 1. Install dependency
cd auto-apply
npm install lru-cache

# 2. Create cache utility file
# Copy tiered-cache.js to auto-apply/utils/

# 3. Warm cache on startup
node warm-cache.js

# 4. Use in your code
import { JobApplicationCache } from './utils/tiered-cache.js';
const cache = new JobApplicationCache();

# 5. Run batch apply (now cached)
node batch-apply.js --jobs jobs.json --profile profile.json
```
