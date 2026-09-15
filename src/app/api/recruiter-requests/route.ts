import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
  process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key')
);

// Queue a company for recruiter sourcing. The scheduled backfill
// (recruiters/enrich.py --from-requests) processes pending rows. Dedupes by
// company_slug when known, bumping request_count so popular asks rank first.
export async function POST(request: NextRequest) {
  try {
    const { companySlug, companyName } = await request.json();
    if (!companyName?.trim()) {
      return NextResponse.json({ error: 'Company name required' }, { status: 400 });
    }
    const slug = companySlug?.trim() || null;

    // If there's already an open request for this company, bump its count.
    if (slug) {
      const { data: existing } = await supabase
        .from('recruiter_requests')
        .select('id, request_count, status')
        .eq('company_slug', slug)
        .maybeSingle();
      if (existing) {
        if (existing.status === 'pending') {
          await supabase
            .from('recruiter_requests')
            .update({ request_count: (existing.request_count || 1) + 1 })
            .eq('id', existing.id);
        }
        return NextResponse.json({ queued: true, alreadyRequested: true });
      }
    }

    const { error } = await supabase.from('recruiter_requests').insert({
      company_slug: slug,
      company_name: companyName.trim(),
      status: 'pending',
    });
    if (error) {
      // Unique-index race: another request for the same slug won — treat as success.
      if (error.code === '23505') {
        return NextResponse.json({ queued: true, alreadyRequested: true });
      }
      console.error('recruiter-request insert error:', error);
      return NextResponse.json({ error: 'Failed to queue request' }, { status: 500 });
    }
    return NextResponse.json({ queued: true });
  } catch (error) {
    console.error('recruiter-request error:', error);
    return NextResponse.json({ error: 'Failed to queue request' }, { status: 500 });
  }
}
