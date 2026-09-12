/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects against cascading failures when:
 * - ATS websites are down or rate limiting
 * - Browser automation fails repeatedly
 * - Network issues occur
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failure threshold reached, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 */

const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

/**
 * Circuit breaker for protecting against failing operations
 */
class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} options.failureThreshold - Number of failures before opening circuit
   * @param {number} options.successThreshold - Number of successes in half-open to close circuit
   * @param {number} options.timeout - Time in ms to wait before trying half-open
   * @param {Function} options.onStateChange - Callback when state changes
   */
  constructor(options = {}) {
    const {
      failureThreshold = 5,
      successThreshold = 2,
      timeout = 30000, // 30 seconds
      onStateChange = null,
    } = options;

    this.failureThreshold = failureThreshold;
    this.successThreshold = successThreshold;
    this.timeout = timeout;
    this.onStateChange = onStateChange;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if circuit is open (requests should fail fast)
   */
  isOpen() {
    if (this.state === CircuitState.OPEN) {
      // Check if timeout has passed
      if (Date.now() >= this.nextAttemptTime) {
        this._transitionTo(CircuitState.HALF_OPEN);
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Check if requests can proceed
   */
  canExecute() {
    return !this.isOpen();
  }

  /**
   * Record a successful operation
   */
  recordSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.successThreshold) {
        this._transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed operation
   * @param {Error} error - The error that occurred
   */
  recordFailure(error = null) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediately trip back to open on failure in half-open
      this._transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      if (this.failureCount >= this.failureThreshold) {
        this._transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} - Result of the function
   */
  async execute(fn) {
    if (this.isOpen()) {
      throw new CircuitBreakerError('Circuit breaker is open', this.getStats());
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this._transitionTo(CircuitState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Manually trip the circuit breaker
   */
  trip() {
    this._transitionTo(CircuitState.OPEN);
  }

  /**
   * Get circuit breaker statistics
   */
  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      timeUntilRetry: this.nextAttemptTime
        ? Math.max(0, this.nextAttemptTime - Date.now())
        : null,
    };
  }

  /**
   * Transition to a new state
   */
  _transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitState.OPEN) {
      this.nextAttemptTime = Date.now() + this.timeout;
      this.successCount = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
    } else if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.nextAttemptTime = null;
    }

    if (this.onStateChange && oldState !== newState) {
      this.onStateChange(oldState, newState);
    }
  }
}

/**
 * Custom error for circuit breaker rejections
 */
class CircuitBreakerError extends Error {
  constructor(message, stats = null) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.stats = stats;
    this.isCircuitBreakerError = true;
  }
}

/**
 * ATS-specific circuit breaker manager
 * Maintains separate circuit breakers per ATS type
 */
class ATSCircuitBreakerManager {
  constructor(defaultOptions = {}) {
    this.breakers = new Map();
    this.defaultOptions = {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 60000, // 1 minute
      ...defaultOptions,
    };
  }

  /**
   * Get or create circuit breaker for an ATS
   */
  getBreaker(atsType) {
    if (!this.breakers.has(atsType)) {
      this.breakers.set(atsType, new CircuitBreaker(this.defaultOptions));
    }
    return this.breakers.get(atsType);
  }

  /**
   * Check if an ATS is available
   */
  isATSAvailable(atsType) {
    const breaker = this.getBreaker(atsType);
    return breaker.canExecute();
  }

  /**
   * Record success for an ATS
   */
  recordSuccess(atsType) {
    this.getBreaker(atsType).recordSuccess();
  }

  /**
   * Record failure for an ATS
   */
  recordFailure(atsType, error = null) {
    this.getBreaker(atsType).recordFailure(error);
  }

  /**
   * Execute operation with ATS circuit breaker
   */
  async execute(atsType, fn) {
    return this.getBreaker(atsType).execute(fn);
  }

  /**
   * Get status of all circuit breakers
   */
  getStatus() {
    const status = {};
    for (const [atsType, breaker] of this.breakers) {
      status[atsType] = breaker.getStats();
    }
    return status;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Reset circuit breaker for specific ATS
   */
  reset(atsType) {
    if (this.breakers.has(atsType)) {
      this.breakers.get(atsType).reset();
    }
  }
}

// Singleton instance for the application
const atsCircuitBreakers = new ATSCircuitBreakerManager();

export {
  CircuitBreaker,
  CircuitBreakerError,
  CircuitState,
  ATSCircuitBreakerManager,
  atsCircuitBreakers,
};

export default {
  CircuitBreaker,
  CircuitBreakerError,
  CircuitState,
  ATSCircuitBreakerManager,
  atsCircuitBreakers,
};
