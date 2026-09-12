/**
 * Exponential Backoff with Jitter
 *
 * Implements AWS-recommended backoff strategies to prevent thundering herd
 * and provide resilient retry behavior for ATS API interactions.
 */

// ============================================================================
// Types
// ============================================================================

export type JitterType = 'full' | 'equal' | 'decorrelated' | 'none';

export interface BackoffConfig {
  baseDelay: number;      // Initial delay in ms (default: 1000)
  maxDelay: number;       // Maximum delay cap in ms (default: 30000)
  factor: number;         // Exponential factor (default: 2)
  jitter: JitterType;     // Jitter strategy (default: 'full')
}

// ============================================================================
// Defaults and Presets
// ============================================================================

const DEFAULT_CONFIG: BackoffConfig = {
  baseDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  jitter: 'full'
};

/**
 * Preset configurations for common scenarios.
 * Choose based on the criticality and rate-limiting behavior of the ATS.
 */
export const BACKOFF_PRESETS = {
  // Fast retry for idempotent operations (form field filling)
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

  // Conservative retry for rate-limited APIs (Workday, Taleo)
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
  },

  // Browser automation specific - faster for UI interactions
  browser: {
    baseDelay: 200,
    maxDelay: 10000,
    factor: 2,
    jitter: 'full' as const
  }
} as const;

/**
 * ATS-specific backoff presets based on observed behavior.
 */
export const ATS_BACKOFF_PRESETS: Record<string, BackoffConfig> = {
  greenhouse: BACKOFF_PRESETS.standard,
  lever: BACKOFF_PRESETS.standard,
  ashby: BACKOFF_PRESETS.aggressive,  // Ashby is generally fast
  jobvite: BACKOFF_PRESETS.standard,
  workday: BACKOFF_PRESETS.conservative,  // Workday is slow and rate-limits
  taleo: BACKOFF_PRESETS.conservative,
  icims: BACKOFF_PRESETS.standard,
  default: BACKOFF_PRESETS.standard
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate delay for a given attempt number using exponential backoff.
 *
 * @param attempt - Zero-indexed attempt number (0, 1, 2, ...)
 * @param config - Backoff configuration
 * @returns Delay in milliseconds
 *
 * @example
 * // First retry: ~500ms (with jitter)
 * const delay = calculateBackoff(0, { baseDelay: 1000, jitter: 'full' });
 *
 * @example
 * // Third retry with conservative preset: ~4000ms (with jitter)
 * const delay = calculateBackoff(2, BACKOFF_PRESETS.conservative);
 */
export function calculateBackoff(
  attempt: number,
  config: Partial<BackoffConfig> = {}
): number {
  const { baseDelay, maxDelay, factor, jitter } = { ...DEFAULT_CONFIG, ...config };

  // Calculate exponential delay: base * factor^attempt
  // Capped at maxDelay
  const exponentialDelay = Math.min(
    maxDelay,
    baseDelay * Math.pow(factor, attempt)
  );

  // Apply jitter strategy
  switch (jitter) {
    case 'none':
      // No jitter - exact exponential delay
      return exponentialDelay;

    case 'full':
      // Full jitter: random between 0 and exponentialDelay
      // Best for reducing contention when many clients retry simultaneously
      return Math.floor(Math.random() * exponentialDelay);

    case 'equal':
      // Equal jitter: half exponential + half random
      // Balanced approach - guarantees minimum delay
      const half = exponentialDelay / 2;
      return Math.floor(half + Math.random() * half);

    case 'decorrelated':
      // Decorrelated jitter: uses random factor of previous delay
      // Good for correlated failures
      return Math.floor(
        Math.min(maxDelay, Math.random() * exponentialDelay * 3)
      );

    default:
      return exponentialDelay;
  }
}

/**
 * Calculate delay specifically for rate-limited responses (429).
 * Uses Retry-After header when available, otherwise falls back to backoff.
 *
 * @param attempt - Zero-indexed attempt number
 * @param retryAfterMs - Optional Retry-After header value in milliseconds
 * @param config - Backoff configuration
 * @returns Delay in milliseconds
 */
export function calculateRateLimitBackoff(
  attempt: number,
  retryAfterMs?: number,
  config: Partial<BackoffConfig> = {}
): number {
  // If we have a Retry-After header, use it with some jitter
  if (retryAfterMs && retryAfterMs > 0) {
    // Add 0-10% jitter to avoid synchronized retries
    const jitter = retryAfterMs * (Math.random() * 0.1);
    return Math.floor(retryAfterMs + jitter);
  }

  // Otherwise, use conservative backoff for rate limits
  return calculateBackoff(attempt, {
    ...BACKOFF_PRESETS.conservative,
    ...config
  });
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Sleep for the calculated backoff duration.
 * Returns the actual delay used (useful for logging).
 *
 * @param attempt - Zero-indexed attempt number
 * @param config - Backoff configuration
 * @returns Promise that resolves to the delay in milliseconds
 */
export async function backoffSleep(
  attempt: number,
  config?: Partial<BackoffConfig>
): Promise<number> {
  const delay = calculateBackoff(attempt, config);
  await sleep(delay);
  return delay;
}

/**
 * Sleep for a specified duration.
 *
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Backoff Iterators
// ============================================================================

/**
 * Create a backoff iterator for manual retry control.
 * Useful when you need more control over the retry loop.
 *
 * @param maxAttempts - Maximum number of attempts
 * @param config - Backoff configuration
 *
 * @example
 * for (const delay of createBackoffIterator(3)) {
 *   try {
 *     await operation();
 *     break;
 *   } catch (error) {
 *     console.log(`Retry in ${delay}ms`);
 *     await sleep(delay);
 *   }
 * }
 */
export function* createBackoffIterator(
  maxAttempts: number,
  config?: Partial<BackoffConfig>
): Generator<number, void, unknown> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    yield calculateBackoff(attempt, config);
  }
}

/**
 * Create an async backoff iterator that automatically waits.
 *
 * @param maxAttempts - Maximum number of attempts
 * @param config - Backoff configuration
 *
 * @example
 * for await (const { attempt, delay } of createAsyncBackoffIterator(3)) {
 *   try {
 *     await operation();
 *     break;
 *   } catch (error) {
 *     console.log(`Attempt ${attempt} failed, waited ${delay}ms`);
 *   }
 * }
 */
export async function* createAsyncBackoffIterator(
  maxAttempts: number,
  config?: Partial<BackoffConfig>
): AsyncGenerator<{ attempt: number; delay: number }, void, unknown> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = await backoffSleep(attempt - 1, config);
      yield { attempt, delay };
    } else {
      yield { attempt, delay: 0 };
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the appropriate backoff preset for an ATS type.
 *
 * @param atsType - ATS identifier (greenhouse, lever, etc.)
 * @returns Backoff configuration for that ATS
 */
export function getATSBackoffConfig(atsType: string): BackoffConfig {
  const normalizedType = atsType.toLowerCase();
  return ATS_BACKOFF_PRESETS[normalizedType] || ATS_BACKOFF_PRESETS.default;
}

/**
 * Format backoff delay for user-friendly display.
 *
 * @param delayMs - Delay in milliseconds
 * @returns Human-readable string (e.g., "2.5 seconds")
 */
export function formatDelay(delayMs: number): string {
  if (delayMs < 1000) {
    return `${delayMs}ms`;
  } else if (delayMs < 60000) {
    return `${(delayMs / 1000).toFixed(1)} seconds`;
  } else {
    return `${(delayMs / 60000).toFixed(1)} minutes`;
  }
}

/**
 * Calculate total estimated time for all retry attempts.
 * Useful for setting overall operation timeouts.
 *
 * @param maxAttempts - Maximum number of attempts
 * @param config - Backoff configuration
 * @returns Estimated total time in milliseconds (using max delays)
 */
export function estimateTotalRetryTime(
  maxAttempts: number,
  config?: Partial<BackoffConfig>
): number {
  const { baseDelay, maxDelay, factor } = { ...DEFAULT_CONFIG, ...config };

  let total = 0;
  for (let i = 0; i < maxAttempts - 1; i++) {
    // Use max possible delay for estimation
    total += Math.min(maxDelay, baseDelay * Math.pow(factor, i));
  }
  return total;
}
