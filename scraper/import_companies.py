"""Expand our company universe from public new-grad job feeds.

Source: SimplifyJobs/New-Grad-Positions listings.json — a daily-maintained feed
of new-grad roles with real application URLs. We extract Greenhouse / Lever /
Ashby board tokens from those URLs, VALIDATE each token against the ATS API
(keep only live boards that return jobs), and write the new ones to
companies_imported.py, which companies.py merges into COMPANIES.

This is how we grow beyond the hand-curated list without hardcoding: run it
periodically and any new company appearing in the public feed gets picked up.

Usage:
    python import_companies.py            # validate + write companies_imported.py
    python import_companies.py --max 300  # cap how many NEW tokens to validate
"""
from __future__ import annotations

import re
import sys
import json
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs
from pathlib import Path

import requests

# Public, daily-maintained job feeds that share the SimplifyJobs listings.json
# schema (each record has a `url` application link + `company_name`). We harvest
# Greenhouse/Lever/Ashby board tokens from ALL of them and validate each once, so
# our company universe covers everything these communities track — new-grad AND
# internships, which is where most banks, quant shops and fintechs show up.
# Adding a feed here widens the universe with zero other changes; a dead/moved
# feed is skipped without failing the run.
FEED_URLS = [
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2025-Internships/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/main/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/vanshb03/New-Grad-2025/main/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/Ouckah/Summer2025-Internships/main/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/speedyapply/2025-SWE-College-Jobs/main/.github/scripts/listings.json",
]
HERE = Path(__file__).resolve().parent
OUT = HERE / "companies_imported.py"
UA = {"User-Agent": "newgrad-radar-importer"}


def _load_feeds() -> list:
    """Fetch every feed and concatenate their records. Feeds that 404, moved, or
    return a non-list payload are skipped so one broken source never sinks the run."""
    records: list = []
    for url in FEED_URLS:
        try:
            r = requests.get(url, headers=UA, timeout=60)
            if r.status_code != 200:
                print(f"  skip {url} (HTTP {r.status_code})")
                continue
            data = r.json()
            # Some feeds wrap the list; accept a bare list or {"listings":[...]} etc.
            if isinstance(data, dict):
                data = (data.get("listings") or data.get("data")
                        or next((v for v in data.values() if isinstance(v, list)), []))
            if not isinstance(data, list):
                print(f"  skip {url} (unexpected shape)")
                continue
            print(f"  {len(data):>5} records  <-  {url.split('/')[4]}/{url.split('/')[5]}")
            records.extend(data)
        except Exception as e:
            print(f"  skip {url} ({e})")
    return records


def _extract(url: str):
    """(ats_type, token) from an application URL, or None."""
    try:
        p = urlparse(url)
    except Exception:
        return None
    host = p.netloc.lower()
    seg = [s for s in p.path.split("/") if s]
    if "greenhouse.io" in host:
        if "embed" in seg:
            tok = (parse_qs(p.query).get("for") or [None])[0]
            return ("greenhouse", tok) if tok else None
        return ("greenhouse", seg[0]) if seg else None
    if "lever.co" in host:
        return ("lever", seg[0]) if seg else None
    if "ashbyhq.com" in host:
        return ("ashby", seg[0]) if seg else None
    return None


def _validate(ats: str, token: str) -> int:
    """Return number of live postings for a board (0 = dead/invalid)."""
    try:
        if ats == "greenhouse":
            r = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
                             headers=UA, timeout=15)
            if r.status_code == 200:
                return len((r.json() or {}).get("jobs", []))
        elif ats == "lever":
            r = requests.get(f"https://api.lever.co/v0/postings/{token}?mode=json",
                             headers=UA, timeout=15)
            if r.status_code == 200:
                j = r.json()
                return len(j) if isinstance(j, list) else 0
        elif ats == "ashby":
            r = requests.get(f"https://api.ashbyhq.com/posting-api/job-board/{token}",
                             headers=UA, timeout=15)
            if r.status_code == 200:
                return len((r.json() or {}).get("jobs", []))
    except Exception:
        return 0
    return 0


def _slugify(name: str, token: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or token).lower()).strip("-")
    return base or re.sub(r"[^a-z0-9]+", "-", token.lower()).strip("-")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=0, help="cap NEW tokens to validate (0 = all)")
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    print(f"fetching {len(FEED_URLS)} public feeds…")
    feed = _load_feeds()
    print(f"total records across feeds: {len(feed)}")

    # distinct (ats, token) -> company name (first seen). Feeds vary in which key
    # holds the employer name, so check the common ones.
    def _name(rec: dict) -> str:
        for k in ("company_name", "company", "organization", "employer", "name"):
            v = rec.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""

    found: dict = {}
    for r in feed:
        if not isinstance(r, dict):
            continue
        # A record may carry the link under different keys across feeds.
        link = (r.get("url") or r.get("apply_link") or r.get("application_link")
                or r.get("link") or "")
        e = _extract(link)
        if not e or not e[1]:
            continue
        key = (e[0], e[1].lower())
        found.setdefault(key, {"ats_type": e[0], "ats_token": e[1],
                               "name": _name(r) or e[1]})
    print(f"distinct GH/Lever/Ashby companies across feeds: {len(found)}")

    # drop ones we already have (by ats token)
    from companies import COMPANIES
    have_tok = {(v.get("ats_type"), (v.get("ats_token") or "").lower())
                for v in COMPANIES.values()}
    have_slugs = set(COMPANIES.keys())
    new = [v for k, v in found.items() if k not in have_tok]
    print(f"NEW candidates (not already in companies.py): {len(new)}")
    if args.max:
        new = new[: args.max]
        print(f"capped to {len(new)}")

    # validate live boards concurrently
    print(f"validating {len(new)} boards against ATS APIs ({args.workers} workers)…")
    live = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(_validate, v["ats_type"], v["ats_token"]): v for v in new}
        done = 0
        for fut in as_completed(futs):
            v = futs[fut]
            n = fut.result()
            done += 1
            if done % 100 == 0:
                print(f"  …{done}/{len(new)} checked, {len(live)} live so far")
            if n > 0:
                v["jobs"] = n
                live.append(v)
    print(f"live boards: {len(live)}")

    # assign unique slugs, build entries
    used = set(have_slugs)
    entries = {}
    for v in sorted(live, key=lambda x: -x["jobs"]):
        slug = _slugify(v["name"], v["ats_token"])
        base, i = slug, 2
        while slug in used:
            slug = f"{base}-{i}"
            i += 1
        used.add(slug)
        entries[slug] = {"name": v["name"], "tier": "other",
                         "ats_type": v["ats_type"], "ats_token": v["ats_token"]}

    # MERGE with the already-imported set so this file only ever GROWS. A run
    # that validates few new boards (or hits rate limits) must never clobber the
    # thousands already imported — otherwise the next scrape shrinks to the
    # hand-curated list. Existing entries win; new live boards are added.
    existing = {}
    try:
        import companies_imported as _ci
        existing = dict(getattr(_ci, "IMPORTED_COMPANIES", {}) or {})
    except Exception:
        existing = {}
    merged = {**existing, **entries}

    header = (
        '"""AUTO-GENERATED by import_companies.py — do not edit by hand.\n'
        "Live Greenhouse/Lever/Ashby boards harvested & validated from the public\n"
        "SimplifyJobs/New-Grad-Positions feed. Merged into COMPANIES by companies.py.\n"
        f"Count: {len(merged)} companies.\n"
        '"""\n\n'
        "IMPORTED_COMPANIES = "
    )
    OUT.write_text(header + json.dumps(merged, indent=4, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    print(f"wrote {len(merged)} companies ({len(entries)} new this run) -> {OUT}")


if __name__ == "__main__":
    main()
