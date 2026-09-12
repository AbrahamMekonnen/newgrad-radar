/**
 * Circuit Breaker Integration Tests
 *
 * Tests the circuit breaker pattern implementation for
 * protecting against cascading failures in ATS operations.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  CircuitBreaker,
  CircuitBreakerError,
  CircuitState,
  ATSCircuitBreakerManager,
} from '../utils/circuit-breaker.js';

describe('Circuit Breaker', () => {
  describe('CircuitBreaker basic behavior', () => {
    let breaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 100, // Short timeout for testing
      });
    });

    it('starts in CLOSED state', () => {
      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);
      assert.ok(breaker.canExecute());
    });

    it('remains CLOSED when successes occur', () => {
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordSuccess();

      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);
    });

    it('opens circuit after failure threshold', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);

      breaker.recordFailure(); // 3rd failure - threshold
      assert.strictEqual(breaker.getState(), CircuitState.OPEN);
      assert.ok(!breaker.canExecute());
    });

    it('resets failure count on success', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess(); // Reset

      breaker.recordFailure();
      breaker.recordFailure();
      // Still CLOSED - only 2 failures since reset
      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);
    });

    it('transitions to HALF_OPEN after timeout', async () => {
      // Trip the breaker
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      assert.strictEqual(breaker.getState(), CircuitState.OPEN);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Check if can execute (triggers transition)
      assert.ok(breaker.canExecute());
      assert.strictEqual(breaker.getState(), CircuitState.HALF_OPEN);
    });

    it('closes circuit after successes in HALF_OPEN', async () => {
      // Trip and wait
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      await new Promise(resolve => setTimeout(resolve, 150));

      // Trigger transition to HALF_OPEN
      breaker.canExecute();

      // Record successes
      breaker.recordSuccess();
      breaker.recordSuccess();

      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);
    });

    it('reopens circuit on failure in HALF_OPEN', async () => {
      // Trip and wait
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      await new Promise(resolve => setTimeout(resolve, 150));

      // Trigger transition to HALF_OPEN
      breaker.canExecute();
      assert.strictEqual(breaker.getState(), CircuitState.HALF_OPEN);

      // Single failure in half-open trips back to open
      breaker.recordFailure();
      assert.strictEqual(breaker.getState(), CircuitState.OPEN);
    });
  });

  describe('CircuitBreaker.execute()', () => {
    let breaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 100,
      });
    });

    it('executes function when circuit is closed', async () => {
      const result = await breaker.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('records success on successful execution', async () => {
      await breaker.execute(async () => 'success');
      assert.strictEqual(breaker.failureCount, 0);
    });

    it('records failure and throws on failed execution', async () => {
      const error = new Error('Test error');

      await assert.rejects(
        async () => breaker.execute(async () => { throw error; }),
        { message: 'Test error' }
      );

      assert.strictEqual(breaker.failureCount, 1);
    });

    it('throws CircuitBreakerError when open', async () => {
      // Trip the breaker
      breaker.recordFailure();
      breaker.recordFailure();

      await assert.rejects(
        async () => breaker.execute(async () => 'success'),
        (err) => {
          assert.ok(err instanceof CircuitBreakerError);
          assert.ok(err.isCircuitBreakerError);
          assert.ok(err.stats);
          return true;
        }
      );
    });
  });

  describe('CircuitBreaker.reset()', () => {
    it('resets circuit to CLOSED state', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });

      breaker.recordFailure();
      breaker.recordFailure();
      assert.strictEqual(breaker.getState(), CircuitState.OPEN);

      breaker.reset();

      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);
      assert.strictEqual(breaker.failureCount, 0);
      assert.strictEqual(breaker.successCount, 0);
      assert.ok(breaker.canExecute());
    });
  });

  describe('CircuitBreaker.trip()', () => {
    it('manually trips circuit to OPEN state', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 });

      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);

      breaker.trip();

      assert.strictEqual(breaker.getState(), CircuitState.OPEN);
      assert.ok(!breaker.canExecute());
    });
  });

  describe('CircuitBreaker.getStats()', () => {
    it('returns accurate statistics', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        timeout: 1000,
      });

      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordFailure();

      const stats = breaker.getStats();

      assert.strictEqual(stats.state, CircuitState.CLOSED);
      assert.strictEqual(stats.failureCount, 2);
      assert.strictEqual(stats.successCount, 0);
      assert.ok(stats.lastFailureTime);
      assert.strictEqual(stats.nextAttemptTime, null);
    });

    it('includes retry timing when open', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        timeout: 1000,
      });

      breaker.recordFailure();
      breaker.recordFailure();

      const stats = breaker.getStats();

      assert.strictEqual(stats.state, CircuitState.OPEN);
      assert.ok(stats.nextAttemptTime);
      assert.ok(stats.timeUntilRetry > 0);
      assert.ok(stats.timeUntilRetry <= 1000);
    });
  });

  describe('CircuitBreaker state change callback', () => {
    it('calls onStateChange when state transitions', () => {
      const stateChanges = [];

      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        onStateChange: (oldState, newState) => {
          stateChanges.push({ from: oldState, to: newState });
        },
      });

      breaker.recordFailure();
      breaker.recordFailure(); // CLOSED -> OPEN

      assert.strictEqual(stateChanges.length, 1);
      assert.strictEqual(stateChanges[0].from, CircuitState.CLOSED);
      assert.strictEqual(stateChanges[0].to, CircuitState.OPEN);
    });
  });

  describe('ATSCircuitBreakerManager', () => {
    let manager;

    beforeEach(() => {
      manager = new ATSCircuitBreakerManager({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 100,
      });
    });

    it('creates separate breakers per ATS', () => {
      const greenhouseBreaker = manager.getBreaker('greenhouse');
      const leverBreaker = manager.getBreaker('lever');

      assert.ok(greenhouseBreaker !== leverBreaker);
    });

    it('reuses existing breakers', () => {
      const breaker1 = manager.getBreaker('greenhouse');
      const breaker2 = manager.getBreaker('greenhouse');

      assert.strictEqual(breaker1, breaker2);
    });

    it('checks ATS availability', () => {
      assert.ok(manager.isATSAvailable('greenhouse'));

      manager.recordFailure('greenhouse');
      manager.recordFailure('greenhouse');

      assert.ok(!manager.isATSAvailable('greenhouse'));
      assert.ok(manager.isATSAvailable('lever')); // Different ATS
    });

    it('records success/failure per ATS', () => {
      manager.recordFailure('greenhouse');
      manager.recordSuccess('lever');

      const status = manager.getStatus();

      assert.strictEqual(status.greenhouse.failureCount, 1);
      assert.strictEqual(status.lever.failureCount, 0);
    });

    it('executes with ATS-specific breaker', async () => {
      const result = await manager.execute('greenhouse', async () => 'done');
      assert.strictEqual(result, 'done');
    });

    it('returns status for all ATS breakers', () => {
      manager.getBreaker('greenhouse');
      manager.getBreaker('lever');
      manager.getBreaker('ashby');

      const status = manager.getStatus();

      assert.ok(status.greenhouse);
      assert.ok(status.lever);
      assert.ok(status.ashby);
    });

    it('resets all breakers', () => {
      manager.recordFailure('greenhouse');
      manager.recordFailure('greenhouse');
      manager.recordFailure('lever');
      manager.recordFailure('lever');

      manager.resetAll();

      assert.ok(manager.isATSAvailable('greenhouse'));
      assert.ok(manager.isATSAvailable('lever'));
    });

    it('resets specific ATS breaker', () => {
      manager.recordFailure('greenhouse');
      manager.recordFailure('greenhouse');
      manager.recordFailure('lever');
      manager.recordFailure('lever');

      manager.reset('greenhouse');

      assert.ok(manager.isATSAvailable('greenhouse'));
      assert.ok(!manager.isATSAvailable('lever'));
    });
  });

  describe('CircuitBreakerError', () => {
    it('includes circuit breaker stats', () => {
      const stats = { state: 'OPEN', failureCount: 3 };
      const error = new CircuitBreakerError('Test error', stats);

      assert.strictEqual(error.name, 'CircuitBreakerError');
      assert.strictEqual(error.message, 'Test error');
      assert.deepStrictEqual(error.stats, stats);
      assert.ok(error.isCircuitBreakerError);
    });

    it('is instance of Error', () => {
      const error = new CircuitBreakerError('Test');
      assert.ok(error instanceof Error);
    });
  });

  describe('Circuit breaker recovery scenarios', () => {
    it('recovers after intermittent failures', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 50,
      });

      // Simulate intermittent failures
      breaker.recordFailure();
      breaker.recordSuccess(); // Reset
      breaker.recordFailure();
      breaker.recordSuccess(); // Reset

      // Should still be closed
      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);
      assert.ok(breaker.canExecute());
    });

    it('handles rapid failure/recovery cycles', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 50,
      });

      for (let i = 0; i < 3; i++) {
        // Trip the breaker
        breaker.recordFailure();
        breaker.recordFailure();
        assert.strictEqual(breaker.getState(), CircuitState.OPEN);

        // Wait for timeout
        await new Promise(resolve => setTimeout(resolve, 60));

        // Check triggers HALF_OPEN
        assert.ok(breaker.canExecute());

        // Recover
        breaker.recordSuccess();
        assert.strictEqual(breaker.getState(), CircuitState.CLOSED);
      }
    });
  });

  describe('Edge cases', () => {
    it('handles zero failure threshold', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 0 });

      // Should still work (treat as 1)
      breaker.recordFailure();
      // May or may not trip depending on implementation
    });

    it('handles negative timeout', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        timeout: -100,
      });

      breaker.recordFailure();

      // Should immediately be able to try (negative timeout = no wait)
      assert.ok(breaker.canExecute());
    });

    it('handles concurrent operations', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        timeout: 1000,
      });

      // Launch multiple concurrent operations
      const operations = [];
      for (let i = 0; i < 10; i++) {
        operations.push(
          breaker.execute(async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
            return i;
          })
        );
      }

      const results = await Promise.all(operations);
      assert.strictEqual(results.length, 10);
      assert.strictEqual(breaker.getState(), CircuitState.CLOSED);
    });
  });
});
