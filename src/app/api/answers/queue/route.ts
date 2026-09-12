import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getQueueStatus,
  cancelQueuedGeneration,
} from '@/lib/answer-scheduler';

export interface QueueStatusResponse {
  success: boolean;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  items: Array<{
    id: string;
    company_slug: string;
    company_name: string;
    status: string;
    attempts: number;
    scheduled_at: string;
    error_message: string | null;
  }>;
  error?: string;
}

/**
 * GET /api/answers/queue
 *
 * Get the current status of the user's answer generation queue.
 */
export async function GET(): Promise<NextResponse<QueueStatusResponse>> {
  try {
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          items: [],
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    const status = await getQueueStatus(user.id);

    return NextResponse.json({
      success: true,
      pending: status.pending,
      processing: status.processing,
      completed: status.completed,
      failed: status.failed,
      items: status.items.map((item) => ({
        id: item.id,
        company_slug: item.company_slug,
        company_name: item.company_name,
        status: item.status,
        attempts: item.attempts,
        scheduled_at: item.scheduled_at,
        error_message: item.error_message,
      })),
    });
  } catch (error) {
    console.error('Queue status error:', error);
    return NextResponse.json(
      {
        success: false,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        items: [],
        error: 'Failed to get queue status',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/answers/queue?id=<queueId>
 *
 * Cancel a queued answer generation.
 */
export async function DELETE(
  request: NextRequest
): Promise<NextResponse<{ success: boolean; error?: string }>> {
  try {
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const queueId = searchParams.get('id');

    if (!queueId) {
      return NextResponse.json(
        { success: false, error: 'Queue ID is required' },
        { status: 400 }
      );
    }

    const cancelled = await cancelQueuedGeneration(queueId, user.id);

    if (!cancelled) {
      return NextResponse.json(
        { success: false, error: 'Failed to cancel or item not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cancel queue error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel' },
      { status: 500 }
    );
  }
}
