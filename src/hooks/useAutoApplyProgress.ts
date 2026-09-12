/**
 * Real-time progress tracking for auto-apply applications
 *
 * Uses Supabase Realtime to receive field-by-field progress updates
 * as the auto-apply worker fills each form field.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { ApplicationStatus } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export type CurrentStep = 'detecting' | 'filling' | 'validating' | 'submitting' | 'confirming';

export interface FieldProgress {
  field: string;
  status: 'pending' | 'filling' | 'success' | 'failed' | 'skipped';
  error?: string;
  duration_ms?: number;
}

export interface ProgressData {
  total_fields: number;
  filled_fields: number;
  current_field?: string;
  current_step: CurrentStep;
  steps_completed: string[];
  estimated_remaining_ms?: number;
}

export interface FieldAttempt {
  field: string;
  selector?: string;
  found?: boolean;
  filled?: boolean;
  error?: string;
  duration_ms?: number;
}

export interface ApplicationProgress {
  /** Application log ID */
  id: string;
  /** Job ID being applied to */
  jobId: string;
  /** Overall status */
  status: ApplicationStatus;
  /** Detected ATS type */
  atsType: string;
  /** Total number of fields to fill */
  totalFields: number;
  /** Number of fields filled so far */
  filledFields: number;
  /** Current field being processed */
  currentField?: string;
  /** Current step within the application process */
  currentStep: CurrentStep;
  /** Fields that have been completed */
  completedFields: FieldProgress[];
  /** Estimated time remaining in ms */
  estimatedRemainingMs?: number;
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Timestamp of last update */
  lastUpdatedAt: Date;
}

export interface UseAutoApplyProgressOptions {
  /** User ID to track applications for */
  userId: string;
  /** Optional: Only track specific job IDs */
  jobIds?: string[];
  /** Callback when progress updates */
  onProgress?: (progress: ApplicationProgress) => void;
  /** Callback when application completes (success or fail) */
  onComplete?: (progress: ApplicationProgress) => void;
  /** Callback when a new application starts */
  onStart?: (progress: ApplicationProgress) => void;
}

export interface UseAutoApplyProgressReturn {
  /** Map of job ID to progress state */
  applications: Map<string, ApplicationProgress>;
  /** Array of all active applications */
  activeApplications: ApplicationProgress[];
  /** Number of applications currently in progress */
  inProgressCount: number;
  /** Connection status */
  isConnected: boolean;
  /** Last error */
  error: Error | null;
  /** Force refresh from database */
  refresh: () => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

const CHANNEL_NAME = 'autoapply_progress';
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 1000;
const ACTIVE_STATUSES: ApplicationStatus[] = ['pending', 'filling', 'review'];
const COMPLETED_STATUSES: ApplicationStatus[] = ['submitted', 'failed'];
const DEFAULT_TOTAL_FIELDS = 10;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate exponential backoff delay
 */
function getReconnectDelay(attempt: number): number {
  return Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt), 16000);
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for tracking real-time auto-apply progress
 *
 * @example
 * ```tsx
 * const {
 *   applications,
 *   activeApplications,
 *   inProgressCount,
 *   isConnected,
 *   error,
 *   refresh,
 * } = useAutoApplyProgress({
 *   userId: 'user-123',
 *   jobIds: ['job-1', 'job-2'], // Optional: filter by job IDs
 *   onProgress: (progress) => console.log('Progress:', progress.progressPercent),
 *   onStart: (progress) => console.log('Started:', progress.jobId),
 *   onComplete: (progress) => {
 *     if (progress.status === 'submitted') {
 *       toast.success('Application submitted!');
 *     } else {
 *       toast.error(progress.errorMessage);
 *     }
 *   },
 * });
 *
 * return (
 *   <div>
 *     {inProgressCount > 0 && <span>Applying to {inProgressCount} jobs...</span>}
 *     {activeApplications.map((app) => (
 *       <ProgressBar key={app.id} progress={app} />
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useAutoApplyProgress(
  options: UseAutoApplyProgressOptions
): UseAutoApplyProgressReturn {
  const { userId, jobIds, onProgress, onStart, onComplete } = options;

  // State
  const [applications, setApplications] = useState<Map<string, ApplicationProgress>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef(createClient());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbacksRef = useRef({ onProgress, onStart, onComplete });

  // Update callback refs when they change
  useEffect(() => {
    callbacksRef.current = { onProgress, onStart, onComplete };
  }, [onProgress, onStart, onComplete]);

  /**
   * Parse database row into ApplicationProgress
   */
  const parseProgress = useCallback((row: Record<string, unknown>): ApplicationProgress => {
    const progress = (row.progress as ProgressData) || {} as ProgressData;
    const fieldsFilledArr = (row.fields_filled as FieldAttempt[]) || [];
    const fieldsFailedArr = (row.fields_failed as FieldAttempt[]) || [];

    const completedFields: FieldProgress[] = [
      ...fieldsFilledArr.map((f) => ({
        field: f.field,
        status: 'success' as const,
        duration_ms: f.duration_ms,
      })),
      ...fieldsFailedArr.map((f) => ({
        field: f.field,
        status: 'failed' as const,
        error: f.error,
      })),
    ];

    const totalFields = progress.total_fields || completedFields.length || DEFAULT_TOTAL_FIELDS;
    const filledFields = progress.filled_fields || completedFields.filter((f) => f.status === 'success').length;

    return {
      id: row.id as string,
      jobId: row.job_id as string,
      status: row.status as ApplicationStatus,
      atsType: (row.ats_type as string) || 'unknown',
      totalFields,
      filledFields,
      currentField: progress.current_field,
      currentStep: progress.current_step || 'detecting',
      completedFields,
      estimatedRemainingMs: progress.estimated_remaining_ms,
      progressPercent: Math.round((filledFields / totalFields) * 100),
      errorMessage: row.error_message as string | undefined,
      lastUpdatedAt: new Date((row.updated_at as string) || (row.created_at as string)),
    };
  }, []);

  /**
   * Handle incoming changes from Supabase Realtime
   */
  const handleChange = useCallback(
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const row = payload.new as Record<string, unknown>;
      if (!row || !row.id) return;

      // Filter by job IDs if specified
      if (jobIds && !jobIds.includes(row.job_id as string)) return;

      const progress = parseProgress(row);

      setApplications((prev) => {
        const next = new Map(prev);
        const existing = prev.get(progress.jobId);

        // Detect new application
        if (!existing && payload.eventType === 'INSERT') {
          callbacksRef.current.onStart?.(progress);
        }

        // Update map
        next.set(progress.jobId, progress);

        // Fire progress callback
        callbacksRef.current.onProgress?.(progress);

        // Detect completion
        if (COMPLETED_STATUSES.includes(progress.status)) {
          callbacksRef.current.onComplete?.(progress);
        }

        return next;
      });
    },
    [jobIds, parseProgress]
  );

  /**
   * Fetch current applications from database
   */
  const refresh = useCallback(async () => {
    const supabase = supabaseRef.current;
    setError(null);

    try {
      let query = supabase
        .from('application_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      // Filter by job IDs if specified
      if (jobIds && jobIds.length > 0) {
        query = query.in('job_id', jobIds);
      } else {
        // Only get active applications (not completed)
        query = query.in('status', ACTIVE_STATUSES);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        setError(new Error(fetchError.message));
        return;
      }

      const progressMap = new Map<string, ApplicationProgress>();
      for (const row of data || []) {
        const progress = parseProgress(row);
        progressMap.set(progress.jobId, progress);
      }

      setApplications(progressMap);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch applications'));
    }
  }, [userId, jobIds, parseProgress]);

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  const scheduleReconnect = useCallback(() => {
    // Clear any existing timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Check if we've exceeded max attempts
    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setError(new Error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`));
      return;
    }

    const delay = getReconnectDelay(reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;

    reconnectTimeoutRef.current = setTimeout(() => {
      setupChannel();
    }, delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Set up the Supabase channel subscription
   */
  const setupChannel = useCallback(() => {
    const supabase = supabaseRef.current;

    // Remove existing channel if any
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    setError(null);

    // Create channel with user-specific filter
    const channel = supabase
      .channel(`${CHANNEL_NAME}_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'application_logs',
          filter: `user_id=eq.${userId}`,
        },
        handleChange
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'application_logs',
          filter: `user_id=eq.${userId}`,
        },
        handleChange
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          reconnectAttemptRef.current = 0;
          setError(null);
        } else if (status === 'CHANNEL_ERROR') {
          setIsConnected(false);
          setError(err || new Error('Channel error'));
          scheduleReconnect();
        } else if (status === 'TIMED_OUT') {
          setIsConnected(false);
          setError(new Error('Connection timed out'));
          scheduleReconnect();
        } else if (status === 'CLOSED') {
          setIsConnected(false);
        }
      });

    channelRef.current = channel;
  }, [userId, handleChange, scheduleReconnect]);

  /**
   * Handle visibility change - reconnect when tab becomes visible
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isConnected) {
        reconnectAttemptRef.current = 0;
        setupChannel();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isConnected, setupChannel]);

  /**
   * Handle online/offline events
   */
  useEffect(() => {
    const handleOnline = () => {
      if (!isConnected) {
        reconnectAttemptRef.current = 0;
        setupChannel();
      }
    };

    const handleOffline = () => {
      setIsConnected(false);
      setError(new Error('Network offline'));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isConnected, setupChannel]);

  /**
   * Set up channel on mount, clean up on unmount
   */
  useEffect(() => {
    // Initial fetch
    refresh();

    // Set up realtime subscription
    setupChannel();

    return () => {
      // Clean up channel
      if (channelRef.current) {
        supabaseRef.current.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [refresh, setupChannel]);

  // Computed values
  const activeApplications = Array.from(applications.values())
    .filter((app) => ACTIVE_STATUSES.includes(app.status))
    .sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());

  return {
    applications,
    activeApplications,
    inProgressCount: activeApplications.length,
    isConnected,
    error,
    refresh,
  };
}

export default useAutoApplyProgress;
