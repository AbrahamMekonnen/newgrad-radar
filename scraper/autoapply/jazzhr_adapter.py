"""Deterministic JazzHR application adapter.

JazzHR uses simple HTML forms. No public API, so we parse the apply page.
Resolves each field from the profile using the central field_knowledge_base
for consistent category detection across all ATSes.

URL patterns:
  - https://app.jazz.co/{company}/jobs/{job_id}
  - https://{company}.applytojob.com/apply/{job_id}
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

# Standard JazzHR field name -> label mapping
# JazzHR uses "resumator-" prefix for most fields (from form sampling of 50 forms)
_STD = {
    # Identity fields
    "first_name": "First Name",
    "firstName": "First Name",
    "applicant_first_name": "First Name",
    "resumator-first_name": "First Name",
    "last_name": "Last Name",
    "lastName": "Last Name",
    "applicant_last_name": "Last Name",
    "resumator-last_name": "Last Name",
    # Contact
    "email": "Email",
    "applicant_email": "Email",
    "resumator-email": "Email",
    "phone": "Phone",
    "applicant_phone": "Phone",
    "resumator-phone": "Phone",
    # Resume/Cover Letter
    "resume": "Resume",
    "resume_upload": "Resume",
    "applicant_resume": "Resume",
    "resumator-resume": "Resume",
    "cover_letter": "Cover Letter",
    "coverLetter": "Cover Letter",
    "applicant_cover_letter": "Cover Letter",
    "resumator-cover_letter": "Cover Letter",
    # Links
    "linkedin": "LinkedIn",
    "linkedIn": "LinkedIn",
    "linkedin_url": "LinkedIn",
    "resumator-linkedin": "LinkedIn",
    "website": "Website",
    "portfolio": "Portfolio",
    "portfolio_url": "Portfolio",
    "resumator-website": "Portfolio",
    # Location
    "address": "Address",
    "resumator-address": "Address",
    "city": "City",
    "resumator-city": "City",
    "state": "State",
    "resumator-state": "State",
    "zip": "Zip Code",
    "zipcode": "Zip Code",
    "resumator-zip": "Zip Code",
    # EEO fields (JazzHR specific format discovered from sampling)
    "resumator-eeo_gender-value": "Gender",
    "resumator-eeo_race-value": "Race/Ethnicity",
    "resumator-eeoc_veteran-value": "Veteran Status",
}


def _apply_url(token: str, job_id: str) -> str:
    """Construct the JazzHR apply page URL."""
    return f"https://app.jazz.co/{token}/jobs/{job_id}"


def _alt_apply_url(token: str, job_id: str) -> str:
    """Alternate JazzHR URL pattern (applytojob.com subdomain)."""
    return f"https://{token}.applytojob.com/apply/{job_id}"


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Return [{label, name, type, values, required}] parsed from JazzHR apply page."""
    url = _apply_url(token, job_id)
    resp = requests.get(url, headers=UA, timeout=25)

    if resp.status_code == 404:
        # Try alternate URL format
        url = _alt_apply_url(token, job_id)
        resp = requests.get(url, headers=UA, timeout=25)

    resp.raise_for_status()
    html = resp.text

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

    # JazzHR forms often use specific class names
    form_selectors = ["form", ".application-form", "#application-form", ".jazz-form"]
    form = None
    for sel in form_selectors:
        form = soup.select_one(sel)
        if form:
            break

    if not form:
        form = soup  # Search entire document

    # Find all form inputs
    for inp in form.select("input[name], textarea[name], select[name]"):
        name = inp.get("name", "")
        if not name or name in seen or name.startswith("_") or name.startswith("csrf"):
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
            inp_id = inp.get("id", "")
            if inp_id:
                label_el = soup.select_one(f'label[for="{inp_id}"]')
                if label_el:
                    label = label_el.get_text(" ", strip=True)

            # Try parent label
            if not label:
                parent = inp.find_parent("label")
                if parent:
                    label = parent.get_text(" ", strip=True).replace(str(inp), "").strip()

            # Convert field name to human-readable
            if not label:
                label = _name_to_label(name)

        # Check if required
        required = (inp.has_attr("required") or
                   "required" in inp.get("class", []) or
                   "required" in str(inp.get("data-validate", "")))

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

    return fields


def _regex_fallback(html: str) -> list[dict]:
    """Fallback regex-based parser when BeautifulSoup isn't available."""
    out, seen = [], set()

    # Find input fields
    for match in re.finditer(r'<input[^>]+name=["\']([^"\']+)["\'][^>]*>', html, re.I):
        name = match.group(1)
        if name in seen or name.startswith("_") or name.startswith("csrf"):
            continue
        seen.add(name)

        # Check type
        type_match = re.search(r'type=["\']([^"\']+)["\']', match.group(0), re.I)
        input_type = type_match.group(1) if type_match else "text"

        if input_type == "hidden":
            continue

        ftype = "file" if input_type == "file" else "input"
        required = "required" in match.group(0).lower()
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

    return out


def _name_to_label(name: str) -> str:
    """Convert camelCase/snake_case field name to human-readable label."""
    # Remove common JazzHR prefixes (resumator- is the main one from sampling)
    for prefix in ("resumator-", "applicant_", "app_", "jazz_"):
        if name.lower().startswith(prefix):
            name = name[len(prefix):]

    # Handle questionnaire IDs (resumator-questionnaire[123])
    if name.startswith("questionnaire"):
        return "Custom Question"

    # Handle EEO field suffixes
    if name.endswith("-value"):
        name = name[:-6]
    if name.startswith("eeo_") or name.startswith("eeoc_"):
        name = name.split("_", 1)[1] if "_" in name else name

    # Handle camelCase
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
    # Handle snake_case
    s = s.replace("_", " ")
    return s.title()


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve every form field from the profile. Returns a summary dict."""
    resolved = []
    for f in fields:
        label, name = f["label"], f["name"]
        ftype, values = f.get("type", ""), f.get("values", [])
        required = f.get("required", False)

        # Use central field knowledge base for consistent category detection
        # lookup_field returns (category, profile_field, resolution)
        cat, profile_field, resolution_hint = lookup_field(label, name)
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
    # Demo: test with a JazzHR job
    token = sys.argv[1] if len(sys.argv) > 1 else "example"
    job_id = sys.argv[2] if len(sys.argv) > 2 else "1"

    # Profile now supports all MASTER_PROFILE_FIELDS from field_knowledge_base
    demo = Profile(
        # Core identity
        first_name="Alex", last_name="Doe", email="alex@example.com",
        phone="+1 555 123 4567",
        # Location fields
        location="San Francisco, CA",
        address="123 Main St", city="San Francisco", state="CA",
        zip_code="94102", country="United States",
        # Links
        linkedin_url="https://linkedin.com/in/alexdoe",
        github_url="https://github.com/alexdoe",
        resume_url="resume.pdf",
        # Work authorization
        work_authorized=True, require_sponsorship=False,
        # Education fields
        school="University of California, Berkeley",
        major="Computer Science", graduation_year="2024", gpa="3.8",
        # Preferences
        remote_preference="hybrid",
        referral_name="",  # Empty if no referral
        # EEO defaults
        eeo_decline_all=True,
        # Story bank for AI drafting
        story_bank={"why_interested": "I am passionate about..."},
        resume_text="Software engineer with 2 years experience..."
    )

    try:
        form = fetch_form(token, job_id)
        res = resolve(form, demo)
        print(f"JazzHR {token} job {job_id}: {res['ready_pct']}% ready "
              f"({res['ready_count']}/{res['total']}), "
              f"ai_needed={len(res['ai_needed'])}, user_needed={len(res['user_needed'])}")
        for r in res["resolved"]:
            print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:30]}")
    except Exception as e:
        print(f"Error: {e}")
