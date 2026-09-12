'use client';

import { cn } from '@/lib/utils';

// Featured companies - using text badges since we don't have logo files
const FEATURED_COMPANIES = [
  { name: 'Google', color: 'from-blue-500 to-green-500' },
  { name: 'Meta', color: 'from-blue-600 to-blue-400' },
  { name: 'Stripe', color: 'from-violet-600 to-purple-500' },
  { name: 'OpenAI', color: 'from-emerald-600 to-teal-500' },
  { name: 'Anthropic', color: 'from-orange-500 to-amber-500' },
] as const;

interface CompanyLogosProps {
  className?: string;
}

export function CompanyLogos({ className }: CompanyLogosProps) {
  return (
    <div className={cn('mb-8', className)}>
      <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-4 uppercase tracking-wider font-medium">
        Tracking positions from companies like
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
        {FEATURED_COMPANIES.map((company) => (
          <div
            key={company.name}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-semibold text-white',
              'bg-gradient-to-r shadow-sm',
              company.color,
              'transition-transform hover:scale-105'
            )}
          >
            {company.name}
          </div>
        ))}
        <div className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
          + 100 more
        </div>
      </div>
    </div>
  );
}
