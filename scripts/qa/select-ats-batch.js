/** Select an untouched, authorized ATS cohort without changing queue state. */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..', '..');
for (const file of ['.env.local', 'scraper/.env']) {
  const target = path.join(ROOT, file);
  if (!fs.existsSync(target)) continue;
  for (const line of fs.readFileSync(target, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const valueAfter = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const ats = String(valueAfter('--ats', 'greenhouse')).toLowerCase();
const limit = Math.min(50, Math.max(1, Number(valueAfter('--limit', '10'))));
const output = path.resolve(valueAfter('--out', path.join(ROOT, '.qa', `${ats}-next-batch.json`)));
const qaDir = path.join(ROOT, '.qa');
const seen = new Set();
for (const name of fs.existsSync(qaDir) ? fs.readdirSync(qaDir) : []) {
  if (!name.startsWith('submission-e2e-') || !name.endsWith('.json')) continue;
  try {
    const report = JSON.parse(fs.readFileSync(path.join(qaDir, name), 'utf8'));
    for (const result of report.results || []) if (result.id) seen.add(result.id);
  } catch { /* ignore incomplete report files */ }
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: class DisabledWebSocket {} },
  },
);

(async () => {
  const { data: devices, error: deviceError } = await db.from('autoapply_browser_devices')
    .select('user_id').is('revoked_at', null).order('last_seen_at', { ascending: false }).limit(1);
  if (deviceError || !devices?.[0]) throw deviceError || new Error('No paired user found');
  const { data, error } = await db.from('autoapply_job_queue')
    .select('id,company_name,job_title,status,submitted_at,authorization_source,ats_type,created_at')
    .eq('user_id', devices[0].user_id).eq('ats_type', ats)
    .in('authorization_source', ['standing_rule', 'direct_click'])
    .order('created_at', { ascending: true }).limit(1000);
  if (error) throw error;
  const rows = (data || []).filter((row) => !seen.has(row.id) && row.status !== 'submitted' && !row.submitted_at).slice(0, limit);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(rows.map((row) => row.id), null, 2));
  console.log(JSON.stringify({ output, count: rows.length,
    jobs: rows.map(({ company_name, job_title }) => ({ company: company_name, title: job_title })) }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
