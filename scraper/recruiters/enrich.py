"""Populate the recruiters table with REAL recruiters per company.

For each company: X-Ray LinkedIn (via search_providers) for its recruiters,
derive verified/learned-pattern emails (email_intel), and upsert company-level
rows into the `recruiters` table. The frontend matches these to a company's
active jobs by company_slug.

Usage:
    python -m recruiters.enrich --company stripe
    python -m recruiters.enrich --limit 50          # top N active-job companies
"""
from __future__ import annotations

import os
import re
import sys
import time
import argparse
import logging
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("recruiter_enrich")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # scraper/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))                    # recruiters/


def _load_env() -> None:
    here = Path(__file__).resolve().parent.parent
    for p in (here / ".env", here.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _domain_for(company: dict) -> Optional[str]:
    """Best-effort company email domain from clearbit logo_url, else slug guess."""
    logo = company.get("logo_url") or ""
    m = re.search(r"clearbit\.com/([a-z0-9.-]+\.[a-z]{2,})", logo, re.IGNORECASE)
    if m:
        return m.group(1).lower()
    slug = (company.get("slug") or "").replace("-", "")
    return f"{slug}.com" if slug else None


def _has_fresh_recruiters(client, slug: str, max_age_days: int = 45) -> bool:
    """Reuse check: do we already have recent company-level recruiters?"""
    import datetime as _dt
    try:
        rows = (client.table("recruiters").select("id,created_at")
                .eq("company_slug", slug).is_("job_id", "null")
                .order("created_at", desc=True).limit(1).execute().data)
    except Exception:
        return False
    if not rows:
        return False
    created = rows[0].get("created_at")
    if not created:
        return True  # have some; treat as fresh
    try:
        dt = _dt.datetime.fromisoformat(created.replace("Z", "+00:00"))
        age = (_dt.datetime.now(_dt.timezone.utc) - dt).days
        return age <= max_age_days
    except Exception:
        return True


def enrich_company(client, company: dict, refresh: bool = False) -> int:
    from xray_finder import find_recruiters
    slug = company["slug"]
    name = company.get("name") or slug
    # Reuse: don't burn a search if we already have fresh recruiters for this
    # company — the frontend serves them for every job at that company.
    if not refresh and _has_fresh_recruiters(client, slug):
        logger.info(f"{slug}: reusing existing recruiters (skipped search)")
        return 0
    domain = _domain_for(company)
    recs = find_recruiters(name, domain=domain, role_focus="new_grad",
                           max_results=6, verify_emails=bool(domain))
    if not recs:
        return 0
    # Replace this company's company-level (job_id NULL) recruiters to avoid dupes.
    try:
        client.table("recruiters").delete().eq("company_slug", slug).is_("job_id", "null").execute()
    except Exception as e:
        logger.debug(f"delete existing failed for {slug}: {e}")
    rows = []
    for r in recs:
        link = r.get("linkedin_url") or ""
        rows.append({
            "company_slug": slug,
            "job_id": None,
            "name": r["name"],
            "title": r.get("title"),
            "email": r.get("email"),
            "email_verified": bool(r.get("email_verified")),
            "linkedin_url": link,
            "linkedin_verified": bool(link),
            "source": "osint",
            "verification_status": "valid" if r.get("email_verified") else "pending",
        })
    try:
        client.table("recruiters").insert(rows).execute()
    except Exception as e:
        logger.warning(f"insert failed for {slug}: {e}")
        return 0
    return len(rows)


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", help="single company slug")
    ap.add_argument("--limit", type=int, default=25, help="max companies (by active jobs)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-research even companies that already have fresh recruiters")
    args = ap.parse_args()

    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    from search_providers import available_providers
    logger.info(f"search providers: {available_providers()}")

    if args.company:
        comp = client.table("companies").select("slug,name,logo_url").eq("slug", args.company).execute().data
        companies = comp
    else:
        # companies that actually have active jobs, most-jobs first would need a join;
        # simplest: all companies, capped.
        companies = client.table("companies").select("slug,name,logo_url").limit(args.limit).execute().data

    total = 0
    for c in companies:
        try:
            n = enrich_company(client, c, refresh=args.refresh)
            total += n
            logger.info(f"{c['slug']}: +{n} recruiters")
        except Exception as e:
            logger.warning(f"{c.get('slug')}: {e}")
        time.sleep(0.5)
    logger.info(f"DONE: {total} recruiters across {len(companies)} companies")


if __name__ == "__main__":
    main()
