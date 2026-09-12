/**
 * Hook that tracks user milestones and triggers celebrations
 * Stores achieved milestones in localStorage to show each celebration only once
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'newgrad-radar-milestones';

/**
 * Available milestone types
 */
export type MilestoneType =
  | 'firstApplication'
  | 'tenApplications'
  | 'twentyFiveApplications'
  | 'fiftyApplications'
  | 'hundredApplications'
  | 'firstInterview'
  | 'fiveInterviews'
  | 'firstOffer'
  | 'sevenDayStreak'
  | 'fourteenDayStreak'
  | 'thirtyDayStreak'
  | 'firstSavedJob'
  | 'tenSavedJobs'
  | 'firstCompanyTracked';

/**
 * Milestone metadata for display
 */
export interface MilestoneInfo {
  id: MilestoneType;
  title: string;
  message: string;
  emoji: string;
  threshold?: number;
  category: 'applications' | 'interviews' | 'offers' | 'streaks' | 'engagement';
}

/**
 * All available milestones with their display info
 */
export const MILESTONES: Record<MilestoneType, MilestoneInfo> = {
  firstApplication: {
    id: 'firstApplication',
    title: 'First Step',
    message: 'You submitted your first application!',
    emoji: '🚀',
    threshold: 1,
    category: 'applications',
  },
  tenApplications: {
    id: 'tenApplications',
    title: 'Getting Started',
    message: 'You hit 10 applications!',
    emoji: '🎯',
    threshold: 10,
    category: 'applications',
  },
  twentyFiveApplications: {
    id: 'twentyFiveApplications',
    title: 'Momentum Builder',
    message: 'You hit 25 applications!',
    emoji: '💪',
    threshold: 25,
    category: 'applications',
  },
  fiftyApplications: {
    id: 'fiftyApplications',
    title: 'Dedicated Applicant',
    message: 'You hit 50 applications!',
    emoji: '🔥',
    threshold: 50,
    category: 'applications',
  },
  hundredApplications: {
    id: 'hundredApplications',
    title: 'Application Master',
    message: 'You hit 100 applications!',
    emoji: '🏆',
    threshold: 100,
    category: 'applications',
  },
  firstInterview: {
    id: 'firstInterview',
    title: 'Interview Unlocked',
    message: 'You got your first interview!',
    emoji: '🎤',
    threshold: 1,
    category: 'interviews',
  },
  fiveInterviews: {
    id: 'fiveInterviews',
    title: 'Interview Pro',
    message: 'You have 5 interviews scheduled!',
    emoji: '⭐',
    threshold: 5,
    category: 'interviews',
  },
  firstOffer: {
    id: 'firstOffer',
    title: 'Offer Received',
    message: 'Congratulations on your first offer!',
    emoji: '🎉',
    threshold: 1,
    category: 'offers',
  },
  sevenDayStreak: {
    id: 'sevenDayStreak',
    title: 'Week Warrior',
    message: '7-day application streak!',
    emoji: '📅',
    threshold: 7,
    category: 'streaks',
  },
  fourteenDayStreak: {
    id: 'fourteenDayStreak',
    title: 'Two Week Champion',
    message: '14-day application streak!',
    emoji: '🌟',
    threshold: 14,
    category: 'streaks',
  },
  thirtyDayStreak: {
    id: 'thirtyDayStreak',
    title: 'Monthly Master',
    message: '30-day application streak!',
    emoji: '👑',
    threshold: 30,
    category: 'streaks',
  },
  firstSavedJob: {
    id: 'firstSavedJob',
    title: 'Job Hunter',
    message: 'You saved your first job!',
    emoji: '📌',
    threshold: 1,
    category: 'engagement',
  },
  tenSavedJobs: {
    id: 'tenSavedJobs',
    title: 'Organized Hunter',
    message: 'You have 10 saved jobs!',
    emoji: '📋',
    threshold: 10,
    category: 'engagement',
  },
  firstCompanyTracked: {
    id: 'firstCompanyTracked',
    title: 'Company Tracker',
    message: 'You tracked your first company!',
    emoji: '🏢',
    threshold: 1,
    category: 'engagement',
  },
};

/**
 * Stored milestone data
 */
interface MilestoneData {
  achieved: Record<MilestoneType, string | null>; // ISO date string or null
  lastCelebrated: MilestoneType | null;
}

const DEFAULT_MILESTONE_DATA: MilestoneData = {
  achieved: {
    firstApplication: null,
    tenApplications: null,
    twentyFiveApplications: null,
    fiftyApplications: null,
    hundredApplications: null,
    firstInterview: null,
    fiveInterviews: null,
    firstOffer: null,
    sevenDayStreak: null,
    fourteenDayStreak: null,
    thirtyDayStreak: null,
    firstSavedJob: null,
    tenSavedJobs: null,
    firstCompanyTracked: null,
  },
  lastCelebrated: null,
};

/**
 * Load milestone data from localStorage
 */
function loadMilestoneData(): MilestoneData {
  if (typeof window === 'undefined') {
    return DEFAULT_MILESTONE_DATA;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_MILESTONE_DATA;
    }
    const parsed = JSON.parse(stored);
    return {
      achieved: { ...DEFAULT_MILESTONE_DATA.achieved, ...parsed.achieved },
      lastCelebrated: parsed.lastCelebrated ?? null,
    };
  } catch {
    return DEFAULT_MILESTONE_DATA;
  }
}

/**
 * Save milestone data to localStorage
 */
function saveMilestoneData(data: MilestoneData): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    console.warn('Failed to save milestone data to localStorage');
  }
}

export interface UseMilestonesReturn {
  /** Check if a milestone is achieved (and optionally celebrate) */
  checkAndCelebrate: (milestone: MilestoneType) => boolean;
  /** Check milestone based on a count (auto-selects appropriate milestone) */
  checkApplicationCount: (count: number) => MilestoneType | null;
  /** Check streak milestones */
  checkStreakCount: (days: number) => MilestoneType | null;
  /** Check interview count */
  checkInterviewCount: (count: number) => MilestoneType | null;
  /** Mark a milestone as achieved without checking */
  achieveMilestone: (milestone: MilestoneType) => boolean;
  /** Check if a milestone has been achieved */
  isAchieved: (milestone: MilestoneType) => boolean;
  /** Get all achieved milestones */
  achievedMilestones: MilestoneType[];
  /** Get milestone info */
  getMilestoneInfo: (milestone: MilestoneType) => MilestoneInfo;
  /** Get the last celebrated milestone (for showing toast) */
  lastCelebrated: MilestoneType | null;
  /** Clear last celebrated (after toast is shown) */
  clearLastCelebrated: () => void;
  /** Reset all milestones (for testing) */
  resetMilestones: () => void;
  /** Get achievement date for a milestone */
  getAchievementDate: (milestone: MilestoneType) => Date | null;
}

/**
 * Hook to track and celebrate user milestones
 *
 * @example
 * ```tsx
 * const { checkAndCelebrate, lastCelebrated, clearLastCelebrated } = useMilestones();
 *
 * // When user submits an application
 * const handleSubmit = () => {
 *   submitApplication();
 *   const newTotal = getApplicationCount();
 *   checkApplicationCount(newTotal);
 * };
 *
 * // Show toast for milestone
 * useEffect(() => {
 *   if (lastCelebrated) {
 *     showMilestoneToast(lastCelebrated);
 *     clearLastCelebrated();
 *   }
 * }, [lastCelebrated]);
 * ```
 */
export function useMilestones(): UseMilestonesReturn {
  const [data, setData] = useState<MilestoneData>(DEFAULT_MILESTONE_DATA);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const loaded = loadMilestoneData();
    setData(loaded);
    setIsInitialized(true);
  }, []);

  // Save to localStorage whenever data changes
  useEffect(() => {
    if (isInitialized) {
      saveMilestoneData(data);
    }
  }, [data, isInitialized]);

  /**
   * Check if a milestone should be celebrated and mark it as achieved
   * Returns true if this is a NEW milestone (not previously achieved)
   */
  const checkAndCelebrate = useCallback((milestone: MilestoneType): boolean => {
    // Check if already achieved
    if (data.achieved[milestone]) {
      return false;
    }

    // Mark as achieved
    setData((prev) => ({
      achieved: {
        ...prev.achieved,
        [milestone]: new Date().toISOString(),
      },
      lastCelebrated: milestone,
    }));

    return true;
  }, [data.achieved]);

  /**
   * Mark a milestone as achieved without the celebration check
   * Returns true if this was a new achievement
   */
  const achieveMilestone = useCallback((milestone: MilestoneType): boolean => {
    if (data.achieved[milestone]) {
      return false;
    }

    setData((prev) => ({
      achieved: {
        ...prev.achieved,
        [milestone]: new Date().toISOString(),
      },
      lastCelebrated: milestone,
    }));

    return true;
  }, [data.achieved]);

  /**
   * Check application count and trigger appropriate milestone
   */
  const checkApplicationCount = useCallback((count: number): MilestoneType | null => {
    const milestones: { type: MilestoneType; threshold: number }[] = [
      { type: 'hundredApplications', threshold: 100 },
      { type: 'fiftyApplications', threshold: 50 },
      { type: 'twentyFiveApplications', threshold: 25 },
      { type: 'tenApplications', threshold: 10 },
      { type: 'firstApplication', threshold: 1 },
    ];

    for (const { type, threshold } of milestones) {
      if (count >= threshold && !data.achieved[type]) {
        setData((prev) => ({
          achieved: {
            ...prev.achieved,
            [type]: new Date().toISOString(),
          },
          lastCelebrated: type,
        }));
        return type;
      }
    }

    return null;
  }, [data.achieved]);

  /**
   * Check streak and trigger appropriate milestone
   */
  const checkStreakCount = useCallback((days: number): MilestoneType | null => {
    const milestones: { type: MilestoneType; threshold: number }[] = [
      { type: 'thirtyDayStreak', threshold: 30 },
      { type: 'fourteenDayStreak', threshold: 14 },
      { type: 'sevenDayStreak', threshold: 7 },
    ];

    for (const { type, threshold } of milestones) {
      if (days >= threshold && !data.achieved[type]) {
        setData((prev) => ({
          achieved: {
            ...prev.achieved,
            [type]: new Date().toISOString(),
          },
          lastCelebrated: type,
        }));
        return type;
      }
    }

    return null;
  }, [data.achieved]);

  /**
   * Check interview count and trigger appropriate milestone
   */
  const checkInterviewCount = useCallback((count: number): MilestoneType | null => {
    const milestones: { type: MilestoneType; threshold: number }[] = [
      { type: 'fiveInterviews', threshold: 5 },
      { type: 'firstInterview', threshold: 1 },
    ];

    for (const { type, threshold } of milestones) {
      if (count >= threshold && !data.achieved[type]) {
        setData((prev) => ({
          achieved: {
            ...prev.achieved,
            [type]: new Date().toISOString(),
          },
          lastCelebrated: type,
        }));
        return type;
      }
    }

    return null;
  }, [data.achieved]);

  /**
   * Check if a milestone has been achieved
   */
  const isAchieved = useCallback((milestone: MilestoneType): boolean => {
    return data.achieved[milestone] !== null;
  }, [data.achieved]);

  /**
   * Get list of all achieved milestones
   */
  const achievedMilestones = useMemo((): MilestoneType[] => {
    return (Object.entries(data.achieved) as [MilestoneType, string | null][])
      .filter(([, date]) => date !== null)
      .map(([type]) => type);
  }, [data.achieved]);

  /**
   * Get milestone info
   */
  const getMilestoneInfo = useCallback((milestone: MilestoneType): MilestoneInfo => {
    return MILESTONES[milestone];
  }, []);

  /**
   * Clear the last celebrated milestone
   */
  const clearLastCelebrated = useCallback((): void => {
    setData((prev) => ({
      ...prev,
      lastCelebrated: null,
    }));
  }, []);

  /**
   * Reset all milestones
   */
  const resetMilestones = useCallback((): void => {
    setData(DEFAULT_MILESTONE_DATA);
  }, []);

  /**
   * Get achievement date for a milestone
   */
  const getAchievementDate = useCallback((milestone: MilestoneType): Date | null => {
    const dateStr = data.achieved[milestone];
    return dateStr ? new Date(dateStr) : null;
  }, [data.achieved]);

  return {
    checkAndCelebrate,
    checkApplicationCount,
    checkStreakCount,
    checkInterviewCount,
    achieveMilestone,
    isAchieved,
    achievedMilestones,
    getMilestoneInfo,
    lastCelebrated: data.lastCelebrated,
    clearLastCelebrated,
    resetMilestones,
    getAchievementDate,
  };
}

export default useMilestones;
