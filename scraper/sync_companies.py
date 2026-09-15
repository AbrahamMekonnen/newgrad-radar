"""Sync the canonical companies.py list into the Supabase `companies` table.

The scraper writes jobs with denormalized company fields but never maintained
the `companies` table, so newly-added companies (e.g. the 1,100+ imported from
the public new-grad feed) were invisible to anything that reads that table —
the recruiter enricher and the Recruiters-tab autocomplete. This upserts every
COMPANIES entry so those features cover the full universe.

Only slug/name/tier/ats_type/ats_token are written, so existing curated rows
keep their logo_url/careers_url (PostgREST upsert leaves unlisted columns
untouched on update, and new rows just get NULL there).

Usage:  python sync_companies.py
"""
from __future__ import annotations

import os
from pathlib import Path


def _load_env() -> None:
    here = Path(__file__).resolve().parent
    for p in (here / ".env", here.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def sync_companies() -> int:
    from supabase import create_client
    from companies import COMPANIES

    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    rows = [{
        "slug": slug,
        "name": info.get("name") or slug,
        "tier": info.get("tier") or "other",
        "ats_type": info.get("ats_type"),
        "ats_token": info.get("ats_token"),
    } for slug, info in COMPANIES.items()]

    written = 0
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        client.table("companies").upsert(chunk, on_conflict="slug").execute()
        written += len(chunk)
        print(f"  upserted {written}/{len(rows)} companies")
    return written


if __name__ == "__main__":
    _load_env()
    n = sync_companies()
    print(f"DONE: synced {n} companies into the table")
