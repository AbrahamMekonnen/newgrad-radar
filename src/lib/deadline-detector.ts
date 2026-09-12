/**
 * Deadline Detection System
 * Parses job descriptions to extract application deadlines
 */

export interface DeadlineResult {
  deadline: string | null;  // ISO date string (YYYY-MM-DD)
  confidence: 'high' | 'medium' | 'low';
  matchedPattern: string | null;
  rawText: string | null;
}

// Month name mappings
const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

// Ordinal suffixes for dates (1st, 2nd, 3rd, etc.)
const ORDINAL_PATTERN = /(\d{1,2})(?:st|nd|rd|th)/gi;

/**
 * Primary deadline detection patterns (high confidence)
 * These explicitly mention deadlines or closing dates
 */
const HIGH_CONFIDENCE_PATTERNS = [
  // "Application deadline: December 15, 2024"
  /(?:application\s+)?deadline[:\s]+(.{5,50})/gi,
  // "Apply by December 15, 2024"
  /apply\s+by[:\s]+(.{5,50})/gi,
  // "Applications close on December 15, 2024"
  /applications?\s+clos(?:e|es|ing)\s+(?:on\s+)?(.{5,50})/gi,
  // "Closes on December 15"
  /clos(?:e|es|ing)\s+(?:on\s+)?(.{5,50})/gi,
  // "Closing date: December 15, 2024"
  /closing\s+date[:\s]+(.{5,50})/gi,
  // "Due date: December 15, 2024"
  /due\s+date[:\s]+(.{5,50})/gi,
  // "Applications due December 15"
  /applications?\s+due[:\s]+(.{5,50})/gi,
  // "Submit by December 15"
  /submit\s+by[:\s]+(.{5,50})/gi,
  // "Must apply by December 15"
  /must\s+apply\s+by[:\s]+(.{5,50})/gi,
  // "Final date to apply: December 15"
  /final\s+date\s+to\s+apply[:\s]+(.{5,50})/gi,
  // "Last day to apply: December 15"
  /last\s+day\s+to\s+apply[:\s]+(.{5,50})/gi,
  // "Applications accepted until December 15"
  /applications?\s+accepted\s+until[:\s]+(.{5,50})/gi,
  // "Rolling deadline until December 15" or "Deadline until filled"
  /(?:rolling\s+)?deadline\s+until[:\s]+(.{5,50})/gi,
];

/**
 * Medium confidence patterns
 * These mention dates in context that suggests deadlines
 */
const MEDIUM_CONFIDENCE_PATTERNS = [
  // "Position closes 12/15/2024"
  /position\s+clos(?:e|es|ing)[:\s]+(.{5,50})/gi,
  // "Open until December 15"
  /open\s+until[:\s]+(.{5,50})/gi,
  // "Accepting applications through December 15"
  /accepting\s+applications?\s+(?:through|until|thru)[:\s]+(.{5,50})/gi,
  // "Hiring until December 15"
  /hiring\s+(?:through|until|thru)[:\s]+(.{5,50})/gi,
  // "End date: December 15"
  /end\s+date[:\s]+(.{5,50})/gi,
  // "Expires: December 15"
  /expires?[:\s]+(.{5,50})/gi,
];

/**
 * Date format patterns to extract actual dates from matched text
 */
const DATE_PATTERNS = [
  // ISO format: 2024-12-15
  /(\d{4})-(\d{1,2})-(\d{1,2})/,
  // US format with slashes: 12/15/2024 or 12/15/24
  /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/,
  // US format with dashes: 12-15-2024
  /(\d{1,2})-(\d{1,2})-(\d{2,4})/,
  // European format with dots: 15.12.2024
  /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/,
  // Month name formats: December 15, 2024 or Dec 15, 2024
  /([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i,
  // Month name formats without year: December 15 or Dec 15
  /([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
  // Day Month Year: 15 December 2024
  /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s*(\d{4})/i,
  // Day Month without year: 15 December or 15th December
  /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/i,
  // Compact: 15Dec2024 or 15Dec24
  /(\d{1,2})([a-z]{3})(\d{2,4})/i,
];

/**
 * Parse a date string and return ISO format
 */
function parseDate(text: string): string | null {
  // Normalize the text
  const normalized = text
    .toLowerCase()
    .replace(ORDINAL_PATTERN, '$1')
    .trim();

  // Try ISO format first: 2024-12-15
  let match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return formatDate(parseInt(year), parseInt(month), parseInt(day));
  }

  // US format with slashes: 12/15/2024 or 12/15/24
  match = normalized.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (match) {
    const [, month, day, yearStr] = match;
    const year = normalizeYear(parseInt(yearStr));
    return formatDate(year, parseInt(month), parseInt(day));
  }

  // US format with dashes: 12-15-2024
  match = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (match) {
    const [, month, day, yearStr] = match;
    const year = normalizeYear(parseInt(yearStr));
    return formatDate(year, parseInt(month), parseInt(day));
  }

  // European format with dots: 15.12.2024
  match = normalized.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (match) {
    const [, day, month, yearStr] = match;
    const year = normalizeYear(parseInt(yearStr));
    return formatDate(year, parseInt(month), parseInt(day));
  }

  // Month name with year: December 15, 2024 or Dec 15 2024
  match = normalized.match(/([a-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (match) {
    const [, monthName, day, year] = match;
    const month = MONTH_NAMES[monthName];
    if (month) {
      return formatDate(parseInt(year), month, parseInt(day));
    }
  }

  // Month name without year: December 15 or Dec 15 (assume current/next year)
  // Allow trailing: whitespace, end of string, comma, period, or other punctuation
  match = normalized.match(/([a-z]+)\s+(\d{1,2})(?:[\s.,;:!?]|$)/);
  if (match) {
    const [, monthName, day] = match;
    const month = MONTH_NAMES[monthName];
    if (month) {
      const year = inferYear(month, parseInt(day));
      return formatDate(year, month, parseInt(day));
    }
  }

  // Day Month Year: 15 December 2024
  match = normalized.match(/(\d{1,2})\s+([a-z]+),?\s*(\d{4})/);
  if (match) {
    const [, day, monthName, year] = match;
    const month = MONTH_NAMES[monthName];
    if (month) {
      return formatDate(parseInt(year), month, parseInt(day));
    }
  }

  // Day Month without year: 15 December
  match = normalized.match(/(\d{1,2})\s+([a-z]+)(?:\s|$)/);
  if (match) {
    const [, day, monthName] = match;
    const month = MONTH_NAMES[monthName];
    if (month) {
      const year = inferYear(month, parseInt(day));
      return formatDate(year, month, parseInt(day));
    }
  }

  // Compact format: 15Dec2024 or 15Dec24
  match = normalized.match(/(\d{1,2})([a-z]{3})(\d{2,4})/);
  if (match) {
    const [, day, monthName, yearStr] = match;
    const month = MONTH_NAMES[monthName];
    if (month) {
      const year = normalizeYear(parseInt(yearStr));
      return formatDate(year, month, parseInt(day));
    }
  }

  return null;
}

/**
 * Normalize 2-digit year to 4-digit
 */
function normalizeYear(year: number): number {
  if (year < 100) {
    // Assume 20xx for years 00-99
    return 2000 + year;
  }
  return year;
}

/**
 * Infer year when not provided (assume next occurrence of the date)
 */
function inferYear(month: number, day: number): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  // If the month/day has already passed this year, assume next year
  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }
  return currentYear;
}

/**
 * Format date as ISO string, validating the date
 */
function formatDate(year: number, month: number, day: number): string | null {
  // Validate ranges
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 2020 || year > 2100) return null;

  // Create date and validate
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null; // Invalid date (e.g., Feb 30)
  }

  // Return ISO format
  const monthStr = month.toString().padStart(2, '0');
  const dayStr = day.toString().padStart(2, '0');
  return `${year}-${monthStr}-${dayStr}`;
}

/**
 * Check if extracted date is reasonable (not too far in past/future)
 */
function isReasonableDeadline(dateStr: string): boolean {
  const deadline = new Date(dateStr);
  const now = new Date();
  const twoYearsFromNow = new Date();
  twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2);

  // Deadline should be in the future but not more than 2 years out
  // (some university recruiting programs post early)
  // Allow deadlines up to 30 days in the past (might be stale jobs)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return deadline >= thirtyDaysAgo && deadline <= twoYearsFromNow;
}

/**
 * Filter out false positives (common phrases that look like deadlines but aren't)
 */
function isFalsePositive(text: string): boolean {
  const falsePositives = [
    /until\s+(?:position\s+is\s+)?filled/i,
    /until\s+further\s+notice/i,
    /rolling\s+basis/i,
    /no\s+deadline/i,
    /open\s+(?:until\s+)?filled/i,
    /ongoing/i,
    /continuous/i,
    /asap/i,
    /immediately/i,
  ];

  return falsePositives.some(pattern => pattern.test(text));
}

/**
 * Main function: Detect deadline from job description text
 */
export function detectDeadline(description: string): DeadlineResult {
  if (!description || typeof description !== 'string') {
    return {
      deadline: null,
      confidence: 'low',
      matchedPattern: null,
      rawText: null,
    };
  }

  // Normalize whitespace
  const text = description.replace(/\s+/g, ' ').trim();

  // Try high confidence patterns first
  for (const pattern of HIGH_CONFIDENCE_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[1]) {
      const rawText = match[1].trim();

      // Skip false positives
      if (isFalsePositive(rawText)) {
        continue;
      }

      const deadline = parseDate(rawText);
      if (deadline && isReasonableDeadline(deadline)) {
        return {
          deadline,
          confidence: 'high',
          matchedPattern: pattern.source,
          rawText: match[0],
        };
      }
    }
  }

  // Try medium confidence patterns
  for (const pattern of MEDIUM_CONFIDENCE_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[1]) {
      const rawText = match[1].trim();

      if (isFalsePositive(rawText)) {
        continue;
      }

      const deadline = parseDate(rawText);
      if (deadline && isReasonableDeadline(deadline)) {
        return {
          deadline,
          confidence: 'medium',
          matchedPattern: pattern.source,
          rawText: match[0],
        };
      }
    }
  }

  // No deadline found
  return {
    deadline: null,
    confidence: 'low',
    matchedPattern: null,
    rawText: null,
  };
}

/**
 * Batch process multiple job descriptions
 */
export function detectDeadlines(
  jobs: Array<{ id: string; description: string }>
): Array<{ id: string; result: DeadlineResult }> {
  return jobs.map(job => ({
    id: job.id,
    result: detectDeadline(job.description),
  }));
}

/**
 * Check if a deadline is approaching (within N days)
 */
export function isDeadlineApproaching(
  deadline: string | null,
  withinDays: number = 7
): boolean {
  if (!deadline) return false;

  const deadlineDate = new Date(deadline);
  const now = new Date();
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + withinDays);

  return deadlineDate >= now && deadlineDate <= threshold;
}

/**
 * Check if a deadline has passed
 */
export function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false;

  const deadlineDate = new Date(deadline);
  const now = new Date();
  // Set to end of deadline day
  deadlineDate.setHours(23, 59, 59, 999);

  return deadlineDate < now;
}

/**
 * Format deadline for display
 */
export function formatDeadline(deadline: string | null): string {
  if (!deadline) return 'No deadline';

  const date = new Date(deadline);
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'Deadline passed';
  } else if (diffDays === 0) {
    return 'Due today!';
  } else if (diffDays === 1) {
    return 'Due tomorrow';
  } else if (diffDays <= 7) {
    return `${diffDays} days left`;
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }
}
