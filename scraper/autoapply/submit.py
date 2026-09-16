"""Direct HTTP submission for CAPTCHA-FREE application forms only.

This NEVER solves or bypasses a captcha. Before submitting anything it does a
preflight GET of the real application page and looks for reCAPTCHA / hCaptcha.
If any is present it returns status 'needs_captcha' and does NOT post — the job
stays a one-tap-open in the user's inbox, which they finish in their own browser
(where the invisible captcha naturally passes for a real human).

Only forms with no captcha at all (older embedded Greenhouse boards, some
non-GH/Lever ATSes) are actually submitted here. That is a deliberately small
set; see docs — the modern Greenhouse host and Lever both gate every submit.

    from autoapply.submit import submit_application
    result = submit_application(ats, token, jid, apply_url, fields, resume_bytes)
"""
from __future__ import annotations

import io
import re
import datetime as dt
from typing import Optional

import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

# Anything matching these on the application page means a human-gated submit.
_CAPTCHA_RE = re.compile(
    r"recaptcha|grecaptcha|g-recaptcha|hcaptcha|h-captcha|turnstile|"
    r"enterprise\.js|data-sitekey|cf-challenge",
    re.I,
)

# Fields that are never posted as form values (files handled separately; markers).
_SKIP_SOURCES = {"user_needed"}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def detect_captcha(page_url: str) -> tuple[bool, str]:
    """GET the application page and report whether a captcha guards submission."""
    try:
        r = requests.get(page_url, headers=UA, timeout=25)
    except Exception as e:
        return True, f"page fetch failed ({e}) — treated as gated, not submitting"
    if r.status_code >= 400:
        return True, f"page {r.status_code} — treated as gated"
    m = _CAPTCHA_RE.search(r.text)
    return (bool(m), m.group(0) if m else "no captcha markers found")


def _resume_bytes(resume_url: str) -> Optional[bytes]:
    if not resume_url or not resume_url.startswith("http"):
        return None
    try:
        r = requests.get(resume_url, headers=UA, timeout=30)
        return r.content if r.ok and r.content else None
    except Exception:
        return None


def _form_values(fields: list[dict]) -> tuple[dict, list[str]]:
    """Split prepared fields into POST data values and the list of unfilled
    required names (which mean the submission would be incomplete)."""
    data, missing = {}, []
    for f in fields:
        name, src, val = f.get("name"), f.get("source"), f.get("value")
        if not name or f.get("category") == "resume":
            continue  # resume handled as a file part
        if src in _SKIP_SOURCES or val in (None, ""):
            if f.get("required"):
                missing.append(f.get("label") or name)
            continue
        data[name] = str(val)
    return data, missing


def submit_application(ats: str, token: str, jid: str, apply_url: str,
                       fields: list[dict], resume_url: str = "",
                       dry_run: bool = True) -> dict:
    """Submit ONE prepared application over HTTP if the form has no captcha.

    Returns {status, detail, http_status?, sent?} where status is one of:
      needs_captcha | submitted | submit_failed | incomplete | unsupported
    dry_run=True (default) does everything except the final POST — it returns
    what WOULD be sent, so a real application is never fired accidentally.
    """
    ats = (ats or "").lower()
    page = _page_url(ats, token, jid, apply_url)
    if not page:
        return {"status": "unsupported", "detail": f"no submit path for {ats}", "at": _now()}

    gated, why = detect_captcha(page)
    if gated:
        return {"status": "needs_captcha", "detail": why, "page": page, "at": _now()}

    data, missing = _form_values(fields)
    if missing:
        return {"status": "incomplete", "detail": f"unfilled required: {', '.join(missing[:6])}",
                "at": _now()}

    resume = _resume_bytes(resume_url)
    files = {}
    if resume:
        rn = _resume_field_name(ats, fields)
        files[rn] = ("resume.pdf", io.BytesIO(resume), "application/pdf")

    sent = {"post_url": _post_url(ats, token, jid, apply_url), "field_count": len(data),
            "has_resume": bool(resume)}
    if dry_run:
        return {"status": "dry_run", "detail": "captcha-free; would submit", "sent": sent, "at": _now()}

    try:
        r = requests.post(sent["post_url"], data=data, files=files or None,
                          headers=UA, timeout=45, allow_redirects=True)
    except Exception as e:
        return {"status": "submit_failed", "detail": str(e), "sent": sent, "at": _now()}

    ok = r.status_code in (200, 201, 302) and not _CAPTCHA_RE.search(r.text[:5000])
    return {
        "status": "submitted" if ok else "submit_failed",
        "http_status": r.status_code,
        "detail": "ok" if ok else f"unexpected response ({r.status_code})",
        "sent": sent, "at": _now(),
    }


# ---- per-ATS endpoints ------------------------------------------------------
def _page_url(ats, token, jid, apply_url) -> Optional[str]:
    if ats == "greenhouse":
        return f"https://job-boards.greenhouse.io/{token}/jobs/{jid}"
    if ats == "lever":
        return f"https://jobs.lever.co/{token}/{jid}/apply"
    if apply_url:  # unknown ATS: use its own apply page for captcha detection
        return apply_url
    return None


def _post_url(ats, token, jid, apply_url) -> str:
    if ats == "greenhouse":
        # React Router action posts back to the job route.
        return f"https://job-boards.greenhouse.io/{token}/jobs/{jid}"
    if ats == "lever":
        return f"https://jobs.lever.co/{token}/{jid}/apply"
    return apply_url


def _resume_field_name(ats, fields) -> str:
    for f in fields:
        if f.get("category") == "resume" and f.get("name"):
            return f["name"]
    return "resume"


if __name__ == "__main__":
    import sys, json
    # Safe demo: detection only (never posts). e.g. python submit.py greenhouse airtable
    ats = sys.argv[1] if len(sys.argv) > 1 else "greenhouse"
    token = sys.argv[2] if len(sys.argv) > 2 else "airtable"
    if ats == "greenhouse":
        jid = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
                           headers=UA, timeout=20).json()["jobs"][0]["id"]
    else:
        jid = requests.get(f"https://api.lever.co/v0/postings/{token}?mode=json",
                           headers=UA, timeout=20).json()[0]["id"]
    gated, why = detect_captcha(_page_url(ats, token, str(jid), ""))
    print(json.dumps({"ats": ats, "token": token, "job": jid,
                      "captcha_gated": gated, "why": why}, indent=2))
