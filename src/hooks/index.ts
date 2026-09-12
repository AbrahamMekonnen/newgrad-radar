/**
 * Custom React hooks for the job board
 */

export { useAnimatedNumber, useAnimatedNumberWithState, easings } from './useAnimatedNumber';
export type { UseAnimatedNumberOptions } from './useAnimatedNumber';

export { useStreak } from './useStreak';
export type { StreakData, UseStreakReturn } from './useStreak';

export { useMilestones, MILESTONES } from './useMilestones';
export type { MilestoneType, MilestoneInfo, UseMilestonesReturn } from './useMilestones';

export { useRecentlyViewed } from './useRecentlyViewed';
export type { RecentlyViewedJob, LastSearch, RecentlyViewedData, UseRecentlyViewedReturn } from './useRecentlyViewed';

export { useSupabaseRealtime } from './useSupabaseRealtime';
export type { ConnectionStatus, UseSupabaseRealtimeOptions, UseSupabaseRealtimeReturn } from './useSupabaseRealtime';

export { useOptimisticJobs } from './useOptimisticJobs';
export type { OptimisticUpdateType, OptimisticUpdate, UseOptimisticJobsReturn } from './useOptimisticJobs';

export { useJobFilterCounts } from './useJobFilterCounts';
export type { FilterCounts, UseJobFilterCountsOptions, UseJobFilterCountsReturn } from './useJobFilterCounts';

export { useAutoApplyProgress } from './useAutoApplyProgress';
export type {
  CurrentStep,
  FieldProgress,
  ProgressData,
  FieldAttempt,
  ApplicationProgress,
  UseAutoApplyProgressOptions,
  UseAutoApplyProgressReturn,
} from './useAutoApplyProgress';

export { useProfileValidation, useProfileCompleteness, useCanAutoApply } from './useProfileValidation';

export { useAnswerQueue } from './useAnswerQueue';
