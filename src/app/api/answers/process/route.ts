import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import {
  processAnswerQueue,
  getQueueHealth,
} from '@/lib/answer-scheduler';

export interface ProcessQueueResponse {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  health?: {
    healthy: boolean;
    pending: number;
    processing: number;
    stuck: number;
    failed_last_hour: number;
  };
  error?: string;
}

/**
 * POST /api/answers/process
 *
 * Process a batch of queued answer generation requests.
 * This endpoint should be called by a cron job or background worker.
 *
 * Security: Requires CRON_SECRET header for authentication.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ProcessQueueResponse>> {
  try {
    // Verify cron secret
    const headersList = await headers();
    const cronSecret = headersList.get('x-cron-secret');
    const expectedSecret = process.env.CRON_SECRET;

    // In development, allow without secret
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (!isDevelopment && cronSecret !== expectedSecret) {
      return NextResponse.json(
        {
          success: false,
          processed: 0,
          succeeded: 0,
          failed: 0,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Parse batch size from request body
    let batchSize = 5;
    try {
      const body = await request.json();
      if (body.batchSize && typeof body.batchSize === 'number') {
        batchSize = Math.min(Math.max(body.batchSize, 1), 20);
      }
    } catch {
      // Use default batch size
    }

    // Process the queue
    const result = await processAnswerQueue(batchSize);

    // Get health status
    const health = await getQueueHealth();

    return NextResponse.json({
      success: true,
      ...result,
      health,
    });
  } catch (error) {
    console.error('Process queue error:', error);
    return NextResponse.json(
      {
        success: false,
        processed: 0,
        succeeded: 0,
        failed: 0,
        error: 'Failed to process queue',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/answers/process
 *
 * Get the health status of the answer generation queue.
 * Useful for monitoring and alerting.
 */
export async function GET(): Promise<NextResponse<{
  success: boolean;
  health?: {
    healthy: boolean;
    pending: number;
    processing: number;
    stuck: number;
    failed_last_hour: number;
  };
  error?: string;
}>> {
  try {
    const health = await getQueueHealth();

    return NextResponse.json({
      success: true,
      health,
    });
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get health status' },
      { status: 500 }
    );
  }
}
