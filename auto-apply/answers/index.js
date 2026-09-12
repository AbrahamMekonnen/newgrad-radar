/**
 * Answers module exports
 *
 * This module provides:
 * - AnswerManager: Intelligent answer generation and caching for job applications
 * - AnswerCache: L1 (memory) + L2 (file) tiered caching for pre-generated answers
 */

// Main AnswerManager
export { AnswerManager, AnswerSource } from './AnswerManager.js';
export { default } from './AnswerManager.js';

// Cache utilities (TypeScript - use import() for dynamic loading in JS)
// For JavaScript usage:
//   const { AnswerCache } = await import('./cache.js');
//
// Note: cache.ts needs to be compiled for direct JS usage.
// Use the TypeScript index.ts for full cache integration.
