/**
 * Error Reporter for Auto-Apply
 *
 * Logs application errors and events to application_logs table
 * for monitoring, debugging, and analytics.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { classifyError, ErrorType, type ClassifiedError } from './circuit-breaker';
import { getDegradationState, type DegradationLevel } from './degradation';

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogCategory =
  | 'application'      // Job application process
  | 'browser'          // Browser automation
  | 'ats'              // ATS-specific issues
  | 'network'          // Network/connectivity
  | 'validation'       // Form validation
  | 'file'             // File operations
  | 'auth'             // Authentication
  | 'rate_limit'       // Rate limiting
  | 'circuit_breaker'  // Circuit breaker events
  | 'degradation'      // Service degradation
  | 'performance'      // Performance metrics
  | 'system';          // System events

export interface LogEntry {
  /** Log level */
  level: LogLevel;

  /** Log category */
  category: LogCategory;

  /** Human-readable message */
  message: string;

  /** Error type classification */
  errorType?: ErrorType;

  /** ATS type (greenhouse, lever, etc.) */
  atsType?: string;

  /** Job URL being processed */
  jobUrl?: string;

  /** User ID if available */
  userId?: string;

  /** Additional structured data */
  metadata?: Record<string, any>;

  /** Stack trace if available */
  stackTrace?: string;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Number of retry attempts */
  retryAttempts?: number;

  /** Whether the operation ultimately succeeded */
  succeeded?: boolean;
}

export interface ApplicationLogRow {
  id?: string;
  created_at?: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  error_type?: string;
  ats_type?: string;
  job_url?: string;
  user_id?: string;
  metadata?: Record<string, any>;
  stack_trace?: string;
  duration_ms?: number;
  retry_attempts?: number;
  succeeded?: boolean;
  session_id?: string;
  degradation_level?: string;
}

export interface ErrorReporterConfig {
  /** Supabase URL */
  supabaseUrl?: string;

  /** Supabase service key (for server-side logging) */
  supabaseKey?: string;

  /** Minimum level to log (default: 'info') */
  minLevel?: LogLevel;

  /** Whether to also log to console (default: true) */
  consoleLog?: boolean;

  /** Whether to batch logs (default: true for performance) */
  batchLogs?: boolean;

  /** Batch interval in ms (default: 5000) */
  batchInterval?: number;

  /** Max batch size (default: 50) */
  maxBatchSize?: number;

  /** Session ID for correlating logs */
  sessionId?: string;
}

// ============================================================================
// Error Reporter Class
// ============================================================================

class ErrorReporter {
  private supabase: SupabaseClient | null = null;
  private config: Required<ErrorReporterConfig>;
  private logQueue: ApplicationLogRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private sessionId: string;

  constructor(config: ErrorReporterConfig = {}) {
    this.config = {
      supabaseUrl: config.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      supabaseKey: config.supabaseKey || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      minLevel: config.minLevel || 'info',
      consoleLog: config.consoleLog ?? true,
      batchLogs: config.batchLogs ?? true,
      batchInterval: config.batchInterval || 5000,
      maxBatchSize: config.maxBatchSize || 50,
      sessionId: config.sessionId || generateSessionId()
    };

    this.sessionId = this.config.sessionId;

    // Initialize Supabase client if credentials available
    if (this.config.supabaseUrl && this.config.supabaseKey) {
      this.supabase = createClient(
        this.config.supabaseUrl,
        this.config.supabaseKey
      );
    }
  }

  /**
   * Log an entry with the specified level.
   */
  async log(entry: LogEntry): Promise<void> {
    // Check minimum level
    if (!this.shouldLog(entry.level)) {
      return;
    }

    // Console logging
    if (this.config.consoleLog) {
      this.logToConsole(entry);
    }

    // Build database row
    const row = this.buildLogRow(entry);

    // Queue or immediately flush
    if (this.config.batchLogs) {
      this.queueLog(row);
    } else {
      await this.writeLog(row);
    }
  }

  /**
   * Log an error with automatic classification.
   */
  async logError(
    error: Error | unknown,
    context: Partial<LogEntry> = {}
  ): Promise<ClassifiedError> {
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

  /**
   * Log a successful operation.
   */
  async logSuccess(
    message: string,
    context: Partial<LogEntry> = {}
  ): Promise<void> {
    await this.log({
      level: 'info',
      category: context.category || 'application',
      message,
      succeeded: true,
      ...context
    });
  }

  /**
   * Log a retry attempt.
   */
  async logRetry(
    attempt: number,
    error: ClassifiedError,
    delayMs: number,
    context: Partial<LogEntry> = {}
  ): Promise<void> {
    await this.log({
      level: 'warn',
      category: context.category || 'application',
      message: `Retry attempt ${attempt}: ${error.message}. Waiting ${delayMs}ms`,
      errorType: error.type,
      retryAttempts: attempt,
      metadata: {
        delayMs,
        errorType: error.type,
        shouldRetry: error.shouldRetry,
        ...context.metadata
      },
      ...context
    });
  }

  /**
   * Log a circuit breaker event.
   */
  async logCircuitEvent(
    event: 'open' | 'close' | 'half_open' | 'reject',
    atsType: string,
    stats?: Record<string, any>
  ): Promise<void> {
    const level: LogLevel = event === 'open' ? 'error' : 'info';

    await this.log({
      level,
      category: 'circuit_breaker',
      message: `Circuit breaker ${event.toUpperCase()} for ${atsType}`,
      atsType,
      metadata: stats
    });
  }

  /**
   * Log a degradation event.
   */
  async logDegradation(
    level: DegradationLevel,
    reason: string,
    affectedServices: string[]
  ): Promise<void> {
    await this.log({
      level: level === 'OFFLINE' ? 'error' : 'warn',
      category: 'degradation',
      message: `Degradation level: ${level}. ${reason}`,
      metadata: {
        degradationLevel: level,
        affectedServices
      }
    });
  }

  /**
   * Log performance metrics.
   */
  async logPerformance(
    operation: string,
    durationMs: number,
    context: Partial<LogEntry> = {}
  ): Promise<void> {
    await this.log({
      level: durationMs > 30000 ? 'warn' : 'info',
      category: 'performance',
      message: `${operation} completed in ${durationMs}ms`,
      durationMs,
      ...context
    });
  }

  /**
   * Log application process start.
   */
  async logApplicationStart(
    jobUrl: string,
    atsType: string,
    userId?: string
  ): Promise<void> {
    await this.log({
      level: 'info',
      category: 'application',
      message: `Starting application for ${atsType} job`,
      atsType,
      jobUrl,
      userId,
      metadata: {
        action: 'start'
      }
    });
  }

  /**
   * Log application process completion.
   */
  async logApplicationComplete(
    jobUrl: string,
    atsType: string,
    succeeded: boolean,
    durationMs: number,
    context: Partial<LogEntry> = {}
  ): Promise<void> {
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

  /**
   * Flush any pending logs immediately.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.logQueue.length > 0) {
      const logs = [...this.logQueue];
      this.logQueue = [];
      await this.writeLogs(logs);
    }
  }

  /**
   * Update the session ID.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
    return levels.indexOf(level) >= levels.indexOf(this.config.minLevel);
  }

  private buildLogRow(entry: LogEntry): ApplicationLogRow {
    const degradationState = getDegradationState();

    return {
      level: entry.level,
      category: entry.category,
      message: entry.message,
      error_type: entry.errorType,
      ats_type: entry.atsType,
      job_url: entry.jobUrl,
      user_id: entry.userId,
      metadata: entry.metadata,
      stack_trace: entry.stackTrace,
      duration_ms: entry.durationMs,
      retry_attempts: entry.retryAttempts,
      succeeded: entry.succeeded,
      session_id: this.sessionId,
      degradation_level: degradationState.level
    };
  }

  private queueLog(row: ApplicationLogRow): void {
    this.logQueue.push(row);

    // Flush immediately if batch is full
    if (this.logQueue.length >= this.config.maxBatchSize) {
      this.flush();
      return;
    }

    // Schedule flush if not already scheduled
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, this.config.batchInterval);
    }
  }

  private async writeLog(row: ApplicationLogRow): Promise<void> {
    await this.writeLogs([row]);
  }

  private async writeLogs(rows: ApplicationLogRow[]): Promise<void> {
    if (!this.supabase || rows.length === 0) {
      return;
    }

    try {
      const { error } = await this.supabase
        .from('application_logs')
        .insert(rows);

      if (error) {
        console.error('[ErrorReporter] Failed to write logs:', error.message);
      }
    } catch (error) {
      console.error('[ErrorReporter] Error writing logs:', error);
    }
  }

  private logToConsole(entry: LogEntry): void {
    const prefix = `[${entry.category}]`;
    const timestamp = new Date().toISOString();

    switch (entry.level) {
      case 'debug':
        console.debug(`${timestamp} ${prefix} ${entry.message}`, entry.metadata || '');
        break;
      case 'info':
        console.info(`${timestamp} ${prefix} ${entry.message}`);
        break;
      case 'warn':
        console.warn(`${timestamp} ${prefix} ${entry.message}`, entry.metadata || '');
        break;
      case 'error':
      case 'fatal':
        console.error(`${timestamp} ${prefix} ${entry.message}`, entry.stackTrace || entry.metadata || '');
        break;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let reporterInstance: ErrorReporter | null = null;

/**
 * Get the singleton ErrorReporter instance.
 */
export function getErrorReporter(config?: ErrorReporterConfig): ErrorReporter {
  if (!reporterInstance) {
    reporterInstance = new ErrorReporter(config);
  }
  return reporterInstance;
}

/**
 * Initialize ErrorReporter with custom configuration.
 * Call this at application startup.
 */
export function initErrorReporter(config: ErrorReporterConfig): ErrorReporter {
  reporterInstance = new ErrorReporter(config);
  return reporterInstance;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Log an error (convenience function).
 */
export async function logError(
  error: Error | unknown,
  context: Partial<LogEntry> = {}
): Promise<ClassifiedError> {
  return getErrorReporter().logError(error, context);
}

/**
 * Log info (convenience function).
 */
export async function logInfo(
  message: string,
  context: Partial<LogEntry> = {}
): Promise<void> {
  return getErrorReporter().log({
    level: 'info',
    category: context.category || 'application',
    message,
    ...context
  });
}

/**
 * Log warning (convenience function).
 */
export async function logWarn(
  message: string,
  context: Partial<LogEntry> = {}
): Promise<void> {
  return getErrorReporter().log({
    level: 'warn',
    category: context.category || 'application',
    message,
    ...context
  });
}

/**
 * Flush all pending logs (convenience function).
 */
export async function flushLogs(): Promise<void> {
  return getErrorReporter().flush();
}

// ============================================================================
// Export Class for Testing
// ============================================================================

export { ErrorReporter };
