"""SmartRecruiters application adapter.

SmartRecruiters has a public REST API for job postings:
  - List jobs: GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings
  - Job detail: GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings/{postingId}

The application form fields come from the posting detail endpoint.

    from autoapply.smartrecruiters_adapter import fetch_form, resolve

================================================================================
SMARTRECRUITERS FIELD PATTERNS (from 100-job analysis)
================================================================================

STANDARD FIELDS (auto-filled from profile):
  - Identity: first_name (100%), last_name (100%), email (100%), phone (95.5%)
  - Documents: resume (100%), cover_letter (41.5%)
  - Links: linkedin (66%), github (42%), portfolio (38%)
  - Location: location (58.5%), city (52%), country (56%), address (34%)
  - Work Auth: work_auth (86.5%), sponsorship (81%), relocate (57%)
  - Experience: years_experience (69%), education (46%), salary (45.5%)
  - Other: start_date (59%), source (75.5%)

EEO FIELDS (auto-decline with "Prefer not to answer"):
  - gender (84%), race (82%), veteran (78.5%), disability (77.5%)

COMPLIANCE FIELDS (require explicit user input - cannot auto-fill):
  - age_verification (41%): "Are you 18 years or older?"
  - background_check (45.5%): "Can you pass a background check?"
  - drug_test (28%): "Can you pass a drug test?"
  - citizenship (24%): "Are you a US citizen?" (gov't jobs)
  - security_clearance (18%): "Do you hold a clearance?" (gov't jobs)
  - travel (22%): "Willing to travel X%?"
  - schedule (30.5%): "Available for specific hours?"
  - work_mode/remote (48%): "Remote/hybrid/onsite preference"
  - languages (36%): "What languages do you speak?"

ESSAY QUESTIONS (AI drafts from resume/profile):
  - motivation (27%): "Tell us about yourself / Why interested?"
  - experience_essay (25%): "Describe relevant experience"
  - qualifications_essay (20%): "What makes you a good fit?"

LABEL VARIATIONS RECOGNIZED (all map to standard categories):
  - first_name: "First Name", "firstname", "fname", "given name"
  - last_name: "Last Name", "lastname", "lname", "surname"
  - email: "Email", "email address", "e-mail"
  - phone: "Phone", "phone number", "telephone", "mobile", "cell"
  - resume: "Resume", "CV", "Resume/CV", "curriculum vitae"
  - linkedin: "LinkedIn Profile", "LinkedIn URL", "linkedin", "linkedinprofile"
  - work_auth: "Work Authorization", "Are you authorized to work...",
               "Are you legally authorized...", "Employment Eligibility"
  - sponsorship: "Visa Sponsorship Required", "Do you require sponsorship?",
                 "Will you require sponsorship for employment visa status?"
  - location: "Current Location", "city/state", "where are you located"
  - gender/race/veteran/disability: Various EEO phrasings
================================================================================
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)"}

# Import shared Profile and ResolvedField from greenhouse_adapter for consistency
from greenhouse_adapter import (
    Profile,
    ResolvedField,
    _match_option,
    _decline_option,
    _yesno,
    _authorized_option,
)

# Import central field knowledge base for standardized field detection
from field_knowledge_base import lookup_field, FIELD_PATTERNS


# =============================================================================
# SMARTRECRUITERS-SPECIFIC CATEGORY PATTERNS
# =============================================================================
# These supplement the base patterns from field_knowledge_base.py with
# SmartRecruiters-specific phrasings discovered in the 100-job analysis.

_SR_PATTERNS = [
    # Compliance questions (not in base knowledge base)
    ("age_verification", r"\b(18 years|over 18|at least 18|age requirement|legal age)\b"),
    ("background_check", r"\b(background check|criminal|background screen)\b"),
    ("drug_test", r"\b(drug test|drug screen|substance test)\b"),
    ("citizenship", r"\b(us citizen|u\.s\. citizen|citizen of|citizenship)\b"),
    ("security_clearance", r"\b(security clearance|clearance level|classified)\b"),
    ("travel", r"\b(travel|traveling|% of time|percent.*travel)\b"),
    ("schedule", r"\b(schedule|shift|hours|weekend|overtime|on-?call)\b"),
    ("remote_preference", r"\b(remote|hybrid|on-?site|in-?office|work from home|wfh|work mode|work location|work arrangement)\b"),
    ("languages", r"\b(language|speak|fluent|bilingual|multilingual)\b"),
    # Essay questions
    ("motivation", r"\b(tell us about yourself|about yourself|why are you interested|why this role)\b"),
    ("experience_essay", r"\b(describe.*experience|relevant experience|past experience)\b"),
    ("qualifications_essay", r"\b(good fit|qualified|why should we|what makes you)\b"),
]


def _category(label: str, field_name: str = "") -> str:
    """Detect category using central knowledge base with SmartRecruiters-specific extensions.

    Resolution order:
    1. SmartRecruiters-specific patterns (compliance, essay questions not in base)
    2. Central field_knowledge_base lookup (covers ~95% of standard fields)
    """
    lo = (label or "").lower()

    # Try SR-specific patterns first (compliance/essay questions unique to SmartRecruiters)
    for cat, pat in _SR_PATTERNS:
        if re.search(pat, lo, re.IGNORECASE):
            return cat

    # Use central knowledge base for standard field detection
    # lookup_field returns (category, profile_field, resolution)
    category, _, _ = lookup_field(label, field_name)
    return category


def fetch_form(company_id: str, posting_id: str) -> list[dict]:
    """Fetch SmartRecruiters posting detail and extract form fields.

    Returns normalized fields: [{label, required, name, type, values}]
    """
    # SmartRecruiters public API endpoint
    url = f"https://api.smartrecruiters.com/v1/companies/{company_id}/postings/{posting_id}"

    try:
        r = requests.get(url, headers=UA, timeout=20)
        r.raise_for_status()
        data = r.json()
    except requests.exceptions.HTTPError as e:
        # Try alternative URL pattern (some companies use subdomain)
        alt_url = f"https://jobs.smartrecruiters.com/{company_id}/api/postings/{posting_id}"
        try:
            r = requests.get(alt_url, headers=UA, timeout=20)
            r.raise_for_status()
            data = r.json()
        except:
            raise e

    # SmartRecruiters returns application configuration in the posting
    # Build standard form fields from the response
    fields = []

    # Standard fields are always present for SmartRecruiters
    standard_fields = [
        {"label": "First Name", "name": "firstName", "type": "input_text", "required": True},
        {"label": "Last Name", "name": "lastName", "type": "input_text", "required": True},
        {"label": "Email", "name": "email", "type": "input_text", "required": True},
        {"label": "Phone", "name": "phoneNumber", "type": "input_text", "required": False},
        {"label": "Resume", "name": "resume", "type": "input_file", "required": True},
    ]
    fields.extend(standard_fields)

    # Extract screening questions if present
    questions = data.get("applicationConfiguration", {}).get("screeningQuestions", [])
    if not questions:
        questions = data.get("questions", [])

    for q in questions:
        qtype = q.get("type", "TEXT").upper()
        field_type = "textarea" if qtype == "TEXTAREA" else "input_text"

        if qtype in ("SINGLE_SELECT", "DROPDOWN"):
            field_type = "select"
        elif qtype == "MULTI_SELECT":
            field_type = "multi_select"
        elif qtype == "BOOLEAN":
            field_type = "select"

        values = []
        for opt in q.get("options", []) or q.get("answers", []):
            if isinstance(opt, dict):
                values.append({"label": opt.get("label") or opt.get("value"),
                              "value": opt.get("value") or opt.get("id")})
            else:
                values.append({"label": str(opt), "value": str(opt)})

        # For boolean, add Yes/No
        if qtype == "BOOLEAN" and not values:
            values = [{"label": "Yes", "value": "true"}, {"label": "No", "value": "false"}]

        fields.append({
            "label": q.get("label") or q.get("question", ""),
            "name": q.get("id") or q.get("fieldId") or f"q_{len(fields)}",
            "type": field_type,
            "required": q.get("required", False),
            "values": values,
        })

    # Check for LinkedIn profile field (common in SmartRecruiters)
    if data.get("applicationConfiguration", {}).get("linkedInProfile"):
        fields.append({
            "label": "LinkedIn Profile",
            "name": "linkedInProfile",
            "type": "input_text",
            "required": False,
        })

    return fields


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve SmartRecruiters form fields from the profile.

    Uses the same resolution logic as greenhouse_adapter.
    """
    resolved: list[ResolvedField] = []

    for f in fields:
        label = f.get("label", "")
        name = f.get("name", "")
        ftype = f.get("type", "")
        required = bool(f.get("required"))
        values = f.get("values", [])
        cat = _category(label, name)

        rf = ResolvedField(label=label, name=name, type=ftype, required=required, category=cat)
        val, src = _resolve_one_sr(cat, ftype, values, p, label, name)
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
    }


def _resolve_one_sr(cat: str, ftype: str, values: list, p: Profile, label: str, name: str):
    """Resolve a single SmartRecruiters field.

    Resolution strategies:
    - profile: Direct mapping from Profile field
    - matched: Select from dropdown options based on profile value
    - eeo: Auto-decline with "Prefer not to answer"
    - file: File upload (resume, cover letter)
    - ai_needed: Free-text that AI can draft
    - user_needed: Requires explicit user input
    - unfilled: Optional field with no value
    """
    # Handle SmartRecruiters-specific field names (camelCase API convention)
    name_lower = (name or "").lower()

    # -------------------------------------------------------------------------
    # IDENTITY FIELDS (100% frequency - required)
    # -------------------------------------------------------------------------
    if name_lower == "firstname" or cat == "first_name":
        return (p.first_name, "profile") if p.first_name else (None, "user_needed")
    if name_lower == "lastname" or cat == "last_name":
        return (p.last_name, "profile") if p.last_name else (None, "user_needed")
    if name_lower == "email" or cat == "email":
        return (p.email, "profile") if p.email else (None, "user_needed")
    if name_lower == "phonenumber" or cat == "phone":
        return (p.phone, "profile") if p.phone else (None, "unfilled")
    if name_lower == "linkedinprofile" or cat == "linkedin":
        return (p.linkedin_url, "profile") if p.linkedin_url else (None, "unfilled")

    # -------------------------------------------------------------------------
    # PREFERRED NAME (15% frequency)
    # -------------------------------------------------------------------------
    if cat == "preferred_name":
        pref = getattr(p, 'preferred_name', None)
        return (pref, "profile") if pref else (None, "unfilled")

    # -------------------------------------------------------------------------
    # SIMPLE PROFILE MAPPINGS
    # -------------------------------------------------------------------------
    # Standard categories - direct profile field lookups
    simple = {
        # Links (42-66% frequency)
        "github": p.github_url,
        "portfolio": p.portfolio_url,
        # Location (58.5% frequency)
        "location": p.location,
        # Compensation/Experience (45-69% frequency)
        "salary": p.salary_expectation,
        "experience": p.years_experience,
        # Address components (34-56% frequency) - use getattr for optional fields
        "city": getattr(p, 'city', None),
        "state": getattr(p, 'state', None),
        "country": getattr(p, 'country', None),
        "zip": getattr(p, 'zip_code', None),
        "address": getattr(p, 'address', None),
        # Education (46% frequency)
        "education": getattr(p, 'education', None),
        "graduation_year": getattr(p, 'graduation_year', None),
        "major": getattr(p, 'major', None),
        "gpa": getattr(p, 'gpa', None),
        # Employment history (20% frequency)
        "current_company": getattr(p, 'current_company', None),
        "current_title": getattr(p, 'current_title', None),
    }

    if cat == "full_name":
        full = f"{p.first_name} {p.last_name}".strip()
        return (full, "profile") if full else (None, "user_needed")

    if cat in simple:
        v = simple[cat]
        return (v, "profile") if v else (None, "unfilled")

    if cat == "resume":
        return (p.resume_url or None, "file")

    if cat == "cover_letter":
        return (None, "ai_needed")

    if cat == "source":
        return (_match_option(values, p.how_heard.lower()) or p.how_heard, "matched")

    if cat == "work_auth" and p.work_authorized is not None:
        v = _authorized_option(values, p.work_authorized) if values else ("Yes" if p.work_authorized else "No")
        return (v, "matched") if v else (None, "user_needed")

    if cat == "sponsorship" and p.require_sponsorship is not None:
        v = _yesno(values, p.require_sponsorship) if values else ("Yes" if p.require_sponsorship else "No")
        return (v, "matched") if v else (None, "user_needed")

    if cat == "relocate" and p.willing_to_relocate is not None:
        return (_yesno(values, p.willing_to_relocate) if values else
                ("Yes" if p.willing_to_relocate else "No"), "matched")

    if cat == "start_date":
        return (_match_option(values, "immediat", "flexible") or p.start_date or "Immediately", "matched")

    # -------------------------------------------------------------------------
    # EEO FIELDS (77-84% frequency) - Auto-decline
    # -------------------------------------------------------------------------
    if cat in ("gender", "race", "veteran", "disability"):
        return (_decline_option(values), "eeo")

    # -------------------------------------------------------------------------
    # WORK MODE / REMOTE PREFERENCE (48% frequency)
    # -------------------------------------------------------------------------
    if cat == "remote_preference":
        pref = getattr(p, 'remote_preference', None)
        if pref and values:
            matched = _match_option(values, pref.lower())
            return (matched or pref, "matched") if matched else (None, "user_needed")
        return (None, "user_needed")

    # -------------------------------------------------------------------------
    # LANGUAGES (36% frequency)
    # -------------------------------------------------------------------------
    if cat == "languages":
        langs = getattr(p, 'languages', None)
        return (langs, "profile") if langs else (None, "user_needed")

    # -------------------------------------------------------------------------
    # COMPLIANCE FIELDS - Require explicit user confirmation
    # These cannot be auto-filled as they have legal/policy implications
    # -------------------------------------------------------------------------
    # Age verification (41%): "Are you 18 years or older?"
    # Background check (45.5%): "Can you pass a background check?"
    # Drug test (28%): "Can you pass a drug test?"
    # Citizenship (24%): "Are you a US citizen?" (government jobs)
    # Security clearance (18%): "Do you hold a security clearance?"
    # Travel (22%): "Willing to travel X% of time?"
    # Schedule (30.5%): "Available for specific hours/shifts?"
    if cat in ("age_verification", "background_check", "drug_test",
               "citizenship", "security_clearance", "travel", "schedule"):
        # Check if user has provided a saved answer
        saved = p.custom_answers.get(label) if label else None
        if saved:
            return (saved, "profile")
        return (None, "user_needed")

    # -------------------------------------------------------------------------
    # ESSAY QUESTIONS - AI can draft these (20-27% frequency)
    # -------------------------------------------------------------------------
    if cat in ("motivation", "experience_essay", "qualifications_essay",
               "why_interested", "tell_about_yourself", "describe_project"):
        return (None, "ai_needed")

    # -------------------------------------------------------------------------
    # REFERRAL (25% frequency)
    # -------------------------------------------------------------------------
    if cat == "referral":
        ref = getattr(p, 'referral_name', None)
        return (ref, "profile") if ref else (None, "unfilled")

    # -------------------------------------------------------------------------
    # CUSTOM ANSWERS - Check learned answers
    # -------------------------------------------------------------------------
    if label and p.custom_answers.get(label):
        return (p.custom_answers[label], "profile")

    # -------------------------------------------------------------------------
    # UNKNOWN FIELDS - Determine AI vs user based on field type
    # -------------------------------------------------------------------------
    t = (ftype or "").lower()
    # Free-text fields can be drafted by AI
    if "textarea" in t or t in ("input_text", "text"):
        return (None, "ai_needed")
    # Select/choice fields need user input (we don't guess options)
    return (None, "user_needed")


def fetch_jobs(company_id: str, limit: int = 100) -> list[dict]:
    """Fetch all job postings for a SmartRecruiters company.

    Returns list of {id, title, location, url, ...}
    """
    url = f"https://api.smartrecruiters.com/v1/companies/{company_id}/postings"
    params = {"limit": limit}

    try:
        r = requests.get(url, headers=UA, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()
        return data.get("content", [])
    except:
        # Try alternative URL
        alt_url = f"https://jobs.smartrecruiters.com/{company_id}/api/postings"
        r = requests.get(alt_url, headers=UA, timeout=20)
        r.raise_for_status()
        return r.json()


if __name__ == "__main__":
    import sys
    import json

    # Demo: resolve a SmartRecruiters form
    company = sys.argv[1] if len(sys.argv) > 1 else "booking"

    # Fetch first job
    jobs = fetch_jobs(company)
    if not jobs:
        print(f"No jobs found for {company}")
        sys.exit(1)

    jid = jobs[0].get("id") or jobs[0].get("uuid")
    print(f"Fetching form for {company} job {jid}...")

    form = fetch_form(company, jid)
    print(f"Found {len(form)} fields")

    demo = Profile(
        first_name="Alex", last_name="Doe", email="alex@example.com",
        phone="+1 555 123 4567", location="San Francisco, CA",
        linkedin_url="https://linkedin.com/in/alexdoe",
        github_url="https://github.com/alexdoe", resume_url="resume.pdf",
        work_authorized=True, require_sponsorship=False,
        willing_to_relocate=True, years_experience="1",
    )

    res = resolve(form, demo)
    print(f"\n{company}: {res['ready_pct']}% ready ({res['ready_count']}/{res['total']})")
    for r in res["resolved"]:
        print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:34]}")
