"""AI-enrich jobs from their ATS description.

Only jobs that are MISSING a classification go through the AI — jobs whose
title already yielded an experience level (and that have salary/sponsorship)
are left alone, so we don't pay tokens twice. For the rest we fetch the
company's board once (Greenhouse/Lever/Ashby all return descriptions in a
single request), match each job to its description, and extract just the
missing fields:
  - experience_level (intern..principal)   - only set if currently NULL
  - salary_min / salary_max                - only set if currently NULL
  - sponsorship_status                     - only set if currently NULL/unknown
  - is_job (false for conference/event/ad listings)

The description is used and discarded (never stored). enriched_at marks a job
processed so the incremental grind never re-pays for it.

Usage:
  python enrich_jobs.py --limit 30 --dry-run     # proof: print, don't write
  python enrich_jobs.py --limit 400              # one incremental batch
"""
from __future__ import annotations

import os
import re
import sys
import json
import time
import argparse
import logging
import datetime as dt
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from collections import defaultdict

import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("enrich_jobs")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "sources" / "interview_questions"))

UA = {"User-Agent": "newgrad-radar-jobenrich"}
_VALID_LEVELS = {"intern", "new_grad", "junior", "mid", "senior", "staff", "principal"}
_VALID_SPON = {"offers_sponsorship", "no_sponsorship", "unknown"}


def _load_env() -> None:
    for p in (HERE / ".env", HERE.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "").replace("&nbsp;", " ")).strip()


def _url_token(url: str, ats: str) -> str | None:
    """Board token parsed from a job url (fallback when companies.py differs)."""
    try:
        segs = [s for s in urlparse(url).path.split("/") if s]
    except Exception:
        return None
    if ats in ("lever", "ashby") and segs:
        return segs[0]
    return None


def _ats_job_id(url: str) -> str | None:
    q = parse_qs(urlparse(url).query)
    if "gh_jid" in q:
        return q["gh_jid"][0]
    segs = [s for s in urlparse(url).path.split("/") if s]
    return segs[-1] if segs else None


def _fetch_board(ats: str, token: str) -> dict:
    """Return {job_id(str): {desc, title, comp}} for a company's board."""
    out: dict = {}
    try:
        if ats == "lever":
            r = requests.get(f"https://api.lever.co/v0/postings/{token}?mode=json", headers=UA, timeout=30)
            if r.status_code == 200:
                for j in r.json():
                    out[str(j.get("id"))] = {"desc": j.get("descriptionPlain") or "",
                                             "title": j.get("text"), "comp": None}
        elif ats == "ashby":
            r = requests.get(f"https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true",
                             headers=UA, timeout=30)
            if r.status_code == 200:
                for j in r.json().get("jobs", []):
                    out[str(j.get("id"))] = {"desc": j.get("descriptionPlain") or "",
                                             "title": j.get("title"), "comp": j.get("compensation")}
        elif ats == "greenhouse":
            r = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true",
                             headers=UA, timeout=30)
            if r.status_code == 200:
                for j in r.json().get("jobs", []):
                    out[str(j.get("id"))] = {"desc": _strip_html(j.get("content") or ""),
                                             "title": j.get("title"), "comp": None}
    except Exception as e:
        logger.debug(f"board fetch failed {ats}/{token}: {e}")
    return out


def _match(job: dict, board: dict) -> dict | None:
    entry = board.get(str(_ats_job_id(job["url"])))
    if entry:
        return entry
    # fallback: exact title match
    return next((v for v in board.values() if v.get("title") == job["title"]), None)


def _ashby_salary(comp) -> tuple:
    """Pull (min, max) yearly USD from an Ashby compensation object, if present."""
    if not isinstance(comp, dict):
        return None, None
    try:
        for tier in comp.get("compensationTiers", []) or []:
            for comp_item in tier.get("components", []) or []:
                cv = comp_item.get("compensationValue") or {}
                if (comp_item.get("summaryComponents") or comp_item.get("compensationType")) and cv:
                    mn, mx = cv.get("minValue"), cv.get("maxValue")
                    if mn or mx:
                        return (int(mn) if mn else None, int(mx) if mx else None)
    except Exception:
        pass
    return None, None


def _extract_batch(items: list) -> tuple:
    """items: list of (idx, title, desc). Returns ({idx: fields}, ok).

    ok=False means the LLM CALL failed (quota/rate-limit/no response) — the
    caller must NOT mark those jobs enriched, so they retry later. Retries the
    call a few times with backoff to ride through transient rate limits.
    """
    import llm_enrich
    if not items:
        return {}, True
    numbered = "\n\n".join(
        f"[{i}] TITLE: {t}\nDESCRIPTION: {d[:2200]}" for i, t, d in items
    )
    prompt = (
        "For EACH numbered job posting, output its fields. Judge each independently.\n"
        "Fields: experience_level (one of intern,new_grad,junior,mid,senior,staff,"
        "principal — the seniority the role targets), salary_min (integer yearly "
        "USD base, else null), salary_max (integer, else null), sponsorship_status "
        "(offers_sponsorship if it sponsors visas/H-1B, no_sponsorship if it says "
        "no sponsorship/must be authorized, else unknown), is_real_job (false only "
        "if it's a conference/event/ad/newsletter/non-job listing, else true).\n"
        'Reply ONLY with JSON mapping the number (string) to an object, e.g. '
        '{"0":{"experience_level":"new_grad","salary_min":110000,"salary_max":'
        '130000,"sponsorship_status":"offers_sponsorship","is_real_job":true}}\n\n'
        + numbered + "\n\nJSON:"
    )
    for attempt in range(3):
        raw = llm_enrich._generate(prompt)
        if raw:
            data = llm_enrich._parse_json(raw)
            return (data if isinstance(data, dict) else {}), True
        time.sleep(2 * (attempt + 1))  # backoff on rate limit
    return {}, False  # call failed after retries


def enrich(client, limit: int, dry_run: bool, batch_size: int = 6) -> tuple:
    """Fill each un-enriched job's card from its ATS description, ON DEMAND.

    The scrape stays fast (no description fetch); this cron fetches each board
    once, reads the descriptions, lets the free-provider AI extract
    experience/salary/sponsorship/real-job, writes what's missing, and marks
    enriched_at. Descriptions are never stored — used and discarded. An LLM
    quota/rate-limit failure leaves the batch for the next run.
    """
    from companies import COMPANIES
    cols = "id,title,url,ats_type,company_slug,experience_level,salary_min,salary_max,sponsorship_status"
    rows = (client.table("jobs").select(cols)
            .eq("is_active", True).is_("enriched_at", "null")
            .in_("ats_type", ["greenhouse", "lever", "ashby"])
            .order("posted", desc=True).limit(limit).execute().data) or []
    logger.info(f"{len(rows)} un-enriched ATS jobs -> AI enrichment")

    def _now():
        return dt.datetime.now(dt.timezone.utc).isoformat()

    by_company = defaultdict(list)
    for j in rows:
        by_company[(j["company_slug"], j["ats_type"])].append(j)

    updated = 0
    non_jobs = 0
    for (slug, ats), jobs in by_company.items():
        token = (COMPANIES.get(slug) or {}).get("ats_token") or _url_token(jobs[0]["url"], ats)
        board = _fetch_board(ats, token) if token else None
        if not board:  # try a url-parsed token as a fallback
            alt = _url_token(jobs[0]["url"], ats)
            if alt and alt != token:
                board = _fetch_board(ats, alt)
        if not board:
            # Can't reach the board — still mark enriched so we don't retry forever.
            if not dry_run:
                for j in jobs:
                    _update_job(client, j["id"], {"enriched_at": _now()})
            continue

        matched = []
        for j in jobs:
            entry = _match(j, board)
            if entry and entry.get("desc"):
                matched.append((j, entry))

        for s in range(0, len(matched), batch_size):
            chunk = matched[s:s + batch_size]
            items = [(i, j["title"], e["desc"]) for i, (j, e) in enumerate(chunk)]
            result, ok = _extract_batch(items)
            if not ok:
                logger.warning("LLM call failed after retries - leaving batch for a later run")
                continue
            for i, (j, entry) in enumerate(chunk):
                fields = result.get(str(i)) or {}
                patch = {}
                lvl = (fields.get("experience_level") or "").lower()
                if not j.get("experience_level") and lvl in _VALID_LEVELS:
                    patch["experience_level"] = lvl
                if j.get("salary_min") is None:
                    smin, smax = _ashby_salary(entry.get("comp"))
                    if smin is None and smax is None:
                        smin = fields.get("salary_min") if isinstance(fields.get("salary_min"), (int, float)) else None
                        smax = fields.get("salary_max") if isinstance(fields.get("salary_max"), (int, float)) else None
                    if smin:
                        patch["salary_min"] = int(smin)
                    if smax:
                        patch["salary_max"] = int(smax)
                spon = (fields.get("sponsorship_status") or "").lower()
                if j.get("sponsorship_status") in (None, "unknown") and spon in _VALID_SPON and spon != "unknown":
                    patch["sponsorship_status"] = spon
                if fields.get("is_real_job") is False:
                    patch["is_job"] = False
                    non_jobs += 1
                patch["enriched_at"] = _now()
                if dry_run:
                    shown = {k: v for k, v in patch.items() if k != "enriched_at"}
                    logger.info(f"[dry] {j['title'][:45]} -> {shown or 'no new fields'}")
                    updated += 1
                else:
                    _update_job(client, j["id"], patch)
                    updated += 1
            time.sleep(1.5)  # pace to stay under free-provider rate limits

        # Mark matched-but-nothing and unmatched jobs enriched too, so the cron
        # doesn't reprocess them forever.
        if not dry_run:
            done_ids = {j["id"] for j, _ in matched}
            for j in jobs:
                if j["id"] not in done_ids:
                    _update_job(client, j["id"], {"enriched_at": _now()})
    return updated, non_jobs


def _update_job(client, job_id: str, patch: dict) -> None:
    try:
        client.table("jobs").update(patch).eq("id", job_id).execute()
    except Exception as e:
        msg = str(e)
        # tolerate missing columns before the migration runs
        for col in ("is_job", "enriched_at"):
            if col in msg and col in patch:
                patch = {k: v for k, v in patch.items() if k != col}
        try:
            if patch:
                client.table("jobs").update(patch).eq("id", job_id).execute()
        except Exception as e2:
            logger.debug(f"update failed {job_id}: {e2}")


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    import llm_enrich
    if not llm_enrich.llm_available():
        logger.error("No LLM available (set GEMINI_API_KEY or GROQ_API_KEY)")
        return
    updated, non_jobs = enrich(client, args.limit, args.dry_run)
    logger.info(f"DONE: processed {updated} jobs ({non_jobs} flagged non-jobs){' [dry-run]' if args.dry_run else ''}")


if __name__ == "__main__":
    main()
