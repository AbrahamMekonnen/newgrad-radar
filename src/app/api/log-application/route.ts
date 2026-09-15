import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role for server-side operations
const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
  process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key')
);

interface FieldAttempt {
  field: string;
  selector: string;
  found: boolean;
  filled: boolean;
  error?: string;
  duration_ms?: number;
}

interface CustomQuestion {
  question: string;
  field_type: string;
  options?: string[];
  answer?: string;
  from_profile: boolean;
  ai_generated: boolean;
}

interface LogApplicationRequest {
  job_id: string;
  ats_type: string;
  status: 'pending' | 'filling' | 'review' | 'submitted' | 'failed';
  fields_filled?: FieldAttempt[];
  fields_failed?: FieldAttempt[];
  fields_missing?: string[];
  custom_questions?: CustomQuestion[];
  duration_ms?: number;
  error_message?: string;
  error_category?: string;
  application_url?: string;
  automation_method?: string;
  screenshot_url?: string;
}

/**
 * POST /api/log-application
 * Log an auto-apply attempt with detailed field tracking
 */
export async function POST(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // Verify the user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: LogApplicationRequest = await request.json();

    // Validate required fields
    if (!body.job_id || !body.ats_type || !body.status) {
      return NextResponse.json(
        { error: 'Missing required fields: job_id, ats_type, status' },
        { status: 400 }
      );
    }

    // Check if an application log already exists for this user/job
    const { data: existing } = await supabase
      .from('application_logs')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('job_id', body.job_id)
      .single();

    if (existing) {
      // Update existing log
      const { data, error } = await supabase
        .from('application_logs')
        .update({
          status: body.status,
          ats_type: body.ats_type,
          fields_filled: body.fields_filled || [],
          fields_failed: body.fields_failed || [],
          fields_missing: body.fields_missing || [],
          custom_questions: body.custom_questions || [],
          duration_ms: body.duration_ms,
          error_message: body.error_message,
          error_category: body.error_category,
          application_url: body.application_url,
          automation_method: body.automation_method,
          screenshot_url: body.screenshot_url,
          submitted_at: body.status === 'submitted' ? new Date().toISOString() : null,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating application log:', error);
        return NextResponse.json(
          { error: 'Failed to update application log' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Application log updated',
        data,
      });
    }

    // Insert new log
    const { data, error } = await supabase
      .from('application_logs')
      .insert({
        user_id: user.id,
        job_id: body.job_id,
        status: body.status,
        ats_type: body.ats_type,
        fields_filled: body.fields_filled || [],
        fields_failed: body.fields_failed || [],
        fields_missing: body.fields_missing || [],
        custom_questions: body.custom_questions || [],
        duration_ms: body.duration_ms,
        error_message: body.error_message,
        error_category: body.error_category,
        application_url: body.application_url,
        automation_method: body.automation_method,
        screenshot_url: body.screenshot_url,
        submitted_at: body.status === 'submitted' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting application log:', error);
      return NextResponse.json(
        { error: 'Failed to create application log' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Application log created',
      data,
    });
  } catch (error) {
    console.error('Unexpected error in log-application:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/log-application
 * Get application tracking stats and patterns
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'stats';

    if (type === 'stats') {
      // Get overall ATS success rates
      const { data, error } = await supabase
        .from('ats_success_rates')
        .select('*')
        .order('success_rate', { ascending: false });

      if (error) {
        console.error('Error fetching ATS stats:', error);
        return NextResponse.json(
          { error: 'Failed to fetch stats' },
          { status: 500 }
        );
      }

      return NextResponse.json({ stats: data });
    }

    if (type === 'patterns') {
      // Get failure patterns
      const atsType = searchParams.get('ats_type');
      let query = supabase
        .from('failure_patterns')
        .select('*')
        .order('frequency', { ascending: false })
        .limit(20);

      if (atsType) {
        query = query.eq('ats_type', atsType);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching failure patterns:', error);
        return NextResponse.json(
          { error: 'Failed to fetch patterns' },
          { status: 500 }
        );
      }

      return NextResponse.json({ patterns: data });
    }

    if (type === 'fields') {
      // Get field success rates
      const atsType = searchParams.get('ats_type');
      let query = supabase
        .from('ats_field_stats')
        .select('*')
        .order('success_rate', { ascending: false });

      if (atsType) {
        query = query.eq('ats_type', atsType);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching field stats:', error);
        return NextResponse.json(
          { error: 'Failed to fetch field stats' },
          { status: 500 }
        );
      }

      return NextResponse.json({ fields: data });
    }

    return NextResponse.json(
      { error: 'Invalid type parameter. Use: stats, patterns, or fields' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Unexpected error in GET log-application:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
