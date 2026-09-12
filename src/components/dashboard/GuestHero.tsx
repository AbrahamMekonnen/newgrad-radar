'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

interface GuestHeroProps {
  totalJobCount: number;
  className?: string;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'just now';
  }
  if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  }
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

export function GuestHero({ totalJobCount, className }: GuestHeroProps) {
  const [mounted, setMounted] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    setMounted(true);

    // Fetch the most recently posted/updated job
    const fetchLastUpdated = async () => {
      const { data } = await supabase
        .from('jobs')
        .select('posted, updated_at')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        const timestamp = data.updated_at || data.posted;
        if (timestamp) {
          setLastUpdated(formatTimeAgo(new Date(timestamp)));
        }
      }
    };

    fetchLastUpdated();
  }, [supabase]);

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl p-6 sm:p-8 mb-8 transition-all duration-500',
        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        className
      )}
    >
      {/* Gradient background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900" />
        <div
          className="absolute -top-1/2 -right-1/4 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{
            background: 'radial-gradient(circle, var(--primary) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute -bottom-1/4 -left-1/4 w-80 h-80 rounded-full opacity-15 blur-3xl"
          style={{
            background: 'radial-gradient(circle, var(--chart-5) 0%, transparent 70%)',
          }}
        />
      </div>

      <div className="relative z-10">
        {/* Main headline */}
        <h1
          className={cn(
            'text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white transition-all duration-500 delay-100',
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          )}
        >
          Find Your First Tech Job
        </h1>

        {/* Subtitle */}
        <p
          className={cn(
            'mt-2 text-base sm:text-lg text-gray-600 dark:text-gray-300 max-w-xl transition-all duration-500 delay-200',
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          )}
        >
          Curated new grad positions from top tech companies, all in one place.
        </p>

        {/* Trust signals row */}
        <div
          className={cn(
            'mt-6 flex flex-wrap items-center gap-4 sm:gap-6 transition-all duration-500 delay-300',
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          )}
        >
          {/* Job count - prominent */}
          <div className="flex items-center gap-2 px-4 py-2 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-full border border-gray-200/50 dark:border-slate-700/50 shadow-sm">
            <span className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">
              {totalJobCount > 0 ? totalJobCount.toLocaleString() : '500+'}
            </span>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              active positions
            </span>
          </div>

          {/* Last updated */}
          {lastUpdated && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <svg
                className="w-4 h-4 text-green-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Updated {lastUpdated}</span>
            </div>
          )}

          {/* Companies count */}
          <div className="hidden sm:flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            <span>From 100+ companies</span>
          </div>
        </div>

        {/* CTA */}
        <div
          className={cn(
            'mt-6 flex flex-wrap gap-3 transition-all duration-500 delay-400',
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          )}
        >
          <Link
            href="/auth/signup"
            className="inline-flex items-center px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors shadow-sm"
          >
            Get Started Free
            <svg
              className="ml-2 w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </Link>
          <span className="hidden sm:flex items-center text-sm text-gray-500 dark:text-gray-400">
            No credit card required
          </span>
        </div>
      </div>
    </section>
  );
}
