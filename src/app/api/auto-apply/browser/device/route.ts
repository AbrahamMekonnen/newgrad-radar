import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { browserApplyUrl } from '@/lib/autoapply-support';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
  );
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });

async function deviceFor(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || token.length < 32) return null;
  const { data } = await admin().from('autoapply_browser_devices')
    .select('id, user_id, paused, revoked_at').eq('device_token_hash', hash(token)).maybeSingle();
  return data && !data.revoked_at ? data : null;
}

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors }); }

// One-time exchange: the web app creates the code; the extension receives the
// long random device credential once. The database stores only its hash.
export async function POST(request: NextRequest) {
  const { code, name } = await request.json().catch(() => ({}));
  if (typeof code !== 'string' || code.length < 20) return json({ error: 'Invalid pairing code' }, 400);
  const db = admin();
  const { data: pending } = await db.from('autoapply_browser_devices')
    .select('id, pairing_expires_at').eq('pairing_code_hash', hash(code)).maybeSingle();
  if (!pending || !pending.pairing_expires_at || new Date(pending.pairing_expires_at).getTime() < Date.now()) {
    return json({ error: 'Pairing code expired' }, 404);
  }
  const token = randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  const { error } = await db.from('autoapply_browser_devices').update({
    name: typeof name === 'string' ? name.slice(0, 100) : 'Browser helper',
    pairing_code_hash: null,
    pairing_expires_at: null,
    device_token_hash: hash(token),
    paired_at: now,
    last_seen_at: now,
  }).eq('id', pending.id).eq('pairing_code_hash', hash(code));
  if (error) return json({ error: 'Could not pair browser' }, 500);
  return json({ token, deviceId: pending.id });
}

export async function GET(request: NextRequest) {
  const device = await deviceFor(request);
  if (!device) return json({ error: 'Unpaired browser' }, 401);
  const db = admin();
  await db.from('autoapply_browser_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', device.id);
  if (device.paused) return json({ paused: true, job: null });

  const { data, error } = await db.rpc('claim_browser_autoapply_job', {
    p_user_id: device.user_id, p_device_id: device.id, p_lease_minutes: 10,
  });
  if (error) return json({ error: 'Could not claim application' }, 500);
  const row = data?.[0];
  if (!row) return json({ paused: false, job: null });
  const allFields = Array.isArray(row.prepared_data) ? row.prepared_data : [];
  const fields = allFields.filter((field: Record<string, unknown>) =>
    field.value !== null && field.value !== undefined && field.value !== '' && String(field.value).toLowerCase() !== 'unfilled');
  // claim_browser_autoapply_job only returns jobs authorized by a direct click
  // or a standing rule. Completeness is decided from the live ATS form after
  // browser-side resolution; it must not revoke the user's submit permission.
  const { data: prof } = await db.from('user_profiles')
    .select('auto_submit').eq('user_id', device.user_id).maybeSingle();
  return json({ job: {
    id: row.id,
    leaseId: row.browser_lease_id,
    jobTitle: row.job_title,
    companyName: row.company_name,
    jobUrl: browserApplyUrl(row.ats_type, row.job_url),
    atsType: row.ats_type,
    fields,
    autoSubmit: prof?.auto_submit === true,
    autoSubmitRequested: true,
  }});
}

export async function PATCH(request: NextRequest) {
  const device = await deviceFor(request);
  if (!device) return json({ error: 'Unpaired browser' }, 401);
  const { id, leaseId, stage, detail, filled, total } = await request.json().catch(() => ({}));
  const allowed = ['tab_opened', 'filling', 'waiting_for_user', 'submit_started', 'submitted', 'failed'];
  if (!id || !leaseId || !allowed.includes(stage)) return json({ error: 'Invalid progress report' }, 400);
  const db = admin();
  const { data: row } = await db.from('autoapply_job_queue')
    .select('id, user_id, job_id').eq('id', id).eq('user_id', device.user_id)
    .eq('browser_device_id', device.id).eq('browser_lease_id', leaseId).maybeSingle();
  if (!row) return json({ error: 'Lease expired' }, 409);

  const now = new Date().toISOString();
  const progress = { stage, detail: String(detail || '').slice(0, 1000), filled, total, at: now };
  if (stage === 'submitted') {
    const { data: receipt, error } = await db.rpc('record_browser_autoapply_submission', {
      p_queue_id: row.id,
      p_user_id: row.user_id,
      p_device_id: device.id,
      p_lease_id: leaseId,
    });
    if (error) return json({ error: 'Could not record submission' }, 500);
    if (!receipt?.ok) return json({ error: receipt?.error === 'lease_expired' ? 'Lease expired' : 'Could not record submission' }, 409);
    return json({ ok: true, submittedAt: receipt.submittedAt, alreadyRecorded: receipt.alreadyRecorded === true });
  }
  const status = stage === 'waiting_for_user' ? 'waiting_for_user'
    : stage === 'failed' ? 'waiting_for_browser' : 'browser_filling';
  const { error } = await db.from('autoapply_job_queue').update({
    status, browser_stage: stage, browser_progress: progress,
    browser_lease_expires_at: stage === 'failed' ? null : new Date(Date.now() + 10 * 60_000).toISOString(),
  }).eq('id', row.id).eq('browser_lease_id', leaseId);
  return error ? json({ error: 'Could not update progress' }, 500) : json({ ok: true });
}
