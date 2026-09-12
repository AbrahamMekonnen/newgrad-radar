import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { type, title, description, screenshot_url, priority } = body;

    // Validate required fields
    if (!type || !title || !description) {
      return NextResponse.json(
        { error: 'Missing required fields: type, title, and description are required' },
        { status: 400 }
      );
    }

    // Validate type
    if (!['bug', 'feature', 'feedback'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid type. Must be bug, feature, or feedback' },
        { status: 400 }
      );
    }

    // Validate priority if provided
    if (priority && !['low', 'medium', 'high', 'critical'].includes(priority)) {
      return NextResponse.json(
        { error: 'Invalid priority. Must be low, medium, high, or critical' },
        { status: 400 }
      );
    }

    // Insert the feedback report
    const { data, error } = await supabase
      .from('feedback_reports')
      .insert({
        user_id: user.id,
        type,
        title: title.trim(),
        description: description.trim(),
        screenshot_url: screenshot_url?.trim() || null,
        priority: priority || 'medium',
        status: 'open',
      })
      .select();

    if (error) {
      console.error('Error creating feedback report:', error);
      // Return more specific error message for debugging
      const errorMessage = error.code === '42501'
        ? 'Permission denied. Please try logging out and back in.'
        : error.code === '42P01'
        ? 'Feedback system is not available. Please contact support.'
        : error.message || 'Failed to create feedback report';
      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      console.error('Insert succeeded but no data returned');
      return NextResponse.json(
        { error: 'Failed to create feedback report. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, report: data[0] });
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch user's feedback reports
    const { data, error } = await supabase
      .from('feedback_reports')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching feedback reports:', error);
      return NextResponse.json(
        { error: 'Failed to fetch feedback reports' },
        { status: 500 }
      );
    }

    return NextResponse.json({ reports: data });
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
