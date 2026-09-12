import { NextRequest, NextResponse } from 'next/server';
import {
  getSalaryRange,
  formatSalaryRange,
  getSalaryConfidence,
  mapJobTitleToRole,
  formatSalary,
} from '@/lib/salary-data';
import { ESTIMATED_NEW_GRAD_RANGES } from '@/lib/salary-sources';
import { getLevelsFyiSalary } from '@/lib/levels-fyi-data';

/**
 * GET /api/salary-lookup
 *
 * Query Parameters:
 * - company (required): Company name or slug
 * - title (optional): Job title for filtering
 * - location (optional): Location for filtering (city or state)
 * - tier (optional): Company tier for fallback estimates
 *
 * Priority:
 * 1. Job posting salary (if already in DB)
 * 2. Levels.fyi data (curated, accurate for big tech)
 * 3. H1B LCA data (government records)
 * 4. Tier-based estimates (fallback)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');
    const title = searchParams.get('title') || undefined;
    const location = searchParams.get('location') || undefined;
    const tier = searchParams.get('tier') || undefined;

    if (!company) {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }

    // Normalize company slug
    const companySlug = company.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

    // 1. Check levels.fyi data first (most accurate for known companies)
    const levelsFyi = getLevelsFyiSalary(companySlug);
    if (levelsFyi) {
      const formatted = levelsFyi.baseSalaryMin === levelsFyi.baseSalaryMax
        ? formatSalary(levelsFyi.baseSalaryMin)
        : `${formatSalary(levelsFyi.baseSalaryMin)} - ${formatSalary(levelsFyi.baseSalaryMax)}`;

      return NextResponse.json({
        company,
        title: title || null,
        location: location || null,
        range: {
          min: levelsFyi.baseSalaryMin,
          max: levelsFyi.baseSalaryMax,
          median: Math.round((levelsFyi.baseSalaryMin + levelsFyi.baseSalaryMax) / 2),
          count: 100, // High confidence
        },
        formatted,
        confidence: 'high',
        source: 'levels.fyi',
        level: levelsFyi.level,
        roles: title ? mapJobTitleToRole(title) : [],
      });
    }

    // 2. Fall back to H1B data
    const range = await getSalaryRange({
      company,
      jobTitle: title,
      location,
      tier,
      useEstimates: true,
    });

    if (!range) {
      return NextResponse.json(
        {
          company,
          range: null,
          formatted: 'Not available',
          confidence: 'none',
          source: null,
          message: 'No salary data available for this company',
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      company,
      title: title || null,
      location: location || null,
      range: {
        min: range.min,
        max: range.max,
        median: range.median,
        count: range.count,
      },
      formatted: formatSalaryRange(range),
      confidence: getSalaryConfidence(range),
      source: range.source,
      roles: title ? mapJobTitleToRole(title) : [],
    });
  } catch (error) {
    console.error('Error in salary lookup:', error);
    return NextResponse.json(
      { error: 'Failed to fetch salary data' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/salary-lookup
 *
 * Body:
 * {
 *   companies: Array<{ company: string; tier?: string }>
 * }
 *
 * Returns salary ranges for multiple companies (batch lookup)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companies } = body;

    if (!Array.isArray(companies) || companies.length === 0) {
      return NextResponse.json(
        { error: 'Companies array is required' },
        { status: 400 }
      );
    }

    if (companies.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 companies per request' },
        { status: 400 }
      );
    }

    const results: Record<
      string,
      {
        min: number | null;
        max: number | null;
        median: number | null;
        count: number;
        source: string;
        confidence: string;
      }
    > = {};

    // Process companies in parallel with rate limiting
    const batchSize = 5;
    for (let i = 0; i < companies.length; i += batchSize) {
      const batch = companies.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (item: { company: string; tier?: string }) => {
          const { company, tier } = item;

          try {
            const range = await getSalaryRange({
              company,
              tier,
              useEstimates: true,
            });

            results[company.toLowerCase()] = range
              ? {
                  min: range.min,
                  max: range.max,
                  median: range.median,
                  count: range.count,
                  source: range.source,
                  confidence: getSalaryConfidence(range),
                }
              : {
                  min: null,
                  max: null,
                  median: null,
                  count: 0,
                  source: 'none',
                  confidence: 'none',
                };
          } catch {
            results[company.toLowerCase()] = {
              min: null,
              max: null,
              median: null,
              count: 0,
              source: 'error',
              confidence: 'none',
            };
          }
        })
      );

      // Rate limit: brief delay between batches
      if (i + batchSize < companies.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return NextResponse.json({
      results,
      processed: companies.length,
    });
  } catch (error) {
    console.error('Error in batch salary lookup:', error);
    return NextResponse.json(
      { error: 'Failed to fetch salary data' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/salary-lookup/estimates
 *
 * Returns estimated salary ranges by tier (fallback data)
 */
export async function OPTIONS() {
  return NextResponse.json({
    estimates: ESTIMATED_NEW_GRAD_RANGES,
    note: 'These are estimated ranges based on historical H1B data. Actual salaries may vary.',
  });
}
