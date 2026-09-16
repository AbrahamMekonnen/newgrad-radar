import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

// The auto-apply "Ready to Submit" inbox: the user's prepared applications.
// Reads/writes with the service role (the queue is machine-owned) but always
// scoped to the authenticated user's own rows.
function admin() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
    process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder')
  );
}

async function requireUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await admin()
    .from('autoapply_job_queue')
    .select('id, job_id, job_title, company_name, company_slug, job_url, ats_type, status, ready_pct, needs_user, prepared_data, prepared_at, submit_log, submitted_at')
    .eq('user_id', user.id)
    // 'prepared' = ready to review; 'submit_requested'/'submitting' = queued for
    // the background submit worker (kept visible so they don't vanish).
    .in('status', ['prepared', 'submit_requested', 'submitting'])
    .order('ready_pct', { ascending: false })
    .limit(200);

  return NextResponse.json({ applications: data || [] });
}

// PATCH: update status ('applied' | 'skipped') and/or save edited fields.
export async function PATCH(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, status, prepared_data, ready_pct, needs_user, learned_answers } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (status && ['applied', 'skipped', 'prepared'].includes(status)) patch.status = status;
  if (Array.isArray(prepared_data)) patch.prepared_data = prepared_data;
  if (typeof ready_pct === 'number') patch.ready_pct = ready_pct;
  if (Array.isArray(needs_user)) patch.needs_user = needs_user;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  // Scope the update to this user's own row.
  const { error } = await admin()
    .from('autoapply_job_queue')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('inbox PATCH error:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  // Learn user-supplied answers for future forms. Store the human option label,
  // keyed by both the original and normalized question, so ATS-specific option
  // IDs are never reused on another company's form.
  if (learned_answers && typeof learned_answers === 'object' && !Array.isArray(learned_answers)) {
    const clean: Record<string, string> = {};
    for (const [question, answer] of Object.entries(learned_answers as Record<string, unknown>).slice(0, 100)) {
      if (typeof answer !== 'string' || !answer.trim()) continue;
      const q = question.trim().slice(0, 1000);
      const value = answer.trim().slice(0, 5000);
      if (!q) continue;
      clean[q] = value;
      const normalized = q.toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
      if (normalized) clean[normalized] = value;
    }
    if (Object.keys(clean).length) {
      const { data: profile } = await admin()
        .from('user_profiles').select('custom_answers').eq('user_id', user.id).maybeSingle();
      const merged = { ...((profile?.custom_answers as Record<string, string>) || {}), ...clean };
      const { error: learnError } = await admin()
        .from('user_profiles').update({ custom_answers: merged }).eq('user_id', user.id);
      if (learnError) console.error('learned answers update error:', learnError);
    }
  }

  return NextResponse.json({ ok: true });
}
