/**
 * Auto-Apply Job Queue V2 - Supabase PostgreSQL-backed
 *
 * Replaces localStorage-based queue with persistent database queue.
 * Features:
 * - Priority levels (urgent, high, normal, low, background)
 * - Atomic job claiming with FOR UPDATE SKIP LOCKED
 * - Job status tracking
 * - Failure handling with exponential backoff retry
 * - Dead letter queue for failed applications
 */

import { createClient } from '@/lib/supabase/client';
import { useState, useEffect, useCallback } from 'react';

// =============================================
// Types
// =============================================

export enum JobPriority {
  URGENT = 1,      // User-initiated "Apply Now"
  HIGH = 2,        // Jobs expiring soon
  NORMAL = 3,      // Regular auto-apply
  LOW = 4,         // Bulk/batch applications
  BACKGROUND = 5,  // Retry attempts
}

export type QueueJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type QueueErrorType =
  | 'network'
  | 'timeout'
  | 'rate_limit'
  | 'server_error'
  | 'validation'
  | 'auth'
  | 'ats_error'
  | 'captcha'
  | 'permanent'
  | 'unknown';

export type ATSType =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'jobvite'
  | 'icims'
  | 'unknown';

export interface QueueJobData {
  jobId: string;
  jobTitle: string;
  companySlug: string;
  companyName: string;
  jobUrl: string;
  atsType: ATSType;
  resumeId?: string;
  coverLetter?: string;
  answers?: Record<string, string>;
}

export interface QueueJob {
  id: string;
  userId: string;
  jobId: string;
  jobTitle: string;
  companySlug: string;
  companyName: string;
  jobUrl: string;
  atsType: ATSType;
  priority: JobPriority;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  errorType: QueueErrorType | null;
  scheduledAt: Date;
  confirmationId: string | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueStats {
  pendingCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  totalCount: number;
  avgWaitTimeSeconds: number | null;
  successRate: number;
}

export interface ClaimedJob {
  id: string;
  userId: string;
  jobId: string;
  jobTitle: string;
  companySlug: string;
  companyName: string;
  jobUrl: string;
  atsType: ATSType;
  priority: number;
  attempts: number;
  maxAttempts: number;
  resumeId: string | null;
  coverLetter: string | null;
  answers: Record<string, string>;
  createdAt: Date;
}

export interface DeadLetterItem {
  id: string;
  originalQueueId: string;
  userId: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  jobUrl: string;
  atsType: ATSType;
  finalError: string | null;
  errorType: QueueErrorType | null;
  totalAttempts: number;
  errorHistory: Array<{ error: string; timestamp: string }>;
  originalCreatedAt: Date;
  failedAt: Date;
  reviewed: boolean;
  resolution: string | null;
  notes: string | null;
}

// =============================================
// Error Classification
// =============================================

export function classifyError(error: string | Error): QueueErrorType {
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
    return 'network';
  }

  // Timeout errors
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout') ||
    message.includes('aborted')
  ) {
    return 'timeout';
  }

  // Rate limiting
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    message.includes('throttle')
  ) {
    return 'rate_limit';
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
    return 'server_error';
  }

  // Validation errors
  if (
    message.includes('validation') ||
    message.includes('invalid') ||
    message.includes('required field') ||
    message.includes('missing') ||
    message.includes('format')
  ) {
    return 'validation';
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
    return 'auth';
  }

  // ATS-specific errors
  if (
    message.includes('greenhouse') ||
    message.includes('lever') ||
    message.includes('ashby') ||
    message.includes('ats') ||
    message.includes('application system')
  ) {
    return 'ats_error';
  }

  // Captcha
  if (
    message.includes('captcha') ||
    message.includes('recaptcha') ||
    message.includes('hcaptcha') ||
    message.includes('bot') ||
    message.includes('human verification')
  ) {
    return 'captcha';
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
    return 'permanent';
  }

  return 'unknown';
}

// =============================================
// Queue Error Descriptions
// =============================================

export const ERROR_DESCRIPTIONS: Record<QueueErrorType, string> = {
  network: 'Network connection failed. Will retry automatically.',
  timeout: 'Request timed out. Will retry with longer timeout.',
  rate_limit: 'Too many requests. Will retry after cooldown.',
  server_error: 'Server error occurred. Will retry when service recovers.',
  validation: 'Form validation failed. Please check your profile.',
  auth: 'Authentication issue. Please sign in again.',
  ats_error: 'Application system error. Will retry shortly.',
  captcha: 'CAPTCHA required. Manual application needed.',
  permanent: 'Cannot apply to this job. Position may be closed.',
  unknown: 'Unexpected error occurred. Will attempt retry.',
};

export const ERROR_TYPE_LABELS: Record<QueueErrorType, string> = {
  network: 'Network Error',
  timeout: 'Timeout',
  rate_limit: 'Rate Limited',
  server_error: 'Server Error',
  validation: 'Validation Error',
  auth: 'Auth Error',
  ats_error: 'ATS Error',
  captcha: 'Captcha Required',
  permanent: 'Cannot Apply',
  unknown: 'Unknown Error',
};

export const ERROR_TYPE_COLORS: Record<QueueErrorType, string> = {
  network: 'bg-orange-100 text-orange-700',
  timeout: 'bg-yellow-100 text-yellow-700',
  rate_limit: 'bg-amber-100 text-amber-700',
  server_error: 'bg-red-100 text-red-700',
  validation: 'bg-purple-100 text-purple-700',
  auth: 'bg-pink-100 text-pink-700',
  ats_error: 'bg-blue-100 text-blue-700',
  captcha: 'bg-gray-100 text-gray-700',
  permanent: 'bg-slate-100 text-slate-700',
  unknown: 'bg-gray-100 text-gray-700',
};

// =============================================
// Database Row to Type Mappers
// =============================================

interface QueueJobRow {
  id: string;
  user_id: string;
  job_id: string;
  job_title: string;
  company_slug: string;
  company_name: string;
  job_url: string;
  ats_type: string;
  priority: number;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  error_type: string | null;
  scheduled_at: string;
  confirmation_id: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ClaimedJobRow {
  id: string;
  user_id: string;
  job_id: string;
  job_title: string;
  company_slug: string;
  company_name: string;
  job_url: string;
  ats_type: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  resume_id: string | null;
  cover_letter: string | null;
  answers: Record<string, string> | null;
  created_at: string;
}

function mapQueueJobRow(row: QueueJobRow): QueueJob {
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    companySlug: row.company_slug,
    companyName: row.company_name,
    jobUrl: row.job_url,
    atsType: row.ats_type as ATSType,
    priority: row.priority as JobPriority,
    status: row.status as QueueJobStatus,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    errorType: row.error_type as QueueErrorType | null,
    scheduledAt: new Date(row.scheduled_at),
    confirmationId: row.confirmation_id,
    appliedAt: row.applied_at ? new Date(row.applied_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapClaimedJobRow(row: ClaimedJobRow): ClaimedJob {
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    companySlug: row.company_slug,
    companyName: row.company_name,
    jobUrl: row.job_url,
    atsType: row.ats_type as ATSType,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    resumeId: row.resume_id,
    coverLetter: row.cover_letter,
    answers: row.answers || {},
    createdAt: new Date(row.created_at),
  };
}

// =============================================
// AutoApply Queue Class
// =============================================

export class AutoApplyQueue {
  private supabase = createClient();

  /**
   * Add a job to the queue
   */
  async addJob(
    userId: string,
    data: QueueJobData,
    options: {
      priority?: JobPriority;
      delayMs?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<QueueJob> {
    const {
      priority = JobPriority.NORMAL,
      delayMs,
      maxAttempts = 3,
    } = options;

    const scheduledAt = delayMs
      ? new Date(Date.now() + delayMs).toISOString()
      : new Date().toISOString();

    const { data: job, error } = await this.supabase
      .from('autoapply_job_queue')
      .insert({
        user_id: userId,
        job_id: data.jobId,
        job_title: data.jobTitle,
        company_slug: data.companySlug,
        company_name: data.companyName,
        job_url: data.jobUrl,
        ats_type: data.atsType,
        priority,
        max_attempts: maxAttempts,
        scheduled_at: scheduledAt,
        resume_id: data.resumeId || null,
        cover_letter: data.coverLetter || null,
        answers: data.answers || {},
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add job to queue: ${error.message}`);
    }

    return mapQueueJobRow(job as QueueJobRow);
  }

  /**
   * Add multiple jobs with rate limiting (staggered scheduling)
   */
  async addBulkJobs(
    userId: string,
    jobs: QueueJobData[],
    options: {
      intervalMs?: number;
      priority?: JobPriority;
    } = {}
  ): Promise<QueueJob[]> {
    const { intervalMs = 30000, priority = JobPriority.LOW } = options;

    const results: QueueJob[] = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = await this.addJob(userId, jobs[i], {
        priority,
        delayMs: i * intervalMs,
      });
      results.push(job);
    }

    return results;
  }

  /**
   * Claim the next available job (for worker processes)
   * Uses atomic FOR UPDATE SKIP LOCKED
   */
  async claimNextJob(
    lockDuration: string = '5 minutes'
  ): Promise<ClaimedJob | null> {
    const { data, error } = await this.supabase.rpc('claim_autoapply_job', {
      p_worker_id: null,
      p_lock_duration: lockDuration,
    });

    if (error) {
      throw new Error(`Failed to claim job: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return null;
    }

    return mapClaimedJobRow(data[0] as ClaimedJobRow);
  }

  /**
   * Mark a job as completed
   */
  async completeJob(
    queueId: string,
    confirmationId?: string,
    result?: Record<string, unknown>
  ): Promise<void> {
    const { error } = await this.supabase.rpc('complete_autoapply_job', {
      p_queue_id: queueId,
      p_confirmation_id: confirmationId || null,
      p_result: result || null,
    });

    if (error) {
      throw new Error(`Failed to complete job: ${error.message}`);
    }
  }

  /**
   * Mark a job as failed (with automatic retry logic)
   */
  async failJob(
    queueId: string,
    error: string | Error,
    errorType?: QueueErrorType
  ): Promise<{ shouldRetry: boolean; nextRetryAt: Date | null }> {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const classifiedType = errorType || classifyError(error);

    const { data, error: rpcError } = await this.supabase.rpc('fail_autoapply_job', {
      p_queue_id: queueId,
      p_error_message: errorMessage,
      p_error_type: classifiedType,
    });

    if (rpcError) {
      throw new Error(`Failed to mark job as failed: ${rpcError.message}`);
    }

    const result = data?.[0];
    return {
      shouldRetry: result?.should_retry || false,
      nextRetryAt: result?.next_retry_at ? new Date(result.next_retry_at) : null,
    };
  }

  /**
   * Cancel a pending or processing job
   */
  async cancelJob(queueId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('cancel_autoapply_job', {
      p_queue_id: queueId,
      p_user_id: userId,
    });

    if (error) {
      throw new Error(`Failed to cancel job: ${error.message}`);
    }

    return data as boolean;
  }

  /**
   * Get queue statistics
   */
  async getStats(userId?: string): Promise<QueueStats> {
    const { data, error } = await this.supabase.rpc('get_autoapply_queue_stats', {
      p_user_id: userId || null,
    });

    if (error) {
      throw new Error(`Failed to get queue stats: ${error.message}`);
    }

    const row = data?.[0];
    return {
      pendingCount: Number(row?.pending_count || 0),
      processingCount: Number(row?.processing_count || 0),
      completedCount: Number(row?.completed_count || 0),
      failedCount: Number(row?.failed_count || 0),
      cancelledCount: Number(row?.cancelled_count || 0),
      totalCount: Number(row?.total_count || 0),
      avgWaitTimeSeconds: row?.avg_wait_time_seconds
        ? Number(row.avg_wait_time_seconds)
        : null,
      successRate: Number(row?.success_rate || 0),
    };
  }

  /**
   * Get user's queue items
   */
  async getUserQueue(
    userId: string,
    options: {
      status?: QueueJobStatus[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<QueueJob[]> {
    const { status, limit = 50, offset = 0 } = options;

    const { data, error } = await this.supabase.rpc('get_user_autoapply_queue', {
      p_user_id: userId,
      p_status: status || null,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      throw new Error(`Failed to get user queue: ${error.message}`);
    }

    return (data || []).map(mapQueueJobRow);
  }

  /**
   * Get a specific queue item
   */
  async getJob(queueId: string): Promise<QueueJob | null> {
    const { data, error } = await this.supabase
      .from('autoapply_job_queue')
      .select('*')
      .eq('id', queueId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to get job: ${error.message}`);
    }

    return mapQueueJobRow(data as QueueJobRow);
  }

  /**
   * Update job priority (for urgent applications)
   */
  async updatePriority(
    queueId: string,
    userId: string,
    priority: JobPriority
  ): Promise<void> {
    const { error } = await this.supabase
      .from('autoapply_job_queue')
      .update({ priority, updated_at: new Date().toISOString() })
      .eq('id', queueId)
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (error) {
      throw new Error(`Failed to update priority: ${error.message}`);
    }
  }

  /**
   * Manual retry - reset a failed job to pending
   */
  async retryJob(queueId: string, userId: string): Promise<boolean> {
    const { error, count } = await this.supabase
      .from('autoapply_job_queue')
      .update({
        status: 'pending',
        attempts: 0,
        scheduled_at: new Date().toISOString(),
        last_error: null,
        error_type: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', queueId)
      .eq('user_id', userId)
      .in('status', ['failed', 'cancelled']);

    if (error) {
      throw new Error(`Failed to retry job: ${error.message}`);
    }

    return (count || 0) > 0;
  }

  /**
   * Delete a completed/failed/cancelled job
   */
  async deleteJob(queueId: string, userId: string): Promise<boolean> {
    const { error, count } = await this.supabase
      .from('autoapply_job_queue')
      .delete()
      .eq('id', queueId)
      .eq('user_id', userId)
      .in('status', ['completed', 'failed', 'cancelled']);

    if (error) {
      throw new Error(`Failed to delete job: ${error.message}`);
    }

    return (count || 0) > 0;
  }

  /**
   * Get dead letter queue items for user
   */
  async getDeadLetterQueue(
    userId: string,
    options: { unreviewed?: boolean; limit?: number } = {}
  ): Promise<DeadLetterItem[]> {
    const { unreviewed = false, limit = 50 } = options;

    let query = this.supabase
      .from('autoapply_dead_letter_queue')
      .select('*')
      .eq('user_id', userId)
      .order('failed_at', { ascending: false })
      .limit(limit);

    if (unreviewed) {
      query = query.eq('reviewed', false);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get DLQ: ${error.message}`);
    }

    return (data || []).map((row) => ({
      id: row.id,
      originalQueueId: row.original_queue_id,
      userId: row.user_id,
      jobId: row.job_id,
      jobTitle: row.job_title,
      companyName: row.company_name,
      jobUrl: row.job_url,
      atsType: row.ats_type as ATSType,
      finalError: row.final_error,
      errorType: row.error_type as QueueErrorType | null,
      totalAttempts: row.total_attempts,
      errorHistory: row.error_history || [],
      originalCreatedAt: new Date(row.original_created_at),
      failedAt: new Date(row.failed_at),
      reviewed: row.reviewed,
      resolution: row.resolution,
      notes: row.notes,
    }));
  }

  /**
   * Subscribe to queue changes (realtime)
   */
  subscribeToQueue(
    userId: string,
    onUpdate: (payload: { new: QueueJob | null; old: QueueJob | null; eventType: string }) => void
  ): { unsubscribe: () => void } {
    const channel = this.supabase
      .channel(`autoapply_queue_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'autoapply_job_queue',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          onUpdate({
            new: payload.new ? mapQueueJobRow(payload.new as QueueJobRow) : null,
            old: payload.old ? mapQueueJobRow(payload.old as QueueJobRow) : null,
            eventType: payload.eventType,
          });
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        this.supabase.removeChannel(channel);
      },
    };
  }
}

// =============================================
// Singleton Instance
// =============================================

let queueInstance: AutoApplyQueue | null = null;

export function getAutoApplyQueue(): AutoApplyQueue {
  if (!queueInstance) {
    queueInstance = new AutoApplyQueue();
  }
  return queueInstance;
}

// =============================================
// React Hook
// =============================================

export function useAutoApplyQueue(userId: string) {
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [stats, setStats] = useState<QueueStats>({
    pendingCount: 0,
    processingCount: 0,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    totalCount: 0,
    avgWaitTimeSeconds: null,
    successRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const autoApplyQueue = getAutoApplyQueue();

  // Fetch queue items
  const refreshQueue = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const [queueItems, queueStats] = await Promise.all([
        autoApplyQueue.getUserQueue(userId),
        autoApplyQueue.getStats(userId),
      ]);
      setQueue(queueItems);
      setStats(queueStats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queue');
    } finally {
      setLoading(false);
    }
  }, [userId, autoApplyQueue]);

  // Initial fetch and realtime subscription
  useEffect(() => {
    if (!userId) return;

    refreshQueue();

    // Subscribe to realtime updates
    const { unsubscribe } = autoApplyQueue.subscribeToQueue(userId, () => {
      refreshQueue();
    });

    return () => {
      unsubscribe();
    };
  }, [userId, autoApplyQueue, refreshQueue]);

  // Add job
  const addJob = useCallback(
    async (
      data: QueueJobData,
      options?: { priority?: JobPriority; delayMs?: number }
    ) => {
      const job = await autoApplyQueue.addJob(userId, data, options);
      await refreshQueue();
      return job;
    },
    [userId, autoApplyQueue, refreshQueue]
  );

  // Add urgent job (priority bump)
  const addUrgentJob = useCallback(
    async (data: QueueJobData) => {
      return addJob(data, { priority: JobPriority.URGENT });
    },
    [addJob]
  );

  // Cancel job
  const cancelJob = useCallback(
    async (queueId: string) => {
      const result = await autoApplyQueue.cancelJob(queueId, userId);
      await refreshQueue();
      return result;
    },
    [userId, autoApplyQueue, refreshQueue]
  );

  // Retry job
  const retryJob = useCallback(
    async (queueId: string) => {
      const result = await autoApplyQueue.retryJob(queueId, userId);
      await refreshQueue();
      return result;
    },
    [userId, autoApplyQueue, refreshQueue]
  );

  // Delete job
  const deleteJob = useCallback(
    async (queueId: string) => {
      const result = await autoApplyQueue.deleteJob(queueId, userId);
      await refreshQueue();
      return result;
    },
    [userId, autoApplyQueue, refreshQueue]
  );

  // Update priority
  const updatePriority = useCallback(
    async (queueId: string, priority: JobPriority) => {
      await autoApplyQueue.updatePriority(queueId, userId, priority);
      await refreshQueue();
    },
    [userId, autoApplyQueue, refreshQueue]
  );

  return {
    // State
    queue,
    stats,
    loading,
    error,

    // Derived state
    pending: queue.filter((j) => j.status === 'pending'),
    processing: queue.filter((j) => j.status === 'processing'),
    completed: queue.filter((j) => j.status === 'completed'),
    failed: queue.filter((j) => j.status === 'failed'),

    // Actions
    addJob,
    addUrgentJob,
    cancelJob,
    retryJob,
    deleteJob,
    updatePriority,
    refreshQueue,
  };
}

// =============================================
// Utility Functions
// =============================================

/**
 * Format time until scheduled retry
 */
export function formatRetryTime(scheduledAt: Date): string {
  const diff = scheduledAt.getTime() - Date.now();

  if (diff <= 0) return 'Ready now';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Get status display info
 */
export function getStatusInfo(status: QueueJobStatus): {
  label: string;
  color: string;
  icon: string;
} {
  const statusMap: Record<QueueJobStatus, { label: string; color: string; icon: string }> = {
    pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700', icon: 'clock' },
    processing: { label: 'Processing', color: 'bg-blue-100 text-blue-700', icon: 'spinner' },
    completed: { label: 'Applied', color: 'bg-green-100 text-green-700', icon: 'check' },
    failed: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: 'x' },
    cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-700', icon: 'ban' },
    expired: { label: 'Expired', color: 'bg-slate-100 text-slate-700', icon: 'clock-off' },
  };

  return statusMap[status];
}

/**
 * Get priority display info
 */
export function getPriorityInfo(priority: JobPriority): {
  label: string;
  color: string;
} {
  const priorityMap: Record<JobPriority, { label: string; color: string }> = {
    [JobPriority.URGENT]: { label: 'Urgent', color: 'bg-red-100 text-red-700' },
    [JobPriority.HIGH]: { label: 'High', color: 'bg-orange-100 text-orange-700' },
    [JobPriority.NORMAL]: { label: 'Normal', color: 'bg-gray-100 text-gray-700' },
    [JobPriority.LOW]: { label: 'Low', color: 'bg-blue-100 text-blue-700' },
    [JobPriority.BACKGROUND]: { label: 'Background', color: 'bg-slate-100 text-slate-700' },
  };

  return priorityMap[priority];
}
