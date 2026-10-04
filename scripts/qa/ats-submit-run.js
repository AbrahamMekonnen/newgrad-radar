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
const resumeOverrideArg = valueAfter('--resume-override', '');
const trustedSubmitProbe = args.has('--trusted-submit-probe');
const resumeOverride = resumeOverrideArg ? path.resolve(resumeOverrideArg) : '';
if (resumeOverride && !fs.existsSync(resumeOverride)) throw new Error(`Resume override not found: ${resumeOverride}`);
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
const bounded = (promise, timeoutMs, fallback) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
]);

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

  let browser;
  let context;
  const newPage = async () => {
    if (!browser?.isConnected()) {
      browser = await chromium.launch({ channel: 'chrome', headless: false });
      // Real extension content scripts are not blocked by a page's script-src
      // CSP. bypassCSP gives the QA injection harness the same privilege.
      context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', bypassCSP: true });
    }
    try {
      return await context.newPage();
    } catch (error) {
      // A single ATS tab can crash or close Chrome while it is loading. Rebuild
      // the isolated QA browser so the remaining cohort is still exercised.
      await browser?.close().catch(() => {});
      browser = await chromium.launch({ channel: 'chrome', headless: false });
      context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', bypassCSP: true });
      return context.newPage();
    }
  };
  const results = [];
  const runStamp = `${Date.now()}`;
  const evidenceDir = path.join(ROOT, '.qa', `submission-evidence-${ats}-${runStamp}`);
  const out = path.join(ROOT, '.qa', `submission-e2e-${ats}-${runStamp}.json`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const saveReport = () => fs.writeFileSync(out, JSON.stringify({ ats, limit, completed: results.length, results }, null, 2));
  try {
    for (let index = 0; index < limit; index++) {
      let job;
      if (explicitQueueIds.length) {
        const selectedQueueId = explicitQueueIds[index];
        if (!selectedQueueId) break;
        const { data: row, error: rowError } = await db.from('autoapply_job_queue')
          .select('id,user_id,job_title,company_name,job_url,ats_type,status,submitted_at,prepared_data,authorization_source,execution_channel')
          .eq('id', selectedQueueId).eq('user_id', devices[0].user_id).single();
        if (rowError || !row) throw rowError || new Error('Selected queue row not found');
        if (row.authorization_source !== 'standing_rule' && row.authorization_source !== 'direct_click') throw new Error('Selected row is not authorized');
        if (String(row.ats_type).toLowerCase() !== ats) throw new Error(`Selected row is ${row.ats_type}, expected ${ats}`);
        if (row.status === 'submitted' || row.submitted_at) {
          results.push({ id: row.id, company: row.company_name, title: row.job_title,
            stage: 'skipped_already_submitted', progressEvents: [], evidence: {}, networkEvents: [], consoleErrors: [] });
          saveReport();
          console.log(`[${index + 1}/${limit}] ${row.company_name} — skipped_already_submitted`);
          continue;
        }
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
      const page = await newPage();
      console.log(`[${index + 1}/${limit}] ${job.companyName} — page_opened`);
      let jobFinished = false;
      const finishOnce = (outcome) => {
        if (jobFinished) return;
        jobFinished = true;
        finish(outcome);
      };
      // Playwright's page.evaluate() has no operation timeout. A malformed or
      // wedged ATS page must never hold the rest of a cohort indefinitely.
      const hardPageDeadline = setTimeout(() => {
        finishOnce({ stage: 'page_deadline', detail: 'ATS page exceeded the QA job deadline.' });
        void page.close({ runBeforeUnload: false }).catch(() => {});
      }, 180000);
      page.once('close', () => finishOnce({ stage: 'page_closed', detail: 'ATS page closed before a terminal event.' }));
      const progressEvents = [];
      const resolverEvents = [];
      const networkEvents = [];
      const consoleErrors = [];
      let trustedProbeStarted = false;
      page.on('console', (message) => {
        if (message.type() === 'error' && consoleErrors.length < 50) {
          const value = message.text().slice(0, 2000);
          if (!consoleErrors.includes(value)) consoleErrors.push(value);
        }
      });
      page.on('pageerror', (error) => {
        if (consoleErrors.length >= 50) return;
        const value = `Page error: ${String(error?.stack || error).slice(0, 4000)}`;
        if (!consoleErrors.includes(value)) consoleErrors.push(value);
      });
      page.on('response', (response) => {
        const request = response.request();
        if (['document', 'xhr', 'fetch'].includes(request.resourceType())) {
          networkEvents.push({ method: request.method(), status: response.status(), url: response.url().slice(0, 1000) });
          if (networkEvents.length > 100) networkEvents.shift();
        }
      });
      await page.exposeBinding('__hrMessage', async (_, message) => {
        if (message.type === 'PAGE_READY') return { job };
        if (message.type === 'FETCH_FILE') {
          if (resumeOverride) {
            const bytes = fs.readFileSync(resumeOverride);
            return { data: bytes.toString('base64'), type: 'application/pdf', name: path.basename(resumeOverride) };
          }
          const response = await fetch(message.url);
          if (!response.ok) throw new Error('Could not fetch resume');
          const bytes = Buffer.from(await response.arrayBuffer());
          return { data: bytes.toString('base64'), type: response.headers.get('content-type') || 'application/pdf', name: path.basename(new URL(message.url).pathname) || 'resume.pdf' };
        }
        if (message.type === 'RESOLVE_FIELDS') {
          const resolved = await api(token, '/api/auto-apply/browser/resolve', {
            method: 'POST', body: JSON.stringify({ jobId: job.id, planId: message.planId, fields: message.fields, fastOnly: message.fastOnly === true }),
          });
          resolverEvents.push({ at: new Date().toISOString(), fastOnly: message.fastOnly === true,
            fieldCount: message.fields?.length || 0, answerCount: resolved.answers?.length || 0,
            answerSources: [...new Set((resolved.answers || []).map((answer) => answer.source).filter(Boolean))],
            deferredAiCount: resolved.deferredAi?.length || 0, needsContext: (resolved.needsContext || []).map((item) => ({ fieldId: item.fieldId, reason: item.reason })),
            providerTrace: resolved.providerTrace || [] });
          return resolved;
        }
        if (message.type === 'PROGRESS') {
          progressEvents.push({ at: new Date().toISOString(), stage: message.stage,
            detail: message.detail, filled: message.filled, total: message.total });
          const result = await api(token, '/api/auto-apply/browser/device', {
            method: 'PATCH', body: JSON.stringify({ id: job.id, leaseId: job.leaseId, stage: message.stage,
              detail: message.detail, filled: message.filled, total: message.total,
              extensionVersion: 'playwright-e2e-1', runId: crypto.randomUUID() }),
          });
          if (trustedSubmitProbe && message.stage === 'submit_started' && !trustedProbeStarted) {
            trustedProbeStarted = true;
            setTimeout(() => {
              void page.getByRole('button', { name: /submit( your)? application/i }).last()
                .click({ timeout: 5000 }).catch((error) => consoleErrors.push(`Trusted submit probe failed: ${String(error).slice(0, 500)}`));
            }, 700);
          }
          if (['submitted', 'waiting_for_user', 'failed'].includes(message.stage)) finishOnce({ stage: message.stage, result, detail: message.detail });
          return result;
        }
        return { ok: false };
      });
      await page.addInitScript(() => {
        const runtime = { sendMessage: (message) => globalThis.__hrMessage(message) };
        // Branded Chrome already exposes a non-replaceable window.chrome.
        // Install the QA message bridge on that object instead of attempting to
        // replace it (which can fail silently and leave runtime undefined).
        const chromeObject = globalThis.chrome || {};
        try {
          Object.defineProperty(chromeObject, 'runtime', { configurable: true, value: runtime });
        } catch {
          try { chromeObject.runtime = runtime; } catch { /* diagnosed below */ }
        }
        if (!globalThis.chrome) {
          try { Object.defineProperty(globalThis, 'chrome', { configurable: true, value: chromeObject }); } catch { /* diagnosed below */ }
        }
        globalThis.__hireRadarDomEvents = [];
        const record = (type, event) => {
          const target = event.target;
          const form = target?.form || target?.closest?.('form');
          globalThis.__hireRadarDomEvents.push({ at: Date.now(), type, trusted: Boolean(event.isTrusted),
            target: String(target?.tagName || '').toLowerCase(), targetType: String(target?.type || ''),
            text: String(target?.textContent || target?.value || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            defaultPrevented: Boolean(event.defaultPrevented),
            // checkValidity() emits `invalid`, which would recursively call this
            // audit listener. Query validity without dispatching another event.
            formValid: form ? !form.querySelector(':invalid') : null });
          if (globalThis.__hireRadarDomEvents.length > 100) globalThis.__hireRadarDomEvents.shift();
        };
        addEventListener('click', (event) => {
          if (event.target?.closest?.('button,input[type="submit"],input[type="button"]')) record('click', event);
        }, true);
        addEventListener('submit', (event) => record('submit', event), true);
        addEventListener('invalid', (event) => record('invalid', event), true);
      });
      const injectProductionEngine = async (frame = page.mainFrame()) => {
        if (await frame.evaluate(() => Boolean(globalThis.__hireRadarAutoApplyLoaded)).catch(() => true)) return;
        // Manifest content scripts run at document_idle. Match that timing so
        // QA never mutates a React form while the ATS is still hydrating.
        await frame.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
        await frame.evaluate(() => new Promise((resolve) => {
          if ('requestIdleCallback' in globalThis) requestIdleCallback(() => resolve(), { timeout: 1500 });
          else setTimeout(resolve, 300);
        })).catch(() => {});
        if (await frame.evaluate(() => Boolean(globalThis.__hireRadarAutoApplyLoaded)).catch(() => true)) return;
        for (const file of modules) {
          await frame.addScriptTag({ path: file });
          const responsive = await bounded(frame.evaluate(() => true).catch(() => false), 2000, false);
          if (!responsive) throw new Error(`Page event loop stopped responding after ${path.basename(file)}`);
        }
      };
      page.on('domcontentloaded', () => {
        for (const frame of page.frames()) void injectProductionEngine(frame).catch(() => {});
      });
      page.on('frameattached', (frame) => { void injectProductionEngine(frame).catch(() => {}); });
      page.on('framenavigated', (frame) => { void injectProductionEngine(frame).catch(() => {}); });
      await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      console.log(`[${index + 1}/${limit}] ${job.companyName} — navigated`);
      const applicationFrames = page.frames().filter((frame) => {
        try {
          const host = new URL(frame.url()).hostname;
          return frame === page.mainFrame() || /greenhouse\.io$|lever\.co$|ashbyhq\.com$|myworkdayjobs\.com$|smartrecruiters\.com$|smartr\.me$|icims\.com$|taleo\.net$|bamboohr\.com$|breezy\.hr$|applytojob\.com$|recruitee\.com$|jobvite\.com$/.test(host);
        } catch { return frame === page.mainFrame(); }
      });
      for (const frame of applicationFrames) {
        console.log(`[${index + 1}/${limit}] ${job.companyName} — injecting ${frame.url().slice(0, 120)}`);
        await injectProductionEngine(frame).catch((error) => {
          consoleErrors.push(`Injection failed in ${frame.url().slice(0, 300)}: ${String(error).slice(0, 700)}`);
        });
        console.log(`[${index + 1}/${limit}] ${job.companyName} — injected`);
      }
      await page.waitForTimeout(7000).catch(() => {});
      console.log(`[${index + 1}/${limit}] ${job.companyName} — startup events=${progressEvents.length}/${resolverEvents.length}`);
      const outcome = progressEvents.length || resolverEvents.length
        ? await Promise.race([
          terminal,
          new Promise((resolve) => setTimeout(() => resolve({ stage: 'timeout' }), 150000)),
        ])
        : { stage: 'engine_start_failed', detail: 'Production content script emitted no worker events within 7 seconds.' };
      await page.waitForTimeout(750).catch(() => {});
      const evidence = await bounded(page.evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const labelFor = (element) => {
          const byFor = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
          return (byFor?.innerText || element.closest('label')?.innerText || element.getAttribute('aria-label') ||
            element.getAttribute('placeholder') || element.name || '').trim().replace(/\s+/g, ' ').slice(0, 500);
        };
        const controls = [...document.querySelectorAll('input,select,textarea,[role="combobox"],[role="listbox"]')]
          .filter(visible).map((element) => {
            const type = (element.getAttribute('type') || element.tagName || element.getAttribute('role') || '').toLowerCase();
            const sensitive = /password|ssn|social security/i.test(`${element.name || ''} ${labelFor(element)}`);
            const rawValue = 'value' in element ? String(element.value || '') : String(element.textContent || '');
            return {
              label: labelFor(element), name: element.name || '', type,
              required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
              value: sensitive ? '[redacted]' : rawValue.slice(0, 1000), checked: Boolean(element.checked),
              valid: element.checkValidity ? element.checkValidity() : null,
              validationMessage: String(element.validationMessage || '').slice(0, 500),
              ariaInvalid: element.getAttribute('aria-invalid'), disabled: Boolean(element.disabled),
              options: element.tagName === 'SELECT' ? [...element.options].map((o) => ({ text: o.text.trim().slice(0, 300), value: o.value.slice(0, 300), selected: o.selected })).slice(0, 200) : [],
            };
          });
        const errorText = [...document.querySelectorAll('[role="alert"],.error,.errors,.field-error,.validation-error,[aria-invalid="true"]')]
          .filter(visible).map((node) => String(node.innerText || node.textContent || '').trim().replace(/\s+/g, ' '))
          .filter(Boolean).slice(0, 100);
        return { url: location.href, title: document.title, controls,
          unresolvedRequired: controls.filter((c) => c.required && (!c.valid || !c.value) && !c.checked),
          visibleErrors: [...new Set(errorText)] };
      }).catch((error) => ({ captureError: String(error) })), 5000,
      { captureError: 'Evidence capture timed out because the ATS page stopped responding.' });
      // Independently inventory every frame. This deliberately does not reuse
      // the extension scanner, so disagreements expose discovery defects.
      const frameCoverage = await Promise.all(page.frames().map(async (frame, frameIndex) => bounded(frame.evaluate(({ frameIndex }) => {
        const visible = (element) => {
          const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const label = (element) => {
          const byFor = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
          const group = element.closest('fieldset,[role="group"],[role="radiogroup"],[class*="question"],[class*="field"]');
          if (element.type === 'radio' || element.type === 'checkbox') {
            const heading = group?.querySelector('legend,[class*="question-label"],[class*="application-label"],[class*="heading"],[class*="title"]');
            const headingText = String(heading?.textContent || '').replace(/\s+/g, ' ').trim();
            if (headingText) return headingText.slice(0, 300);
          }
          return String(byFor?.textContent || element.labels?.[0]?.textContent || element.getAttribute('aria-label')
            || group?.querySelector('legend,[class*="label"],[class*="heading"]')?.textContent
            || element.getAttribute('placeholder') || element.name || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        };
        const nodes = [...document.querySelectorAll('input,select,textarea,[role="combobox"],[contenteditable="true"]')]
          .filter((element) => visible(element) && !['hidden', 'submit', 'button'].includes(String(element.type || '').toLowerCase()));
        return { frameIndex, url: location.href, domEvents: globalThis.__hireRadarDomEvents || [], controls: nodes.map((element, index) => {
          const isCombo = element.getAttribute('role') === 'combobox' || element.getAttribute('aria-autocomplete');
          let committedCombo = false;
          if (isCombo) {
            for (let container = element.parentElement, depth = 0; container && depth < 6; container = container.parentElement, depth++) {
              const selected = container.querySelector(':scope > [class*=singleValue], :scope > [class*=single-value], [aria-selected="true"]');
              if (selected && !/^select|^choose/i.test(String(selected.textContent || '').trim())) { committedCombo = true; break; }
            }
          }
          return {
            browserKey: `${frameIndex}|${index}|${String(element.name || element.id || '')}`,
            label: label(element), name: element.name || '',
            type: String(isCombo ? 'combobox' : element.type || element.getAttribute('role') || element.tagName).toLowerCase(),
            required: Boolean(element.required || element.getAttribute('aria-required') === 'true'
              || /(?:\*|✱)\s*$/.test(label(element))),
            filled: element.type === 'checkbox' || element.type === 'radio' ? Boolean(element.checked)
              : Boolean(String(element.value || '').trim()) || committedCombo,
            valid: element.checkValidity?.() ?? null, ariaInvalid: element.getAttribute('aria-invalid') || '', disabled: Boolean(element.disabled),
          };
        }).slice(0, 250) };
      }, { frameIndex }).catch((error) => ({ frameIndex, url: frame.url(), captureError: String(error), controls: [] })),
      5000, { frameIndex, url: frame.url(), captureError: 'Frame evidence capture timed out.', controls: [] })));
      const parsedProgress = progressEvents.map((event) => {
        try { return JSON.parse(event.detail?.detail || ''); } catch { return null; }
      }).filter(Boolean);
      const extensionAudits = parsedProgress.map((item) => item.coverageAudit).filter(Boolean);
      const latestExtensionAudit = extensionAudits.at(-1) || null;
      const browserControls = frameCoverage.flatMap((frame) => frame.controls || []);
      const norm = (value) => String(value || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
      const scannerControls = extensionAudits.flatMap((audit) => audit.controls || []);
      const scannerLabels = new Set(scannerControls.map((field) => norm(field.label)).filter(Boolean));
      const scannerByLabel = new Map(scannerControls.map((field) => [norm(field.label), norm(field.type)]));
      const dedupe = new Set();
      const browserLogical = browserControls.filter((field) => {
        const signature = `${norm(field.label)}|${field.name}|${norm(field.type).replace(/radio|checkbox/, 'choice')}`;
        if (dedupe.has(signature)) return false;
        dedupe.add(signature); return true;
      });
      evidence.coverageAudit = {
        frameCount: frameCoverage.length, frameCoverage,
        browserCandidateCount: browserControls.length, browserLogicalCount: browserLogical.length,
        browserRequiredCount: browserLogical.filter((field) => field.required).length,
        browserInvalidRequiredCount: browserLogical.filter((field) => field.required && (!field.filled || field.valid === false || field.ariaInvalid === 'true')).length,
        extensionSnapshots: extensionAudits,
        latestExtensionAudit,
        browserControlsMissingFromScanner: extensionAudits.length ? browserLogical.filter((field) =>
          norm(field.label) && !scannerLabels.has(norm(field.label))).slice(0, 100) : [],
        scannerTypeMismatches: extensionAudits.length ? browserLogical.filter((field) =>
          scannerByLabel.has(norm(field.label)) && scannerByLabel.get(norm(field.label)) !== norm(field.type))
          .map((field) => ({ label: field.label, browserType: field.type, scannerType: scannerByLabel.get(norm(field.label)) })).slice(0, 100) : [],
        lifecycleDiagnostics: [...new Map(parsedProgress.flatMap((item) => item.diagnostics || [])
          .map((item) => [JSON.stringify(item), item])).values()].slice(0, 300),
      };
      const domEvents = frameCoverage.flatMap((frame) => frame.domEvents || []);
      const submitClicks = domEvents.filter((event) => event.type === 'click' && /submit|apply/.test(String(event.text || '').toLowerCase()));
      const submitEvents = domEvents.filter((event) => event.type === 'submit');
      const applicationPosts = networkEvents.filter((event) => {
        if (event.method !== 'POST') return false;
        if (ats === 'greenhouse') {
          try {
            const url = new URL(event.url);
            return (url.hostname === 'boards.greenhouse.io' || url.hostname === 'job-boards.greenhouse.io')
              && /\/(?:embed\/[^/]+\/)?(?:jobs?\/)?\d+\/?$/.test(url.pathname);
          } catch { return false; }
        }
        return !/snowplow|spl\.greenhouse|amazonaws\.com|recaptcha|google-analytics|analytics|doubleclick|datadog|segment|rudderstack|zoominfo|linkedin\.com\/wa/.test(event.url);
      });
      const verificationResponses = applicationPosts.filter((event) => event.status === 428);
      const successResponses = applicationPosts.filter((event) => event.status >= 200 && event.status < 400 && event.status !== 202);
      evidence.submissionAudit = {
        clickCount: submitClicks.length, trustedClickCount: submitClicks.filter((event) => event.trusted).length,
        submitEventCount: submitEvents.length, applicationPosts, verificationResponses, successResponses,
        reactHydrationError: consoleErrors.some((message) => /react error #418|invariant=418/i.test(message)),
        classification: verificationResponses.length ? 'email_verification_requested'
          : successResponses.length ? 'application_request_accepted'
            : applicationPosts.length ? 'application_request_rejected'
              : submitEvents.length ? 'submit_event_without_application_request'
                : submitClicks.length ? 'click_without_submit_event' : 'submit_not_attempted',
      };
      const screenshot = path.join(evidenceDir, `${String(index + 1).padStart(2, '0')}-${job.id}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, timeout: 10000 }).catch((error) => { evidence.screenshotError = String(error); });
      results.push({ id: job.id, company: job.companyName, title: job.jobTitle, ...outcome,
        progressEvents, resolverEvents, evidence, networkEvents, consoleErrors, screenshot });
      saveReport();
      console.log(`[${index + 1}/${limit}] ${job.companyName} — ${outcome.stage}`);
      clearTimeout(hardPageDeadline);
      await bounded(page.close({ runBeforeUnload: false }).catch(() => {}), 5000, null);
    }
  } finally {
    await bounded(browser?.close().catch(() => {}), 5000, null);
    await db.from('autoapply_browser_devices').update({ revoked_at: new Date().toISOString() }).eq('id', device.id);
    for (const other of otherDevices || []) {
      await db.from('autoapply_browser_devices').update({ paused: other.paused }).eq('id', other.id);
    }
  }
  saveReport();
  console.log(JSON.stringify({ report: out, outcomes: results.reduce((a, r) => ((a[r.stage] = (a[r.stage] || 0) + 1), a), {}) }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
