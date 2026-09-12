'use client';

import { cn } from '@/lib/utils';

export type SmartFilter = 'hidden_gems' | 'hot_now' | 'new_grad_only' | 'closing_soon' | 'high_paying';

interface SmartFilterConfig {
  label: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
}

const SMART_FILTER_CONFIG: Record<SmartFilter, SmartFilterConfig> = {
  hidden_gems: {
    label: 'Hidden Gems',
    description: 'Not on LinkedIn/Indeed',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
      </svg>
    ),
    gradient: 'from-amber-500 to-orange-500',
  },
  hot_now: {
    label: 'Hot Now',
    description: 'Posted in last 3 days',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
      </svg>
    ),
    gradient: 'from-red-500 to-pink-500',
  },
  new_grad_only: {
    label: 'New Grad Only',
    description: '0 years experience',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/>
      </svg>
    ),
    gradient: 'from-blue-500 to-indigo-500',
  },
  closing_soon: {
    label: 'Closing Soon',
    description: 'Deadline within 7 days',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
      </svg>
    ),
    gradient: 'from-purple-500 to-violet-500',
  },
  high_paying: {
    label: 'High Paying',
    description: '$150K+ base salary',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>
      </svg>
    ),
    gradient: 'from-green-500 to-emerald-500',
  },
};

interface SmartFiltersProps {
  activeFilters: SmartFilter[];
  onToggle: (filter: SmartFilter) => void;
}

export function SmartFilters({ activeFilters, onToggle }: SmartFiltersProps) {
  const filters: SmartFilter[] = ['hidden_gems', 'hot_now', 'new_grad_only', 'closing_soon', 'high_paying'];

  return (
    <div className="grid grid-cols-1 gap-3" role="group" aria-label="Smart filters">
      {filters.map((filter) => {
        const config = SMART_FILTER_CONFIG[filter];
        const isActive = activeFilters.includes(filter);

        return (
          <button
            key={filter}
            onClick={() => onToggle(filter)}
            aria-pressed={isActive}
            className={cn(
              'flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left',
              isActive
                ? `bg-gradient-to-r ${config.gradient} text-white border-transparent shadow-lg`
                : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
            )}
          >
            {/* Icon box */}
            <div
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                isActive
                  ? 'bg-white/20'
                  : `bg-gradient-to-r ${config.gradient} text-white`
              )}
            >
              {config.icon}
            </div>

            {/* Label and description */}
            <div className="flex-1 min-w-0">
              <div
                className={cn(
                  'font-semibold text-sm',
                  isActive ? 'text-white' : 'text-gray-900 dark:text-white'
                )}
              >
                {config.label}
              </div>
              <div
                className={cn(
                  'text-xs truncate',
                  isActive ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'
                )}
              >
                {config.description}
              </div>
            </div>

            {/* Checkmark when active */}
            {isActive && (
              <svg
                className="w-5 h-5 text-white flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
