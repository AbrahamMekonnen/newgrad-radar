/**
 * Reliability Utilities - Barrel Export
 *
 * Central export for all reliability patterns:
 * - Error classification
 * - Circuit breaker
 * - Exponential backoff
 * - Retry wrapper
 * - Graceful degradation
 * - Error reporting
 */

// ============================================================================
// Error Classification
// ============================================================================

export {
  ErrorType,
  CircuitState,
  classifyError,
  shouldRetry,
  type ClassifiedError,
  type CircuitBreakerConfig,
  type CircuitBreakerStats
} from './circuit-breaker';

// ============================================================================
// Circuit Breaker
// ============================================================================

export {
  CircuitBreaker,
  CircuitOpenError,
  CircuitTimeoutError,
  getBreaker,
  executeWithBreaker,
  getAllBreakerStatus,
  getBreakerStatus,
  resetBreaker,
  resetAllBreakers,
  clearBreakerRegistry,
  hasOpenCircuits,
  getOpenCircuits,
  getATSConfig,
  getSupportedATSTypes,
  type ATSType
} from './circuit-breaker';

// ============================================================================
// Backoff
// ============================================================================

export {
  calculateBackoff,
  calculateRateLimitBackoff,
  backoffSleep,
  sleep,
  createBackoffIterator,
  createAsyncBackoffIterator,
  getATSBackoffConfig,
  formatDelay,
  estimateTotalRetryTime,
  BACKOFF_PRESETS,
  ATS_BACKOFF_PRESETS,
  type BackoffConfig,
  type JitterType
} from './backoff';

// ============================================================================
// Retry
// ============================================================================

export {
  retry,
  retryWithResult,
  withRetry,
  retryAll,
  retryWithContext,
  createDebouncedRetry,
  type RetryOptions,
  type RetryResult,
  type RetryContext
} from './retry';

// ============================================================================
// Degradation
// ============================================================================

export {
  DegradationLevel,
  getDegradationState,
  setDegradationLevel,
  recordServiceFailure,
  recordServiceSuccess,
  onDegradationChange,
  resetDegradation,
  getFeatureFlags,
  isFeatureAvailable,
  isServiceDegraded,
  withDegradation,
  formatDegradationState,
  getAllServiceStatuses,
  type DegradationState,
  type DegradedResponse,
  type DegradationOptions,
  type FeatureFlags
} from './degradation';

// ============================================================================
// Error Reporting
// ============================================================================

export {
  ErrorReporter,
  getErrorReporter,
  initErrorReporter,
  logError,
  logInfo,
  logWarn,
  flushLogs,
  type LogLevel,
  type LogCategory,
  type LogEntry,
  type ApplicationLogRow,
  type ErrorReporterConfig
} from './error-reporter';

// ============================================================================
// Combined Resilient Wrapper
// ============================================================================

import { executeWithBreaker, type ATSType } from './circuit-breaker';
import { retry, type RetryOptions } from './retry';
import { getATSBackoffConfig } from './backoff';
import { withDegradation, type DegradationOptions } from './degradation';
import { getErrorReporter } from './error-reporter';

export interface ResilientOptions<T> extends Partial<RetryOptions>, DegradationOptions<T> {
  /** ATS type for configuration */
  atsType?: string;

  /** User ID for logging */
  userId?: string;

  /** Job URL for logging */
  jobUrl?: string;

  /** Whether to use circuit breaker (default: true) */
  useCircuitBreaker?: boolean;
}

/**
 * Execute an operation with full resilience patterns.
 *
 * Combines:
 * - Circuit breaker for fail-fast
 * - Retry with exponential backoff
 * - Graceful degradation with fallback
 * - Error logging
 *
 * @example
 * const result = await resilientExecute(
 *   'greenhouse',
 *   () => fillApplicationForm(page, data),
 *   {
 *     atsType: 'greenhouse',
 *     jobUrl: 'https://boards.greenhouse.io/...',
 *     maxAttempts: 3,
 *     cache: {
 *       get: () => getCachedFormData(),
 *       set: (data) => cacheFormData(data)
 *     }
 *   }
 * );
 */
export async function resilientExecute<T>(
  serviceName: string,
  fn: () => Promise<T>,
  options: ResilientOptions<T> = {}
): Promise<{
  data: T | null;
  success: boolean;
  isStale: boolean;
  source: 'live' | 'cache' | 'fallback' | 'none';
  attempts: number;
  durationMs: number;
}> {
  const startTime = Date.now();
  const reporter = getErrorReporter();
  const atsType = options.atsType || serviceName;

  // Log start
  reporter.log({
    level: 'debug',
    category: 'application',
    message: `Starting resilient execution: ${serviceName}`,
    atsType,
    jobUrl: options.jobUrl
  });

  let attempts = 0;

  try {
    const result = await withDegradation(
      serviceName,
      async () => {
        // Layer 1: Circuit breaker (if enabled)
        if (options.useCircuitBreaker !== false) {
          return executeWithBreaker(atsType as ATSType, async () => {
            // Layer 2: Retry with backoff
            return retry(fn, {
              maxAttempts: options.maxAttempts || 3,
              backoff: options.backoff || getATSBackoffConfig(atsType),
              operationName: serviceName,
              atsType,
              onRetry: (error, attempt, delay) => {
                attempts = attempt;
                reporter.logRetry(attempt, error, delay, {
                  atsType,
                  jobUrl: options.jobUrl
                });
                options.onRetry?.(error, attempt, delay);
              }
            });
          });
        }

        // Just retry without circuit breaker
        return retry(fn, {
          maxAttempts: options.maxAttempts || 3,
          backoff: options.backoff || getATSBackoffConfig(atsType),
          operationName: serviceName,
          atsType,
          onRetry: (error, attempt, delay) => {
            attempts = attempt;
            reporter.logRetry(attempt, error, delay, {
              atsType,
              jobUrl: options.jobUrl
            });
            options.onRetry?.(error, attempt, delay);
          }
        });
      },
      {
        cache: options.cache,
        fallback: options.fallback,
        minLevel: options.minLevel,
        critical: options.critical
      }
    );

    const durationMs = Date.now() - startTime;

    // Log completion
    reporter.logPerformance(serviceName, durationMs, {
      atsType,
      jobUrl: options.jobUrl,
      succeeded: result.data !== null,
      metadata: {
        source: result.source,
        isStale: result.isStale,
        attempts
      }
    });

    return {
      data: result.data,
      success: result.data !== null,
      isStale: result.isStale,
      source: result.source,
      attempts: attempts + 1,
      durationMs
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    reporter.logError(error, {
      atsType,
      jobUrl: options.jobUrl,
      category: 'application',
      durationMs,
      retryAttempts: attempts
    });

    return {
      data: null,
      success: false,
      isStale: false,
      source: 'none',
      attempts: attempts + 1,
      durationMs
    };
  }
}

// ============================================================================
// Browser-Specific Retry
// ============================================================================

import { BACKOFF_PRESETS } from './backoff';

/**
 * Retry options optimized for browser automation.
 */
export const BROWSER_RETRY_OPTIONS: Partial<RetryOptions> = {
  maxAttempts: 3,
  backoff: BACKOFF_PRESETS.browser,
  timeout: 10000
};

/**
 * Retry a browser operation with optimized settings.
 */
export async function retryBrowserOperation<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  return retry(fn, {
    ...BROWSER_RETRY_OPTIONS,
    ...options
  });
}
