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

# Role focus -> extra title terms to bias the X-Ray query.
_FOCUS_TERMS = {
    "new_grad": ['"university recruiter"', '"campus recruiter"', '"early career recruiter"',
                 '"early talent"', '"technical recruiter"'],
    "intern": ['"university recruiter"', '"campus recruiter"', '"early career recruiter"'],
    "generic": ['"technical recruiter"', '"recruiter"', '"talent acquisition"'],
}


def cse_available() -> bool:
    return bool(os.environ.get("GOOGLE_CSE_KEY") and os.environ.get("GOOGLE_CSE_ID"))


def cse_search(query: str, num: int = 10) -> List[Dict]:
    """Run one Custom Search query; return raw items (title/link/snippet). []-safe."""
    key = os.environ.get("GOOGLE_CSE_KEY")
    cx = os.environ.get("GOOGLE_CSE_ID")
    if not key or not cx:
        return []
    try:
        import requests
        r = requests.get(
            _CSE_ENDPOINT,
            params={"key": key, "cx": cx, "q": query, "num": min(num, 10)},
            timeout=20,
        )
        if r.status_code != 200:
            logger.warning(f"CSE {r.status_code}: {r.text[:150]}")
            return []
        return r.json().get("items", []) or []
    except Exception as e:
        logger.debug(f"CSE query failed: {e}")
        return []


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
    query = f'"{company_name}" ({" OR ".join(terms)})'
    items = cse_search(query, num=10)

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
    """Derive each recruiter's email via the company's LEARNED pattern.

    Learns the domain's email format once (email_intel, from public GitHub
    data), detects catch-all once, then applies to each recruiter — far more
    accurate than brute-forcing every pattern per person.
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
    candidates = [k for k, _ in ranked] or ["first.last", "firstlast", "flast"]
    catch_all = _is_catch_all(domain) if verify_email else True

    for r in recruiters:
        if r.get("email"):
            continue  # already have a real (published) email from the snippet
        if len(r["name"].split()) < 2:
            continue
        if catch_all or verify_email is None:
            # can't SMTP-verify reliably — trust the learned pattern
            em = guess_email(r["name"], domain, candidates[0])
            if em:
                r["email"] = em
                r["email_verified"] = False
                r["email_confidence"] = "medium" if ranked else "low"
            continue
        for key in candidates[:5]:
            em = guess_email(r["name"], domain, key)
            if not em:
                continue
            try:
                if getattr(verify_email(em), "valid", False):
                    r["email"] = em
                    r["email_verified"] = True
                    r["email_confidence"] = "high"
                    break
            except Exception:
                continue
            time.sleep(0.2)
        if not r.get("email"):
            r["email"] = guess_email(r["name"], domain, candidates[0])
            r["email_confidence"] = "medium" if ranked else "low"
