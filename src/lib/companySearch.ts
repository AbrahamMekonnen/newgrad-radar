import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Company-name search relevance.
 *
 * PostgREST can only ORDER BY a column, so an `ilike('%q%')` search comes back
 * alphabetical — which buries the obvious match (typing "intel" surfaces
 * "National Geospatial-Intelligence Agency" before "Intel"). These helpers make
 * the exact / prefix / word-start matches win, the way a user expects.
 */

export interface RankableCompany {
  slug: string;
  name: string;
}

/** Lower score = more relevant. */
function relevanceScore(name: string, q: string): number {
  const n = (name || '').toLowerCase().trim();
  const query = q.toLowerCase().trim();
  if (!query) return 5;
  if (n === query) return 0; // exact
  if (n.startsWith(query)) return 1; // "intel" -> "Intel Corporation"
  // word-boundary start: "street" -> "Jane Street"
  if (new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n)) return 2;
  if (n.includes(query)) return 3; // substring anywhere
  return 4;
}

/**
 * Re-rank company rows by relevance to the query, then name length (shorter
 * first, so "Intel" beats "Intel Federal"), then alphabetically.
 */
export function rankCompanies<T extends RankableCompany>(rows: T[], q: string): T[] {
  const query = (q || '').trim();
  if (!query) return rows;
  return [...rows].sort((a, b) => {
    const sa = relevanceScore(a.name, query);
    const sb = relevanceScore(b.name, query);
    if (sa !== sb) return sa - sb;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Relevance-aware autocomplete fetch for the companies table. Runs a
 * prefix-priority query and a broader contains query, merges + de-dupes, then
 * ranks — so a capped result set (e.g. 8 suggestions) can never drop the exact
 * match in favor of an alphabetically-earlier substring hit.
 */
export async function searchCompanies<T extends RankableCompany>(
  supabase: SupabaseClient,
  q: string,
  { select = 'slug, name, logo_url', limit = 8 }: { select?: string; limit?: number } = {},
): Promise<T[]> {
  const query = (q || '').trim();
  if (query.length < 2) return [];
  // Escape PostgREST ilike wildcards in user input.
  const safe = query.replace(/[%_]/g, (m) => `\\${m}`);

  const [prefix, contains] = await Promise.all([
    supabase.from('companies').select(select).ilike('name', `${safe}%`).order('name').limit(limit),
    supabase.from('companies').select(select).ilike('name', `%${safe}%`).order('name').limit(limit * 3),
  ]);

  const merged = new Map<string, T>();
  const rows = [...(prefix.data || []), ...(contains.data || [])] as unknown as T[];
  for (const row of rows) {
    if (!merged.has(row.slug)) merged.set(row.slug, row);
  }
  return rankCompanies([...merged.values()], query).slice(0, limit);
}
