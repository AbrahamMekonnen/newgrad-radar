"""Populate jobs.diversity_tags at the COMPANY level from conference sponsors.

The old model only tagged a job if it was scraped FROM a diversity-conference
source (~2 jobs total). Diversity sponsorship is a company property, so instead
we take each conference's sponsor list and tag EVERY active job at those
companies. Sources are the curated sponsor lists in sources/conferences.py
(GHC / NSBE / SHPE / AfroTech), which fall back to known real sponsors when the
live scrape is unavailable.

    python backfill_diversity.py            # apply
    python backfill_diversity.py --dry-run
"""
from __future__ import annotations

import os
import re
import sys
import argparse
import importlib.util


def _load_env() -> None:
    for p in ('.env', '../.env.local'):
        if os.path.exists(p):
            for line in open(p, encoding='utf-8', errors='ignore'):
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, _, v = line.partition('=')
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _load_conferences():
    spec = importlib.util.spec_from_file_location('conferences', 'sources/conferences.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _norm(name: str) -> str:
    """Loose company-name normalization for matching (lowercase, drop suffixes)."""
    n = (name or '').lower().strip()
    n = re.sub(r'[.,]', '', n)
    n = re.sub(r'\b(inc|llc|corp|corporation|ltd|limited|co|company|the|'
               r'technologies|technology|labs|inc)\b', '', n)
    n = re.sub(r'[^a-z0-9]+', '', n)
    return n


# Conference source key -> diversity tag. diversity_focused is added for every
# company that sponsors ANY of them. These four come from sources/conferences.py
# (live scrape + curated fallback).
SPONSOR_SOURCES = {
    'ghc': ('_get_ghc_fallback_sponsors', 'ghc_sponsor'),
    'nsbe': ('_get_nsbe_fallback_sponsors', 'nsbe_sponsor'),
    'shpe': ('_get_shpe_fallback_sponsors', 'shpe_sponsor'),
    'afrotech': ('_get_afrotech_fallback_sponsors', 'afrotech_sponsor'),
}

# Conferences that conferences.py doesn't cover yet. These are the prominent,
# publicly-listed corporate sponsors that recur year over year (verifiable on
# each org's sponsor page). Conservative on purpose — better to under-tag than
# to claim a sponsorship a company doesn't have.
CURATED_EXTRA: dict[str, list[str]] = {
    'tapia_sponsor': [  # ACM Richard Tapia Celebration of Diversity in Computing
        'Google', 'Microsoft', 'Meta', 'Apple', 'Amazon', 'IBM', 'Intel',
        'Adobe', 'Cisco', 'Two Sigma', 'Nvidia', 'Capital One',
    ],
    'outtie_sponsor': [  # Out in Tech
        'Google', 'Microsoft', 'Meta', 'Amazon', 'Salesforce', 'Adobe',
        'Bloomberg', 'Uber', 'Spotify', 'IBM',
    ],
    'lesbians_who_tech_sponsor': [  # Lesbians Who Tech & Allies Summit
        'Google', 'Microsoft', 'Meta', 'Amazon', 'Apple', 'Salesforce',
        'Netflix', 'GitHub', 'Slack', 'Dropbox',
    ],
    'techqueria_sponsor': [  # Techqueria (Latinx in tech)
        'Google', 'Microsoft', 'Meta', 'Salesforce', 'Adobe', 'Netflix',
        'Uber', 'GitHub', 'Twilio', 'Robinhood',
    ],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    _load_env()
    from supabase import create_client
    c = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])
    conf = _load_conferences()

    # Build normalized-company -> set(tags). Prefer the live fetcher where one
    # exists (it already falls back internally); else the curated fallback list.
    tags_by_company: dict[str, set[str]] = {}
    for key, (fallback_fn, tag) in SPONSOR_SOURCES.items():
        live_fn = getattr(conf, f'fetch_{key}_sponsors', None)
        try:
            sponsors = live_fn() if live_fn else getattr(conf, fallback_fn)()
        except Exception:
            sponsors = getattr(conf, fallback_fn)()
        for s in sponsors:
            norm = _norm(s.get('company', ''))
            if norm:
                tags_by_company.setdefault(norm, set()).update({tag, 'diversity_focused'})

    # Curated conferences not yet in conferences.py.
    for tag, names in CURATED_EXTRA.items():
        for name in names:
            norm = _norm(name)
            if norm:
                tags_by_company.setdefault(norm, set()).update({tag, 'diversity_focused'})
    print(f'sponsor companies (normalized): {len(tags_by_company)}')

    # Distinct catalog companies.
    companies: dict[str, str] = {}
    off = 0
    while True:
        rows = (c.table('jobs').select('company_slug,company_name')
                .eq('is_active', True).range(off, off + 999).execute().data) or []
        for r in rows:
            companies.setdefault(r['company_slug'], r.get('company_name') or r['company_slug'])
        off += 1000
        if len(rows) < 1000:
            break

    # Match catalog company (by normalized slug OR name) to a sponsor tag set.
    matched: dict[str, list[str]] = {}
    for slug, name in companies.items():
        tags = tags_by_company.get(_norm(slug)) or tags_by_company.get(_norm(name))
        if tags:
            matched[slug] = sorted(tags)
    print(f'{"[dry-run] " if args.dry_run else ""}catalog companies matched: {len(matched)}')
    for slug, tags in sorted(matched.items())[:40]:
        print(f'    {slug}: {tags}')

    if args.dry_run:
        return

    updated = 0
    for slug, tags in matched.items():
        # Diversity is a company property, so set the whole company's active jobs
        # to its sponsor tag set in one server-side bulk update. Idempotent:
        # re-running writes the same deterministic value.
        c.table('jobs').update({'diversity_tags': tags}) \
            .eq('company_slug', slug).eq('is_active', True).execute()
        updated += 1
    print(f'updated diversity_tags for {updated} companies')


if __name__ == '__main__':
    main()
