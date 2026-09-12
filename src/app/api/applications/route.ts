import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { PipelineStage } from '@/lib/types';

/**
 * GET /api/applications
 * Fetch user's applications with optional archived filter
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const archived = searchParams.get('archived') === 'true';
    const stage = searchParams.get('stage') as PipelineStage | null;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build query
    let query = supabase
      .from('applications')
      .select(`
        *,
        job:jobs (
          id,
          title,
          company_name,
          company_slug,
          location,
          url,
          tier,
          role_types,
          posted,
          deadline,
          salary_min,
          salary_max
        ),
        events:application_events (
          id,
          event_type,
          from_stage,
          to_stage,
          description,
          metadata,
          created_at
        )
      `)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by archived (rejected/withdrawn stages)
    if (archived) {
      query = query.in('stage', ['rejected', 'withdrawn']);
    } else {
      query = query.not('stage', 'in', '("rejected","withdrawn")');
    }

    // Filter by specific stage
    if (stage) {
      query = query.eq('stage', stage);
    }

    const { data: applications, error } = await query;

    if (error) {
      console.error('Error fetching applications:', error);
      return NextResponse.json(
        { error: 'Failed to fetch applications' },
        { status: 500 }
      );
    }

    // Get total count for pagination
    const { count } = await supabase
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    return NextResponse.json({
      applications,
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Applications GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/applications
 * Create new application with initial stage_change event
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { job_id, stage = 'saved', notes, referral_name, referral_email } = body;

    if (!job_id) {
      return NextResponse.json(
        { error: 'job_id is required' },
        { status: 400 }
      );
    }

    // Check if application already exists
    const { data: existing } = await supabase
      .from('applications')
      .select('id')
      .eq('user_id', user.id)
      .eq('job_id', job_id)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Application already exists', applicationId: existing.id },
        { status: 409 }
      );
    }

    // Create application
    const now = new Date().toISOString();
    const applicationData: Record<string, unknown> = {
      user_id: user.id,
      job_id,
      stage,
      last_activity: now,
      notes: notes || null,
      referral_name: referral_name || null,
      referral_email: referral_email || null,
      created_at: now,
      updated_at: now,
    };

    // Set applied_at if starting in applied stage
    if (stage === 'applied') {
      applicationData.applied_at = now;
    }

    const { data: application, error: insertError } = await supabase
      .from('applications')
      .insert(applicationData)
      .select()
      .single();

    if (insertError) {
      console.error('Error creating application:', insertError);
      return NextResponse.json(
        { error: 'Failed to create application' },
        { status: 500 }
      );
    }

    // Create initial stage_change event
    const { error: eventError } = await supabase
      .from('application_events')
      .insert({
        application_id: application.id,
        event_type: 'stage_change',
        from_stage: null,
        to_stage: stage,
        description: `Application created in ${stage} stage`,
        created_at: now,
      });

    if (eventError) {
      console.error('Error creating event:', eventError);
      // Don't fail the request, event creation is secondary
    }

    // Fetch the complete application with job data
    const { data: completeApplication } = await supabase
      .from('applications')
      .select(`
        *,
        job:jobs (
          id,
          title,
          company_name,
          company_slug,
          location,
          url,
          tier
        )
      `)
      .eq('id', application.id)
      .single();

    return NextResponse.json({
      application: completeApplication || application,
    }, { status: 201 });
  } catch (error) {
    console.error('Applications POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
