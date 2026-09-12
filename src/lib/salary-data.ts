/**
 * H1B LCA Salary Data Integration
 *
 * Uses Department of Labor H1B visa disclosure data (free, public, updated quarterly)
 * to provide salary ranges for job listings.
 */

import {
  H1BSalaryData,
  SalaryRange,
  COMPANY_NAME_MAP,
  ESTIMATED_NEW_GRAD_RANGES,
  normalizeToAnnualSalary,
  matchCompanyName,
  isSWETitle,
} from './salary-sources';

// =============================================================================
// Cache Configuration
// =============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// In-memory cache for salary data
const salaryCache = new Map<string, CacheEntry<SalaryRange>>();
const companyDataCache = new Map<string, CacheEntry<H1BSalaryData[]>>();

// Cache TTLs
const SALARY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const COMPANY_DATA_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// =============================================================================
// H1B Data API (using h1bdata.info API - free public API for H1B data)
// =============================================================================

const H1B_API_BASE = 'https://h1bdata.info/index.php';

/**
 * Fetch H1B salary data for a company from h1bdata.info
 * This is a free public API that aggregates DOL H1B disclosure data
 */
export async function fetchH1BDataForCompany(
  companyName: string,
  options?: { year?: number; jobTitle?: string }
): Promise<H1BSalaryData[]> {
  const cacheKey = `${companyName}-${options?.year || 'all'}-${options?.jobTitle || 'all'}`;
  const cached = companyDataCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }

  try {
    // Get the H1B employer name variations
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const employerNames = COMPANY_NAME_MAP[slug] || [companyName.toUpperCase()];

    const allData: H1BSalaryData[] = [];

    for (const employerName of employerNames.slice(0, 1)) {
      // Query first variation to avoid rate limiting
      const params = new URLSearchParams({
        em: employerName,
        year: options?.year?.toString() || '',
        job: options?.jobTitle || '',
      });

      const response = await fetch(`${H1B_API_BASE}?${params}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'NewGradRadar/1.0',
        },
        next: { revalidate: 86400 }, // Cache for 24 hours
      });

      if (!response.ok) {
        console.warn(`H1B API returned ${response.status} for ${employerName}`);
        continue;
      }

      // Parse HTML response to extract salary data
      // h1bdata.info returns HTML, so we need to parse it
      const html = await response.text();
      const parsed = parseH1BDataHTML(html, employerName);
      allData.push(...parsed);
    }

    // Cache the results
    companyDataCache.set(cacheKey, {
      data: allData,
      timestamp: Date.now(),
      ttl: COMPANY_DATA_TTL,
    });

    return allData;
  } catch (error) {
    console.error(`Error fetching H1B data for ${companyName}:`, error);
    return [];
  }
}

/**
 * Parse H1B data from HTML response (h1bdata.info format)
 * Returns structured salary data
 */
function parseH1BDataHTML(html: string, employerName: string): H1BSalaryData[] {
  const results: H1BSalaryData[] = [];

  // h1bdata.info returns data in table format
  // We'll extract using regex patterns for simplicity
  // In production, consider using a proper HTML parser

  // Pattern: extract table rows with salary data
  // Columns: Employer, Job Title, Base Salary, Location, Submit Date, Start Date, Case Status
  const rowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>\$?([\d,]+)[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const [, , jobTitle, salary, location] = match;

    if (!jobTitle || !salary) continue;

    const cleanTitle = stripHtml(jobTitle).trim();
    const cleanSalary = parseInt(salary.replace(/,/g, ''), 10);
    const cleanLocation = stripHtml(location).trim();

    if (isNaN(cleanSalary) || cleanSalary < 30000) continue;

    // Parse city and state from location
    const locationParts = cleanLocation.split(',').map(s => s.trim());
    const city = locationParts[0] || '';
    const state = locationParts[1] || '';

    results.push({
      employer_name: employerName,
      job_title: cleanTitle,
      soc_code: '',
      soc_title: '',
      wage_from: cleanSalary,
      wage_to: cleanSalary,
      wage_unit: 'Year',
      city,
      state,
      prevailing_wage: cleanSalary,
      case_status: 'Certified',
      begin_date: '',
    });
  }

  return results;
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

// =============================================================================
// Alternative: Use pre-processed H1B data from our database
// =============================================================================

// Supabase client type for H1B data queries
interface SupabaseH1BClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        gte?: (col: string, val: number) => {
          order?: (
            col: string,
            opts: { ascending: boolean }
          ) => Promise<{ data: H1BSalaryData[] | null; error: { message: string } | null }>;
        };
        order?: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{ data: H1BSalaryData[] | null; error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Fetch H1B salary data from Supabase (for pre-processed data)
 * This is more reliable than scraping but requires the data to be loaded first
 */
export async function fetchH1BDataFromDB(
  supabaseClient: SupabaseH1BClient,
  companySlug: string,
  options?: { minYear?: number }
): Promise<H1BSalaryData[]> {
  try {
    const baseQuery = supabaseClient
      .from('h1b_salaries')
      .select('*')
      .eq('company_slug', companySlug);

    // Build query with optional filters
    let result: { data: H1BSalaryData[] | null; error: { message: string } | null };

    if (options?.minYear && baseQuery.gte) {
      const filtered = baseQuery.gte('fiscal_year', options.minYear);
      result = await (filtered.order?.('wage_from', { ascending: false }) ||
        Promise.resolve({ data: [], error: null }));
    } else {
      result = await (baseQuery.order?.('wage_from', { ascending: false }) ||
        Promise.resolve({ data: [], error: null }));
    }

    const { data, error } = result;

    if (error) {
      console.error('Error fetching H1B data from DB:', error.message);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchH1BDataFromDB:', error);
    return [];
  }
}

// =============================================================================
// Salary Range Calculation
// =============================================================================

/**
 * Calculate salary range from H1B data points
 */
export function calculateSalaryRange(
  data: H1BSalaryData[],
  options?: { filterNewGrad?: boolean; filterSWE?: boolean }
): SalaryRange | null {
  let filteredData = data;

  // Filter by SWE titles if requested
  if (options?.filterSWE) {
    filteredData = filteredData.filter(d => isSWETitle(d.job_title));
  }

  // For new grad positions, filter to entry-level wages
  // Generally L3/E3 level (new grad) salaries are in a specific range
  if (options?.filterNewGrad) {
    filteredData = filteredData.filter(d => {
      const annual = normalizeToAnnualSalary(d.wage_from, d.wage_unit);
      // New grad range typically $100k-$350k for tech
      return annual >= 100000 && annual <= 350000;
    });
  }

  if (filteredData.length === 0) {
    return null;
  }

  // Calculate normalized annual salaries
  const annualSalaries = filteredData
    .map(d => normalizeToAnnualSalary(d.wage_from, d.wage_unit))
    .sort((a, b) => a - b);

  const min = annualSalaries[0];
  const max = annualSalaries[annualSalaries.length - 1];

  // Calculate median
  const mid = Math.floor(annualSalaries.length / 2);
  const median =
    annualSalaries.length % 2 !== 0
      ? annualSalaries[mid]
      : Math.round((annualSalaries[mid - 1] + annualSalaries[mid]) / 2);

  return {
    min,
    max,
    median,
    count: annualSalaries.length,
    source: 'h1b',
  };
}

// =============================================================================
// Main Salary Lookup Function
// =============================================================================

export interface SalaryLookupOptions {
  company: string;
  jobTitle?: string;
  location?: string;
  tier?: string;
  useEstimates?: boolean; // Fall back to tier-based estimates
}

/**
 * Get salary range for a company/job combination
 * Uses H1B data with fallback to tier-based estimates
 */
export async function getSalaryRange(
  options: SalaryLookupOptions
): Promise<SalaryRange | null> {
  const cacheKey = `${options.company}-${options.jobTitle || 'all'}-${options.location || 'all'}`;
  const cached = salaryCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }

  try {
    // Fetch H1B data for the company
    const h1bData = await fetchH1BDataForCompany(options.company, {
      jobTitle: options.jobTitle,
    });

    // Filter by location if provided
    let filteredData = h1bData;
    if (options.location) {
      const locationLower = options.location.toLowerCase();
      filteredData = h1bData.filter(
        d =>
          d.city.toLowerCase().includes(locationLower) ||
          d.state.toLowerCase().includes(locationLower)
      );

      // If no location-specific data, use all data
      if (filteredData.length === 0) {
        filteredData = h1bData;
      }
    }

    // Calculate salary range
    const range = calculateSalaryRange(filteredData, {
      filterSWE: true,
      filterNewGrad: true,
    });

    if (range && range.count >= 3) {
      // Only use if we have enough data points
      salaryCache.set(cacheKey, {
        data: range,
        timestamp: Date.now(),
        ttl: SALARY_CACHE_TTL,
      });
      return range;
    }

    // Fall back to tier-based estimates if enabled and tier is provided
    if (options.useEstimates && options.tier) {
      const estimate = ESTIMATED_NEW_GRAD_RANGES[options.tier];
      if (estimate) {
        return estimate;
      }
    }

    return range;
  } catch (error) {
    console.error('Error in getSalaryRange:', error);

    // Return tier estimate as fallback
    if (options.useEstimates && options.tier) {
      return ESTIMATED_NEW_GRAD_RANGES[options.tier] || null;
    }

    return null;
  }
}

/**
 * Get salary ranges for multiple companies in batch
 * More efficient for populating job listings
 */
export async function getBatchSalaryRanges(
  companies: Array<{ company: string; tier?: string }>
): Promise<Map<string, SalaryRange | null>> {
  const results = new Map<string, SalaryRange | null>();

  // Process in parallel with rate limiting
  const batchSize = 5;
  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    const promises = batch.map(async ({ company, tier }) => {
      const range = await getSalaryRange({
        company,
        tier,
        useEstimates: true,
      });
      results.set(company.toLowerCase(), range);
    });

    await Promise.all(promises);

    // Rate limit: wait 200ms between batches
    if (i + batchSize < companies.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

// =============================================================================
// Job Title to Role Mapping
// =============================================================================

/**
 * Map H1B job titles to our role types
 */
export function mapJobTitleToRole(title: string): string[] {
  const lower = title.toLowerCase();
  const roles: string[] = [];

  // ML/AI roles
  if (
    lower.includes('machine learning') ||
    lower.includes('ml engineer') ||
    lower.includes('ai engineer') ||
    lower.includes('deep learning') ||
    lower.includes('data scientist')
  ) {
    roles.push('ml');
  }

  // Backend
  if (
    lower.includes('backend') ||
    lower.includes('back-end') ||
    lower.includes('server') ||
    lower.includes('api engineer')
  ) {
    roles.push('backend');
  }

  // Frontend
  if (
    lower.includes('frontend') ||
    lower.includes('front-end') ||
    lower.includes('ui engineer') ||
    lower.includes('web developer')
  ) {
    roles.push('frontend');
  }

  // Fullstack
  if (lower.includes('full stack') || lower.includes('fullstack')) {
    roles.push('fullstack');
  }

  // Infrastructure
  if (
    lower.includes('infrastructure') ||
    lower.includes('platform') ||
    lower.includes('devops') ||
    lower.includes('sre') ||
    lower.includes('site reliability')
  ) {
    roles.push('infra');
  }

  // Data
  if (
    lower.includes('data engineer') ||
    lower.includes('analytics') ||
    lower.includes('etl')
  ) {
    roles.push('data');
  }

  // Security
  if (
    lower.includes('security') ||
    lower.includes('cybersecurity') ||
    lower.includes('infosec')
  ) {
    roles.push('security');
  }

  // Mobile
  if (
    lower.includes('mobile') ||
    lower.includes('ios') ||
    lower.includes('android') ||
    lower.includes('react native')
  ) {
    roles.push('mobile');
  }

  // Default to SWE if no specific role detected
  if (roles.length === 0 && isSWETitle(title)) {
    roles.push('swe');
  }

  return roles;
}

// =============================================================================
// Utility Functions for Display
// =============================================================================

/**
 * Format salary for display
 */
export function formatSalary(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`;
  }
  return `$${Math.round(amount / 1000)}K`;
}

/**
 * Format salary range for display
 */
export function formatSalaryRange(range: SalaryRange | null): string {
  if (!range) return 'Not available';

  if (range.min === range.max) {
    return formatSalary(range.min);
  }

  return `${formatSalary(range.min)} - ${formatSalary(range.max)}`;
}

/**
 * Get confidence level based on data count
 */
export function getSalaryConfidence(range: SalaryRange | null): 'high' | 'medium' | 'low' | 'none' {
  if (!range) return 'none';
  if (range.count >= 50) return 'high';
  if (range.count >= 10) return 'medium';
  return 'low';
}

// =============================================================================
// Clear Cache (for testing/admin)
// =============================================================================

export function clearSalaryCache(): void {
  salaryCache.clear();
  companyDataCache.clear();
}
