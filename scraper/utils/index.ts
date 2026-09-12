// Scraper Utilities - Interview Question Aggregation

// Types
export * from './types';

// Base Scraper Class
export { ScraperBase } from './scraper-base';

// Text Parsing
export {
  extractCompany,
  extractRole,
  extractDate,
  extractAllCompanies,
  cleanQuestionText,
  extractTags,
} from './text-parser';

// Question Classification
export {
  classifyQuestion,
  classifyQuestionMultiLabel,
  classifyDifficulty,
  isValidQuestion,
  extractQuestions,
  analyzeQuestion,
  TopicTagger,
  DifficultyEstimator,
  ConfidenceScorer,
} from './question-classifier';

export type {
  TopicTag,
  MultiLabelClassification,
  TopicTagResult,
  ConfidenceScore,
  FullQuestionAnalysis,
  ExtendedQuestionType,
} from './question-classifier';

// Translation
export {
  detectLanguage,
  needsTranslation,
  translate,
  translateBatch,
  clearTranslationCache,
  getTranslationCacheStats,
} from './translation';
