import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { browserApplyUrl } from '@/lib/autoapply-support';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
  );
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = admin();
  const { data: row } = await db.from('autoapply_job_queue')
    .select('id, job_url, prepared_data').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!row?.job_url || !Array.isArray(row.prepared_data)) {
    return NextResponse.json({ error: 'Prepared application not found' }, { status: 404 });
  }

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await db.from('autoapply_job_queue')
    .update({ handoff_token: token, handoff_expires_at: expires })
    .eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'Could not create handoff' }, { status: 500 });

  const payload = Buffer.from(JSON.stringify({ origin: request.nextUrl.origin, token })).toString('base64url');
  const separator = row.job_url.includes('#') ? '&' : '#';
  return NextResponse.json({ url: `${row.job_url}${separator}newgrad-radar=${payload}`, expires });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token || token.length < 32) return NextResponse.json({ error: 'Invalid token' }, { status: 400, headers: cors });
  const db = admin();
  const { data: row } = await db.from('autoapply_job_queue')
    .select('id, user_id, job_id, job_title, company_name, job_url, ats_type, prepared_data, needs_user, submit_log, handoff_expires_at')
    .eq('handoff_token', token).maybeSingle();
  if (!row || !row.handoff_expires_at || new Date(row.handoff_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Handoff expired' }, { status: 404, headers: cors });
  }

  const allFields = Array.isArray(row.prepared_data) ? row.prepared_data : [];
  const isSupportedResume = (field: Record<string, unknown>) => {
    if (field.type !== 'input_file' && field.source !== 'file') return true;
    if (typeof field.value !== 'string') return false;
    try {
      const url = new URL(field.value);
      return url.hostname === 'jmrbyubrrpxxvotsljms.supabase.co'
        && url.pathname.includes('/storage/v1/object/public/resumes/');
    } catch {
      return false;
    }
  };
  const fields = allFields.filter((field: Record<string, unknown>) =>
    field.value !== null && field.value !== undefined && field.value !== '' && isSupportedResume(field)
  );
  const submitStatus = (row.submit_log as { status?: string } | null)?.status || '';
  const { data: prof } = await db.from('user_profiles')
    .select('auto_submit').eq('user_id', row.user_id).maybeSingle();
  return NextResponse.json({
    jobTitle: row.job_title,
    companyName: row.company_name,
    jobUrl: browserApplyUrl(row.ats_type, row.job_url),
    atsType: row.ats_type,
    fields,
    autoSubmit: prof?.auto_submit === true,
    // Opening this tokenized handoff is the user's explicit request to finish
    // this application. The extension still requires the live ATS form to pass
    // native validation before it can submit.
    autoSubmitRequested: ['browser_required', 'needs_captcha'].includes(submitStatus),
  }, { headers: cors });
}

export async function PATCH(request: NextRequest) {
  const { token, status } = await request.json().catch(() => ({}));
  if (!token || token.length < 32 || status !== 'submitted') {
    return NextResponse.json({ error: 'Invalid report' }, { status: 400, headers: cors });
  }

  const db = admin();
  const { data: row } = await db.from('autoapply_job_queue')
    .select('id, user_id, job_id, submit_log, handoff_expires_at')
    .eq('handoff_token', token).maybeSingle();
  if (!row || !row.handoff_expires_at || new Date(row.handoff_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Handoff expired' }, { status: 404, headers: cors });
  }
  const priorStatus = (row.submit_log as { status?: string } | null)?.status || '';
  if (!['browser_required', 'needs_captcha'].includes(priorStatus)) {
    return NextResponse.json({ error: 'Submission was not requested' }, { status: 409, headers: cors });
  }

  const submittedAt = new Date().toISOString();
  const successLog = {
    status: 'browser_confirmed',
    detail: 'The ATS displayed a verified submission success page.',
    at: submittedAt,
  };
  const { error } = await db.from('autoapply_job_queue').update({
    status: 'submitted',
    submitted_at: submittedAt,
    submit_log: successLog,
  }).eq('id', row.id).eq('handoff_token', token);
  if (error) return NextResponse.json({ error: 'Could not record submission' }, { status: 500, headers: cors });

  const { error: syncError } = await db.from('saved_jobs').upsert({
    user_id: row.user_id,
    job_id: row.job_id,
    status: 'applied',
    applied_at: submittedAt,
    updated_at: submittedAt,
  }, { onConflict: 'user_id,job_id' });
  if (syncError) {
    console.error('browser submission sync error:', syncError);
    await db.from('autoapply_job_queue').update({
      status: 'prepared',
      submitted_at: null,
      submit_log: {
        status: 'sync_failed',
        detail: 'The ATS accepted the application, but dashboard synchronization failed.',
        at: new Date().toISOString(),
      },
    }).eq('id', row.id).eq('handoff_token', token);
    return NextResponse.json({ error: 'Could not synchronize submission' }, { status: 500, headers: cors });
  }

  await db.from('autoapply_job_queue').update({
    handoff_token: null,
    handoff_expires_at: null,
  }).eq('id', row.id).eq('handoff_token', token);
  return NextResponse.json({ ok: true, submittedAt }, { headers: cors });
}
