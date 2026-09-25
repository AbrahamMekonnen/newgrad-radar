import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  queueAnswerGeneration,
  generateCompanyAnswer,
} from '@/lib/answer-scheduler';

export interface GenerateAnswerRequest {
  companySlug: string;
  companyName: string;
  immediate?: boolean; // Skip queue and generate immediately
}

export interface GenerateAnswerResponse {
  success: boolean;
  queued?: boolean;
  queueId?: string;
  answerId?: string;
  answer?: {
    short: string;
    standard: string;
    long: string;
  };
  error?: string;
}

/**
 * POST /api/answers/generate
 *
 * Queue or immediately generate a "Why Company" answer.
 * When immediate=true, generates synchronously (slower but instant result).
 * When immediate=false (default), queues for background processing.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<GenerateAnswerResponse>> {
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

    const body = await request.json();
    const { companySlug, companyName, immediate = false } =
      body as GenerateAnswerRequest;

    // Validate input
    if (!companySlug || typeof companySlug !== 'string') {
      return NextResponse.json(
        { success: false, error: 'companySlug is required' },
        { status: 400 }
      );
    }

    if (!companyName || typeof companyName !== 'string') {
      return NextResponse.json(
        { success: false, error: 'companyName is required' },
        { status: 400 }
      );
    }

    // Check if answer already exists
    const { data: existingAnswer } = await supabase
      .from('company_answers')
      .select('id, why_company_short, why_company_standard, why_company_long')
      .eq('user_id', user.id)
      .eq('company_slug', companySlug)
      .single();

    if (existingAnswer) {
      return NextResponse.json({
        success: true,
        answerId: existingAnswer.id,
        answer: {
          short: existingAnswer.why_company_short,
          standard: existingAnswer.why_company_standard,
          long: existingAnswer.why_company_long,
        },
      });
    }

    // Immediate generation (synchronous)
    if (immediate) {
      const answers = await generateCompanyAnswer(
        user.id,
        companySlug,
        companyName
      );

      if (!answers) {
        return NextResponse.json(
          { success: false, error: 'Failed to generate answer' },
          { status: 500 }
        );
      }

      // Save to database
      const { data: savedAnswer, error: saveError } = await supabase
        .from('company_answers')
        .upsert({
          user_id: user.id,
          company_slug: companySlug,
          company_name: companyName,
          why_company_short: answers.why_company_short,
          why_company_standard: answers.why_company_standard,
          why_company_long: answers.why_company_long,
          company_mission: answers.company_mission,
          company_products: answers.company_products,
          recent_news: answers.recent_news,
          generation_model: 'gemini-2.5-flash',
          generated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (saveError) {
        return NextResponse.json(
          { success: false, error: `Failed to save answer: ${saveError.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        answerId: savedAnswer.id,
        answer: {
          short: answers.why_company_short,
          standard: answers.why_company_standard,
          long: answers.why_company_long,
        },
      });
    }

    // Queue for background processing (default)
    const queueResult = await queueAnswerGeneration(
      user.id,
      companySlug,
      companyName
    );

    if (!queueResult.success) {
      return NextResponse.json(
        { success: false, error: queueResult.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      queued: true,
      queueId: queueResult.queueId,
    });
  } catch (error) {
    console.error('Answer generation error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process request. Please try again.',
      },
      { status: 500 }
    );
  }
}
