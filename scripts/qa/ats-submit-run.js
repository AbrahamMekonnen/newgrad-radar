/** Gated E2E runner for authorized queue rows. This performs real submissions. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..', '..');
for (const file of ['.env.local', 'scraper/.env']) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const args = new Set(process.argv.slice(2));
const valueAfter = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const ats = valueAfter('--ats', 'greenhouse');
const limit = Math.min(50, Math.max(1, Number(valueAfter('--limit', '1'))));
const queueId = valueAfter('--queue-id', '');
const queueIdsFile = valueAfter('--queue-ids-file', '');
const explicitQueueIds = queueIdsFile
  ? JSON.parse(fs.readFileSync(path.resolve(queueIdsFile), 'utf8'))
  : (queueId ? [queueId] : []);
if (!args.has('--submit') || process.env.HIRERADAR_LIVE_SUBMIT !== 'YES') {
  throw new Error('Real submission requires --submit and HIRERADAR_LIVE_SUBMIT=YES.');
}

const origin = process.env.HIRERADAR_ORIGIN || 'https://newgrad-radar.vercel.app';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: class DisabledWebSocket {} },
});
const modules = ['ats-recipes.js', 'ats-adapters.js', 'execution-contract.js',
  'combobox-interaction.js', 'content.js'].map((name) => path.join(ROOT, 'extension', name));

async function api(token, route, options = {}) {
  const response = await fetch(origin + route, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HireRadar returned ${response.status}`);
  return body;
}

async function main() {
  const { data: devices } = await db.from('autoapply_browser_devices')
    .select('user_id').is('revoked_at', null).order('last_seen_at', { ascending: false }).limit(1);
  if (!devices?.[0]) throw new Error('No paired user found.');
  const { data: activeDevices } = await db.from('autoapply_browser_devices')
    .select('id,name,paused').eq('user_id', devices[0].user_id).is('revoked_at', null);
  const staleQaDevices = (activeDevices || []).filter((item) => item.name === 'Playwright E2E submission QA');
  if (staleQaDevices.length) {
    const interruptedAt = new Date().toISOString();
    for (const stale of staleQaDevices) {
      await db.from('autoapply_browser_devices').update({ revoked_at: interruptedAt }).eq('id', stale.id);
    }
    // An interrupted QA process cannot execute its finally block. Restore only
    // when its active temp device proves this process caused the stale pause.
    for (const regular of (activeDevices || []).filter((item) => item.name !== 'Playwright E2E submission QA')) {
      await db.from('autoapply_browser_devices').update({ paused: false }).eq('id', regular.id);
    }
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: device, error } = await db.from('autoapply_browser_devices').insert({
    user_id: devices[0].user_id,
    name: 'Playwright E2E submission QA',
    device_token_hash: tokenHash,
    paired_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;

  // Keep the user's installed extension from racing this exact-ID QA cohort.
  const { data: otherDevices } = await db.from('autoapply_browser_devices')
    .select('id,paused').eq('user_id', devices[0].user_id).is('revoked_at', null).neq('id', device.id);
  for (const other of otherDevices || []) {
    await db.from('autoapply_browser_devices').update({ paused: true }).eq('id', other.id);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  // Real extension content scripts are not blocked by a page's script-src CSP.
  // bypassCSP gives the QA injection harness the same privilege boundary.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', bypassCSP: true });
  const results = [];
  try {
    for (let index = 0; index < limit; index++) {
      let job;
      if (explicitQueueIds.length) {
        const selectedQueueId = explicitQueueIds[index];
        if (!selectedQueueId) break;
        const { data: row, error: rowError } = await db.from('autoapply_job_queue')
          .select('id,user_id,job_title,company_name,job_url,ats_type,prepared_data,authorization_source,execution_channel')
          .eq('id', selectedQueueId).eq('user_id', devices[0].user_id).single();
        if (rowError || !row) throw rowError || new Error('Selected queue row not found');
        if (row.authorization_source !== 'standing_rule' && row.authorization_source !== 'direct_click') throw new Error('Selected row is not authorized');
        if (String(row.ats_type).toLowerCase() !== ats) throw new Error(`Selected row is ${row.ats_type}, expected ${ats}`);
        const leaseId = crypto.randomUUID();
        const { error: leaseError } = await db.from('autoapply_job_queue').update({
          status: 'browser_filling', browser_device_id: device.id, browser_lease_id: leaseId,
          browser_lease_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), browser_stage: 'playwright_claimed',
        }).eq('id', row.id);
        if (leaseError) throw leaseError;
        job = { id: row.id, leaseId, jobTitle: row.job_title, companyName: row.company_name,
          jobUrl: row.job_url, atsType: row.ats_type,
          fields: (Array.isArray(row.prepared_data) ? row.prepared_data : []).filter((f) => f.value !== null && f.value !== undefined && f.value !== '' && String(f.value).toLowerCase() !== 'unfilled') };
      } else {
        const claimed = await api(token, '/api/auto-apply/browser/device');
        job = claimed.job;
      }
      if (!job) break;
      if (String(job.atsType).toLowerCase() !== ats) throw new Error(`Campaign escaped ATS boundary: ${job.atsType}`);
      job.autoSubmit = true;
      job.autoSubmitRequested = true;
      let finish;
      const terminal = new Promise((resolve) => { finish = resolve; });
      const page = await context.newPage();
      await page.exposeBinding('__hrMessage', async (_, message) => {
        if (message.type === 'PAGE_READY') return { job };
        if (message.type === 'FETCH_FILE') {
          const response = await fetch(message.url);
          if (!response.ok) throw new Error('Could not fetch resume');
          const bytes = Buffer.from(await response.arrayBuffer());
          return { data: bytes.toString('base64'), type: response.headers.get('content-type') || 'application/pdf', name: path.basename(new URL(message.url).pathname) || 'resume.pdf' };
        }
        if (message.type === 'RESOLVE_FIELDS') return api(token, '/api/auto-apply/browser/resolve', {
          method: 'POST', body: JSON.stringify({ jobId: job.id, planId: message.planId, fields: message.fields, fastOnly: message.fastOnly === true }),
        });
        if (message.type === 'PROGRESS') {
          const result = await api(token, '/api/auto-apply/browser/device', {
            method: 'PATCH', body: JSON.stringify({ id: job.id, leaseId: job.leaseId, stage: message.stage,
              detail: message.detail, filled: message.filled, total: message.total,
              extensionVersion: 'playwright-e2e-1', runId: crypto.randomUUID() }),
          });
          if (['submitted', 'waiting_for_user', 'failed'].includes(message.stage)) finish({ stage: message.stage, result, detail: message.detail });
          return result;
        }
        return { ok: false };
      });
      await page.addInitScript(() => {
        globalThis.chrome = { runtime: { sendMessage: (message) => globalThis.__hrMessage(message) } };
      });
      const injectProductionEngine = async () => {
        if (await page.evaluate(() => Boolean(globalThis.__hireRadarAutoApplyLoaded)).catch(() => true)) return;
        for (const file of modules) await page.addScriptTag({ path: file });
      };
      page.on('domcontentloaded', () => { void injectProductionEngine().catch(() => {}); });
      await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await injectProductionEngine();
      const outcome = await Promise.race([
        terminal,
        new Promise((resolve) => setTimeout(() => resolve({ stage: 'timeout' }), 150000)),
      ]);
      results.push({ id: job.id, company: job.companyName, title: job.jobTitle, ...outcome });
      console.log(`[${index + 1}/${limit}] ${job.companyName} — ${outcome.stage}`);
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
    await db.from('autoapply_browser_devices').update({ revoked_at: new Date().toISOString() }).eq('id', device.id);
    for (const other of otherDevices || []) {
      await db.from('autoapply_browser_devices').update({ paused: other.paused }).eq('id', other.id);
    }
  }
  const out = path.join(ROOT, '.qa', `submission-e2e-${ats}-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ ats, limit, results }, null, 2));
  console.log(JSON.stringify({ report: out, outcomes: results.reduce((a, r) => ((a[r.stage] = (a[r.stage] || 0) + 1), a), {}) }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
