import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Simple in-memory rate limiter (shared with main answers route in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5; // More restrictive for company generation

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const key = `company:${userId}`;
  const userLimit = rateLimitMap.get(key);

  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }

  userLimit.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - userLimit.count };
}

interface CompanyAnswerRequest {
  company_slug: string;
  company_name: string;
  company_mission?: string;
  company_products?: string[];
  recent_news?: string[];
  user_connection?: string;
  regenerate?: boolean;
}

interface Story {
  id: string;
  story_type: string;
  title: string;
  situation: string;
  task: string;
  actions: string[];
  results: { metric?: string; value?: string; description: string }[];
  technologies?: string[];
  skills_demonstrated?: string[];
  strength_rating?: number;
}

/**
 * POST /api/answers/company
 * Generate personalized "Why this company?" answers
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

    const body: CompanyAnswerRequest = await request.json();
    const {
      company_slug,
      company_name,
      company_mission,
      company_products,
      recent_news,
      user_connection,
      regenerate = false,
    } = body;

    // Validate required fields
    if (!company_slug || !company_name) {
      return NextResponse.json(
        { error: 'company_slug and company_name are required' },
        { status: 400 }
      );
    }

    // Check if answer already exists
    const { data: existing } = await supabase
      .from('company_answers')
      .select('*')
      .eq('user_id', user.id)
      .eq('company_slug', company_slug)
      .single();

    if (existing && !regenerate) {
      return NextResponse.json({
        success: true,
        existing: true,
        answer: existing,
      });
    }

    // Fetch company data if not provided
    let enrichedMission = company_mission;
    let enrichedProducts = company_products;

    if (!enrichedMission || !enrichedProducts) {
      const { data: companyData } = await supabase
        .from('companies')
        .select('description, industry')
        .eq('slug', company_slug)
        .single();

      if (companyData) {
        enrichedMission = enrichedMission || companyData.description;
        enrichedProducts = enrichedProducts || (companyData.industry ? [companyData.industry] : []);
      }
    }

    // Fetch user's top stories for relevant experience
    const { data: stories } = await supabase
      .from('user_story_bank')
      .select('*')
      .eq('user_id', user.id)
      .order('strength_rating', { ascending: false })
      .limit(3);

    const startTime = Date.now();

    // Generate "Why Company" answers in three lengths
    const relevantExperience = stories
      ? summarizeRelevantExperience(stories as Story[], company_name, enrichedProducts || [])
      : null;

    const shortAnswer = generateWhyCompanyAnswer(
      company_name,
      enrichedMission || null,
      enrichedProducts || [],
      user_connection || null,
      relevantExperience,
      75
    );

    const standardAnswer = generateWhyCompanyAnswer(
      company_name,
      enrichedMission || null,
      enrichedProducts || [],
      user_connection || null,
      relevantExperience,
      150
    );

    const longAnswer = generateWhyCompanyAnswer(
      company_name,
      enrichedMission || null,
      enrichedProducts || [],
      user_connection || null,
      relevantExperience,
      300
    );

    // Upsert company answer
    const answerData = {
      user_id: user.id,
      company_slug,
      company_name,
      why_company_short: shortAnswer,
      why_company_standard: standardAnswer,
      why_company_long: longAnswer,
      company_mission: enrichedMission,
      company_products: enrichedProducts,
      recent_news: recent_news || [],
      user_connection: user_connection || null,
      relevant_experience: relevantExperience,
      generation_model: 'template-v1',
      generated_at: new Date().toISOString(),
    };

    const { data: answer, error: upsertError } = await supabase
      .from('company_answers')
      .upsert(answerData, { onConflict: 'user_id,company_slug' })
      .select()
      .single();

    if (upsertError) {
      console.error('Error upserting company answer:', upsertError);
      return NextResponse.json(
        { error: 'Failed to save company answer' },
        { status: 500 }
      );
    }

    // Log generation
    const generationTime = Date.now() - startTime;
    await supabase.from('generation_log').insert({
      user_id: user.id,
      request_type: 'company_specific',
      input_data: {
        company_slug,
        company_name,
        has_mission: !!enrichedMission,
        has_products: enrichedProducts && enrichedProducts.length > 0,
        has_connection: !!user_connection,
        story_count: stories?.length || 0,
      },
      model_used: 'template-v1',
      generation_time_ms: generationTime,
      output_data: { answer_id: answer?.id },
      success: true,
    });

    return NextResponse.json(
      {
        success: true,
        regenerated: !!existing,
        answer,
      },
      {
        status: existing ? 200 : 201,
        headers: {
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        },
      }
    );
  } catch (error) {
    console.error('Company answers POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/answers/company
 * List all company-specific answers for the user
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
    const companySlug = searchParams.get('company_slug');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build query
    let query = supabase
      .from('company_answers')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (companySlug) {
      query = query.eq('company_slug', companySlug);
    }

    const { data: answers, error } = await query;

    if (error) {
      console.error('Error fetching company answers:', error);
      return NextResponse.json(
        { error: 'Failed to fetch company answers' },
        { status: 500 }
      );
    }

    // Get total count
    const { count } = await supabase
      .from('company_answers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    return NextResponse.json({
      answers,
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Company answers GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Summarize relevant experience from stories for company context
 */
function summarizeRelevantExperience(
  stories: Story[],
  companyName: string,
  products: string[]
): string {
  if (!stories || stories.length === 0) return '';

  // Find most relevant story based on skills/tech overlap with company products
  const productKeywords = products.flatMap((p) =>
    p.toLowerCase().split(/\s+/)
  );

  let bestStory = stories[0];
  let bestScore = 0;

  for (const story of stories) {
    const skills = story.skills_demonstrated || [];
    const tech = story.technologies || [];
    const keywords = [...skills, ...tech].map((s) => s.toLowerCase());

    const score = keywords.filter((k) =>
      productKeywords.some((pk) => k.includes(pk) || pk.includes(k))
    ).length;

    if (score > bestScore || (score === bestScore && (story.strength_rating || 0) > (bestStory.strength_rating || 0))) {
      bestScore = score;
      bestStory = story;
    }
  }

  // Summarize the best story
  const results = Array.isArray(bestStory.results)
    ? bestStory.results
        .map((r) =>
          typeof r === 'string' ? r : r.description || `${r.metric}: ${r.value}`
        )
        .slice(0, 2)
        .join(' and ')
    : '';

  return `In my experience with ${bestStory.title}, I achieved ${results}. This demonstrates my ability to contribute to ${companyName}'s mission.`;
}

/**
 * Generate a "Why Company" answer
 * In production, this would use an LLM
 */
function generateWhyCompanyAnswer(
  companyName: string,
  mission: string | null,
  products: string[],
  userConnection: string | null,
  relevantExperience: string | null,
  targetWordCount: number
): string {
  const parts: string[] = [];

  // Opening with company interest
  if (mission) {
    parts.push(
      `I'm drawn to ${companyName} because of your mission to ${mission.toLowerCase().replace(/\.$/, '')}.`
    );
  } else if (products.length > 0) {
    parts.push(
      `I'm excited about ${companyName}'s work in ${products.slice(0, 2).join(' and ')}.`
    );
  } else {
    parts.push(`I'm excited about the opportunity to join ${companyName}.`);
  }

  // Personal connection
  if (userConnection) {
    parts.push(userConnection);
  }

  // Product/technical interest
  if (products.length > 0 && targetWordCount > 100) {
    parts.push(
      `The technical challenges involved in ${products[0]} align with my passion for building impactful solutions.`
    );
  }

  // Relevant experience
  if (relevantExperience && targetWordCount > 120) {
    parts.push(relevantExperience);
  }

  // Closing
  if (targetWordCount >= 150) {
    parts.push(
      `I believe my skills and experiences make me a strong fit for ${companyName}, and I'm eager to contribute to your team's success.`
    );
  }

  let answer = parts.join(' ');

  // Trim to target
  const words = answer.split(/\s+/);
  if (words.length > targetWordCount * 1.1) {
    answer = words.slice(0, targetWordCount).join(' ') + '.';
  }

  return answer;
}

/**
 * PUT /api/answers/company
 * Update a company-specific answer
 */
export async function PUT(request: NextRequest) {
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

    const body = await request.json();
    const {
      id,
      company_slug,
      why_company_short,
      why_company_standard,
      why_company_long,
      user_connection,
    } = body;

    // Must provide id or company_slug
    if (!id && !company_slug) {
      return NextResponse.json(
        { error: 'id or company_slug is required' },
        { status: 400 }
      );
    }

    const updateData: Record<string, string | null> = {};

    if (why_company_short !== undefined) {
      updateData.why_company_short = why_company_short;
    }
    if (why_company_standard !== undefined) {
      updateData.why_company_standard = why_company_standard;
    }
    if (why_company_long !== undefined) {
      updateData.why_company_long = why_company_long;
    }
    if (user_connection !== undefined) {
      updateData.user_connection = user_connection;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('company_answers')
      .update(updateData)
      .eq('user_id', user.id);

    if (id) {
      query = query.eq('id', id);
    } else {
      query = query.eq('company_slug', company_slug);
    }

    const { error } = await query;

    if (error) {
      console.error('Error updating company answer:', error);
      return NextResponse.json(
        { error: 'Failed to update answer' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Company answers PUT error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/answers/company?id=<answerId>&company_slug=<slug>
 * Delete a company-specific answer
 */
export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const answerId = searchParams.get('id');
    const companySlug = searchParams.get('company_slug');

    if (!answerId && !companySlug) {
      return NextResponse.json(
        { error: 'id or company_slug is required' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('company_answers')
      .delete()
      .eq('user_id', user.id);

    if (answerId) {
      query = query.eq('id', answerId);
    } else {
      query = query.eq('company_slug', companySlug);
    }

    const { error } = await query;

    if (error) {
      console.error('Error deleting company answer:', error);
      return NextResponse.json(
        { error: 'Failed to delete answer' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Company answers DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
