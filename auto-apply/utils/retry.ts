/**
 * Retry Wrapper with Exponential Backoff
 *
 * Provides robust retry functionality with error classification,
 * configurable backoff, and detailed logging for ATS interactions.
 */

import {
  classifyError,
  ErrorType,
  type ClassifiedError
} from './circuit-breaker';
import {
  calculateBackoff,
  calculateRateLimitBackoff,
  sleep,
  BACKOFF_PRESETS,
  getATSBackoffConfig,
  formatDelay,
  type BackoffConfig
} from './backoff';

// ============================================================================
// Types
// ============================================================================

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts: number;

  /** Backoff configuration */
  backoff?: Partial<BackoffConfig>;

  /** Custom retry predicate - return false to stop retrying */
  shouldRetry?: (error: ClassifiedError, attempt: number) => boolean;

  /** Callback fired before each retry */
  onRetry?: (error: ClassifiedError, attempt: number, delay: number) => void;

  /** Per-attempt timeout in ms (optional) */
  timeout?: number;

  /** Operation name for logging */
  operationName?: string;

  /** ATS type for ATS-specific configuration */
  atsType?: string;
}

export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;

  /** Result data if successful */
  data?: T;

  /** Classified error if failed */
  error?: ClassifiedError;

  /** Number of attempts made */
  attempts: number;

  /** Total time taken in milliseconds */
  totalTime: number;

  /** Array of all errors encountered */
  allErrors: ClassifiedError[];
}

export interface RetryContext {
  /** Current attempt number (1-indexed) */
  attempt: number;

  /** Maximum attempts configured */
  maxAttempts: number;

  /** Previous errors encountered */
  previousErrors: ClassifiedError[];

  /** Elapsed time in milliseconds */
  elapsedTime: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  backoff: BACKOFF_PRESETS.standard,
  operationName: 'operation'
};

// ============================================================================
// Core Retry Functions
// ============================================================================

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * Automatically classifies errors to determine retry behavior:
 * - TRANSIENT errors: Retry with exponential backoff
 * - RATE_LIMITED errors: Retry with Retry-After delay
 * - PERMANENT errors: Fail immediately (no retry)
 * - CIRCUIT_OPEN errors: Fail immediately (service unavailable)
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns Promise that resolves to the function result
 * @throws The last error if all retries fail
 *
 * @example
 * // Basic usage
 * const result = await retry(() => fetchJobListing(url));
 *
 * @example
 * // With ATS-specific configuration
 * const result = await retry(
 *   () => fillGreenhouseForm(page, data),
 *   { atsType: 'greenhouse', maxAttempts: 3 }
 * );
 *
 * @example
 * // With custom retry logic
 * const result = await retry(
 *   () => submitApplication(page),
 *   {
 *     maxAttempts: 5,
 *     shouldRetry: (error, attempt) => {
 *       // Don't retry validation errors
 *       if (error.message.includes('validation')) return false;
 *       return error.shouldRetry;
 *     },
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry ${attempt} in ${delay}ms: ${error.message}`);
 *     }
 *   }
 * );
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Use ATS-specific backoff if specified
  if (opts.atsType && !options.backoff) {
    opts.backoff = getATSBackoffConfig(opts.atsType);
  }

  let lastError: ClassifiedError | undefined;
  const allErrors: ClassifiedError[] = [];

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      // Apply per-attempt timeout if specified
      if (opts.timeout) {
        return await withTimeout(fn(), opts.timeout, opts.operationName);
      }
      return await fn();
    } catch (error) {
      lastError = classifyError(error);
      allErrors.push(lastError);

      // Determine if we should retry
      const shouldRetryError = opts.shouldRetry
        ? opts.shouldRetry(lastError, attempt)
        : lastError.shouldRetry;

      // Last attempt or permanent error - don't retry
      if (!shouldRetryError || attempt === opts.maxAttempts - 1) {
        // Enhance error message for user
        const enhancedError = enhanceErrorMessage(lastError, attempt + 1, opts.maxAttempts);
        throw enhancedError.originalError;
      }

      // Calculate delay (use retryAfter for rate limits)
      let delay: number;
      if (lastError.type === ErrorType.RATE_LIMITED && lastError.retryAfter) {
        delay = calculateRateLimitBackoff(attempt, lastError.retryAfter);
      } else {
        delay = calculateBackoff(attempt, opts.backoff);
      }

      // Notify retry callback
      if (opts.onRetry) {
        opts.onRetry(lastError, attempt + 1, delay);
      } else {
        // Default logging
        console.log(
          `[retry] ${opts.operationName} attempt ${attempt + 1} failed: ${lastError.message}. ` +
          `Retrying in ${formatDelay(delay)}...`
        );
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError?.originalError || new Error('Retry failed unexpectedly');
}

/**
 * Retry wrapper that returns a result object instead of throwing.
 * Useful when you want to handle errors without try/catch.
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns RetryResult object with success status and data/error
 *
 * @example
 * const result = await retryWithResult(() => fillForm(page, data));
 * if (result.success) {
 *   console.log('Form filled:', result.data);
 * } else {
 *   console.log(`Failed after ${result.attempts} attempts:`, result.error?.message);
 * }
 */
export async function retryWithResult<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  const allErrors: ClassifiedError[] = [];
  let attempts = 0;

  try {
    const data = await retry(fn, {
      ...options,
      onRetry: (error, attempt, delay) => {
        attempts = attempt;
        allErrors.push(error);
        options.onRetry?.(error, attempt, delay);
      }
    });

    return {
      success: true,
      data,
      attempts: attempts + 1,
      totalTime: Date.now() - startTime,
      allErrors
    };
  } catch (error) {
    const classified = classifyError(error);
    allErrors.push(classified);

    return {
      success: false,
      error: classified,
      attempts: attempts + 1,
      totalTime: Date.now() - startTime,
      allErrors
    };
  }
}

/**
 * Create a retryable version of a function.
 * Useful for wrapping existing functions with retry logic.
 *
 * @param fn - Function to wrap
 * @param options - Retry configuration
 * @returns Wrapped function with retry logic
 *
 * @example
 * const resilientFetch = withRetry(
 *   (url: string) => fetch(url).then(r => r.json()),
 *   { maxAttempts: 3 }
 * );
 * const data = await resilientFetch('https://api.example.com/jobs');
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: Partial<RetryOptions> = {}
): T {
  return (async (...args: Parameters<T>) => {
    return retry(() => fn(...args), options);
  }) as T;
}

/**
 * Execute multiple operations with individual retry logic.
 * Each operation is attempted independently.
 *
 * @param operations - Array of functions to execute
 * @param options - Retry configuration for each operation
 * @returns Array of results (successful or failed)
 *
 * @example
 * const results = await retryAll([
 *   () => fillField(page, 'firstName', 'John'),
 *   () => fillField(page, 'lastName', 'Doe'),
 *   () => fillField(page, 'email', 'john@example.com')
 * ], { maxAttempts: 2 });
 */
export async function retryAll<T>(
  operations: Array<() => Promise<T>>,
  options: Partial<RetryOptions> = {}
): Promise<Array<RetryResult<T>>> {
  const results = await Promise.allSettled(
    operations.map((op, index) =>
      retryWithResult(op, {
        ...options,
        operationName: `${options.operationName || 'operation'}-${index}`
      })
    )
  );

  return results.map(result =>
    result.status === 'fulfilled'
      ? result.value
      : {
          success: false,
          error: classifyError(result.reason),
          attempts: 1,
          totalTime: 0,
          allErrors: [classifyError(result.reason)]
        }
  );
}

// ============================================================================
// Context-Aware Retry
// ============================================================================

/**
 * Execute a function with retry, passing context to each attempt.
 * Useful when the operation needs to know about previous attempts.
 *
 * @param fn - Function that receives retry context
 * @param options - Retry configuration
 * @returns Promise that resolves to the function result
 *
 * @example
 * const result = await retryWithContext(
 *   async (ctx) => {
 *     if (ctx.attempt > 1) {
 *       // Adjust strategy on retry
 *       await page.reload();
 *     }
 *     return fillForm(page, data);
 *   },
 *   { maxAttempts: 3 }
 * );
 */
export async function retryWithContext<T>(
  fn: (context: RetryContext) => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const previousErrors: ClassifiedError[] = [];

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const context: RetryContext = {
      attempt,
      maxAttempts: opts.maxAttempts,
      previousErrors: [...previousErrors],
      elapsedTime: Date.now() - startTime
    };

    try {
      return await fn(context);
    } catch (error) {
      const classified = classifyError(error);
      previousErrors.push(classified);

      const shouldRetryError = opts.shouldRetry
        ? opts.shouldRetry(classified, attempt - 1)
        : classified.shouldRetry;

      if (!shouldRetryError || attempt === opts.maxAttempts) {
        throw enhanceErrorMessage(classified, attempt, opts.maxAttempts).originalError;
      }

      const delay = classified.type === ErrorType.RATE_LIMITED && classified.retryAfter
        ? calculateRateLimitBackoff(attempt - 1, classified.retryAfter)
        : calculateBackoff(attempt - 1, opts.backoff);

      opts.onRetry?.(classified, attempt, delay);
      await sleep(delay);
    }
  }

  throw new Error('Retry failed unexpectedly');
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wrap a promise with a timeout.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operationName?: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(
        `${operationName || 'Operation'} timed out after ${ms}ms`
      );
      (error as any).code = 'ETIMEDOUT';
      reject(error);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Enhance error message with retry context for better user feedback.
 */
function enhanceErrorMessage(
  error: ClassifiedError,
  attempt: number,
  maxAttempts: number
): ClassifiedError {
  const prefix = attempt >= maxAttempts
    ? `Failed after ${attempt} attempts: `
    : `Attempt ${attempt} failed: `;

  const suffix = getUserFriendlyAdvice(error);

  return {
    ...error,
    message: `${prefix}${error.message}${suffix ? `. ${suffix}` : ''}`
  };
}

/**
 * Get user-friendly advice based on error type.
 */
function getUserFriendlyAdvice(error: ClassifiedError): string {
  switch (error.type) {
    case ErrorType.RATE_LIMITED:
      return 'Too many requests. Please wait a moment before trying again';

    case ErrorType.TRANSIENT:
      if (error.message.includes('timeout')) {
        return 'The server is slow to respond. Try again later';
      }
      if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        return 'Cannot connect to the server. Check your internet connection';
      }
      return 'A temporary error occurred';

    case ErrorType.PERMANENT:
      if (error.originalError.message.includes('401') || error.originalError.message.includes('403')) {
        return 'Authentication failed. You may need to log in again';
      }
      if (error.originalError.message.includes('404')) {
        return 'The job posting may no longer be available';
      }
      if (error.originalError.message.includes('422')) {
        return 'Some form fields may have invalid values';
      }
      return 'This error cannot be automatically retried';

    case ErrorType.CIRCUIT_OPEN:
      return 'The service is temporarily unavailable. Please try again later';

    default:
      return '';
  }
}

/**
 * Create a debounced retry - useful for UI operations that might be triggered rapidly.
 */
export function createDebouncedRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: Partial<RetryOptions> & { debounceMs?: number } = {}
): T {
  const { debounceMs = 300, ...retryOptions } = options;
  let timeoutId: NodeJS.Timeout | undefined;
  let pendingPromise: Promise<any> | undefined;

  return (async (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (pendingPromise) {
      return pendingPromise;
    }

    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          pendingPromise = retry(() => fn(...args), retryOptions);
          const result = await pendingPromise;
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          pendingPromise = undefined;
        }
      }, debounceMs);
    });
  }) as T;
}
