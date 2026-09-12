'use client';

import { useRecentlyViewed, type RecentlyViewedJob } from '@/hooks/useRecentlyViewed';
import { cn } from '@/lib/utils';

interface ContinueSectionProps {
  /** Called when user clicks on a job */
  onJobClick?: (job: RecentlyViewedJob) => void;
  /** Called when user clicks to resume a search */
  onSearchResume?: (query: string) => void;
  /** Additional className for the section */
  className?: string;
}

/**
 * "Continue where you left off" section showing recently viewed jobs
 * and last search query for quick access
 */
export function ContinueSection({
  onJobClick,
  onSearchResume,
  className,
}: ContinueSectionProps) {
  const {
    recentlyViewed,
    lastSearch,
    hasHistory,
    clearHistory,
  } = useRecentlyViewed();

  // Don't render if there's no history
  if (!hasHistory) {
    return null;
  }

  return (
    <section
      className={cn(
        'mb-6 p-4 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm',
        className
      )}
      aria-label="Continue where you left off"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          Continue where you left off
        </h2>
        <button
          onClick={clearHistory}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors focus:outline-none focus:underline"
          aria-label="Clear history"
        >
          Clear history
        </button>
      </div>

      {/* Horizontal scrollable container */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent">
        {/* Last search chip */}
        {lastSearch && (
          <button
            onClick={() => onSearchResume?.(lastSearch.query)}
            className={cn(
              'flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg',
              'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800',
              'text-sm text-blue-700 dark:text-blue-300',
              'hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800'
            )}
            aria-label={`Resume search for ${lastSearch.query}`}
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <span className="truncate max-w-[150px]">
              {lastSearch.query}
            </span>
          </button>
        )}

        {/* Recently viewed jobs */}
        {recentlyViewed.map((job) => (
          <JobChip
            key={job.id}
            job={job}
            onClick={() => onJobClick?.(job)}
          />
        ))}
      </div>
    </section>
  );
}

interface JobChipProps {
  job: RecentlyViewedJob;
  onClick?: () => void;
}

/**
 * Individual job chip/card showing company logo, title, and company name
 */
function JobChip({ job, onClick }: JobChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg',
        'bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600',
        'text-sm text-gray-700 dark:text-gray-200',
        'hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800'
      )}
      aria-label={`View ${job.title} at ${job.companyName}`}
    >
      {/* Job info */}
      <div className="flex flex-col items-start min-w-0">
        <span className="font-medium truncate max-w-[120px] text-gray-900 dark:text-white text-xs">
          {job.title}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]">
          {job.companyName}
        </span>
      </div>
    </button>
  );
}

export default ContinueSection;
