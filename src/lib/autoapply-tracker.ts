/**
 * Auto-Apply Tracker - Track application attempts and learn from patterns
 *
 * This module logs each auto-apply attempt, tracks which field mappings work
 * per ATS, and identifies patterns in failures to improve over time.
 */

import { ATSType } from './ats-registry';

// ============================================================================
// TYPES
// ============================================================================

export interface FieldAttempt {
  /** Field name (e.g., 'firstName', 'email', 'resume') */
  field: string;
  /** Selector or method used to find/fill the field */
  selector: string;
  /** Whether the field was found */
  found: boolean;
  /** Whether the field was successfully filled */
  filled: boolean;
  /** Error message if failed */
  error?: string;
  /** Time taken in ms */
  duration_ms?: number;
}

export interface ApplicationAttempt {
  /** Unique ID for this attempt */
  id?: string;
  /** Job ID */
  job_id: string;
  /** User ID */
  user_id?: string;
  /** ATS type detected */
  ats_type: ATSType;
  /** Full URL of the application page */
  application_url?: string;
  /** Timestamp of attempt */
  timestamp: string;
  /** Overall success/failure */
  success: boolean;
  /** Detailed field-by-field results */
  fields_filled: FieldAttempt[];
  /** Fields that were found but couldn't be filled */
  fields_failed: FieldAttempt[];
  /** Fields that were not found on the page */
  fields_missing: string[];
  /** Total duration of the attempt in ms */
  duration_ms: number;
  /** Error message if the whole attempt failed */
  error_message?: string;
  /** Error category for pattern matching */
  error_category?: ErrorCategory;
  /** Whether form was submitted */
  form_submitted: boolean;
  /** Whether submission was confirmed successful */
  submission_confirmed: boolean;
  /** Browser/automation details */
  automation_method?: 'extension' | 'puppeteer' | 'playwright' | 'manual';
  /** Any custom questions encountered */
  custom_questions?: CustomQuestion[];
  /** Screenshot URL if captured */
  screenshot_url?: string;
}

export interface CustomQuestion {
  /** Question text */
  question: string;
  /** Field type (text, select, radio, etc.) */
  field_type: string;
  /** Available options if applicable */
  options?: string[];
  /** Answer provided */
  answer?: string;
  /** Whether answer was found in profile */
  from_profile: boolean;
  /** Whether answer was guessed/AI-generated */
  ai_generated: boolean;
}

export type ErrorCategory =
  | 'network_error'        // Connection/timeout issues
  | 'captcha_blocked'      // Blocked by CAPTCHA
  | 'login_required'       // Needs account creation/login
  | 'field_not_found'      // Expected field missing
  | 'field_validation'     // Field rejected input
  | 'file_upload_failed'   // Resume upload issues
  | 'form_submit_error'    // Submit button issues
  | 'confirmation_timeout' // Couldn't verify success
  | 'rate_limited'         // Too many requests
  | 'page_load_error'      // Page didn't load correctly
  | 'unknown';

export interface ATSFieldStats {
  /** ATS type */
  ats_type: ATSType;
  /** Field name */
  field: string;
  /** Selector that works most often */
  best_selector: string;
  /** Success rate for this selector */
  success_rate: number;
  /** Total attempts */
  total_attempts: number;
  /** Alternative selectors and their success rates */
  alternatives: Array<{ selector: string; success_rate: number; attempts: number }>;
  /** Last updated */
  updated_at: string;
}

export interface FailurePattern {
  /** ATS type */
  ats_type: ATSType;
  /** Error category */
  error_category: ErrorCategory;
  /** Specific error message pattern */
  error_pattern: string;
  /** How often this occurs */
  frequency: number;
  /** Suggested fix or workaround */
  suggested_fix?: string;
  /** Is this a known/expected issue? */
  known_issue: boolean;
}

// ============================================================================
// TRACKER CLASS
// ============================================================================

export class AutoApplyTracker {
  private attempts: ApplicationAttempt[] = [];
  private currentAttempt: ApplicationAttempt | null = null;

  /**
   * Start tracking a new application attempt
   */
  startAttempt(jobId: string, atsType: ATSType, applicationUrl?: string): void {
    this.currentAttempt = {
      job_id: jobId,
      ats_type: atsType,
      application_url: applicationUrl,
      timestamp: new Date().toISOString(),
      success: false,
      fields_filled: [],
      fields_failed: [],
      fields_missing: [],
      duration_ms: 0,
      form_submitted: false,
      submission_confirmed: false,
    };
  }

  /**
   * Log a successful field fill
   */
  logFieldSuccess(field: string, selector: string, durationMs?: number): void {
    if (!this.currentAttempt) return;

    this.currentAttempt.fields_filled.push({
      field,
      selector,
      found: true,
      filled: true,
      duration_ms: durationMs,
    });
  }

  /**
   * Log a failed field fill (field found but couldn't fill)
   */
  logFieldFailure(field: string, selector: string, error: string): void {
    if (!this.currentAttempt) return;

    this.currentAttempt.fields_failed.push({
      field,
      selector,
      found: true,
      filled: false,
      error,
    });
  }

  /**
   * Log a missing field (field not found on page)
   */
  logFieldMissing(field: string): void {
    if (!this.currentAttempt) return;

    this.currentAttempt.fields_missing.push(field);
  }

  /**
   * Log a custom question encounter
   */
  logCustomQuestion(question: CustomQuestion): void {
    if (!this.currentAttempt) return;

    if (!this.currentAttempt.custom_questions) {
      this.currentAttempt.custom_questions = [];
    }
    this.currentAttempt.custom_questions.push(question);
  }

  /**
   * Mark form as submitted
   */
  markSubmitted(): void {
    if (!this.currentAttempt) return;
    this.currentAttempt.form_submitted = true;
  }

  /**
   * Mark submission as confirmed successful
   */
  markConfirmed(): void {
    if (!this.currentAttempt) return;
    this.currentAttempt.submission_confirmed = true;
    this.currentAttempt.success = true;
  }

  /**
   * Complete the current attempt with final status
   */
  completeAttempt(
    success: boolean,
    durationMs: number,
    errorMessage?: string,
    errorCategory?: ErrorCategory
  ): ApplicationAttempt | null {
    if (!this.currentAttempt) return null;

    this.currentAttempt.success = success;
    this.currentAttempt.duration_ms = durationMs;
    this.currentAttempt.error_message = errorMessage;
    this.currentAttempt.error_category = errorCategory;

    const completed = { ...this.currentAttempt };
    this.attempts.push(completed);
    this.currentAttempt = null;

    return completed;
  }

  /**
   * Get the current attempt for inspection
   */
  getCurrentAttempt(): ApplicationAttempt | null {
    return this.currentAttempt;
  }

  /**
   * Get all completed attempts
   */
  getAttempts(): ApplicationAttempt[] {
    return [...this.attempts];
  }

  /**
   * Create a summary of the attempt for logging
   */
  createSummary(attempt: ApplicationAttempt): string {
    const filledCount = attempt.fields_filled.length;
    const failedCount = attempt.fields_failed.length;
    const missingCount = attempt.fields_missing.length;

    let summary = `[${attempt.ats_type.toUpperCase()}] `;
    summary += attempt.success ? 'SUCCESS' : 'FAILED';
    summary += ` | Filled: ${filledCount}`;
    if (failedCount > 0) summary += ` | Failed: ${failedCount}`;
    if (missingCount > 0) summary += ` | Missing: ${missingCount}`;
    summary += ` | ${attempt.duration_ms}ms`;
    if (attempt.error_message) summary += ` | Error: ${attempt.error_message}`;

    return summary;
  }
}

// ============================================================================
// ANALYSIS UTILITIES
// ============================================================================

/**
 * Analyze attempts to find best selectors for each ATS/field combination
 */
export function analyzeFieldSuccessRates(
  attempts: ApplicationAttempt[]
): ATSFieldStats[] {
  const stats: Map<string, ATSFieldStats> = new Map();

  for (const attempt of attempts) {
    const atsType = attempt.ats_type;

    // Process successful fills
    for (const field of attempt.fields_filled) {
      const key = `${atsType}:${field.field}`;

      if (!stats.has(key)) {
        stats.set(key, {
          ats_type: atsType,
          field: field.field,
          best_selector: field.selector,
          success_rate: 0,
          total_attempts: 0,
          alternatives: [],
          updated_at: new Date().toISOString(),
        });
      }

      const stat = stats.get(key)!;
      stat.total_attempts++;

      // Track selector performance
      const alt = stat.alternatives.find(a => a.selector === field.selector);
      if (alt) {
        alt.attempts++;
        alt.success_rate = (alt.success_rate * (alt.attempts - 1) + 1) / alt.attempts;
      } else {
        stat.alternatives.push({
          selector: field.selector,
          success_rate: 1,
          attempts: 1,
        });
      }
    }

    // Process failed fills
    for (const field of attempt.fields_failed) {
      const key = `${atsType}:${field.field}`;

      if (!stats.has(key)) {
        stats.set(key, {
          ats_type: atsType,
          field: field.field,
          best_selector: field.selector,
          success_rate: 0,
          total_attempts: 0,
          alternatives: [],
          updated_at: new Date().toISOString(),
        });
      }

      const stat = stats.get(key)!;
      stat.total_attempts++;

      const alt = stat.alternatives.find(a => a.selector === field.selector);
      if (alt) {
        alt.attempts++;
        alt.success_rate = (alt.success_rate * (alt.attempts - 1)) / alt.attempts;
      } else {
        stat.alternatives.push({
          selector: field.selector,
          success_rate: 0,
          attempts: 1,
        });
      }
    }
  }

  // Calculate overall success rates and find best selectors
  const statsArray = Array.from(stats.values());
  for (const stat of statsArray) {
    // Sort alternatives by success rate
    stat.alternatives.sort((a, b) => b.success_rate - a.success_rate);

    // Set best selector
    if (stat.alternatives.length > 0) {
      stat.best_selector = stat.alternatives[0].selector;
      stat.success_rate = stat.alternatives[0].success_rate;
    }
  }

  return statsArray;
}

/**
 * Identify common failure patterns
 */
export function analyzeFailurePatterns(
  attempts: ApplicationAttempt[]
): FailurePattern[] {
  const patterns: Map<string, FailurePattern> = new Map();

  const failedAttempts = attempts.filter(a => !a.success);

  for (const attempt of failedAttempts) {
    const category = attempt.error_category || 'unknown';
    const errorMsg = attempt.error_message || 'Unknown error';
    const key = `${attempt.ats_type}:${category}:${errorMsg.slice(0, 50)}`;

    if (!patterns.has(key)) {
      patterns.set(key, {
        ats_type: attempt.ats_type,
        error_category: category,
        error_pattern: errorMsg,
        frequency: 0,
        known_issue: false,
      });
    }

    patterns.get(key)!.frequency++;
  }

  // Add suggested fixes for known patterns
  const patternsArray = Array.from(patterns.values());
  for (const pattern of patternsArray) {
    pattern.suggested_fix = getSuggestedFix(pattern.ats_type, pattern.error_category);
    pattern.known_issue = isKnownIssue(pattern.ats_type, pattern.error_category);
  }

  return patternsArray.sort((a, b) => b.frequency - a.frequency);
}

/**
 * Get suggested fix for a known error category
 */
function getSuggestedFix(atsType: ATSType, category: ErrorCategory): string | undefined {
  const fixes: Record<ErrorCategory, string> = {
    captcha_blocked: 'Consider using browser automation with CAPTCHA solving service',
    login_required: 'Pre-create account on this ATS before auto-applying',
    field_not_found: 'Update selectors in ATS registry for this field',
    field_validation: 'Check input format (phone number format, URL validation)',
    file_upload_failed: 'Ensure resume is PDF under 5MB',
    form_submit_error: 'Try alternative submit button selectors',
    confirmation_timeout: 'Increase wait time for confirmation detection',
    rate_limited: 'Add delay between applications (30-60 seconds)',
    network_error: 'Retry with exponential backoff',
    page_load_error: 'Ensure JavaScript is fully loaded before interacting',
    unknown: 'Manual investigation required',
  };

  return fixes[category];
}

/**
 * Check if this is a known/expected issue
 */
function isKnownIssue(atsType: ATSType, category: ErrorCategory): boolean {
  // Known difficult ATS + error combinations
  const knownIssues: Array<{ ats: ATSType; category: ErrorCategory }> = [
    { ats: 'workday', category: 'login_required' },
    { ats: 'workday', category: 'captcha_blocked' },
    { ats: 'taleo', category: 'login_required' },
    { ats: 'taleo', category: 'page_load_error' },
    { ats: 'icims', category: 'login_required' },
  ];

  return knownIssues.some(issue =>
    issue.ats === atsType && issue.category === category
  );
}

/**
 * Calculate overall success rate by ATS type
 */
export function getSuccessRateByATS(
  attempts: ApplicationAttempt[]
): Record<ATSType, { total: number; successful: number; rate: number }> {
  const stats: Record<string, { total: number; successful: number; rate: number }> = {};

  for (const attempt of attempts) {
    if (!stats[attempt.ats_type]) {
      stats[attempt.ats_type] = { total: 0, successful: 0, rate: 0 };
    }

    stats[attempt.ats_type].total++;
    if (attempt.success) {
      stats[attempt.ats_type].successful++;
    }
  }

  // Calculate rates
  for (const ats of Object.keys(stats)) {
    const s = stats[ats];
    s.rate = s.total > 0 ? (s.successful / s.total) * 100 : 0;
  }

  return stats as Record<ATSType, { total: number; successful: number; rate: number }>;
}

// ============================================================================
// API PAYLOAD BUILDER
// ============================================================================

/**
 * Build the payload for the log-application API
 */
export function buildLogPayload(attempt: ApplicationAttempt): {
  job_id: string;
  ats_type: string;
  status: string;
  fields_filled: FieldAttempt[];
  fields_failed: FieldAttempt[];
  fields_missing: string[];
  custom_questions?: CustomQuestion[];
  duration_ms: number;
  error_message?: string;
  error_category?: string;
} {
  return {
    job_id: attempt.job_id,
    ats_type: attempt.ats_type,
    status: attempt.success ? 'submitted' : 'failed',
    fields_filled: attempt.fields_filled,
    fields_failed: attempt.fields_failed,
    fields_missing: attempt.fields_missing,
    custom_questions: attempt.custom_questions,
    duration_ms: attempt.duration_ms,
    error_message: attempt.error_message,
    error_category: attempt.error_category,
  };
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const tracker = new AutoApplyTracker();
export default tracker;
