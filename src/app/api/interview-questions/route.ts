import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Valid question types matching the enum in the database
const VALID_QUESTION_TYPES = [
  'technical_coding',
  'technical_conceptual',
  'system_design',
  'behavioral',
  'case_study',
  'take_home',
  'oa',
  'brain_teaser',
  'other',
] as const;

type QuestionType = (typeof VALID_QUESTION_TYPES)[number];

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'unknown'] as const;
type Difficulty = (typeof VALID_DIFFICULTIES)[number];

const VALID_POSITION_LEVELS = ['intern', 'new_grad', 'junior', 'mid', 'senior', 'staff', 'principal'] as const;

interface PostBody {
  company_slug?: string;
  company_name: string;
  position?: string;
  position_level?: string;
  question_type: QuestionType;
  question_text: string;
  question_title?: string;
  difficulty?: Difficulty;
  interview_date?: string;
  source_url?: string;
  tags?: string[];
}

/**
 * GET /api/interview-questions
 * Fetch interview questions with filters
 *
 * Query params:
 * - company_slug: Filter by company slug
 * - position: Filter by position (partial match)
 * - question_type: Filter by question type enum
 * - months_back: How many months back to search (default: 5)
 * - limit: Number of results (max 100, default: 50)
 * - offset: Pagination offset (default: 0)
 * - search: Full-text search on question_text
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const company_slug = searchParams.get('company_slug') || undefined;
    const position = searchParams.get('position') || undefined;
    const question_type = searchParams.get('question_type') as QuestionType | undefined;
    const months_back = parseInt(searchParams.get('months_back') || '24', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const search = searchParams.get('search') || undefined;

    // Validate question_type if provided
    if (question_type && !VALID_QUESTION_TYPES.includes(question_type)) {
      return NextResponse.json(
        { error: `Invalid question_type. Must be one of: ${VALID_QUESTION_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Use anon key for reads (RLS allows public SELECT)
    const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

    // Calculate date cutoff for filtering
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months_back);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    // Build query
    let query = supabase
      .from('interview_questions')
      .select(
        `
        id,
        company_slug,
        company_name,
        position,
        position_level,
        question_type,
        question_text,
        question_title,
        difficulty,
        interview_date,
        interview_round,
        source_name,
        source_url,
        upvotes,
        is_verified,
        scraped_at,
        created_at
      `,
        { count: 'exact' }
      )
      .eq('is_duplicate', false)
      .order('interview_date', { ascending: false, nullsFirst: false })
      .order('scraped_at', { ascending: false });

    // Apply filters
    if (company_slug) {
      query = query.eq('company_slug', company_slug);
    }

    if (position) {
      query = query.ilike('position', `%${position}%`);
    }

    if (question_type) {
      query = query.eq('question_type', question_type);
    }

    // Date filter - interview_date or scraped_at must be within range
    query = query.or(`interview_date.gte.${cutoffDateStr},scraped_at.gte.${cutoffDate.toISOString()}`);

    // Search by company name (case-insensitive partial match)
    if (search) {
      query = query.ilike('company_name', `%${search}%`);
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[interview-questions] Query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch interview questions' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      questions: data || [],
      total: count || 0,
      params: {
        company_slug,
        position,
        question_type,
        months_back,
        limit,
        offset,
      },
      hasMore: (count || 0) > offset + limit,
    });
  } catch (error) {
    console.error('[interview-questions] GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/interview-questions
 * Submit a new interview question (user-submitted)
 *
 * Body:
 * - company_name: (required) Company name
 * - company_slug: (optional) Company slug for linking
 * - position: (optional) Job position
 * - position_level: (optional) Level: intern, new_grad, junior, mid, senior, staff, principal
 * - question_type: (required) One of the valid question types
 * - question_text: (required) The actual question (min 10 chars)
 * - question_title: (optional) Short title/summary
 * - difficulty: (optional) easy, medium, hard, unknown
 * - interview_date: (optional) YYYY-MM-DD format
 * - source_url: (optional) Original source URL
 * - tags: (optional) Array of tag names
 */
export async function POST(request: NextRequest) {
  try {
    const body: PostBody = await request.json();

    // Validate required fields
    if (!body.company_name || typeof body.company_name !== 'string' || body.company_name.trim().length === 0) {
      return NextResponse.json(
        { error: 'company_name is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    if (!body.question_text || typeof body.question_text !== 'string' || body.question_text.trim().length < 10) {
      return NextResponse.json(
        { error: 'question_text is required and must be at least 10 characters' },
        { status: 400 }
      );
    }

    if (!body.question_type || !VALID_QUESTION_TYPES.includes(body.question_type)) {
      return NextResponse.json(
        { error: `question_type is required and must be one of: ${VALID_QUESTION_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate optional fields
    if (body.difficulty && !VALID_DIFFICULTIES.includes(body.difficulty)) {
      return NextResponse.json(
        { error: `difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}` },
        { status: 400 }
      );
    }

    if (body.position_level && !VALID_POSITION_LEVELS.includes(body.position_level as (typeof VALID_POSITION_LEVELS)[number])) {
      return NextResponse.json(
        { error: `position_level must be one of: ${VALID_POSITION_LEVELS.join(', ')}` },
        { status: 400 }
      );
    }

    if (body.interview_date) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(body.interview_date)) {
        return NextResponse.json(
          { error: 'interview_date must be in YYYY-MM-DD format' },
          { status: 400 }
        );
      }
      // Validate it's a real date
      const parsed = new Date(body.interview_date);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'interview_date is not a valid date' },
          { status: 400 }
        );
      }
    }

    if (body.source_url) {
      try {
        new URL(body.source_url);
      } catch {
        return NextResponse.json(
          { error: 'source_url must be a valid URL' },
          { status: 400 }
        );
      }
    }

    // Use service role if available, otherwise anon key (requires RLS to allow insert)
    const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

    // Check for duplicates using company_name and question_text
    const { data: existingQuestion } = await supabase
      .from('interview_questions')
      .select('id')
      .eq('company_name', body.company_name.trim())
      .eq('question_text', body.question_text.trim())
      .maybeSingle();

    if (existingQuestion) {
      return NextResponse.json(
        {
          error: 'This question already exists',
          duplicate_id: existingQuestion.id,
        },
        { status: 409 }
      );
    }

    // Insert the question (using only columns that exist in the simplified schema)
    const { data: newQuestion, error: insertError } = await supabase
      .from('interview_questions')
      .insert({
        company_slug: body.company_slug || null,
        company_name: body.company_name.trim(),
        position: body.position?.trim() || null,
        position_level: body.position_level || null,
        question_type: body.question_type,
        question_text: body.question_text.trim(),
        question_title: body.question_title?.trim() || null,
        difficulty: body.difficulty || 'unknown',
        interview_date: body.interview_date || null,
        source_name: 'user_submitted',
        source_url: body.source_url || null,
        is_verified: false,
        is_duplicate: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[interview-questions] Insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to submit interview question', details: insertError.message },
        { status: 500 }
      );
    }

    // Handle tags if provided
    if (body.tags && Array.isArray(body.tags) && body.tags.length > 0) {
      const { data: tagRecords } = await supabase
        .from('question_tags')
        .select('id, name')
        .in('name', body.tags.map(t => t.toLowerCase().replace(/\s+/g, '_')));

      if (tagRecords && tagRecords.length > 0) {
        const tagMappings = tagRecords.map((tag) => ({
          question_id: newQuestion.id,
          tag_id: tag.id,
          confidence: 1.0,
        }));

        await supabase.from('interview_question_tags').insert(tagMappings);
      }
    }

    return NextResponse.json(
      {
        success: true,
        question: newQuestion,
        message: 'Interview question submitted successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[interview-questions] POST error:', error);

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
