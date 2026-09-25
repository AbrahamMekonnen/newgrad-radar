/**
 * Answer Generation Scheduler
 *
 * Background job system for auto-generating "Why Company" answers
 * when users add companies to their My List.
 *
 * Features:
 * - Automatic queueing on user_lists insert (via DB trigger)
 * - Rate-limited background processing
 * - Exponential backoff on failures
 * - User notifications when answers are ready
 */

import { createClient as createServerClient } from '@/lib/supabase/server';

// ============================================
// Types
// ============================================

export interface QueuedAnswer {
  id: string;
  user_id: string;
  company_slug: string;
  company_name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  last_attempt_at: string | null;
  error_message: string | null;
  answer_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedAnswer {
  why_company_short: string; // ~75 words
  why_company_standard: string; // ~150 words
  why_company_long: string; // ~300 words
  company_mission: string | null;
  company_products: string[];
  recent_news: string[];
}

export interface AnswerGenerationResult {
  success: boolean;
  answerId?: string;
  error?: string;
}

// ============================================
// Rate Limiting Configuration
// ============================================

const RATE_LIMIT = {
  // Max concurrent generations per worker
  MAX_CONCURRENT: 3,
  // Delay between processing batches (ms)
  BATCH_DELAY_MS: 1000,
  // Min delay between API calls (ms)
  MIN_API_DELAY_MS: 200,
  // Max retries for failed generations
  MAX_RETRIES: 3,
  // Base delay for exponential backoff (ms)
  BACKOFF_BASE_MS: 60000,
};

// ============================================
// Queue Management
// ============================================

/**
 * Queue a company for answer generation
 * Note: This is usually handled automatically by the DB trigger,
 * but this function allows manual queueing if needed.
 */
export async function queueAnswerGeneration(
  userId: string,
  companySlug: string,
  companyName: string,
  priority: number = 5
): Promise<{ success: boolean; queueId?: string; answerId?: string; error?: string }> {
  const supabase = await createServerClient();

  // Check if answer already exists
  const { data: existingAnswer } = await supabase
    .from('company_answers')
    .select('id')
    .eq('user_id', userId)
    .eq('company_slug', companySlug)
    .single();

  if (existingAnswer) {
    return {
      success: true,
      answerId: existingAnswer.id,
      error: 'Answer already exists',
    };
  }

  // Check if already queued
  const { data: existingQueue } = await supabase
    .from('answer_generation_queue')
    .select('id, status')
    .eq('user_id', userId)
    .eq('company_slug', companySlug)
    .in('status', ['pending', 'processing'])
    .single();

  if (existingQueue) {
    return {
      success: true,
      queueId: existingQueue.id,
      error: 'Already queued',
    };
  }

  // Add to queue
  const { data, error } = await supabase
    .from('answer_generation_queue')
    .insert({
      user_id: userId,
      company_slug: companySlug,
      company_name: companyName,
      priority,
      scheduled_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to queue answer generation:', error);
    return { success: false, error: error.message };
  }

  return { success: true, queueId: data.id };
}

/**
 * Get pending items from the queue
 */
export async function getPendingQueue(
  userId?: string,
  limit: number = 10
): Promise<QueuedAnswer[]> {
  const supabase = await createServerClient();

  let query = supabase
    .from('answer_generation_queue')
    .select('*')
    .in('status', ['pending', 'processing'])
    .order('priority', { ascending: true })
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to get pending queue:', error);
    return [];
  }

  return data as QueuedAnswer[];
}

/**
 * Get queue status for a user
 */
export async function getQueueStatus(
  userId: string
): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  items: QueuedAnswer[];
}> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('answer_generation_queue')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Failed to get queue status:', error);
    return { pending: 0, processing: 0, completed: 0, failed: 0, items: [] };
  }

  const items = data as QueuedAnswer[];

  return {
    pending: items.filter((i) => i.status === 'pending').length,
    processing: items.filter((i) => i.status === 'processing').length,
    completed: items.filter((i) => i.status === 'completed').length,
    failed: items.filter((i) => i.status === 'failed').length,
    items,
  };
}

/**
 * Cancel a queued generation
 */
export async function cancelQueuedGeneration(
  queueId: string,
  userId: string
): Promise<boolean> {
  const supabase = await createServerClient();

  const { error } = await supabase
    .from('answer_generation_queue')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', queueId)
    .eq('user_id', userId)
    .in('status', ['pending', 'processing']);

  if (error) {
    console.error('Failed to cancel queued generation:', error);
    return false;
  }

  return true;
}

// ============================================
// Answer Generation
// ============================================

/**
 * Generate "Why Company" answers using AI
 * This is the core generation function that creates personalized answers
 */
export async function generateCompanyAnswer(
  userId: string,
  companySlug: string,
  companyName: string
): Promise<GeneratedAnswer | null> {
  // Get user profile for personalization
  const supabase = await createServerClient();

  const [profileResult, companyResult, storiesResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('first_name, location, linkedin_url, portfolio_url, github_url, skills:custom_answers')
      .eq('user_id', userId)
      .single(),
    supabase
      .from('companies')
      .select('name, description, industry, founded_year, headquarters, funding_stage')
      .eq('slug', companySlug)
      .single(),
    supabase
      .from('user_story_bank')
      .select('title, situation, task, results, skills_demonstrated')
      .eq('user_id', userId)
      .limit(3),
  ]);

  const profile = profileResult.data;
  const company = companyResult.data;
  const stories = storiesResult.data || [];

  // Build context for generation
  const companyContext = {
    name: company?.name || companyName,
    description: company?.description,
    industry: company?.industry,
    founded: company?.founded_year,
    headquarters: company?.headquarters,
    stage: company?.funding_stage,
  };

  const userContext = {
    name: profile?.first_name,
    location: profile?.location,
    hasLinkedin: !!profile?.linkedin_url,
    hasPortfolio: !!profile?.portfolio_url,
    hasGithub: !!profile?.github_url,
    topStories: stories.slice(0, 2).map((s) => ({
      title: s.title,
      skills: s.skills_demonstrated,
    })),
  };

  // Generate answers using Gemini API (free tier)
  try {
    const answers = await callGeminiForAnswers(companyContext, userContext);
    return answers;
  } catch (error) {
    console.error('Answer generation failed:', error);
    return null;
  }
}

/**
 * Call Gemini API to generate answers
 * Uses the free tier with rate limiting
 */
async function callGeminiForAnswers(
  company: {
    name: string;
    description?: string | null;
    industry?: string | null;
    founded?: number | null;
    headquarters?: string | null;
    stage?: string | null;
  },
  user: {
    name?: string | null;
    location?: string | null;
    hasLinkedin?: boolean;
    hasPortfolio?: boolean;
    hasGithub?: boolean;
    topStories?: Array<{ title: string; skills: string[] | null }>;
  }
): Promise<GeneratedAnswer> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn('GEMINI_API_KEY not configured, using template answers');
    return generateTemplateAnswers(company);
  }

  const prompt = buildGenerationPrompt(company, user);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!generatedText) {
    throw new Error('Empty response from Gemini');
  }

  return parseGeneratedAnswers(generatedText, company);
}

/**
 * Build the generation prompt
 */
function buildGenerationPrompt(
  company: {
    name: string;
    description?: string | null;
    industry?: string | null;
    founded?: number | null;
    headquarters?: string | null;
    stage?: string | null;
  },
  user: {
    name?: string | null;
    location?: string | null;
    topStories?: Array<{ title: string; skills: string[] | null }>;
  }
): string {
  const companyInfo = [
    `Company: ${company.name}`,
    company.description ? `Description: ${company.description}` : null,
    company.industry ? `Industry: ${company.industry}` : null,
    company.founded ? `Founded: ${company.founded}` : null,
    company.headquarters ? `HQ: ${company.headquarters}` : null,
    company.stage ? `Stage: ${company.stage}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const userInfo =
    user.topStories && user.topStories.length > 0
      ? `\nRelevant experience:\n${user.topStories
          .map((s) => `- ${s.title}${s.skills ? ` (${s.skills.join(', ')})` : ''}`)
          .join('\n')}`
      : '';

  return `Generate "Why do you want to work at ${company.name}?" answers for a new grad software engineer.

${companyInfo}
${userInfo}

Generate THREE versions:
1. SHORT (exactly 75 words): Perfect for application forms with word limits
2. STANDARD (exactly 150 words): For typical interview responses
3. LONG (exactly 300 words): For detailed cover letters

Requirements:
- Be specific to ${company.name}, not generic
- Sound authentic, not corporate
- Mention specific products/technologies if known
- Reference the company's mission or impact
- Connect to software engineering career goals
- Avoid cliches like "industry leader" or "passionate about technology"

Format your response EXACTLY as:
---SHORT---
[75-word answer here]
---STANDARD---
[150-word answer here]
---LONG---
[300-word answer here]
---END---`;
}

/**
 * Parse the generated text into structured answers
 */
function parseGeneratedAnswers(
  text: string,
  company: { name: string }
): GeneratedAnswer {
  const shortMatch = text.match(/---SHORT---\s*([\s\S]*?)\s*---STANDARD---/);
  const standardMatch = text.match(
    /---STANDARD---\s*([\s\S]*?)\s*---LONG---/
  );
  const longMatch = text.match(/---LONG---\s*([\s\S]*?)\s*---END---/);

  return {
    why_company_short: shortMatch?.[1]?.trim() || generateFallbackShort(company.name),
    why_company_standard:
      standardMatch?.[1]?.trim() || generateFallbackStandard(company.name),
    why_company_long: longMatch?.[1]?.trim() || generateFallbackLong(company.name),
    company_mission: null,
    company_products: [],
    recent_news: [],
  };
}

/**
 * Generate template answers when API is not available
 */
function generateTemplateAnswers(company: { name: string }): GeneratedAnswer {
  return {
    why_company_short: generateFallbackShort(company.name),
    why_company_standard: generateFallbackStandard(company.name),
    why_company_long: generateFallbackLong(company.name),
    company_mission: null,
    company_products: [],
    recent_news: [],
  };
}

function generateFallbackShort(companyName: string): string {
  return `I'm drawn to ${companyName} because of its innovative approach to solving complex technical challenges. The engineering culture emphasizes both technical excellence and meaningful impact. As a new grad, I'm excited about the opportunity to contribute to products that matter while learning from experienced engineers. ${companyName}'s commitment to growth makes it an ideal place to start my career.`;
}

function generateFallbackStandard(companyName: string): string {
  return `I'm excited about ${companyName} for several reasons that align with my career goals as a software engineer. First, the technical challenges you tackle require the kind of innovative problem-solving I've developed through my projects and coursework. I'm particularly interested in how ${companyName} approaches scalability and system design.

Second, I value ${companyName}'s engineering culture that balances moving fast with building reliable systems. The emphasis on code quality and continuous learning resonates with how I approach my own development.

Finally, the impact ${companyName} has on its users is meaningful. I want to build software that makes a real difference, and ${companyName} provides that opportunity at scale. The combination of technical growth potential and meaningful work makes this role particularly compelling for starting my engineering career.`;
}

function generateFallbackLong(companyName: string): string {
  return `My interest in ${companyName} stems from a genuine appreciation for how you approach both technical challenges and product development. As a new graduate software engineer, I've been intentional about finding a company where I can grow while contributing meaningfully, and ${companyName} stands out for several specific reasons.

The technical complexity of ${companyName}'s systems excites me. Building software that operates at scale requires careful consideration of architecture, performance, and reliability - areas I've explored in my coursework and projects but want to understand at a deeper level. I'm particularly interested in how your engineering teams balance shipping quickly with maintaining code quality and system stability.

Beyond the technical work, I appreciate ${companyName}'s product philosophy. The focus on solving real problems for users rather than adding features for their own sake aligns with my belief that the best engineering serves genuine needs. I want to write code that matters, and ${companyName} provides that opportunity.

The engineering culture at ${companyName} also attracts me. From what I've learned through research and conversations, there's a strong emphasis on continuous learning, knowledge sharing, and mentorship. As someone starting my career, having access to experienced engineers who can help me develop best practices and technical judgment is invaluable.

Finally, I'm motivated by ${companyName}'s trajectory and the opportunity to contribute during an important growth phase. The combination of challenging problems, meaningful products, strong culture, and growth potential makes ${companyName} my top choice for beginning my software engineering career.`;
}

// ============================================
// Background Processing
// ============================================

/**
 * Process a batch of queued items
 * This should be called by a cron job or background worker
 */
export async function processAnswerQueue(
  batchSize: number = 5
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const supabase = await createServerClient();

  // Get and lock a batch of items
  const { data: batch, error } = await supabase.rpc('get_answer_generation_batch', {
    p_batch_size: batchSize,
    p_lock_duration_minutes: 5,
  });

  if (error) {
    console.error('Failed to get batch:', error);
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  if (!batch || batch.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  // Process items with rate limiting
  for (const item of batch) {
    try {
      const result = await processQueueItem(item);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error('Error processing queue item:', error);
      failed++;
    }

    // Rate limit between items
    await delay(RATE_LIMIT.MIN_API_DELAY_MS);
  }

  return {
    processed: batch.length,
    succeeded,
    failed,
  };
}

/**
 * Process a single queue item
 */
async function processQueueItem(
  item: {
    id: string;
    user_id: string;
    company_slug: string;
    company_name: string;
    attempts: number;
  }
): Promise<AnswerGenerationResult> {
  const supabase = await createServerClient();

  try {
    // Generate the answers
    const answers = await generateCompanyAnswer(
      item.user_id,
      item.company_slug,
      item.company_name
    );

    if (!answers) {
      throw new Error('Generation returned null');
    }

    // Save to company_answers table
    const { data: savedAnswer, error: saveError } = await supabase
      .from('company_answers')
      .upsert({
        user_id: item.user_id,
        company_slug: item.company_slug,
        company_name: item.company_name,
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
      throw new Error(`Failed to save answer: ${saveError.message}`);
    }

    // Mark as completed and notify user
    await supabase.rpc('complete_answer_generation', {
      p_queue_id: item.id,
      p_answer_id: savedAnswer.id,
    });

    // Log successful generation
    await supabase.from('generation_log').insert({
      user_id: item.user_id,
      request_type: 'company_specific',
      input_data: {
        company_slug: item.company_slug,
        company_name: item.company_name,
      },
      model_used: 'gemini-2.5-flash',
      success: true,
      output_data: { answer_id: savedAnswer.id },
    });

    return { success: true, answerId: savedAnswer.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Mark as failed with retry logic
    await supabase.rpc('fail_answer_generation', {
      p_queue_id: item.id,
      p_error_message: errorMessage,
    });

    // Log failed generation
    await supabase.from('generation_log').insert({
      user_id: item.user_id,
      request_type: 'company_specific',
      input_data: {
        company_slug: item.company_slug,
        company_name: item.company_name,
      },
      success: false,
      error_message: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

// ============================================
// User Notifications
// ============================================

/**
 * Get unread notifications for a user
 */
export async function getUnreadNotifications(
  userId: string,
  limit: number = 20
): Promise<Array<{
  id: string;
  type: string;
  title: string;
  body: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}>> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('user_notifications')
    .select('id, type, title, body, reference_type, reference_id, created_at')
    .eq('user_id', userId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to get notifications:', error);
    return [];
  }

  return data || [];
}

/**
 * Mark notifications as read
 */
export async function markNotificationsRead(
  userId: string,
  notificationIds: string[]
): Promise<boolean> {
  const supabase = await createServerClient();

  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('id', notificationIds);

  if (error) {
    console.error('Failed to mark notifications as read:', error);
    return false;
  }

  return true;
}

/**
 * Dismiss a notification
 */
export async function dismissNotification(
  userId: string,
  notificationId: string
): Promise<boolean> {
  const supabase = await createServerClient();

  const { error } = await supabase
    .from('user_notifications')
    .update({
      read_at: new Date().toISOString(),
      dismissed_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', notificationId);

  if (error) {
    console.error('Failed to dismiss notification:', error);
    return false;
  }

  return true;
}

// ============================================
// Utilities
// ============================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Health check for the queue system
 */
export async function getQueueHealth(): Promise<{
  healthy: boolean;
  pending: number;
  processing: number;
  stuck: number;
  failed_last_hour: number;
}> {
  const supabase = await createServerClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const [pendingResult, processingResult, stuckResult, failedResult] =
    await Promise.all([
      supabase
        .from('answer_generation_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('answer_generation_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'processing'),
      supabase
        .from('answer_generation_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'processing')
        .lt('last_attempt_at', fiveMinutesAgo),
      supabase
        .from('answer_generation_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('updated_at', oneHourAgo),
    ]);

  const pending = pendingResult.count || 0;
  const processing = processingResult.count || 0;
  const stuck = stuckResult.count || 0;
  const failedLastHour = failedResult.count || 0;

  return {
    healthy: stuck === 0 && failedLastHour < 10,
    pending,
    processing,
    stuck,
    failed_last_hour: failedLastHour,
  };
}
