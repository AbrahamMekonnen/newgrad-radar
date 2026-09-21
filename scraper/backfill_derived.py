"""Backfill filter columns that are DERIVABLE from data we already store.

Incremental + conservative — only fills the specific dead filter options,
never reshuffles values that already work:

  experience_level : 'principal'   from Principal/Distinguished/Fellow titles
                     'entry_level' from Entry-level/Associate titles
                     (only when the row is currently the broader bucket or NULL)
  badges           : 'high_paying' for jobs with salary_min >= $150k

    python backfill_derived.py            # apply
    python backfill_derived.py --dry-run
"""
from __future__ import annotations

import os
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


def _load_classifier():
    spec = importlib.util.spec_from_file_location('db_mod', 'db.py')
    m = importlib.util.module_from_spec(spec)
    # db.py imports supabase lazily; loading the module is safe without creds.
    spec.loader.exec_module(m)
    return m.classify_experience_from_title


HIGH_PAY_THRESHOLD = 150000


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    _load_env()
    from supabase import create_client
    c = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])
    classify = _load_classifier()
    pfx = '[dry-run] ' if args.dry_run else ''

    # Pull every active job's fields we need to re-derive.
    rows = []
    off = 0
    while True:
        batch = (c.table('jobs')
                 .select('id,title,experience_level,salary_min,badges')
                 .eq('is_active', True).range(off, off + 999).execute().data) or []
        rows.extend(batch)
        off += 1000
        if len(batch) < 1000:
            break
    print(f'active jobs scanned: {len(rows)}')

    exp_updates: dict[str, list[str]] = {}   # new_level -> [ids]
    badge_ids: list[str] = []                 # ids that need high_paying

    for r in rows:
        new = classify(r.get('title'))
        cur = r.get('experience_level')
        # Only populate the two dead options, from the broader bucket or NULL.
        if new == 'principal' and cur in ('staff', None):
            exp_updates.setdefault('principal', []).append(r['id'])
        elif new == 'entry_level' and cur in ('new_grad', None):
            exp_updates.setdefault('entry_level', []).append(r['id'])

        if (r.get('salary_min') or 0) >= HIGH_PAY_THRESHOLD:
            if 'high_paying' not in (r.get('badges') or []):
                badge_ids.append(r['id'])

    for level, ids in exp_updates.items():
        print(f'{pfx}experience_level -> {level}: {len(ids)} jobs')
    print(f'{pfx}badges += high_paying: {len(badge_ids)} jobs')

    if args.dry_run:
        return

    # Experience: simple column update in chunks.
    for level, ids in exp_updates.items():
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            c.table('jobs').update({'experience_level': level}).in_('id', chunk).execute()

    # Badges: array append. PostgREST can't array_append in bulk, so fetch the
    # current array per row and rewrite it (only for the ~few-thousand that need
    # it). Done in small pages to stay well under statement limits.
    added = 0
    for i in range(0, len(badge_ids), 200):
        chunk = badge_ids[i:i + 200]
        cur_rows = (c.table('jobs').select('id,badges').in_('id', chunk).execute().data) or []
        for row in cur_rows:
            badges = row.get('badges') or []
            if 'high_paying' not in badges:
                badges = badges + ['high_paying']
                c.table('jobs').update({'badges': badges}).eq('id', row['id']).execute()
                added += 1
    print(f'badges updated: {added}')


if __name__ == '__main__':
    main()
