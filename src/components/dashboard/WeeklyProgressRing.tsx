'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface WeeklyProgressRingProps {
  current: number;
  target: number;
  completedDays: boolean[];
  streakWeeks?: number;
  className?: string;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function WeeklyProgressRing({
  current,
  target,
  completedDays,
  streakWeeks = 0,
  className,
}: WeeklyProgressRingProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger animation after mount
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const percentage = Math.min((current / target) * 100, 100);
  const isComplete = current >= target;

  // SVG circle calculations
  const size = 160;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * (mounted ? percentage : 0)) / 100;

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {/* Progress Ring */}
      <div className="relative">
        <svg
          width={size}
          height={size}
          className={cn(
            isComplete && mounted && 'animate-pulse-subtle'
          )}
        >
          {/* Gradient definitions */}
          <defs>
            <linearGradient id="indigo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="50%" stopColor="#4f46e5" />
              <stop offset="100%" stopColor="#4338ca" />
            </linearGradient>
            <linearGradient id="gold-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
          </defs>

          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-gray-200 dark:text-slate-700"
          />

          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={isComplete ? 'url(#gold-gradient)' : 'url(#indigo-gradient)'}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-[stroke-dashoffset] duration-1000 ease-out"
            style={{
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              'text-3xl font-bold',
              isComplete
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-gray-900 dark:text-white'
            )}
          >
            {current}/{target}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            applications
          </span>
        </div>
      </div>

      {/* Week dots */}
      <div className="mt-6 flex gap-3">
        {DAYS.map((day, index) => (
          <div key={index} className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                'h-3 w-3 rounded-full transition-all duration-300',
                completedDays[index]
                  ? isComplete
                    ? 'bg-amber-500 dark:bg-amber-400'
                    : 'bg-indigo-500 dark:bg-indigo-400'
                  : 'bg-gray-200 dark:bg-slate-700'
              )}
            />
            <span
              className={cn(
                'text-xs font-medium',
                completedDays[index]
                  ? 'text-gray-700 dark:text-gray-300'
                  : 'text-gray-400 dark:text-gray-500'
              )}
            >
              {day}
            </span>
          </div>
        ))}
      </div>

      {/* Streak counter */}
      {streakWeeks >= 2 && (
        <div className="mt-4 flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 dark:bg-amber-900/30">
          <svg
            className="h-4 w-4 text-amber-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {streakWeeks} weeks in a row!
          </span>
        </div>
      )}

      {/* Custom animation styles */}
      <style jsx>{`
        @keyframes pulse-subtle {
          0%, 100% {
            filter: drop-shadow(0 0 0 rgba(245, 158, 11, 0));
          }
          50% {
            filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.5));
          }
        }
        .animate-pulse-subtle {
          animation: pulse-subtle 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
