import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

// Queue prepared application(s) for background submission. The submit worker
// posts only when the ATS exposes a legitimate candidate submission endpoint.
// Hosted forms return to the inbox for browser handoff and final review. Submission is
// real + irreversible, so it fires only on rows the user explicitly sends here.
const REPO = process.env.GITHUB_REPO || 'AbrahamMekonnen/newgrad-radar';

function admin() {
  return createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
    process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder')
  );
}

async function dispatch(): Promise<boolean> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/autoapply.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { mode: 'submit' } }),
        signal: AbortSignal.timeout(8000),
      }
    );
    return res.status === 204;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, all } = await request.json().catch(() => ({}));

  const db = admin();
  let q = db.from('autoapply_job_queue')
    .update({ status: 'submit_requested' })
    .eq('user_id', user.id)
    .eq('status', 'prepared');
  q = all ? q : q.eq('id', id);
  if (!all && !id) return NextResponse.json({ error: 'id or all required' }, { status: 400 });

  const { data, error } = await q.select('id');
  if (error) {
    console.error('submit queue error:', error);
    return NextResponse.json({ error: 'Could not queue' }, { status: 500 });
  }

  const queued = data?.length || 0;
  const triggered = queued > 0 ? await dispatch() : false;
  return NextResponse.json({
    queued,
    triggered,
    message: queued === 0
      ? 'Nothing to submit.'
      : triggered
        ? `Checking ${queued} applications — hosted forms return here ready for browser review and submission.`
        : `Queued ${queued} for the next submit pass.`,
  });
}
