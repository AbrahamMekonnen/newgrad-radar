"""Oracle Taleo application adapter.

Taleo is an enterprise ATS owned by Oracle with HIGH automation difficulty (5/5).
Challenges:
  - No public API - entirely web-based with heavy JavaScript rendering
  - Multiple versions: Taleo Business Edition, Enterprise Edition, Oracle Cloud HCM
  - URL patterns vary widely: {company}.taleo.net, {company}.jobs, cloudservice, etc.
  - Multi-step application process with session-based state
  - CSRF tokens embedded in forms
  - JavaScript-rendered forms requiring browser automation for full extraction
  - Login often required before applying

This adapter provides:
  - Basic HTML parsing for static form fields (works ~40% of time)
  - Pattern detection for common Taleo field names
  - Fallback to standard field list when parsing fails

For reliable Taleo automation, consider:
  - nodriver/playwright browser automation
  - Session management with cookies
  - CSRF token extraction and injection

Usage:
    from autoapply.taleo_adapter import fetch_form, resolve
    form = fetch_form("acme", "REQ12345")  # token=company, job_id=requisition number
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional, Dict, Any

import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# Import central field knowledge base
from field_knowledge_base import lookup_field, FIELD_PATTERNS

# Import shared utilities from greenhouse_adapter (excluding Profile and _category)
from greenhouse_adapter import (
    ResolvedField,
    _resolve_one,
    _match_option,
    _decline_option,
    _yesno,
    _authorized_option,
)


@dataclass
class Profile:
    """Complete user profile with all MASTER_PROFILE_FIELDS.

    Required fields:
    """
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    resume_url: str = ""
    linkedin_url: str = ""
    work_authorized: bool = True
    require_sponsorship: bool = False
    location: str = ""

    # Recommended fields
    github_url: str = ""
    years_experience: str = ""  # "0-1", "1-2", "2-3", "3-5", "5+"
    education: str = ""  # "High School", "Associate's", "Bachelor's", "Master's", "PhD"
    graduation_year: Optional[int] = None
    major: str = ""
    willing_to_relocate: bool = True
    start_date: str = ""  # "Immediately", "2 weeks", "1 month", "Flexible"

    # Optional fields
    portfolio_url: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    country: str = "United States"
    salary_expectation: str = ""
    current_company: str = ""
    current_title: str = ""
    gpa: str = ""
    how_heard: str = "Company website"
    referral_name: str = ""
    preferred_name: str = ""
    twitter_url: str = ""
    remote_preference: str = ""  # "Remote", "Hybrid", "On-site", "Flexible"

    # Story bank for AI drafting
    story_bank: Dict[str, str] = field(default_factory=dict)  # Keys: why_interested, about_me, project
    resume_text: str = ""  # Plain text extracted from resume for AI drafting

    # EEO preferences
    eeo_decline_all: bool = True
    eeo_gender: str = ""
    eeo_race: str = ""
    eeo_veteran: str = ""
    eeo_disability: str = ""

    # Derived/computed
    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    # Backwards compatibility
    cover_letter_url: str = ""
    transcript_url: str = ""
    custom_answers: Dict[str, str] = field(default_factory=dict)


# Common Taleo URL patterns
TALEO_URL_PATTERNS = [
    "https://{token}.taleo.net/careersection/jobdetail.ftl?job={job_id}",
    "https://{token}.taleo.net/careersection/2/jobapply.ftl?job={job_id}",
    "https://{token}.jobs/requisition/{job_id}/apply",
    "https://careers.{token}.com/taleo/{job_id}",
    "https://eceo.fa.{token}.oraclecloud.com/hcmUI/CandidateExperience/jobRequisition/{job_id}",
]


# Standard Taleo field names (varies by configuration but these are common)
TALEO_STANDARD_FIELDS = [
    {"label": "First Name", "name": "firstName", "type": "input_text", "required": True},
    {"label": "Last Name", "name": "lastName", "type": "input_text", "required": True},
    {"label": "Email", "name": "email", "type": "input_text", "required": True},
    {"label": "Phone Number", "name": "phoneNumber", "type": "input_text", "required": False},
    {"label": "Address", "name": "address", "type": "input_text", "required": False},
    {"label": "City", "name": "city", "type": "input_text", "required": False},
    {"label": "State", "name": "state", "type": "select", "required": False},
    {"label": "Zip Code", "name": "zipCode", "type": "input_text", "required": False},
    {"label": "Country", "name": "country", "type": "select", "required": False},
    {"label": "Resume", "name": "resume", "type": "input_file", "required": True},
    {"label": "Cover Letter", "name": "coverLetter", "type": "input_file", "required": False},
    {"label": "LinkedIn Profile", "name": "linkedIn", "type": "input_text", "required": False},
    {"label": "Are you authorized to work in the United States?", "name": "workAuthorization",
     "type": "select", "required": True, "values": [{"label": "Yes"}, {"label": "No"}]},
    {"label": "Will you now or in the future require sponsorship?", "name": "sponsorship",
     "type": "select", "required": True, "values": [{"label": "Yes"}, {"label": "No"}]},
]


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Fetch Taleo application form fields.

    Due to Taleo's JavaScript-heavy rendering, this attempts multiple strategies:
    1. Try to fetch and parse HTML directly
    2. Fall back to standard field list if parsing fails

    Returns: [{label, name, type, required, values?}]
    """
    # Try different URL patterns
    for pattern in TALEO_URL_PATTERNS:
        url = pattern.format(token=token, job_id=job_id)
        try:
            fields = _fetch_and_parse(url)
            if fields and len(fields) >= 3:
                return fields
        except Exception:
            continue

    # Fallback: return standard Taleo fields with metadata indicating uncertainty
    return [{**f, "_taleo_fallback": True} for f in TALEO_STANDARD_FIELDS]


def _fetch_and_parse(url: str) -> list[dict]:
    """Attempt to fetch URL and parse form fields from HTML."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    r = requests.get(url, headers=UA, timeout=25, allow_redirects=True)
    if r.status_code >= 400:
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    fields = []

    # Look for form elements with common Taleo patterns
    for inp in soup.find_all(["input", "select", "textarea"]):
        name = inp.get("name") or inp.get("id") or ""
        if not name or name.startswith("_") or "csrf" in name.lower():
            continue

        # Find associated label
        label = ""
        label_el = soup.find("label", {"for": inp.get("id")})
        if label_el:
            label = label_el.get_text(strip=True)
        else:
            # Try parent label
            parent = inp.find_parent("label")
            if parent:
                label = parent.get_text(strip=True)

        if not label:
            label = _infer_label_from_name(name)

        ftype = _map_input_type(inp)
        required = inp.has_attr("required") or inp.get("aria-required") == "true"

        values = []
        if inp.name == "select":
            for opt in inp.find_all("option"):
                val = opt.get("value", "")
                if val and val != "":
                    values.append({"label": opt.get_text(strip=True), "value": val})

        fields.append({
            "label": label,
            "name": name,
            "type": ftype,
            "required": required,
            "values": values if values else None,
        })

    return fields


def _infer_label_from_name(name: str) -> str:
    """Convert field name to readable label."""
    # Convert camelCase or snake_case to Title Case
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
    s = re.sub(r'[_-]', ' ', s)
    return s.title()


def _map_input_type(el) -> str:
    """Map HTML element to standard field type."""
    if el.name == "textarea":
        return "textarea"
    if el.name == "select":
        return "select"
    itype = (el.get("type") or "text").lower()
    if itype == "file":
        return "input_file"
    if itype in ("email", "tel", "url", "text", "number"):
        return "input_text"
    if itype in ("checkbox", "radio"):
        return "select"
    return "input_text"


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve Taleo form fields from the profile.

    Uses the central field_knowledge_base for category detection.
    """
    resolved: list[ResolvedField] = []

    for f in fields:
        label = f.get("label", "")
        name = f.get("name", "")
        ftype = f.get("type", "")
        required = bool(f.get("required"))
        values = f.get("values") or []

        # Use central knowledge base for category detection
        cat, profile_field, resolution = lookup_field(label, name)

        rf = ResolvedField(label=label, name=name, type=ftype, required=required, category=cat)
        val, src = _resolve_one(cat, ftype, values, p, label)
        rf.value, rf.source = val, src
        resolved.append(rf)

    ai_needed = [r for r in resolved if r.source == "ai_needed"]
    user_needed = [r for r in resolved if r.source == "user_needed" and r.required]
    filled = [r for r in resolved if r.source in ("profile", "matched", "eeo", "file")]
    total = len(resolved) or 1

    return {
        "resolved": resolved,
        "ready_count": len(filled),
        "total": len(resolved),
        "ready_pct": round(100 * len(filled) / total),
        "ai_needed": ai_needed,
        "user_needed": user_needed,
        "auto_ready": len(user_needed) == 0,
        "_taleo_note": "Taleo forms are JavaScript-heavy; field detection may be incomplete",
    }


def get_apply_url(token: str, job_id: str) -> str:
    """Return the most likely Taleo apply URL for this company/job."""
    # Most common pattern
    return f"https://{token}.taleo.net/careersection/2/jobapply.ftl?job={job_id}"


if __name__ == "__main__":
    import sys
    import json

    token = sys.argv[1] if len(sys.argv) > 1 else "oracle"
    job_id = sys.argv[2] if len(sys.argv) > 2 else "230001"

    print(f"Fetching Taleo form for {token}/{job_id}...")
    form = fetch_form(token, job_id)
    print(f"Found {len(form)} fields:")
    for f in form:
        fallback = " (fallback)" if f.get("_taleo_fallback") else ""
        print(f"  {f['label'][:40]:40} ({f['type']:12}) req={f.get('required', False)}{fallback}")

    demo = Profile(
        first_name="Alex", last_name="Doe", email="alex@example.com",
        phone="+1 555 123 4567", location="San Francisco, CA",
        linkedin_url="https://linkedin.com/in/alexdoe",
        resume_url="resume.pdf", work_authorized=True, require_sponsorship=False,
    )

    res = resolve(form, demo)
    print(f"\nResolved: {res['ready_pct']}% ready ({res['ready_count']}/{res['total']})")
    print(f"Note: {res.get('_taleo_note', '')}")
    for r in res["resolved"]:
        print(f"  [{r.source:11}] {r.label[:40]:40} -> {str(r.value)[:30]}")
