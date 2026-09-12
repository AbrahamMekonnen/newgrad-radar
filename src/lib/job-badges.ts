import { Job, FundingStage } from './types';

// Event badge types
export type EventBadgeType = 'ghc' | 'just-funded' | 'yc-batch' | 'career-fair';

export interface EventBadge {
  type: EventBadgeType;
  label: string;
  color: string;
  icon?: 'sparkle' | 'rocket' | 'calendar' | 'star';
  priority: number; // Lower = higher priority for display ordering
}

// GHC 2026 sponsor companies (top tech sponsors)
const GHC_2026_SPONSORS = new Set([
  'google',
  'meta',
  'microsoft',
  'amazon',
  'apple',
  'nvidia',
  'salesforce',
  'adobe',
  'intuit',
  'paypal',
  'stripe',
  'bloomberg',
  'capital-one',
  'jpmorgan',
  'goldman-sachs',
  'morgan-stanley',
  'deloitte',
  'accenture',
  'ibm',
  'cisco',
  'vmware',
  'databricks',
  'snowflake',
  'palantir',
  'twilio',
  'pinterest',
  'lyft',
  'doordash',
  'instacart',
  'airbnb',
  'uber',
  'netflix',
  'spotify',
  'slack',
  'dropbox',
  'zoom',
  'cloudflare',
  'datadog',
  'mongodb',
  'elastic',
  'hashicorp',
  'confluent',
]);

// Recent YC batches (W26 = Winter 2026, S25 = Summer 2025)
const YC_RECENT_BATCHES: Record<string, string[]> = {
  'W26': [
    // Placeholder for YC W26 companies - would be populated from YC API or scraper
  ],
  'S25': [
    // Recent YC S25 companies
  ],
};

// Companies that raised recently (within last 3 months)
const RECENTLY_FUNDED_COMPANIES = new Set<string>([
  // This would be populated dynamically from Crunchbase/PitchBook data
  // For now, using known recent raises
]);

// Career fair sources
const CAREER_FAIR_SOURCES = new Set([
  'career-fair',
  'university-fair',
  'tech-fair',
  'recruiting-event',
  'on-campus',
  'virtual-fair',
]);

// Badge configuration with styling
export const EVENT_BADGE_CONFIG: Record<EventBadgeType, Omit<EventBadge, 'type'>> = {
  'ghc': {
    label: 'GHC 2026',
    color: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white',
    icon: 'sparkle',
    priority: 1,
  },
  'just-funded': {
    label: 'Just Funded',
    color: 'bg-gradient-to-r from-green-500 to-emerald-500 text-white',
    icon: 'rocket',
    priority: 2,
  },
  'yc-batch': {
    label: 'YC W26',
    color: 'bg-gradient-to-r from-orange-500 to-amber-500 text-white',
    icon: 'star',
    priority: 3,
  },
  'career-fair': {
    label: 'Career Fair',
    color: 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white',
    icon: 'calendar',
    priority: 4,
  },
};

export interface JobBadgeContext {
  companySlug?: string;
  companyName: string;
  fundingStage?: FundingStage | null;
  fundingDate?: string | null; // ISO date of last funding
  source?: string;
  ycBatch?: string | null;
  tier?: string;
}

/**
 * Determines which event badges apply to a job
 * @param job - The job object
 * @param context - Additional context for badge determination
 * @returns Array of applicable event badges, sorted by priority
 */
export function getJobEventBadges(
  job: Pick<Job, 'company_slug' | 'company_name' | 'source' | 'tier'>,
  context?: Partial<JobBadgeContext>
): EventBadge[] {
  const badges: EventBadge[] = [];
  const companySlug = job.company_slug || job.company_name.toLowerCase().replace(/\s+/g, '-');
  const companyNameLower = job.company_name.toLowerCase();

  // Check for GHC 2026 sponsor
  if (isGHCSponsor(companySlug, companyNameLower)) {
    badges.push({
      type: 'ghc',
      ...EVENT_BADGE_CONFIG['ghc'],
    });
  }

  // Check for recent funding (Just Funded)
  if (isRecentlyFunded(companySlug, context?.fundingStage, context?.fundingDate)) {
    badges.push({
      type: 'just-funded',
      ...EVENT_BADGE_CONFIG['just-funded'],
    });
  }

  // Check for recent YC batch
  const ycBatch = getYCBatch(companySlug, job.tier, context?.ycBatch);
  if (ycBatch) {
    badges.push({
      type: 'yc-batch',
      ...EVENT_BADGE_CONFIG['yc-batch'],
      label: `YC ${ycBatch}`,
    });
  }

  // Check for career fair source
  if (isCareerFairSource(job.source, context?.source)) {
    badges.push({
      type: 'career-fair',
      ...EVENT_BADGE_CONFIG['career-fair'],
    });
  }

  // Sort by priority (lower number = higher priority)
  return badges.sort((a, b) => a.priority - b.priority);
}

/**
 * Check if company is a GHC 2026 sponsor
 */
function isGHCSponsor(slug: string, nameLower: string): boolean {
  // Check exact slug match
  if (GHC_2026_SPONSORS.has(slug)) return true;

  // Check if company name contains a sponsor name
  for (const sponsor of GHC_2026_SPONSORS) {
    if (nameLower.includes(sponsor.replace(/-/g, ' '))) return true;
    if (slug.includes(sponsor)) return true;
  }

  return false;
}

/**
 * Check if company raised funding recently (within 90 days)
 */
function isRecentlyFunded(
  slug: string,
  fundingStage?: FundingStage | null,
  fundingDate?: string | null
): boolean {
  // Check if in known recently funded list
  if (RECENTLY_FUNDED_COMPANIES.has(slug)) return true;

  // If we have a funding date, check if within 90 days
  if (fundingDate) {
    const date = new Date(fundingDate);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 90) return true;
  }

  // Early stage companies are more likely to be recently funded
  // This is a heuristic - ideally we'd have actual funding dates
  if (fundingStage && ['seed', 'pre-seed', 'series-a'].includes(fundingStage)) {
    // Only show for seed/series-a if they're in YC or known accelerators
    return false;
  }

  return false;
}

/**
 * Get YC batch if company is from recent YC batches
 */
function getYCBatch(
  slug: string,
  tier?: string,
  providedBatch?: string | null
): string | null {
  // If batch is explicitly provided, use it
  if (providedBatch) return providedBatch;

  // Check if company is YC tier
  if (tier === 'yc') {
    // Check recent batches
    for (const [batch, companies] of Object.entries(YC_RECENT_BATCHES)) {
      if (companies.includes(slug)) {
        return batch;
      }
    }
    // For YC tier companies without specific batch, show most recent
    return 'W26';
  }

  return null;
}

/**
 * Check if job is from a career fair source
 */
function isCareerFairSource(jobSource?: string, contextSource?: string): boolean {
  const source = (jobSource || contextSource || '').toLowerCase();

  // Check if source matches career fair patterns
  if (CAREER_FAIR_SOURCES.has(source)) return true;

  // Check for keywords in source
  const careerFairKeywords = ['fair', 'career event', 'recruiting event', 'campus', 'on-site'];
  for (const keyword of careerFairKeywords) {
    if (source.includes(keyword)) return true;
  }

  return false;
}

/**
 * Add a company to the GHC sponsors list (for dynamic updates)
 */
export function addGHCSponsor(slug: string): void {
  GHC_2026_SPONSORS.add(slug.toLowerCase());
}

/**
 * Add a company to recently funded list (for dynamic updates)
 */
export function addRecentlyFundedCompany(slug: string): void {
  RECENTLY_FUNDED_COMPANIES.add(slug.toLowerCase());
}

/**
 * Update YC batch data (for dynamic updates from scraper)
 */
export function updateYCBatch(batch: string, companies: string[]): void {
  YC_RECENT_BATCHES[batch] = companies.map(c => c.toLowerCase());
}

/**
 * Get the icon SVG path for a badge type
 */
export function getBadgeIconPath(icon: EventBadge['icon']): string {
  switch (icon) {
    case 'sparkle':
      return 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z';
    case 'rocket':
      return 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z';
    case 'calendar':
      return 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5';
    case 'star':
      return 'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z';
    default:
      return '';
  }
}

/**
 * Maximum number of event badges to display (to avoid clutter)
 */
export const MAX_EVENT_BADGES = 2;
