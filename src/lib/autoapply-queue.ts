/**
 * Auto-Apply Retry Queue System
 *
 * Handles failed application retries with exponential backoff,
 * error classification, and different retry strategies per error type.
 */

import { useState, useEffect, useCallback } from 'react';

// Error types that determine retry strategy
export enum ErrorType {
  NETWORK = 'network',           // Transient network failures
  TIMEOUT = 'timeout',           // Request timeouts
  RATE_LIMIT = 'rate_limit',     // API rate limiting (429)
  SERVER_ERROR = 'server_error', // 5xx errors
  VALIDATION = 'validation',     // Form validation errors
  AUTH = 'auth',                 // Authentication failures
  ATS_ERROR = 'ats_error',       // ATS-specific errors
  CAPTCHA = 'captcha',           // CAPTCHA challenges
  PERMANENT = 'permanent',       // Non-retryable errors (404, invalid job, etc.)
  UNKNOWN = 'unknown',           // Unknown errors
}

// Retry configuration per error type
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry: boolean;
  jitterFactor: number; // 0-1, randomness factor
}

const RETRY_STRATEGIES: Record<ErrorType, RetryConfig> = {
  [ErrorType.NETWORK]: {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    shouldRetry: true,
    jitterFactor: 0.3,
  },
  [ErrorType.TIMEOUT]: {
    maxRetries: 3,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    shouldRetry: true,
    jitterFactor: 0.2,
  },
  [ErrorType.RATE_LIMIT]: {
    maxRetries: 3,
    baseDelayMs: 60000, // Start with 1 minute for rate limits
    maxDelayMs: 300000, // Up to 5 minutes
    shouldRetry: true,
    jitterFactor: 0.5,
  },
  [ErrorType.SERVER_ERROR]: {
    maxRetries: 3,
    baseDelayMs: 10000,
    maxDelayMs: 120000,
    shouldRetry: true,
    jitterFactor: 0.3,
  },
  [ErrorType.VALIDATION]: {
    maxRetries: 0, // No automatic retry for validation errors
    baseDelayMs: 0,
    maxDelayMs: 0,
    shouldRetry: false,
    jitterFactor: 0,
  },
  [ErrorType.AUTH]: {
    maxRetries: 1, // Retry once in case of token refresh
    baseDelayMs: 1000,
    maxDelayMs: 5000,
    shouldRetry: true,
    jitterFactor: 0.1,
  },
  [ErrorType.ATS_ERROR]: {
    maxRetries: 2,
    baseDelayMs: 15000,
    maxDelayMs: 60000,
    shouldRetry: true,
    jitterFactor: 0.4,
  },
  [ErrorType.CAPTCHA]: {
    maxRetries: 0, // Captcha requires manual intervention
    baseDelayMs: 0,
    maxDelayMs: 0,
    shouldRetry: false,
    jitterFactor: 0,
  },
  [ErrorType.PERMANENT]: {
    maxRetries: 0,
    baseDelayMs: 0,
    maxDelayMs: 0,
    shouldRetry: false,
    jitterFactor: 0,
  },
  [ErrorType.UNKNOWN]: {
    maxRetries: 2,
    baseDelayMs: 5000,
    maxDelayMs: 30000,
    shouldRetry: true,
    jitterFactor: 0.3,
  },
};

export interface QueuedApplication {
  id: string;
  jobId: string;
  userId: string;
  atsType: string;
  errorType: ErrorType;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date;
  createdAt: Date;
  lastAttemptAt: Date;
  status: 'pending' | 'retrying' | 'exhausted' | 'success' | 'cancelled';
  metadata?: {
    jobTitle?: string;
    companyName?: string;
    originalApplicationId?: string;
  };
}

// Classify error message into error type
export function classifyError(error: string | Error): ErrorType {
  const message = typeof error === 'string' ? error.toLowerCase() : error.message.toLowerCase();

  // Network errors
  if (
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('dns') ||
    message.includes('socket') ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch')
  ) {
    return ErrorType.NETWORK;
  }

  // Timeout errors
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout') ||
    message.includes('aborted')
  ) {
    return ErrorType.TIMEOUT;
  }

  // Rate limiting
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    message.includes('throttle')
  ) {
    return ErrorType.RATE_LIMIT;
  }

  // Server errors
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('internal server error') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway')
  ) {
    return ErrorType.SERVER_ERROR;
  }

  // Validation errors
  if (
    message.includes('validation') ||
    message.includes('invalid') ||
    message.includes('required field') ||
    message.includes('missing') ||
    message.includes('format')
  ) {
    return ErrorType.VALIDATION;
  }

  // Auth errors
  if (
    message.includes('unauthorized') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('forbidden') ||
    message.includes('authentication') ||
    message.includes('token')
  ) {
    return ErrorType.AUTH;
  }

  // ATS-specific errors
  if (
    message.includes('greenhouse') ||
    message.includes('lever') ||
    message.includes('ashby') ||
    message.includes('ats') ||
    message.includes('application system')
  ) {
    return ErrorType.ATS_ERROR;
  }

  // Captcha
  if (
    message.includes('captcha') ||
    message.includes('recaptcha') ||
    message.includes('hcaptcha') ||
    message.includes('bot') ||
    message.includes('human verification')
  ) {
    return ErrorType.CAPTCHA;
  }

  // Permanent failures
  if (
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('job closed') ||
    message.includes('no longer accepting') ||
    message.includes('position filled') ||
    message.includes('already applied')
  ) {
    return ErrorType.PERMANENT;
  }

  return ErrorType.UNKNOWN;
}

// Calculate delay with exponential backoff and jitter
export function calculateRetryDelay(
  retryCount: number,
  config: RetryConfig
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, retryCount);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter
  const jitterRange = cappedDelay * config.jitterFactor;
  const jitter = Math.random() * jitterRange - jitterRange / 2;

  return Math.max(0, Math.round(cappedDelay + jitter));
}

// Get human-readable error description
export function getErrorDescription(errorType: ErrorType): string {
  const descriptions: Record<ErrorType, string> = {
    [ErrorType.NETWORK]: 'Network connection failed. Will retry automatically.',
    [ErrorType.TIMEOUT]: 'Request timed out. Will retry with longer timeout.',
    [ErrorType.RATE_LIMIT]: 'Too many requests. Will retry after cooldown.',
    [ErrorType.SERVER_ERROR]: 'Server error occurred. Will retry when service recovers.',
    [ErrorType.VALIDATION]: 'Form validation failed. Please check your profile.',
    [ErrorType.AUTH]: 'Authentication issue. Please sign in again.',
    [ErrorType.ATS_ERROR]: 'Application system error. Will retry shortly.',
    [ErrorType.CAPTCHA]: 'CAPTCHA required. Manual application needed.',
    [ErrorType.PERMANENT]: 'Cannot apply to this job. Position may be closed.',
    [ErrorType.UNKNOWN]: 'Unexpected error occurred. Will attempt retry.',
  };
  return descriptions[errorType];
}

// Check if error type is retryable
export function isRetryable(errorType: ErrorType): boolean {
  return RETRY_STRATEGIES[errorType].shouldRetry;
}

// Get max retries for error type
export function getMaxRetries(errorType: ErrorType): number {
  return RETRY_STRATEGIES[errorType].maxRetries;
}

// Get retry config for error type
export function getRetryConfig(errorType: ErrorType): RetryConfig {
  return RETRY_STRATEGIES[errorType];
}

// Storage key for localStorage
const QUEUE_STORAGE_KEY = 'autoapply_retry_queue';

// Queue Manager class
export class AutoApplyRetryQueue {
  private queue: QueuedApplication[] = [];
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private onRetry?: (item: QueuedApplication) => Promise<boolean>;
  private onStatusChange?: (item: QueuedApplication) => void;

  constructor(
    onRetry?: (item: QueuedApplication) => Promise<boolean>,
    onStatusChange?: (item: QueuedApplication) => void
  ) {
    this.onRetry = onRetry;
    this.onStatusChange = onStatusChange;
    this.loadFromStorage();
  }

  // Update callbacks (needed for singleton pattern with changing userId)
  setCallbacks(
    onRetry?: (item: QueuedApplication) => Promise<boolean>,
    onStatusChange?: (item: QueuedApplication) => void
  ): void {
    if (onRetry) this.onRetry = onRetry;
    if (onStatusChange) this.onStatusChange = onStatusChange;
  }

  // Load queue from localStorage
  private loadFromStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.queue = parsed.map((item: QueuedApplication) => ({
          ...item,
          nextRetryAt: new Date(item.nextRetryAt),
          createdAt: new Date(item.createdAt),
          lastAttemptAt: new Date(item.lastAttemptAt),
        }));

        // Reschedule pending retries
        this.queue
          .filter(item => item.status === 'pending')
          .forEach(item => this.scheduleRetry(item));
      }
    } catch (e) {
      console.error('Failed to load retry queue from storage:', e);
      this.queue = [];
    }
  }

  // Save queue to localStorage
  private saveToStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.error('Failed to save retry queue to storage:', e);
    }
  }

  // Add a failed application to the retry queue
  addToQueue(
    jobId: string,
    userId: string,
    atsType: string,
    error: string | Error,
    metadata?: QueuedApplication['metadata']
  ): QueuedApplication | null {
    const errorType = classifyError(error);
    const config = getRetryConfig(errorType);

    // Check if already in queue
    const existing = this.queue.find(
      item => item.jobId === jobId && item.userId === userId && item.status === 'pending'
    );
    if (existing) {
      return existing;
    }

    // Check if retryable
    if (!config.shouldRetry) {
      const item: QueuedApplication = {
        id: `${jobId}-${Date.now()}`,
        jobId,
        userId,
        atsType,
        errorType,
        errorMessage: typeof error === 'string' ? error : error.message,
        retryCount: 0,
        maxRetries: 0,
        nextRetryAt: new Date(0),
        createdAt: new Date(),
        lastAttemptAt: new Date(),
        status: 'exhausted',
        metadata,
      };
      this.queue.push(item);
      this.saveToStorage();
      this.onStatusChange?.(item);
      return item;
    }

    const delay = calculateRetryDelay(0, config);
    const item: QueuedApplication = {
      id: `${jobId}-${Date.now()}`,
      jobId,
      userId,
      atsType,
      errorType,
      errorMessage: typeof error === 'string' ? error : error.message,
      retryCount: 0,
      maxRetries: config.maxRetries,
      nextRetryAt: new Date(Date.now() + delay),
      createdAt: new Date(),
      lastAttemptAt: new Date(),
      status: 'pending',
      metadata,
    };

    this.queue.push(item);
    this.saveToStorage();
    this.scheduleRetry(item);
    this.onStatusChange?.(item);

    return item;
  }

  // Schedule a retry for an item
  private scheduleRetry(item: QueuedApplication): void {
    // Clear existing timer
    const existingTimer = this.timers.get(item.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const delay = Math.max(0, item.nextRetryAt.getTime() - Date.now());

    const timer = setTimeout(async () => {
      await this.executeRetry(item.id);
    }, delay);

    this.timers.set(item.id, timer);
  }

  // Execute a retry
  private async executeRetry(itemId: string): Promise<void> {
    const item = this.queue.find(i => i.id === itemId);
    if (!item || item.status !== 'pending') return;

    item.status = 'retrying';
    item.lastAttemptAt = new Date();
    this.saveToStorage();
    this.onStatusChange?.(item);

    try {
      const success = await this.onRetry?.(item);

      if (success) {
        item.status = 'success';
        this.timers.delete(item.id);
        this.saveToStorage();
        this.onStatusChange?.(item);
        return;
      }

      // Retry failed, increment count
      item.retryCount++;

      if (item.retryCount >= item.maxRetries) {
        item.status = 'exhausted';
        this.timers.delete(item.id);
      } else {
        const config = getRetryConfig(item.errorType);
        const delay = calculateRetryDelay(item.retryCount, config);
        item.nextRetryAt = new Date(Date.now() + delay);
        item.status = 'pending';
        this.scheduleRetry(item);
      }

      this.saveToStorage();
      this.onStatusChange?.(item);
    } catch (error) {
      // Re-classify the error
      const newErrorType = classifyError(error as Error);
      item.errorType = newErrorType;
      item.errorMessage = (error as Error).message;
      item.retryCount++;

      const config = getRetryConfig(newErrorType);

      if (!config.shouldRetry || item.retryCount >= config.maxRetries) {
        item.status = 'exhausted';
        item.maxRetries = config.maxRetries;
        this.timers.delete(item.id);
      } else {
        const delay = calculateRetryDelay(item.retryCount, config);
        item.nextRetryAt = new Date(Date.now() + delay);
        item.status = 'pending';
        item.maxRetries = config.maxRetries;
        this.scheduleRetry(item);
      }

      this.saveToStorage();
      this.onStatusChange?.(item);
    }
  }

  // Manual retry
  async retryNow(itemId: string): Promise<boolean> {
    const item = this.queue.find(i => i.id === itemId);
    if (!item) return false;

    // Reset retry count for manual retries
    item.retryCount = Math.max(0, item.retryCount - 1);
    item.status = 'pending';
    item.nextRetryAt = new Date();
    this.saveToStorage();

    await this.executeRetry(itemId);
    return true;
  }

  // Cancel a queued retry
  cancel(itemId: string): boolean {
    const item = this.queue.find(i => i.id === itemId);
    if (!item) return false;

    item.status = 'cancelled';
    const timer = this.timers.get(item.id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(item.id);
    }

    this.saveToStorage();
    this.onStatusChange?.(item);
    return true;
  }

  // Remove item from queue
  remove(itemId: string): boolean {
    const index = this.queue.findIndex(i => i.id === itemId);
    if (index === -1) return false;

    const timer = this.timers.get(itemId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(itemId);
    }

    this.queue.splice(index, 1);
    this.saveToStorage();
    return true;
  }

  // Get all items
  getAll(): QueuedApplication[] {
    return [...this.queue];
  }

  // Get pending items
  getPending(): QueuedApplication[] {
    return this.queue.filter(item => item.status === 'pending' || item.status === 'retrying');
  }

  // Get exhausted/failed items
  getFailed(): QueuedApplication[] {
    return this.queue.filter(item => item.status === 'exhausted' || item.status === 'cancelled');
  }

  // Get items for a specific user
  getForUser(userId: string): QueuedApplication[] {
    return this.queue.filter(item => item.userId === userId);
  }

  // Get items by status
  getByStatus(status: QueuedApplication['status']): QueuedApplication[] {
    return this.queue.filter(item => item.status === status);
  }

  // Clear all items
  clear(): void {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    this.queue = [];
    this.saveToStorage();
  }

  // Clear completed/cancelled items
  clearCompleted(): void {
    this.queue = this.queue.filter(
      item => item.status === 'pending' || item.status === 'retrying'
    );
    this.saveToStorage();
  }

  // Get queue statistics
  getStats(userId?: string): {
    pending: number;
    retrying: number;
    exhausted: number;
    success: number;
    cancelled: number;
    total: number;
  } {
    const items = userId ? this.getForUser(userId) : this.queue;
    return {
      pending: items.filter(i => i.status === 'pending').length,
      retrying: items.filter(i => i.status === 'retrying').length,
      exhausted: items.filter(i => i.status === 'exhausted').length,
      success: items.filter(i => i.status === 'success').length,
      cancelled: items.filter(i => i.status === 'cancelled').length,
      total: items.length,
    };
  }

  // Cleanup and stop all timers
  destroy(): void {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }
}

// Singleton instance (lazy initialized)
let queueInstance: AutoApplyRetryQueue | null = null;

export function getRetryQueue(
  onRetry?: (item: QueuedApplication) => Promise<boolean>,
  onStatusChange?: (item: QueuedApplication) => void
): AutoApplyRetryQueue {
  if (!queueInstance) {
    queueInstance = new AutoApplyRetryQueue(onRetry, onStatusChange);
  } else if (onRetry || onStatusChange) {
    // Update callbacks if provided (handles userId changes, component remounts)
    queueInstance.setCallbacks(onRetry, onStatusChange);
  }
  return queueInstance;
}

// React hook for retry queue - proper implementation with state management
// Note: Must be used in a client component ('use client')
export function useRetryQueue(userId: string) {
  const emptyStats = { pending: 0, retrying: 0, exhausted: 0, success: 0, cancelled: 0, total: 0 };

  // State to track queue items for this user - lazy initialization
  const [items, setItems] = useState<QueuedApplication[]>(() => {
    if (typeof window === 'undefined') return [];
    const queue = getRetryQueue();
    return queue.getForUser(userId);
  });

  // Track version to force re-renders when queue changes
  const [, forceUpdate] = useState(0);

  // Subscribe to queue changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const queue = getRetryQueue();

    // Set up the status change callback which will update state
    queue.setCallbacks(
      undefined, // onRetry - leave undefined, caller should set up separately if needed
      () => {
        // onStatusChange - update items and force re-render
        setItems(queue.getForUser(userId));
        forceUpdate(v => v + 1);
      }
    );

    // Re-fetch items when userId changes - this is intentional synchronization
    // with external state (localStorage) when the user identity changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(queue.getForUser(userId));
  }, [userId]);

  const retryNow = useCallback(async (itemId: string): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    const queue = getRetryQueue();
    const result = await queue.retryNow(itemId);
    setItems(queue.getForUser(userId));
    return result;
  }, [userId]);

  const cancel = useCallback((itemId: string): boolean => {
    if (typeof window === 'undefined') return false;
    const queue = getRetryQueue();
    const result = queue.cancel(itemId);
    setItems(queue.getForUser(userId));
    return result;
  }, [userId]);

  const remove = useCallback((itemId: string): boolean => {
    if (typeof window === 'undefined') return false;
    const queue = getRetryQueue();
    const result = queue.remove(itemId);
    setItems(queue.getForUser(userId));
    return result;
  }, [userId]);

  const clearCompleted = useCallback((): void => {
    if (typeof window === 'undefined') return;
    const queue = getRetryQueue();
    queue.clearCompleted();
    setItems(queue.getForUser(userId));
  }, [userId]);

  // SSR fallback
  if (typeof window === 'undefined') {
    return {
      queue: [] as QueuedApplication[],
      pending: [] as QueuedApplication[],
      failed: [] as QueuedApplication[],
      stats: emptyStats,
      retryNow: async () => false,
      cancel: () => false,
      remove: () => false,
      clearCompleted: () => {},
    };
  }

  return {
    queue: items,
    pending: items.filter(i => i.status === 'pending' || i.status === 'retrying'),
    failed: items.filter(i => i.status === 'exhausted' || i.status === 'cancelled'),
    stats: {
      pending: items.filter(i => i.status === 'pending').length,
      retrying: items.filter(i => i.status === 'retrying').length,
      exhausted: items.filter(i => i.status === 'exhausted').length,
      success: items.filter(i => i.status === 'success').length,
      cancelled: items.filter(i => i.status === 'cancelled').length,
      total: items.length,
    },
    retryNow,
    cancel,
    remove,
    clearCompleted,
  };
}

// Format time until retry
export function formatRetryTime(nextRetryAt: Date): string {
  const diff = nextRetryAt.getTime() - Date.now();

  if (diff <= 0) return 'Retrying now...';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// Error type display names
export const ERROR_TYPE_LABELS: Record<ErrorType, string> = {
  [ErrorType.NETWORK]: 'Network Error',
  [ErrorType.TIMEOUT]: 'Timeout',
  [ErrorType.RATE_LIMIT]: 'Rate Limited',
  [ErrorType.SERVER_ERROR]: 'Server Error',
  [ErrorType.VALIDATION]: 'Validation Error',
  [ErrorType.AUTH]: 'Auth Error',
  [ErrorType.ATS_ERROR]: 'ATS Error',
  [ErrorType.CAPTCHA]: 'Captcha Required',
  [ErrorType.PERMANENT]: 'Cannot Apply',
  [ErrorType.UNKNOWN]: 'Unknown Error',
};

// Error type colors for UI
export const ERROR_TYPE_COLORS: Record<ErrorType, string> = {
  [ErrorType.NETWORK]: 'bg-orange-100 text-orange-700',
  [ErrorType.TIMEOUT]: 'bg-yellow-100 text-yellow-700',
  [ErrorType.RATE_LIMIT]: 'bg-amber-100 text-amber-700',
  [ErrorType.SERVER_ERROR]: 'bg-red-100 text-red-700',
  [ErrorType.VALIDATION]: 'bg-purple-100 text-purple-700',
  [ErrorType.AUTH]: 'bg-pink-100 text-pink-700',
  [ErrorType.ATS_ERROR]: 'bg-blue-100 text-blue-700',
  [ErrorType.CAPTCHA]: 'bg-gray-100 text-gray-700',
  [ErrorType.PERMANENT]: 'bg-slate-100 text-slate-700',
  [ErrorType.UNKNOWN]: 'bg-gray-100 text-gray-700',
};
