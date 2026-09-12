import { NextRequest, NextResponse } from 'next/server';
import {
  detectDeadline,
  detectDeadlines,
  DeadlineResult,
  isDeadlineApproaching,
  isDeadlinePassed,
  formatDeadline,
} from '@/lib/deadline-detector';

/**
 * POST /api/detect-deadline
 *
 * Detects application deadlines from job description text.
 *
 * Single job:
 * { "description": "Apply by December 15, 2024..." }
 *
 * Batch mode:
 * { "jobs": [{ "id": "job-1", "description": "..." }, ...] }
 *
 * Returns detected deadline info with confidence level.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Batch mode: process multiple jobs
    if (body.jobs && Array.isArray(body.jobs)) {
      const jobs = body.jobs as Array<{ id: string; description: string }>;

      if (jobs.length === 0) {
        return NextResponse.json({
          error: 'Jobs array cannot be empty',
        }, { status: 400 });
      }

      if (jobs.length > 100) {
        return NextResponse.json({
          error: 'Maximum 100 jobs per batch request',
        }, { status: 400 });
      }

      // Validate each job has required fields
      for (const job of jobs) {
        if (!job.id || typeof job.id !== 'string') {
          return NextResponse.json({
            error: 'Each job must have a string id',
          }, { status: 400 });
        }
        if (typeof job.description !== 'string') {
          return NextResponse.json({
            error: `Job ${job.id} must have a string description`,
          }, { status: 400 });
        }
      }

      const results = detectDeadlines(jobs);

      // Enrich results with additional info
      const enrichedResults = results.map(({ id, result }) => ({
        id,
        deadline: result.deadline,
        confidence: result.confidence,
        isApproaching: isDeadlineApproaching(result.deadline, 7),
        isPassed: isDeadlinePassed(result.deadline),
        displayText: formatDeadline(result.deadline),
        matchedPattern: result.matchedPattern,
        rawText: result.rawText,
      }));

      return NextResponse.json({
        success: true,
        results: enrichedResults,
        summary: {
          total: results.length,
          withDeadline: results.filter(r => r.result.deadline !== null).length,
          highConfidence: results.filter(r => r.result.confidence === 'high').length,
          approaching: enrichedResults.filter(r => r.isApproaching).length,
        },
      });
    }

    // Single job mode
    const { description } = body;

    if (!description || typeof description !== 'string') {
      return NextResponse.json({
        error: 'description field is required and must be a string',
      }, { status: 400 });
    }

    if (description.length > 100000) {
      return NextResponse.json({
        error: 'Description too long (max 100,000 characters)',
      }, { status: 400 });
    }

    const result: DeadlineResult = detectDeadline(description);

    return NextResponse.json({
      success: true,
      deadline: result.deadline,
      confidence: result.confidence,
      isApproaching: isDeadlineApproaching(result.deadline, 7),
      isPassed: isDeadlinePassed(result.deadline),
      displayText: formatDeadline(result.deadline),
      matchedPattern: result.matchedPattern,
      rawText: result.rawText,
    });

  } catch (error) {
    console.error('Deadline detection error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json({
        error: 'Invalid JSON in request body',
      }, { status: 400 });
    }

    return NextResponse.json({
      error: 'Failed to detect deadline',
    }, { status: 500 });
  }
}

/**
 * GET /api/detect-deadline
 *
 * Simple endpoint info and health check
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/detect-deadline',
    description: 'Detects application deadlines from job descriptions',
    methods: ['POST'],
    usage: {
      single: {
        method: 'POST',
        body: { description: 'Job description text...' },
      },
      batch: {
        method: 'POST',
        body: {
          jobs: [
            { id: 'job-1', description: 'Job description...' },
          ],
        },
      },
    },
    supportedPatterns: [
      'Apply by [date]',
      'Deadline: [date]',
      'Application deadline: [date]',
      'Applications close on [date]',
      'Closing date: [date]',
      'Due date: [date]',
      'Submit by [date]',
      'Open until [date]',
      'Expires: [date]',
    ],
    supportedDateFormats: [
      'December 15, 2024',
      'Dec 15, 2024',
      '12/15/2024',
      '2024-12-15',
      '15 December 2024',
      '15.12.2024',
    ],
  });
}
