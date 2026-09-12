# Retry Patterns and Circuit Breaker Implementation

This document provides production-ready implementations for circuit breaker and retry patterns to improve reliability when interacting with external ATS systems and job board APIs.

## Table of Contents

1. [Dependencies](#dependencies)
2. [Error Classification](#error-classification)
3. [Exponential Backoff with Jitter](#exponential-backoff-with-jitter)
4. [Retry Wrapper](#retry-wrapper)
5. [Circuit Breaker Implementation](#circuit-breaker-implementation)
6. [Per-ATS Circuit Breakers](#per-ats-circuit-breakers)
7. [Graceful Degradation](#graceful-degradation)
8. [Integration Examples](#integration-examples)

---

## Dependencies

```bash
# Recommended libraries
npm install opossum           # Circuit breaker (Netflix Hystrix-inspired)
npm install p-retry           # Promise retry with exponential backoff
npm install cockatiel         # Comprehensive resilience (circuit breaker + retry + bulkhead)

# For TypeScript
npm install -D @types/opossum
```

### Library Comparison

| Library | Circuit Breaker | Retry | Bulkhead | Timeout | Best For |
|---------|-----------------|-------|----------|---------|----------|
| **opossum** | Yes | No | No | Yes | Dedicated circuit breaker |
| **p-retry** | No | Yes | No | No | Simple retry with backoff |
| **cockatiel** | Yes | Yes | Yes | Yes | Full resilience patterns |

---

## Error Classification

### `lib/reliability/error-classifier.ts`

```typescript
/**
 * Error classification for retry decisions.
 * Transient errors should be retried; permanent errors should fail fast.
 */

export enum ErrorType {
  TRANSIENT = 'TRANSIENT',      // Retry with backoff
  PERMANENT = 'PERMANENT',      // Don't retry
  RATE_LIMITED = 'RATE_LIMITED', // Retry with longer delay
  CIRCUIT_OPEN = 'CIRCUIT_OPEN'  // Service unavailable
}

export interface ClassifiedError {
  type: ErrorType;
  originalError: Error;
  retryAfter?: number;  // Milliseconds
  shouldRetry: boolean;
  message: string;
}

// HTTP status codes that indicate transient failures
const TRANSIENT_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  522, // Connection Timed Out (Cloudflare)
  524  // A Timeout Occurred (Cloudflare)
]);

// HTTP status codes that indicate permanent failures (don't retry)
const PERMANENT_STATUS_CODES = new Set([
  400, // Bad Request
  401, // Unauthorized
  403, // Forbidden
  404, // Not Found
  405, // Method Not Allowed
  410, // Gone
  422, // Unprocessable Entity
  451  // Unavailable For Legal Reasons
]);

// Error messages/codes that indicate transient failures
const TRANSIENT_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ENETUNREACH/i,
  /socket hang up/i,
  /network error/i,
  /timeout/i,
  /abort/i,
  /EAI_AGAIN/i,
  /EPIPE/i
];

export function classifyError(error: unknown): ClassifiedError {
  // Handle non-Error types
  if (!(error instanceof Error)) {
    return {
      type: ErrorType.PERMANENT,
      originalError: new Error(String(error)),
      shouldRetry: false,
      message: String(error)
    };
  }

  // Check for HTTP response errors
  const statusCode = extractStatusCode(error);
  if (statusCode !== null) {
    // Rate limiting - special handling
    if (statusCode === 429) {
      const retryAfter = extractRetryAfter(error);
      return {
        type: ErrorType.RATE_LIMITED,
        originalError: error,
        retryAfter: retryAfter || 60000, // Default to 60s if no header
        shouldRetry: true,
        message: `Rate limited (429). Retry after ${retryAfter || 60000}ms`
      };
    }

    // Transient HTTP errors
    if (TRANSIENT_STATUS_CODES.has(statusCode)) {
      return {
        type: ErrorType.TRANSIENT,
        originalError: error,
        shouldRetry: true,
        message: `Transient HTTP error: ${statusCode}`
      };
    }

    // Permanent HTTP errors
    if (PERMANENT_STATUS_CODES.has(statusCode)) {
      return {
        type: ErrorType.PERMANENT,
        originalError: error,
        shouldRetry: false,
        message: `Permanent HTTP error: ${statusCode}`
      };
    }
  }

  // Check for network/transient error patterns
  const errorMessage = error.message || '';
  const errorCode = (error as NodeJS.ErrnoException).code || '';
  
  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(errorMessage) || pattern.test(errorCode)) {
      return {
        type: ErrorType.TRANSIENT,
        originalError: error,
        shouldRetry: true,
        message: `Transient network error: ${errorMessage}`
      };
    }
  }

  // Default to permanent (fail fast on unknown errors)
  return {
    type: ErrorType.PERMANENT,
    originalError: error,
    shouldRetry: false,
    message: `Unknown error type: ${error.message}`
  };
}

function extractStatusCode(error: Error): number | null {
  // Handle fetch Response errors
  if ('status' in error && typeof (error as any).status === 'number') {
    return (error as any).status;
  }
  // Handle axios-style errors
  if ('response' in error && (error as any).response?.status) {
    return (error as any).response.status;
  }
  // Handle custom status property
  if ('statusCode' in error && typeof (error as any).statusCode === 'number') {
    return (error as any).statusCode;
  }
  return null;
}

function extractRetryAfter(error: Error): number | null {
  // Try to get Retry-After header value
  const headers = (error as any).response?.headers || (error as any).headers;
  if (!headers) return null;

  const retryAfter = headers.get?.('retry-after') || headers['retry-after'];
  if (!retryAfter) return null;

  // Parse as seconds or HTTP date
  const parsed = parseInt(retryAfter, 10);
  if (!isNaN(parsed)) {
    return parsed * 1000; // Convert seconds to ms
  }

  // Try parsing as HTTP date
  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
}

// Utility to check if an error should be retried
export function shouldRetry(error: unknown): boolean {
  return classifyError(error).shouldRetry;
}

// Utility for p-retry compatibility
export function createRetryPredicate() {
  return (error: Error): boolean => {
    const classified = classifyError(error);
    return classified.shouldRetry;
  };
}
```

---

## Exponential Backoff with Jitter

### `lib/reliability/backoff.ts`

```typescript
/**
 * Exponential backoff with full jitter to prevent thundering herd.
 * Based on AWS Architecture Blog recommendations.
 */

export interface BackoffConfig {
  baseDelay: number;      // Initial delay in ms (default: 1000)
  maxDelay: number;       // Maximum delay cap in ms (default: 30000)
  factor: number;         // Exponential factor (default: 2)
  jitter: 'full' | 'equal' | 'decorrelated' | 'none';
}

const DEFAULT_CONFIG: BackoffConfig = {
  baseDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  jitter: 'full'
};

/**
 * Calculate delay for a given attempt number.
 * @param attempt - Zero-indexed attempt number
 * @param config - Backoff configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  config: Partial<BackoffConfig> = {}
): number {
  const { baseDelay, maxDelay, factor, jitter } = { ...DEFAULT_CONFIG, ...config };

  // Calculate exponential delay
  const exponentialDelay = Math.min(
    maxDelay,
    baseDelay * Math.pow(factor, attempt)
  );

  switch (jitter) {
    case 'none':
      return exponentialDelay;

    case 'full':
      // Full jitter: random between 0 and exponentialDelay
      // Best for reducing contention
      return Math.floor(Math.random() * exponentialDelay);

    case 'equal':
      // Equal jitter: half exponential + half random
      // Balanced approach
      const half = exponentialDelay / 2;
      return Math.floor(half + Math.random() * half);

    case 'decorrelated':
      // Decorrelated jitter: uses previous delay
      // Good for correlated failures
      return Math.floor(
        Math.min(maxDelay, Math.random() * exponentialDelay * 3)
      );

    default:
      return exponentialDelay;
  }
}

/**
 * Sleep for the calculated backoff duration.
 */
export async function backoffSleep(
  attempt: number,
  config?: Partial<BackoffConfig>
): Promise<number> {
  const delay = calculateBackoff(attempt, config);
  await new Promise(resolve => setTimeout(resolve, delay));
  return delay;
}

/**
 * Create a backoff iterator for manual control.
 */
export function* createBackoffIterator(
  maxAttempts: number,
  config?: Partial<BackoffConfig>
): Generator<number, void, unknown> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    yield calculateBackoff(attempt, config);
  }
}

// Preset configurations for common scenarios
export const BACKOFF_PRESETS = {
  // Aggressive retry for idempotent operations
  aggressive: {
    baseDelay: 100,
    maxDelay: 5000,
    factor: 1.5,
    jitter: 'full' as const
  },
  // Standard retry for most API calls
  standard: {
    baseDelay: 1000,
    maxDelay: 30000,
    factor: 2,
    jitter: 'full' as const
  },
  // Conservative retry for rate-limited APIs
  conservative: {
    baseDelay: 2000,
    maxDelay: 60000,
    factor: 2,
    jitter: 'equal' as const
  },
  // Very conservative for APIs with strict rate limits
  gentle: {
    baseDelay: 5000,
    maxDelay: 120000,
    factor: 2,
    jitter: 'full' as const
  }
} as const;
```

---

## Retry Wrapper

### `lib/reliability/retry.ts`

```typescript
/**
 * Generic retry wrapper with exponential backoff and error classification.
 */

import { classifyError, ErrorType, type ClassifiedError } from './error-classifier';
import { calculateBackoff, BACKOFF_PRESETS, type BackoffConfig } from './backoff';

export interface RetryOptions {
  maxAttempts: number;
  backoff?: Partial<BackoffConfig>;
  shouldRetry?: (error: ClassifiedError, attempt: number) => boolean;
  onRetry?: (error: ClassifiedError, attempt: number, delay: number) => void;
  timeout?: number;  // Per-attempt timeout in ms
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  backoff: BACKOFF_PRESETS.standard
};

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: ClassifiedError;
  attempts: number;
  totalTime: number;
}

/**
 * Execute a function with retry logic.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: ClassifiedError | undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      // Apply per-attempt timeout if specified
      if (opts.timeout) {
        return await withTimeout(fn(), opts.timeout);
      }
      return await fn();
    } catch (error) {
      lastError = classifyError(error);

      // Check if we should retry
      const shouldRetry = opts.shouldRetry
        ? opts.shouldRetry(lastError, attempt)
        : lastError.shouldRetry;

      // Last attempt or permanent error - don't retry
      if (!shouldRetry || attempt === opts.maxAttempts - 1) {
        throw lastError.originalError;
      }

      // Calculate delay (use retryAfter for rate limits)
      let delay: number;
      if (lastError.type === ErrorType.RATE_LIMITED && lastError.retryAfter) {
        delay = lastError.retryAfter;
      } else {
        delay = calculateBackoff(attempt, opts.backoff);
      }

      // Notify retry callback
      opts.onRetry?.(lastError, attempt, delay);

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError?.originalError || new Error('Retry failed');
}

/**
 * Retry wrapper that returns a result object instead of throwing.
 */
export async function retryWithResult<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const data = await retry(fn, {
      ...options,
      onRetry: (error, attempt, delay) => {
        attempts = attempt + 1;
        options.onRetry?.(error, attempt, delay);
      }
    });
    return {
      success: true,
      data,
      attempts: attempts + 1,
      totalTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: classifyError(error),
      attempts: attempts + 1,
      totalTime: Date.now() - startTime
    };
  }
}

/**
 * Create a retryable version of a function.
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: Partial<RetryOptions> = {}
): T {
  return (async (...args: Parameters<T>) => {
    return retry(() => fn(...args), options);
  }) as T;
}

// Utility functions
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
```

### Using p-retry Library

```typescript
/**
 * Alternative implementation using the p-retry library.
 */

import pRetry from 'p-retry';
import { classifyError } from './error-classifier';

export function createPRetryOptions(options: {
  maxAttempts?: number;
  onRetry?: (error: Error, attempt: number) => void;
}) {
  return {
    retries: (options.maxAttempts || 3) - 1, // p-retry counts retries, not attempts
    factor: 2,
    minTimeout: 1000,
    maxTimeout: 30000,
    randomize: true, // Adds jitter
    onFailedAttempt: (error: pRetry.FailedAttemptError) => {
      const classified = classifyError(error);
      
      // Abort if error is permanent
      if (!classified.shouldRetry) {
        throw new pRetry.AbortError(error.message);
      }
      
      options.onRetry?.(error, error.attemptNumber);
    }
  };
}

// Example usage
export async function fetchWithPRetry<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  return pRetry(
    async () => {
      const response = await fetch(url, init);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`) as any;
        error.status = response.status;
        error.response = response;
        throw error;
      }
      return response.json();
    },
    createPRetryOptions({
      maxAttempts: 3,
      onRetry: (error, attempt) => {
        console.log(`Retry ${attempt}: ${error.message}`);
      }
    })
  );
}
```

---

## Circuit Breaker Implementation

### `lib/reliability/circuit-breaker.ts`

```typescript
/**
 * Circuit breaker implementation using opossum library.
 */

import CircuitBreaker from 'opossum';

export interface CircuitBreakerConfig {
  timeout: number;           // Time in ms before a request is considered failed
  errorThresholdPercentage: number;  // Error % to trip the circuit
  resetTimeout: number;      // Time in ms to wait before trying again
  volumeThreshold: number;   // Min requests before tripping
  rollingCountTimeout: number;  // Statistical window in ms
  rollingCountBuckets: number;  // Number of buckets in the window
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  timeout: 10000,            // 10 second timeout
  errorThresholdPercentage: 50,  // 50% errors trips circuit
  resetTimeout: 30000,       // 30 seconds before half-open
  volumeThreshold: 5,        // Need at least 5 requests
  rollingCountTimeout: 10000, // 10 second window
  rollingCountBuckets: 10    // 1 second buckets
};

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  fallbacks: number;
  timeouts: number;
  cacheHits: number;
  fires: number;
  rejects: number;
}

/**
 * Create a circuit breaker for a given function.
 */
export function createCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: Partial<CircuitBreakerConfig> = {},
  name?: string
): CircuitBreaker<Parameters<T>, Awaited<ReturnType<T>>> {
  const config = { ...DEFAULT_CONFIG, ...options };

  const breaker = new CircuitBreaker(fn, {
    timeout: config.timeout,
    errorThresholdPercentage: config.errorThresholdPercentage,
    resetTimeout: config.resetTimeout,
    volumeThreshold: config.volumeThreshold,
    rollingCountTimeout: config.rollingCountTimeout,
    rollingCountBuckets: config.rollingCountBuckets,
    name: name || fn.name || 'anonymous'
  });

  // Set up event handlers
  breaker.on('success', (result) => {
    console.log(`[${breaker.name}] Success`);
  });

  breaker.on('failure', (error) => {
    console.warn(`[${breaker.name}] Failure:`, error.message);
  });

  breaker.on('timeout', () => {
    console.warn(`[${breaker.name}] Timeout`);
  });

  breaker.on('reject', () => {
    console.warn(`[${breaker.name}] Rejected (circuit open)`);
  });

  breaker.on('open', () => {
    console.error(`[${breaker.name}] Circuit OPENED`);
  });

  breaker.on('halfOpen', () => {
    console.info(`[${breaker.name}] Circuit HALF-OPEN`);
  });

  breaker.on('close', () => {
    console.info(`[${breaker.name}] Circuit CLOSED`);
  });

  return breaker;
}

/**
 * Get circuit breaker statistics.
 */
export function getCircuitStats(breaker: CircuitBreaker): CircuitBreakerStats {
  const stats = breaker.stats;
  return {
    state: breaker.opened ? 'OPEN' : (breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED'),
    failures: stats.failures,
    successes: stats.successes,
    fallbacks: stats.fallbacks,
    timeouts: stats.timeouts,
    cacheHits: stats.cacheHits,
    fires: stats.fires,
    rejects: stats.rejects
  };
}

/**
 * Circuit breaker wrapper with fallback support.
 */
export function withCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  fallback: (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> | Awaited<ReturnType<T>>,
  options?: Partial<CircuitBreakerConfig>
): T {
  const breaker = createCircuitBreaker(fn, options);
  breaker.fallback(fallback);

  return (async (...args: Parameters<T>) => {
    return breaker.fire(...args);
  }) as T;
}
```

### Standalone Circuit Breaker (No Dependencies)

```typescript
/**
 * Lightweight circuit breaker implementation without external dependencies.
 */

export class SimpleCircuitBreaker<T> {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureTime?: number;
  private readonly threshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenMax: number;
  private halfOpenAttempts = 0;

  constructor(
    private fn: () => Promise<T>,
    options: {
      threshold?: number;      // Failures before opening
      resetTimeout?: number;   // Ms before half-open
      halfOpenMax?: number;    // Successes needed to close
    } = {}
  ) {
    this.threshold = options.threshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.halfOpenMax = options.halfOpenMax ?? 3;
  }

  async execute(): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
      } else {
        throw new CircuitOpenError('Circuit is OPEN');
      }
    }

    try {
      const result = await this.fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    return this.lastFailureTime !== undefined &&
      Date.now() - this.lastFailureTime >= this.resetTimeout;
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.successes++;

    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.halfOpenMax) {
        this.state = 'CLOSED';
        this.halfOpenAttempts = 0;
      }
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Immediate trip back to OPEN on any failure
      this.state = 'OPEN';
    } else if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime
    };
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = undefined;
    this.halfOpenAttempts = 0;
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
```

---

## Per-ATS Circuit Breakers

### `lib/reliability/ats-breakers.ts`

```typescript
/**
 * Circuit breaker management for different ATS systems.
 * Each ATS has its own circuit breaker with tailored configuration.
 */

import CircuitBreaker from 'opossum';
import { createCircuitBreaker, type CircuitBreakerConfig } from './circuit-breaker';

// ATS-specific configurations based on their reliability characteristics
const ATS_CONFIGS: Record<string, Partial<CircuitBreakerConfig>> = {
  greenhouse: {
    timeout: 15000,              // Greenhouse can be slow
    errorThresholdPercentage: 40,
    resetTimeout: 30000,
    volumeThreshold: 5
  },
  lever: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 20000,
    volumeThreshold: 5
  },
  workday: {
    timeout: 20000,              // Workday is notoriously slow
    errorThresholdPercentage: 60,
    resetTimeout: 45000,
    volumeThreshold: 3
  },
  ashby: {
    timeout: 8000,               // Ashby is generally fast
    errorThresholdPercentage: 40,
    resetTimeout: 15000,
    volumeThreshold: 5
  },
  icims: {
    timeout: 15000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5
  },
  smartrecruiters: {
    timeout: 12000,
    errorThresholdPercentage: 45,
    resetTimeout: 25000,
    volumeThreshold: 5
  },
  bamboohr: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 20000,
    volumeThreshold: 5
  },
  jobvite: {
    timeout: 12000,
    errorThresholdPercentage: 50,
    resetTimeout: 25000,
    volumeThreshold: 5
  },
  // Default for unknown ATS
  default: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5
  }
};

// Singleton map of circuit breakers
const breakerMap = new Map<string, CircuitBreaker>();

export type ATSType = keyof typeof ATS_CONFIGS | string;

/**
 * Get or create a circuit breaker for an ATS type.
 */
export function getATSBreaker<T>(
  atsType: ATSType,
  fn: (...args: any[]) => Promise<T>
): CircuitBreaker<any[], T> {
  const normalizedType = atsType.toLowerCase();
  const key = `${normalizedType}:${fn.name || 'anonymous'}`;

  if (!breakerMap.has(key)) {
    const config = ATS_CONFIGS[normalizedType] || ATS_CONFIGS.default;
    const breaker = createCircuitBreaker(fn, config, `${normalizedType}-${fn.name}`);
    breakerMap.set(key, breaker);
  }

  return breakerMap.get(key)!;
}

/**
 * Execute a function through the appropriate ATS circuit breaker.
 */
export async function executeWithATSBreaker<T>(
  atsType: ATSType,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  const breaker = getATSBreaker(atsType, fn);
  
  if (fallback) {
    breaker.fallback(fallback);
  }

  return breaker.fire();
}

/**
 * Get status of all ATS circuit breakers.
 */
export function getAllATSBreakerStatus(): Record<string, {
  state: string;
  stats: any;
}> {
  const status: Record<string, any> = {};
  
  for (const [key, breaker] of breakerMap) {
    status[key] = {
      state: breaker.opened ? 'OPEN' : (breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED'),
      stats: breaker.stats
    };
  }

  return status;
}

/**
 * Reset a specific ATS circuit breaker.
 */
export function resetATSBreaker(atsType: ATSType): void {
  const normalizedType = atsType.toLowerCase();
  
  for (const [key, breaker] of breakerMap) {
    if (key.startsWith(normalizedType)) {
      breaker.close();
    }
  }
}

/**
 * Reset all circuit breakers.
 */
export function resetAllATSBreakers(): void {
  for (const breaker of breakerMap.values()) {
    breaker.close();
  }
}

/**
 * Shutdown all circuit breakers (cleanup).
 */
export function shutdownAllBreakers(): void {
  for (const breaker of breakerMap.values()) {
    breaker.shutdown();
  }
  breakerMap.clear();
}
```

---

## Graceful Degradation

### `lib/reliability/degradation.ts`

```typescript
/**
 * Graceful degradation levels for when services are unavailable.
 */

export enum DegradationLevel {
  FULL = 'FULL',           // All features available
  PARTIAL = 'PARTIAL',     // Some features disabled
  CACHED = 'CACHED',       // Serving stale data
  MINIMAL = 'MINIMAL',     // Core features only
  OFFLINE = 'OFFLINE'      // Service unavailable
}

export interface DegradationState {
  level: DegradationLevel;
  reason: string;
  affectedServices: string[];
  since: Date;
  estimatedRecovery?: Date;
}

export interface DegradedResponse<T> {
  data: T | null;
  degradation: DegradationState | null;
  isStale: boolean;
  cacheAge?: number;  // Milliseconds
}

// In-memory degradation state (in production, use Redis or similar)
let currentState: DegradationState = {
  level: DegradationLevel.FULL,
  reason: '',
  affectedServices: [],
  since: new Date()
};

/**
 * Update the degradation level.
 */
export function setDegradationLevel(
  level: DegradationLevel,
  reason: string,
  affectedServices: string[] = []
): void {
  currentState = {
    level,
    reason,
    affectedServices,
    since: new Date()
  };
  
  console.warn(`Degradation level changed to ${level}: ${reason}`);
}

/**
 * Get current degradation state.
 */
export function getDegradationState(): DegradationState {
  return { ...currentState };
}

/**
 * Check if a specific service is affected by degradation.
 */
export function isServiceDegraded(serviceName: string): boolean {
  return currentState.level !== DegradationLevel.FULL &&
    currentState.affectedServices.includes(serviceName);
}

/**
 * Wrapper that handles degradation automatically.
 */
export async function withDegradation<T>(
  serviceName: string,
  primaryFn: () => Promise<T>,
  options: {
    fallback?: () => T | Promise<T>;
    cache?: {
      get: () => Promise<T | null>;
      set: (value: T) => Promise<void>;
      ttl?: number;
    };
    minLevel?: DegradationLevel;
  } = {}
): Promise<DegradedResponse<T>> {
  // Check if we're below minimum required level
  if (options.minLevel && isLevelBelow(currentState.level, options.minLevel)) {
    return {
      data: null,
      degradation: currentState,
      isStale: false
    };
  }

  try {
    const data = await primaryFn();
    
    // Cache successful result
    if (options.cache) {
      await options.cache.set(data);
    }

    return {
      data,
      degradation: null,
      isStale: false
    };
  } catch (error) {
    // Try to get cached data
    if (options.cache) {
      const cachedData = await options.cache.get();
      if (cachedData !== null) {
        // Update degradation state
        setDegradationLevel(
          DegradationLevel.CACHED,
          `${serviceName} failed, serving cached data`,
          [serviceName]
        );

        return {
          data: cachedData,
          degradation: currentState,
          isStale: true
        };
      }
    }

    // Try fallback
    if (options.fallback) {
      setDegradationLevel(
        DegradationLevel.PARTIAL,
        `${serviceName} failed, using fallback`,
        [serviceName]
      );

      return {
        data: await options.fallback(),
        degradation: currentState,
        isStale: false
      };
    }

    // Full degradation
    setDegradationLevel(
      DegradationLevel.OFFLINE,
      `${serviceName} unavailable`,
      [serviceName]
    );

    return {
      data: null,
      degradation: currentState,
      isStale: false
    };
  }
}

/**
 * Compare degradation levels.
 */
function isLevelBelow(current: DegradationLevel, required: DegradationLevel): boolean {
  const order = [
    DegradationLevel.FULL,
    DegradationLevel.PARTIAL,
    DegradationLevel.CACHED,
    DegradationLevel.MINIMAL,
    DegradationLevel.OFFLINE
  ];
  
  return order.indexOf(current) > order.indexOf(required);
}

/**
 * Feature flags based on degradation level.
 */
export function getAvailableFeatures(): {
  canScrape: boolean;
  canAutoApply: boolean;
  canSendEmails: boolean;
  canFetchNew: boolean;
  canShowCached: boolean;
} {
  const level = currentState.level;
  
  return {
    canScrape: level === DegradationLevel.FULL,
    canAutoApply: level === DegradationLevel.FULL || level === DegradationLevel.PARTIAL,
    canSendEmails: level !== DegradationLevel.OFFLINE,
    canFetchNew: level === DegradationLevel.FULL || level === DegradationLevel.PARTIAL,
    canShowCached: level !== DegradationLevel.OFFLINE
  };
}
```

---

## Integration Examples

### Example 1: Scraping with Retry and Circuit Breaker

```typescript
/**
 * Complete example: Scraping job listings with full resilience.
 */

import { retry, BACKOFF_PRESETS } from './lib/reliability/retry';
import { executeWithATSBreaker } from './lib/reliability/ats-breakers';
import { withDegradation } from './lib/reliability/degradation';
import { classifyError } from './lib/reliability/error-classifier';

interface JobListing {
  id: string;
  title: string;
  company: string;
  url: string;
}

// Simple cache implementation
const jobCache = new Map<string, { data: JobListing[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchJobsFromATS(
  atsType: string,
  companyId: string
): Promise<JobListing[]> {
  // The actual fetch logic
  const url = `https://api.${atsType}.com/companies/${companyId}/jobs`;
  const response = await fetch(url);
  
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`) as any;
    error.status = response.status;
    throw error;
  }
  
  return response.json();
}

/**
 * Resilient job fetcher with all patterns combined.
 */
export async function fetchJobsResilient(
  atsType: string,
  companyId: string
): Promise<{ jobs: JobListing[]; fromCache: boolean; degraded: boolean }> {
  const cacheKey = `${atsType}:${companyId}`;

  const result = await withDegradation(
    `ats:${atsType}`,
    async () => {
      // Layer 1: Circuit breaker around the retry
      return executeWithATSBreaker(
        atsType,
        // Layer 2: Retry with exponential backoff
        () => retry(
          () => fetchJobsFromATS(atsType, companyId),
          {
            maxAttempts: 3,
            backoff: BACKOFF_PRESETS.standard,
            onRetry: (error, attempt, delay) => {
              console.log(`Retry ${attempt + 1} for ${atsType}:${companyId} in ${delay}ms`);
            }
          }
        ),
        // Circuit breaker fallback
        () => {
          const cached = jobCache.get(cacheKey);
          if (cached) return cached.data;
          return [];
        }
      );
    },
    {
      // Degradation cache
      cache: {
        get: async () => {
          const cached = jobCache.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < CACHE_TTL * 2) {
            return cached.data;
          }
          return null;
        },
        set: async (data) => {
          jobCache.set(cacheKey, { data, timestamp: Date.now() });
        }
      },
      // Fallback returns empty array
      fallback: () => []
    }
  );

  return {
    jobs: result.data || [],
    fromCache: result.isStale,
    degraded: result.degradation !== null
  };
}
```

### Example 2: API Route with Circuit Breaker

```typescript
/**
 * Next.js API route with circuit breaker protection.
 */

// app/api/jobs/[atsType]/route.ts

import { NextResponse } from 'next/server';
import { getAllATSBreakerStatus, resetATSBreaker } from '@/lib/reliability/ats-breakers';
import { fetchJobsResilient } from '@/lib/scraper/resilient-fetch';

export async function GET(
  request: Request,
  { params }: { params: { atsType: string } }
) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('companyId');

  if (!companyId) {
    return NextResponse.json(
      { error: 'companyId is required' },
      { status: 400 }
    );
  }

  try {
    const result = await fetchJobsResilient(params.atsType, companyId);

    return NextResponse.json({
      jobs: result.jobs,
      meta: {
        fromCache: result.fromCache,
        degraded: result.degraded,
        circuitStatus: getAllATSBreakerStatus()
      }
    });
  } catch (error) {
    console.error('Job fetch failed:', error);
    
    return NextResponse.json(
      { error: 'Failed to fetch jobs', details: (error as Error).message },
      { status: 500 }
    );
  }
}

// POST to reset a circuit breaker
export async function POST(
  request: Request,
  { params }: { params: { atsType: string } }
) {
  const { action } = await request.json();

  if (action === 'reset') {
    resetATSBreaker(params.atsType);
    return NextResponse.json({ success: true, message: 'Circuit breaker reset' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
```

### Example 3: Using Cockatiel for Full Resilience

```typescript
/**
 * Example using cockatiel library for comprehensive resilience.
 */

import {
  CircuitBreakerPolicy,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  retry,
  wrap,
  bulkhead,
  timeout
} from 'cockatiel';

// Create policies
const retryPolicy = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({
    initialDelay: 1000,
    maxDelay: 30000,
    exponent: 2
  })
});

const circuitBreaker = new CircuitBreakerPolicy(handleAll, {
  halfOpenAfter: 30000,
  breaker: new ConsecutiveBreaker(5)
});

const timeoutPolicy = timeout(10000, 'aggressive');

const bulkheadPolicy = bulkhead(10, 100); // 10 concurrent, 100 queued

// Wrap policies together (order matters: outer to inner)
const resilientPolicy = wrap(
  bulkheadPolicy,
  circuitBreaker,
  retryPolicy,
  timeoutPolicy
);

// Use the combined policy
export async function fetchWithFullResilience<T>(
  fn: () => Promise<T>
): Promise<T> {
  return resilientPolicy.execute(fn);
}

// Example usage
async function scrapeJob(url: string): Promise<any> {
  return fetchWithFullResilience(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
}
```

### Example 4: Health Check Endpoint

```typescript
/**
 * Health check endpoint that reports circuit breaker status.
 */

// app/api/health/route.ts

import { NextResponse } from 'next/server';
import { getAllATSBreakerStatus } from '@/lib/reliability/ats-breakers';
import { getDegradationState, DegradationLevel } from '@/lib/reliability/degradation';

export async function GET() {
  const circuitStatus = getAllATSBreakerStatus();
  const degradation = getDegradationState();

  // Calculate overall health
  const openCircuits = Object.values(circuitStatus)
    .filter(s => s.state === 'OPEN').length;
  const totalCircuits = Object.keys(circuitStatus).length;

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (degradation.level === DegradationLevel.OFFLINE) {
    status = 'unhealthy';
  } else if (openCircuits > 0 || degradation.level !== DegradationLevel.FULL) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    degradation: {
      level: degradation.level,
      reason: degradation.reason,
      affectedServices: degradation.affectedServices
    },
    circuits: {
      total: totalCircuits,
      open: openCircuits,
      details: circuitStatus
    }
  }, {
    status: status === 'unhealthy' ? 503 : 200
  });
}
```

---

## Quick Reference

### Error Classification Decision Tree

```
Error received
    |
    +-- Has HTTP status code?
    |       |
    |       +-- 429 (Rate Limited) --> RATE_LIMITED (retry with Retry-After)
    |       +-- 408, 500-504, 522, 524 --> TRANSIENT (retry)
    |       +-- 400, 401, 403, 404, 422 --> PERMANENT (don't retry)
    |       +-- Other --> Check error message
    |
    +-- Network error pattern?
    |       |
    |       +-- ECONNRESET, ETIMEDOUT, etc. --> TRANSIENT (retry)
    |
    +-- Unknown --> PERMANENT (fail fast)
```

### Circuit Breaker State Machine

```
    +--------+     threshold failures    +--------+
    | CLOSED |-------------------------->|  OPEN  |
    +--------+                           +--------+
        ^                                     |
        |                                     | reset timeout
        | success threshold                   v
        |                              +-----------+
        +------------------------------|HALF_OPEN  |
                                       +-----------+
                                            |
                                            | any failure
                                            v
                                       +--------+
                                       |  OPEN  |
                                       +--------+
```

### Recommended Backoff Presets by Use Case

| Use Case | Preset | Base Delay | Max Delay |
|----------|--------|------------|-----------|
| Idempotent reads | `aggressive` | 100ms | 5s |
| Standard API calls | `standard` | 1s | 30s |
| Rate-limited APIs | `conservative` | 2s | 60s |
| Strict rate limits | `gentle` | 5s | 120s |

---

## Package Installation

```bash
# Install all recommended packages
npm install opossum p-retry cockatiel

# TypeScript types
npm install -D @types/opossum
```

## File Structure

```
lib/
  reliability/
    error-classifier.ts   # Error classification logic
    backoff.ts            # Exponential backoff utilities
    retry.ts              # Retry wrapper
    circuit-breaker.ts    # Circuit breaker implementation
    ats-breakers.ts       # Per-ATS circuit breakers
    degradation.ts        # Graceful degradation
    index.ts              # Barrel export
```
