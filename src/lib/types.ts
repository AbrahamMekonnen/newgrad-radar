export type FundingStage =
  | 'bootstrapped'
  | 'pre-seed'
  | 'seed'
  | 'series-a'
  | 'series-b'
  | 'series-c'
  | 'series-d+'
  | 'late-stage'
  | 'public'
  | 'acquired'
  | 'unknown';

export type CompanySize =
  | '1-10'
  | '11-50'
  | '51-200'
  | '201-500'
  | '501-1000'
  | '1001-5000'
  | '5001-10000'
  | '10000+'
  | 'unknown';

export type JobSource =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'simplify'
  | 'adzuna'
  | 'remoteok'
  | 'usajobs'
  | 'hn'
  | 'vc_portfolio'
  | 'conference'
  | 'hackathon'
  | 'github_repo'
  | 'newsletter'
  | 'direct';

export interface Company {
  slug: string;
  name: string;
  tier: Tier;
  ats_type: 'greenhouse' | 'lever' | 'ashby' | 'workday' | null;
  ats_token: string | null;
  logo_url: string | null;
  careers_url: string | null;
  created_at: string;
  // Enrichment fields
  funding_stage: FundingStage | null;
  company_size: CompanySize | null;
  industry: string | null;
  founded_year: number | null;
  headquarters: string | null;
  description: string | null;
  stock_ticker: string | null;
  is_public: boolean | null;
  enriched_at: string | null;
  // User submission tracking
  added_by?: string | null;
  is_user_submitted?: boolean;
  verified_at?: string | null;
  verification_source?: string | null;
}

export type SponsorshipStatus = 'sponsors' | 'no_sponsor' | 'unknown';

export interface Job {
  id: string;
  company_slug: string;
  company_name: string;
  title: string;
  location: string | null;
  url: string;
  apply_url: string | null; // Direct application URL (not job description)
  tier: string;
  role_types: string[];
  source: JobSource;
  source_url: string | null;
  posted: string | null;
  deadline: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  salary_min: number | null;
  salary_max: number | null;
  sponsorship_status?: SponsorshipStatus;
  description?: string;
  // Multi-dimensional tagging fields (migration 011)
  discovery_sources: string[];
  diversity_tags: DiversityTag[];
  work_modes: WorkMode[];
  badges: BadgeTag[];
  experience_level: ExperienceLevel | null;
}

export type NotifyMode = 'instant' | 'daily_digest' | 'weekly_digest';

export interface JobFilters {
  role_types?: RoleType[];
  experience_levels?: ExperienceLevel[];
  title_keywords?: string[];
  title_exclude?: string[];
}

export const DEFAULT_TITLE_EXCLUDE = ['senior', 'staff', 'principal', 'lead', 'manager'];

export interface UserList {
  id: string;
  user_id: string;
  company_slug: string;
  auto_apply: boolean;
  notify_enabled: boolean;
  notify_mode: NotifyMode;
  job_filters: JobFilters;
  created_at: string;
  company?: Company;
}

export const NOTIFY_MODE_LABELS: Record<NotifyMode, string> = {
  instant: 'Instant',
  daily_digest: 'Daily',
  weekly_digest: 'Weekly',
};

export const NOTIFY_MODE_DESCRIPTIONS: Record<NotifyMode, string> = {
  instant: 'Get notified immediately when new jobs are posted',
  daily_digest: 'Receive a daily summary of new jobs',
  weekly_digest: 'Receive a weekly summary of new jobs',
};

export interface UserCompany {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  tier: string;
  careers_url: string | null;
  logo_url: string | null;
  auto_apply: boolean;
  created_at: string;
}

export interface SavedJob {
  id: string;
  user_id: string;
  job_id: string;
  status: JobStatus;
  notes: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  job?: Job;
}

export interface UserPreferences {
  user_id: string;
  notify_scope: 'all' | 'my_list';
  push_enabled: boolean;
  email_enabled: boolean;
  ntfy_topic: string | null;
  role_filters: string[];
  created_at: string;
  updated_at: string;
}

export type Tier = 'faang' | 'ai' | 'unicorn' | 'yc' | 'fintech' | 'infra' | 'other';
export type RoleType = 'swe' | 'ml' | 'backend' | 'frontend' | 'fullstack' | 'infra' | 'data' | 'security' | 'mobile';
export type JobStatus = 'saved' | 'applied' | 'in_review' | 'interviewing' | 'rejected' | 'offer';

export type RecruiterSource = 'job_posting' | 'pattern' | 'user' | 'osint';
export type VerificationStatus = 'pending' | 'valid' | 'invalid' | 'stale';

export interface EmailVariant {
  email: string;
  confidence: number;
  verified: boolean;
}

export interface Recruiter {
  id: string;
  job_id: string | null;
  company_slug: string;
  name: string;
  title: string | null;
  email: string | null;
  email_verified: boolean;
  email_variants: EmailVariant[] | null;
  phone: string | null;
  role_focus: string | null;
  linkedin_url: string | null;
  linkedin_verified: boolean;
  source: RecruiterSource;
  verification_status: VerificationStatus;
  upvotes: number;
  downvotes: number;
  created_at: string;
}

export const TIER_COLORS: Record<Tier, string> = {
  faang: 'bg-purple-600',
  ai: 'bg-red-600',
  unicorn: 'bg-cyan-600',
  yc: 'bg-orange-600',
  fintech: 'bg-green-600',
  infra: 'bg-gray-600',
  other: 'bg-slate-500',
};

export const TIER_LABELS: Record<Tier, string> = {
  faang: 'FAANG',
  ai: 'AI',
  unicorn: 'Unicorn',
  yc: 'YC',
  fintech: 'Fintech',
  infra: 'Infra',
  other: 'Other',
};

export const ROLE_COLORS: Record<RoleType, string> = {
  swe: 'bg-blue-500',
  ml: 'bg-pink-500',
  backend: 'bg-indigo-500',
  frontend: 'bg-teal-500',
  fullstack: 'bg-violet-500',
  infra: 'bg-slate-500',
  data: 'bg-amber-500',
  security: 'bg-rose-500',
  mobile: 'bg-emerald-500',
};

export const ROLE_LABELS: Record<RoleType, string> = {
  swe: 'SWE',
  ml: 'ML/AI',
  backend: 'Backend',
  frontend: 'Frontend',
  fullstack: 'Full Stack',
  infra: 'Infra',
  data: 'Data',
  security: 'Security',
  mobile: 'Mobile',
};

export const STATUS_COLORS: Record<JobStatus, string> = {
  saved: 'bg-gray-100 text-gray-700',
  applied: 'bg-blue-100 text-blue-700',
  in_review: 'bg-purple-100 text-purple-700',
  interviewing: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
  offer: 'bg-green-100 text-green-700',
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  in_review: 'In Review',
  interviewing: 'Interviewing',
  rejected: 'Rejected',
  offer: 'Offer',
};

// Auto-apply types
export interface UserProfile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  github_url: string | null;
  resume_url: string | null;
  resume_filename: string | null;
  auto_apply_enabled: boolean;
  auto_submit: boolean;
  auto_apply_all_jobs: boolean;
  work_authorization: string | null;
  require_sponsorship: boolean | null;
  years_experience: string | null;
  start_date: string | null;
  salary_expectation: string | null;
  willing_to_relocate: boolean | null;
  custom_answers: Record<string, string>;
}

export type ApplicationStatus = 'pending' | 'filling' | 'review' | 'submitted' | 'failed';

export interface ApplicationLog {
  id: string;
  user_id: string;
  job_id: string;
  status: ApplicationStatus;
  ats_type: string;
  error_message: string | null;
  submitted_at: string | null;
  created_at: string;
}

export const APPLICATION_STATUS_COLORS: Record<ApplicationStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  filling: 'bg-blue-100 text-blue-700',
  review: 'bg-purple-100 text-purple-700',
  submitted: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: 'Pending',
  filling: 'Filling...',
  review: 'Ready for Review',
  submitted: 'Submitted',
  failed: 'Failed',
};

// Sponsorship status display constants
export const SPONSORSHIP_COLORS: Record<SponsorshipStatus, string> = {
  sponsors: 'bg-green-100 text-green-700',
  no_sponsor: 'bg-red-100 text-red-700',
  unknown: 'bg-gray-100 text-gray-700',
};

export const SPONSORSHIP_LABELS: Record<SponsorshipStatus, string> = {
  sponsors: 'Sponsors Visa',
  no_sponsor: 'No Sponsorship',
  unknown: 'Unknown',
};

// Job source display constants
export const JOB_SOURCE_LABELS: Record<JobSource, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  simplify: 'Simplify',
  adzuna: 'Adzuna',
  remoteok: 'Remote OK',
  usajobs: 'USAJobs',
  hn: 'Hacker News',
  vc_portfolio: 'VC Portfolio',
  conference: 'Conference',
  hackathon: 'Hackathon',
  github_repo: 'GitHub',
  newsletter: 'Newsletter',
  direct: 'Direct',
};

export const JOB_SOURCE_COLORS: Record<JobSource, string> = {
  greenhouse: 'bg-green-100 text-green-700',
  lever: 'bg-blue-100 text-blue-700',
  ashby: 'bg-purple-100 text-purple-700',
  simplify: 'bg-cyan-100 text-cyan-700',
  adzuna: 'bg-orange-100 text-orange-700',
  remoteok: 'bg-teal-100 text-teal-700',
  usajobs: 'bg-red-100 text-red-700',
  hn: 'bg-amber-100 text-amber-700',
  vc_portfolio: 'bg-indigo-100 text-indigo-700',
  conference: 'bg-pink-100 text-pink-700',
  hackathon: 'bg-yellow-100 text-yellow-700',
  github_repo: 'bg-gray-100 text-gray-700',
  newsletter: 'bg-rose-100 text-rose-700',
  direct: 'bg-slate-100 text-slate-700',
};

// Funding stage filter categories (simplified for new grads)
export type FundingFilter = 'seed' | 'series-a' | 'series-b+' | 'public';

export const FUNDING_FILTER_LABELS: Record<FundingFilter, string> = {
  'seed': 'Seed',
  'series-a': 'Series A',
  'series-b+': 'Series B+',
  'public': 'Public',
};

// Job source filter categories
export type SourceFilter = 'ats' | 'job_boards' | 'vc_portfolios' | 'conferences' | 'newsletters' | 'government';

export const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  'ats': 'ATS (Greenhouse/Lever)',
  'job_boards': 'Job Boards',
  'vc_portfolios': 'VC Portfolios',
  'conferences': 'Conferences',
  'newsletters': 'Newsletters',
  'government': 'Government',
};

// Location filter options
export type LocationFilter = 'remote' | 'san_francisco' | 'new_york' | 'seattle' | 'austin' | 'boston' | 'los_angeles' | 'denver' | 'chicago';

export const LOCATION_FILTER_LABELS: Record<LocationFilter, string> = {
  'remote': 'Remote',
  'san_francisco': 'San Francisco, CA',
  'new_york': 'New York, NY',
  'seattle': 'Seattle, WA',
  'austin': 'Austin, TX',
  'boston': 'Boston, MA',
  'los_angeles': 'Los Angeles, CA',
  'denver': 'Denver, CO',
  'chicago': 'Chicago, IL',
};

// Location filter search patterns (used for ilike queries)
export const LOCATION_FILTER_PATTERNS: Record<LocationFilter, string[]> = {
  'remote': ['remote', 'work from home', 'wfh', 'anywhere'],
  'san_francisco': ['san francisco', 'sf', 'bay area', 'palo alto', 'mountain view', 'sunnyvale', 'menlo park', 'san jose', 'oakland'],
  'new_york': ['new york', 'nyc', 'manhattan', 'brooklyn'],
  'seattle': ['seattle', 'bellevue', 'redmond'],
  'austin': ['austin'],
  'boston': ['boston', 'cambridge, ma'],
  'los_angeles': ['los angeles', 'la', 'santa monica', 'culver city', 'venice'],
  'denver': ['denver', 'boulder'],
  'chicago': ['chicago'],
};

// Map specific sources to filter categories
export const SOURCE_TO_FILTER: Record<string, SourceFilter> = {
  // ATS sources
  'greenhouse': 'ats',
  'lever': 'ats',
  'ashby': 'ats',
  'workday': 'ats',
  'taleo': 'ats',
  'icims': 'ats',
  'smartrecruiters': 'ats',
  'jobvite': 'ats',
  // Job boards
  'linkedin': 'job_boards',
  'indeed': 'job_boards',
  'glassdoor': 'job_boards',
  'wellfound': 'job_boards',
  'ziprecruiter': 'job_boards',
  'dice': 'job_boards',
  'monster': 'job_boards',
  'simplify': 'job_boards',
  // VC portfolios
  'a16z': 'vc_portfolios',
  'sequoia': 'vc_portfolios',
  'yc_jobs': 'vc_portfolios',
  'greylock': 'vc_portfolios',
  'accel': 'vc_portfolios',
  'vc_portfolio': 'vc_portfolios',
  // Conferences
  'grace_hopper': 'conferences',
  'tapia': 'conferences',
  'ghc': 'conferences',
  'conference': 'conferences',
  // Newsletters
  'levels_fyi': 'newsletters',
  'newsletter': 'newsletters',
  'pittcsc': 'newsletters',
  // Government
  'usajobs': 'government',
  'clearancejobs': 'government',
  'government': 'government',
  // Job aggregators / boards
  'github_zapplyjobs': 'job_boards',
  'zapplyjobs': 'job_boards',
  'hn_hiring': 'job_boards',
  'remoteok': 'job_boards',
  'arbeitnow': 'job_boards',
  'adzuna': 'job_boards',
};

/**
 * Expand selected filter categories (e.g. 'ats', 'job_boards') into the raw
 * `source` column values the jobs table actually stores. The job query filters
 * on the raw values, so without this the category names match nothing.
 */
export function rawSourcesForFilters(filters: SourceFilter[]): string[] {
  const set = new Set(filters);
  return Object.entries(SOURCE_TO_FILTER)
    .filter(([, category]) => set.has(category))
    .map(([raw]) => raw);
}

export function sourceToFilter(source: string): SourceFilter | null {
  const normalized = source.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return SOURCE_TO_FILTER[normalized] || null;
}

export const FUNDING_FILTER_COLORS: Record<FundingFilter, string> = {
  'seed': 'bg-purple-100 text-purple-700',
  'series-a': 'bg-blue-100 text-blue-700',
  'series-b+': 'bg-green-100 text-green-700',
  'public': 'bg-gray-100 text-gray-700',
};

// Map granular funding stages to filter categories
export function fundingStageToFilter(stage: FundingStage): FundingFilter | null {
  switch (stage) {
    case 'bootstrapped':
    case 'pre-seed':
    case 'seed':
      return 'seed';
    case 'series-a':
      return 'series-a';
    case 'series-b':
    case 'series-c':
    case 'series-d+':
    case 'late-stage':
    case 'acquired':
      return 'series-b+';
    case 'public':
      return 'public';
    case 'unknown':
    default:
      return null;
  }
}

// Hidden Gems: Exclusive sources not on LinkedIn/Indeed
export const HIDDEN_GEM_SOURCES: JobSource[] = [
  'vc_portfolio',
  'conference',
  'hackathon',
  'newsletter',
  'github_repo',
];

// Source badge labels for Hidden Gems
export type HiddenGemBadge =
  | 'ghc_sponsor'
  | 'yc_company'
  | 'mlh_partner'
  | 'vc_backed'
  | 'tapia_sponsor'
  | 'newsletter_exclusive'
  | 'github_trending'
  | 'hackathon_sponsor';

export const HIDDEN_GEM_BADGE_LABELS: Record<HiddenGemBadge, string> = {
  ghc_sponsor: 'GHC Sponsor',
  yc_company: 'YC Company',
  mlh_partner: 'MLH Partner',
  vc_backed: 'VC Portfolio',
  tapia_sponsor: 'Tapia Sponsor',
  newsletter_exclusive: 'Newsletter',
  github_trending: 'GitHub Trending',
  hackathon_sponsor: 'Hackathon',
};

export const HIDDEN_GEM_BADGE_COLORS: Record<HiddenGemBadge, string> = {
  ghc_sponsor: 'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white',
  yc_company: 'bg-gradient-to-r from-orange-500 to-amber-500 text-white',
  mlh_partner: 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white',
  vc_backed: 'bg-gradient-to-r from-violet-500 to-purple-500 text-white',
  tapia_sponsor: 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white',
  newsletter_exclusive: 'bg-gradient-to-r from-rose-500 to-red-500 text-white',
  github_trending: 'bg-gradient-to-r from-gray-700 to-gray-900 text-white',
  hackathon_sponsor: 'bg-gradient-to-r from-green-500 to-emerald-500 text-white',
};

// Map job source + company tier to badge type
export function getHiddenGemBadge(source: JobSource, tier?: string, sourceUrl?: string | null): HiddenGemBadge | null {
  // Conference sources
  if (source === 'conference') {
    if (sourceUrl?.toLowerCase().includes('ghc') || sourceUrl?.toLowerCase().includes('gracehopper')) {
      return 'ghc_sponsor';
    }
    if (sourceUrl?.toLowerCase().includes('tapia')) {
      return 'tapia_sponsor';
    }
    return 'ghc_sponsor'; // Default conference badge
  }

  // Hackathon sources
  if (source === 'hackathon') {
    if (sourceUrl?.toLowerCase().includes('mlh')) {
      return 'mlh_partner';
    }
    return 'hackathon_sponsor';
  }

  // VC portfolio sources
  if (source === 'vc_portfolio') {
    if (tier === 'yc') {
      return 'yc_company';
    }
    return 'vc_backed';
  }

  // Newsletter sources
  if (source === 'newsletter') {
    return 'newsletter_exclusive';
  }

  // GitHub repo sources
  if (source === 'github_repo') {
    return 'github_trending';
  }

  return null;
}

// Check if a source qualifies as a Hidden Gem
export function isHiddenGem(source: JobSource): boolean {
  return HIDDEN_GEM_SOURCES.includes(source);
}

// =============================================================================
// TAG TYPES
// =============================================================================

export type TagCategory = 'discovery_source' | 'diversity' | 'work_mode' | 'badge';

export type DiscoverySource =
  | 'greenhouse'
  | 'lever'
  | 'linkedin'
  | 'indeed'
  | 'glassdoor'
  | 'wellfound'
  | 'ycombinator'
  | 'a16z'
  | 'sequoia'
  | 'greylock'
  | 'grace_hopper'
  | 'tapia'
  | 'nsbe'
  | 'shpe'
  | 'outtie'
  | 'lesbians_who_tech'
  | 'afrotech'
  | 'techqueria'
  | 'github_repo'
  | 'hacker_news'
  | 'newsletter'
  | 'direct';

export type DiversityTag =
  | 'ghc_sponsor'
  | 'nsbe_sponsor'
  | 'shpe_sponsor'
  | 'tapia_sponsor'
  | 'afrotech_sponsor'
  | 'outtie_sponsor'
  | 'lesbians_who_tech_sponsor'
  | 'techqueria_sponsor'
  | 'diversity_focused';

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'flexible';

export type BadgeTag =
  | 'just_funded'
  | 'hot_hiring'
  | 'fast_growing'
  | 'closing_soon'
  | 'high_paying'
  | 'new_listing'
  | 'hidden_gem'
  | 'quick_apply'
  | 'no_cover_letter'
  | 'referral_available';

export interface Tag {
  id: string;
  category: TagCategory;
  name: string;
  colors: {
    bg: string;
    text: string;
    border?: string;
  };
  icon?: string;
  priority: number;
}

// =============================================================================
// EXPERIENCE TYPES
// =============================================================================

export type ExperienceLevel =
  | 'intern'
  | 'new_grad'
  | 'entry_level'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal';

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  intern: 'Intern',
  new_grad: 'New Grad',
  entry_level: 'Entry Level',
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
  staff: 'Staff',
  principal: 'Principal',
};

// Which recruiter focus owns a given job level. Early-career levels are handled
// by university/campus recruiters (focus 'new_grad'); mid+ levels by
// technical/senior recruiters (focus 'experienced'). 'generic' recruiters fit
// any level.
export function focusForLevel(level: ExperienceLevel | null | undefined): 'new_grad' | 'experienced' {
  if (level && ['mid', 'senior', 'staff', 'principal'].includes(level)) {
    return 'experienced';
  }
  return 'new_grad'; // intern / new_grad / entry_level / junior / unknown
}

// Pick the recruiters that actually align with a job instead of dumping every
// recruiter a company has onto every card. Matches the job's level to each
// recruiter's focus, always keeping 'generic' recruiters, and falls back to the
// full list only if nothing matches (so a card is never empty when we have data).
export function recruitersForJob(recruiters: Recruiter[], job: Job): Recruiter[] {
  if (!recruiters || recruiters.length === 0) return [];
  const wanted = focusForLevel(job.experience_level);
  // Strict association: a card shows only recruiters whose focus matches this
  // job's level, plus 'generic' recruiters that fit any level (and legacy/
  // user-added rows with no focus). We do NOT fall back to every recruiter the
  // company has — that dumped senior recruiters onto new-grad cards and vice
  // versa. If nothing matches this level, the card simply shows none.
  const matched = recruiters.filter((r) => {
    const f = r.role_focus;
    return !f || f === 'generic' || f === wanted;
  });
  // Rank: exact-focus first, then generic/legacy — most relevant on top.
  return [...matched].sort((a, b) => {
    const score = (r: Recruiter) => (r.role_focus === wanted ? 0 : 1);
    return score(a) - score(b);
  });
}

// =============================================================================
// SMART FILTER TYPES
// =============================================================================

export type SmartFilter =
  | 'hidden_gems'
  | 'hot_now'
  | 'new_grad_only'
  | 'closing_soon'
  | 'high_paying';

export const SMART_FILTER_CONFIG: Record<
  SmartFilter,
  { label: string; description: string; icon: string; gradient: string }
> = {
  hidden_gems: {
    label: 'Hidden Gems',
    description: 'Jobs from exclusive sources not on LinkedIn/Indeed',
    icon: 'gem',
    gradient: 'from-purple-500 to-pink-500',
  },
  hot_now: {
    label: 'Hot Now',
    description: 'Trending jobs with high application activity',
    icon: 'flame',
    gradient: 'from-orange-500 to-red-500',
  },
  new_grad_only: {
    label: 'New Grad Only',
    description: 'Positions explicitly for new graduates',
    icon: 'graduation-cap',
    gradient: 'from-blue-500 to-cyan-500',
  },
  closing_soon: {
    label: 'Closing Soon',
    description: 'Applications closing within 7 days',
    icon: 'clock',
    gradient: 'from-amber-500 to-yellow-500',
  },
  high_paying: {
    label: 'High Paying',
    description: 'Salaries above $150k base',
    icon: 'dollar-sign',
    gradient: 'from-green-500 to-emerald-500',
  },
};

// =============================================================================
// PIPELINE TYPES
// =============================================================================

export type PipelineStage =
  | 'saved'
  | 'applied'
  | 'oa'
  | 'phone_screen'
  | 'technical'
  | 'onsite'
  | 'team_match'
  | 'offer'
  | 'negotiating'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted';

export interface Application {
  id: string;
  user_id: string;
  job_id: string | null;
  company_slug: string | null;
  company_name: string;
  job_title: string;
  job_url: string | null;
  // Pipeline stage tracking
  stage: PipelineStage;
  previous_stage: PipelineStage | null;
  stage_changed_at: string;
  // Stage timestamps
  saved_at: string;
  applied_at: string | null;
  oa_received_at: string | null;
  phone_screen_at: string | null;
  onsite_at: string | null;
  offer_at: string | null;
  final_decision_at: string | null;
  // Interview scheduling
  next_interview_at: string | null;
  interview_location: string | null;
  interview_notes: string | null;
  // Offer details
  offer_base_salary: number | null;
  offer_bonus: number | null;
  offer_equity: string | null;
  offer_deadline: string | null;
  // Rejection tracking
  rejection_reason: string | null;
  rejection_stage: PipelineStage | null;
  // Meta
  notes: string | null;
  priority: 0 | 1 | 2;
  source: 'manual' | 'saved_jobs_import' | 'auto_apply';
  referrer_name: string | null;
  referrer_contact: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  // Activity tracking (computed from stage_changed_at or updated_at)
  last_activity: string;
  next_step: string | null;
  next_step_date: string | null;
  // Salary offered (alias for total comp)
  salary_offered: number | null;
  // Joined relations
  job?: Job;
  events?: ApplicationEvent[];
}

export interface ApplicationEvent {
  id: string;
  application_id: string;
  event_type: 'stage_change' | 'note_added' | 'reminder_set' | 'interview_scheduled' | 'feedback_received';
  from_stage: PipelineStage | null;
  to_stage: PipelineStage | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export const PIPELINE_STAGES: {
  value: PipelineStage;
  label: string;
  color: string;
  bgColor: string;
  icon: string;
  description: string;
}[] = [
  {
    value: 'saved',
    label: 'Saved',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    icon: 'bookmark',
    description: 'Saved for later',
  },
  {
    value: 'applied',
    label: 'Applied',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    icon: 'send',
    description: 'Application submitted',
  },
  {
    value: 'oa',
    label: 'OA',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-100',
    icon: 'code',
    description: 'Online assessment',
  },
  {
    value: 'phone_screen',
    label: 'Phone Screen',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    icon: 'phone',
    description: 'Phone/recruiter screen',
  },
  {
    value: 'technical',
    label: 'Technical',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-100',
    icon: 'terminal',
    description: 'Technical interview',
  },
  {
    value: 'onsite',
    label: 'Onsite',
    color: 'text-teal-600',
    bgColor: 'bg-teal-100',
    icon: 'building',
    description: 'Onsite/final round',
  },
  {
    value: 'team_match',
    label: 'Team Match',
    color: 'text-violet-600',
    bgColor: 'bg-violet-100',
    icon: 'users',
    description: 'Team matching phase',
  },
  {
    value: 'offer',
    label: 'Offer',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    icon: 'check-circle',
    description: 'Received offer',
  },
  {
    value: 'negotiating',
    label: 'Negotiating',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-100',
    icon: 'message-circle',
    description: 'Negotiating offer terms',
  },
  {
    value: 'accepted',
    label: 'Accepted',
    color: 'text-green-700',
    bgColor: 'bg-green-200',
    icon: 'check-check',
    description: 'Accepted offer',
  },
  {
    value: 'rejected',
    label: 'Rejected',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    icon: 'x-circle',
    description: 'Application rejected',
  },
  {
    value: 'withdrawn',
    label: 'Withdrawn',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
    icon: 'arrow-left',
    description: 'Withdrew application',
  },
  {
    value: 'ghosted',
    label: 'Ghosted',
    color: 'text-gray-400',
    bgColor: 'bg-gray-50',
    icon: 'ghost',
    description: 'No response received',
  },
];

// =============================================================================
// RECOMMENDATIONS TYPES
// =============================================================================

export interface MatchScore {
  overall: number; // 0-100
  breakdown: {
    roleMatch: number;
    locationMatch: number;
    salaryMatch: number;
    companyMatch: number;
    experienceMatch: number;
  };
  matchedReasons: string[];
}

export interface UserMatchPreferences {
  user_id: string;
  // Explicit preferences (user-specified)
  preferred_roles: RoleType[];
  preferred_tiers: Tier[];
  preferred_locations: string[];
  remote_preference: WorkMode | 'any' | null;
  salary_min_expectation: number | null;
  preferred_company_sizes: CompanySize[];
  preferred_industries: string[];
  skills: string[];
  // Implicit preferences (auto-learned from behavior)
  implicit_roles: RoleType[];
  implicit_tiers: Tier[];
  implicit_companies: string[];
  created_at: string;
  updated_at: string;
}

// =============================================================================
// HISTORICAL TYPES
// =============================================================================

export type HiringSeason = 'fall' | 'winter' | 'spring' | 'summer';

export interface CompanyHiringStats {
  company_slug: string;
  year: number;
  season: HiringSeason;
  jobs_posted: number;
  avg_time_to_close: number; // days
  peak_month: number; // 1-12
  new_grad_roles: number;
  total_applications: number | null;
}

export interface HiringPrediction {
  company_slug: string;
  predicted_month: number;
  confidence: number; // 0-1
  historical_avg_jobs: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  last_updated: string;
}

export const MONTH_NAMES: string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const VELOCITY_COLORS: Record<string, string> = {
  high: 'text-green-600',
  medium: 'text-yellow-600',
  low: 'text-red-600',
  none: 'text-gray-400',
};

// =============================================================================
// DISPLAY CONSTANTS - DIVERSITY TAGS
// =============================================================================

export const DIVERSITY_TAG_LABELS: Record<DiversityTag, string> = {
  ghc_sponsor: 'GHC Sponsor',
  nsbe_sponsor: 'NSBE Sponsor',
  shpe_sponsor: 'SHPE Sponsor',
  tapia_sponsor: 'Tapia Sponsor',
  afrotech_sponsor: 'AfroTech Sponsor',
  outtie_sponsor: 'Outtie Sponsor',
  lesbians_who_tech_sponsor: 'Lesbians Who Tech',
  techqueria_sponsor: 'Techqueria Sponsor',
  diversity_focused: 'Diversity Focused',
};

export const DIVERSITY_TAG_COLORS: Record<DiversityTag, string> = {
  ghc_sponsor: 'bg-fuchsia-100 text-fuchsia-700',
  nsbe_sponsor: 'bg-amber-100 text-amber-700',
  shpe_sponsor: 'bg-orange-100 text-orange-700',
  tapia_sponsor: 'bg-teal-100 text-teal-700',
  afrotech_sponsor: 'bg-purple-100 text-purple-700',
  outtie_sponsor: 'bg-pink-100 text-pink-700',
  lesbians_who_tech_sponsor: 'bg-rose-100 text-rose-700',
  techqueria_sponsor: 'bg-lime-100 text-lime-700',
  diversity_focused: 'bg-indigo-100 text-indigo-700',
};

// =============================================================================
// DISPLAY CONSTANTS - WORK MODE
// =============================================================================

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  flexible: 'Flexible',
};

export const WORK_MODE_COLORS: Record<WorkMode, string> = {
  remote: 'bg-green-100 text-green-700',
  hybrid: 'bg-blue-100 text-blue-700',
  onsite: 'bg-gray-100 text-gray-700',
  flexible: 'bg-purple-100 text-purple-700',
};

// =============================================================================
// DISPLAY CONSTANTS - BADGE TAGS
// =============================================================================

export const BADGE_TAG_LABELS: Record<BadgeTag, string> = {
  just_funded: 'Just Funded',
  hot_hiring: 'Hot Hiring',
  fast_growing: 'Fast Growing',
  closing_soon: 'Closing Soon',
  high_paying: 'High Paying',
  new_listing: 'New Listing',
  hidden_gem: 'Hidden Gem',
  quick_apply: 'Quick Apply',
  no_cover_letter: 'No Cover Letter',
  referral_available: 'Referral Available',
};

export const BADGE_TAG_COLORS: Record<BadgeTag, string> = {
  just_funded: 'bg-gradient-to-r from-emerald-500 to-green-500 text-white',
  hot_hiring: 'bg-gradient-to-r from-orange-500 to-red-500 text-white',
  fast_growing: 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white',
  closing_soon: 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black',
  high_paying: 'bg-gradient-to-r from-green-600 to-emerald-600 text-white',
  new_listing: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white',
  hidden_gem: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white',
  quick_apply: 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white',
  no_cover_letter: 'bg-gray-100 text-gray-700',
  referral_available: 'bg-gradient-to-r from-violet-500 to-purple-500 text-white',
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Diversity sources for jobs discovered through diversity-focused channels
const DIVERSITY_SOURCES: DiscoverySource[] = [
  'grace_hopper',
  'tapia',
  'nsbe',
  'shpe',
  'outtie',
  'lesbians_who_tech',
  'afrotech',
  'techqueria',
];

/**
 * Check if a discovery source is diversity-focused
 */
export function isDiversitySource(source: DiscoverySource): boolean {
  return DIVERSITY_SOURCES.includes(source);
}

/**
 * Get the diversity tag for a given discovery source
 */
export function getDiversitySource(source: DiscoverySource): DiversityTag | null {
  const sourceToTag: Partial<Record<DiscoverySource, DiversityTag>> = {
    grace_hopper: 'ghc_sponsor',
    tapia: 'tapia_sponsor',
    nsbe: 'nsbe_sponsor',
    shpe: 'shpe_sponsor',
    outtie: 'outtie_sponsor',
    lesbians_who_tech: 'lesbians_who_tech_sponsor',
    afrotech: 'afrotech_sponsor',
    techqueria: 'techqueria_sponsor',
  };
  return sourceToTag[source] || null;
}

/**
 * Check if a job has diversity focus based on its source or tags
 */
export function hasDiversityFocus(job: Job & { discovery_source?: DiscoverySource; tags?: DiversityTag[] }): boolean {
  if (job.discovery_source && isDiversitySource(job.discovery_source)) {
    return true;
  }
  if (job.tags && job.tags.length > 0) {
    return true;
  }
  return false;
}

/**
 * Check if a job qualifies as a "Hidden Gem" based on source and metrics
 */
// =============================================================================
// JOB ALERT TYPES
// =============================================================================

export type DeliveryMode = 'instant' | 'daily_digest' | 'weekly_digest';

export interface JobAlert {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  delivery_mode: DeliveryMode;
  push_enabled: boolean;
  email_enabled: boolean;
  filters: Record<string, unknown>;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
}

// =============================================================================
// STORY BANK TYPES
// =============================================================================

export type StoryType =
  | 'project'
  | 'teamwork'
  | 'conflict'
  | 'leadership'
  | 'failure'
  | 'achievement'
  | 'technical'
  | 'growth';

export type StoryContext =
  | 'internship'
  | 'class'
  | 'personal'
  | 'hackathon'
  | 'work'
  | 'research'
  | 'volunteer';

export type QuestionCategory =
  | 'why_company'
  | 'why_role'
  | 'challenging_project'
  | 'teamwork'
  | 'conflict_resolution'
  | 'failure_learning'
  | 'leadership'
  | 'problem_solving'
  | 'strengths'
  | 'weaknesses'
  | 'career_goals'
  | 'achievement'
  | 'generic';

export interface StoryResult {
  metric: string;
  value: string;
  description: string;
}

export interface UserStory {
  id: string;
  user_id: string;
  story_type: StoryType;
  title: string;
  context: StoryContext | null;
  organization: string | null;
  situation: string;
  task: string;
  actions: string[];
  results: StoryResult[];
  team_size: number | null;
  duration: string | null;
  technologies: string[];
  skills_demonstrated: string[];
  challenges_faced: string[];
  lessons_learned: string[];
  applicable_categories: QuestionCategory[];
  strength_rating: number | null;
  times_used: number;
  last_used_at: string | null;
  last_used_company: string | null;
  created_at: string;
  updated_at: string;
}

export type AnswerStructure = 'result_first' | 'challenge_first' | 'standard_star' | 'chronological';

export interface GeneratedAnswer {
  id: string;
  user_id: string;
  story_id: string | null;
  question_category: QuestionCategory;
  word_count_target: number;
  variation_index: number;
  answer_text: string;
  answer_structure: AnswerStructure | null;
  variable_slots: Record<string, string | null>;
  generation_model: string | null;
  generation_prompt_version: string | null;
  times_used: number;
  last_used_at: string | null;
  created_at: string;
}

export interface CompanyAnswer {
  id: string;
  user_id: string;
  company_slug: string;
  company_name: string;
  why_company_short: string | null;
  why_company_standard: string | null;
  why_company_long: string | null;
  company_mission: string | null;
  company_products: string[] | null;
  recent_news: string[] | null;
  user_connection: string | null;
  relevant_experience: string | null;
  generated_at: string | null;
  generation_model: string | null;
  created_at: string;
  updated_at: string;
}

export const STORY_TYPE_LABELS: Record<StoryType, string> = {
  project: 'Project',
  teamwork: 'Teamwork',
  conflict: 'Conflict Resolution',
  leadership: 'Leadership',
  failure: 'Failure & Learning',
  achievement: 'Achievement',
  technical: 'Technical Challenge',
  growth: 'Personal Growth',
};

export const STORY_TYPE_ICONS: Record<StoryType, string> = {
  project: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  teamwork: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  conflict: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  leadership: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  failure: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  achievement: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
  technical: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
  growth: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
};

export const STORY_CONTEXT_LABELS: Record<StoryContext, string> = {
  internship: 'Internship',
  class: 'Class/Academic',
  personal: 'Personal Project',
  hackathon: 'Hackathon',
  work: 'Work Experience',
  research: 'Research',
  volunteer: 'Volunteer',
};

export const QUESTION_CATEGORY_LABELS: Record<QuestionCategory, string> = {
  why_company: 'Why This Company',
  why_role: 'Why This Role',
  challenging_project: 'Challenging Project',
  teamwork: 'Teamwork Experience',
  conflict_resolution: 'Conflict Resolution',
  failure_learning: 'Failure & Learning',
  leadership: 'Leadership Example',
  problem_solving: 'Problem Solving',
  strengths: 'Strengths',
  weaknesses: 'Weaknesses',
  career_goals: 'Career Goals',
  achievement: 'Greatest Achievement',
  generic: 'General',
};

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  instant: 'Instant',
  daily_digest: 'Daily Digest',
  weekly_digest: 'Weekly Digest',
};

// =============================================================================
// ANSWER GENERATION QUEUE TYPES
// =============================================================================

export type AnswerQueueStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface AnswerQueueItem {
  id: string;
  user_id: string;
  company_slug: string;
  company_name: string;
  status: AnswerQueueStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  last_attempt_at: string | null;
  error_message: string | null;
  answer_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NotificationType = 'answer_ready' | 'job_alert' | 'application_update' | 'system';

export interface UserNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  reference_type: string | null;
  reference_id: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const ANSWER_QUEUE_STATUS_LABELS: Record<AnswerQueueStatus, string> = {
  pending: 'Queued',
  processing: 'Generating...',
  completed: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const ANSWER_QUEUE_STATUS_COLORS: Record<AnswerQueueStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

export function isHiddenGemJob(
  job: Job & { application_count?: number; view_count?: number }
): boolean {
  // Must be from a hidden gem source
  if (!isHiddenGem(job.source)) {
    return false;
  }

  // Low application count relative to views indicates undiscovered opportunity
  if (job.application_count !== undefined && job.view_count !== undefined) {
    const applicationRate = job.view_count > 0 ? job.application_count / job.view_count : 0;
    // Low application rate (<5%) means hidden gem
    return applicationRate < 0.05;
  }

  // Default to true if from hidden gem source and no metrics available
  return true;
}
