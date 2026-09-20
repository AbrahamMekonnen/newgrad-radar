"""Populate jobs.sponsorship_status from the H1B sponsor data we already have.

Roots the Visa Sponsorship filter in real data: a company that appears in the
H1B sponsor list is marked 'sponsors'. Uses ONLY high-confidence known-sponsor
matches (the fuzzy partial-match path has false positives), so we never
mislabel; unknown companies stay 'unknown' (honest).

    python backfill_sponsorship.py           # apply
    python backfill_sponsorship.py --dry-run
"""
from __future__ import annotations

import os
import sys
import argparse
import importlib.util
from collections import defaultdict


def _load_env() -> None:
    for p in ('.env', '../.env.local'):
        if os.path.exists(p):
            for line in open(p, encoding='utf-8', errors='ignore'):
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, _, v = line.partition('=')
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _load_h1b():
    spec = importlib.util.spec_from_file_location('h1b_data', 'sources/h1b_data.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    _load_env()
    from supabase import create_client
    c = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])
    h1b = _load_h1b()

    # distinct company (slug -> name)
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
    print(f'distinct companies: {len(companies)}')

    sponsors = []
    for slug, name in companies.items():
        try:
            info = h1b.get_sponsorship_info(name)
        except Exception:
            continue
        # High-confidence only: the known-sponsor list. Skip fuzzy partial_match
        # (it false-positives on single letters).
        if info.get('is_sponsor') and info.get('confidence') == 'high':
            sponsors.append(slug)
    print(f'{"[dry-run] " if args.dry_run else ""}companies matched as H1B sponsors: {len(sponsors)}')

    if not args.dry_run:
        updated = 0
        for i in range(0, len(sponsors), 50):
            chunk = sponsors[i:i + 50]
            c.table('jobs').update({'sponsorship_status': 'sponsors'}) \
                .in_('company_slug', chunk).eq('is_active', True).execute()
            updated += len(chunk)
        print(f'marked sponsors for {updated} companies')


if __name__ == '__main__':
    main()
