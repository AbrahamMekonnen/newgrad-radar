/**
 * Hook for fetching and managing job filter counts
 * Provides counts of active jobs by tier, role, and sponsorship status
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Tier, RoleType, SponsorshipStatus, Job } from '@/lib/types';

// =============================================================================
// TYPES
// =============================================================================

export interface FilterCounts {
  /** Count of jobs by tier */
  tiers: Record<Tier, number>;
  /** Count of jobs by role type */
  roles: Record<RoleType, number>;
  /** Count of jobs by sponsorship status */
  sponsorship: Record<SponsorshipStatus, number>;
  /** Total number of active jobs */
  total: number;
}

export interface UseJobFilterCountsOptions {
  /** Enable real-time updates via Supabase subscription */
  realtime?: boolean;
  /** Debounce delay for real-time updates (ms) */
  debounceMs?: number;
}

export interface UseJobFilterCountsReturn {
  /** Current filter counts */
  counts: FilterCounts;
  /** Whether the initial fetch is loading */
  loading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Manually refresh the counts */
  refresh: () => Promise<void>;
  /** Whether a refresh is in progress */
  refreshing: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_DEBOUNCE_MS = 500;

const ALL_TIERS: Tier[] = ['faang', 'ai', 'unicorn', 'yc', 'fintech', 'infra'];
const ALL_ROLES: RoleType[] = [
  'swe',
  'ml',
  'backend',
  'frontend',
  'fullstack',
  'infra',
  'data',
  'security',
  'mobile',
];
const ALL_SPONSORSHIPS: SponsorshipStatus[] = ['sponsors', 'no_sponsor', 'unknown'];

const EMPTY_COUNTS: FilterCounts = {
  tiers: {
    faang: 0,
    ai: 0,
    unicorn: 0,
    yc: 0,
    fintech: 0,
    infra: 0,
    other: 0,
  },
  roles: {
    swe: 0,
    ml: 0,
    backend: 0,
    frontend: 0,
    fullstack: 0,
    infra: 0,
    data: 0,
    security: 0,
    mobile: 0,
  },
  sponsorship: {
    sponsors: 0,
    no_sponsor: 0,
    unknown: 0,
  },
  total: 0,
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Calculate counts from an array of jobs
 */
function calculateCounts(jobs: Partial<Job>[]): FilterCounts {
  const counts: FilterCounts = {
    tiers: { ...EMPTY_COUNTS.tiers },
    roles: { ...EMPTY_COUNTS.roles },
    sponsorship: { ...EMPTY_COUNTS.sponsorship },
    total: jobs.length,
  };

  for (const job of jobs) {
    // Count by tier
    const tier = job.tier as Tier;
    if (tier && ALL_TIERS.includes(tier)) {
      counts.tiers[tier]++;
    }

    // Count by role types (a job can have multiple roles)
    const roleTypes = job.role_types || [];
    for (const role of roleTypes) {
      if (ALL_ROLES.includes(role as RoleType)) {
        counts.roles[role as RoleType]++;
      }
    }

    // Count by sponsorship status
    const sponsorship = job.sponsorship_status || 'unknown';
    if (ALL_SPONSORSHIPS.includes(sponsorship as SponsorshipStatus)) {
      counts.sponsorship[sponsorship as SponsorshipStatus]++;
    }
  }

  return counts;
}

/**
 * Create a debounced function
 */
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): { call: (...args: Parameters<T>) => void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return {
    call: (...args: Parameters<T>) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        fn(...args);
        timeoutId = null;
      }, delay);
    },
    cancel: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to fetch and manage job filter counts
 *
 * @param options - Configuration options
 * @returns Filter counts, loading state, and refresh function
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { counts, loading, refresh } = useJobFilterCounts();
 *
 * // With real-time updates
 * const { counts, loading } = useJobFilterCounts({ realtime: true });
 *
 * // With custom debounce
 * const { counts } = useJobFilterCounts({ realtime: true, debounceMs: 1000 });
 *
 * return (
 *   <div>
 *     {loading ? (
 *       <Skeleton />
 *     ) : (
 *       <>
 *         <Badge>FAANG: {counts.tiers.faang}</Badge>
 *         <Badge>AI: {counts.tiers.ai}</Badge>
 *         <Badge>SWE: {counts.roles.swe}</Badge>
 *         <Badge>Total: {counts.total}</Badge>
 *       </>
 *     )}
 *     <button onClick={refresh}>Refresh</button>
 *   </div>
 * );
 * ```
 */
export function useJobFilterCounts(
  options: UseJobFilterCountsOptions = {}
): UseJobFilterCountsReturn {
  const { realtime = false, debounceMs = DEFAULT_DEBOUNCE_MS } = options;

  const [counts, setCounts] = useState<FilterCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Keep track of whether component is mounted
  const isMounted = useRef(true);

  // Create debounced refresh for real-time updates
  const debouncedRefresh = useMemo(
    () =>
      debounce(() => {
        if (isMounted.current) {
          fetchCounts();
        }
      }, debounceMs),
    [debounceMs]
  );

  /**
   * Fetch job counts from Supabase
   */
  const fetchCounts = useCallback(async () => {
    try {
      const supabase = createClient();

      // Fetch only the fields we need for counting
      const { data, error: fetchError } = await supabase
        .from('jobs')
        .select('tier, role_types, sponsorship_status')
        .eq('is_active', true)
        .neq('is_job', false); // exclude enricher-flagged non-jobs

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (isMounted.current) {
        const newCounts = calculateCounts(data || []);
        setCounts(newCounts);
        setError(null);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err : new Error('Failed to fetch counts'));
      }
    }
  }, []);

  /**
   * Initial fetch
   */
  useEffect(() => {
    let cancelled = false;

    async function initialFetch() {
      setLoading(true);
      await fetchCounts();
      if (!cancelled && isMounted.current) {
        setLoading(false);
      }
    }

    initialFetch();

    return () => {
      cancelled = true;
    };
  }, [fetchCounts]);

  /**
   * Set up real-time subscription
   */
  useEffect(() => {
    if (!realtime) {
      return;
    }

    const supabase = createClient();

    // Subscribe to changes on the jobs table
    const channel = supabase
      .channel('jobs-filter-counts')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
        },
        () => {
          // Debounce the refresh to avoid too many updates
          debouncedRefresh.call();
        }
      )
      .subscribe();

    return () => {
      debouncedRefresh.cancel();
      supabase.removeChannel(channel);
    };
  }, [realtime, debouncedRefresh]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      isMounted.current = false;
      debouncedRefresh.cancel();
    };
  }, [debouncedRefresh]);

  /**
   * Manual refresh function
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchCounts();
    if (isMounted.current) {
      setRefreshing(false);
    }
  }, [fetchCounts]);

  return {
    counts,
    loading,
    error,
    refresh,
    refreshing,
  };
}

export default useJobFilterCounts;
