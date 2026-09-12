'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CollapsibleFilterSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: number;
}

export function CollapsibleFilterSection({
  title,
  children,
  defaultOpen = false,
  badge,
}: CollapsibleFilterSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-200 dark:border-slate-700 last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between py-3 px-1 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors rounded-md"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {title}
          </span>
          {badge !== undefined && badge > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
              {badge}
            </span>
          )}
        </div>
        <svg
          className={cn(
            'h-5 w-5 text-gray-500 dark:text-gray-400 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-in-out',
          isOpen ? 'max-h-[500px] opacity-100 pb-3' : 'max-h-0 opacity-0'
        )}
      >
        <div className="px-1">{children}</div>
      </div>
    </div>
  );
}
