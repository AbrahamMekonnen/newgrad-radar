import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureNtfyProvisioned } from '@/lib/ntfy';

// Rate limiting for company creation
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 companies per hour per user

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const key = `company-create:${userId}`;
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

/**
 * Normalize company name for comparison
 * - Lowercase
 * - Remove common suffixes (Inc, LLC, Corp, etc.)
 * - Remove special characters
 * - Trim whitespace
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(inc\.?|llc\.?|corp\.?|corporation|ltd\.?|limited|co\.?|company)$/i, '')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Generate a URL-safe slug from company name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

interface AddCompanyRequest {
  name: string;
  careers_url?: string;
  tier?: string;
  add_to_list?: boolean; // Whether to add to user's tracked list
}

/**
 * POST /api/companies
 * Add a new company to the global companies table
 *
 * This makes user-added companies available to all users.
 * The company is verified before being added.
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
          error: 'Rate limit exceeded. You can add up to 10 companies per hour.',
          retryAfter: 3600,
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'Retry-After': '3600',
          },
        }
      );
    }

    const body: AddCompanyRequest = await request.json();
    const { name, careers_url, tier = 'other', add_to_list = true } = body;

    // Validate required fields
    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      return NextResponse.json(
        { error: 'Company name must be at least 2 characters' },
        { status: 400 }
      );
    }

    if (trimmedName.length > 100) {
      return NextResponse.json(
        { error: 'Company name must be less than 100 characters' },
        { status: 400 }
      );
    }

    // Validate careers URL if provided
    if (careers_url) {
      try {
        new URL(careers_url);
      } catch {
        return NextResponse.json(
          { error: 'Invalid careers URL format' },
          { status: 400 }
        );
      }
    }

    // Validate tier
    const validTiers = ['faang', 'ai', 'unicorn', 'yc', 'fintech', 'infra', 'other'];
    if (!validTiers.includes(tier)) {
      return NextResponse.json(
        { error: 'Invalid tier. Must be one of: ' + validTiers.join(', ') },
        { status: 400 }
      );
    }

    const slug = generateSlug(trimmedName);
    const normalizedName = normalizeCompanyName(trimmedName);

    // Check for exact slug match in global companies
    const { data: exactMatch } = await supabase
      .from('companies')
      .select('slug, name')
      .eq('slug', slug)
      .single();

    if (exactMatch) {
      return NextResponse.json(
        {
          error: `A company with this name already exists: "${exactMatch.name}"`,
          existing_slug: exactMatch.slug,
          suggestion: 'Search for it in the "Add Companies" tab instead.',
        },
        { status: 409 }
      );
    }

    // Check for fuzzy match (similar names that would create confusion)
    const { data: allCompanies } = await supabase
      .from('companies')
      .select('slug, name');

    if (allCompanies) {
      for (const company of allCompanies) {
        const existingNormalized = normalizeCompanyName(company.name);

        // Check for normalized name match
        if (existingNormalized === normalizedName) {
          return NextResponse.json(
            {
              error: `A similar company already exists: "${company.name}"`,
              existing_slug: company.slug,
              suggestion: 'Search for it in the "Add Companies" tab instead.',
            },
            { status: 409 }
          );
        }

        // Check if one name contains the other (e.g., "Google" vs "Google LLC")
        if (existingNormalized.includes(normalizedName) || normalizedName.includes(existingNormalized)) {
          // Only flag if they're very similar (length difference < 5)
          if (Math.abs(existingNormalized.length - normalizedName.length) < 5) {
            return NextResponse.json(
              {
                error: `A similar company already exists: "${company.name}"`,
                existing_slug: company.slug,
                suggestion: 'Did you mean this company? Search for it in "Add Companies".',
              },
              { status: 409 }
            );
          }
        }
      }
    }

    // Verify the company is real using external sources
    const verifyResponse = await fetch(new URL('/api/verify-company', request.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName }),
    });

    const verifyResult = await verifyResponse.json();
    if (!verifyResult.valid) {
      return NextResponse.json(
        {
          error: verifyResult.error || 'Could not verify this is a real company.',
          suggestion: 'Please check the spelling or try the full company name.',
        },
        { status: 400 }
      );
    }

    // Insert into global companies table with tracking info
    const companyData = {
      slug,
      name: trimmedName,
      tier,
      careers_url: careers_url || null,
      ats_type: null,
      ats_token: null,
      logo_url: null,
      // Tracking fields for user-submitted companies
      added_by: user.id,
      is_user_submitted: true,
      verified_at: new Date().toISOString(),
      verification_source: verifyResult.source || 'unknown',
    };

    const { error: insertError } = await supabase
      .from('companies')
      .insert(companyData);

    if (insertError) {
      console.error('Error inserting company:', insertError);

      // Handle unique constraint violation
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'This company already exists.' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to add company. Please try again.' },
        { status: 500 }
      );
    }

    // Optionally add to user's tracked list
    if (add_to_list) {
      const { error: listError } = await supabase
        .from('user_lists')
        .insert({
          user_id: user.id,
          company_slug: slug,
          auto_apply: false,
          notify_enabled: true,
          notify_mode: 'instant',
        });

      if (listError && listError.code !== '23505') {
        // Log but don't fail - company was added successfully
        console.log('Note: Company added but could not add to user list:', listError);
      } else {
        // Tracking a company opts it into notifications, so make sure the user
        // can actually receive them (push_enabled + ntfy_topic). Best-effort.
        await ensureNtfyProvisioned(supabase, user.id);
      }
    }

    // Log the addition for analytics
    console.log(`Company added by user ${user.id}: ${slug} (${trimmedName})`);

    return NextResponse.json(
      {
        success: true,
        company: {
          slug,
          name: trimmedName,
          tier,
          careers_url: careers_url || null,
        },
        added_to_list: add_to_list,
        message: 'Company added successfully and is now available to all users.',
      },
      {
        status: 201,
        headers: {
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        },
      }
    );
  } catch (error) {
    console.error('Add company error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/companies
 * Search for companies (supports autocomplete)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const query = searchParams.get('q') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const tier = searchParams.get('tier');

    let dbQuery = supabase
      .from('companies')
      .select('slug, name, tier, logo_url, careers_url')
      .order('name');

    if (query) {
      dbQuery = dbQuery.ilike('name', `%${query}%`);
    }

    if (tier && tier !== 'all') {
      dbQuery = dbQuery.eq('tier', tier);
    }

    dbQuery = dbQuery.limit(limit);

    const { data: companies, error } = await dbQuery;

    if (error) {
      console.error('Error fetching companies:', error);
      return NextResponse.json(
        { error: 'Failed to fetch companies' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      companies: companies || [],
      count: companies?.length || 0,
    });
  } catch (error) {
    console.error('Search companies error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
