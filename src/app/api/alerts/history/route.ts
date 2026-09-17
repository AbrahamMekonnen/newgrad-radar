import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
  );
}

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await admin().from('alert_matches').select(
    'id, alert_id, job_id, delivery_status, delivery_mode, delivered_at, created_at, ' +
    'job_alerts!inner(id, user_id, name), ' +
    'jobs!inner(id, title, company_name, company_slug, location, url, apply_url, ats_type, posted)'
  ).eq('job_alerts.user_id', user.id).order('created_at', { ascending: false }).limit(300);
  if (error) {
    console.error('alert history error:', error);
    return NextResponse.json({ error: 'Could not load notified jobs' }, { status: 500 });
  }

  interface RawRow {
    id: string; alert_id: string; job_id: string; delivery_status: string; delivery_mode: string;
    delivered_at: string | null; created_at: string;
    job_alerts: { name?: string }; jobs: Record<string, unknown>;
  }
  const rows = (data || []) as unknown as RawRow[];
  const byJob = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const alert = row.job_alerts as unknown as { name?: string };
    const job = row.jobs as unknown as Record<string, unknown>;
    const current = byJob.get(row.job_id);
    if (current) {
      const names = current.alert_names as string[];
      if (alert?.name && !names.includes(alert.name)) names.push(alert.name);
      continue;
    }
    byJob.set(row.job_id, {
      id: row.id, job_id: row.job_id, delivery_status: row.delivery_status,
      delivery_mode: row.delivery_mode, delivered_at: row.delivered_at, created_at: row.created_at,
      alert_names: alert?.name ? [alert.name] : [], job,
    });
  }
  return NextResponse.json({ matches: [...byJob.values()] }, { headers: { 'Cache-Control': 'no-store' } });
}
