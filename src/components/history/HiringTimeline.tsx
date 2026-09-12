'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { MONTH_NAMES } from '@/lib/types';

export interface HiringSeasonData {
  year: number;
  month: number; // 1-12
  roles_opened: number;
}

export interface HiringTimelineProps {
  seasons: HiringSeasonData[];
  companyName: string;
}

const SHORT_MONTH_NAMES = MONTH_NAMES.map(m => m.slice(0, 3));

export function HiringTimeline({ seasons, companyName }: HiringTimelineProps) {
  // Group seasons by year and calculate max roles for scaling
  const { yearlyData, maxRoles } = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const targetYears = [currentYear - 1, currentYear];

    // Filter to last 2 years
    const filteredSeasons = seasons.filter(s => targetYears.includes(s.year));

    // Group by year
    const byYear = new Map<number, Map<number, number>>();
    for (const season of filteredSeasons) {
      if (!byYear.has(season.year)) {
        byYear.set(season.year, new Map());
      }
      byYear.get(season.year)!.set(season.month, season.roles_opened);
    }

    // Find max roles across all data for scaling
    let max = 0;
    for (const season of filteredSeasons) {
      if (season.roles_opened > max) {
        max = season.roles_opened;
      }
    }

    // Convert to array format sorted by year
    const yearlyData = targetYears.map(year => ({
      year,
      months: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        roles: byYear.get(year)?.get(i + 1) || 0,
      })),
    }));

    return { yearlyData, maxRoles: max || 1 };
  }, [seasons]);

  if (seasons.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {companyName} Hiring Timeline
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          No historical hiring data available.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
        {companyName} Hiring Timeline
      </h3>

      <div className="space-y-8">
        {yearlyData.map(({ year, months }) => (
          <div key={year}>
            <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3">
              {year}
            </div>

            {/* Horizontal bar chart with 12 months */}
            <div className="flex items-end gap-1 h-24">
              {months.map(({ month, roles }) => {
                const heightPercent = (roles / maxRoles) * 100;
                const hasActivity = roles > 0;

                return (
                  <div
                    key={month}
                    className="flex-1 flex flex-col items-center"
                  >
                    {/* Bar */}
                    <div className="w-full h-20 flex items-end">
                      <div
                        className={cn(
                          'w-full rounded-t transition-all duration-300',
                          hasActivity
                            ? 'bg-blue-500 dark:bg-blue-400'
                            : 'bg-gray-200 dark:bg-gray-700'
                        )}
                        style={{
                          height: hasActivity ? `${Math.max(heightPercent, 8)}%` : '8%',
                        }}
                        title={`${MONTH_NAMES[month - 1]} ${year}: ${roles} roles`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Month labels */}
            <div className="flex gap-1 mt-2">
              {months.map(({ month }) => (
                <div
                  key={month}
                  className="flex-1 text-center text-xs text-gray-500 dark:text-gray-400"
                >
                  {SHORT_MONTH_NAMES[month - 1]}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-blue-500 dark:bg-blue-400" />
            <span>Active hiring</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-700" />
            <span>No activity</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Height = # of new grad roles opened that month
        </p>
      </div>
    </div>
  );
}

export default HiringTimeline;
