import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/answers/[id]
 * Get a specific answer by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Answer ID is required' },
        { status: 400 }
      );
    }

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid answer ID format' },
        { status: 400 }
      );
    }

    // Fetch the answer with related story
    const { data: answer, error } = await supabase
      .from('answer_bank')
      .select(
        `
        *,
        story:user_story_bank (
          id,
          story_type,
          title,
          context,
          organization,
          situation,
          task,
          actions,
          results
        )
      `
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Answer not found' },
          { status: 404 }
        );
      }
      console.error('Error fetching answer:', error);
      return NextResponse.json(
        { error: 'Failed to fetch answer' },
        { status: 500 }
      );
    }

    return NextResponse.json({ answer });
  } catch (error) {
    console.error('Answer GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/answers/[id]
 * Update a specific answer
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Answer ID is required' },
        { status: 400 }
      );
    }

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid answer ID format' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { answer_text, variable_slots } = body;

    // Build update object
    const updates: Record<string, unknown> = {};

    if (answer_text !== undefined) {
      if (typeof answer_text !== 'string' || answer_text.trim().length === 0) {
        return NextResponse.json(
          { error: 'answer_text must be a non-empty string' },
          { status: 400 }
        );
      }
      updates.answer_text = answer_text.trim();
    }

    if (variable_slots !== undefined) {
      if (typeof variable_slots !== 'object' || variable_slots === null) {
        return NextResponse.json(
          { error: 'variable_slots must be an object' },
          { status: 400 }
        );
      }
      updates.variable_slots = variable_slots;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // Update the answer
    const { data: answer, error } = await supabase
      .from('answer_bank')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Answer not found' },
          { status: 404 }
        );
      }
      console.error('Error updating answer:', error);
      return NextResponse.json(
        { error: 'Failed to update answer' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, answer });
  } catch (error) {
    console.error('Answer PATCH error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/answers/[id]
 * Remove a specific answer from the answer bank
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Answer ID is required' },
        { status: 400 }
      );
    }

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid answer ID format' },
        { status: 400 }
      );
    }

    // First check if the answer exists and belongs to the user
    const { data: existing, error: checkError } = await supabase
      .from('answer_bank')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (checkError || !existing) {
      if (checkError?.code === 'PGRST116' || !existing) {
        return NextResponse.json(
          { error: 'Answer not found' },
          { status: 404 }
        );
      }
      console.error('Error checking answer:', checkError);
      return NextResponse.json(
        { error: 'Failed to verify answer ownership' },
        { status: 500 }
      );
    }

    // Delete the answer
    const { error: deleteError } = await supabase
      .from('answer_bank')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Error deleting answer:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete answer' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Answer deleted successfully',
      deletedId: id,
    });
  } catch (error) {
    console.error('Answer DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
