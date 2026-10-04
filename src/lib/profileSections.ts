import type { UserProfile } from '@/lib/types';

// The structured history (work_experience / education_history / projects /
// skills_list) is stored INSIDE the existing custom_answers jsonb under __sec:*
// keys, so it needs no new DB columns / migration. These helpers move the data
// between that storage form and the top-level UserProfile fields the UI uses:
//   - hydrate: after loading a row, parse __sec:* back into the top-level fields.
//   - dehydrate: before saving, serialize the top-level fields into __sec:* and
//     drop the top-level keys (there are no such columns, so sending them 400s).
// Keys are "__"-prefixed so the drafter's story-bank builder skips them.

const SECTION_FIELDS = ['work_experience', 'education_history', 'projects', 'skills_list'] as const;
const keyFor = (f: string) => `__sec:${f}`;

export function hydrateProfileSections<T extends Partial<UserProfile>>(row: T): T {
  const ca = (row.custom_answers || {}) as Record<string, string>;
  for (const f of SECTION_FIELDS) {
    const rec = row as Record<string, unknown>;
    if (rec[f] == null && ca[keyFor(f)]) {
      try { rec[f] = JSON.parse(ca[keyFor(f)]); } catch { /* leave unset on bad JSON */ }
    }
  }
  return row;
}

export function dehydrateProfileSections(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  const ca: Record<string, string> = { ...((out.custom_answers as Record<string, string>) || {}) };
  for (const f of SECTION_FIELDS) {
    if (f in out) {
      const v = out[f];
      if (v == null || (Array.isArray(v) && v.length === 0)) {
        delete ca[keyFor(f)];
      } else {
        try { ca[keyFor(f)] = JSON.stringify(v); } catch { /* skip unserializable */ }
      }
      delete out[f]; // never send as a top-level column — it doesn't exist in the DB
    }
  }
  out.custom_answers = ca;
  return out;
}
