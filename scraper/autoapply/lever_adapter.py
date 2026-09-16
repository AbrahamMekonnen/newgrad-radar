"""Deterministic Lever application adapter.

Lever has no form API, so we parse the public apply page: standard fields
(name/email/phone/resume/urls[...]) plus custom questions (`cards[uuid][...]`)
whose labels sit next to them in the DOM. Resolves each field from the profile
using the SAME category->profile logic as the Greenhouse adapter, so behaviour
is consistent across ATSes.

Field Pattern Analysis (100 Lever jobs sampled):
==================================================
Standard Fields (100% present):
  - Full name: "Full name", "full name", "Name", "Legal name"
  - Email: "Email", "email", "Email address"
  - Phone: "Phone", "phone", "Phone number", "Mobile"
  - Resume: "Resume/CV", "resume/cv", "Resume", "CV"
  - Current company: "Current company", "current company", "Current employer", "Company"

URL Fields (high frequency):
  - LinkedIn (96%): "LinkedIn URL", "linkedin", "LinkedIn", "LinkedIn Profile"
  - GitHub (75%): "GitHub URL", "github", "GitHub", "Github profile"
  - Portfolio (71%): "Portfolio URL", "portfolio", "Portfolio", "Personal website", "Website"
  - Other URL (73%): "Other URL", "other", "Other website", "Additional URL"
  - Twitter (39%): "Twitter URL", "twitter", "Twitter", "X profile"

Custom Questions (common patterns):
  - Work authorization (18%): varied phrasing per country
  - Sponsorship (19%): "Will you now or in the future require sponsorship..."
  - Security clearance (20%): common for gov/defense roles
  - Pronouns (16%): "What are your pronouns?"
  - EEO disability (8%): auto-decline

AI-Needed Questions (custom free-text):
  - "Why do you want to work at [company]?" (20%)
  - "What has been your favorite project?" (20%)
  - "Tell us about yourself" (11%)
  - Cover letter requests (4%)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from greenhouse_adapter import (  # noqa: E402
    Profile, ResolvedField, _resolve_one,
    _match_option, _decline_option, _yesno, _authorized_option
)
from field_knowledge_base import lookup_field, FIELD_PATTERNS  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)"}

# =============================================================================
# STANDARD FIELD MAPPINGS
# =============================================================================
# Maps Lever form field names to display labels for standard fields.
# These are the built-in Lever fields (not custom questions).
_STD = {
    "name": "Full name",
    "email": "Email",
    "phone": "Phone",
    "org": "Current company",
    "resume": "Resume/CV",
    "comments": "Additional information",
}

# =============================================================================
# LEVER-SPECIFIC CATEGORY PATTERNS (supplementary)
# =============================================================================
# Additional Lever-specific patterns not in the central knowledge base.
# These handle Lever-unique question types and phrasings.

_LEVER_EXTRA_PATTERNS = [
    # --- Lever-specific patterns not in central knowledge base ---
    ("pronouns", r"\b(pronouns?|gender\s*pronouns?|which\s*pronouns|your\s*pronouns)\b"),
    ("us_based", r"\b(based\s*in\s*(the\s*)?(united\s*states|us|usa)|"
                 r"resident\s*of\s*(california|new\s*york|texas)|"
                 r"located\s*in\s*(the\s*)?(us|usa))\b"),
    ("timezone", r"\b(time\s*zone|timezone|which.*time\s*zone)\b"),
    ("eeo_demographic", r"\b(underrepresented\s*group|demographic|diversity)\b"),
    ("previous_employment", r"\b(previously\s*employed|worked.*before|"
                            r"former\s*employee|have\s*you\s*ever\s*been.*employed)\b"),
    ("consent", r"\b(consent|agree|acknowledge|share\s*(my)?\s*resume|"
                r"ai\s*notetaker|transcription)\b"),
    ("accessibility", r"\b(accessibility|accommodation|special\s*needs)\b"),
    ("age_verification", r"\b(18\s*(years|or\s*older|\+)|age\s*verification|"
                         r"legal\s*age)\b"),
    ("language_skills", r"\b(language\s*skill|speak.*language|fluent|"
                        r"proficiency\s*in|language.*check\s*all)\b"),
    ("motivation", r"\b(why.*want.*work|why.*interested|why\s*(us|this\s*(company|role)))\b"),
    ("experience_question", r"\b(favorite\s*project|proudest\s*(accomplishment|achievement)|"
                            r"challenging.*problem|technical\s*problem\s*you\s*solved)\b"),
    ("about_me", r"\b(tell\s*us\s*about\s*yourself|about\s*yourself|"
                 r"anything.*like\s*(us\s*)?(to\s*)?know)\b"),
    ("name_pronunciation", r"\b(pronounce\s*(your)?\s*name|name\s*pronunciation)\b"),
    ("security_clearance", r"\b(security\s*clearance|clearance\s*(level|status)|"
                           r"hold\s*(an?\s*)?(active\s*)?(us|uk)?\s*clearance|"
                           r"eligible.*clearance)\b"),
]

# Compile extra patterns for efficient matching
_COMPILED_EXTRA_PATTERNS = [(cat, re.compile(pat, re.IGNORECASE)) for cat, pat in _LEVER_EXTRA_PATTERNS]


def _lever_category(label: str, field_name: str = "") -> str:
    """Detect field category from label using central knowledge base.

    Uses the field_knowledge_base for comprehensive matching, with
    Lever-specific handling for:
    - URL fields (urls[key] format)
    - Lever-unique question types not in the central knowledge base

    Args:
        label: The field label text
        field_name: Optional field name (e.g., "urls[linkedin]")

    Returns:
        Category string for use with _resolve_one()
    """
    lo = (label or "").lower().strip()
    fn_lo = (field_name or "").lower()

    # Handle Lever's urls[key] format directly
    if fn_lo.startswith("urls["):
        key = fn_lo.replace("urls[", "").replace("]", "").lower()
        if "linkedin" in key:
            return "linkedin"
        if "github" in key:
            return "github"
        if "portfolio" in key or "website" in key:
            return "portfolio"
        if "twitter" in key or key == "x":
            return "twitter"
        if "other" in key:
            return "other_link"  # Maps to other_link in knowledge base
        # Unknown URL field - fall through to knowledge base

    # Check Lever-specific extra patterns first (not in central KB)
    for cat, pattern in _COMPILED_EXTRA_PATTERNS:
        if pattern.search(lo):
            return cat

    # Use central knowledge base for standard categories
    category, profile_field, resolution = lookup_field(label, field_name)
    return category


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Return [{label, name, type, values}] parsed from the Lever apply page.

    Lever form structure:
    - Standard fields: name, email, phone, org (company), resume, comments
    - URL fields: urls[LinkedIn], urls[GitHub], etc.
    - Custom questions: cards[uuid][field_idx] with labels in adjacent elements

    Returns:
        List of field dicts: {label, name, type, values}
    """
    html = requests.get(f"https://jobs.lever.co/{token}/{job_id}/apply", headers=UA, timeout=25).text
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return _regex_fallback(html)
    soup = BeautifulSoup(html, "html.parser")
    fields, seen = [], set()

    # Standard fields (name, email, phone, org, resume, comments)
    for inp in soup.select("input[name], textarea[name], select[name]"):
        name = inp.get("name", "")
        if not name or name in seen:
            continue
        if name in _STD:
            seen.add(name)
            fields.append({"label": _STD[name], "name": name,
                           "type": "textarea" if name == "comments" else "input", "values": []})
        # URL fields: urls[LinkedIn], urls[GitHub], urls[Portfolio], urls[Other], urls[Twitter]
        elif name.startswith("urls["):
            seen.add(name)
            key = re.search(r"urls\[([^\]]+)\]", name)
            # Normalize label for consistent category detection
            raw_label = key.group(1) if key else name
            # Map common URL field labels to standard categories
            label = raw_label
            fields.append({"label": label, "name": name, "type": "input", "values": []})

    # Custom questions: each application-question block has a label + card inputs
    # Selectors cover various Lever page layouts
    for block in soup.select(".application-question, .application-additional li, [class*='custom-question']"):
        label_el = block.select_one(".application-label, label, .text")
        label = (label_el.get_text(" ", strip=True) if label_el else "").strip()
        card = block.select_one("[name^='cards[']")
        if not label or not card:
            continue
        name = card.get("name", "")
        if name in seen:
            continue
        seen.add(name)
        tag = card.name  # input/textarea/select
        values = [{"label": o.get_text(strip=True), "value": o.get("value", "")}
                  for o in block.select("option")] if tag == "select" else []
        ftype = "textarea" if tag == "textarea" else ("select" if tag == "select" else "input")
        fields.append({"label": label[:120], "name": name, "type": ftype, "values": values})
    return fields


def _regex_fallback(html: str) -> list[dict]:
    """Fallback parser when BeautifulSoup is unavailable."""
    out, seen = [], set()
    for name in re.findall(r'name="([^"]+)"', html):
        if name in seen:
            continue
        seen.add(name)
        if name in _STD:
            out.append({"label": _STD[name], "name": name, "type": "input", "values": []})
        elif name.startswith("urls["):
            key = re.search(r"urls\[([^\]]+)\]", name)
            label = key.group(1) if key else name
            out.append({"label": label, "name": name, "type": "input", "values": []})
    return out


def _lever_resolve_one(cat: str, ftype: str, values: list[dict], p: Profile, label: str) -> tuple:
    """Resolve a single field value for Lever-specific categories.

    Extends _resolve_one() from greenhouse_adapter with Lever-specific handling:
    - Previous employment: defaults to "No"
    - Consent questions: defaults to "Yes"
    - Accessibility: defaults to blank or "No"
    - Age verification: defaults to "Yes" (18+)
    - Security clearance: requires user input unless profile has it
    - Pronouns: requires user input
    - US-based location: matches based on profile location
    - EEO demographic questions: auto-decline

    Args:
        cat: Category from _lever_category()
        ftype: Field type (input, select, textarea)
        values: Select options if any
        p: User profile
        label: Field label for context

    Returns:
        (value, source) tuple
    """
    # Lever-specific categories not in greenhouse_adapter

    # Previous employment (10%): default to No
    if cat == "previous_employment":
        v = _match_option(values, "no")
        return (v, "matched") if v else ("No", "matched")

    # Consent questions (8%): default to Yes (agree to share info, AI notetaker, etc.)
    if cat == "consent":
        v = _match_option(values, "yes", "agree", "consent")
        return (v, "matched") if v else ("Yes", "matched")

    # Accessibility accommodations (4%): leave blank or No
    if cat == "accessibility":
        v = _match_option(values, "no", "none", "not at this time")
        return (v, "matched") if v else (None, "matched")

    # Age verification (2%): default to Yes (18+)
    if cat == "age_verification":
        v = _match_option(values, "yes")
        return (v, "matched") if v else ("Yes", "matched")

    # EEO demographic questions: auto-decline
    if cat == "eeo_demographic":
        return (_decline_option(values), "eeo")

    # Security clearance (20%): check profile, else user_needed
    if cat == "security_clearance":
        # If profile has security_clearance field (optional)
        if hasattr(p, "security_clearance") and p.security_clearance is not None:
            v = _yesno(values, p.security_clearance) if values else ("Yes" if p.security_clearance else "No")
            return (v, "matched") if v else (None, "user_needed")
        return (None, "user_needed")

    # Pronouns (16%): user-specific, requires input
    if cat == "pronouns":
        if hasattr(p, "pronouns") and p.pronouns:
            v = _match_option(values, p.pronouns.lower()) if values else p.pronouns
            return (v, "matched") if v else (p.pronouns, "profile")
        return (None, "user_needed")

    # Name pronunciation (10%): user-specific
    if cat == "name_pronunciation":
        if hasattr(p, "name_pronunciation") and p.name_pronunciation:
            return (p.name_pronunciation, "profile")
        return (None, "user_needed")

    # Preferred name (10%): profile field
    if cat == "preferred_name":
        if hasattr(p, "preferred_name") and p.preferred_name:
            return (p.preferred_name, "profile")
        # Fall back to first name
        return (p.first_name, "profile") if p.first_name else (None, "unfilled")

    # US-based location (6%): infer from profile location
    if cat == "us_based":
        loc = (getattr(p, "location", "") or "").lower()
        is_us = any(x in loc for x in ["us", "usa", "united states", "california", "new york",
                                        "texas", "washington", "colorado", "massachusetts"])
        v = _yesno(values, is_us) if values else ("Yes" if is_us else "No")
        return (v, "matched") if v else (None, "user_needed")

    # Timezone (6%): infer from profile location or user_needed
    if cat == "timezone":
        if hasattr(p, "timezone") and p.timezone:
            v = _match_option(values, p.timezone.lower()) if values else p.timezone
            return (v, "matched") if v else (None, "user_needed")
        return (None, "user_needed")

    # Language skills (10%): multi-select, requires profile languages array
    if cat == "language_skills":
        if hasattr(p, "languages") and p.languages:
            # For multi-select, return list of matched values
            matched = []
            for lang in p.languages:
                v = _match_option(values, lang.lower())
                if v:
                    matched.append(v)
            return (matched, "matched") if matched else (None, "user_needed")
        return (None, "user_needed")

    # Citizenship (2%): requires user input
    if cat == "citizenship":
        if hasattr(p, "citizenship") and p.citizenship:
            v = _match_option(values, p.citizenship.lower()) if values else p.citizenship
            return (v, "matched") if v else (None, "user_needed")
        return (None, "user_needed")

    # Twitter URL (39%): profile field
    if cat == "twitter":
        if hasattr(p, "twitter_url") and p.twitter_url:
            return (p.twitter_url, "profile")
        return (None, "unfilled")  # Optional field

    # Other Link (73%): profile field - uses other_links from Profile
    if cat == "other_link":
        if hasattr(p, "other_links") and p.other_links:
            # other_links can be a list or a single string
            val = p.other_links[0] if isinstance(p.other_links, list) else p.other_links
            return (val, "profile")
        return (None, "unfilled")  # Optional field

    # Current company (100%): profile field
    if cat == "current_company":
        if hasattr(p, "current_company") and p.current_company:
            return (p.current_company, "profile")
        return (None, "unfilled")  # Many applicants are students/unemployed

    # Current title: profile field
    if cat == "current_title":
        if hasattr(p, "current_title") and p.current_title:
            return (p.current_title, "profile")
        return (None, "unfilled")

    # AI-needed custom questions (motivation, experience, about_me)
    if cat in ("motivation", "experience_question", "about_me"):
        # Check custom_answers first
        if label and hasattr(p, "custom_answers") and p.custom_answers.get(label):
            return (p.custom_answers[label], "profile")
        return (None, "ai_needed")

    # Fall back to greenhouse_adapter logic for standard categories
    return _resolve_one(cat, ftype, values, p, label)


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve all form fields from the user profile.

    Processes each field through category detection and value resolution:
    1. Detect category using _lever_category() (Lever-specific patterns)
    2. Resolve value using _lever_resolve_one() (extends greenhouse logic)
    3. Track resolution status for UI display

    Args:
        fields: List of field dicts from fetch_form()
        p: User profile with contact info, work auth, etc.

    Returns:
        Dict with:
        - resolved: List of ResolvedField objects
        - ready_count: Fields that can be auto-filled
        - total: Total field count
        - ready_pct: Percentage ready (0-100)
        - ai_needed: Fields requiring AI drafting
        - user_needed: Required fields needing user input
        - auto_ready: True if no blocking user input needed
    """
    resolved = []
    for f in fields:
        label, name = f["label"], f["name"]
        ftype, values = f.get("type", ""), f.get("values", [])
        # Lever marks few as hard-required (name, email usually)
        required = name in ("name", "email")
        # Use Lever-specific category detection
        cat = _lever_category(label, name)
        # Use Lever-specific resolution (extends greenhouse logic)
        val, src = _lever_resolve_one(cat, ftype, values, p, label)
        resolved.append(ResolvedField(
            label=label, name=name, type=ftype, required=required,
            category=cat, value=val, source=src, values=values or []
        ))

    filled = [r for r in resolved if r.source in ("profile", "matched", "eeo", "file")]
    total = len(resolved) or 1
    return {
        "resolved": resolved,
        "ready_count": len(filled),
        "total": len(resolved),
        "ready_pct": round(100 * len(filled) / total),
        "ai_needed": [r for r in resolved if r.source == "ai_needed"],
        "user_needed": [r for r in resolved if r.source == "user_needed" and r.required],
        "auto_ready": all(r.source != "user_needed" or not r.required for r in resolved),
    }


# =============================================================================
# CATEGORY SUMMARY
# =============================================================================
# Categories handled by this adapter (based on 100 Lever jobs analyzed):
#
# STANDARD (100% frequency):
#   full_name, email, phone, resume, current_company
#
# URLS (71-96%):
#   linkedin (96%), github (75%), portfolio (71%), other_url (73%), twitter (39%)
#
# WORK AUTHORIZATION (18-19%):
#   work_auth, sponsorship
#
# SECURITY/CLEARANCE (20%):
#   security_clearance
#
# LOCATION (6-10%):
#   location, us_based, timezone, relocate
#
# EEO (8-16%, auto-decline):
#   gender, race, veteran, disability, eeo_demographic
#
# PERSONAL (10-16%):
#   pronouns, preferred_name, name_pronunciation
#
# EXPERIENCE/EDUCATION (7-14%):
#   experience, education, graduation_year
#
# DEFAULTS (4-10%):
#   previous_employment -> No
#   consent -> Yes
#   accessibility -> blank/No
#   age_verification -> Yes
#
# AI-NEEDED (11-20%):
#   motivation, experience_question, about_me, cover_letter


if __name__ == "__main__":
    token = sys.argv[1] if len(sys.argv) > 1 else "palantir"
    jobs = requests.get(f"https://api.lever.co/v0/postings/{token}?mode=json", headers=UA, timeout=20).json()
    jid = jobs[0]["id"]
    # Demo profile with common fields
    demo = Profile(
        first_name="Alex",
        last_name="Doe",
        email="alex@example.com",
        phone="+15551234567",
        location="San Francisco, CA",
        linkedin_url="https://linkedin.com/in/alexdoe",
        github_url="https://github.com/alexdoe",
        portfolio_url="https://alexdoe.dev",
        resume_url="resume.pdf",
        work_authorized=True,
        require_sponsorship=False,
        years_experience="1-2",
        start_date="Immediately",
        willing_to_relocate=True,
        how_heard="Company website",
    )
    res = resolve(fetch_form(token, jid), demo)
    print(f"\n{token} job {jid}:")
    print(f"  Ready: {res['ready_pct']}% ({res['ready_count']}/{res['total']} fields)")
    print(f"  AI needed: {len(res['ai_needed'])} fields")
    print(f"  User needed: {len(res['user_needed'])} fields")
    print(f"  Auto-ready: {res['auto_ready']}")
    print("\nField breakdown:")
    for r in res["resolved"]:
        val_str = str(r.value)[:35] if r.value else "(empty)"
        print(f"  [{r.source:11}] {r.category:20} {r.label[:35]:35} -> {val_str}")
