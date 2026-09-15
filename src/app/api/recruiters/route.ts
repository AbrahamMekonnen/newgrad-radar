import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Manual community-added recruiter (from the "Add Recruiter" modal). This is
// how a user drops in a personal email / phone they found elsewhere (e.g. a
// ContactOut lookup) — data we can't source at scale for free. Source is
// tagged 'user' so it's distinguishable from the OSINT pipeline's finds.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, title, email, phone, linkedin_url, company_slug, job_id } = body;

    if (!name?.trim() || !company_slug) {
      return NextResponse.json({ error: 'Name and company are required' }, { status: 400 });
    }
    if (!email?.trim() && !phone?.trim() && !linkedin_url?.trim()) {
      return NextResponse.json(
        { error: 'Provide at least one of email, phone, or LinkedIn URL' },
        { status: 400 }
      );
    }

    // Avoid duplicate same-name rows for the same company.
    const { data: existing } = await supabase
      .from('recruiters')
      .select('id')
      .eq('company_slug', company_slug)
      .ilike('name', name.trim())
      .maybeSingle();

    if (existing) {
      // Merge any newly-provided contact fields onto the existing row.
      const patch: Record<string, unknown> = {};
      if (email?.trim()) patch.email = email.trim();
      if (phone?.trim()) patch.phone = phone.trim();
      if (linkedin_url?.trim()) {
        patch.linkedin_url = linkedin_url.trim();
        patch.linkedin_verified = true;
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from('recruiters').update(patch).eq('id', existing.id);
      }
      return NextResponse.json({ id: existing.id, merged: true });
    }

    const { data, error } = await supabase
      .from('recruiters')
      .insert({
        job_id: job_id || null,
        company_slug,
        name: name.trim(),
        title: title?.trim() || null,
        email: email?.trim() || null,
        // A user-supplied email counts as a single verified variant so it shows
        // in the same UI the OSINT candidates use.
        email_variants: email?.trim()
          ? [{ email: email.trim(), confidence: 0.9, verified: true }]
          : null,
        email_verified: !!email?.trim(),
        phone: phone?.trim() || null,
        linkedin_url: linkedin_url?.trim() || null,
        linkedin_verified: !!linkedin_url?.trim(),
        source: 'user',
        verification_status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      console.error('Add recruiter error:', error);
      return NextResponse.json({ error: 'Failed to add recruiter' }, { status: 500 });
    }

    return NextResponse.json({ id: data.id, created: true });
  } catch (error) {
    console.error('Add recruiter error:', error);
    return NextResponse.json({ error: 'Failed to add recruiter' }, { status: 500 });
  }
}
