// Interview Question Scraper Types

export type QuestionType = 'technical' | 'behavioral' | 'system_design' | 'oa' | 'brain_teaser' | 'unknown';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'unknown';
export type SourcePlatform =
  | 'leetcode' | 'glassdoor' | 'blind' | 'reddit' | 'github'
  | 'geeksforgeeks' | 'nowcoder' | '1point3acres' | 'devto'
  | 'hackerrank' | 'telegram' | 'discord' | 'careercup'
  | 'levels_fyi' | 'quora' | 'youtube' | 'other';

export interface InterviewQuestion {
  id: string;
  companyName: string;
  companyNormalized: string;
  role: string;
  roleNormalized: string;
  questionText: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  source: SourcePlatform;
  sourceUrl: string;
  interviewDate: Date | null;
  postedDate: Date;
  scrapedAt: Date;
  upvotes?: number;
  tags: string[];
  language: string;
  originalLanguage?: string;
  translatedText?: string;
  metadata: Record<string, unknown>;
}

export interface ScraperConfig {
  name: string;
  platform: SourcePlatform;
  baseUrl: string;
  rateLimit: {
    requestsPerMinute: number;
    requestsPerHour: number;
    minDelayMs: number;
    maxDelayMs: number;
  };
  dateFilter: {
    monthsBack: number;
    startDate?: Date;
    endDate?: Date;
  };
  retry: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  proxy?: string;
  timeout: number;
  userAgent?: string;
}

export interface ScraperResult {
  success: boolean;
  questions: InterviewQuestion[];
  errors: ScraperError[];
  stats: ScraperStats;
  nextCursor?: string;
  hasMore: boolean;
}

export interface ScraperError {
  code: string;
  message: string;
  url?: string;
  timestamp: Date;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ScraperStats {
  startTime: Date;
  endTime?: Date;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  questionsFound: number;
  questionsFiltered: number;
  rateLimitHits: number;
  avgResponseTimeMs: number;
  bytesDownloaded: number;
}

export interface ScraperProgress {
  phase: 'initializing' | 'fetching' | 'parsing' | 'filtering' | 'complete' | 'error';
  currentPage: number;
  totalPages?: number;
  questionsFound: number;
  currentCompany?: string;
  currentRole?: string;
  lastUpdate: Date;
  estimatedTimeRemainingMs?: number;
  message: string;
}

export interface CompanyMatch {
  name: string;
  normalized: string;
  confidence: number;
  aliases: string[];
}

export interface RoleMatch {
  title: string;
  normalized: string;
  level: 'intern' | 'new_grad' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'unknown';
  confidence: number;
}

export interface DateExtraction {
  date: Date | null;
  confidence: number;
  original: string;
  type: 'interview_date' | 'posted_date' | 'relative';
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number;
  provider: 'google' | 'deepl' | 'azure' | 'gemini' | 'local';
  qualityScore?: number;
  preservedTerms?: string[];
  cached?: boolean;
  batchId?: string;
}

export const DEFAULT_CONFIG: Partial<ScraperConfig> = {
  rateLimit: {
    requestsPerMinute: 20,
    requestsPerHour: 500,
    minDelayMs: 2000,
    maxDelayMs: 5000,
  },
  dateFilter: {
    monthsBack: 5,
  },
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  },
  timeout: 30000,
  userAgent: 'NewGradRadar/1.0 (Interview Question Aggregator)',
};
