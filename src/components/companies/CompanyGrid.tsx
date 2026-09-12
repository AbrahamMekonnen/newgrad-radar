'use client';

import { Company } from '@/lib/types';
import { CompanyCard } from './CompanyCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

interface CompanyGridProps {
  companies: Company[];
  trackedSlugs?: Set<string>;
  autoApplySlugs?: Set<string>;
  notifySlugs?: Set<string>;
  filterSlugs?: Set<string>;
  jobCounts?: Record<string, number>;
  onToggle?: (slug: string) => void;
  onAutoApplyToggle?: (slug: string, enabled: boolean) => void;
  onNotifyToggle?: (slug: string, enabled: boolean) => void;
  onFilterClick?: (slug: string) => void;
  showAutoApplyToggle?: boolean;
  showNotifyToggle?: boolean;
  loading?: boolean;
  // Multi-select mode
  selectMode?: boolean;
  selectedSlugs?: Set<string>;
  onSelectToggle?: (slug: string) => void;
}

export function CompanyGrid({
  companies,
  trackedSlugs = new Set(),
  autoApplySlugs = new Set(),
  notifySlugs = new Set(),
  filterSlugs = new Set(),
  jobCounts = {},
  onToggle,
  onAutoApplyToggle,
  onNotifyToggle,
  onFilterClick,
  showAutoApplyToggle = false,
  showNotifyToggle = false,
  loading,
  selectMode = false,
  selectedSlugs = new Set(),
  onSelectToggle,
}: CompanyGridProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-8 w-full mt-4" />
          </div>
        ))}
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="text-center py-12">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
        <h3 className="mt-4 text-lg font-medium text-gray-900">No companies found</h3>
        <p className="mt-2 text-gray-500">
          Start tracking companies to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {companies.map((company) => (
        <div key={company.slug} className="relative">
          {/* Selection checkbox overlay */}
          {selectMode && (
            <button
              onClick={() => onSelectToggle?.(company.slug)}
              className={cn(
                'absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all',
                selectedSlugs.has(company.slug)
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:border-blue-400'
              )}
            >
              {selectedSlugs.has(company.slug) && (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          )}
          <div
            className={cn(
              selectMode && 'cursor-pointer',
              selectMode && selectedSlugs.has(company.slug) && 'ring-2 ring-blue-500 rounded-lg'
            )}
            onClick={selectMode ? () => onSelectToggle?.(company.slug) : undefined}
          >
            <CompanyCard
              company={company}
              isTracked={trackedSlugs.has(company.slug)}
              autoApply={autoApplySlugs.has(company.slug)}
              notifyEnabled={notifySlugs.has(company.slug)}
              hasCustomFilters={filterSlugs.has(company.slug)}
              jobCount={jobCounts[company.slug]}
              onToggle={selectMode ? undefined : onToggle}
              onAutoApplyToggle={selectMode ? undefined : onAutoApplyToggle}
              onNotifyToggle={selectMode ? undefined : onNotifyToggle}
              onFilterClick={selectMode ? undefined : onFilterClick}
              showAutoApplyToggle={!selectMode && showAutoApplyToggle}
              showNotifyToggle={!selectMode && showNotifyToggle}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
