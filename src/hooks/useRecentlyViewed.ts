/**
 * Hook that manages recently viewed jobs and last search query
 * Persists data to localStorage for "Continue where you left off" feature
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Job } from '@/lib/types';

const RECENTLY_VIEWED_KEY = 'newgrad-radar-recently-viewed';
const LAST_SEARCH_KEY = 'newgrad-radar-last-search';
const MAX_RECENTLY_VIEWED = 5;

export interface RecentlyViewedJob {
  /** Job ID */
  id: string;
  /** Job title */
  title: string;
  /** Company name */
  companyName: string;
  /** Company slug for logo/linking */
  companySlug: string;
  /** Logo URL if available */
  logoUrl?: string | null;
  /** Job URL */
  url: string;
  /** When the job was viewed (ISO string) */
  viewedAt: string;
}

export interface LastSearch {
  /** The search query */
  query: string;
  /** When the search was performed (ISO string) */
  searchedAt: string;
}

export interface RecentlyViewedData {
  /** List of recently viewed jobs */
  recentlyViewed: RecentlyViewedJob[];
  /** Last search query */
  lastSearch: LastSearch | null;
}

export interface UseRecentlyViewedReturn {
  /** Recently viewed jobs (most recent first) */
  recentlyViewed: RecentlyViewedJob[];
  /** Last search query */
  lastSearch: LastSearch | null;
  /** Add a job to recently viewed */
  addRecentlyViewed: (job: Job | RecentlyViewedJob) => void;
  /** Save a search query */
  saveSearch: (query: string) => void;
  /** Remove a specific job from recently viewed */
  removeRecentlyViewed: (jobId: string) => void;
  /** Clear all history (recently viewed and last search) */
  clearHistory: () => void;
  /** Clear only recently viewed */
  clearRecentlyViewed: () => void;
  /** Clear only last search */
  clearLastSearch: () => void;
  /** Check if there's any history to show */
  hasHistory: boolean;
}

const DEFAULT_DATA: RecentlyViewedData = {
  recentlyViewed: [],
  lastSearch: null,
};

/**
 * Load recently viewed data from localStorage
 */
function loadRecentlyViewedData(): RecentlyViewedData {
  if (typeof window === 'undefined') {
    return DEFAULT_DATA;
  }

  try {
    const viewedStored = localStorage.getItem(RECENTLY_VIEWED_KEY);
    const searchStored = localStorage.getItem(LAST_SEARCH_KEY);

    const recentlyViewed: RecentlyViewedJob[] = viewedStored
      ? JSON.parse(viewedStored)
      : [];
    const lastSearch: LastSearch | null = searchStored
      ? JSON.parse(searchStored)
      : null;

    return { recentlyViewed, lastSearch };
  } catch {
    return DEFAULT_DATA;
  }
}

/**
 * Save recently viewed jobs to localStorage
 */
function saveRecentlyViewed(jobs: RecentlyViewedJob[]): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(jobs));
  } catch {
    console.warn('Failed to save recently viewed jobs to localStorage');
  }
}

/**
 * Save last search to localStorage
 */
function saveLastSearch(search: LastSearch | null): void {
  if (typeof window === 'undefined') return;

  try {
    if (search) {
      localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(search));
    } else {
      localStorage.removeItem(LAST_SEARCH_KEY);
    }
  } catch {
    console.warn('Failed to save last search to localStorage');
  }
}

/**
 * Convert a Job to a RecentlyViewedJob
 */
function jobToRecentlyViewed(job: Job | RecentlyViewedJob): RecentlyViewedJob {
  // If it's already a RecentlyViewedJob format, use it
  if ('viewedAt' in job) {
    return {
      ...job,
      viewedAt: new Date().toISOString(),
    };
  }

  // Convert from Job type
  return {
    id: job.id,
    title: job.title,
    companyName: job.company_name,
    companySlug: job.company_slug,
    url: job.url,
    viewedAt: new Date().toISOString(),
  };
}

/**
 * Hook to manage recently viewed jobs and last search query
 *
 * @example
 * ```tsx
 * const { recentlyViewed, lastSearch, addRecentlyViewed, saveSearch, clearHistory } = useRecentlyViewed();
 *
 * // When user views a job
 * addRecentlyViewed(job);
 *
 * // When user searches
 * saveSearch('ML Engineer');
 *
 * return (
 *   <div>
 *     {recentlyViewed.map(job => (
 *       <JobChip key={job.id} job={job} />
 *     ))}
 *     {lastSearch && <span>Last search: {lastSearch.query}</span>}
 *     <button onClick={clearHistory}>Clear history</button>
 *   </div>
 * );
 * ```
 */
export function useRecentlyViewed(): UseRecentlyViewedReturn {
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedJob[]>([]);
  const [lastSearch, setLastSearch] = useState<LastSearch | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const data = loadRecentlyViewedData();
    setRecentlyViewed(data.recentlyViewed);
    setLastSearch(data.lastSearch);
    setIsInitialized(true);
  }, []);

  // Save recently viewed to localStorage when it changes
  useEffect(() => {
    if (isInitialized) {
      saveRecentlyViewed(recentlyViewed);
    }
  }, [recentlyViewed, isInitialized]);

  // Save last search to localStorage when it changes
  useEffect(() => {
    if (isInitialized) {
      saveLastSearch(lastSearch);
    }
  }, [lastSearch, isInitialized]);

  /**
   * Add a job to the recently viewed list
   */
  const addRecentlyViewed = useCallback((job: Job | RecentlyViewedJob): void => {
    setRecentlyViewed((prev) => {
      const recentJob = jobToRecentlyViewed(job);

      // Remove if already exists (will be re-added at front)
      const filtered = prev.filter((j) => j.id !== recentJob.id);

      // Add to front and limit to max
      const updated = [recentJob, ...filtered].slice(0, MAX_RECENTLY_VIEWED);

      return updated;
    });
  }, []);

  /**
   * Save a search query
   */
  const saveSearch = useCallback((query: string): void => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLastSearch({
      query: trimmed,
      searchedAt: new Date().toISOString(),
    });
  }, []);

  /**
   * Remove a specific job from recently viewed
   */
  const removeRecentlyViewed = useCallback((jobId: string): void => {
    setRecentlyViewed((prev) => prev.filter((job) => job.id !== jobId));
  }, []);

  /**
   * Clear all history
   */
  const clearHistory = useCallback((): void => {
    setRecentlyViewed([]);
    setLastSearch(null);
  }, []);

  /**
   * Clear only recently viewed
   */
  const clearRecentlyViewed = useCallback((): void => {
    setRecentlyViewed([]);
  }, []);

  /**
   * Clear only last search
   */
  const clearLastSearch = useCallback((): void => {
    setLastSearch(null);
  }, []);

  /**
   * Check if there's any history
   */
  const hasHistory = useMemo(() => {
    return recentlyViewed.length > 0 || lastSearch !== null;
  }, [recentlyViewed, lastSearch]);

  return {
    recentlyViewed,
    lastSearch,
    addRecentlyViewed,
    saveSearch,
    removeRecentlyViewed,
    clearHistory,
    clearRecentlyViewed,
    clearLastSearch,
    hasHistory,
  };
}

export default useRecentlyViewed;
