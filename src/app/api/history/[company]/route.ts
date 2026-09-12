import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ company: string }>;
}

/**
 * GET /api/history/[company]
 * Fetch hiring history data for a company including:
 * - hiring_seasons: Historical hiring patterns by season
 * - company_hiring_stats: Aggregated statistics per year/season
 * - hiring_predictions: AI-generated predictions for future hiring
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const supabase = await createClient();

    // Authentication is optional for this endpoint - public data
    const { data: { user } } = await supabase.auth.getUser();

    const { company: companySlug } = await params;

    if (!companySlug) {
      return NextResponse.json(
        { error: 'Company slug is required' },
        { status: 400 }
      );
    }

    // Fetch all three data types in parallel
    const [seasonsResult, statsResult, predictionsResult, companyResult] = await Promise.all([
      // Hiring seasons - historical data about when the company hires
      supabase
        .from('hiring_seasons')
        .select('*')
        .eq('company_slug', companySlug)
        .order('year', { ascending: false })
        .order('season', { ascending: true }),

      // Company hiring stats - aggregated metrics
      supabase
        .from('company_hiring_stats')
        .select('*')
        .eq('company_slug', companySlug)
        .order('year', { ascending: false }),

      // Hiring predictions - ML-based predictions for future hiring
      supabase
        .from('hiring_predictions')
        .select('*')
        .eq('company_slug', companySlug)
        .order('predicted_month', { ascending: true }),

      // Company info
      supabase
        .from('companies')
        .select('slug, name, tier, logo_url, careers_url, funding_stage, company_size')
        .eq('slug', companySlug)
        .single(),
    ]);

    // Check for critical errors
    if (companyResult.error && companyResult.error.code !== 'PGRST116') {
      console.error('Error fetching company:', companyResult.error);
    }

    // Build response with available data
    const response: {
      company: typeof companyResult.data | null;
      hiring_seasons: typeof seasonsResult.data;
      company_hiring_stats: typeof statsResult.data;
      hiring_predictions: typeof predictionsResult.data;
      summary: {
        hasHistoricalData: boolean;
        hasPredictions: boolean;
        peakHiringMonth: number | null;
        avgJobsPerSeason: number | null;
        trend: 'increasing' | 'decreasing' | 'stable' | null;
        nextPredictedWindow: {
          month: number;
          confidence: number;
        } | null;
      };
    } = {
      company: companyResult.data,
      hiring_seasons: seasonsResult.data || [],
      company_hiring_stats: statsResult.data || [],
      hiring_predictions: predictionsResult.data || [],
      summary: {
        hasHistoricalData: false,
        hasPredictions: false,
        peakHiringMonth: null,
        avgJobsPerSeason: null,
        trend: null,
        nextPredictedWindow: null,
      },
    };

    // Calculate summary stats
    const stats = statsResult.data || [];
    const predictions = predictionsResult.data || [];

    if (stats.length > 0) {
      response.summary.hasHistoricalData = true;

      // Find peak hiring month
      const monthCounts = new Map<number, number>();
      for (const stat of stats) {
        if (stat.peak_month) {
          monthCounts.set(
            stat.peak_month,
            (monthCounts.get(stat.peak_month) || 0) + stat.jobs_posted
          );
        }
      }
      if (monthCounts.size > 0) {
        const peakMonth = [...monthCounts.entries()]
          .sort((a, b) => b[1] - a[1])[0][0];
        response.summary.peakHiringMonth = peakMonth;
      }

      // Calculate average jobs per season
      const totalJobs = stats.reduce((sum, s) => sum + (s.jobs_posted || 0), 0);
      response.summary.avgJobsPerSeason = Math.round(totalJobs / stats.length);

      // Determine trend from recent years
      if (stats.length >= 2) {
        const recent = stats.slice(0, 2);
        const older = stats.slice(-2);
        const recentAvg = recent.reduce((sum, s) => sum + s.jobs_posted, 0) / recent.length;
        const olderAvg = older.reduce((sum, s) => sum + s.jobs_posted, 0) / older.length;

        if (recentAvg > olderAvg * 1.2) {
          response.summary.trend = 'increasing';
        } else if (recentAvg < olderAvg * 0.8) {
          response.summary.trend = 'decreasing';
        } else {
          response.summary.trend = 'stable';
        }
      }
    }

    if (predictions.length > 0) {
      response.summary.hasPredictions = true;

      // Find the next predicted hiring window (highest confidence)
      const now = new Date();
      const currentMonth = now.getMonth() + 1;

      const futurePredictions = predictions.filter(
        (p) => p.predicted_month >= currentMonth
      );

      if (futurePredictions.length > 0) {
        const best = futurePredictions.reduce((a, b) =>
          a.confidence > b.confidence ? a : b
        );
        response.summary.nextPredictedWindow = {
          month: best.predicted_month,
          confidence: best.confidence,
        };
      }
    }

    // Log view if authenticated user (fire and forget)
    if (user) {
      void supabase.from('company_views').insert({
        user_id: user.id,
        company_slug: companySlug,
        viewed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Company history GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
