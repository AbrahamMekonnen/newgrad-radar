"""Find REAL recruiters via Google Custom Search X-Ray of public LinkedIn.

No LLM name generation — every recruiter comes from Google's public index of
LinkedIn profiles. Pipeline per company:
  1. X-Ray query: '"{company}" ("university recruiter" OR "technical recruiter" ...)'
     against a CSE scoped to linkedin.com/in/* -> real profile results.
  2. Parse name + title + profile URL from each result; keep only results whose
     title/snippet confirms BOTH a recruiting role AND the company.
  3. Best-effort verified email via email-pattern generation + SMTP verification
     (recruiters/email_patterns.py + smtp_verify.py) — never fabricated.

For NEW-GRAD jobs the caller should prefer university/campus recruiters (the
people who actually own new-grad requisitions).

Requires env: GOOGLE_CSE_KEY, GOOGLE_CSE_ID.
"""
from __future__ import annotations

import os
import re
import time
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

_CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1"

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

# Titles that mark a real recruiting role.
_RECRUITER_TITLE_RE = re.compile(
    r"\b(recruiter|recruiting|talent acquisition|talent partner|talent sourcer|"
    r"sourcer|university recruit|campus recruit|early career|early talent|"
    r"technical recruit|tech recruit|people ops|head of talent|talent lead)\b",
    re.IGNORECASE,
)

# Role focus -> extra title terms to bias the X-Ray query. Each focus finds a
# DIFFERENT set of recruiters so we can match them to a job's level:
#   new_grad     -> the people who own early-career / campus requisitions
#   experienced  -> senior/technical recruiters who own mid+ requisitions
#   generic      -> broad recruiting/TA (fallback that fits any level)
_FOCUS_TERMS = {
    "new_grad": ['"university recruiter"', '"campus recruiter"', '"early career recruiter"',
                 '"early talent"', '"early career"'],
    "intern": ['"university recruiter"', '"campus recruiter"', '"early career recruiter"'],
    "experienced": ['"technical recruiter"', '"senior technical recruiter"',
                    '"engineering recruiter"', '"senior recruiter"', '"experienced hiring"'],
    "generic": ['"technical recruiter"', '"recruiter"', '"talent acquisition"'],
}


def _search(query: str, num: int = 10) -> List[Dict]:
    """Search via the provider chain (Google CSE / Serper / Brave / DDG)."""
    try:
        from search_providers import web_search
    except ImportError:
        from recruiters.search_providers import web_search
    return web_search(query, num)


def cse_available() -> bool:
    """True if any search provider has a key configured (DDG excluded — it's
    bot-blocked and unreliable for automated queries)."""
    return bool(
        (os.environ.get("GOOGLE_CSE_KEY") and os.environ.get("GOOGLE_CSE_ID"))
        or os.environ.get("SERPER_API_KEY")
        or os.environ.get("BRAVE_API_KEY")
    )


def _clean_name(title: str) -> Optional[str]:
    """LinkedIn result titles look like 'Jane Doe - Technical Recruiter - Stripe | LinkedIn'."""
    if not title:
        return None
    name = re.split(r"\s[-|–]\s", title.strip())[0].strip()
    # must be a plausible person name: 2-4 capitalized words
    parts = [p for p in name.split() if p]
    if not (2 <= len(parts) <= 4):
        return None
    if not all(re.match(r"^[A-Z][A-Za-z.'-]+$", p) for p in parts[:2]):
        return None
    return name


def find_recruiters(
    company_name: str,
    domain: Optional[str] = None,
    role_focus: str = "new_grad",
    max_results: int = 6,
    verify_emails: bool = True,
) -> List[Dict]:
    """Return real recruiters for a company (see module docstring). Never raises."""
    if not cse_available() or not company_name:
        return []

    terms = _FOCUS_TERMS.get(role_focus, _FOCUS_TERMS["generic"])
    # site: scopes non-Google providers to LinkedIn profiles (the Google CSE is
    # already scoped to linkedin.com/in via its site config, so it's harmless).
    query = f'site:linkedin.com/in "{company_name}" ({" OR ".join(terms)})'
    items = _search(query, num=10)

    company_key = re.sub(r"[^a-z0-9]", "", company_name.lower())
    seen = set()
    out: List[Dict] = []
    for it in items:
        link = it.get("link", "")
        if "linkedin.com/in/" not in link:
            continue
        title = it.get("title", "")
        snippet = it.get("snippet", "") or ""
        hay = f"{title} {snippet}"
        # must look like a recruiter AND mention the company (avoid wrong-company hits)
        if not _RECRUITER_TITLE_RE.search(hay):
            continue
        if company_key and company_key not in re.sub(r"[^a-z0-9]", "", hay.lower()):
            continue
        name = _clean_name(title)
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        # role/title text (best-effort from the title segment after the name)
        segs = re.split(r"\s[-|–]\s", title)
        role_title = segs[1].strip() if len(segs) > 1 else None
        # If the indexed snippet exposes an email (some recruiters list it in
        # their About/posts), grab a company-domain one — a real published
        # address, no guessing.
        snippet_email = None
        for em in _EMAIL_RE.findall(hay):
            em = em.lower()
            if em.endswith((".png", ".jpg", ".gif")):
                continue
            if domain and domain.lower() in em:
                snippet_email = em
                break
            snippet_email = snippet_email or em  # fall back to any real email
        out.append({
            "name": name,
            "title": role_title,
            "linkedin_url": link.split("?")[0],
            "company": company_name,
            "role_focus": role_focus,
            "email": snippet_email,
            "email_verified": bool(snippet_email),  # published in a public listing
            "source": "linkedin_xray",
        })
        if len(out) >= max_results:
            break

    if verify_emails and domain:
        _attach_verified_emails(out, domain)
    return out


def _attach_verified_emails(recruiters: List[Dict], domain: str, github_org: Optional[str] = None) -> None:
    """Attach a RANKED LIST of candidate work emails to each recruiter.

    Instead of picking one guess, we surface every high-probability candidate
    (the company's LEARNED pattern first, then the common ~80%-coverage formats).
    The user can contact all of them, so one being the person's real address is
    near-certain even on catch-all domains we can't SMTP-verify. Each recruiter
    gets:
      - r["email_variants"]: ranked [{email, confidence (0-1 float), verified}]
        — the shape the DB column + RecruiterCard already expect.
      - r["email"]:  the top candidate (kept as the scalar primary).

    Confidence scale (matches the frontend thresholds):
      0.95 verified (real published, or SMTP-confirmed)
      0.70 learned company pattern (from public GitHub data)
      0.50 common default pattern (no learning available)

    We learn the domain's format once (email_intel, from public GitHub data) and
    detect catch-all once, then apply to each recruiter.
    """
    try:
        from email_intel import learn_domain_pattern, guess_email, _is_catch_all
    except ImportError:
        try:
            from recruiters.email_intel import learn_domain_pattern, guess_email, _is_catch_all
        except Exception:
            return
    try:
        from smtp_verify import verify_email
    except ImportError:
        try:
            from recruiters.smtp_verify import verify_email
        except Exception:
            verify_email = None

    org = github_org or re.sub(r"[^a-z0-9]", "", domain.split(".")[0].lower())
    ranked = learn_domain_pattern(domain, org)
    # learned patterns first, then the common defaults; dedup, cap at a sane N
    pat_order, seen_pat = [], set()
    for k in [k for k, _ in ranked] + ["first.last", "firstlast", "flast", "f.last", "firstl"]:
        if k not in seen_pat:
            seen_pat.add(k)
            pat_order.append(k)
    learned_conf = 0.70 if ranked else 0.50
    catch_all = _is_catch_all(domain) if verify_email else True

    for r in recruiters:
        if len(r["name"].split()) < 2:
            continue
        variants: List[Dict] = []
        seen_em = set()

        # 1) A real published email from the snippet always ranks first.
        published = r.get("email")
        if published:
            variants.append({"email": published.lower(), "confidence": 0.95,
                             "verified": True})
            seen_em.add(published.lower())

        # 2) Pattern-derived candidates (learned patterns first).
        for key in pat_order:
            em = guess_email(r["name"], domain, key)
            if not em or em in seen_em:
                continue
            seen_em.add(em)
            entry = {"email": em, "confidence": learned_conf, "verified": False}
            # SMTP-verify only when the domain isn't catch-all (else unreliable).
            if not catch_all and verify_email is not None:
                try:
                    if getattr(verify_email(em), "valid", False):
                        entry.update(verified=True, confidence=0.95)
                except Exception:
                    pass
                time.sleep(0.2)
            variants.append(entry)
            if len(variants) >= 5:
                break

        if not variants:
            continue
        # Rank: verified first, then by confidence. Primary = the top one.
        variants.sort(key=lambda v: (v["verified"], v["confidence"]), reverse=True)
        r["email_variants"] = variants
        r["email"] = variants[0]["email"]
        r["email_verified"] = variants[0]["verified"]
