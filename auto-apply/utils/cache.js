/**
 * Cache utilities for auto-apply
 *
 * Provides caching for:
 * - Skill question answers (avoid re-computing)
 * - Profile field lookups
 * - ATS detection results
 */

import { LRUCache } from 'lru-cache';

/**
 * Application answer cache
 * Stores computed answers for skill/custom questions
 */
class AnswerCache {
  constructor(options = {}) {
    const {
      maxSize = 500,
      ttl = 1000 * 60 * 60, // 1 hour default
    } = options;

    this.cache = new LRUCache({
      max: maxSize,
      ttl,
    });

    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generate cache key from question and profile
   */
  _generateKey(question, profileId = 'default') {
    // Normalize question for caching
    const normalizedQuestion = question.toLowerCase().trim().replace(/\s+/g, ' ');
    return `${profileId}:${normalizedQuestion}`;
  }

  /**
   * Get cached answer
   */
  get(question, profileId = 'default') {
    const key = this._generateKey(question, profileId);
    const value = this.cache.get(key);

    if (value !== undefined) {
      this.hits++;
      return value;
    }

    this.misses++;
    return undefined;
  }

  /**
   * Store answer in cache
   */
  set(question, answer, profileId = 'default') {
    const key = this._generateKey(question, profileId);
    this.cache.set(key, answer);
  }

  /**
   * Check if answer is cached
   */
  has(question, profileId = 'default') {
    const key = this._generateKey(question, profileId);
    return this.cache.has(key);
  }

  /**
   * Clear all cached answers
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
    };
  }
}

/**
 * ATS detection cache
 * Stores ATS type detection results for URLs
 */
class ATSCache {
  constructor(options = {}) {
    const {
      maxSize = 200,
      ttl = 1000 * 60 * 60 * 24, // 24 hours - ATS doesn't change often
    } = options;

    this.cache = new LRUCache({
      max: maxSize,
      ttl,
    });
  }

  /**
   * Get cached ATS type for URL
   */
  get(url) {
    // Extract base domain for caching
    try {
      const urlObj = new URL(url);
      const baseKey = urlObj.hostname;
      return this.cache.get(baseKey);
    } catch {
      return undefined;
    }
  }

  /**
   * Store ATS type for URL
   */
  set(url, atsType) {
    try {
      const urlObj = new URL(url);
      const baseKey = urlObj.hostname;
      this.cache.set(baseKey, atsType);
    } catch {
      // Invalid URL, don't cache
    }
  }

  /**
   * Clear all cached ATS detections
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  get size() {
    return this.cache.size;
  }
}

/**
 * Field mapping cache
 * Caches field label to profile key mappings
 */
class FieldMappingCache {
  constructor(options = {}) {
    const {
      maxSize = 1000,
      ttl = 1000 * 60 * 60 * 24, // 24 hours
    } = options;

    this.cache = new LRUCache({
      max: maxSize,
      ttl,
    });
  }

  /**
   * Normalize label for caching
   */
  _normalizeLabel(label) {
    return label.toLowerCase().trim().replace(/[:\*\?]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Get cached mapping
   */
  get(label) {
    const key = this._normalizeLabel(label);
    return this.cache.get(key);
  }

  /**
   * Store mapping
   */
  set(label, profileKey) {
    const key = this._normalizeLabel(label);
    this.cache.set(key, profileKey);
  }

  /**
   * Check if mapping is cached
   */
  has(label) {
    const key = this._normalizeLabel(label);
    return this.cache.has(key);
  }

  /**
   * Clear all mappings
   */
  clear() {
    this.cache.clear();
  }
}

/**
 * Session cache - stores data during an application session
 * Automatically cleared between applications
 */
class SessionCache {
  constructor() {
    this.data = new Map();
    this.sessionId = null;
  }

  /**
   * Start a new session
   */
  startSession(sessionId = Date.now().toString()) {
    this.sessionId = sessionId;
    this.data.clear();
    return sessionId;
  }

  /**
   * Get session data
   */
  get(key) {
    return this.data.get(key);
  }

  /**
   * Set session data
   */
  set(key, value) {
    this.data.set(key, value);
  }

  /**
   * Check if key exists
   */
  has(key) {
    return this.data.has(key);
  }

  /**
   * Delete session data
   */
  delete(key) {
    return this.data.delete(key);
  }

  /**
   * End session and clear data
   */
  endSession() {
    this.data.clear();
    this.sessionId = null;
  }

  /**
   * Get all session data
   */
  getAll() {
    return Object.fromEntries(this.data);
  }

  /**
   * Get session info
   */
  getInfo() {
    return {
      sessionId: this.sessionId,
      itemCount: this.data.size,
      active: this.sessionId !== null,
    };
  }
}

// Singleton instances
const answerCache = new AnswerCache();
const atsCache = new ATSCache();
const fieldMappingCache = new FieldMappingCache();
const sessionCache = new SessionCache();

/**
 * Clear all caches
 */
function clearAllCaches() {
  answerCache.clear();
  atsCache.clear();
  fieldMappingCache.clear();
  sessionCache.endSession();
}

export {
  AnswerCache,
  ATSCache,
  FieldMappingCache,
  SessionCache,
  answerCache,
  atsCache,
  fieldMappingCache,
  sessionCache,
  clearAllCaches,
};

export default {
  AnswerCache,
  ATSCache,
  FieldMappingCache,
  SessionCache,
  answerCache,
  atsCache,
  fieldMappingCache,
  sessionCache,
  clearAllCaches,
};
