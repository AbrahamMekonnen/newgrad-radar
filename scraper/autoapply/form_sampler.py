"""Auto-apply form-analysis harness.

Samples REAL application forms across ATSes and reports how they're structured,
so we can build deterministic per-ATS adapters and know exactly where AI is
actually needed. For each ATS it pulls the form for N jobs, normalizes every
field to {label, type, required, category}, and aggregates:
  - which fields are UNIVERSAL (fill deterministically from the profile)
  - which are FREE-TEXT / custom (need AI)
  - which are demographic/EEO (deterministic "decline")
  - file uploads, login walls, and per-ATS variation

How each ATS's form is obtained (grounded by probing, no scraping guesswork):
  greenhouse: boards-api …/jobs/{id}?questions=true  -> structured JSON (clean)
  lever:      jobs.lever.co/{token}/{id}/apply        -> parse name="..." fields
  ashby:      jobs.ashbyhq.com/api/non-user-graphql   -> applicationForm (best effort)

Usage:
    python -m autoapply.form_sampler --ats greenhouse --limit 50
    python -m autoapply.form_sampler --ats all --limit 40 --out form_report.json
"""
from __future__ import annotations

import os
import re
import sys
import json
import time
import random
import argparse
import logging
from collections import Counter, defaultdict
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("form_sampler")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # scraper/
UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-form-study)"}

# ---- Field categorization ---------------------------------------------------
# Maps a field's human label to a category, and whether it's deterministic
# (fillable from the profile, no AI) or needs AI (open-ended free text).
_RULES = [
    ("identity_name", r"\b(first name|last name|full name|legal name|preferred name|name)\b", True),
    ("email",         r"\b(email)\b", True),
    ("phone",         r"\b(phone|mobile|telephone)\b", True),
    ("resume",        r"\b(resume|cv|curriculum)\b", True),
    ("cover_letter",  r"\b(cover letter)\b", False),   # optional AI
    ("links",         r"\b(linkedin|github|portfolio|website|url|personal site)\b", True),
    ("location",      r"\b(location|city|address|zip|postal|country|state)\b", True),
    ("work_auth",     r"\b(authoriz|work authorization|legally|eligible to work|require sponsor|visa|sponsorship|work permit)\b", True),
    ("demographic",   r"\b(gender|race|ethnic|hispanic|latino|veteran|disab|lgbt|pronoun|sexual orientation)\b", True),
    ("salary",        r"\b(salary|compensation|pay|desired|expected)\b", True),
    ("start_date",    r"\b(start date|available|availability|notice period|when can you)\b", True),
    ("source",        r"\b(how did you hear|referr|source|where did you)\b", True),
    ("education",     r"\b(school|university|degree|gpa|graduat|major)\b", True),
    ("experience",    r"\b(years of experience|years exp)\b", True),
]


def categorize(label: str, ftype: str) -> tuple[str, bool]:
    """Return (category, deterministic). Free-text customs need AI."""
    lo = (label or "").lower()
    for cat, pat, det in _RULES:
        if re.search(pat, lo):
            return cat, det
    # Uncategorized: free text / textarea -> AI; select/checkbox -> maybe mappable
    t = (ftype or "").lower()
    if "textarea" in t or "text" == t or "long" in t:
        return "custom_freetext", False
    if any(k in t for k in ("select", "dropdown", "single", "multi", "radio", "boolean", "checkbox")):
        return "custom_choice", True   # mappable if we learn the options
    return "custom_other", False


# ---- Per-ATS form fetchers --------------------------------------------------
def _norm(label, ftype, required) -> dict:
    cat, det = categorize(label, ftype)
    return {"label": (label or "").strip()[:80], "type": ftype, "required": bool(required),
            "category": cat, "deterministic": det}


def fetch_greenhouse(token: str, limit: int) -> list[list[dict]]:
    forms = []
    try:
        lst = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
                           headers=UA, timeout=20).json().get("jobs", [])
    except Exception:
        return forms
    random.shuffle(lst)
    for job in lst[:limit]:
        try:
            d = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job['id']}?questions=true",
                             headers=UA, timeout=20).json()
            fields = []
            for q in d.get("questions", []):
                types = [f.get("type") for f in q.get("fields", [])] or ["unknown"]
                fields.append(_norm(q.get("label"), "/".join(t for t in types if t), q.get("required")))
            if fields:
                forms.append(fields)
        except Exception:
            continue
        time.sleep(0.2)
    return forms


_LEVER_STD = {
    "name": "identity_name", "email": "email", "phone": "phone", "org": "experience",
    "resume": "resume", "comments": "custom_freetext",
}


def fetch_lever(token: str, limit: int) -> list[list[dict]]:
    forms = []
    try:
        lst = requests.get(f"https://api.lever.co/v0/postings/{token}?mode=json", headers=UA, timeout=20).json()
    except Exception:
        return forms
    random.shuffle(lst)
    for job in lst[:limit]:
        try:
            html = requests.get(f"https://jobs.lever.co/{token}/{job['id']}/apply", headers=UA, timeout=20).text
            fields = []
            for m in re.findall(r'name="([^"]+)"', html):
                if m in _LEVER_STD:
                    fields.append(_norm(m, "input", m != "comments"))
                elif m.startswith("urls["):
                    fields.append(_norm(m, "input", False))
                elif m.startswith("cards["):
                    # custom application question — the label lives near it; approximate
                    fields.append(_norm("custom question", "custom", True))
            # dedupe
            seen, uniq = set(), []
            for f in fields:
                k = f["label"]
                if k not in seen:
                    seen.add(k); uniq.append(f)
            if uniq:
                forms.append(uniq)
        except Exception:
            continue
        time.sleep(0.3)
    return forms


_ASHBY_Q = ("query ApiJobPosting($o: String!, $j: String!) { jobPosting("
            "organizationHostedJobsPageName: $o, jobPostingId: $j) { applicationFormDefinition } }")


def fetch_ashby(token: str, limit: int) -> list[list[dict]]:
    forms = []
    try:
        data = requests.get(f"https://api.ashbyhq.com/posting-api/job-board/{token}", headers=UA, timeout=20).json()
        jobs = data.get("jobs", [])
    except Exception:
        return forms
    random.shuffle(jobs)
    for job in jobs[:limit]:
        try:
            r = requests.post("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting",
                              json={"operationName": "ApiJobPosting",
                                    "variables": {"o": token, "j": job["id"]}, "query": _ASHBY_Q},
                              headers={**UA, "Content-Type": "application/json"}, timeout=20)
            if r.status_code != 200:
                continue
            defn = (((r.json() or {}).get("data") or {}).get("jobPosting") or {}).get("applicationFormDefinition")
            if isinstance(defn, str):
                defn = json.loads(defn)
            fields = []
            for sec in (defn or {}).get("sections", []):
                for fld in sec.get("fields", []):
                    f = fld.get("field", fld)
                    fields.append(_norm(f.get("title") or f.get("label"),
                                        f.get("type"), f.get("isRequired")))
            if fields:
                forms.append(fields)
        except Exception:
            continue
        time.sleep(0.3)
    return forms


FETCHERS = {"greenhouse": fetch_greenhouse, "lever": fetch_lever, "ashby": fetch_ashby}


def _tokens_for(ats: str, cap: int) -> list[str]:
    from companies import COMPANIES
    toks = [v["ats_token"] for v in COMPANIES.values()
            if v.get("ats_type") == ats and v.get("ats_token")]
    random.shuffle(toks)
    return toks[:cap]


def sample_ats(ats: str, limit: int) -> dict:
    """Sample up to `limit` forms for an ATS, spread across companies."""
    fetch = FETCHERS[ats]
    forms: list[list[dict]] = []
    for tok in _tokens_for(ats, cap=40):
        if len(forms) >= limit:
            break
        got = fetch(tok, limit=max(2, limit // 10))
        forms.extend(got)
        logger.info(f"  {ats}/{tok}: +{len(got)} forms (total {len(forms)})")
    forms = forms[:limit]

    # Aggregate
    cat_counter = Counter()
    ai_fields = Counter()
    field_counts = [len(f) for f in forms]
    required_ai = 0
    has_file = 0
    has_demographic = 0
    per_form_ai = []
    for form in forms:
        cats = set()
        ai_here = 0
        for fld in form:
            cat_counter[fld["category"]] += 1
            cats.add(fld["category"])
            if not fld["deterministic"]:
                ai_fields[fld["label"] or fld["category"]] += 1
                ai_here += 1
                if fld["required"]:
                    required_ai += 1
        per_form_ai.append(ai_here)
        if "resume" in cats:
            has_file += 1
        if "demographic" in cats:
            has_demographic += 1

    n = len(forms) or 1
    return {
        "ats": ats,
        "forms_sampled": len(forms),
        "avg_fields_per_form": round(sum(field_counts) / n, 1),
        "min_fields": min(field_counts) if field_counts else 0,
        "max_fields": max(field_counts) if field_counts else 0,
        "avg_ai_fields_per_form": round(sum(per_form_ai) / n, 2),
        "forms_with_zero_ai_fields_pct": round(100 * sum(1 for a in per_form_ai if a == 0) / n),
        "forms_with_resume_upload_pct": round(100 * has_file / n),
        "forms_with_demographic_pct": round(100 * has_demographic / n),
        "category_frequency": dict(cat_counter.most_common()),
        "top_ai_needed_fields": dict(ai_fields.most_common(15)),
    }


def main() -> None:
    # load env (needed only for companies list import; no DB required)
    for p in (HERE.parent / ".env", HERE.parent.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

    ap = argparse.ArgumentParser()
    ap.add_argument("--ats", default="greenhouse", help="greenhouse|lever|ashby|all")
    ap.add_argument("--limit", type=int, default=50, help="forms to sample per ATS")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    targets = ["greenhouse", "lever", "ashby"] if args.ats == "all" else [args.ats]
    report = {}
    for ats in targets:
        logger.info(f"=== sampling {ats} (target {args.limit} forms) ===")
        report[ats] = sample_ats(ats, args.limit)
        r = report[ats]
        logger.info(f"[{ats}] {r['forms_sampled']} forms | avg {r['avg_fields_per_form']} fields, "
                    f"{r['avg_ai_fields_per_form']} AI-needed | {r['forms_with_zero_ai_fields_pct']}% "
                    f"need NO AI | categories: {r['category_frequency']}")

    out = args.out or str(HERE.parent / "form_report.json")
    Path(out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    logger.info(f"wrote {out}")


if __name__ == "__main__":
    main()
