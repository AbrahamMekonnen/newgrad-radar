/**
 * Levels.fyi Salary Data (New Grad / Entry Level)
 *
 * Curated from levels.fyi for common tech companies.
 * Updated: September 2026
 *
 * These are total compensation figures (base + bonus + equity).
 * We show base salary ranges which are typically 60-75% of TC.
 *
 * Source: https://www.levels.fyi/t/software-engineer/levels/entry-level
 */

export interface LevelsSalaryData {
  company: string;
  level: string;
  baseSalaryMin: number;
  baseSalaryMax: number;
  totalCompMin: number;
  totalCompMax: number;
  location: string;
  lastUpdated: string;
}

// New grad base salary ranges from levels.fyi
// These are BASE salary only (not total comp)
export const LEVELS_FYI_NEW_GRAD: Record<string, LevelsSalaryData> = {
  // FAANG / Big Tech
  google: {
    company: 'Google',
    level: 'L3',
    baseSalaryMin: 150000,
    baseSalaryMax: 175000,
    totalCompMin: 190000,
    totalCompMax: 250000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  meta: {
    company: 'Meta',
    level: 'E3',
    baseSalaryMin: 155000,
    baseSalaryMax: 175000,
    totalCompMin: 200000,
    totalCompMax: 260000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  apple: {
    company: 'Apple',
    level: 'ICT2',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 180000,
    totalCompMax: 230000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  amazon: {
    company: 'Amazon',
    level: 'SDE I',
    baseSalaryMin: 130000,
    baseSalaryMax: 155000,
    totalCompMin: 150000,
    totalCompMax: 200000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  microsoft: {
    company: 'Microsoft',
    level: 'SDE 59',
    baseSalaryMin: 125000,
    baseSalaryMax: 150000,
    totalCompMin: 155000,
    totalCompMax: 200000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  netflix: {
    company: 'Netflix',
    level: 'New Grad',
    baseSalaryMin: 180000,
    baseSalaryMax: 220000,
    totalCompMin: 350000,
    totalCompMax: 450000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  nvidia: {
    company: 'NVIDIA',
    level: 'New Grad',
    baseSalaryMin: 150000,
    baseSalaryMax: 180000,
    totalCompMin: 200000,
    totalCompMax: 280000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },

  // AI Companies
  openai: {
    company: 'OpenAI',
    level: 'L3',
    baseSalaryMin: 180000,
    baseSalaryMax: 220000,
    totalCompMin: 300000,
    totalCompMax: 450000,
    location: 'SF',
    lastUpdated: '2026-09',
  },
  anthropic: {
    company: 'Anthropic',
    level: 'New Grad',
    baseSalaryMin: 175000,
    baseSalaryMax: 210000,
    totalCompMin: 280000,
    totalCompMax: 400000,
    location: 'SF',
    lastUpdated: '2026-09',
  },
  'scale-ai': {
    company: 'Scale AI',
    level: 'New Grad',
    baseSalaryMin: 160000,
    baseSalaryMax: 185000,
    totalCompMin: 200000,
    totalCompMax: 280000,
    location: 'SF',
    lastUpdated: '2026-09',
  },

  // Unicorns
  stripe: {
    company: 'Stripe',
    level: 'L2',
    baseSalaryMin: 160000,
    baseSalaryMax: 190000,
    totalCompMin: 220000,
    totalCompMax: 300000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  databricks: {
    company: 'Databricks',
    level: 'New Grad',
    baseSalaryMin: 155000,
    baseSalaryMax: 180000,
    totalCompMin: 200000,
    totalCompMax: 280000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  snowflake: {
    company: 'Snowflake',
    level: 'New Grad',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 180000,
    totalCompMax: 250000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  coinbase: {
    company: 'Coinbase',
    level: 'L2',
    baseSalaryMin: 150000,
    baseSalaryMax: 175000,
    totalCompMin: 200000,
    totalCompMax: 280000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  airbnb: {
    company: 'Airbnb',
    level: 'L3',
    baseSalaryMin: 155000,
    baseSalaryMax: 180000,
    totalCompMin: 200000,
    totalCompMax: 270000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  uber: {
    company: 'Uber',
    level: 'L3',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 180000,
    totalCompMax: 240000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  lyft: {
    company: 'Lyft',
    level: 'L3',
    baseSalaryMin: 140000,
    baseSalaryMax: 165000,
    totalCompMin: 170000,
    totalCompMax: 220000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  doordash: {
    company: 'DoorDash',
    level: 'E3',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 180000,
    totalCompMax: 240000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  instacart: {
    company: 'Instacart',
    level: 'L3',
    baseSalaryMin: 140000,
    baseSalaryMax: 165000,
    totalCompMin: 170000,
    totalCompMax: 230000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  figma: {
    company: 'Figma',
    level: 'E3',
    baseSalaryMin: 150000,
    baseSalaryMax: 175000,
    totalCompMin: 200000,
    totalCompMax: 270000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  notion: {
    company: 'Notion',
    level: 'New Grad',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 190000,
    totalCompMax: 260000,
    location: 'SF',
    lastUpdated: '2026-09',
  },
  discord: {
    company: 'Discord',
    level: 'L3',
    baseSalaryMin: 140000,
    baseSalaryMax: 165000,
    totalCompMin: 180000,
    totalCompMax: 240000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },

  // Fintech
  robinhood: {
    company: 'Robinhood',
    level: 'New Grad',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 180000,
    totalCompMax: 250000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  plaid: {
    company: 'Plaid',
    level: 'L2',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 180000,
    totalCompMax: 250000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  ramp: {
    company: 'Ramp',
    level: 'New Grad',
    baseSalaryMin: 150000,
    baseSalaryMax: 175000,
    totalCompMin: 200000,
    totalCompMax: 280000,
    location: 'NYC',
    lastUpdated: '2026-09',
  },
  square: {
    company: 'Square/Block',
    level: 'SWE I',
    baseSalaryMin: 140000,
    baseSalaryMax: 165000,
    totalCompMin: 170000,
    totalCompMax: 230000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },

  // Defense/Gov Tech
  anduril: {
    company: 'Anduril',
    level: 'New Grad',
    baseSalaryMin: 140000,
    baseSalaryMax: 165000,
    totalCompMin: 170000,
    totalCompMax: 230000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  palantir: {
    company: 'Palantir',
    level: 'New Grad',
    baseSalaryMin: 140000,
    baseSalaryMax: 165000,
    totalCompMin: 180000,
    totalCompMax: 250000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },

  // Enterprise SaaS
  salesforce: {
    company: 'Salesforce',
    level: 'AMTS',
    baseSalaryMin: 130000,
    baseSalaryMax: 155000,
    totalCompMin: 160000,
    totalCompMax: 210000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  linkedin: {
    company: 'LinkedIn',
    level: 'SWE',
    baseSalaryMin: 135000,
    baseSalaryMax: 160000,
    totalCompMin: 170000,
    totalCompMax: 220000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  dropbox: {
    company: 'Dropbox',
    level: 'L2',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 180000,
    totalCompMax: 240000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  atlassian: {
    company: 'Atlassian',
    level: 'P2',
    baseSalaryMin: 130000,
    baseSalaryMax: 155000,
    totalCompMin: 160000,
    totalCompMax: 210000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  datadog: {
    company: 'Datadog',
    level: 'New Grad',
    baseSalaryMin: 145000,
    baseSalaryMax: 170000,
    totalCompMin: 180000,
    totalCompMax: 250000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  cloudflare: {
    company: 'Cloudflare',
    level: 'New Grad',
    baseSalaryMin: 135000,
    baseSalaryMax: 160000,
    totalCompMin: 165000,
    totalCompMax: 220000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  twilio: {
    company: 'Twilio',
    level: 'L2',
    baseSalaryMin: 130000,
    baseSalaryMax: 155000,
    totalCompMin: 160000,
    totalCompMax: 210000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  okta: {
    company: 'Okta',
    level: 'SWE I',
    baseSalaryMin: 125000,
    baseSalaryMax: 150000,
    totalCompMin: 155000,
    totalCompMax: 200000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  mongodb: {
    company: 'MongoDB',
    level: 'L2',
    baseSalaryMin: 130000,
    baseSalaryMax: 155000,
    totalCompMin: 160000,
    totalCompMax: 215000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  hashicorp: {
    company: 'HashiCorp',
    level: 'P1',
    baseSalaryMin: 130000,
    baseSalaryMax: 155000,
    totalCompMin: 160000,
    totalCompMax: 210000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
  confluent: {
    company: 'Confluent',
    level: 'L2',
    baseSalaryMin: 135000,
    baseSalaryMax: 160000,
    totalCompMin: 170000,
    totalCompMax: 230000,
    location: 'US Average',
    lastUpdated: '2026-09',
  },
};

/**
 * Get levels.fyi salary data for a company
 */
export function getLevelsFyiSalary(companySlug: string): LevelsSalaryData | null {
  const normalized = companySlug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return LEVELS_FYI_NEW_GRAD[normalized] || null;
}

/**
 * Get just the base salary range
 */
export function getLevelsFyiBaseSalary(
  companySlug: string
): { min: number; max: number; source: string } | null {
  const data = getLevelsFyiSalary(companySlug);
  if (!data) return null;

  return {
    min: data.baseSalaryMin,
    max: data.baseSalaryMax,
    source: 'levels.fyi',
  };
}

/**
 * List of companies we have levels.fyi data for
 */
export function getAvailableCompanies(): string[] {
  return Object.keys(LEVELS_FYI_NEW_GRAD);
}
