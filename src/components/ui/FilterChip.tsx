'use client';

import { cn } from '@/lib/utils';

interface FilterChipProps {
  label: string;
  onRemove: () => void;
  variant?: 'default' | 'smart';
  className?: string;
}

export function FilterChip({
  label,
  onRemove,
  variant = 'default',
  className,
}: FilterChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
        variant === 'default' && 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        variant === 'smart' && 'bg-gradient-to-r from-purple-500 to-blue-500 text-white',
        className
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'inline-flex items-center justify-center rounded-full p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
          variant === 'default' && 'hover:bg-blue-200 dark:hover:bg-blue-800',
          variant === 'smart' && 'hover:bg-white/20'
        )}
        aria-label={`Remove ${label} filter`}
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </span>
  );
}

interface ActiveFilter {
  key: string;
  label: string;
  variant?: 'default' | 'smart';
}

interface ActiveFiltersBarProps {
  filters: ActiveFilter[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

export function ActiveFiltersBar({
  filters,
  onRemove,
  onClearAll,
}: ActiveFiltersBarProps) {
  if (filters.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
        Active:
      </span>
      {filters.map((filter) => (
        <FilterChip
          key={filter.key}
          label={filter.label}
          variant={filter.variant}
          onRemove={() => onRemove(filter.key)}
        />
      ))}
      {filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-sm text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
