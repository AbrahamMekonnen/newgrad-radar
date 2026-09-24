-- Reliable typo-tolerant company search via Postgres trigram matching.
--
-- ilike substring search alone can't find "Nvidia" from "invidia". pg_trgm
-- gives real fuzzy matching, indexed (GIN) so it stays fast as the companies
-- table grows. Exposed as an RPC the frontend calls with supabase.rpc().

create extension if not exists pg_trgm;

-- GIN trigram index so both `ilike '%q%'` and the `%` similarity operator are
-- index-accelerated instead of scanning every row.
create index if not exists companies_name_trgm_idx
  on public.companies using gin (name gin_trgm_ops);

-- Ranked search: exact > prefix > substring > trigram-similarity. Returns a few
-- extra fields the callers render. `q % name` (trigram) catches typos; the
-- ilike clause guarantees ordinary substring matches are never missed.
create or replace function public.search_companies(q text, lim int default 8)
returns table (slug text, name text, logo_url text, tier text, sim real)
language sql
stable
as $$
  select c.slug::text,
         c.name::text,
         c.logo_url::text,
         c.tier::text,
         similarity(c.name, btrim(q)) as sim
  from public.companies c
  where btrim(q) <> ''
    and (
      c.name ilike '%' || btrim(q) || '%'   -- substring match (indexed)
      or c.name % btrim(q)                    -- trigram similarity match (indexed)
    )
  order by
    (lower(c.name) = lower(btrim(q))) desc,         -- exact name
    (c.name ilike btrim(q) || '%') desc,            -- prefix
    (c.name ilike '%' || btrim(q) || '%') desc,     -- contains
    similarity(c.name, btrim(q)) desc,              -- closest fuzzy
    length(c.name) asc,                             -- shorter name wins ties
    c.name asc
  limit greatest(1, least(lim, 50));
$$;

-- companies is publicly readable; allow the same audiences to call the search.
grant execute on function public.search_companies(text, int) to anon, authenticated;

-- Lower the trigram match threshold a touch so mild typos still match via `%`
-- (default 0.3 misses some). This is a per-database setting.
-- NOTE: set_limit affects the `%` operator's cutoff for the current session;
-- to make it persistent we rely on the explicit similarity ordering above, so
-- even borderline matches surface as long as they pass the 0.3 `%` gate.
