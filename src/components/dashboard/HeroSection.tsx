'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface NextInterview {
  company: string;
  date: Date;
}

interface HeroSectionProps {
  firstName: string;
  streakDays: number;
  nextInterview?: NextInterview | null;
  applicationCount: number;
}

function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// A pool of fun, encouraging one-liners for the subtitle. Rotated by time bucket
// (see getFunLine) so it changes every few hours with zero runtime AI cost.
// Refreshable later via a scheduled job if we want new lines over time.
const FUN_LINES = [
  "Your dream job is out there refreshing its careers page.",
  "Somewhere, a hiring manager is about to make your day.",
  "Plot twist: today's the day you apply to the right one.",
  "Great careers are built one 'apply' button at a time.",
  "The best time to apply was yesterday. The second best is now.",
  "New roles drop daily — fortune favors the refresh.",
  "One good application beats ten perfect ones you never send.",
  "Your future coworkers are already rooting for you.",
  "You miss 100% of the jobs you don't apply to.",
  "Today's rejection is tomorrow's 'their loss'.",
  "Momentum beats motivation. Apply to one more.",
  "Ship the application. Perfect it never.",
  "Every 'no' is quietly routing you toward the 'yes'.",
  "Somewhere a job description was written just for you.",
  "Your next chapter is one application away.",
  "Big things start with a single click of 'Submit'.",
  "Interviews are just conversations (sometimes with snacks).",
  "Keep going — offers find the persistent.",
  "The right role is closer than your last tab refresh.",
  "Confidence is a resume line you write yourself.",
];

// Deterministic per ~3-hour window so it rotates a few times a day and stays
// stable within a window (no flicker between renders).
function getFunLine(): string {
  const bucket = Math.floor(Date.now() / (3 * 60 * 60 * 1000));
  return FUN_LINES[bucket % FUN_LINES.length];
}

function formatInterviewDay(date: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const interviewDate = new Date(date);

  // Reset time for date comparison
  today.setHours(0, 0, 0, 0);
  tomorrow.setHours(0, 0, 0, 0);
  interviewDate.setHours(0, 0, 0, 0);

  if (interviewDate.getTime() === today.getTime()) {
    return 'today';
  }
  if (interviewDate.getTime() === tomorrow.getTime()) {
    return 'tomorrow';
  }

  const dayName = interviewDate.toLocaleDateString('en-US', { weekday: 'long' });
  return `on ${dayName}`;
}

function getStatusMessage(
  applicationCount: number,
  nextInterview?: NextInterview | null,
  streakDays?: number
): { message: string; type: 'new' | 'interview' | 'active' | 'dryspell' } {
  // Has upcoming interview - highest priority
  if (nextInterview) {
    const dayText = formatInterviewDay(nextInterview.date);
    return {
      message: `Interview with ${nextInterview.company} ${dayText}!`,
      type: 'interview',
    };
  }

  // No urgent interview — show a rotating fun line (changes every few hours).
  // Keep the state 'type' for styling/icon, but the copy is the fun one.
  if (applicationCount === 0) {
    return { message: getFunLine(), type: 'new' };
  }
  if (streakDays === 0) {
    return { message: getFunLine(), type: 'dryspell' };
  }
  return { message: getFunLine(), type: 'active' };
}

export function HeroSection({
  firstName,
  streakDays,
  nextInterview,
  applicationCount,
}: HeroSectionProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const greeting = getTimeOfDayGreeting();
  const { message, type } = getStatusMessage(applicationCount, nextInterview, streakDays);

  const statusColors: Record<typeof type, string> = {
    new: 'text-primary',
    interview: 'text-success',
    active: 'text-success',
    dryspell: 'text-warning',
  };

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl p-6 sm:p-8 transition-all duration-500',
        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      )}
    >
      {/* Aurora gradient background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 hero-gradient opacity-60" />
        <div
          className="absolute -top-1/2 -right-1/4 w-96 h-96 rounded-full opacity-30 blur-3xl"
          style={{
            background: 'radial-gradient(circle, var(--primary) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute -bottom-1/4 -left-1/4 w-80 h-80 rounded-full opacity-20 blur-3xl"
          style={{
            background: 'radial-gradient(circle, var(--success) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute top-1/4 right-1/3 w-64 h-64 rounded-full opacity-15 blur-3xl"
          style={{
            background: 'radial-gradient(circle, var(--chart-5) 0%, transparent 70%)',
          }}
        />
      </div>

      <div className="relative z-10">
        {/* Greeting */}
        <h1
          className={cn(
            'text-2xl sm:text-3xl font-bold text-foreground transition-all duration-500 delay-100',
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          )}
        >
          {greeting}, {firstName}
        </h1>

        {/* Status message */}
        <p
          className={cn(
            'mt-2 text-lg sm:text-xl font-medium transition-all duration-500 delay-200',
            statusColors[type],
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
          )}
        >
          {type === 'interview' && (
            <span className="inline-block mr-2 animate-pulse">
              <svg
                className="inline w-5 h-5 -mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          )}
          {message}
        </p>

        {/* Streak badge */}
        {streakDays > 0 && (
          <div
            className={cn(
              'mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card transition-all duration-500 delay-300',
              mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'
            )}
          >
            <span className="text-xl" role="img" aria-label="fire">
              {String.fromCodePoint(0x1F525)}
            </span>
            <span className="font-semibold text-foreground">
              {streakDays}-day streak
            </span>
            {streakDays >= 7 && (
              <span className="text-sm text-muted px-2 py-0.5 bg-muted-bg rounded-full">
                Keep it up!
              </span>
            )}
          </div>
        )}

        {/* Subtle action hint for new users */}
        {applicationCount === 0 && (
          <p
            className={cn(
              'mt-4 text-sm text-muted transition-all duration-500 delay-300',
              mounted ? 'opacity-100' : 'opacity-0'
            )}
          >
            Browse jobs and save the ones you apply to
          </p>
        )}
      </div>
    </section>
  );
}
