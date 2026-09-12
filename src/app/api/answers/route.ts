import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // Max requests per window

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);

  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }

  userLimit.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - userLimit.count };
}

// Question categories for answer generation
type QuestionCategory =
  | 'why_company'
  | 'why_role'
  | 'challenging_project'
  | 'teamwork'
  | 'conflict_resolution'
  | 'failure_learning'
  | 'leadership'
  | 'problem_solving'
  | 'strengths'
  | 'weaknesses'
  | 'career_goals'
  | 'achievement'
  | 'generic';

const VALID_CATEGORIES: QuestionCategory[] = [
  'why_company',
  'why_role',
  'challenging_project',
  'teamwork',
  'conflict_resolution',
  'failure_learning',
  'leadership',
  'problem_solving',
  'strengths',
  'weaknesses',
  'career_goals',
  'achievement',
  'generic',
];

const VALID_WORD_COUNTS = [75, 150, 250, 350];

interface Story {
  id: string;
  story_type: string;
  title: string;
  situation: string;
  task: string;
  actions: string[];
  results: { metric?: string; value?: string; description: string }[];
  applicable_categories: string[];
  technologies?: string[];
  skills_demonstrated?: string[];
}

interface GenerateAnswersRequest {
  story_ids?: string[];
  categories?: QuestionCategory[];
  word_counts?: number[];
}

/**
 * GET /api/answers
 * List user's answer bank with optional filtering
 */
export async function GET(request: NextRequest) {
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

    // Parse query params
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') as QuestionCategory | null;
    const wordCount = searchParams.get('word_count');
    const storyId = searchParams.get('story_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build query
    let query = supabase
      .from('answer_bank')
      .select(
        `
        *,
        story:user_story_bank (
          id,
          story_type,
          title,
          context,
          organization
        )
      `
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (category && VALID_CATEGORIES.includes(category)) {
      query = query.eq('question_category', category);
    }

    if (wordCount && VALID_WORD_COUNTS.includes(parseInt(wordCount, 10))) {
      query = query.eq('word_count_target', parseInt(wordCount, 10));
    }

    if (storyId) {
      query = query.eq('story_id', storyId);
    }

    const { data: answers, error } = await query;

    if (error) {
      console.error('Error fetching answers:', error);
      return NextResponse.json(
        { error: 'Failed to fetch answers' },
        { status: 500 }
      );
    }

    // Get total count for pagination
    const { count } = await supabase
      .from('answer_bank')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    return NextResponse.json({
      answers,
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Answers GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/answers
 * Bulk generate answers from user's story bank
 */
export async function POST(request: NextRequest) {
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

    // Rate limiting
    const rateLimit = checkRateLimit(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 60,
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'Retry-After': '60',
          },
        }
      );
    }

    const body: GenerateAnswersRequest = await request.json();
    const {
      story_ids,
      categories = VALID_CATEGORIES,
      word_counts = [150],
    } = body;

    // Validate word counts
    const validWordCounts = word_counts.filter((wc) =>
      VALID_WORD_COUNTS.includes(wc)
    );
    if (validWordCounts.length === 0) {
      return NextResponse.json(
        {
          error: `Invalid word counts. Valid values: ${VALID_WORD_COUNTS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Validate categories
    const validCategories = categories.filter((cat) =>
      VALID_CATEGORIES.includes(cat)
    );
    if (validCategories.length === 0) {
      return NextResponse.json(
        {
          error: `Invalid categories. Valid values: ${VALID_CATEGORIES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Fetch user's stories
    let storiesQuery = supabase
      .from('user_story_bank')
      .select('*')
      .eq('user_id', user.id);

    if (story_ids && story_ids.length > 0) {
      storiesQuery = storiesQuery.in('id', story_ids);
    }

    const { data: stories, error: storiesError } = await storiesQuery;

    if (storiesError) {
      console.error('Error fetching stories:', storiesError);
      return NextResponse.json(
        { error: 'Failed to fetch stories' },
        { status: 500 }
      );
    }

    if (!stories || stories.length === 0) {
      return NextResponse.json(
        { error: 'No stories found. Add stories to your story bank first.' },
        { status: 400 }
      );
    }

    // Generate answers for each story/category/word_count combination
    const generatedAnswers: Array<{
      story_id: string;
      question_category: string;
      word_count_target: number;
      answer_text: string;
      answer_structure: string;
      variable_slots: Record<string, unknown>;
      generation_model: string;
    }> = [];

    const startTime = Date.now();

    for (const story of stories as Story[]) {
      // Determine applicable categories for this story
      const storyCategories = story.applicable_categories || [];
      const categoriesToGenerate = validCategories.filter(
        (cat) =>
          storyCategories.includes(cat) ||
          cat === 'generic' ||
          storyCategories.length === 0
      );

      for (const category of categoriesToGenerate) {
        for (const wordCount of validWordCounts) {
          // Check if answer already exists
          const { data: existing } = await supabase
            .from('answer_bank')
            .select('id')
            .eq('user_id', user.id)
            .eq('story_id', story.id)
            .eq('question_category', category)
            .eq('word_count_target', wordCount)
            .eq('variation_index', 1)
            .single();

          if (existing) {
            continue; // Skip if already generated
          }

          // Generate answer using the story content
          const answer = generateAnswerFromStory(story, category, wordCount);

          generatedAnswers.push({
            story_id: story.id,
            question_category: category,
            word_count_target: wordCount,
            answer_text: answer.text,
            answer_structure: answer.structure,
            variable_slots: { company: null, role: null, product: null },
            generation_model: 'template-v1',
          });
        }
      }
    }

    // Batch insert generated answers
    if (generatedAnswers.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from('answer_bank')
        .insert(
          generatedAnswers.map((answer) => ({
            user_id: user.id,
            ...answer,
            variation_index: 1,
          }))
        )
        .select();

      if (insertError) {
        console.error('Error inserting answers:', insertError);
        return NextResponse.json(
          { error: 'Failed to save generated answers' },
          { status: 500 }
        );
      }

      // Log generation
      const generationTime = Date.now() - startTime;
      await supabase.from('generation_log').insert({
        user_id: user.id,
        request_type: 'bulk_stories',
        input_data: {
          story_count: stories.length,
          categories: validCategories,
          word_counts: validWordCounts,
        },
        model_used: 'template-v1',
        generation_time_ms: generationTime,
        output_data: { answers_generated: inserted?.length || 0 },
        success: true,
      });

      return NextResponse.json(
        {
          success: true,
          generated: inserted?.length || 0,
          answers: inserted,
        },
        {
          status: 201,
          headers: {
            'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          },
        }
      );
    }

    return NextResponse.json({
      success: true,
      generated: 0,
      message:
        'No new answers generated. Answers may already exist for the requested combinations.',
    });
  } catch (error) {
    console.error('Answers POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Generate an answer from a story using templates
 * In production, this would call an LLM API
 */
function generateAnswerFromStory(
  story: Story,
  category: QuestionCategory,
  targetWordCount: number
): { text: string; structure: string } {
  const actions = Array.isArray(story.actions)
    ? story.actions.join(' ')
    : JSON.stringify(story.actions);
  const results = Array.isArray(story.results)
    ? story.results
        .map((r) =>
          typeof r === 'string'
            ? r
            : r.description || `${r.metric}: ${r.value}`
        )
        .join(' ')
    : JSON.stringify(story.results);

  // Build base answer using STAR format
  let answer = '';
  let structure = 'standard_star';

  // Result-first structure for achievement/problem-solving
  if (category === 'achievement' || category === 'problem_solving') {
    structure = 'result_first';
    answer = `${results} This outcome came from ${story.title}. ${story.situation} ${story.task} To address this, ${actions}`;
  }
  // Challenge-first for failure/conflict
  else if (category === 'failure_learning' || category === 'conflict_resolution') {
    structure = 'challenge_first';
    answer = `One significant challenge I faced was during ${story.title}. ${story.situation} The specific task was: ${story.task} I took the following actions: ${actions} The results were: ${results}`;
  }
  // Standard STAR for others
  else {
    answer = `During ${story.title}, ${story.situation} My specific responsibility was: ${story.task} I took these actions: ${actions} As a result, ${results}`;
  }

  // Add skills/technologies if relevant and space permits
  const skills = story.skills_demonstrated || [];
  const tech = story.technologies || [];

  if (skills.length > 0 && answer.split(' ').length < targetWordCount - 20) {
    answer += ` This experience demonstrated my skills in ${skills.slice(0, 3).join(', ')}.`;
  }

  if (tech.length > 0 && answer.split(' ').length < targetWordCount - 15) {
    answer += ` I utilized ${tech.slice(0, 3).join(', ')}.`;
  }

  // Trim or pad to approximate target word count
  const words = answer.split(/\s+/);
  if (words.length > targetWordCount * 1.2) {
    answer = words.slice(0, targetWordCount).join(' ') + '...';
  }

  return { text: answer, structure };
}
