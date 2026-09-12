/**
 * Time-related utility functions for the job board
 */

/**
 * Get a time-based greeting
 *
 * @returns "Good morning", "Good afternoon", or "Good evening"
 *
 * @example
 * ```tsx
 * <h1>{getGreeting()}, User!</h1>
 * // "Good morning, User!" (if before noon)
 * ```
 */
export function getGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 12) {
    return 'Good morning';
  } else if (hour < 17) {
    return 'Good afternoon';
  } else {
    return 'Good evening';
  }
}

/**
 * Get a personalized greeting with the user's name
 */
export function getPersonalizedGreeting(name?: string | null): string {
  const greeting = getGreeting();
  return name ? `${greeting}, ${name}` : greeting;
}

/**
 * Options for relative time formatting
 */
export interface RelativeTimeOptions {
  /** Include "ago" suffix for past times (default: true) */
  includeSuffix?: boolean;
  /** Use abbreviated format like "2h" instead of "2 hours" (default: false) */
  abbreviated?: boolean;
  /** Maximum unit to show (default: 'year') */
  maxUnit?: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
}

/**
 * Get human-readable relative time string
 *
 * @param date - The date to format (Date, ISO string, or timestamp)
 * @param options - Formatting options
 * @returns Relative time string like "2 hours ago", "yesterday", "3 days ago"
 *
 * @example
 * ```tsx
 * getRelativeTime(new Date(Date.now() - 3600000)) // "1 hour ago"
 * getRelativeTime('2024-01-15T10:00:00Z') // "2 days ago"
 * getRelativeTime(Date.now() - 86400000, { abbreviated: true }) // "1d ago"
 * ```
 */
export function getRelativeTime(
  date: Date | string | number,
  options: RelativeTimeOptions = {}
): string {
  const { includeSuffix = true, abbreviated = false, maxUnit = 'year' } = options;

  const now = new Date();
  const then = date instanceof Date ? date : new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const isPast = diffMs >= 0;
  const absDiffMs = Math.abs(diffMs);

  // Helper to format the output
  const format = (value: number, unit: string, abbrev: string): string => {
    const unitStr = abbreviated ? abbrev : ` ${unit}${value !== 1 ? 's' : ''}`;
    const suffix = includeSuffix ? ' ago' : '';
    return isPast ? `${value}${unitStr}${suffix}` : `in ${value}${unitStr}`;
  };

  // Time constants
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  // Check each unit in order
  if (absDiffMs < MINUTE) {
    return isPast ? 'just now' : 'in a moment';
  }

  const minutes = Math.floor(absDiffMs / MINUTE);
  if (absDiffMs < HOUR || maxUnit === 'minute') {
    return format(minutes, 'minute', 'm');
  }

  const hours = Math.floor(absDiffMs / HOUR);
  if (absDiffMs < DAY || maxUnit === 'hour') {
    return format(hours, 'hour', 'h');
  }

  const days = Math.floor(absDiffMs / DAY);

  // Special case: yesterday/tomorrow
  if (days === 1 && !abbreviated) {
    return isPast ? 'yesterday' : 'tomorrow';
  }

  if (absDiffMs < WEEK || maxUnit === 'day') {
    return format(days, 'day', 'd');
  }

  const weeks = Math.floor(absDiffMs / WEEK);
  if (absDiffMs < MONTH || maxUnit === 'week') {
    return format(weeks, 'week', 'w');
  }

  const months = Math.floor(absDiffMs / MONTH);
  if (absDiffMs < YEAR || maxUnit === 'month') {
    return format(months, 'month', 'mo');
  }

  const years = Math.floor(absDiffMs / YEAR);
  return format(years, 'year', 'y');
}

/**
 * Get days until a deadline
 *
 * @param deadline - The deadline date
 * @returns Object with days count and status
 *
 * @example
 * ```tsx
 * const { days, status, label } = getDaysUntil(job.deadline);
 * // { days: 3, status: 'soon', label: '3 days left' }
 * ```
 */
export function getDaysUntil(
  deadline: Date | string | number
): {
  /** Number of days until deadline (negative if passed) */
  days: number;
  /** Status: 'passed', 'today', 'tomorrow', 'soon', 'upcoming' */
  status: 'passed' | 'today' | 'tomorrow' | 'soon' | 'upcoming';
  /** Human-readable label */
  label: string;
  /** Whether the deadline has passed */
  isPassed: boolean;
  /** Urgency level for styling (0-3, higher = more urgent) */
  urgency: 0 | 1 | 2 | 3;
} {
  const now = new Date();
  const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline);

  // Calculate difference in days (at midnight)
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deadlineMidnight = new Date(
    deadlineDate.getFullYear(),
    deadlineDate.getMonth(),
    deadlineDate.getDate()
  );

  const diffMs = deadlineMidnight.getTime() - nowMidnight.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days < 0) {
    return {
      days,
      status: 'passed',
      label: days === -1 ? 'Closed yesterday' : `Closed ${Math.abs(days)} days ago`,
      isPassed: true,
      urgency: 0,
    };
  }

  if (days === 0) {
    return {
      days: 0,
      status: 'today',
      label: 'Closes today',
      isPassed: false,
      urgency: 3,
    };
  }

  if (days === 1) {
    return {
      days: 1,
      status: 'tomorrow',
      label: 'Closes tomorrow',
      isPassed: false,
      urgency: 3,
    };
  }

  if (days <= 7) {
    return {
      days,
      status: 'soon',
      label: `${days} days left`,
      isPassed: false,
      urgency: 2,
    };
  }

  if (days <= 14) {
    return {
      days,
      status: 'upcoming',
      label: `${days} days left`,
      isPassed: false,
      urgency: 1,
    };
  }

  return {
    days,
    status: 'upcoming',
    label: days < 30 ? `${days} days left` : `${Math.floor(days / 7)} weeks left`,
    isPassed: false,
    urgency: 0,
  };
}

/**
 * Format a date as a short readable string
 *
 * @example
 * formatShortDate(new Date()) // "Jan 15"
 * formatShortDate(new Date(), true) // "Jan 15, 2024"
 */
export function formatShortDate(date: Date | string, includeYear = false): string {
  const d = date instanceof Date ? date : new Date(date);
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    ...(includeYear && { year: 'numeric' }),
  };
  return d.toLocaleDateString('en-US', options);
}

/**
 * Check if a date is today
 */
export function isToday(date: Date | string): boolean {
  const d = date instanceof Date ? date : new Date(date);
  const today = new Date();
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}

/**
 * Check if a date is within the last N days
 */
export function isWithinDays(date: Date | string, days: number): boolean {
  const d = date instanceof Date ? date : new Date(date);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

/**
 * Get the start of the current week (Sunday)
 */
export function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get an array of dates for the current week
 */
export function getWeekDates(date: Date = new Date()): Date[] {
  const weekStart = getWeekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/**
 * Format duration in a human-readable way
 *
 * @example
 * formatDuration(90) // "1 hour 30 minutes"
 * formatDuration(45, true) // "45m"
 */
export function formatDuration(minutes: number, abbreviated = false): string {
  if (minutes < 60) {
    return abbreviated ? `${minutes}m` : `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (abbreviated) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const hourStr = `${hours} hour${hours !== 1 ? 's' : ''}`;
  if (remainingMinutes === 0) {
    return hourStr;
  }
  return `${hourStr} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
}

/**
 * Parse a posting date from various formats
 * Handles: "2 days ago", "Posted yesterday", ISO strings, timestamps
 */
export function parsePostingDate(dateStr: string): Date | null {
  // Try ISO format first
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const now = new Date();
  const lower = dateStr.toLowerCase().trim();

  // "just now", "now"
  if (lower === 'just now' || lower === 'now') {
    return now;
  }

  // "today"
  if (lower === 'today' || lower === 'posted today') {
    return now;
  }

  // "yesterday"
  if (lower === 'yesterday' || lower === 'posted yesterday') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  // "X days/hours/minutes ago"
  const agoMatch = lower.match(/(\d+)\s*(minute|hour|day|week|month)s?\s*ago/);
  if (agoMatch) {
    const value = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const d = new Date(now);

    switch (unit) {
      case 'minute':
        d.setMinutes(d.getMinutes() - value);
        break;
      case 'hour':
        d.setHours(d.getHours() - value);
        break;
      case 'day':
        d.setDate(d.getDate() - value);
        break;
      case 'week':
        d.setDate(d.getDate() - value * 7);
        break;
      case 'month':
        d.setMonth(d.getMonth() - value);
        break;
    }

    return d;
  }

  return null;
}
