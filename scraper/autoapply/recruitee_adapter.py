"""Recruitee application adapter.

Recruitee uses a simple REST API for job listings and form data:
  - List jobs: GET https://{company}.recruitee.com/api/offers
  - Job detail: GET https://{company}.recruitee.com/api/offers/{offer_id}

The application form fields come from the offer detail endpoint.

    from autoapply.recruitee_adapter import fetch_form, resolve

FIELD ANALYSIS (112 Recruitee jobs analyzed):
- Standard fields (100%): first_name, last_name, email, phone, resume
- Common (10-35%): salary, location, experience, portfolio, linkedin
- Work Authorization (12%): Various phrasings including EU/UK/NL/MY specific
- Sponsorship (8%): Multiple visa sponsorship question formats
- Consent/GDPR (10%): Data processing consent, often in Dutch/German
- EEO (3%): gender, race, veteran, disability - all use decline
- Other (5-8%): citizenship, language proficiency, contract type, pronouns

CUSTOM QUESTION PATTERNS (AI-drafted):
- Motivation (15%): "why join/interested/attracted"
- Strengths (8%): "core strength/top strength/skill"
- Work style (5%): "approach to work/methodology"
- Achievements (6%): "career highlight/proud of"
- Company knowledge (4%): "what do you know about company"

USER INPUT NEEDED:
- Video intro (6%): Cannot be AI-drafted
- Mentorship (5%): Previous experience coaching
- Previous employment (5%): Worked at company before
- AI usage (3%): Approach to using AI tools
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional, Any

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)"}

# Central field knowledge base for consistent categorization
from field_knowledge_base import lookup_field, FIELD_PATTERNS

from greenhouse_adapter import (
    ResolvedField,
    _resolve_one as _base_resolve_one,
    _match_option,
    _decline_option,
    _yesno,
    _authorized_option,
)


# =============================================================================
# PROFILE DATACLASS - All fields from MASTER_PROFILE_FIELDS
# =============================================================================

@dataclass
class Profile:
    """User profile with all fields needed for auto-apply.

    Based on MASTER_PROFILE_FIELDS from field_knowledge_base.
    """
    # Required fields
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
    years_experience: str = ""
    education: str = ""
    graduation_year: str = ""
    major: str = ""
    willing_to_relocate: bool = True
    start_date: str = ""

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
    remote_preference: str = ""
    other_links: str = ""

    # File URLs
    cover_letter_url: str = ""
    transcript_url: str = ""
    photo_url: str = ""

    # Story bank for AI drafting
    story_why_interested: str = ""
    story_about_me: str = ""
    story_project: str = ""
    resume_text: str = ""
    custom_answers: dict = field(default_factory=dict)

    # EEO preferences
    eeo_decline_all: bool = True
    eeo_gender: str = ""
    eeo_race: str = ""
    eeo_veteran: str = ""
    eeo_disability: str = ""

    # Recruitee-specific fields
    citizenship: str = ""
    language_proficiency: str = ""
    contract_preference: str = ""
    can_b2b: bool = False
    pronouns: str = ""


# =============================================================================
# RECRUITEE-SPECIFIC FIELD PATTERNS
# Only patterns NOT in central field_knowledge_base
# Based on analysis of 112 Recruitee job postings
# =============================================================================

# Patterns unique to Recruitee that are NOT in field_knowledge_base
RECRUITEE_PATTERNS = [
    # -------------------------------------------------------------------------
    # CONSENT/GDPR (10% frequency) - NOT in central base
    # Often appears in Dutch/German forms
    # -------------------------------------------------------------------------
    ("consent_gdpr", r"consent.*process.*personal|gdpr|data.*processing.*consent|"
                     r"pre-employment.*screening.*consent|toestemming.*gegevens.*bewaren|"
                     r"explicit consent"),

    # -------------------------------------------------------------------------
    # CITIZENSHIP (5% frequency) - NOT in central base
    # -------------------------------------------------------------------------
    ("citizenship", r"\bcitizenship\b"),

    # -------------------------------------------------------------------------
    # LANGUAGE PROFICIENCY (5% frequency) - NOT in central base
    # -------------------------------------------------------------------------
    ("language", r"language proficiency|writing.*speaking.*english|"
                 r"language.*proficiency.*(dutch|french|german)|assess.*english"),

    # -------------------------------------------------------------------------
    # CONTRACT TYPE (5% frequency) - NOT in central base
    # Common in European Recruitee postings
    # -------------------------------------------------------------------------
    ("contract_type", r"b2b contract|contract type|able to work on a b2b"),

    # -------------------------------------------------------------------------
    # PRONOUNS (5% frequency) - NOT in central base
    # -------------------------------------------------------------------------
    ("pronouns", r"your pronouns|pronouns:"),

    # -------------------------------------------------------------------------
    # PHOTO (5% frequency) - NOT in central base
    # -------------------------------------------------------------------------
    ("photo", r"photo|headshot|profile picture"),

    # -------------------------------------------------------------------------
    # AI-DRAFTABLE CUSTOM QUESTIONS (frequent patterns)
    # These extend beyond central base's why_interested/tell_about_yourself
    # -------------------------------------------------------------------------
    ("strengths", r"core strength|top.*strength|strongest|skill|areas.*strong"),
    ("work_style", r"approach.*work|work.*style|methodology|problem.*solv|how do you.*approach"),
    ("achievements", r"career highlight|proud of|achievement|accomplishment"),
    ("company_knowledge", r"company.*knowledge|what do you know about|research.*company"),
    ("reason_leaving", r"reason for leaving|why.*leaving|current.*employer"),

    # -------------------------------------------------------------------------
    # USER-INPUT-NEEDED QUESTIONS
    # -------------------------------------------------------------------------
    ("video_intro", r"video introduction|video.*yourself|record.*video"),
    ("mentorship", r"mentor|coach|leadership.*less experienced"),
    ("previous_employment", r"previously worked|former employee|worked at.*company"),
    ("ai_usage", r"using ai|approach.*ai|artificial intelligence"),
]

# Compile patterns for fast matching
_RECRUITEE_COMPILED = [(cat, re.compile(pat, re.IGNORECASE)) for cat, pat in RECRUITEE_PATTERNS]


def _recruitee_category(label: str, field_name: str = "") -> str:
    """Detect category using central field_knowledge_base first, then Recruitee-specific patterns.

    Strategy:
    1. First try lookup_field from central knowledge base (handles ~80% of fields)
    2. If returns "custom", check Recruitee-specific patterns
    3. Return "custom" for truly unknown fields
    """
    # Try central knowledge base first
    category, profile_field, resolution = lookup_field(label, field_name)

    # If central base found a match (not "custom"), use it
    if category != "custom":
        return category

    # Fall back to Recruitee-specific patterns
    lo = (label or "").lower()
    for cat, pattern in _RECRUITEE_COMPILED:
        if pattern.search(lo):
            return cat

    # Still unknown - return custom
    return "custom"


def _recruitee_resolve_one(cat: str, ftype: str, values: list, p: Profile, label: str):
    """Resolve field value with Recruitee-specific handling.

    Uses central field_knowledge_base for standard fields, with Recruitee-specific
    handling for:
    - consent_gdpr: Default to True/Yes (user gives consent)
    - citizenship: From profile if available
    - language: From profile if available
    - contract_type: Default to "Yes" if user can do B2B
    - pronouns: From profile if available
    - motivation/strengths/etc: AI-drafted

    EEO fields (gender, race, veteran, disability) always use decline option.
    """
    # -------------------------------------------------------------------------
    # RECRUITEE-SPECIFIC CATEGORIES (not in central base)
    # -------------------------------------------------------------------------

    # Consent/GDPR - default to accepting (required to apply)
    if cat == "consent_gdpr":
        v = _match_option(values, "yes", "agree", "accept", "consent", "ja")
        return (v or "Yes", "matched")

    # Citizenship - check profile
    if cat == "citizenship":
        citizenship = getattr(p, "citizenship", None) or getattr(p, "country", None)
        if citizenship:
            return (_match_option(values, citizenship.lower()) or citizenship, "profile")
        return (None, "user_needed")

    # Language proficiency - check profile
    if cat == "language":
        lang = getattr(p, "language_proficiency", None)
        if lang:
            return (_match_option(values, lang.lower()) or lang, "profile")
        # Default to "Fluent" for English if values suggest it's about English
        if "english" in label.lower():
            v = _match_option(values, "fluent", "native", "proficient", "advanced", "c1", "c2")
            return (v, "matched") if v else (None, "user_needed")
        return (None, "user_needed")

    # Contract type (B2B) - check profile
    if cat == "contract_type":
        b2b = getattr(p, "contract_preference", None) or getattr(p, "can_b2b", None)
        if b2b is not None:
            return (_yesno(values, b2b) if values else ("Yes" if b2b else "No"), "matched")
        return (None, "user_needed")

    # Pronouns - check profile
    if cat == "pronouns":
        pronouns = getattr(p, "pronouns", None)
        if pronouns:
            return (_match_option(values, pronouns.lower()) or pronouns, "profile")
        return (None, "user_needed")

    # Photo file upload
    if cat == "photo":
        photo_url = getattr(p, "photo_url", None)
        return (photo_url, "file") if photo_url else (None, "user_needed")

    # -------------------------------------------------------------------------
    # AI-DRAFTABLE CUSTOM QUESTIONS
    # -------------------------------------------------------------------------

    # Central base categories that need AI drafting
    if cat in ("why_interested", "tell_about_yourself", "describe_project"):
        # Map to story bank fields
        story_fields = {
            "why_interested": "story_why_interested",
            "tell_about_yourself": "story_about_me",
            "describe_project": "story_project",
        }
        story_field = story_fields.get(cat)
        if story_field and getattr(p, story_field, None):
            return (getattr(p, story_field), "profile")
        # Check custom_answers fallback
        if p.custom_answers and p.custom_answers.get(cat):
            return (p.custom_answers[cat], "profile")
        return (None, "ai_needed")

    # Recruitee-specific AI-draftable questions
    if cat in ("strengths", "work_style", "achievements", "company_knowledge", "reason_leaving"):
        # Check if user has pre-drafted answer
        if p.custom_answers and p.custom_answers.get(cat):
            return (p.custom_answers[cat], "profile")
        return (None, "ai_needed")

    # Central base "motivation" maps to why_interested
    if cat == "motivation":
        if getattr(p, "story_why_interested", None):
            return (p.story_why_interested, "profile")
        if p.custom_answers and p.custom_answers.get("motivation"):
            return (p.custom_answers["motivation"], "profile")
        return (None, "ai_needed")

    # -------------------------------------------------------------------------
    # USER-INPUT-NEEDED QUESTIONS
    # -------------------------------------------------------------------------

    if cat in ("video_intro", "mentorship", "previous_employment", "ai_usage"):
        return (None, "user_needed")

    # -------------------------------------------------------------------------
    # CENTRAL KNOWLEDGE BASE CATEGORIES
    # Use lookup_field to get profile_field and resolution hints
    # -------------------------------------------------------------------------

    # Get info from central knowledge base
    if cat in FIELD_PATTERNS:
        info = FIELD_PATTERNS[cat]
        profile_field = info.get("profile_field")
        resolution = info.get("resolution", "profile")

        # EEO fields - always use decline option
        if resolution == "eeo":
            if p.eeo_decline_all:
                v = _decline_option(values)
                return (v, "eeo") if v else (None, "user_needed")
            # If not declining all, check specific EEO field
            eeo_val = getattr(p, profile_field, None) if profile_field else None
            if eeo_val:
                return (_match_option(values, eeo_val.lower()) or eeo_val, "profile")
            return (_decline_option(values), "eeo")

        # File fields
        if resolution == "file":
            val = getattr(p, profile_field, None) if profile_field else None
            return (val, "file") if val else (None, "user_needed")

        # Profile fields - direct lookup
        if resolution == "profile" and profile_field:
            val = getattr(p, profile_field, None)
            if val is not None and val != "":
                if values:
                    # Try to match against dropdown options
                    matched = _match_option(values, str(val).lower())
                    return (matched or val, "profile" if matched else "profile")
                return (val, "profile")

        # Matched fields (work_auth, sponsorship, etc.)
        if resolution == "matched" and profile_field:
            val = getattr(p, profile_field, None)
            if val is not None:
                # Boolean matching for work_auth/sponsorship
                if cat == "work_auth":
                    return (_authorized_option(values, val), "matched")
                if cat == "sponsorship":
                    # sponsorship: True means "I require sponsorship"
                    return (_yesno(values, val), "matched")
                if cat in ("relocate", "remote_preference"):
                    if isinstance(val, bool):
                        return (_yesno(values, val), "matched")
                    return (_match_option(values, str(val).lower()) or val, "matched")
                # Other matched fields
                if values:
                    matched = _match_option(values, str(val).lower())
                    return (matched or val, "matched")
                return (val, "matched")

    # Fall back to base resolver for any remaining categories
    return _base_resolve_one(cat, ftype, values, p, label)


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Fetch Recruitee offer detail and extract form fields.

    Args:
        token: company subdomain (e.g. 'stripe' for stripe.recruitee.com)
        job_id: offer ID

    Returns normalized fields: [{label, required, name, type, values}]
    """
    url = f"https://{token}.recruitee.com/api/offers/{job_id}"

    try:
        r = requests.get(url, headers=UA, timeout=20)
        r.raise_for_status()
        data = r.json()
    except requests.exceptions.HTTPError:
        url_alt = f"https://careers.{token}.com/api/offers/{job_id}"
        r = requests.get(url_alt, headers=UA, timeout=20)
        r.raise_for_status()
        data = r.json()

    offer = data.get("offer", data)

    fields = []

    fields.extend([
        {"label": "First Name", "name": "first_name", "type": "input_text", "required": True},
        {"label": "Last Name", "name": "last_name", "type": "input_text", "required": True},
        {"label": "Email", "name": "email", "type": "input_text", "required": True},
        {"label": "Phone", "name": "phone", "type": "input_text", "required": False},
        {"label": "Resume", "name": "resume", "type": "input_file", "required": True},
    ])

    options = offer.get("options", {})
    if options.get("linkedin"):
        fields.append({
            "label": "LinkedIn Profile",
            "name": "linkedin",
            "type": "input_text",
            "required": options.get("linkedin_required", False),
        })

    if options.get("photo"):
        fields.append({
            "label": "Photo",
            "name": "photo",
            "type": "input_file",
            "required": options.get("photo_required", False),
        })

    if options.get("cover_letter"):
        fields.append({
            "label": "Cover Letter",
            "name": "cover_letter",
            "type": "textarea",
            "required": options.get("cover_letter_required", False),
        })

    questions = offer.get("open_questions", []) or offer.get("questions", [])
    for q in questions:
        qtype = q.get("kind", "open").lower()
        field_type = "textarea" if qtype in ("open", "text", "long_text") else "input_text"

        if qtype in ("single_choice", "dropdown", "select"):
            field_type = "select"
        elif qtype in ("multiple_choice", "multi_select"):
            field_type = "multi_select"
        elif qtype == "boolean":
            field_type = "select"

        values = []
        for opt in q.get("options", []) or q.get("choices", []):
            if isinstance(opt, dict):
                values.append({"label": opt.get("body") or opt.get("label"), "value": opt.get("id") or opt.get("body")})
            else:
                values.append({"label": str(opt), "value": str(opt)})

        if qtype == "boolean" and not values:
            values = [{"label": "Yes", "value": "true"}, {"label": "No", "value": "false"}]

        fields.append({
            "label": q.get("body") or q.get("question", ""),
            "name": q.get("id") or f"q_{len(fields)}",
            "type": field_type,
            "required": q.get("required", False),
            "values": values,
        })

    return fields


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve Recruitee form fields from the profile.

    Uses Recruitee-specific category detection and resolution logic that:
    - Handles Recruitee-specific field variations (GDPR consent, B2B contract, etc.)
    - Falls back to base greenhouse_adapter logic for standard fields
    - Ensures EEO fields (gender, race, veteran, disability) use decline options
    - Marks AI-draftable custom questions appropriately

    Returns:
        {
            resolved: list of ResolvedField,
            ready_count: int (fields with values),
            total: int,
            ready_pct: int (0-100),
            ai_needed: list (fields needing AI draft),
            user_needed: list (required fields needing user input),
            auto_ready: bool (True if no user input needed)
        }
    """
    resolved: list[ResolvedField] = []

    for f in fields:
        label = f.get("label", "")
        name = f.get("name", "")
        ftype = f.get("type", "")
        required = bool(f.get("required"))
        values = f.get("values", [])

        # Use Recruitee-specific category detection
        cat = _recruitee_category(label, name)

        rf = ResolvedField(label=label, name=name, type=ftype, required=required, category=cat)

        # Use Recruitee-specific resolver
        val, src = _recruitee_resolve_one(cat, ftype, values, p, label)
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


def fetch_jobs(token: str) -> list[dict]:
    """Fetch all job offers for a Recruitee company.

    Returns list of {id, title, location, ...}
    """
    url = f"https://{token}.recruitee.com/api/offers"

    try:
        r = requests.get(url, headers=UA, timeout=20)
        r.raise_for_status()
        data = r.json()
        return data.get("offers", [])
    except:
        url_alt = f"https://careers.{token}.com/api/offers"
        r = requests.get(url_alt, headers=UA, timeout=20)
        r.raise_for_status()
        return r.json().get("offers", [])


if __name__ == "__main__":
    import sys

    company = sys.argv[1] if len(sys.argv) > 1 else "recruitee"

    jobs = fetch_jobs(company)
    if not jobs:
        print(f"No jobs found for {company}")
        sys.exit(1)

    jid = jobs[0].get("id") or jobs[0].get("slug")
    print(f"Fetching form for {company} job {jid}...")

    form = fetch_form(company, str(jid))
    print(f"Found {len(form)} fields")

    # Demo profile with all MASTER_PROFILE_FIELDS for comprehensive testing
    demo = Profile(
        # Required
        first_name="Alex",
        last_name="Doe",
        email="alex@example.com",
        phone="+1 555 123 4567",
        resume_url="resume.pdf",
        linkedin_url="https://linkedin.com/in/alexdoe",
        work_authorized=True,
        require_sponsorship=False,
        location="San Francisco, CA",
        # Recommended
        github_url="https://github.com/alexdoe",
        years_experience="2",
        education="Bachelor's",
        graduation_year="2024",
        major="Computer Science",
        willing_to_relocate=True,
        start_date="Immediately",
        # Optional
        portfolio_url="https://alexdoe.dev",
        address="123 Main St",
        city="San Francisco",
        state="CA",
        zip_code="94102",
        country="United States",
        salary_expectation="$80,000-100,000",
        gpa="3.8",
        remote_preference="Hybrid",
        referral_name="",
        # Story bank
        story_why_interested="I'm passionate about building impactful products...",
        story_about_me="Software engineer with 2 years of experience...",
        resume_text="Alex Doe - Software Engineer...",
        # EEO
        eeo_decline_all=True,
        # Recruitee-specific
        citizenship="United States",
        language_proficiency="Fluent",
    )

    res = resolve(form, demo)
    print(f"\n{company}: {res['ready_pct']}% ready ({res['ready_count']}/{res['total']})")
    for r in res["resolved"]:
        print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:34]}")
