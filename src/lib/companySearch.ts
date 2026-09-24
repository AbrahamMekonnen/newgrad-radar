import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Company-name search relevance + typo tolerance.
 *
 * PostgREST can only ORDER BY a column and only match with ilike (pure
 * substring), so "invidia" never finds "Nvidia" and results come back
 * alphabetical. These helpers (a) rank exact/prefix/word-start above substring,
 * and (b) fall back to fuzzy trigram matching so typos still find the company.
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

// --- Fuzzy (typo-tolerant) matching via character trigrams -------------------

function trigramSet(s: string): Set<string> {
  const t = `  ${(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}  `;
  const grams = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) grams.add(t.slice(i, i + 3));
  return grams;
}

/** Dice coefficient of trigram sets: 0 (nothing alike) … 1 (identical). */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigramSet(a);
  const B = trigramSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Rank rows by best of (substring relevance, fuzzy similarity), keeping only
 * rows that are a real match: a substring hit OR trigram similarity above
 * `threshold`. Substring hits always rank above pure-fuzzy hits.
 */
export function fuzzyRankCompanies<T extends RankableCompany>(
  rows: T[],
  q: string,
  { limit = 8, threshold = 0.34 }: { limit?: number; threshold?: number } = {},
): T[] {
  const query = (q || '').trim();
  if (!query) return rows.slice(0, limit);
  const scored = rows
    .map((r) => {
      const rel = relevanceScore(r.name, query); // 0..4 (4 = no substring hit)
      const sim = trigramSimilarity(query, r.name);
      return { r, rel, sim };
    })
    .filter((x) => x.rel <= 3 || x.sim >= threshold)
    .sort((a, b) => {
      if (a.rel !== b.rel) return a.rel - b.rel; // substring quality first
      if (b.sim !== a.sim) return b.sim - a.sim; // then fuzzy closeness
      if (a.r.name.length !== b.r.name.length) return a.r.name.length - b.r.name.length;
      return a.r.name.localeCompare(b.r.name);
    });
  return scored.slice(0, limit).map((x) => x.r);
}

// --- Full-company cache (loaded once, for the fuzzy fallback) ----------------

interface MinimalCompany { slug: string; name: string; logo_url?: string | null }
let _allCache: MinimalCompany[] | null = null;
let _allPromise: Promise<MinimalCompany[]> | null = null;

/** Load every company's slug/name/logo once (paginated past PostgREST's 1000 cap), cached for the session. */
export async function loadAllCompanies(supabase: SupabaseClient): Promise<MinimalCompany[]> {
  if (_allCache) return _allCache;
  if (_allPromise) return _allPromise;
  _allPromise = (async () => {
    const out: MinimalCompany[] = [];
    let from = 0;
    // Hard cap the loop so a huge table can't spin forever.
    for (let page = 0; page < 20; page++) {
      const { data } = await supabase
        .from('companies')
        .select('slug, name, logo_url')
        .order('name')
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      out.push(...(data as MinimalCompany[]));
      if (data.length < 1000) break;
      from += 1000;
    }
    _allCache = out;
    return out;
  })();
  try {
    return await _allPromise;
  } catch {
    _allPromise = null;
    return [];
  }
}

/**
 * Relevance-aware, typo-tolerant autocomplete for the companies table. First a
 * fast prefix + contains query (exact/substring hits). If that doesn't fill the
 * result set, fall back to fuzzy trigram matching over the full company list, so
 * typos like "invidia" still surface "Nvidia".
 */
export async function searchCompanies<T extends RankableCompany>(
  supabase: SupabaseClient,
  q: string,
  { select = 'slug, name, logo_url', limit = 8 }: { select?: string; limit?: number } = {},
): Promise<T[]> {
  const query = (q || '').trim();
  if (query.length < 2) return [];
  const safe = query.replace(/[%_]/g, (m) => `\\${m}`); // escape ilike wildcards

  const [prefix, contains] = await Promise.all([
    supabase.from('companies').select(select).ilike('name', `${safe}%`).order('name').limit(limit),
    supabase.from('companies').select(select).ilike('name', `%${safe}%`).order('name').limit(limit * 3),
  ]);

  const merged = new Map<string, T>();
  for (const row of [...(prefix.data || []), ...(contains.data || [])] as unknown as T[]) {
    if (!merged.has(row.slug)) merged.set(row.slug, row);
  }
  let results = rankCompanies([...merged.values()], query);

  // Not enough solid substring hits — bring in fuzzy (typo) matches.
  if (results.length < limit) {
    const all = await loadAllCompanies(supabase);
    const have = new Set(results.map((r) => r.slug));
    const fuzzy = fuzzyRankCompanies(
      all.filter((c) => !have.has(c.slug)),
      query,
      { limit: limit - results.length, threshold: 0.34 },
    ) as unknown as T[];
    results = [...results, ...fuzzy];
  }
  return results.slice(0, limit);
}
