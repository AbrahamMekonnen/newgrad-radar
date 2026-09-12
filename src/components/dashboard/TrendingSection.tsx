'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Job } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';

interface TrendingJob extends Job {
  save_count: number;
}

interface ClosingSoonJob extends Job {
  days_remaining: number;
}

// Animated number component for save count
function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const duration = 500;
    const startTime = Date.now();
    const startValue = previousValueRef.current;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = Math.round(startValue + (value - startValue) * easeOutQuart);
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        previousValueRef.current = value;
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  return <span>{displayValue}</span>;
}

// Pulsing dot indicator for hot jobs
function HotIndicator() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
    </span>
  );
}

// Get urgency color based on days remaining
function getUrgencyColor(days: number): { bg: string; text: string; badge: string } {
  if (days < 3) {
    return {
      bg: 'bg-red-50 dark:bg-red-900/20',
      text: 'text-red-700 dark:text-red-400',
      badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400',
    };
  }
  if (days <= 7) {
    return {
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      text: 'text-amber-700 dark:text-amber-400',
      badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400',
    };
  }
  return {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-700 dark:text-green-400',
    badge: 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400',
  };
}

// Trending job item component
function TrendingJobItem({ job, rank }: { job: TrendingJob; rank: number }) {
  const isHot = job.save_count >= 10 || rank === 1;

  return (
    <Link
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group relative block p-3 rounded-lg border border-gray-200 dark:border-slate-700',
        'bg-white dark:bg-slate-800',
        'transition-all duration-200 ease-out',
        'hover:border-purple-300 dark:hover:border-purple-600',
        'hover:shadow-lg hover:shadow-purple-100/50 dark:hover:shadow-purple-900/30',
        'before:absolute before:inset-0 before:rounded-lg before:opacity-0',
        'before:bg-gradient-to-r before:from-purple-500/10 before:to-pink-500/10',
        'hover:before:opacity-100 before:transition-opacity before:duration-200'
      )}
    >
      <div className="relative flex items-start gap-3">
        {/* Company initial */}
        <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-gray-500 dark:text-gray-400">
            {job.company_name.charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{job.company_name}</p>
            {isHot && <HotIndicator />}
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-purple-700 dark:group-hover:text-purple-400 transition-colors">
            {job.title}
          </p>
        </div>

        {/* Save count */}
        <div className="flex items-center gap-1.5 shrink-0">
          <svg
            className="w-4 h-4 text-pink-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <span className="text-sm font-semibold text-pink-600 dark:text-pink-400">
            <AnimatedNumber value={job.save_count} />
          </span>
        </div>
      </div>
    </Link>
  );
}

// Closing soon job item component
function ClosingSoonJobItem({ job }: { job: ClosingSoonJob }) {
  const colors = getUrgencyColor(job.days_remaining);
  const daysText = job.days_remaining === 0
    ? 'Today!'
    : job.days_remaining === 1
    ? '1 day'
    : `${job.days_remaining} days`;

  return (
    <Link
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group relative block p-3 rounded-lg border border-gray-200 dark:border-slate-700',
        'bg-white dark:bg-slate-800',
        'transition-all duration-200 ease-out',
        'hover:border-orange-300 dark:hover:border-orange-600',
        'hover:shadow-lg hover:shadow-orange-100/50 dark:hover:shadow-orange-900/30',
        'before:absolute before:inset-0 before:rounded-lg before:opacity-0',
        'before:bg-gradient-to-r before:from-orange-500/10 before:to-yellow-500/10',
        'hover:before:opacity-100 before:transition-opacity before:duration-200'
      )}
    >
      <div className="relative flex items-start gap-3">
        {/* Company initial */}
        <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-gray-500 dark:text-gray-400">
            {job.company_name.charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{job.company_name}</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-orange-700 dark:group-hover:text-orange-400 transition-colors">
            {job.title}
          </p>
        </div>

        {/* Days remaining badge */}
        <div
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium shrink-0',
            colors.badge
          )}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {daysText}
        </div>
      </div>
    </Link>
  );
}

// Skeleton loaders
function TrendingItemSkeleton() {
  return (
    <div className="p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <Skeleton className="w-9 h-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="h-5 w-10" />
      </div>
    </div>
  );
}

export function TrendingSection() {
  const [trendingJobs, setTrendingJobs] = useState<TrendingJob[]>([]);
  const [closingSoonJobs, setClosingSoonJobs] = useState<ClosingSoonJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchTrendingData = async () => {
      try {
        // Use API endpoint to bypass RLS for non-logged-in users
        const response = await fetch('/api/trending');
        if (!response.ok) throw new Error('Failed to fetch trending data');

        const data = await response.json();

        if (isMounted) {
          setTrendingJobs(data.trending || []);
          setClosingSoonJobs(data.closingSoon || []);
        }
      } catch (err) {
        console.error('Error fetching trending data:', err);
        // Fail silently - just show empty state instead of error
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTrendingData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Always show section - with helpful message if no data

  return (
    <section className="mb-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Trending Now Column */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl" role="img" aria-label="fire">
              {String.fromCodePoint(0x1F525)}
            </span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Trending Now
            </h2>
          </div>

          <div className="space-y-3">
            {loading ? (
              <>
                <TrendingItemSkeleton />
                <TrendingItemSkeleton />
                <TrendingItemSkeleton />
              </>
            ) : error ? (
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            ) : trendingJobs.length > 0 ? (
              trendingJobs.map((job, index) => (
                <TrendingJobItem key={job.id} job={job} rank={index + 1} />
              ))
            ) : (
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 text-sm text-center">
                No trending jobs this week
              </div>
            )}
          </div>
        </div>

        {/* Closing Soon Column */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl" role="img" aria-label="clock">
              {String.fromCodePoint(0x23F0)}
            </span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Closing Soon
            </h2>
          </div>

          <div className="space-y-3">
            {loading ? (
              <>
                <TrendingItemSkeleton />
                <TrendingItemSkeleton />
                <TrendingItemSkeleton />
              </>
            ) : error ? (
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            ) : closingSoonJobs.length > 0 ? (
              closingSoonJobs.map((job) => (
                <ClosingSoonJobItem key={job.id} job={job} />
              ))
            ) : (
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 text-sm text-center">
                No deadlines coming up
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
