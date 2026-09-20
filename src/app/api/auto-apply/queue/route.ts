import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { isAutoApplySupported, validApplyTarget } from '@/lib/autoapply-support';

// Queue ONE job (from a job card) into the SAME auto-apply pipeline the saved
// criteria feed: autoapply_job_queue -> prepare_worker -> the /auto-apply inbox.
// This keeps the job section and the Auto-Apply section in sync — a per-job
// "Auto Apply" and the standing rules both land in one place.
const REPO = process.env.GITHUB_REPO || 'AbrahamMekonnen/newgrad-radar';

function admin() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
    process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder')
  );
}

async function dispatchPrepare(): Promise<boolean> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/autoapply.yml/dispatches`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main', inputs: { mode: 'queue' } }),
        signal: AbortSignal.timeout(8000),
      }
    );
    return res.status === 204;
  } catch { return false; }
}

// GET: the current user's auto-apply queue state as { jobId: status }, so job
// cards can show "In Auto-Apply" and stay in sync with the Auto-Apply tab.
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ statuses: {} });
  const { data } = await admin()
    .from('autoapply_job_queue')
    .select('job_id, status')
    .eq('user_id', user.id)
    .limit(2000);
  const statuses: Record<string, string> = {};
  for (const r of data || []) statuses[r.job_id] = r.status;
  return NextResponse.json({ statuses });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { jobId } = await request.json().catch(() => ({}));
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const db = admin();
  const { data: job } = await db.from('jobs')
    .select('id, title, company_slug, company_name, url, apply_url, ats_type')
    .eq('id', jobId).limit(1).maybeSingle();
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const url = job.apply_url || job.url || '';
  if (!isAutoApplySupported(job.ats_type)) {
    return NextResponse.json({ queued: 0, message: `Auto-apply isn't available for ${job.ats_type || 'this'} yet.` });
  }
  if (!validApplyTarget(job.ats_type, url, job.company_slug)) {
    return NextResponse.json({ queued: 0, message: 'This listing has no direct application form to auto-fill — open it to apply.' });
  }

  // Already queued/prepared/applied? Don't duplicate.
  const { data: existing } = await db.from('autoapply_job_queue')
    .select('id, status, answers').eq('user_id', user.id).eq('job_id', jobId).limit(1).maybeSingle();
  if (existing) {
    if (['error', 'form_fetch_failed'].includes(existing.status)) {
      const { error: retryError } = await db.from('autoapply_job_queue').update({
        status: 'pending', prepare_log: null, submit_log: null,
      }).eq('id', existing.id).eq('user_id', user.id);
      if (retryError) return NextResponse.json({ error: 'Could not retry preparation' }, { status: 500 });
      const triggered = await dispatchPrepare();
      return NextResponse.json({ queued: 1, retried: true, triggered,
        message: triggered ? 'Retrying preparation now.' : 'Queued for the next preparation run.' });
    }
    return NextResponse.json({ queued: 0, already: true, status: existing.status,
      message: 'Already in your Auto-Apply queue — see it under Applications → Auto-Apply.' });
  }

  const { error } = await db.from('autoapply_job_queue').insert({
    user_id: user.id, job_id: jobId, job_title: job.title,
    company_slug: job.company_slug, company_name: job.company_name,
    job_url: url, ats_type: job.ats_type, status: 'pending', priority: 2,
    answers: { submit_after_prepare: true, origin: 'job_card' },
    authorization_source: 'direct_click', execution_channel: 'user_browser',
  });
  if (error) {
    console.error('queue insert error:', error);
    return NextResponse.json({ error: 'Could not queue' }, { status: 500 });
  }

  const triggered = await dispatchPrepare();
  return NextResponse.json({
    queued: 1,
    triggered,
    message: triggered
      ? 'Added to Auto-Apply — preparing it now. Track it under Applications → Auto-Apply.'
      : 'Added to Auto-Apply — it will be prepared on the next run under Applications → Auto-Apply.',
  });
}
