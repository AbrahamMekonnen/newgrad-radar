import { NextRequest, NextResponse } from 'next/server';
import {
  enrichCompany,
  getFundingRiskLevel,
  formatFundingStage,
  type CompanyEnrichment,
  type FundingStage,
} from '@/lib/company-enricher';

export interface EnrichCompanyRequest {
  companyName: string;
  jobDescription?: string;
}

export interface EnrichCompanyResponse {
  success: boolean;
  data?: CompanyEnrichment & {
    fundingRisk: {
      risk: 'low' | 'medium' | 'high';
      description: string;
    };
    fundingStageLabel: string;
  };
  error?: string;
}

/**
 * POST /api/enrich-company
 *
 * Enriches company data from free public sources.
 * Focus: Funding stage for new grads assessing startup risk.
 *
 * Request body:
 * - companyName (required): Name of the company to enrich
 * - jobDescription (optional): Job posting text for additional signals
 *
 * Response:
 * - fundingStage: seed, series-a, series-b, series-c, series-d+, late-stage, public, acquired, unknown
 * - fundingStageConfidence: 0-1 confidence score
 * - fundingRisk: { risk: low/medium/high, description: string }
 * - companySize: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10000+
 * - industry: Technology, Fintech, Healthcare, etc.
 * - foundedYear: Year company was founded
 * - headquarters: Location of HQ
 * - description: Brief company description
 * - stockTicker: Stock symbol if public
 * - isPublic: Whether company is publicly traded
 * - sources: Array of data sources used
 */
export async function POST(request: NextRequest): Promise<NextResponse<EnrichCompanyResponse>> {
  try {
    const body = await request.json();
    const { companyName, jobDescription } = body as EnrichCompanyRequest;

    // Validate input
    if (!companyName || typeof companyName !== 'string') {
      return NextResponse.json({
        success: false,
        error: 'companyName is required',
      }, { status: 400 });
    }

    const trimmedName = companyName.trim();
    if (trimmedName.length < 2) {
      return NextResponse.json({
        success: false,
        error: 'companyName must be at least 2 characters',
      }, { status: 400 });
    }

    if (trimmedName.length > 200) {
      return NextResponse.json({
        success: false,
        error: 'companyName must be less than 200 characters',
      }, { status: 400 });
    }

    // Validate job description if provided
    let sanitizedJobDescription: string | undefined;
    if (jobDescription) {
      if (typeof jobDescription !== 'string') {
        return NextResponse.json({
          success: false,
          error: 'jobDescription must be a string',
        }, { status: 400 });
      }
      // Truncate very long descriptions
      sanitizedJobDescription = jobDescription.slice(0, 50000);
    }

    // Perform enrichment
    const enrichment = await enrichCompany(trimmedName, sanitizedJobDescription);

    // Add derived fields
    const fundingRisk = getFundingRiskLevel(enrichment.fundingStage);
    const fundingStageLabel = formatFundingStage(enrichment.fundingStage);

    return NextResponse.json({
      success: true,
      data: {
        ...enrichment,
        fundingRisk,
        fundingStageLabel,
      },
    });

  } catch (error) {
    console.error('Enrich company error:', error);

    return NextResponse.json({
      success: false,
      error: 'Failed to enrich company data. Please try again.',
    }, { status: 500 });
  }
}

/**
 * GET /api/enrich-company?name=CompanyName
 *
 * Simple GET endpoint for quick lookups without job description.
 */
export async function GET(request: NextRequest): Promise<NextResponse<EnrichCompanyResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const companyName = searchParams.get('name');

    if (!companyName) {
      return NextResponse.json({
        success: false,
        error: 'name query parameter is required',
      }, { status: 400 });
    }

    const trimmedName = companyName.trim();
    if (trimmedName.length < 2) {
      return NextResponse.json({
        success: false,
        error: 'name must be at least 2 characters',
      }, { status: 400 });
    }

    // Perform enrichment
    const enrichment = await enrichCompany(trimmedName);

    // Add derived fields
    const fundingRisk = getFundingRiskLevel(enrichment.fundingStage);
    const fundingStageLabel = formatFundingStage(enrichment.fundingStage);

    return NextResponse.json({
      success: true,
      data: {
        ...enrichment,
        fundingRisk,
        fundingStageLabel,
      },
    });

  } catch (error) {
    console.error('Enrich company error:', error);

    return NextResponse.json({
      success: false,
      error: 'Failed to enrich company data. Please try again.',
    }, { status: 500 });
  }
}
