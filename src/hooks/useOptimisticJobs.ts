/**
 * Hook for managing optimistic UI updates for job actions
 * Provides instant feedback while server operations are in progress
 */

import { useState, useCallback, useEffect, useMemo } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export type OptimisticUpdateType = 'save' | 'unsave' | 'apply';

export interface OptimisticUpdate {
  /** Unique identifier for this update */
  id: string;
  /** Job ID this update applies to */
  jobId: string;
  /** Type of optimistic action */
  type: OptimisticUpdateType;
  /** When the update was created */
  timestamp: number;
}

export interface UseOptimisticJobsReturn {
  /** Set of job IDs that are optimistically saved */
  optimisticSaves: Set<string>;
  /** Set of job IDs that are optimistically unsaved */
  optimisticUnsaves: Set<string>;
  /** Set of job IDs that are optimistically applied */
  optimisticApplies: Set<string>;
  /** Add an optimistic save for a job (removes conflicting unsave) */
  addOptimisticSave: (jobId: string) => void;
  /** Add an optimistic unsave for a job (removes conflicting save) */
  addOptimisticUnsave: (jobId: string) => void;
  /** Add an optimistic apply for a job */
  addOptimisticApply: (jobId: string) => void;
  /** Confirm a save was successful (remove from optimistic state) */
  confirmSave: (jobId: string) => void;
  /** Confirm an unsave was successful */
  confirmUnsave: (jobId: string) => void;
  /** Confirm an apply was successful */
  confirmApply: (jobId: string) => void;
  /** Revert a save (server failed) */
  revertSave: (jobId: string) => void;
  /** Revert an unsave (server failed) */
  revertUnsave: (jobId: string) => void;
  /** Revert an apply (server failed) */
  revertApply: (jobId: string) => void;
  /** Check if a job should be shown as saved (considering optimistic state) */
  isOptimisticallySaved: (jobId: string, currentlySaved: boolean) => boolean;
  /** Check if a job should be shown as applied (considering optimistic state) */
  isOptimisticallyApplied: (jobId: string, currentlyApplied: boolean) => boolean;
  /** Get pending update count (for loading indicators) */
  pendingCount: number;
  /** Clear all optimistic updates */
  clearAll: () => void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Auto-cleanup updates older than this (in ms) */
const STALE_UPDATE_MS = 10_000; // 10 seconds

/** How often to run cleanup */
const CLEANUP_INTERVAL_MS = 5_000; // 5 seconds

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Generate a unique ID for an optimistic update
 */
function generateUpdateId(): string {
  return `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to manage optimistic UI updates for job save/unsave/apply actions
 *
 * @example
 * ```tsx
 * const {
 *   addOptimisticSave,
 *   confirmSave,
 *   revertSave,
 *   isOptimisticallySaved
 * } = useOptimisticJobs();
 *
 * async function handleSave(jobId: string) {
 *   // Immediately show as saved
 *   addOptimisticSave(jobId);
 *
 *   try {
 *     await saveJobToServer(jobId);
 *     // Server confirmed, remove from optimistic state
 *     confirmSave(jobId);
 *   } catch (error) {
 *     // Server failed, revert the optimistic update
 *     revertSave(jobId);
 *     showError('Failed to save job');
 *   }
 * }
 *
 * // In render:
 * const isSaved = isOptimisticallySaved(job.id, job.is_saved);
 * ```
 */
export function useOptimisticJobs(): UseOptimisticJobsReturn {
  const [updates, setUpdates] = useState<OptimisticUpdate[]>([]);

  // Auto-cleanup stale updates
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setUpdates((prev) => {
        const filtered = prev.filter(
          (update) => now - update.timestamp < STALE_UPDATE_MS
        );
        // Only update if something was removed
        return filtered.length !== prev.length ? filtered : prev;
      });
    }, CLEANUP_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Computed sets for each update type
  const optimisticSaves = useMemo(() => {
    return new Set(
      updates.filter((u) => u.type === 'save').map((u) => u.jobId)
    );
  }, [updates]);

  const optimisticUnsaves = useMemo(() => {
    return new Set(
      updates.filter((u) => u.type === 'unsave').map((u) => u.jobId)
    );
  }, [updates]);

  const optimisticApplies = useMemo(() => {
    return new Set(
      updates.filter((u) => u.type === 'apply').map((u) => u.jobId)
    );
  }, [updates]);

  /**
   * Add an optimistic update, removing any conflicting updates for the same job
   */
  const addUpdate = useCallback(
    (jobId: string, type: OptimisticUpdateType, conflictingTypes: OptimisticUpdateType[]) => {
      setUpdates((prev) => {
        // Remove any conflicting updates for this job
        const filtered = prev.filter(
          (u) => u.jobId !== jobId || !conflictingTypes.includes(u.type)
        );

        // Add the new update
        return [
          ...filtered,
          {
            id: generateUpdateId(),
            jobId,
            type,
            timestamp: Date.now(),
          },
        ];
      });
    },
    []
  );

  /**
   * Remove an update by job ID and type
   */
  const removeUpdate = useCallback(
    (jobId: string, type: OptimisticUpdateType) => {
      setUpdates((prev) =>
        prev.filter((u) => !(u.jobId === jobId && u.type === type))
      );
    },
    []
  );

  // =============================================================================
  // PUBLIC METHODS
  // =============================================================================

  const addOptimisticSave = useCallback(
    (jobId: string) => {
      addUpdate(jobId, 'save', ['unsave']); // Saving removes any pending unsave
    },
    [addUpdate]
  );

  const addOptimisticUnsave = useCallback(
    (jobId: string) => {
      addUpdate(jobId, 'unsave', ['save']); // Unsaving removes any pending save
    },
    [addUpdate]
  );

  const addOptimisticApply = useCallback(
    (jobId: string) => {
      // Applying also implies saving, so add save if not already saved
      addUpdate(jobId, 'apply', []);
    },
    [addUpdate]
  );

  const confirmSave = useCallback(
    (jobId: string) => {
      removeUpdate(jobId, 'save');
    },
    [removeUpdate]
  );

  const confirmUnsave = useCallback(
    (jobId: string) => {
      removeUpdate(jobId, 'unsave');
    },
    [removeUpdate]
  );

  const confirmApply = useCallback(
    (jobId: string) => {
      removeUpdate(jobId, 'apply');
    },
    [removeUpdate]
  );

  const revertSave = useCallback(
    (jobId: string) => {
      removeUpdate(jobId, 'save');
    },
    [removeUpdate]
  );

  const revertUnsave = useCallback(
    (jobId: string) => {
      removeUpdate(jobId, 'unsave');
    },
    [removeUpdate]
  );

  const revertApply = useCallback(
    (jobId: string) => {
      removeUpdate(jobId, 'apply');
    },
    [removeUpdate]
  );

  /**
   * Determine if a job should be displayed as saved
   * Takes into account both current server state and optimistic updates
   */
  const isOptimisticallySaved = useCallback(
    (jobId: string, currentlySaved: boolean): boolean => {
      // Check for optimistic save (should show as saved)
      if (optimisticSaves.has(jobId)) {
        return true;
      }

      // Check for optimistic unsave (should show as not saved)
      if (optimisticUnsaves.has(jobId)) {
        return false;
      }

      // No optimistic update, use current server state
      return currentlySaved;
    },
    [optimisticSaves, optimisticUnsaves]
  );

  /**
   * Determine if a job should be displayed as applied
   */
  const isOptimisticallyApplied = useCallback(
    (jobId: string, currentlyApplied: boolean): boolean => {
      // Check for optimistic apply
      if (optimisticApplies.has(jobId)) {
        return true;
      }

      // No optimistic update, use current server state
      return currentlyApplied;
    },
    [optimisticApplies]
  );

  const clearAll = useCallback(() => {
    setUpdates([]);
  }, []);

  const pendingCount = updates.length;

  return {
    optimisticSaves,
    optimisticUnsaves,
    optimisticApplies,
    addOptimisticSave,
    addOptimisticUnsave,
    addOptimisticApply,
    confirmSave,
    confirmUnsave,
    confirmApply,
    revertSave,
    revertUnsave,
    revertApply,
    isOptimisticallySaved,
    isOptimisticallyApplied,
    pendingCount,
    clearAll,
  };
}

export default useOptimisticJobs;
