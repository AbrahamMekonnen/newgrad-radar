'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

type EmptyStateVariant = 'default' | 'noSearchResults' | 'allCaughtUp';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  onClearFilters?: () => void;
  className?: string;
}

const VARIANT_CONFIG = {
  default: {
    icon: 'briefcase',
    headline: 'Your job search starts here',
    body: 'Track every application in one place. See which companies responded, which need follow-up, and what\'s working.',
    primaryAction: {
      label: 'Add your first application',
      href: '/',
    },
    secondaryAction: {
      label: 'Browse jobs',
      href: '/',
    },
  },
  noSearchResults: {
    icon: 'search',
    headline: 'No jobs match your filters',
    body: 'Try adjusting your search criteria or clearing some filters to see more results.',
    primaryAction: {
      label: 'Clear filters',
      href: null, // Uses onClick handler
    },
    secondaryAction: null,
  },
  allCaughtUp: {
    icon: 'celebration',
    headline: 'All caught up!',
    body: 'You\'ve reviewed all your pending items. Check back later for new updates or add more applications to track.',
    primaryAction: {
      label: 'Browse new jobs',
      href: '/',
    },
    secondaryAction: null,
  },
} as const;

function BriefcaseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 12v4"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M2 12h20"
      />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M10 7v6m-3-3h6"
      />
    </svg>
  );
}

function CelebrationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M5 3l3 3m0 0l-3 3m3-3H2"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 3l-3 3m0 0l3 3m-3-3h3"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 2v2"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 22c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 16s1 1 3 1 3-1 3-1"
      />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function getIcon(iconType: string, className: string) {
  switch (iconType) {
    case 'briefcase':
      return <BriefcaseIcon className={className} />;
    case 'search':
      return <SearchIcon className={className} />;
    case 'celebration':
      return <CelebrationIcon className={className} />;
    default:
      return <BriefcaseIcon className={className} />;
  }
}

export function EmptyState({
  variant = 'default',
  onClearFilters,
  className,
}: EmptyStateProps) {
  const config = VARIANT_CONFIG[variant];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        'px-6 py-16 sm:py-24',
        className
      )}
    >
      {/* Icon container with subtle gradient background */}
      <div
        className={cn(
          'mb-8 rounded-full p-6',
          variant === 'allCaughtUp'
            ? 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20'
            : variant === 'noSearchResults'
            ? 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/20 dark:to-amber-800/20'
            : 'bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/20 dark:to-indigo-800/20'
        )}
      >
        {getIcon(
          config.icon,
          cn(
            'h-12 w-12 sm:h-16 sm:w-16',
            variant === 'allCaughtUp'
              ? 'text-emerald-500 dark:text-emerald-400'
              : variant === 'noSearchResults'
              ? 'text-amber-500 dark:text-amber-400'
              : 'text-indigo-500 dark:text-indigo-400'
          )
        )}
      </div>

      {/* Headline */}
      <h2
        className={cn(
          'text-2xl sm:text-3xl font-bold tracking-tight',
          'text-gray-900 dark:text-white',
          'mb-4'
        )}
      >
        {config.headline}
        {variant === 'allCaughtUp' && (
          <span className="ml-2" aria-label="celebration">
            🎉
          </span>
        )}
      </h2>

      {/* Body text */}
      <p
        className={cn(
          'text-base sm:text-lg',
          'text-gray-600 dark:text-gray-400',
          'max-w-md',
          'mb-10'
        )}
      >
        {config.body}
      </p>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row items-center gap-4">
        {/* Primary CTA */}
        {config.primaryAction.href ? (
          <Link
            href={config.primaryAction.href}
            className={cn(
              'inline-flex items-center justify-center',
              'px-8 py-3.5',
              'text-base font-semibold',
              'rounded-xl',
              'transition-all duration-200',
              'shadow-lg shadow-indigo-500/25 dark:shadow-indigo-500/15',
              'hover:shadow-xl hover:shadow-indigo-500/30 dark:hover:shadow-indigo-500/20',
              'hover:-translate-y-0.5',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900',
              'bg-indigo-600 text-white hover:bg-indigo-700'
            )}
          >
            <svg
              className="mr-2 h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            {config.primaryAction.label}
          </Link>
        ) : (
          <button
            onClick={onClearFilters}
            className={cn(
              'inline-flex items-center justify-center',
              'px-8 py-3.5',
              'text-base font-semibold',
              'rounded-xl',
              'transition-all duration-200',
              'shadow-lg shadow-indigo-500/25 dark:shadow-indigo-500/15',
              'hover:shadow-xl hover:shadow-indigo-500/30 dark:hover:shadow-indigo-500/20',
              'hover:-translate-y-0.5',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900',
              'bg-indigo-600 text-white hover:bg-indigo-700'
            )}
          >
            <svg
              className="mr-2 h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            {config.primaryAction.label}
          </button>
        )}

        {/* Secondary action */}
        {config.secondaryAction && (
          <Link
            href={config.secondaryAction.href}
            className={cn(
              'inline-flex items-center justify-center',
              'px-6 py-3',
              'text-base font-medium',
              'rounded-xl',
              'transition-all duration-200',
              'text-gray-700 dark:text-gray-300',
              'hover:text-indigo-600 dark:hover:text-indigo-400',
              'hover:bg-gray-100 dark:hover:bg-slate-800',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900'
            )}
          >
            {config.secondaryAction.label}
            <svg
              className="ml-2 h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </Link>
        )}
      </div>

      {/* Decorative elements for visual polish */}
      <div
        className={cn(
          'absolute inset-0 -z-10 overflow-hidden pointer-events-none',
          'opacity-30 dark:opacity-20'
        )}
        aria-hidden="true"
      >
        <div
          className={cn(
            'absolute -top-1/4 -right-1/4',
            'w-96 h-96 rounded-full',
            'bg-gradient-to-br from-indigo-100 to-transparent dark:from-indigo-900/30',
            'blur-3xl'
          )}
        />
        <div
          className={cn(
            'absolute -bottom-1/4 -left-1/4',
            'w-96 h-96 rounded-full',
            'bg-gradient-to-tr from-indigo-100 to-transparent dark:from-indigo-900/30',
            'blur-3xl'
          )}
        />
      </div>
    </div>
  );
}

// Named exports for specific variants (convenience wrappers)
export function NoApplicationsState({ className }: { className?: string }) {
  return <EmptyState variant="default" className={className} />;
}

export function NoSearchResultsState({
  onClearFilters,
  className,
}: {
  onClearFilters: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      variant="noSearchResults"
      onClearFilters={onClearFilters}
      className={className}
    />
  );
}

export function AllCaughtUpState({ className }: { className?: string }) {
  return <EmptyState variant="allCaughtUp" className={className} />;
}
