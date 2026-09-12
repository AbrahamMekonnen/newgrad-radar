/**
 * Reliability Utilities - JavaScript Barrel Export
 *
 * Provides exports for JavaScript modules that need to use the reliability utilities.
 * The actual implementations are in TypeScript files - use dynamic imports if needed
 * or ensure tsx/ts-node is available in the build chain.
 *
 * For direct usage in Node.js without TypeScript compilation, this module provides
 * JavaScript-compatible versions of the core reliability functions.
 */

// =============================================================================
// ERROR CLASSIFICATION
// =============================================================================

/**
 * Error types for retry decisions
 */
export const ErrorType = {
  TRANSIENT: 'TRANSIENT',      // Retry with backoff
  PERMANENT: 'PERMANENT',       // Don't retry
  RATE_LIMITED: 'RATE_LIMITED', // Retry with longer delay
  CIRCUIT_OPEN: 'CIRCUIT_OPEN'  // Service unavailable
};

/**
 * HTTP status codes that indicate transient failures
 */
const TRANSIENT_STATUS_CODES = new Set([
  408, 429, 500, 502, 503, 504, 522, 524
]);

/**
 * HTTP status codes that indicate permanent failures
 */
const PERMANENT_STATUS_CODES = new Set([
  400, 401, 403, 404, 405, 410, 422, 451
]);

/**
 * Network error patterns
 */
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

/**
 * Extract HTTP status code from error
 */
function extractStatusCode(error) {
  if (error?.status && typeof error.status === 'number') return error.status;
  if (error?.response?.status) return error.response.status;
  if (error?.statusCode && typeof error.statusCode === 'number') return error.statusCode;
  return null;
}

/**
 * Extract Retry-After header value
 */
function extractRetryAfter(error) {
  const headers = error?.response?.headers || error?.headers;
  if (!headers) return null;

  const retryAfter = headers.get?.('retry-after') || headers['retry-after'];
  if (!retryAfter) return null;

  const parsed = parseInt(retryAfter, 10);
  if (!isNaN(parsed)) return parsed * 1000;

  const date = Date.parse(retryAfter);
  if (!isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

/**
 * Classify an error to determine retry behavior
 */
export function classifyError(error) {
  if (!(error instanceof Error)) {
    return {
      type: ErrorType.PERMANENT,
      originalError: new Error(String(error)),
      shouldRetry: false,
      message: String(error)
    };
  }

  const statusCode = extractStatusCode(error);
  if (statusCode !== null) {
    if (statusCode === 429) {
      const retryAfter = extractRetryAfter(error);
      return {
        type: ErrorType.RATE_LIMITED,
        originalError: error,
        retryAfter: retryAfter || 60000,
        shouldRetry: true,
        message: `Rate limited (429). Retry after ${retryAfter || 60000}ms`
      };
    }

    if (TRANSIENT_STATUS_CODES.has(statusCode)) {
      return {
        type: ErrorType.TRANSIENT,
        originalError: error,
        shouldRetry: true,
        message: `Transient HTTP error: ${statusCode}`
      };
    }

    if (PERMANENT_STATUS_CODES.has(statusCode)) {
      return {
        type: ErrorType.PERMANENT,
        originalError: error,
        shouldRetry: false,
        message: `Permanent HTTP error: ${statusCode}`
      };
    }
  }

  const errorMessage = error.message || '';
  const errorCode = error.code || '';

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

  return {
    type: ErrorType.PERMANENT,
    originalError: error,
    shouldRetry: false,
    message: `Unknown error type: ${error.message}`
  };
}

/**
 * Check if an error should be retried
 */
export function shouldRetry(error) {
  return classifyError(error).shouldRetry;
}

// =============================================================================
// BACKOFF
// =============================================================================

export const BACKOFF_PRESETS = {
  aggressive: { baseDelay: 100, maxDelay: 5000, factor: 1.5, jitter: 'full' },
  standard: { baseDelay: 1000, maxDelay: 30000, factor: 2, jitter: 'full' },
  conservative: { baseDelay: 2000, maxDelay: 60000, factor: 2, jitter: 'equal' },
  gentle: { baseDelay: 5000, maxDelay: 120000, factor: 2, jitter: 'full' },
  browser: { baseDelay: 200, maxDelay: 10000, factor: 2, jitter: 'full' }
};

/**
 * Calculate backoff delay for a given attempt
 */
export function calculateBackoff(attempt, config = {}) {
  const {
    baseDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    jitter = 'full'
  } = { ...BACKOFF_PRESETS.standard, ...config };

  const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(factor, attempt));

  switch (jitter) {
    case 'none':
      return exponentialDelay;
    case 'full':
      return Math.floor(Math.random() * exponentialDelay);
    case 'equal':
      const half = exponentialDelay / 2;
      return Math.floor(half + Math.random() * half);
    case 'decorrelated':
      return Math.floor(Math.min(maxDelay, Math.random() * exponentialDelay * 3));
    default:
      return exponentialDelay;
  }
}

/**
 * Sleep for specified duration
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format delay for display
 */
export function formatDelay(delayMs) {
  if (delayMs < 1000) return `${delayMs}ms`;
  if (delayMs < 60000) return `${(delayMs / 1000).toFixed(1)} seconds`;
  return `${(delayMs / 60000).toFixed(1)} minutes`;
}

// =============================================================================
// RETRY
// =============================================================================

/**
 * Execute a function with retry logic
 */
export async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    backoff = BACKOFF_PRESETS.standard,
    shouldRetry: customShouldRetry,
    onRetry,
    timeout,
    operationName = 'operation'
  } = options;

  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (timeout) {
        return await withTimeout(fn(), timeout, operationName);
      }
      return await fn();
    } catch (error) {
      lastError = classifyError(error);

      const shouldRetryError = customShouldRetry
        ? customShouldRetry(lastError, attempt)
        : lastError.shouldRetry;

      if (!shouldRetryError || attempt === maxAttempts - 1) {
        throw lastError.originalError;
      }

      let delay;
      if (lastError.type === ErrorType.RATE_LIMITED && lastError.retryAfter) {
        delay = lastError.retryAfter;
      } else {
        delay = calculateBackoff(attempt, backoff);
      }

      if (onRetry) {
        onRetry(lastError, attempt + 1, delay);
      } else {
        console.log(
          `[retry] ${operationName} attempt ${attempt + 1} failed: ${lastError.message}. ` +
          `Retrying in ${formatDelay(delay)}...`
        );
      }

      await sleep(delay);
    }
  }

  throw lastError?.originalError || new Error('Retry failed unexpectedly');
}

/**
 * Retry with result object instead of throwing
 */
export async function retryWithResult(fn, options = {}) {
  const startTime = Date.now();
  const allErrors = [];
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
 * Browser operation retry with optimized settings
 */
export async function retryBrowserOperation(fn, options = {}) {
  return retry(fn, {
    maxAttempts: 3,
    backoff: BACKOFF_PRESETS.browser,
    timeout: 10000,
    ...options
  });
}

// Timeout wrapper
async function withTimeout(promise, ms, operationName) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${operationName || 'Operation'} timed out after ${ms}ms`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// DEGRADATION
// =============================================================================

export const DegradationLevel = {
  FULL: 'FULL',
  PARTIAL: 'PARTIAL',
  CACHED: 'CACHED',
  MINIMAL: 'MINIMAL',
  OFFLINE: 'OFFLINE'
};

// Module state
let currentDegradationState = {
  level: DegradationLevel.FULL,
  reason: '',
  affectedServices: [],
  since: new Date(),
  degradationCount: 0
};

const serviceStatus = new Map();

export function getDegradationState() {
  return { ...currentDegradationState };
}

export function setDegradationLevel(level, reason, affectedServices = []) {
  const previousLevel = currentDegradationState.level;

  currentDegradationState = {
    level,
    reason,
    affectedServices,
    since: level !== previousLevel ? new Date() : currentDegradationState.since,
    degradationCount: level !== DegradationLevel.FULL
      ? currentDegradationState.degradationCount + (level !== previousLevel ? 1 : 0)
      : 0
  };

  if (level !== previousLevel) {
    console.warn(`[degradation] Level changed: ${previousLevel} -> ${level}. Reason: ${reason}`);
  }
}

export function recordServiceFailure(serviceName, error, options = {}) {
  const { threshold = 3, escalate = true } = options;

  const status = serviceStatus.get(serviceName) || {
    level: DegradationLevel.FULL,
    errorCount: 0
  };

  status.errorCount++;
  status.lastError = error;

  if (status.errorCount >= threshold * 2) {
    status.level = DegradationLevel.OFFLINE;
  } else if (status.errorCount >= threshold) {
    status.level = DegradationLevel.PARTIAL;
  }

  serviceStatus.set(serviceName, status);

  if (escalate && status.level !== DegradationLevel.FULL) {
    updateGlobalDegradation();
  }
}

export function recordServiceSuccess(serviceName) {
  const status = serviceStatus.get(serviceName);
  if (status) {
    status.errorCount = Math.max(0, status.errorCount - 1);
    status.lastSuccess = new Date();
    if (status.errorCount === 0) {
      status.level = DegradationLevel.FULL;
    }
    serviceStatus.set(serviceName, status);
    updateGlobalDegradation();
  }
}

function updateGlobalDegradation() {
  const affectedServices = [];
  let worstLevel = DegradationLevel.FULL;
  const levelOrder = [
    DegradationLevel.FULL,
    DegradationLevel.PARTIAL,
    DegradationLevel.CACHED,
    DegradationLevel.MINIMAL,
    DegradationLevel.OFFLINE
  ];

  for (const [name, status] of serviceStatus) {
    if (status.level !== DegradationLevel.FULL) {
      affectedServices.push(name);
      if (levelOrder.indexOf(status.level) > levelOrder.indexOf(worstLevel)) {
        worstLevel = status.level;
      }
    }
  }

  if (affectedServices.length === 0) {
    setDegradationLevel(DegradationLevel.FULL, 'All services operational', []);
  } else {
    setDegradationLevel(
      worstLevel,
      `${affectedServices.length} service(s) experiencing issues`,
      affectedServices
    );
  }
}

export function getFeatureFlags() {
  const level = currentDegradationState.level;

  return {
    canApply: level === DegradationLevel.FULL || level === DegradationLevel.PARTIAL,
    canGenerateAnswers: level === DegradationLevel.FULL,
    canUploadFiles: level !== DegradationLevel.OFFLINE,
    canSubmit: level === DegradationLevel.FULL,
    canFetchJobs: level !== DegradationLevel.OFFLINE,
    canUseBrowser: level !== DegradationLevel.OFFLINE,
    canLog: true,
    canUseCache: level !== DegradationLevel.OFFLINE,
    showWarning: level !== DegradationLevel.FULL,
    statusMessage: getStatusMessage(level)
  };
}

function getStatusMessage(level) {
  switch (level) {
    case DegradationLevel.FULL:
      return 'All systems operational';
    case DegradationLevel.PARTIAL:
      return 'Some features may be slower or limited';
    case DegradationLevel.CACHED:
      return 'Showing cached data. Live updates temporarily unavailable';
    case DegradationLevel.MINIMAL:
      return 'Limited functionality. Only core features available';
    case DegradationLevel.OFFLINE:
      return 'Service temporarily unavailable. Please try again later';
    default:
      return 'Unknown status';
  }
}

export function formatDegradationState(state) {
  const duration = Date.now() - state.since.getTime();
  const durationStr = duration < 60000
    ? `${Math.floor(duration / 1000)}s`
    : `${Math.floor(duration / 60000)}m`;

  return [
    `Level: ${state.level}`,
    `Reason: ${state.reason}`,
    `Duration: ${durationStr}`,
    `Affected: ${state.affectedServices.join(', ') || 'none'}`,
    `Events: ${state.degradationCount}`
  ].join(' | ');
}

export function getAllServiceStatuses() {
  const result = {};
  for (const [name, status] of serviceStatus) {
    result[name] = {
      level: status.level,
      errorCount: status.errorCount,
      lastError: status.lastError?.message,
      lastSuccess: status.lastSuccess?.toISOString()
    };
  }
  return result;
}

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

// ATS-specific circuit breaker configs
const ATS_CONFIGS = {
  greenhouse: { timeout: 10000, failureThreshold: 5, successThreshold: 3, resetTimeout: 30000 },
  lever: { timeout: 10000, failureThreshold: 5, successThreshold: 3, resetTimeout: 20000 },
  ashby: { timeout: 8000, failureThreshold: 5, successThreshold: 3, resetTimeout: 15000 },
  jobvite: { timeout: 12000, failureThreshold: 5, successThreshold: 3, resetTimeout: 25000 },
  workday: { timeout: 20000, failureThreshold: 3, successThreshold: 5, resetTimeout: 45000 },
  default: { timeout: 10000, failureThreshold: 5, successThreshold: 3, resetTimeout: 30000 }
};

const breakerRegistry = new Map();

export function getBreaker(atsType) {
  const normalizedType = atsType.toLowerCase();

  if (!breakerRegistry.has(normalizedType)) {
    const config = ATS_CONFIGS[normalizedType] || ATS_CONFIGS.default;
    breakerRegistry.set(normalizedType, {
      name: normalizedType,
      state: CircuitState.CLOSED,
      failures: 0,
      successes: 0,
      lastFailureTime: null,
      config
    });
  }

  return breakerRegistry.get(normalizedType);
}

export function getAllBreakerStatus() {
  const status = {};
  for (const [name, breaker] of breakerRegistry) {
    status[name] = {
      state: breaker.state,
      failures: breaker.failures,
      successes: breaker.successes,
      lastFailureTime: breaker.lastFailureTime
    };
  }
  return status;
}

export function hasOpenCircuits() {
  for (const breaker of breakerRegistry.values()) {
    if (breaker.state === CircuitState.OPEN) return true;
  }
  return false;
}

export function getOpenCircuits() {
  const open = [];
  for (const [name, breaker] of breakerRegistry) {
    if (breaker.state === CircuitState.OPEN) open.push(name);
  }
  return open;
}

export function resetBreaker(atsType) {
  const breaker = breakerRegistry.get(atsType.toLowerCase());
  if (breaker) {
    breaker.state = CircuitState.CLOSED;
    breaker.failures = 0;
  }
}

export function resetAllBreakers() {
  for (const breaker of breakerRegistry.values()) {
    breaker.state = CircuitState.CLOSED;
    breaker.failures = 0;
  }
}

// =============================================================================
// ERROR REPORTER
// =============================================================================

let reporterInstance = null;

class ErrorReporter {
  constructor(config = {}) {
    this.config = {
      minLevel: config.minLevel || 'info',
      consoleLog: config.consoleLog ?? true,
      batchLogs: config.batchLogs ?? true,
      batchInterval: config.batchInterval || 5000,
      maxBatchSize: config.maxBatchSize || 50,
      sessionId: config.sessionId || `session_${Date.now()}`
    };
    this.logQueue = [];
    this.flushTimer = null;
  }

  async log(entry) {
    if (this.config.consoleLog) {
      this._logToConsole(entry);
    }
    // For now, just queue - production would send to Supabase
    if (this.config.batchLogs) {
      this.logQueue.push({ ...entry, timestamp: new Date().toISOString() });
      if (this.logQueue.length >= this.config.maxBatchSize) {
        await this.flush();
      }
    }
  }

  async logError(error, context = {}) {
    const classified = classifyError(error);
    await this.log({
      level: classified.type === ErrorType.PERMANENT ? 'error' : 'warn',
      category: context.category || 'application',
      message: classified.message,
      errorType: classified.type,
      stackTrace: classified.originalError.stack,
      ...context
    });
    return classified;
  }

  async logRetry(attempt, error, delayMs, context = {}) {
    await this.log({
      level: 'warn',
      category: context.category || 'application',
      message: `Retry attempt ${attempt}: ${error.message}. Waiting ${delayMs}ms`,
      errorType: error.type,
      retryAttempts: attempt,
      ...context
    });
  }

  async logApplicationStart(jobUrl, atsType, userId) {
    await this.log({
      level: 'info',
      category: 'application',
      message: `Starting application for ${atsType} job`,
      atsType,
      jobUrl,
      userId
    });
  }

  async logApplicationComplete(jobUrl, atsType, succeeded, durationMs, context = {}) {
    await this.log({
      level: succeeded ? 'info' : 'error',
      category: 'application',
      message: succeeded
        ? `Application completed successfully in ${durationMs}ms`
        : `Application failed after ${durationMs}ms`,
      atsType,
      jobUrl,
      durationMs,
      succeeded,
      ...context
    });
  }

  async logPerformance(operation, durationMs, context = {}) {
    await this.log({
      level: durationMs > 30000 ? 'warn' : 'info',
      category: 'performance',
      message: `${operation} completed in ${durationMs}ms`,
      durationMs,
      ...context
    });
  }

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // In production, would batch write to Supabase here
    this.logQueue = [];
  }

  _logToConsole(entry) {
    const prefix = `[${entry.category || 'app'}]`;
    const timestamp = new Date().toISOString();

    switch (entry.level) {
      case 'debug':
        console.debug(`${timestamp} ${prefix} ${entry.message}`);
        break;
      case 'info':
        console.info(`${timestamp} ${prefix} ${entry.message}`);
        break;
      case 'warn':
        console.warn(`${timestamp} ${prefix} ${entry.message}`);
        break;
      case 'error':
      case 'fatal':
        console.error(`${timestamp} ${prefix} ${entry.message}`);
        break;
    }
  }
}

export function getErrorReporter(config) {
  if (!reporterInstance) {
    reporterInstance = new ErrorReporter(config);
  }
  return reporterInstance;
}

export function initErrorReporter(config) {
  reporterInstance = new ErrorReporter(config);
  return reporterInstance;
}

export async function logError(error, context = {}) {
  return getErrorReporter().logError(error, context);
}

export async function logInfo(message, context = {}) {
  return getErrorReporter().log({
    level: 'info',
    category: context.category || 'application',
    message,
    ...context
  });
}

export async function logWarn(message, context = {}) {
  return getErrorReporter().log({
    level: 'warn',
    category: context.category || 'application',
    message,
    ...context
  });
}

export async function flushLogs() {
  return getErrorReporter().flush();
}
