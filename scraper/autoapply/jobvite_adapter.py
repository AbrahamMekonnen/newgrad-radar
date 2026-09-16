"""Deterministic Jobvite application adapter.

Jobvite forms are standard HTML with jv- prefixed IDs and classes.
Like Lever, we parse the apply page HTML. Uses the same category->profile
logic as Greenhouse for consistent behavior across ATSes.

URL pattern: jobs.jobvite.com/{company}/job/{job_id}
Form selector: #jv-application-form
Field IDs: #jv-firstName, #jv-lastName, #jv-email, etc.

Field Patterns (from analysis):
------------------------------------------------------------
| Category        | Frequency | Resolution    | Profile Field        |
|-----------------|-----------|---------------|----------------------|
| first_name      | 100%      | profile       | first_name           |
| last_name       | 100%      | profile       | last_name            |
| email           | 100%      | profile       | email                |
| phone           | 90%       | profile       | phone                |
| resume          | 100%      | file          | resume_url           |
| linkedin        | 65%       | profile       | linkedin_url         |
| github          | 40%       | profile       | github_url           |
| portfolio       | 35%       | profile       | portfolio_url        |
| website         | 40%       | profile       | portfolio_url        |
| location        | 55%       | profile       | location             |
| current_company | 35%       | profile       | current_company      |
| work_auth       | 80%       | matched       | work_authorized      |
| sponsorship     | 75%       | matched       | require_sponsorship  |
| gender          | 65%       | eeo (decline) | -                    |
| race            | 65%       | eeo (decline) | -                    |
| veteran         | 60%       | eeo (decline) | -                    |
| disability      | 60%       | eeo (decline) | -                    |
| source          | 45%       | matched       | how_heard            |
| cover_letter    | 50%       | ai_needed     | cover_letter_url     |
| education       | 50%       | profile       | education            |
| graduation_year | 30%       | profile       | graduation_year      |
| major           | 35%       | profile       | major                |
| salary          | 35%       | profile       | salary_expectation   |
| start_date      | 50%       | matched       | start_date           |
| relocate        | 40%       | matched       | willing_to_relocate  |
------------------------------------------------------------
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from greenhouse_adapter import Profile, ResolvedField, _resolve_one  # noqa: E402
from field_knowledge_base import lookup_field, FIELD_PATTERNS  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)"}

# Standard Jobvite field mappings: {field_id: (label, required)}
# Comprehensive mappings covering all discovered variations
_JV_FIELDS = {
    # First Name (100% frequency) - required
    "jv-firstName": ("First Name", True),
    "firstName": ("First Name", True),
    "first_name": ("First Name", True),
    "givenName": ("First Name", True),
    "jv-givenName": ("First Name", True),

    # Last Name (100% frequency) - required
    "jv-lastName": ("Last Name", True),
    "lastName": ("Last Name", True),
    "last_name": ("Last Name", True),
    "surname": ("Last Name", True),
    "familyName": ("Last Name", True),
    "jv-surname": ("Last Name", True),
    "jv-familyName": ("Last Name", True),

    # Email (100% frequency) - required
    "jv-email": ("Email", True),
    "email": ("Email", True),
    "emailAddress": ("Email", True),
    "jv-emailAddress": ("Email", True),

    # Phone (90% frequency) - recommended
    "jv-phone": ("Phone", False),
    "phone": ("Phone", False),
    "mobile": ("Phone", False),
    "phoneNumber": ("Phone", False),
    "contactNumber": ("Phone", False),
    "jv-mobile": ("Phone", False),
    "jv-phoneNumber": ("Phone", False),

    # Resume (100% frequency) - required
    "jv-resume": ("Resume/CV", True),
    "resume": ("Resume/CV", True),
    "cv": ("Resume/CV", True),
    "jv-cv": ("Resume/CV", True),

    # Cover Letter (50% frequency) - optional, AI-drafted
    "jv-coverLetter": ("Cover Letter", False),
    "coverLetter": ("Cover Letter", False),
    "cover_letter": ("Cover Letter", False),

    # LinkedIn (65% frequency) - recommended
    "jv-linkedin": ("LinkedIn", False),
    "linkedin": ("LinkedIn", False),
    "linkedinUrl": ("LinkedIn", False),
    "jv-linkedinUrl": ("LinkedIn", False),
    "linkedInProfile": ("LinkedIn", False),

    # GitHub (40% frequency) - recommended for tech roles
    "jv-github": ("GitHub", False),
    "github": ("GitHub", False),
    "githubUrl": ("GitHub", False),
    "jv-githubUrl": ("GitHub", False),

    # Portfolio (35% frequency) - optional
    "jv-portfolio": ("Portfolio", False),
    "portfolio": ("Portfolio", False),
    "portfolioUrl": ("Portfolio", False),
    "jv-portfolioUrl": ("Portfolio", False),

    # Website (40% frequency) - optional, maps to portfolio_url
    "jv-website": ("Website", False),
    "website": ("Website", False),
    "personalWebsite": ("Website", False),
    "personalSite": ("Website", False),
    "jv-personalWebsite": ("Website", False),

    # Location (55% frequency) - recommended
    "jv-location": ("Location", False),
    "location": ("Location", False),
    "currentLocation": ("Location", False),
    "jv-currentLocation": ("Location", False),

    # Address components (30-50% frequency)
    "jv-address": ("Address", False),
    "address": ("Address", False),
    "jv-city": ("City", False),
    "city": ("City", False),
    "jv-state": ("State", False),
    "state": ("State", False),
    "jv-zip": ("Zip Code", False),
    "zip": ("Zip Code", False),
    "zipCode": ("Zip Code", False),
    "postalCode": ("Zip Code", False),
    "jv-country": ("Country", False),
    "country": ("Country", False),

    # Current Company (35% frequency) - optional
    "jv-currentCompany": ("Current Company", False),
    "currentCompany": ("Current Company", False),
    "current_company": ("Current Company", False),
    "currentEmployer": ("Current Company", False),

    # Preferred Name (15% frequency) - optional
    "jv-preferredName": ("Preferred Name", False),
    "preferredName": ("Preferred Name", False),

    # Education fields (50% frequency)
    "jv-education": ("Education", False),
    "education": ("Education", False),
    "jv-degree": ("Degree", False),
    "degree": ("Degree", False),
    "jv-school": ("School", False),
    "school": ("School", False),
    "university": ("School", False),

    # Graduation Year (30% frequency)
    "jv-graduationYear": ("Graduation Year", False),
    "graduationYear": ("Graduation Year", False),
    "graduation_year": ("Graduation Year", False),
    "gradYear": ("Graduation Year", False),

    # Major (35% frequency)
    "jv-major": ("Major", False),
    "major": ("Major", False),
    "fieldOfStudy": ("Major", False),

    # Salary (35% frequency) - optional
    "jv-salary": ("Salary Expectation", False),
    "salary": ("Salary Expectation", False),
    "salaryExpectation": ("Salary Expectation", False),
    "expectedSalary": ("Salary Expectation", False),
    "desiredSalary": ("Salary Expectation", False),

    # Start Date (50% frequency)
    "jv-startDate": ("Start Date", False),
    "startDate": ("Start Date", False),
    "jv-availability": ("Availability", False),
    "availability": ("Availability", False),
    "availableDate": ("Availability", False),

    # Relocate (40% frequency)
    "jv-relocate": ("Willing to Relocate", False),
    "relocate": ("Willing to Relocate", False),
    "jv-willingToRelocate": ("Willing to Relocate", False),
    "willingToRelocate": ("Willing to Relocate", False),
}

# NOTE: Work authorization, sponsorship, EEO, and source patterns are now
# handled by the central field_knowledge_base module. The patterns have been
# removed from here to avoid duplication.


def _jv_category(label: str, field_name: str = "") -> str:
    """Detect field category using central field knowledge base.

    Uses lookup_field() from field_knowledge_base for comprehensive pattern matching.
    For Jobvite-specific field names (jv-firstName, etc.), translates them to
    standard labels first via _JV_FIELDS mapping.

    Returns: category string (e.g., 'first_name', 'work_auth', 'gender', 'custom')
    """
    # If we have a Jobvite-specific field name, get its standard label
    lookup_label = label
    if field_name in _JV_FIELDS:
        lookup_label = _JV_FIELDS[field_name][0]

    # Use the central knowledge base for category detection
    category, profile_field, resolution = lookup_field(lookup_label, field_name)
    return category


def _extract_label(name: str, html_context: str = "") -> str:
    """Extract a human-readable label from field name or context."""
    if name in _JV_FIELDS:
        return _JV_FIELDS[name][0]
    # Try to find label in HTML
    label_match = re.search(rf'<label[^>]*for=["\']?{re.escape(name)}["\']?[^>]*>([^<]+)</label>', html_context, re.I)
    if label_match:
        return label_match.group(1).strip()
    # Camel/snake case to Title Case
    readable = re.sub(r'([A-Z])', r' \1', name)
    readable = readable.replace('_', ' ').replace('-', ' ')
    return readable.strip().title()


def fetch_form(company: str, job_id: str) -> list[dict]:
    """Return [{label, name, type, values, required}] parsed from Jobvite apply page."""
    url = f"https://jobs.jobvite.com/{company}/job/{job_id}"
    html = requests.get(url, headers=UA, timeout=25).text

    try:
        from bs4 import BeautifulSoup
        return _parse_with_bs4(html)
    except ImportError:
        return _regex_fallback(html)


def _parse_with_bs4(html: str) -> list[dict]:
    """Parse form using BeautifulSoup."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    fields, seen = [], set()

    # Find the application form
    form = soup.select_one('#jv-application-form, form.jv-apply-form, form[action*="apply"]')
    if not form:
        form = soup  # Fall back to searching entire page

    # Process all input/textarea/select elements
    for inp in form.select('input[name], textarea[name], select[name]'):
        name = inp.get("name", "")
        inp_id = inp.get("id", "")
        key = name or inp_id

        if not key or key in seen:
            continue
        seen.add(key)

        # Skip hidden/submit fields
        inp_type = inp.get("type", "").lower()
        if inp_type in ("hidden", "submit", "button"):
            continue

        # Determine field type
        tag = inp.name
        if tag == "textarea":
            ftype = "textarea"
        elif tag == "select":
            ftype = "select"
        elif inp_type == "file":
            ftype = "file"
        else:
            ftype = "input"

        # Get label
        label = ""
        # Try associated label
        if inp_id:
            label_el = form.select_one(f'label[for="{inp_id}"]')
            if label_el:
                label = label_el.get_text(strip=True)
        # Try parent label
        if not label:
            parent_label = inp.find_parent("label")
            if parent_label:
                label = parent_label.get_text(strip=True)
        # Try nearby label
        if not label:
            prev = inp.find_previous_sibling("label")
            if prev:
                label = prev.get_text(strip=True)
        # Fall back to field name mapping or conversion
        if not label:
            label = _extract_label(key)

        # Check required
        required = bool(inp.get("required")) or inp.get("aria-required") == "true"
        if key in _JV_FIELDS:
            required = required or _JV_FIELDS[key][1]

        # Get options for select
        values = []
        if ftype == "select":
            values = [{"label": opt.get_text(strip=True), "value": opt.get("value", "")}
                      for opt in inp.select("option") if opt.get("value")]

        fields.append({
            "label": label[:100],
            "name": key,
            "type": ftype,
            "values": values,
            "required": required,
        })

    return fields


def _regex_fallback(html: str) -> list[dict]:
    """Fallback parser when BeautifulSoup not available."""
    fields, seen = [], set()

    # Find input/textarea/select with name attribute
    for match in re.finditer(r'<(input|textarea|select)[^>]*name=["\']([^"\']+)["\'][^>]*>', html, re.I):
        tag, name = match.group(1).lower(), match.group(2)
        if name in seen:
            continue
        seen.add(name)

        # Skip hidden
        if 'type="hidden"' in match.group(0).lower():
            continue

        # Determine type
        if tag == "textarea":
            ftype = "textarea"
        elif tag == "select":
            ftype = "select"
        elif 'type="file"' in match.group(0).lower():
            ftype = "file"
        else:
            ftype = "input"

        label = _extract_label(name, html)
        required = "required" in match.group(0).lower()
        if name in _JV_FIELDS:
            required = required or _JV_FIELDS[name][1]

        fields.append({
            "label": label,
            "name": name,
            "type": ftype,
            "values": [],
            "required": required,
        })

    return fields


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve every Jobvite form field from the profile.

    Uses _jv_category() which delegates to the central field_knowledge_base
    for comprehensive pattern matching. Handles:
    - All jv-prefixed field IDs and common variations (via _JV_FIELDS mapping)
    - Work authorization questions (80% of jobs)
    - Sponsorship questions (75% of jobs)
    - EEO fields (gender, race, veteran, disability) - auto-decline
    - Source/referral questions
    - All other patterns defined in field_knowledge_base.FIELD_PATTERNS
    """
    resolved = []
    for f in fields:
        label, name = f["label"], f["name"]
        ftype = f.get("type", "")
        values = f.get("values", [])
        required = f.get("required", False)

        # Use Jobvite-specific category detection
        cat = _jv_category(label, name)
        val, src = _resolve_one(cat, ftype, values, p, label)

        resolved.append(ResolvedField(
            label=label, name=name, type=ftype, required=required,
            category=cat, value=val, source=src
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


if __name__ == "__main__":
    # Demo: test with a real Jobvite form
    company = sys.argv[1] if len(sys.argv) > 1 else "twilio"
    job_id = sys.argv[2] if len(sys.argv) > 2 else ""

    if not job_id:
        # Try to find a job
        search_url = f"https://jobs.jobvite.com/{company}/search"
        html = requests.get(search_url, headers=UA, timeout=20).text
        job_match = re.search(r'/job/([a-zA-Z0-9]+)', html)
        if job_match:
            job_id = job_match.group(1)
        else:
            print(f"No jobs found for {company}")
            sys.exit(1)

    demo = Profile(
        first_name="Alex", last_name="Doe", email="alex@example.com",
        phone="+1 555 123 4567", location="San Francisco, CA",
        linkedin_url="https://linkedin.com/in/alexdoe",
        github_url="https://github.com/alexdoe",
        resume_url="resume.pdf",
        work_authorized=True, require_sponsorship=False
    )

    fields = fetch_form(company, job_id)
    print(f"Fetched {len(fields)} fields from {company}/job/{job_id}")

    res = resolve(fields, demo)
    print(f"{company} job {job_id}: {res['ready_pct']}% ready ({res['ready_count']}/{res['total']}), "
          f"ai_needed={len(res['ai_needed'])}, user_needed={len(res['user_needed'])}")

    for r in res["resolved"]:
        print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:30]}")
