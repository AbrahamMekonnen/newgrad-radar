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
    # Source recruiters for MULTIPLE focuses so each job can be matched to the
    # right people: early-career recruiters for new-grad reqs, experienced/
    # technical recruiters for mid+ reqs. A recruiter that surfaces under more
    # than one focus is treated as 'generic' (fits any level).
    by_name: dict = {}
    for focus in ("new_grad", "experienced"):
        try:
            found = find_recruiters(name, domain=domain, role_focus=focus,
                                    max_results=8, verify_emails=bool(domain))
        except Exception as e:
            logger.debug(f"{slug}: {focus} search failed: {e}")
            found = []
        for r in found:
            key = r["name"].lower()
            if key in by_name:
                by_name[key]["role_focus"] = "generic"  # seen in 2+ focuses
                # keep the richer record (prefer one with an email)
                if not by_name[key].get("email") and r.get("email"):
                    by_name[key] = {**r, "role_focus": "generic"}
            else:
                by_name[key] = {**r, "role_focus": focus}
    recs = list(by_name.values())
    if not recs:
        # Nothing new found — do NOT delete what's already there.
        return 0
    rows = []
    for r in recs:
        link = r.get("linkedin_url") or ""
        rows.append({
            "company_slug": slug,
            "job_id": None,
            "name": r["name"],
            "title": r.get("title"),
            "role_focus": r.get("role_focus", "generic"),
            "email": r.get("email"),
            "email_variants": r.get("email_variants") or ([{"email": r["email"],
                "confidence": 0.95 if r.get("email_verified") else 0.5,
                "verified": bool(r.get("email_verified"))}] if r.get("email") else None),
            "email_verified": bool(r.get("email_verified")),
            "linkedin_url": link,
            "linkedin_verified": bool(link),
            "source": "osint",
            "verification_status": "valid" if r.get("email_verified") else "pending",
        })

    # Capture the OLD company-level rows BEFORE inserting, so we only remove them
    # after the new insert succeeds — never delete-then-fail (that loses data).
    try:
        old_ids = [x["id"] for x in (client.table("recruiters").select("id")
                   .eq("company_slug", slug).is_("job_id", "null").execute().data or [])]
    except Exception:
        old_ids = []

    if not _insert_recruiters(client, rows, slug):
        return 0  # old rows left intact

    # Insert succeeded — now safe to drop the stale rows we replaced.
    if old_ids:
        try:
            client.table("recruiters").delete().in_("id", old_ids).execute()
        except Exception as e:
            logger.debug(f"cleanup of old rows failed for {slug}: {e}")
    return len(rows)


def _insert_recruiters(client, rows: list, slug: str) -> bool:
    """Insert rows, retrying without any column the DB doesn't have yet
    (email_variants / role_focus) so recruiter data still lands before the
    migration runs. Drops missing columns one at a time until the insert works."""
    optional = ["email_variants", "role_focus"]
    dropped: list = []
    while True:
        payload = [{k: v for k, v in row.items() if k not in dropped} for row in rows]
        try:
            client.table("recruiters").insert(payload).execute()
            if dropped:
                logger.warning(f"{slug}: inserted without missing column(s) "
                               f"{dropped} — run the recruiters migration to enable them")
            return True
        except Exception as e:
            msg = str(e)
            nxt = next((c for c in optional if c in msg and c not in dropped), None)
            if nxt:
                dropped.append(nxt)
                continue
            logger.warning(f"insert failed for {slug}: {e}")
            return False


def _all_rows(client, table: str, cols: str) -> list:
    """Fetch every row from a table (PostgREST caps responses at 1000)."""
    out, start = [], 0
    while True:
        rows = client.table(table).select(cols).range(start, start + 999).execute().data or []
        out.extend(rows)
        if len(rows) < 1000:
            break
        start += 1000
    return out


def _slugs_with_recruiters(client) -> set:
    """Company slugs that already have a company-level recruiter row."""
    out, start = set(), 0
    while True:
        rows = (client.table("recruiters").select("company_slug")
                .is_("job_id", "null").range(start, start + 999).execute().data) or []
        out.update(r["company_slug"] for r in rows if r.get("company_slug"))
        if len(rows) < 1000:
            break
        start += 1000
    return out


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", help="single company slug")
    ap.add_argument("--limit", type=int, default=25, help="max companies (by active jobs)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-research even companies that already have fresh recruiters")
    ap.add_argument("--from-requests", action="store_true",
                    help="process the recruiter_requests queue (user-requested companies)")
    args = ap.parse_args()

    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    from search_providers import available_providers
    logger.info(f"search providers: {available_providers()}")

    if args.from_requests:
        _process_requests(client, args.limit)
        return

    if args.company:
        comp = client.table("companies").select("slug,name,logo_url").eq("slug", args.company).execute().data
        companies = comp
    else:
        # Target companies that DON'T yet have recruiters, so each capped daily
        # run makes real progress through the full universe instead of re-picking
        # the same first N every time. (--refresh re-does everyone regardless.)
        all_co = _all_rows(client, "companies", "slug,name,logo_url")
        if args.refresh:
            companies = all_co[: args.limit]
        else:
            have = _slugs_with_recruiters(client)
            unfilled = [c for c in all_co if c["slug"] not in have]
            companies = unfilled[: args.limit]
            logger.info(f"{len(have)} companies already have recruiters; "
                        f"{len(unfilled)} unfilled, processing {len(companies)} this run")

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


def _process_requests(client, limit: int) -> None:
    """Fill user-requested companies from the recruiter_requests queue, most-
    requested first, then mark each done/failed."""
    try:
        reqs = (client.table("recruiter_requests").select("*")
                .eq("status", "pending").order("request_count", desc=True)
                .limit(limit).execute().data) or []
    except Exception as e:
        logger.warning(f"could not read recruiter_requests (run migration 036?): {e}")
        return
    logger.info(f"processing {len(reqs)} pending recruiter request(s)")
    import datetime as _dt
    done = 0
    for req in reqs:
        slug = req.get("company_slug")
        name = req.get("company_name") or slug
        # Prefer the real company row (for the logo-derived domain); fall back to
        # a minimal dict built from the request itself.
        company = None
        if slug:
            rows = client.table("companies").select("slug,name,logo_url").eq("slug", slug).execute().data
            company = rows[0] if rows else None
        if company is None:
            company = {"slug": slug or re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-"),
                       "name": name, "logo_url": None}
        status = "done"
        try:
            n = enrich_company(client, company, refresh=True)
            logger.info(f"request {company['slug']}: +{n} recruiters")
            if n == 0:
                status = "failed"
            else:
                done += 1
        except Exception as e:
            logger.warning(f"request {company.get('slug')} failed: {e}")
            status = "failed"
        try:
            client.table("recruiter_requests").update(
                {"status": status, "processed_at": _dt.datetime.now(_dt.timezone.utc).isoformat()}
            ).eq("id", req["id"]).execute()
        except Exception as e:
            logger.debug(f"could not mark request {req.get('id')}: {e}")
        time.sleep(0.5)
    logger.info(f"DONE: filled {done}/{len(reqs)} requested companies")


if __name__ == "__main__":
    main()
