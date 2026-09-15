/**
 * Salary Data Sources for HireRadar
 *
 * Research and implementation guide for integrating salary data into job listings.
 * Focus: FREE and publicly available data sources.
 */

// =============================================================================
// RECOMMENDED: H1B LCA Disclosure Data (Department of Labor)
// =============================================================================
//
// WHY THIS IS THE BEST FREE OPTION:
// - 100% free and public (government mandate)
// - Actual salary data, not self-reported
// - Covers tech companies extensively (high H1B visa usage)
// - Updated quarterly
// - Granular: company, role, location, salary range
//
// HOW TO ACCESS:
// URL: https://www.dol.gov/agencies/eta/foreign-labor/performance
// Direct link: https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2024_Q4.xlsx
//
// DATA FORMAT (Excel/CSV columns):
// - CASE_NUMBER: Unique identifier
// - CASE_STATUS: Certified, Denied, Withdrawn
// - EMPLOYER_NAME: Company name (e.g., "GOOGLE LLC", "META PLATFORMS INC")
// - JOB_TITLE: Position title (e.g., "SOFTWARE ENGINEER")
// - SOC_CODE: Standard Occupational Classification
// - SOC_TITLE: Occupation category
// - WAGE_RATE_OF_PAY_FROM: Minimum salary
// - WAGE_RATE_OF_PAY_TO: Maximum salary (often same as FROM)
// - WAGE_UNIT_OF_PAY: Year, Month, Bi-Weekly, Week, Hour
// - WORKSITE_CITY: Location city
// - WORKSITE_STATE: Location state
// - PREVAILING_WAGE: DOL-determined wage for that occupation/location
//
// UPDATE FREQUENCY: Quarterly (Jan, Apr, Jul, Oct)
//
// MAPPING TO OUR JOB LISTINGS:
// 1. Match by company_name (fuzzy match needed: "Google LLC" vs "Google")
// 2. Match by job_title similarity (use keyword extraction)
// 3. Match by location (state/city)
// 4. Filter by CASE_STATUS = "Certified" only
// =============================================================================

export interface H1BSalaryData {
  employer_name: string;
  job_title: string;
  soc_code: string;
  soc_title: string;
  wage_from: number;
  wage_to: number;
  wage_unit: 'Year' | 'Month' | 'Bi-Weekly' | 'Week' | 'Hour';
  city: string;
  state: string;
  prevailing_wage: number;
  case_status: string;
  begin_date: string;
}

export interface SalaryRange {
  min: number;
  max: number;
  median: number;
  count: number; // number of data points
  source: 'h1b' | 'levels' | 'user';
}

// Company name normalization for matching
export const COMPANY_NAME_MAP: Record<string, string[]> = {
  'google': ['GOOGLE LLC', 'GOOGLE INC', 'ALPHABET INC'],
  'meta': ['META PLATFORMS INC', 'FACEBOOK INC'],
  'apple': ['APPLE INC'],
  'amazon': ['AMAZON.COM SERVICES LLC', 'AMAZON WEB SERVICES INC', 'AMAZON.COM INC'],
  'microsoft': ['MICROSOFT CORPORATION'],
  'netflix': ['NETFLIX INC'],
  'nvidia': ['NVIDIA CORPORATION'],
  'stripe': ['STRIPE INC'],
  'openai': ['OPENAI LLC', 'OPENAI INC'],
  'anthropic': ['ANTHROPIC PBC'],
  'coinbase': ['COINBASE INC', 'COINBASE GLOBAL INC'],
  'robinhood': ['ROBINHOOD MARKETS INC', 'ROBINHOOD FINANCIAL LLC'],
  'databricks': ['DATABRICKS INC'],
  'snowflake': ['SNOWFLAKE INC', 'SNOWFLAKE COMPUTING INC'],
  'datadog': ['DATADOG INC'],
  'cloudflare': ['CLOUDFLARE INC'],
  'figma': ['FIGMA INC'],
  'notion': ['NOTION LABS INC'],
  'discord': ['DISCORD INC'],
  'airbnb': ['AIRBNB INC'],
  'uber': ['UBER TECHNOLOGIES INC'],
  'lyft': ['LYFT INC'],
  'doordash': ['DOORDASH INC'],
  'instacart': ['MAPLEBEAR INC'], // Instacart's legal name
  'plaid': ['PLAID INC'],
  'ramp': ['RAMP BUSINESS CORPORATION'],
  'scale': ['SCALE AI INC'],
  'anduril': ['ANDURIL INDUSTRIES INC'],
  'palantir': ['PALANTIR TECHNOLOGIES INC'],
  'salesforce': ['SALESFORCE INC', 'SALESFORCE.COM INC'],
  'linkedin': ['LINKEDIN CORPORATION'],
  'dropbox': ['DROPBOX INC'],
  'square': ['BLOCK INC', 'SQUARE INC'],
  'twilio': ['TWILIO INC'],
  'splunk': ['SPLUNK INC'],
  'okta': ['OKTA INC'],
  'atlassian': ['ATLASSIAN INC', 'ATLASSIAN US INC'],
  'elastic': ['ELASTIC N.V.', 'ELASTICSEARCH INC'],
  'hashicorp': ['HASHICORP INC'],
  'mongodb': ['MONGODB INC'],
  'confluent': ['CONFLUENT INC'],
};

// Job title keywords for SWE roles
export const SWE_TITLE_KEYWORDS = [
  'software engineer',
  'software developer',
  'sde',
  'swe',
  'full stack',
  'fullstack',
  'backend engineer',
  'frontend engineer',
  'web developer',
  'application developer',
  'platform engineer',
  'systems engineer',
  'infrastructure engineer',
  'site reliability',
  'devops engineer',
  'ml engineer',
  'machine learning engineer',
  'data engineer',
  'mobile engineer',
  'ios engineer',
  'android engineer',
];

// New grad level indicators in titles
export const NEW_GRAD_INDICATORS = [
  'new grad',
  'entry level',
  'junior',
  'associate',
  'level 1',
  'level i',
  'l3', // Google L3
  'e3', // Meta E3
  'sde i', // Amazon SDE I
  'sde 1',
  'software engineer i',
  'software engineer 1',
];

/**
 * Normalizes wage to annual salary
 */
export function normalizeToAnnualSalary(wage: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'year':
      return wage;
    case 'month':
      return wage * 12;
    case 'bi-weekly':
      return wage * 26;
    case 'week':
      return wage * 52;
    case 'hour':
      return wage * 2080; // 40 hrs/week * 52 weeks
    default:
      return wage;
  }
}

/**
 * Fuzzy match company names
 */
export function matchCompanyName(companySlug: string, h1bEmployerName: string): boolean {
  const slug = companySlug.toLowerCase().replace(/[^a-z0-9]/g, '');
  const h1bName = h1bEmployerName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Direct match
  if (h1bName.includes(slug) || slug.includes(h1bName)) {
    return true;
  }

  // Check known mappings
  const knownNames = COMPANY_NAME_MAP[slug];
  if (knownNames) {
    return knownNames.some(name =>
      h1bEmployerName.toUpperCase().includes(name) ||
      name.includes(h1bEmployerName.toUpperCase())
    );
  }

  return false;
}

/**
 * Check if job title is relevant for SWE roles
 */
export function isSWETitle(title: string): boolean {
  const lower = title.toLowerCase();
  return SWE_TITLE_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Check if job title indicates new grad level
 */
export function isNewGradLevel(title: string): boolean {
  const lower = title.toLowerCase();
  return NEW_GRAD_INDICATORS.some(indicator => lower.includes(indicator));
}


// =============================================================================
// OTHER DATA SOURCES (Limited Free Access)
// =============================================================================

/**
 * LEVELS.FYI
 *
 * Status: No public API
 * Access: Web scraping only (against ToS)
 * Data: Crowdsourced salary reports
 * Quality: High - verified by community
 *
 * Alternative: They offer data licensing for businesses.
 * Contact: https://www.levels.fyi/company-api/
 *
 * Note: Their data is extremely valuable but not freely accessible via API.
 * They do have an internal API at:
 * - https://www.levels.fyi/js/salaryData.json (may change)
 * - Not documented, not stable, may violate ToS
 */

/**
 * GLASSDOOR
 *
 * Status: API requires partnership
 * Access: https://www.glassdoor.com/developer/index.htm (deprecated)
 *
 * Glassdoor shut down their public API in 2020.
 * Now only available through their "Partners" program for large companies.
 * Not viable for free use.
 */

/**
 * LINKEDIN SALARY INSIGHTS
 *
 * Status: No public API
 * Access: Only through LinkedIn Premium or Talent Solutions
 *
 * Not accessible without enterprise licensing.
 */

/**
 * BUREAU OF LABOR STATISTICS (BLS)
 *
 * Status: Free public API
 * URL: https://www.bls.gov/developers/
 *
 * Data: Occupation-level statistics (not company-specific)
 * Useful for: National/regional averages by occupation
 * Limitation: Too broad - not company or job-specific
 *
 * API Example:
 * GET https://api.bls.gov/publicAPI/v2/timeseries/data/OEUM000000000000015121103
 * (Software Developers national average)
 */


// =============================================================================
// IMPLEMENTATION PLAN
// =============================================================================
//
// PHASE 1: H1B Data Integration (Recommended)
//
// 1. Download quarterly H1B disclosure file
//    - Automate via GitHub Action or manual quarterly update
//    - File size: ~100-200MB per quarter
//
// 2. Process and filter data:
//    - Filter CASE_STATUS = 'Certified'
//    - Filter by our tracked companies (COMPANY_NAME_MAP)
//    - Filter by SWE-related job titles
//    - Normalize salaries to annual
//
// 3. Store in Supabase:
//    CREATE TABLE h1b_salaries (
//      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//      company_slug TEXT REFERENCES companies(slug),
//      job_title TEXT,
//      soc_code TEXT,
//      wage_min INTEGER,
//      wage_max INTEGER,
//      city TEXT,
//      state TEXT,
//      fiscal_year INTEGER,
//      quarter INTEGER,
//      created_at TIMESTAMP DEFAULT NOW()
//    );
//
// 4. Display salary ranges on job cards:
//    - Show estimated range based on company + role + location
//    - Note: "Based on H1B visa filings"
//
// 5. API endpoint:
//    GET /api/salary?company=google&role=swe&location=CA
//    Returns: { min: 150000, max: 220000, median: 185000, count: 342 }
//
//
// PHASE 2: User-Reported Data (Future)
//
// Allow users to submit their own salary data:
// - Verify with offer letter upload (optional)
// - Anonymize and aggregate
// - Supplement H1B data with internship/new grad offers
//
//
// DATA FRESHNESS:
// - H1B data is 1-4 months old (quarterly release)
// - For new grad roles, this is acceptable since:
//   - Starting salaries change less frequently than senior roles
//   - Companies typically have standard new grad bands
// =============================================================================


// =============================================================================
// QUICK START: Download and Process H1B Data
// =============================================================================
//
// Manual download:
// 1. Go to: https://www.dol.gov/agencies/eta/foreign-labor/performance
// 2. Click "LCA Programs" -> "Disclosure Data"
// 3. Download latest fiscal year Excel file
//
// Python processing script (scraper/process_h1b.py):
// ```python
// import pandas as pd
//
// # Load H1B disclosure data
// df = pd.read_excel('LCA_Disclosure_Data_FY2024_Q4.xlsx')
//
// # Filter certified cases
// df = df[df['CASE_STATUS'] == 'Certified']
//
// # Filter SWE roles
// swe_keywords = ['software', 'engineer', 'developer', 'sde', 'swe']
// df = df[df['JOB_TITLE'].str.lower().str.contains('|'.join(swe_keywords), na=False)]
//
// # Normalize to annual salary
// def normalize_wage(row):
//     wage = row['WAGE_RATE_OF_PAY_FROM']
//     unit = row['WAGE_UNIT_OF_PAY']
//     if unit == 'Hour':
//         return wage * 2080
//     elif unit == 'Week':
//         return wage * 52
//     elif unit == 'Month':
//         return wage * 12
//     return wage
//
// df['annual_salary'] = df.apply(normalize_wage, axis=1)
//
// # Group by company
// company_salaries = df.groupby('EMPLOYER_NAME')['annual_salary'].agg(['min', 'max', 'median', 'count'])
//
// # Export for Supabase import
// company_salaries.to_csv('h1b_salaries.csv')
// ```
// =============================================================================

export const H1B_DATA_URL = 'https://www.dol.gov/agencies/eta/foreign-labor/performance';

export const SALARY_SOURCE_METADATA = {
  h1b: {
    name: 'H1B LCA Disclosure',
    description: 'Official Department of Labor H1B visa wage data',
    reliability: 'high',
    freshness: 'quarterly',
    coverage: 'tech-heavy (visa-sponsoring companies)',
    cost: 'free',
  },
  levels: {
    name: 'Levels.fyi',
    description: 'Crowdsourced salary data from tech workers',
    reliability: 'high',
    freshness: 'real-time',
    coverage: 'tech-focused',
    cost: 'paid (data licensing)',
  },
  bls: {
    name: 'Bureau of Labor Statistics',
    description: 'Government occupational statistics',
    reliability: 'high',
    freshness: 'annual',
    coverage: 'national averages only',
    cost: 'free',
  },
  user: {
    name: 'User Reported',
    description: 'Self-reported by job seekers',
    reliability: 'medium',
    freshness: 'real-time',
    coverage: 'dependent on user submissions',
    cost: 'free',
  },
};

// Typical new grad salary ranges by tier (2024-2025 estimates based on H1B data)
// These can serve as fallbacks when specific data is unavailable
export const ESTIMATED_NEW_GRAD_RANGES: Record<string, SalaryRange> = {
  faang: { min: 180000, max: 250000, median: 210000, count: 0, source: 'h1b' },
  ai: { min: 180000, max: 300000, median: 220000, count: 0, source: 'h1b' },
  unicorn: { min: 150000, max: 220000, median: 175000, count: 0, source: 'h1b' },
  fintech: { min: 140000, max: 200000, median: 165000, count: 0, source: 'h1b' },
  yc: { min: 120000, max: 180000, median: 145000, count: 0, source: 'h1b' },
  infra: { min: 130000, max: 190000, median: 155000, count: 0, source: 'h1b' },
};
