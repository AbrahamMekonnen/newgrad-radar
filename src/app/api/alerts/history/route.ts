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

  const db = admin();
  const JOB_COLS = 'id, title, company_name, company_slug, location, url, apply_url, ats_type, posted';

  // 1) Saved-alert matches (source: 'alert').
  const { data, error } = await db.from('alert_matches').select(
    'id, alert_id, job_id, delivery_status, delivery_mode, delivered_at, created_at, ' +
    'job_alerts!inner(id, user_id, name), ' +
    `jobs!inner(${JOB_COLS})`
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
  // Key by (job_id, source) so a job can appear under each section it was
  // notified through (Watchlist vs Alerts vs All Jobs).
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of (data || []) as unknown as RawRow[]) {
    const alert = row.job_alerts as unknown as { name?: string };
    const job = row.jobs as unknown as Record<string, unknown>;
    const key = `${row.job_id}|alert`;
    const current = byKey.get(key);
    if (current) {
      const names = current.alert_names as string[];
      if (alert?.name && !names.includes(alert.name)) names.push(alert.name);
      continue;
    }
    byKey.set(key, {
      id: row.id, job_id: row.job_id, source: 'alert', delivery_status: row.delivery_status,
      delivery_mode: row.delivery_mode, delivered_at: row.delivered_at, created_at: row.created_at,
      alert_names: alert?.name ? [alert.name] : [], job,
    });
  }

  // 2) Watchlist / all-jobs notifications (source stored on the row).
  interface NotifRow { id: string; job_id: string; source: string; created_at: string; jobs: Record<string, unknown>; }
  const { data: notif } = await db.from('notified_jobs')
    .select(`id, job_id, source, created_at, jobs!inner(${JOB_COLS})`)
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(300);
  for (const row of (notif || []) as unknown as NotifRow[]) {
    const key = `${row.job_id}|${row.source}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      id: row.id, job_id: row.job_id, source: row.source, delivery_status: 'sent',
      delivery_mode: 'push', delivered_at: row.created_at, created_at: row.created_at,
      alert_names: [], job: row.jobs,
    });
  }

  const matches = [...byKey.values()].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)));
  return NextResponse.json({ matches }, { headers: { 'Cache-Control': 'no-store' } });
}
