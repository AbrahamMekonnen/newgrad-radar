import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
  );
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    .select('id, job_title, company_name, job_url, ats_type, prepared_data, handoff_expires_at')
    .eq('handoff_token', token).maybeSingle();
  if (!row || !row.handoff_expires_at || new Date(row.handoff_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Handoff expired' }, { status: 404, headers: cors });
  }

  await db.from('autoapply_job_queue').update({ handoff_token: null, handoff_expires_at: null }).eq('id', row.id);
  const fields = (Array.isArray(row.prepared_data) ? row.prepared_data : []).filter((field: Record<string, unknown>) =>
    field.value !== null && field.value !== undefined && field.value !== '' && field.type !== 'input_file'
  );
  return NextResponse.json({
    jobTitle: row.job_title,
    companyName: row.company_name,
    jobUrl: row.job_url,
    atsType: row.ats_type,
    fields,
  }, { headers: cors });
}
