import { NextRequest, NextResponse } from 'next/server';
import {
  detectSponsorship,
  detectSponsorshipBatch,
  SponsorshipStatus,
} from '@/lib/sponsorship-detector';

interface DetectRequest {
  description?: string;
  jobs?: Array<{ id: string; description: string }>;
}

interface SingleResponse {
  status: SponsorshipStatus;
  confidence: number;
  matchedKeywords: string[];
  reasoning: string;
}

interface BatchResponse {
  results: Record<
    string,
    {
      status: SponsorshipStatus;
      confidence: number;
      matchedKeywords: string[];
      reasoning: string;
    }
  >;
}

/**
 * POST /api/detect-sponsorship
 *
 * Detect visa sponsorship status from job descriptions.
 *
 * Single job:
 *   { "description": "Job description text..." }
 *
 * Batch jobs:
 *   { "jobs": [{ "id": "job-1", "description": "..." }, ...] }
 */
export async function POST(request: NextRequest) {
  try {
    const body: DetectRequest = await request.json();

    // Batch processing mode
    if (body.jobs && Array.isArray(body.jobs)) {
      if (body.jobs.length === 0) {
        return NextResponse.json(
          { error: 'Jobs array cannot be empty' },
          { status: 400 }
        );
      }

      if (body.jobs.length > 100) {
        return NextResponse.json(
          { error: 'Maximum 100 jobs per batch request' },
          { status: 400 }
        );
      }

      // Validate each job has required fields
      for (const job of body.jobs) {
        if (!job.id || typeof job.id !== 'string') {
          return NextResponse.json(
            { error: 'Each job must have a string id' },
            { status: 400 }
          );
        }
        if (typeof job.description !== 'string') {
          return NextResponse.json(
            { error: 'Each job must have a string description' },
            { status: 400 }
          );
        }
      }

      const results = detectSponsorshipBatch(body.jobs);
      const response: BatchResponse = {
        results: Object.fromEntries(results),
      };

      return NextResponse.json(response);
    }

    // Single job mode
    if (body.description !== undefined) {
      if (typeof body.description !== 'string') {
        return NextResponse.json(
          { error: 'Description must be a string' },
          { status: 400 }
        );
      }

      const result = detectSponsorship(body.description);
      const response: SingleResponse = result;

      return NextResponse.json(response);
    }

    return NextResponse.json(
      { error: 'Request must include either "description" or "jobs" field' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Sponsorship detection error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/detect-sponsorship
 *
 * Returns API usage information.
 */
export async function GET() {
  return NextResponse.json({
    name: 'Visa Sponsorship Detection API',
    version: '1.0.0',
    description: 'Detects visa sponsorship status from job descriptions',
    usage: {
      single: {
        method: 'POST',
        body: { description: 'Job description text...' },
        response: {
          status: 'sponsors | no_sponsor | unknown',
          confidence: 'number (0-1)',
          matchedKeywords: ['matched phrases'],
          reasoning: 'explanation string',
        },
      },
      batch: {
        method: 'POST',
        body: {
          jobs: [
            { id: 'job-1', description: '...' },
            { id: 'job-2', description: '...' },
          ],
        },
        response: {
          results: {
            'job-1': {
              status: 'sponsors | no_sponsor | unknown',
              confidence: 'number (0-1)',
              matchedKeywords: ['matched phrases'],
              reasoning: 'explanation string',
            },
          },
        },
      },
    },
    statusTypes: {
      sponsors: 'Company explicitly offers visa sponsorship',
      no_sponsor: 'Company explicitly does NOT offer sponsorship',
      unknown: 'Sponsorship status unclear or not mentioned',
    },
  });
}
