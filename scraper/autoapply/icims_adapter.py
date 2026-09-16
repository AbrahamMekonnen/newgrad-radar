"""Deterministic iCIMS application adapter.

iCIMS is a legacy ATS with higher automation difficulty (4/5) due to:
- Heavy use of iframes
- Session cookies required
- Multi-page forms
- Login often required
- CAPTCHA common

URL patterns:
  - https://careers-{company}.icims.com/jobs/{job_id}/job
  - https://careers.{company}.com/jobs/{job_id}/job (subdomain variant)
  - https://{company}.icims.com/jobs/{job_id}/job

Field Patterns from 100-job iCIMS Analysis (September 2026):
============================================================
REQUIRED FIELDS (95%+ frequency):
  - first_name, last_name, email (100%)
  - phone (99%)
  - resume (98%)

HIGH FREQUENCY (75-95%):
  - work_auth (80%): "Are you legally authorized to work in the United States?"
  - city (84%), address (83%), state (82%), zip (79%)
  - sponsorship (76%): "Will you now or in the future require sponsorship?"
  - agreement_checkbox (76%): Terms/Privacy consent -> auto-check True
  - country (75%)

MEDIUM FREQUENCY (50-75%):
  - source (72%): "How did you hear about us?"
  - gender (68%), race (66%), linkedin (65%)
  - veteran (64%), disability (62%)
  - education (58%), experience (56%), cover_letter (55%)

LOWER FREQUENCY (<50%):
  - start_date (45%), salary (40%)
  - relocate (37%), age_verification (36%), travel (36%)
  - referral (28%), background_check (28%)
  - previous_employment (26%), certifications (24%)
  - transportation (22%), criminal_history (20%)
  - schedule_flexibility (17%), drivers_license (12%)

RESOLUTION STRATEGIES:
  - EEO fields (gender, race, veteran, disability) -> "Decline to answer"
  - Work auth/sponsorship -> profile values with intelligent option matching
  - Agreement checkboxes -> auto-check True
  - Age verification -> auto-yes (assume 18+)
  - Custom questions -> AI drafting or user input
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Optional

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from greenhouse_adapter import Profile, ResolvedField, _resolve_one  # noqa: E402
from field_knowledge_base import lookup_field, FIELD_PATTERNS  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

# =============================================================================
# iCIMS FIELD NAME -> LABEL MAPPINGS
# Comprehensive mappings based on 100-job analysis
# =============================================================================

_STD = {
    # -------------------------------------------------------------------------
    # IDENTITY (100% frequency)
    # -------------------------------------------------------------------------
    "firstName": "First Name",
    "first_name": "First Name",
    "First Name": "First Name",
    "legalFirstName": "First Name",
    "Legal First Name": "First Name",
    "lastName": "Last Name",
    "last_name": "Last Name",
    "Last Name": "Last Name",
    "legalLastName": "Last Name",
    "Legal Last Name": "Last Name",

    # -------------------------------------------------------------------------
    # CONTACT (99-100% frequency)
    # -------------------------------------------------------------------------
    "email": "Email",
    "emailAddress": "Email",
    "Email": "Email",
    "Email Address": "Email",
    "E-mail": "Email",
    "phone": "Phone",
    "phoneNumber": "Phone",
    "Phone": "Phone",
    "Phone Number": "Phone",
    "mobilePhone": "Phone",
    "Mobile": "Phone",
    "Cell Phone": "Phone",
    "cellPhone": "Phone",

    # -------------------------------------------------------------------------
    # DOCUMENTS (55-98% frequency)
    # -------------------------------------------------------------------------
    "resume": "Resume",
    "Resume": "Resume",
    "resumeFile": "Resume",
    "Resume/CV": "Resume",
    "Upload Resume": "Resume",
    "coverLetter": "Cover Letter",
    "Cover Letter": "Cover Letter",
    "coverLetterFile": "Cover Letter",
    "Covering Letter": "Cover Letter",

    # -------------------------------------------------------------------------
    # LINKS (65% frequency)
    # -------------------------------------------------------------------------
    "linkedin": "LinkedIn",
    "linkedIn": "LinkedIn",
    "LinkedIn": "LinkedIn",
    "linkedInUrl": "LinkedIn",
    "linkedin_url": "LinkedIn",
    "linkedinProfile": "LinkedIn",
    "LinkedIn Profile": "LinkedIn",
    "LinkedIn URL": "LinkedIn",

    # -------------------------------------------------------------------------
    # LOCATION (75-84% frequency)
    # -------------------------------------------------------------------------
    "address": "Address",
    "Address": "Address",
    "streetAddress": "Address",
    "Street Address": "Address",
    "Address Line 1": "Address",
    "Mailing Address": "Address",
    "city": "City",
    "City": "City",
    "City Name": "City",
    "Town": "City",
    "state": "State",
    "State": "State",
    "State/Province": "State",
    "Province": "State",
    "Region": "State",
    "zipCode": "Zip Code",
    "zip_code": "Zip Code",
    "Zip Code": "Zip Code",
    "Postal Code": "Zip Code",
    "Postcode": "Zip Code",
    "country": "Country",
    "Country": "Country",
    "Country/Region": "Country",
    "Country of Residence": "Country",

    # -------------------------------------------------------------------------
    # WORK AUTHORIZATION (80% frequency)
    # Label variations discovered in iCIMS forms
    # -------------------------------------------------------------------------
    "workAuthorization": "Work Authorization",
    "workAuth": "Work Authorization",
    "Work Authorization Status": "Work Authorization",
    "authorizedToWork": "Work Authorization",
    "Employment Eligibility": "Work Authorization",
    "US Work Authorization": "Work Authorization",

    # -------------------------------------------------------------------------
    # VISA SPONSORSHIP (76% frequency)
    # -------------------------------------------------------------------------
    "visaSponsorship": "Visa Sponsorship",
    "Visa Sponsorship Required": "Visa Sponsorship",
    "sponsorship": "Visa Sponsorship",
    "requireSponsorship": "Visa Sponsorship",
    "Sponsorship Requirement": "Visa Sponsorship",

    # -------------------------------------------------------------------------
    # COMPENSATION & AVAILABILITY (40-45% frequency)
    # -------------------------------------------------------------------------
    "salary": "Desired Salary",
    "desiredSalary": "Desired Salary",
    "Desired Salary": "Desired Salary",
    "Salary Expectation": "Desired Salary",
    "Expected Compensation": "Desired Salary",
    "startDate": "Start Date",
    "Start Date": "Start Date",
    "availability": "Start Date",
    "Availability": "Start Date",
    "Earliest Start Date": "Start Date",

    # -------------------------------------------------------------------------
    # SOURCE/REFERRAL (28-72% frequency)
    # -------------------------------------------------------------------------
    "howDidYouHear": "How did you hear?",
    "how_did_you_hear": "How did you hear?",
    "source": "How did you hear?",
    "Referral Source": "How did you hear?",
    "Job Source": "How did you hear?",
    "referralName": "Referral Name",
    "referral_name": "Referral Name",
    "Referred by": "Referral Name",
    "Employee Referral Name": "Referral Name",
    "Who referred you?": "Referral Name",

    # -------------------------------------------------------------------------
    # EDUCATION & EXPERIENCE (56-58% frequency)
    # -------------------------------------------------------------------------
    "education": "Education",
    "education_school": "Education",
    "education_degree": "Education",
    "School": "Education",
    "University": "Education",
    "College": "Education",
    "Degree": "Education",
    "yearsExperience": "Years of Experience",
    "years_experience": "Years of Experience",
    "years_of_experience": "Years of Experience",

    # -------------------------------------------------------------------------
    # EEO FIELDS (62-68% frequency) - Default to "Decline"
    # -------------------------------------------------------------------------
    "gender": "Gender",
    "Gender": "Gender",
    "Gender (Voluntary)": "Gender",
    "Gender Identity": "Gender",
    "race": "Race/Ethnicity",
    "race_ethnicity": "Race/Ethnicity",
    "Race/Ethnicity": "Race/Ethnicity",
    "Ethnicity": "Race/Ethnicity",
    "veteran": "Veteran Status",
    "veteranStatus": "Veteran Status",
    "Veteran Status": "Veteran Status",
    "Veteran Status (Voluntary)": "Veteran Status",
    "disability": "Disability Status",
    "disabilityStatus": "Disability Status",
    "Disability Status": "Disability Status",
    "Disability Status (Voluntary)": "Disability Status",
}


# =============================================================================
# iCIMS-SPECIFIC CATEGORY PATTERNS
# Only patterns for categories NOT in the central field_knowledge_base
# Standard categories (work_auth, sponsorship, EEO, etc.) are handled by lookup_field()
# =============================================================================

_ICIMS_SPECIFIC_PATTERNS = [
    # Agreement/Consent (76% frequency) - auto-check True
    ("agreement_checkbox", r"i agree to"),
    ("agreement_checkbox", r"terms and conditions"),
    ("agreement_checkbox", r"privacy policy"),
    ("agreement_checkbox", r"consent to"),
    ("agreement_checkbox", r"i have read and"),
    ("agreement_checkbox", r"acknowledge"),
    ("agreement_checkbox", r"i certify"),

    # Age Verification (36% frequency) - auto-yes
    ("age_verification", r"18 years.*age"),
    ("age_verification", r"at least 18"),
    ("age_verification", r"age verification"),
    ("age_verification", r"are you over 18"),
    ("age_verification", r"are you 18"),

    # Background Check (28% frequency) - typically auto-yes
    ("background_check", r"background check"),
    ("background_check", r"pass.*background"),
    ("background_check", r"background verification"),
    ("background_check", r"consent to.*background"),

    # Previous Employment (26% frequency) - auto-no
    ("previous_employment", r"(ever )?(been )?employed (by|at) this company"),
    ("previous_employment", r"worked (for|at) this company before"),
    ("previous_employment", r"previously employed"),
    ("previous_employment", r"former employee"),
    ("previous_employment", r"have you ever worked"),

    # Travel (36% frequency)
    ("travel", r"willing to travel"),
    ("travel", r"travel.*require"),
    ("travel", r"travel percentage"),

    # Transportation (22% frequency)
    ("transportation", r"reliable transportation"),
    ("transportation", r"do you have.*transportation"),
    ("transportation", r"own transportation"),

    # Criminal History (20% frequency) - user_needed (sensitive)
    ("criminal_history", r"convicted.*felony"),
    ("criminal_history", r"criminal (history|background|record)"),
    ("criminal_history", r"have you been convicted"),

    # Schedule Flexibility (17% frequency)
    ("schedule_flexibility", r"overtime"),
    ("schedule_flexibility", r"weekends"),
    ("schedule_flexibility", r"flexible schedule"),
    ("schedule_flexibility", r"required schedule"),
    ("schedule_flexibility", r"shift"),

    # Driver's License (12% frequency)
    ("drivers_license", r"driver.?s? license"),
    ("drivers_license", r"valid driver"),
    ("drivers_license", r"driving license"),

    # Certifications (24% frequency)
    ("certifications", r"certification"),
    ("certifications", r"licenses?"),

    # Career Goals (16% frequency) - AI drafts
    ("career_goals", r"career goals"),
    ("career_goals", r"where do you see yourself"),
]

# Compile patterns for faster matching
_ICIMS_COMPILED = [(cat, re.compile(pat, re.IGNORECASE)) for cat, pat in _ICIMS_SPECIFIC_PATTERNS]


def _icims_category(label: str, field_name: str = "") -> str:
    """Detect category using central field_knowledge_base + iCIMS-specific patterns.

    Strategy:
    1. First try iCIMS-specific patterns (agreement_checkbox, age_verification, etc.)
       These are NOT in the central knowledge base.
    2. Then use lookup_field() for standard categories (work_auth, sponsorship, etc.)
    3. Returns "custom" if nothing matches

    Returns:
        Category string (e.g., "first_name", "work_auth", "agreement_checkbox")
    """
    lo = (label or "").lower()

    # 1. Try iCIMS-specific patterns first (categories NOT in central knowledge base)
    for cat, pattern in _ICIMS_COMPILED:
        if pattern.search(lo):
            return cat

    # 2. Use central field_knowledge_base for standard categories
    category, _profile_field, _resolution = lookup_field(label, field_name)
    return category


def _icims_resolve_one(cat: str, ftype: str, values: list, p: Profile, label: str):
    """Resolve a field value with iCIMS-specific handling.

    Extends greenhouse_adapter._resolve_one with additional categories:
    - agreement_checkbox: auto-check True
    - age_verification: auto-yes
    - background_check: auto-yes (assume can pass)
    - previous_employment: auto-no
    - travel: profile-based or matched
    - transportation, drivers_license, schedule_flexibility: matched
    - certifications: profile
    - criminal_history: user_needed (sensitive)
    - career_goals: ai_needed
    """
    # Use option matching helpers from central knowledge base
    from field_knowledge_base import yesno_option, decline_option

    # Alias for compatibility
    _yesno = yesno_option

    # Handle iCIMS-specific categories
    if cat == "agreement_checkbox":
        # Auto-check agreement/consent boxes (76% frequency)
        return (True, "auto_check")

    if cat == "age_verification":
        # Auto-yes for age verification (36% frequency)
        v = _yesno(values, True) if values else "Yes"
        return (v, "auto_yes")

    if cat == "background_check":
        # Auto-yes for background check consent (28% frequency)
        v = _yesno(values, True) if values else "Yes"
        return (v, "auto_yes")

    if cat == "previous_employment":
        # Auto-no for "have you worked here before" (26% frequency)
        v = _yesno(values, False) if values else "No"
        return (v, "matched")

    if cat == "travel":
        # Check if profile has travel preference
        if hasattr(p, 'willing_to_travel') and p.willing_to_travel is not None:
            v = _yesno(values, p.willing_to_travel) if values else ("Yes" if p.willing_to_travel else "No")
            return (v, "matched")
        # No preference set - needs user input
        return (None, "user_needed")

    if cat == "transportation":
        # Reliable transportation question (22% frequency)
        if hasattr(p, 'has_reliable_transportation') and p.has_reliable_transportation is not None:
            v = _yesno(values, p.has_reliable_transportation) if values else ("Yes" if p.has_reliable_transportation else "No")
            return (v, "matched")
        return (None, "user_needed")

    if cat == "drivers_license":
        # Driver's license question (12% frequency)
        if hasattr(p, 'has_drivers_license') and p.has_drivers_license is not None:
            v = _yesno(values, p.has_drivers_license) if values else ("Yes" if p.has_drivers_license else "No")
            return (v, "matched")
        return (None, "user_needed")

    if cat == "schedule_flexibility":
        # Overtime/weekends flexibility (17% frequency)
        if hasattr(p, 'flexible_schedule') and p.flexible_schedule is not None:
            v = _yesno(values, p.flexible_schedule) if values else ("Yes" if p.flexible_schedule else "No")
            return (v, "matched")
        return (None, "user_needed")

    if cat == "certifications":
        # Certifications (24% frequency)
        if hasattr(p, 'certifications') and p.certifications:
            return (p.certifications, "profile")
        return (None, "ai_needed")  # AI can extract from resume

    if cat == "criminal_history":
        # Sensitive - always require user input (20% frequency)
        return (None, "user_needed")

    if cat == "career_goals":
        # AI drafts (16% frequency)
        return (None, "ai_needed")

    # Fall back to shared resolution
    return _resolve_one(cat, ftype, values, p, label)


def _job_url(token: str, job_id: str) -> str:
    """Construct the iCIMS job page URL."""
    # Try the careers-{company} pattern first
    return f"https://careers-{token}.icims.com/jobs/{job_id}/job"


def _apply_url(token: str, job_id: str) -> str:
    """Construct the iCIMS apply page URL."""
    return f"https://careers-{token}.icims.com/jobs/{job_id}/login"


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Return [{label, name, type, values, required}] parsed from iCIMS apply page.

    iCIMS forms can be complex with multiple pages. This fetches the initial
    application page and extracts visible form fields.
    """
    # Try different URL patterns
    urls = [
        f"https://careers-{token}.icims.com/jobs/{job_id}/job",
        f"https://careers.{token}.com/jobs/{job_id}/job",
        f"https://{token}.icims.com/jobs/{job_id}/job",
    ]

    html = None
    for url in urls:
        try:
            resp = requests.get(url, headers=UA, timeout=25)
            if resp.status_code == 200:
                html = resp.text
                break
        except Exception:
            continue

    if not html:
        raise ValueError(f"Could not fetch iCIMS form for {token}/{job_id}")

    try:
        from bs4 import BeautifulSoup
        return _parse_with_bs4(html)
    except ImportError:
        return _regex_fallback(html)


def _parse_with_bs4(html: str) -> list[dict]:
    """Parse form fields using BeautifulSoup."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    fields, seen = [], set()

    # iCIMS uses #icims_content as main container
    containers = soup.select("#icims_content, .iCIMS_MainWrapper, .iCIMS_JobContent, form")

    for container in containers:
        for inp in container.select("input[name], textarea[name], select[name]"):
            name = inp.get("name", "")
            if not name or name in seen or name.startswith("_") or name.startswith("__"):
                continue
            seen.add(name)

            # Determine field type
            input_type = inp.get("type", "text")
            tag = inp.name
            if tag == "textarea":
                ftype = "textarea"
            elif tag == "select":
                ftype = "select"
            elif input_type == "file":
                ftype = "file"
            elif input_type == "hidden":
                continue  # Skip hidden fields
            else:
                ftype = "input"

            # Get label
            label = _STD.get(name, "")
            if not label:
                # Look for associated label
                field_id = inp.get("id", "")
                if field_id:
                    label_el = soup.select_one(f'label[for="{field_id}"]')
                    if label_el:
                        label = label_el.get_text(" ", strip=True)
                if not label:
                    # Try parent label
                    parent_label = inp.find_parent("label")
                    if parent_label:
                        label = parent_label.get_text(" ", strip=True)
                if not label:
                    label = _name_to_label(name)

            # Check if required
            required = (
                inp.has_attr("required") or
                "required" in inp.get("class", []) or
                inp.get("aria-required") == "true"
            )

            # Get select options
            values = []
            if tag == "select":
                values = [{"label": o.get_text(strip=True), "value": o.get("value", "")}
                          for o in inp.select("option") if o.get("value")]

            fields.append({
                "label": label[:80],
                "name": name,
                "type": ftype,
                "values": values,
                "required": required,
            })

    # Add standard fields if not found (iCIMS always has these)
    standard = ["firstName", "lastName", "email", "resume"]
    found_names = {f["name"] for f in fields}
    for std_name in standard:
        if std_name not in found_names and std_name.lower() not in {n.lower() for n in found_names}:
            ftype = "file" if std_name == "resume" else "input"
            fields.append({
                "label": _STD.get(std_name, _name_to_label(std_name)),
                "name": std_name,
                "type": ftype,
                "values": [],
                "required": True,
            })

    return fields


def _regex_fallback(html: str) -> list[dict]:
    """Fallback regex-based parser when BeautifulSoup isn't available."""
    out, seen = [], set()

    # Find input fields
    for match in re.finditer(r'<input[^>]+name=["\']([^"\']+)["\'][^>]*>', html, re.I):
        name = match.group(1)
        if name in seen or name.startswith("_"):
            continue
        seen.add(name)

        tag_content = match.group(0)

        # Skip hidden fields
        if 'type="hidden"' in tag_content or "type='hidden'" in tag_content:
            continue

        # Check type
        type_match = re.search(r'type=["\']([^"\']+)["\']', tag_content, re.I)
        input_type = type_match.group(1) if type_match else "text"
        ftype = "file" if input_type == "file" else "input"

        # Check required
        required = "required" in tag_content.lower()

        label = _STD.get(name, _name_to_label(name))
        out.append({"label": label, "name": name, "type": ftype, "values": [], "required": required})

    # Find textareas
    for match in re.finditer(r'<textarea[^>]+name=["\']([^"\']+)["\'][^>]*>', html, re.I):
        name = match.group(1)
        if name in seen:
            continue
        seen.add(name)
        label = _STD.get(name, _name_to_label(name))
        out.append({"label": label, "name": name, "type": "textarea", "values": [], "required": False})

    # Find selects
    for match in re.finditer(r'<select[^>]+name=["\']([^"\']+)["\'][^>]*>', html, re.I):
        name = match.group(1)
        if name in seen:
            continue
        seen.add(name)
        label = _STD.get(name, _name_to_label(name))
        out.append({"label": label, "name": name, "type": "select", "values": [], "required": False})

    # Add standard fields if not found
    standard = ["firstName", "lastName", "email", "resume"]
    for std_name in standard:
        if std_name not in seen:
            ftype = "file" if std_name == "resume" else "input"
            out.append({
                "label": _STD.get(std_name, _name_to_label(std_name)),
                "name": std_name,
                "type": ftype,
                "values": [],
                "required": True,
            })

    return out


def _name_to_label(name: str) -> str:
    """Convert camelCase/snake_case field name to human-readable label."""
    # Handle camelCase
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
    # Handle snake_case
    s = s.replace("_", " ")
    return s.title()


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve every form field from the profile. Returns a summary dict.

    Uses iCIMS-specific category detection and resolution for:
    - Comprehensive work_auth/sponsorship label variations
    - Agreement checkboxes (auto-check True)
    - Age verification (auto-yes)
    - EEO fields (auto-decline)
    - And 26 total field categories from iCIMS analysis
    """
    resolved = []
    for f in fields:
        label, name = f["label"], f["name"]
        ftype, values = f.get("type", ""), f.get("values", [])
        required = f.get("required", False)

        # Use iCIMS-specific category detection (includes all label variations)
        cat = _icims_category(label, name)

        # Use iCIMS-specific resolution (handles agreement checkboxes, etc.)
        val, src = _icims_resolve_one(cat, ftype, values, p, label)

        resolved.append(ResolvedField(
            label=label, name=name, type=ftype, required=required,
            category=cat, value=val, source=src
        ))

    # Count filled fields including new auto sources
    filled = [r for r in resolved if r.source in ("profile", "matched", "eeo", "file", "auto_check", "auto_yes")]
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


def list_jobs(token: str, limit: int = 50) -> list[dict]:
    """List jobs from an iCIMS career site.

    iCIMS job search endpoint returns HTML, not JSON. This does basic scraping.
    """
    url = f"https://careers-{token}.icims.com/jobs/search"
    try:
        resp = requests.get(url, headers=UA, timeout=25)
        resp.raise_for_status()
    except Exception:
        # Try alternate URL
        url = f"https://careers.{token}.com/jobs/search"
        resp = requests.get(url, headers=UA, timeout=25)
        resp.raise_for_status()

    html = resp.text
    jobs = []

    # iCIMS job links typically have /jobs/{id}/ pattern
    for match in re.finditer(r'href=["\']([^"\']*?/jobs/(\d+)/[^"\']*)["\']', html, re.I):
        job_url = match.group(1)
        job_id = match.group(2)
        jobs.append({"id": job_id, "url": job_url})
        if len(jobs) >= limit:
            break

    return jobs


if __name__ == "__main__":
    # Demo: test with a real iCIMS company
    token = sys.argv[1] if len(sys.argv) > 1 else "example"
    job_id = sys.argv[2] if len(sys.argv) > 2 else "1"

    demo = Profile(
        first_name="Alex", last_name="Doe", email="alex@example.com",
        phone="+1 555 123 4567", location="San Francisco, CA",
        linkedin_url="https://linkedin.com/in/alexdoe",
        github_url="https://github.com/alexdoe",
        resume_url="resume.pdf",
        work_authorized=True, require_sponsorship=False
    )

    try:
        form = fetch_form(token, job_id)
        res = resolve(form, demo)
        print(f"iCIMS {token} job {job_id}: {res['ready_pct']}% ready "
              f"({res['ready_count']}/{res['total']}), "
              f"ai_needed={len(res['ai_needed'])}, user_needed={len(res['user_needed'])}")
        for r in res["resolved"]:
            print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:30]}")
    except Exception as e:
        print(f"Error: {e}")
