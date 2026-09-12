'use client';

import { useAnimatedNumber } from '@/hooks';
import { cn } from '@/lib/utils';

export interface StatsCardsProps {
  /** Number of pending applications */
  activeCount: number;
  /** Number of new applications this week */
  activeThisWeek?: number;
  /** Number of applications within response window */
  processingCount: number;
  /** Average response time in weeks */
  avgResponseWeeks?: number;
  /** Number of scheduled interviews */
  interviewCount: number;
  /** Next interview date */
  nextInterviewDate?: string;
  /** Current applications this week */
  weeklyProgress: number;
  /** Weekly application goal */
  weeklyGoal: number;
}

interface StatCardProps {
  title: string;
  value: number;
  subtitle: React.ReactNode;
  color: 'indigo' | 'blue' | 'emerald' | 'purple';
  progress?: { current: number; max: number };
}

const colorStyles = {
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/30',
    text: 'text-indigo-600 dark:text-indigo-400',
    ring: 'ring-indigo-500/20',
    progressBg: 'bg-indigo-100 dark:bg-indigo-900/50',
    progressFill: 'bg-indigo-500 dark:bg-indigo-400',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    text: 'text-blue-600 dark:text-blue-400',
    ring: 'ring-blue-500/20',
    progressBg: 'bg-blue-100 dark:bg-blue-900/50',
    progressFill: 'bg-blue-500 dark:bg-blue-400',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    ring: 'ring-emerald-500/20',
    progressBg: 'bg-emerald-100 dark:bg-emerald-900/50',
    progressFill: 'bg-emerald-500 dark:bg-emerald-400',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    text: 'text-purple-600 dark:text-purple-400',
    ring: 'ring-purple-500/20',
    progressBg: 'bg-purple-100 dark:bg-purple-900/50',
    progressFill: 'bg-purple-500 dark:bg-purple-400',
  },
};

function StatCard({ title, value, subtitle, color, progress }: StatCardProps) {
  const animatedValue = useAnimatedNumber(value, { duration: 800 });
  const animatedProgress = useAnimatedNumber(
    progress ? Math.min((progress.current / progress.max) * 100, 100) : 0,
    { duration: 1000, decimals: 1 }
  );
  const styles = colorStyles[color];

  return (
    <div
      className={cn(
        'rounded-xl p-5 transition-all duration-200',
        'bg-white dark:bg-gray-800',
        'border border-gray-200 dark:border-gray-700',
        'hover:ring-2',
        styles.ring,
        'cursor-default'
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {title}
        </h3>
        <div className={cn('w-2 h-2 rounded-full', styles.progressFill)} />
      </div>

      <div className={cn('text-3xl font-bold mb-2', styles.text)}>
        {animatedValue}
      </div>

      <div className="text-sm text-gray-500 dark:text-gray-400">
        {subtitle}
      </div>

      {progress && (
        <div className="mt-3">
          <div className={cn('h-2 rounded-full overflow-hidden', styles.progressBg)}>
            <div
              className={cn('h-full rounded-full transition-all duration-1000', styles.progressFill)}
              style={{ width: `${animatedProgress}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 text-right">
            {progress.current}/{progress.max} applications
          </div>
        </div>
      )}
    </div>
  );
}

function TrendBadge({ value, isPositive }: { value: string; isPositive: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        isPositive
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
      )}
    >
      {isPositive && (
        <svg className="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      )}
      {value}
    </span>
  );
}

function formatInterviewDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function StatsCards({
  activeCount,
  activeThisWeek = 0,
  processingCount,
  avgResponseWeeks = 2,
  interviewCount,
  nextInterviewDate,
  weeklyProgress,
  weeklyGoal,
}: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Active Applications */}
      <StatCard
        title="Active"
        value={activeCount}
        color="indigo"
        subtitle={
          activeThisWeek > 0 ? (
            <TrendBadge value={`+${activeThisWeek} this week`} isPositive />
          ) : (
            <span className="text-gray-400 dark:text-gray-500">No new this week</span>
          )
        }
      />

      {/* Processing */}
      <StatCard
        title="Processing"
        value={processingCount}
        color="blue"
        subtitle={
          processingCount > 0 ? (
            <span>{avgResponseWeeks} weeks avg response time</span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400">All on track</span>
          )
        }
      />

      {/* Interviews */}
      <StatCard
        title="Interviews"
        value={interviewCount}
        color="emerald"
        subtitle={
          interviewCount > 0 && nextInterviewDate ? (
            <span className="flex items-center">
              <svg className="w-4 h-4 mr-1 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Next: {formatInterviewDate(nextInterviewDate)}
            </span>
          ) : (
            <span className="text-purple-600 dark:text-purple-400">Keep applying!</span>
          )
        }
      />

      {/* Weekly Goal */}
      <StatCard
        title="Weekly Goal"
        value={weeklyProgress}
        color="purple"
        subtitle={
          weeklyProgress >= weeklyGoal ? (
            <span className="text-emerald-600 dark:text-emerald-400 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Goal reached!
            </span>
          ) : (
            <span>{weeklyGoal - weeklyProgress} more to go</span>
          )
        }
        progress={{ current: weeklyProgress, max: weeklyGoal }}
      />
    </div>
  );
}

export default StatsCards;
