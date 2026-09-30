/** Reconcile durable receipts against captured ATS evidence. */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ROOT = path.resolve(__dirname, '..', '..');
for (const file of ['.env.local', 'scraper/.env']) {
  const p = path.join(ROOT, file); if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('='); const key = line.slice(0, i).trim();
    if (!(key in process.env)) process.env[key] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}
const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: node reconcile-submission-report.js <report> [--apply]');
const apply = process.argv.includes('--apply');
const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8'));
const rejected = report.results.filter((result) => result.stage === 'submitted'
  && report.ats === 'greenhouse'
  && !/\/confirmation(?:[/?#]|$)/i.test(new URL(result.evidence?.url || 'https://invalid/').pathname));

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const changes = [];
  for (const result of rejected) {
    const { data: row } = await db.from('autoapply_job_queue').select('id,user_id,job_id').eq('id', result.id).single();
    const { data: receipt } = await db.from('autoapply_submission_receipts').select('id,submitted_at').eq('queue_id', result.id).maybeSingle();
    changes.push({ queueId: result.id, company: result.company, title: result.title,
      finalUrl: result.evidence?.url, receiptId: receipt?.id || null });
    if (!apply || !row || !receipt) continue;
    await db.from('autoapply_submission_receipts').delete().eq('id', receipt.id);
    await db.from('autoapply_job_queue').update({ status: 'waiting_for_user', submitted_at: null,
      browser_stage: 'qa_success_evidence_rejected',
      submit_log: { status: 'evidence_rejected', detail: 'Captured ATS response did not reach the Greenhouse confirmation route.' },
    }).eq('id', row.id);
    await db.from('saved_jobs').update({ status: 'saved', applied_at: null })
      .eq('user_id', row.user_id).eq('job_id', row.job_id).eq('applied_at', receipt.submitted_at);
  }
  console.log(JSON.stringify({ apply, rejected: changes.length, changes }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
