import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { PipelineStage } from '@/lib/types';

// Stage to timestamp field mapping
const STAGE_TIMESTAMP_FIELDS: Partial<Record<PipelineStage, string>> = {
  applied: 'applied_at',
  phone_screen: 'phone_screen_at',
  oa: 'oa_at',
  technical: 'technical_at',
  onsite: 'onsite_at',
  offer: 'offer_at',
  rejected: 'rejected_at',
  withdrawn: 'withdrawn_at',
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/applications/[id]/stage
 * Update application stage with timestamp and event logging
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
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

    const { id: applicationId } = await params;
    const body = await request.json();
    const { stage, notes, next_step, next_step_date, salary_offered } = body;

    if (!stage) {
      return NextResponse.json(
        { error: 'stage is required' },
        { status: 400 }
      );
    }

    // Validate stage is a valid pipeline stage
    const validStages: PipelineStage[] = [
      'saved', 'applied', 'oa', 'phone_screen', 'technical',
      'onsite', 'offer', 'rejected', 'withdrawn'
    ];
    if (!validStages.includes(stage)) {
      return NextResponse.json(
        { error: 'Invalid stage value' },
        { status: 400 }
      );
    }

    // Fetch existing application to verify ownership and get current stage
    const { data: existing, error: fetchError } = await supabase
      .from('applications')
      .select('id, stage, user_id')
      .eq('id', applicationId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Application not found' },
        { status: 404 }
      );
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const fromStage = existing.stage as PipelineStage;
    const toStage = stage as PipelineStage;

    // Build update object
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      stage: toStage,
      last_activity: now,
      updated_at: now,
    };

    // Set stage-specific timestamp
    const timestampField = STAGE_TIMESTAMP_FIELDS[toStage];
    if (timestampField) {
      updateData[timestampField] = now;
    }

    // Optional fields
    if (notes !== undefined) {
      updateData.notes = notes;
    }
    if (next_step !== undefined) {
      updateData.next_step = next_step;
    }
    if (next_step_date !== undefined) {
      updateData.next_step_date = next_step_date;
    }
    if (salary_offered !== undefined && toStage === 'offer') {
      updateData.salary_offered = salary_offered;
    }

    // Update application
    const { data: updated, error: updateError } = await supabase
      .from('applications')
      .update(updateData)
      .eq('id', applicationId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating application:', updateError);
      return NextResponse.json(
        { error: 'Failed to update application' },
        { status: 500 }
      );
    }

    // Create stage_change event
    const eventDescription = `Stage changed from ${fromStage} to ${toStage}`;
    const { error: eventError } = await supabase
      .from('application_events')
      .insert({
        application_id: applicationId,
        event_type: 'stage_change',
        from_stage: fromStage,
        to_stage: toStage,
        description: eventDescription,
        metadata: {
          changed_by: user.id,
          changed_at: now,
        },
        created_at: now,
      });

    if (eventError) {
      console.error('Error creating event:', eventError);
      // Don't fail the request, event creation is secondary
    }

    // Fetch complete application with job data
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
          tier,
          role_types
        ),
        events:application_events (
          id,
          event_type,
          from_stage,
          to_stage,
          description,
          created_at
        )
      `)
      .eq('id', applicationId)
      .single();

    return NextResponse.json({
      application: completeApplication || updated,
      previousStage: fromStage,
      newStage: toStage,
    });
  } catch (error) {
    console.error('Application stage PATCH error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
