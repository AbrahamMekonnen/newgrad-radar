/**
 * Backfill salary_min/salary_max + funding_stage on the jobs table so those
 * FILTERS work — reusing the SAME estimators the job cards already display
 * (levels.fyi per-company, tier estimates, and the company funding map). No
 * description parsing; nothing new invented.
 *
 *   npx tsx scripts/backfill-filters.ts            # apply
 *   npx tsx scripts/backfill-filters.ts --dry-run  # report only
 */
import { getLevelsFyiSalary } from '../src/lib/levels-fyi-data';
import { ESTIMATED_NEW_GRAD_RANGES } from '../src/lib/salary-sources';
import { KNOWN_COMPANIES } from '../src/lib/company-enricher';
import { fundingStageToFilter } from '../src/lib/types';

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
if (!url || !key) { console.error('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const dryRun = process.argv.includes('--dry-run');

// PostgREST over fetch — avoids supabase-js's realtime WebSocket (Node < 22).
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function rest(path: string, init?: RequestInit) {
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r;
}

// Default new-grad SWE base range for unclassified ('other') companies, so the
// salary filter has coverage across the board. levels.fyi (exact) and the tier
// estimates take precedence; this is only the last-resort estimate.
const DEFAULT_RANGE = { min: 110000, max: 160000 };
function salaryFor(slug: string, tier: string | null): { min: number; max: number } {
  const lv = getLevelsFyiSalary(slug || '');
  if (lv?.baseSalaryMin && lv?.baseSalaryMax) return { min: lv.baseSalaryMin, max: lv.baseSalaryMax };
  const est = tier ? ESTIMATED_NEW_GRAD_RANGES[tier] : null;
  return est ? { min: est.min, max: est.max } : DEFAULT_RANGE;
}
function fundingFor(slug: string): string | null {
  const cd = KNOWN_COMPANIES[(slug || '').toLowerCase()];
  return cd?.fundingStage ? fundingStageToFilter(cd.fundingStage) : null;
}

async function main() {
  // Pull the distinct (company_slug, tier) space — salary/funding depend only on
  // those two, so we update in grouped queries instead of 28k row writes.
  const pairs = new Map<string, { slug: string; tier: string | null }>();
  let offset = 0;
  for (;;) {
    const r = await rest(`jobs?select=company_slug,tier&is_active=eq.true`, {
      headers: { Range: `${offset}-${offset + 999}` },
    });
    const data = (await r.json()) as { company_slug: string; tier: string | null }[];
    if (!data.length) break;
    for (const row of data) {
      const k = `${row.company_slug}|${row.tier ?? ''}`;
      if (!pairs.has(k)) pairs.set(k, { slug: row.company_slug, tier: row.tier ?? null });
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`distinct company/tier groups: ${pairs.size}`);

  let salaryGroups = 0, fundingGroups = 0;
  for (const { slug, tier } of pairs.values()) {
    const salary = salaryFor(slug, tier);
    const funding = fundingFor(slug);
    const patch: Record<string, unknown> = {};
    if (salary) { patch.salary_min = salary.min; patch.salary_max = salary.max; }
    if (funding) patch.funding_stage = funding;
    if (!Object.keys(patch).length) continue;
    if (salary) salaryGroups++;
    if (funding) fundingGroups++;
    if (!dryRun) {
      const tierFilter = tier === null ? 'tier=is.null' : `tier=eq.${encodeURIComponent(tier)}`;
      const slugFilter = `company_slug=eq.${encodeURIComponent(slug)}`;
      try {
        await rest(`jobs?is_active=eq.true&${slugFilter}&${tierFilter}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
        });
      } catch (e) { console.warn(`update ${slug}/${tier}: ${(e as Error).message.slice(0, 80)}`); }
    }
  }
  console.log(`${dryRun ? '[dry-run] would set' : 'set'} salary on ${salaryGroups} groups, funding on ${fundingGroups} groups`);
}
main();
