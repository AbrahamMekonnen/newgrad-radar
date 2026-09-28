/**
 * Live ATS form QA runner (DEV/QA).
 *
 * Drives real Chrome through live public application forms, injects the human-like
 * fill harness (extension/dev/form-drive.js), runs it, and aggregates a per-board
 * report. NEVER submits. Use to measure and improve fill coverage over time.
 *
 *   node scripts/qa/ats-live-run.js [perBoard] [board]
 *   node scripts/qa/ats-live-run.js 50 greenhouse
 *
 * Reads URLs from .qa/urls.json ({greenhouse:[],ashby:[],lever:[]}).
 * Writes full results to .qa/results-<ts>.json and prints a summary.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const perBoard = parseInt(process.argv[2] || '12', 10);
const onlyBoard = process.argv[3] || null;
const CONCURRENCY = 3;
const HARNESS = fs.readFileSync(path.join(ROOT, 'extension', 'dev', 'form-drive.js'), 'utf8');

const urls = JSON.parse(fs.readFileSync(path.join(ROOT, '.qa', 'urls.json'), 'utf8'));

async function launch() {
  try { return await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { return await chromium.launch({ headless: true }); }
}

async function driveOne(context, board, url) {
  const page = await context.newPage();
  const out = { board, url };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    // Give the SPA form time to render; wait for any real control.
    await page.waitForSelector('form, [role="combobox"], [data-field-path], input, select', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(HARNESS); // defines window.__hrDrive
    const report = await page.evaluate(() => window.__hrDrive());
    out.report = report;
  } catch (e) {
    out.error = String(e.message || e).split('\n')[0].slice(0, 120);
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

async function runBoard(browser, board, list) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }, locale: 'en-US',
  });
  const results = [];
  const queue = list.slice(0, perBoard);
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const r = await driveOne(context, board, queue[idx]);
      results.push(r);
      const rep = r.report;
      const tag = r.error ? `ERR ${r.error}` : `combo ${rep.counts.comboOk}/${rep.counts.combobox} sel ${rep.counts.selOk}/${rep.counts.select} fails ${rep.fail.length}`;
      console.log(`  [${board} ${idx + 1}/${queue.length}] ${tag}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await context.close();
  return results;
}

function summarize(board, results) {
  const loaded = results.filter((r) => r.report);
  const errored = results.filter((r) => r.error);
  let combo = 0, comboOk = 0, sel = 0, selOk = 0;
  const failReasons = {};
  for (const r of loaded) {
    combo += r.report.counts.combobox; comboOk += r.report.counts.comboOk;
    sel += r.report.counts.select; selOk += r.report.counts.selOk;
    for (const f of r.report.fail) { const k = `${f.kind}:${f.reason}`; failReasons[k] = (failReasons[k] || 0) + 1; }
  }
  const withControls = loaded.filter((r) => r.report.total > 0);
  const noForm = loaded.filter((r) => r.report.total === 0).length; // closed/expired/no form rendered
  const formsFullyOk = withControls.filter((r) => r.report.fail.length === 0).length;
  return {
    board, forms: results.length, loaded: loaded.length, errored: errored.length, noForm,
    formsWithControls: withControls.length, formsFullyOk, comboboxes: combo, comboRetainedPct: combo ? Math.round((comboOk / combo) * 100) : null,
    selects: sel, selectOkPct: sel ? Math.round((selOk / sel) * 100) : null,
    topFailReasons: Object.entries(failReasons).sort((a, b) => b[1] - a[1]).slice(0, 12),
    errorSamples: [...new Set(errored.map((r) => r.error))].slice(0, 6),
  };
}

(async () => {
  const boards = onlyBoard ? [onlyBoard] : ['greenhouse', 'ashby', 'lever'];
  const browser = await launch();
  const all = { at: new Date().toISOString(), perBoard, results: {}, summary: {} };
  for (const board of boards) {
    if (!urls[board] || !urls[board].length) { console.log(`(${board}: no urls)`); continue; }
    console.log(`\n=== ${board} (${Math.min(perBoard, urls[board].length)} forms) ===`);
    const results = await runBoard(browser, board, urls[board]);
    all.results[board] = results;
    all.summary[board] = summarize(board, results);
  }
  await browser.close();
  fs.mkdirSync(path.join(ROOT, '.qa'), { recursive: true });
  const outPath = path.join(ROOT, '.qa', `results-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log('\n===== SUMMARY =====');
  console.log(JSON.stringify(all.summary, null, 2));
  console.log('\nfull results:', path.relative(ROOT, outPath));
})();
