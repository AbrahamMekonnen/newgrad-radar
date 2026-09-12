/**
 * Circuit Breaker Implementation for ATS Systems
 *
 * Provides resilience patterns for interacting with external ATS APIs.
 * Each ATS (Greenhouse, Workday, Lever, etc.) gets its own circuit breaker
 * with tailored configuration based on observed reliability characteristics.
 */

// ============================================================================
// Types and Enums
// ============================================================================

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation, requests flow through
  OPEN = 'OPEN',         // Circuit tripped, requests fail fast
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export enum ErrorType {
  TRANSIENT = 'TRANSIENT',       // Retry with backoff
  PERMANENT = 'PERMANENT',       // Don't retry
  RATE_LIMITED = 'RATE_LIMITED', // Retry with longer delay
  CIRCUIT_OPEN = 'CIRCUIT_OPEN'  // Service unavailable
}

export interface CircuitBreakerConfig {
  timeout: number;                  // Request timeout in ms
  failureThreshold: number;         // Failures before opening
  successThreshold: number;         // Successes to close from half-open
  resetTimeout: number;             // Ms before trying half-open
  volumeThreshold: number;          // Min requests before calculating failure rate
  errorThresholdPercentage: number; // Error % to trip circuit
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface ClassifiedError {
  type: ErrorType;
  originalError: Error;
  retryAfter?: number;
  shouldRetry: boolean;
  message: string;
}

// ============================================================================
// Error Classification
// ============================================================================

// HTTP status codes that indicate transient failures (should retry)
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

// Network error patterns that indicate transient failures
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
 * Extract HTTP status code from various error formats.
 */
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

/**
 * Extract Retry-After header value from error response.
 */
function extractRetryAfter(error: Error): number | null {
  const headers = (error as any).response?.headers || (error as any).headers;
  if (!headers) return null;

  const retryAfter = headers.get?.('retry-after') || headers['retry-after'];
  if (!retryAfter) return null;

  // Parse as seconds
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

/**
 * Classify an error to determine retry behavior.
 */
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

  // Check for circuit open errors
  if (error instanceof CircuitOpenError) {
    return {
      type: ErrorType.CIRCUIT_OPEN,
      originalError: error,
      shouldRetry: false,
      message: error.message
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
        retryAfter: retryAfter || 60000,
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

/**
 * Check if an error should be retried.
 */
export function shouldRetry(error: unknown): boolean {
  return classifyError(error).shouldRetry;
}

// ============================================================================
// Custom Errors
// ============================================================================

export class CircuitOpenError extends Error {
  constructor(
    public readonly atsType: string,
    public readonly stats: CircuitBreakerStats
  ) {
    super(`Circuit breaker is OPEN for ${atsType}. Service unavailable.`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitTimeoutError extends Error {
  constructor(
    public readonly atsType: string,
    public readonly timeout: number
  ) {
    super(`Request to ${atsType} timed out after ${timeout}ms`);
    this.name = 'CircuitTimeoutError';
  }
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

/**
 * Circuit Breaker class implementing the three-state pattern.
 *
 * State transitions:
 * - CLOSED -> OPEN: When failure threshold is reached
 * - OPEN -> HALF_OPEN: After resetTimeout expires
 * - HALF_OPEN -> CLOSED: After successThreshold consecutive successes
 * - HALF_OPEN -> OPEN: On any failure
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private totalRequests = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private halfOpenAttempts = 0;

  private readonly config: CircuitBreakerConfig;

  constructor(
    public readonly name: string,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    this.config = {
      timeout: config.timeout ?? 10000,
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 3,
      resetTimeout: config.resetTimeout ?? 30000,
      volumeThreshold: config.volumeThreshold ?? 5,
      errorThresholdPercentage: config.errorThresholdPercentage ?? 50,
      ...config
    };
  }

  /**
   * Execute a function through the circuit breaker.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
        this.halfOpenAttempts = 0;
      } else {
        throw new CircuitOpenError(this.name, this.getStats());
      }
    }

    // Apply timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new CircuitTimeoutError(this.name, this.config.timeout));
      }, this.config.timeout);
    });

    try {
      this.totalRequests++;
      const result = await Promise.race([fn(), timeoutPromise]);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    }
  }

  /**
   * Check if enough time has passed to try resetting.
   */
  private shouldAttemptReset(): boolean {
    return (
      this.lastFailureTime !== undefined &&
      Date.now() - this.lastFailureTime >= this.config.resetTimeout
    );
  }

  /**
   * Record a successful request.
   */
  private recordSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        this.reset();
      }
    }
  }

  /**
   * Record a failed request.
   */
  private recordFailure(error: Error): void {
    const classified = classifyError(error);

    // Only count transient errors toward circuit trips
    // Permanent errors (like 404) shouldn't trip the circuit
    if (classified.type === ErrorType.PERMANENT) {
      return;
    }

    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediate trip back to OPEN on any failure in half-open
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we should open the circuit
      if (this.shouldTrip()) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Determine if the circuit should trip open.
   */
  private shouldTrip(): boolean {
    // Check consecutive failure threshold
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }

    // Check percentage threshold (only if we have enough volume)
    if (this.totalRequests >= this.config.volumeThreshold) {
      const failureRate = (this.failures / this.totalRequests) * 100;
      if (failureRate >= this.config.errorThresholdPercentage) {
        return true;
      }
    }

    return false;
  }

  /**
   * Transition to a new state with logging.
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    console.log(
      `[CircuitBreaker:${this.name}] State transition: ${oldState} -> ${newState}`
    );

    if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
    }
  }

  /**
   * Reset statistics (called when circuit closes).
   */
  private reset(): void {
    this.failures = 0;
    this.consecutiveFailures = 0;
    this.halfOpenAttempts = 0;
    // Keep successes and totalRequests for metrics
  }

  /**
   * Force the circuit to a specific state (for testing/admin).
   */
  forceState(state: CircuitState): void {
    this.transitionTo(state);
    if (state === CircuitState.CLOSED) {
      this.reset();
    }
  }

  /**
   * Force close the circuit (recovery action).
   */
  close(): void {
    this.forceState(CircuitState.CLOSED);
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics.
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses
    };
  }

  /**
   * Check if the circuit is allowing requests.
   */
  isAvailable(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }
    if (this.state === CircuitState.HALF_OPEN) {
      return true;
    }
    // OPEN - check if we should try half-open
    return this.shouldAttemptReset();
  }
}

// ============================================================================
// Per-ATS Configuration
// ============================================================================

export type ATSType =
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'ashby'
  | 'icims'
  | 'smartrecruiters'
  | 'bamboohr'
  | 'jobvite'
  | 'taleo'
  | 'successfactors'
  | 'myworkdayjobs'
  | 'default';

/**
 * ATS-specific configurations based on observed reliability characteristics.
 * Timeout values are tuned to each ATS's typical response times.
 */
const ATS_CONFIGS: Record<ATSType, Partial<CircuitBreakerConfig>> = {
  greenhouse: {
    timeout: 10000,              // Greenhouse is generally reliable
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 30000,
    volumeThreshold: 5,
    errorThresholdPercentage: 40
  },
  lever: {
    timeout: 10000,
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 20000,
    volumeThreshold: 5,
    errorThresholdPercentage: 50
  },
  workday: {
    timeout: 20000,              // Workday is notoriously slow
    failureThreshold: 3,         // Trip faster due to poor reliability
    successThreshold: 5,         // Require more successes to close
    resetTimeout: 45000,         // Wait longer before retrying
    volumeThreshold: 3,
    errorThresholdPercentage: 60
  },
  ashby: {
    timeout: 8000,               // Ashby is generally fast
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 15000,
    volumeThreshold: 5,
    errorThresholdPercentage: 40
  },
  icims: {
    timeout: 15000,
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 30000,
    volumeThreshold: 5,
    errorThresholdPercentage: 50
  },
  smartrecruiters: {
    timeout: 12000,
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 25000,
    volumeThreshold: 5,
    errorThresholdPercentage: 45
  },
  bamboohr: {
    timeout: 10000,
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 20000,
    volumeThreshold: 5,
    errorThresholdPercentage: 50
  },
  jobvite: {
    timeout: 12000,
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 25000,
    volumeThreshold: 5,
    errorThresholdPercentage: 50
  },
  taleo: {
    timeout: 20000,              // Taleo (Oracle) is slow
    failureThreshold: 3,
    successThreshold: 5,
    resetTimeout: 45000,
    volumeThreshold: 3,
    errorThresholdPercentage: 60
  },
  successfactors: {
    timeout: 18000,              // SAP SuccessFactors is slow
    failureThreshold: 4,
    successThreshold: 4,
    resetTimeout: 40000,
    volumeThreshold: 4,
    errorThresholdPercentage: 55
  },
  myworkdayjobs: {
    timeout: 20000,              // Same as Workday
    failureThreshold: 3,
    successThreshold: 5,
    resetTimeout: 45000,
    volumeThreshold: 3,
    errorThresholdPercentage: 60
  },
  default: {
    timeout: 10000,
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 30000,
    volumeThreshold: 5,
    errorThresholdPercentage: 50
  }
};

// ============================================================================
// Circuit Breaker Registry (Singleton Pattern)
// ============================================================================

const breakerRegistry = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for an ATS type.
 * Uses singleton pattern - one breaker per ATS type.
 */
export function getBreaker(atsType: string): CircuitBreaker {
  const normalizedType = atsType.toLowerCase() as ATSType;

  if (!breakerRegistry.has(normalizedType)) {
    const config = ATS_CONFIGS[normalizedType] || ATS_CONFIGS.default;
    const breaker = new CircuitBreaker(normalizedType, config);
    breakerRegistry.set(normalizedType, breaker);
  }

  return breakerRegistry.get(normalizedType)!;
}

/**
 * Execute a function through the appropriate ATS circuit breaker.
 */
export async function executeWithBreaker<T>(
  atsType: string,
  fn: () => Promise<T>
): Promise<T> {
  const breaker = getBreaker(atsType);
  return breaker.execute(fn);
}

/**
 * Get status of all registered circuit breakers.
 */
export function getAllBreakerStatus(): Record<string, CircuitBreakerStats> {
  const status: Record<string, CircuitBreakerStats> = {};

  for (const [name, breaker] of breakerRegistry) {
    status[name] = breaker.getStats();
  }

  return status;
}

/**
 * Get status of a specific ATS circuit breaker.
 */
export function getBreakerStatus(atsType: string): CircuitBreakerStats | null {
  const normalizedType = atsType.toLowerCase();
  const breaker = breakerRegistry.get(normalizedType);
  return breaker ? breaker.getStats() : null;
}

/**
 * Reset a specific ATS circuit breaker.
 */
export function resetBreaker(atsType: string): void {
  const normalizedType = atsType.toLowerCase();
  const breaker = breakerRegistry.get(normalizedType);
  if (breaker) {
    breaker.close();
  }
}

/**
 * Reset all circuit breakers.
 */
export function resetAllBreakers(): void {
  for (const breaker of breakerRegistry.values()) {
    breaker.close();
  }
}

/**
 * Clear the breaker registry (for testing).
 */
export function clearBreakerRegistry(): void {
  breakerRegistry.clear();
}

/**
 * Check if any circuit breakers are open.
 */
export function hasOpenCircuits(): boolean {
  for (const breaker of breakerRegistry.values()) {
    if (breaker.getState() === CircuitState.OPEN) {
      return true;
    }
  }
  return false;
}

/**
 * Get list of ATS types with open circuits.
 */
export function getOpenCircuits(): string[] {
  const open: string[] = [];
  for (const [name, breaker] of breakerRegistry) {
    if (breaker.getState() === CircuitState.OPEN) {
      open.push(name);
    }
  }
  return open;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the configuration for an ATS type.
 */
export function getATSConfig(atsType: string): CircuitBreakerConfig {
  const normalizedType = atsType.toLowerCase() as ATSType;
  const config = ATS_CONFIGS[normalizedType] || ATS_CONFIGS.default;

  return {
    timeout: config.timeout ?? 10000,
    failureThreshold: config.failureThreshold ?? 5,
    successThreshold: config.successThreshold ?? 3,
    resetTimeout: config.resetTimeout ?? 30000,
    volumeThreshold: config.volumeThreshold ?? 5,
    errorThresholdPercentage: config.errorThresholdPercentage ?? 50
  };
}

/**
 * List all supported ATS types.
 */
export function getSupportedATSTypes(): ATSType[] {
  return Object.keys(ATS_CONFIGS) as ATSType[];
}

// ============================================================================
// Example Usage
// ============================================================================

/*
import { getBreaker, executeWithBreaker, CircuitState } from './circuit-breaker';

// Option 1: Using the breaker directly
const breaker = getBreaker('greenhouse');
try {
  const result = await breaker.execute(async () => {
    const response = await fetch('https://boards-api.greenhouse.io/v1/boards/company/jobs');
    return response.json();
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.log('Greenhouse is unavailable, try again later');
  }
}

// Option 2: Using the convenience function
try {
  const result = await executeWithBreaker('workday', async () => {
    // Your Workday API call
  });
} catch (error) {
  // Handle error
}

// Check circuit status
const status = breaker.getStats();
if (status.state === CircuitState.OPEN) {
  console.log(`Circuit open, last failure at ${status.lastFailureTime}`);
}
*/
