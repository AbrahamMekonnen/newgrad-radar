'use client';

import { Company } from '@/lib/types';
import { TierBadge } from './TierBadge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface CompanyCardProps {
  company: Company;
  isTracked?: boolean;
  autoApply?: boolean;
  notifyEnabled?: boolean;
  hasCustomFilters?: boolean;
  jobCount?: number;
  onToggle?: (slug: string) => void;
  onAutoApplyToggle?: (slug: string, enabled: boolean) => void;
  onNotifyToggle?: (slug: string, enabled: boolean) => void;
  onFilterClick?: (slug: string) => void;
  showAutoApplyToggle?: boolean;
  showNotifyToggle?: boolean;
}

export function CompanyCard({
  company,
  isTracked = false,
  autoApply = false,
  notifyEnabled = false,
  hasCustomFilters = false,
  jobCount,
  onToggle,
  onAutoApplyToggle,
  onNotifyToggle,
  onFilterClick,
  showAutoApplyToggle = false,
  showNotifyToggle = false,
}: CompanyCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900 dark:text-white truncate">{company.name}</h3>
            <TierBadge tier={company.tier} />
            {/* Notification and filter icons for tracked companies */}
            {showNotifyToggle && (
              <div className="ml-auto flex items-center gap-1">
                {/* Filter button */}
                {onFilterClick && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFilterClick(company.slug);
                    }}
                    className={cn(
                      'relative p-1.5 rounded-full transition-colors',
                      hasCustomFilters
                        ? 'text-purple-600 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:hover:bg-purple-900/50'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                    title={hasCustomFilters ? 'Custom filters active' : 'Set job filters'}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                    </svg>
                    {hasCustomFilters && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-purple-500 rounded-full" />
                    )}
                  </button>
                )}
                {/* Notification bell */}
                {onNotifyToggle && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNotifyToggle(company.slug, !notifyEnabled);
                    }}
                    className={cn(
                      'p-1.5 rounded-full transition-colors',
                      notifyEnabled
                        ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                    title={notifyEnabled ? 'Notifications on' : 'Notifications off'}
                  >
                    {notifyEnabled ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {typeof jobCount === 'number' && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {jobCount} {jobCount === 1 ? 'job' : 'jobs'} available
            </p>
          )}
        </div>
      </div>

      {/* Auto-apply toggle for tracked companies */}
      {showAutoApplyToggle && onAutoApplyToggle && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-gray-600 dark:text-gray-400">Auto-apply to new jobs</span>
          <button
            onClick={() => onAutoApplyToggle(company.slug, !autoApply)}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              autoApply ? 'bg-amber-500' : 'bg-gray-200 dark:bg-gray-600'
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                autoApply ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </button>
        </div>
      )}

      {onToggle && (
        <div className="mt-4">
          <Button
            variant={isTracked ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => onToggle(company.slug)}
            className="w-full"
          >
            {isTracked ? 'Remove' : 'Add to My List'}
          </Button>
        </div>
      )}
    </div>
  );
}
