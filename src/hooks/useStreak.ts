/**
 * Hook that manages user's application streak
 * Tracks consecutive days of job applications to encourage engagement
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'newgrad-radar-streak';

export interface StreakData {
  /** Last date an application was submitted (ISO string) */
  lastApplicationDate: string | null;
  /** Current streak count in days */
  streakCount: number;
  /** Longest streak ever achieved */
  longestStreak: number;
  /** Total applications submitted */
  totalApplications: number;
}

export interface UseStreakReturn {
  /** Current streak in days */
  days: number;
  /** Whether the streak is currently active (application submitted today or yesterday) */
  isActive: boolean;
  /** Percentile among users (simulated based on streak length) */
  percentile: number;
  /** Longest streak ever achieved */
  longestStreak: number;
  /** Total applications submitted */
  totalApplications: number;
  /** Check if streak is still valid and update state */
  checkStreak: () => boolean;
  /** Increment the streak (call when user submits an application) */
  incrementStreak: () => void;
  /** Get the raw streak data */
  getStreakData: () => StreakData;
  /** Reset the streak (for testing or user request) */
  resetStreak: () => void;
  /** Days until streak expires (0 if already expired, 1-2 if active) */
  daysUntilExpiry: number;
  /** Whether user has applied today */
  appliedToday: boolean;
}

const DEFAULT_STREAK_DATA: StreakData = {
  lastApplicationDate: null,
  streakCount: 0,
  longestStreak: 0,
  totalApplications: 0,
};

/**
 * Get the start of a day (midnight) for date comparison
 */
function getDateStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Calculate days between two dates (ignoring time)
 */
function daysBetween(date1: Date, date2: Date): number {
  const d1 = getDateStart(date1);
  const d2 = getDateStart(date2);
  const diffMs = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate percentile based on streak length
 * Based on typical user engagement patterns
 */
function calculatePercentile(streakDays: number): number {
  if (streakDays === 0) return 0;
  if (streakDays === 1) return 50;
  if (streakDays === 2) return 65;
  if (streakDays === 3) return 75;
  if (streakDays <= 5) return 80;
  if (streakDays <= 7) return 85;
  if (streakDays <= 14) return 90;
  if (streakDays <= 30) return 95;
  if (streakDays <= 60) return 98;
  return 99;
}

/**
 * Load streak data from localStorage
 */
function loadStreakData(): StreakData {
  if (typeof window === 'undefined') {
    return DEFAULT_STREAK_DATA;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_STREAK_DATA;
    }
    const parsed = JSON.parse(stored);
    return {
      lastApplicationDate: parsed.lastApplicationDate ?? null,
      streakCount: parsed.streakCount ?? 0,
      longestStreak: parsed.longestStreak ?? 0,
      totalApplications: parsed.totalApplications ?? 0,
    };
  } catch {
    return DEFAULT_STREAK_DATA;
  }
}

/**
 * Save streak data to localStorage
 */
function saveStreakData(data: StreakData): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    console.warn('Failed to save streak data to localStorage');
  }
}

/**
 * Hook to manage user's application streak
 *
 * @example
 * ```tsx
 * const { days, isActive, percentile, incrementStreak } = useStreak();
 *
 * return (
 *   <div>
 *     <span>{days} day streak</span>
 *     {isActive && <span>Top {100 - percentile}%!</span>}
 *     <button onClick={incrementStreak}>Log Application</button>
 *   </div>
 * );
 * ```
 */
export function useStreak(): UseStreakReturn {
  const [streakData, setStreakData] = useState<StreakData>(DEFAULT_STREAK_DATA);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const data = loadStreakData();
    setStreakData(data);
    setIsInitialized(true);
  }, []);

  // Save to localStorage whenever data changes (after initialization)
  useEffect(() => {
    if (isInitialized) {
      saveStreakData(streakData);
    }
  }, [streakData, isInitialized]);

  /**
   * Check if the streak is still valid
   */
  const checkStreak = useCallback((): boolean => {
    if (!streakData.lastApplicationDate) {
      return false;
    }

    const lastDate = new Date(streakData.lastApplicationDate);
    const today = new Date();
    const daysDiff = daysBetween(lastDate, today);

    // Streak is valid if applied today or yesterday
    if (daysDiff <= 1) {
      return true;
    }

    // Streak has expired - reset
    setStreakData(prev => ({
      ...prev,
      streakCount: 0,
    }));
    return false;
  }, [streakData.lastApplicationDate]);

  /**
   * Increment the streak when user submits an application
   */
  const incrementStreak = useCallback((): void => {
    const today = new Date();
    const todayIso = today.toISOString();

    setStreakData(prev => {
      // Check if already applied today
      if (prev.lastApplicationDate) {
        const lastDate = new Date(prev.lastApplicationDate);
        const daysDiff = daysBetween(lastDate, today);

        if (daysDiff === 0) {
          // Already applied today, just increment total
          return {
            ...prev,
            totalApplications: prev.totalApplications + 1,
          };
        }

        if (daysDiff === 1) {
          // Continue the streak
          const newStreak = prev.streakCount + 1;
          return {
            lastApplicationDate: todayIso,
            streakCount: newStreak,
            longestStreak: Math.max(prev.longestStreak, newStreak),
            totalApplications: prev.totalApplications + 1,
          };
        }

        // Streak was broken, start fresh
        return {
          lastApplicationDate: todayIso,
          streakCount: 1,
          longestStreak: Math.max(prev.longestStreak, 1),
          totalApplications: prev.totalApplications + 1,
        };
      }

      // First application ever
      return {
        lastApplicationDate: todayIso,
        streakCount: 1,
        longestStreak: Math.max(prev.longestStreak, 1),
        totalApplications: 1,
      };
    });
  }, []);

  /**
   * Get raw streak data
   */
  const getStreakData = useCallback((): StreakData => {
    return { ...streakData };
  }, [streakData]);

  /**
   * Reset streak data
   */
  const resetStreak = useCallback((): void => {
    setStreakData(DEFAULT_STREAK_DATA);
  }, []);

  // Calculate derived values
  const derivedValues = useMemo(() => {
    const today = new Date();

    let isActive = false;
    let daysUntilExpiry = 0;
    let appliedToday = false;
    let currentStreak = streakData.streakCount;

    if (streakData.lastApplicationDate) {
      const lastDate = new Date(streakData.lastApplicationDate);
      const daysDiff = daysBetween(lastDate, today);

      if (daysDiff === 0) {
        // Applied today
        isActive = true;
        appliedToday = true;
        daysUntilExpiry = 2; // Has today and tomorrow
      } else if (daysDiff === 1) {
        // Applied yesterday
        isActive = true;
        daysUntilExpiry = 1; // Must apply today
      } else {
        // Streak expired
        currentStreak = 0;
      }
    }

    return {
      days: currentStreak,
      isActive,
      percentile: calculatePercentile(currentStreak),
      daysUntilExpiry,
      appliedToday,
    };
  }, [streakData]);

  return {
    ...derivedValues,
    longestStreak: streakData.longestStreak,
    totalApplications: streakData.totalApplications,
    checkStreak,
    incrementStreak,
    getStreakData,
    resetStreak,
  };
}

export default useStreak;
