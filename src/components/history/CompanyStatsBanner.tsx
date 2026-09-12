'use client';

import { cn } from '@/lib/utils';
import { CompanyHiringStats, MONTH_NAMES } from '@/lib/types';

export type HiringVelocity = 'aggressive' | 'steady' | 'burst' | 'inactive';

export interface CompanyStatsBannerProps {
  stats: CompanyHiringStats;
}

function getVelocityConfig(stats: CompanyHiringStats): {
  velocity: HiringVelocity;
  color: string;
  bgColor: string;
  label: string;
} {
  const { jobs_posted, avg_time_to_close } = stats;

  // Determine hiring velocity based on volume and speed
  if (jobs_posted === 0) {
    return {
      velocity: 'inactive',
      color: 'text-gray-600 dark:text-gray-400',
      bgColor: 'bg-gray-100 dark:bg-gray-800',
      label: 'Inactive',
    };
  }

  if (jobs_posted >= 20 && avg_time_to_close <= 30) {
    return {
      velocity: 'aggressive',
      color: 'text-green-700 dark:text-green-300',
      bgColor: 'bg-green-100 dark:bg-green-900/50',
      label: 'Aggressive',
    };
  }

  if (jobs_posted >= 10 || avg_time_to_close <= 45) {
    return {
      velocity: 'steady',
      color: 'text-blue-700 dark:text-blue-300',
      bgColor: 'bg-blue-100 dark:bg-blue-900/50',
      label: 'Steady',
    };
  }

  if (jobs_posted > 0 && jobs_posted < 10) {
    return {
      velocity: 'burst',
      color: 'text-amber-700 dark:text-amber-300',
      bgColor: 'bg-amber-100 dark:bg-amber-900/50',
      label: 'Burst',
    };
  }

  return {
    velocity: 'steady',
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-100 dark:bg-blue-900/50',
    label: 'Steady',
  };
}

interface StatItemProps {
  label: string;
  value: React.ReactNode;
  subtext?: string;
}

function StatItem({ label, value, subtext }: StatItemProps) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-xl font-bold text-gray-900 dark:text-white mt-1">
        {value}
      </span>
      {subtext && (
        <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {subtext}
        </span>
      )}
    </div>
  );
}

export function CompanyStatsBanner({ stats }: CompanyStatsBannerProps) {
  const velocityConfig = getVelocityConfig(stats);
  const peakMonthName = MONTH_NAMES[stats.peak_month - 1] || 'N/A';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {/* Total roles posted this year */}
        <StatItem
          label="Total Roles"
          value={stats.jobs_posted}
          subtext={`${stats.year}`}
        />

        {/* Peak hiring month */}
        <StatItem
          label="Peak Month"
          value={peakMonthName}
          subtext={`${stats.new_grad_roles} new grad roles`}
        />

        {/* Average days open */}
        <StatItem
          label="Avg Days Open"
          value={Math.round(stats.avg_time_to_close)}
          subtext="days until filled"
        />

        {/* Hiring velocity badge */}
        <div className="flex flex-col">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Velocity
          </span>
          <div className="mt-1">
            <span
              className={cn(
                'inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold',
                velocityConfig.bgColor,
                velocityConfig.color
              )}
            >
              {velocityConfig.velocity === 'aggressive' && (
                <svg
                  className="w-4 h-4 mr-1.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              )}
              {velocityConfig.velocity === 'steady' && (
                <svg
                  className="w-4 h-4 mr-1.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              )}
              {velocityConfig.velocity === 'burst' && (
                <svg
                  className="w-4 h-4 mr-1.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              )}
              {velocityConfig.velocity === 'inactive' && (
                <svg
                  className="w-4 h-4 mr-1.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 12H4"
                  />
                </svg>
              )}
              {velocityConfig.label}
            </span>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            {velocityConfig.velocity === 'aggressive' && 'High volume, fast fills'}
            {velocityConfig.velocity === 'steady' && 'Consistent hiring pace'}
            {velocityConfig.velocity === 'burst' && 'Seasonal hiring spikes'}
            {velocityConfig.velocity === 'inactive' && 'No recent activity'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default CompanyStatsBanner;
