/**
 * Hook for Supabase real-time subscription to job updates
 * Provides live updates when jobs are added, updated, or removed
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Job, Tier, RoleType } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface UseSupabaseRealtimeOptions {
  /** Filter jobs by tier (e.g., 'faang', 'ai', 'unicorn') */
  tierFilter?: Tier | Tier[];
  /** Filter jobs by role type (e.g., 'swe', 'ml', 'backend') */
  roleFilter?: RoleType | RoleType[];
  /** Callback when a new job is inserted */
  onNewJob?: (job: Job) => void;
  /** Callback when a job is updated */
  onJobUpdate?: (job: Job, oldJob: Partial<Job>) => void;
  /** Callback when a job is removed (deleted or deactivated) */
  onJobRemove?: (jobId: string) => void;
}

export interface UseSupabaseRealtimeReturn {
  /** Current connection status */
  connectionStatus: ConnectionStatus;
  /** Number of new jobs since last clear */
  newJobCount: number;
  /** Array of new jobs (max 50, most recent first) */
  newJobs: Job[];
  /** Clear the new jobs count and array */
  clearNewJobs: () => void;
  /** Manually reconnect to the channel */
  reconnect: () => void;
  /** Whether the connection is currently active */
  isConnected: boolean;
  /** Last error that occurred, if any */
  lastError: Error | null;
}

// ============================================================================
// Constants
// ============================================================================

const CHANNEL_NAME = 'jobs_realtime';
const MAX_NEW_JOBS = 50;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 1000;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a job matches the tier filter
 */
function matchesTierFilter(job: Job, tierFilter?: Tier | Tier[]): boolean {
  if (!tierFilter) return true;

  const tiers = Array.isArray(tierFilter) ? tierFilter : [tierFilter];
  return tiers.includes(job.tier as Tier);
}

/**
 * Check if a job matches the role filter
 */
function matchesRoleFilter(job: Job, roleFilter?: RoleType | RoleType[]): boolean {
  if (!roleFilter) return true;
  if (!job.role_types || job.role_types.length === 0) return false;

  const roles = Array.isArray(roleFilter) ? roleFilter : [roleFilter];
  return job.role_types.some(role => roles.includes(role as RoleType));
}

/**
 * Calculate exponential backoff delay
 */
function getReconnectDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  return Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt), 16000);
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for subscribing to real-time job updates from Supabase
 *
 * @example
 * ```tsx
 * const {
 *   connectionStatus,
 *   newJobCount,
 *   newJobs,
 *   clearNewJobs,
 *   reconnect,
 *   isConnected,
 *   lastError
 * } = useSupabaseRealtime({
 *   tierFilter: 'faang',
 *   roleFilter: ['swe', 'ml'],
 *   onNewJob: (job) => console.log('New job:', job.title),
 *   onJobUpdate: (job) => console.log('Updated:', job.title),
 *   onJobRemove: (jobId) => console.log('Removed:', jobId),
 * });
 *
 * return (
 *   <div>
 *     <span>Status: {connectionStatus}</span>
 *     {newJobCount > 0 && (
 *       <button onClick={clearNewJobs}>
 *         {newJobCount} new jobs
 *       </button>
 *     )}
 *   </div>
 * );
 * ```
 */
export function useSupabaseRealtime(
  options: UseSupabaseRealtimeOptions = {}
): UseSupabaseRealtimeReturn {
  const { tierFilter, roleFilter, onNewJob, onJobUpdate, onJobRemove } = options;

  // State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [newJobCount, setNewJobCount] = useState(0);
  const [newJobs, setNewJobs] = useState<Job[]>([]);
  const [lastError, setLastError] = useState<Error | null>(null);

  // Refs for cleanup and reconnection
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const supabaseRef = useRef(createClient());

  // Store callbacks in refs to avoid re-subscriptions
  const onNewJobRef = useRef(onNewJob);
  const onJobUpdateRef = useRef(onJobUpdate);
  const onJobRemoveRef = useRef(onJobRemove);

  // Update callback refs when they change
  useEffect(() => {
    onNewJobRef.current = onNewJob;
  }, [onNewJob]);

  useEffect(() => {
    onJobUpdateRef.current = onJobUpdate;
  }, [onJobUpdate]);

  useEffect(() => {
    onJobRemoveRef.current = onJobRemove;
  }, [onJobRemove]);

  /**
   * Handle INSERT events
   */
  const handleJobInsert = useCallback(
    (payload: RealtimePostgresChangesPayload<Job>) => {
      const job = payload.new as Job;

      // Only process active jobs
      if (!job.is_active) return;

      // Apply tier filter
      if (!matchesTierFilter(job, tierFilter)) return;

      // Apply role filter
      if (!matchesRoleFilter(job, roleFilter)) return;

      // Increment count
      setNewJobCount((prev) => prev + 1);

      // Add to new jobs array (keep max 50, most recent first)
      setNewJobs((prev) => {
        const updated = [job, ...prev];
        return updated.slice(0, MAX_NEW_JOBS);
      });

      // Call callback
      onNewJobRef.current?.(job);
    },
    [tierFilter, roleFilter]
  );

  /**
   * Handle UPDATE events
   */
  const handleJobUpdate = useCallback(
    (payload: RealtimePostgresChangesPayload<Job>) => {
      const newJob = payload.new as Job;
      const oldJob = payload.old as Partial<Job>;

      // Check if job was deactivated
      if (oldJob.is_active === true && newJob.is_active === false) {
        // Job was deactivated - treat as removal
        onJobRemoveRef.current?.(newJob.id);
        return;
      }

      // Apply filters for updates we care about
      if (!matchesTierFilter(newJob, tierFilter)) return;
      if (!matchesRoleFilter(newJob, roleFilter)) return;

      // Call update callback
      onJobUpdateRef.current?.(newJob, oldJob);
    },
    [tierFilter, roleFilter]
  );

  /**
   * Handle DELETE events
   */
  const handleJobDelete = useCallback(
    (payload: RealtimePostgresChangesPayload<Job>) => {
      const oldJob = payload.old as Partial<Job>;
      if (oldJob.id) {
        onJobRemoveRef.current?.(oldJob.id);
      }
    },
    []
  );

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

    setConnectionStatus('connecting');
    setLastError(null);

    // Create new channel
    const channel = supabase
      .channel(CHANNEL_NAME)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'jobs',
        },
        handleJobInsert
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
        },
        handleJobUpdate
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'jobs',
        },
        handleJobDelete
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          reconnectAttemptRef.current = 0;
          setLastError(null);
        } else if (status === 'CHANNEL_ERROR') {
          setConnectionStatus('disconnected');
          setLastError(err || new Error('Channel error'));
          scheduleReconnect();
        } else if (status === 'TIMED_OUT') {
          setConnectionStatus('disconnected');
          setLastError(new Error('Connection timed out'));
          scheduleReconnect();
        } else if (status === 'CLOSED') {
          setConnectionStatus('disconnected');
        }
      });

    channelRef.current = channel;
  }, [handleJobInsert, handleJobUpdate, handleJobDelete]);

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
      setLastError(new Error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`));
      return;
    }

    setConnectionStatus('reconnecting');
    const delay = getReconnectDelay(reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;

    reconnectTimeoutRef.current = setTimeout(() => {
      setupChannel();
    }, delay);
  }, [setupChannel]);

  /**
   * Manual reconnect function
   */
  const reconnect = useCallback(() => {
    // Reset attempt counter for manual reconnect
    reconnectAttemptRef.current = 0;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setupChannel();
  }, [setupChannel]);

  /**
   * Clear new jobs count and array
   */
  const clearNewJobs = useCallback(() => {
    setNewJobCount(0);
    setNewJobs([]);
  }, []);

  /**
   * Handle visibility change - reconnect when tab becomes visible
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible
        if (connectionStatus === 'disconnected' || connectionStatus === 'reconnecting') {
          reconnect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connectionStatus, reconnect]);

  /**
   * Handle online/offline events
   */
  useEffect(() => {
    const handleOnline = () => {
      if (connectionStatus !== 'connected') {
        reconnect();
      }
    };

    const handleOffline = () => {
      setConnectionStatus('disconnected');
      setLastError(new Error('Network offline'));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [connectionStatus, reconnect]);

  /**
   * Set up channel on mount, clean up on unmount
   */
  useEffect(() => {
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
  }, [setupChannel]);

  return {
    connectionStatus,
    newJobCount,
    newJobs,
    clearNewJobs,
    reconnect,
    isConnected: connectionStatus === 'connected',
    lastError,
  };
}

export default useSupabaseRealtime;
