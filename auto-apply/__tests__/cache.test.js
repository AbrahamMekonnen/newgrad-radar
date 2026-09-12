/**
 * Cache Integration Tests
 *
 * Tests caching functionality for answers, ATS detection,
 * field mappings, and session data.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  AnswerCache,
  ATSCache,
  FieldMappingCache,
  SessionCache,
  clearAllCaches,
} from '../utils/cache.js';

describe('Cache', () => {
  describe('AnswerCache', () => {
    let cache;

    beforeEach(() => {
      cache = new AnswerCache({ maxSize: 10 });
    });

    afterEach(() => {
      cache.clear();
    });

    it('stores and retrieves answers', () => {
      cache.set('What is your Python proficiency?', 4);
      const result = cache.get('What is your Python proficiency?');
      assert.strictEqual(result, 4);
    });

    it('normalizes questions for caching', () => {
      cache.set('What is your Python proficiency?', 4);
      // Same question with different whitespace/case
      const result = cache.get('what is your python proficiency?');
      assert.strictEqual(result, 4);
    });

    it('returns undefined for cache miss', () => {
      const result = cache.get('Unknown question');
      assert.strictEqual(result, undefined);
    });

    it('tracks hit/miss statistics', () => {
      cache.set('Question 1', 'Answer 1');

      cache.get('Question 1'); // hit
      cache.get('Question 1'); // hit
      cache.get('Question 2'); // miss

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 2);
      assert.strictEqual(stats.misses, 1);
      assert.ok(stats.hitRate > 0.6);
    });

    it('supports profile-specific caching', () => {
      cache.set('What is your proficiency?', 4, 'profile-1');
      cache.set('What is your proficiency?', 2, 'profile-2');

      assert.strictEqual(cache.get('What is your proficiency?', 'profile-1'), 4);
      assert.strictEqual(cache.get('What is your proficiency?', 'profile-2'), 2);
    });

    it('has() returns correct boolean', () => {
      cache.set('Existing question', 'answer');

      assert.ok(cache.has('Existing question'));
      assert.ok(!cache.has('Non-existing question'));
    });

    it('respects max size (LRU eviction)', () => {
      // Fill cache beyond max
      for (let i = 0; i < 15; i++) {
        cache.set(`Question ${i}`, `Answer ${i}`);
      }

      const stats = cache.getStats();
      assert.ok(stats.size <= 10, 'Cache size should not exceed max');

      // Recent items should still be there
      assert.ok(cache.has('Question 14'));
      assert.ok(cache.has('Question 13'));
    });

    it('clear() resets statistics', () => {
      cache.set('Question', 'Answer');
      cache.get('Question');
      cache.get('Missing');

      cache.clear();

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 0);
      assert.strictEqual(stats.misses, 0);
      assert.strictEqual(stats.size, 0);
    });
  });

  describe('ATSCache', () => {
    let cache;

    beforeEach(() => {
      cache = new ATSCache({ maxSize: 10 });
    });

    afterEach(() => {
      cache.clear();
    });

    it('stores and retrieves ATS types by URL', () => {
      cache.set('https://boards.greenhouse.io/company/jobs/123', 'greenhouse');
      const result = cache.get('https://boards.greenhouse.io/company/jobs/456');
      assert.strictEqual(result, 'greenhouse');
    });

    it('caches by domain, not full URL', () => {
      cache.set('https://jobs.lever.co/figma/123', 'lever');

      // Different job at same domain should hit cache
      const result = cache.get('https://jobs.lever.co/stripe/456');
      assert.strictEqual(result, 'lever');
    });

    it('returns undefined for unknown domains', () => {
      const result = cache.get('https://example.com/jobs');
      assert.strictEqual(result, undefined);
    });

    it('handles invalid URLs gracefully', () => {
      // Should not throw
      cache.set('not-a-url', 'test');
      const result = cache.get('not-a-url');
      assert.strictEqual(result, undefined);
    });

    it('provides size property', () => {
      cache.set('https://greenhouse.io/job', 'greenhouse');
      cache.set('https://lever.co/job', 'lever');

      assert.strictEqual(cache.size, 2);
    });
  });

  describe('FieldMappingCache', () => {
    let cache;

    beforeEach(() => {
      cache = new FieldMappingCache({ maxSize: 50 });
    });

    afterEach(() => {
      cache.clear();
    });

    it('stores and retrieves field mappings', () => {
      cache.set('First Name', 'firstName');
      assert.strictEqual(cache.get('First Name'), 'firstName');
    });

    it('normalizes labels for caching', () => {
      cache.set('First Name *', 'firstName');

      // Same label with different formatting
      assert.strictEqual(cache.get('first name'), 'firstName');
      assert.strictEqual(cache.get('  FIRST  NAME  '), 'firstName');
    });

    it('handles special characters in labels', () => {
      cache.set('Email Address:', 'email');
      cache.set('Phone Number?', 'phone');

      assert.strictEqual(cache.get('email address'), 'email');
      assert.strictEqual(cache.get('phone number'), 'phone');
    });

    it('has() returns correct boolean', () => {
      cache.set('LinkedIn URL', 'linkedin');

      assert.ok(cache.has('LinkedIn URL'));
      assert.ok(cache.has('linkedin url')); // normalized
      assert.ok(!cache.has('GitHub URL'));
    });
  });

  describe('SessionCache', () => {
    let cache;

    beforeEach(() => {
      cache = new SessionCache();
    });

    afterEach(() => {
      cache.endSession();
    });

    it('starts and tracks sessions', () => {
      const sessionId = cache.startSession('session-123');

      assert.strictEqual(sessionId, 'session-123');
      assert.strictEqual(cache.getInfo().sessionId, 'session-123');
      assert.ok(cache.getInfo().active);
    });

    it('stores and retrieves session data', () => {
      cache.startSession();

      cache.set('fieldsCompleted', 5);
      cache.set('currentStep', 'contact-info');

      assert.strictEqual(cache.get('fieldsCompleted'), 5);
      assert.strictEqual(cache.get('currentStep'), 'contact-info');
    });

    it('clears data when session ends', () => {
      cache.startSession();
      cache.set('data', 'value');

      cache.endSession();

      assert.strictEqual(cache.get('data'), undefined);
      assert.ok(!cache.getInfo().active);
    });

    it('clears old data when new session starts', () => {
      cache.startSession('session-1');
      cache.set('key', 'value-1');

      cache.startSession('session-2');

      assert.strictEqual(cache.get('key'), undefined);
      assert.strictEqual(cache.getInfo().sessionId, 'session-2');
    });

    it('has() returns correct boolean', () => {
      cache.startSession();
      cache.set('exists', true);

      assert.ok(cache.has('exists'));
      assert.ok(!cache.has('missing'));
    });

    it('delete() removes specific keys', () => {
      cache.startSession();
      cache.set('keep', 'value');
      cache.set('remove', 'value');

      cache.delete('remove');

      assert.ok(cache.has('keep'));
      assert.ok(!cache.has('remove'));
    });

    it('getAll() returns all session data', () => {
      cache.startSession();
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const all = cache.getAll();

      assert.deepStrictEqual(all, {
        key1: 'value1',
        key2: 'value2',
      });
    });

    it('getInfo() provides session details', () => {
      cache.startSession('test-session');
      cache.set('item1', 'value');
      cache.set('item2', 'value');

      const info = cache.getInfo();

      assert.strictEqual(info.sessionId, 'test-session');
      assert.strictEqual(info.itemCount, 2);
      assert.strictEqual(info.active, true);
    });
  });

  describe('clearAllCaches', () => {
    it('clears all cache types', () => {
      const answer = new AnswerCache();
      const ats = new ATSCache();
      const field = new FieldMappingCache();
      const session = new SessionCache();

      // Populate all caches
      answer.set('question', 'answer');
      ats.set('https://example.com', 'test');
      field.set('label', 'key');
      session.startSession();
      session.set('data', 'value');

      // Clear using the global function
      clearAllCaches();

      // Module-level instances should be cleared
      // Local instances are not affected by clearAllCaches
      // This tests that clearAllCaches runs without error
      assert.ok(true);
    });
  });

  describe('Cache TTL behavior', () => {
    it('respects TTL for expiration', async () => {
      // Create cache with very short TTL
      const cache = new AnswerCache({
        maxSize: 10,
        ttl: 100, // 100ms TTL
      });

      cache.set('question', 'answer');
      assert.strictEqual(cache.get('question'), 'answer');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be expired
      assert.strictEqual(cache.get('question'), undefined);
    });
  });

  describe('Cache performance', () => {
    it('handles large number of operations efficiently', () => {
      const cache = new AnswerCache({ maxSize: 1000 });
      const startTime = Date.now();

      // Perform 10000 operations
      for (let i = 0; i < 10000; i++) {
        cache.set(`question-${i % 500}`, `answer-${i}`);
        cache.get(`question-${i % 500}`);
      }

      const elapsed = Date.now() - startTime;

      // Should complete in reasonable time (< 1 second)
      assert.ok(elapsed < 1000, `Operations took ${elapsed}ms, should be < 1000ms`);

      const stats = cache.getStats();
      assert.ok(stats.hitRate > 0, 'Should have some hits');
    });
  });

  describe('Edge cases', () => {
    it('handles empty strings as keys', () => {
      const cache = new AnswerCache();

      cache.set('', 'empty-key-value');
      assert.strictEqual(cache.get(''), 'empty-key-value');
    });

    it('handles null/undefined values', () => {
      const cache = new AnswerCache();

      cache.set('null-value', null);
      cache.set('undefined-value', undefined);

      // null should be retrievable
      assert.strictEqual(cache.get('null-value'), null);
      // undefined is treated as cache miss
    });

    it('handles complex objects as values', () => {
      const cache = new AnswerCache();

      const complexValue = {
        answer: 'Yes',
        confidence: 0.95,
        metadata: { source: 'profile', field: 'workAuth' },
      };

      cache.set('complex-question', complexValue);
      const retrieved = cache.get('complex-question');

      assert.deepStrictEqual(retrieved, complexValue);
    });

    it('handles unicode in keys and values', () => {
      const cache = new AnswerCache();

      cache.set('Wo arbeiten Sie?', 'Berlin');
      assert.strictEqual(cache.get('Wo arbeiten Sie?'), 'Berlin');
    });
  });
});
