"""Deterministic BambooHR application adapter.

BambooHR has simple HTML forms with predictable field names. No public API,
so we parse the apply page. Resolves each field from the profile using the
central field_knowledge_base for consistent category detection across ATSes.

URL patterns:
  - https://{company}.bamboohr.com/careers/{job_id}/detail
  - https://{company}.bamboohr.com/jobs/view.php?id={job_id}
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

# Standard BambooHR field name -> label mapping
_STD = {
    "first_name": "First Name",
    "firstName": "First Name",
    "last_name": "Last Name",
    "lastName": "Last Name",
    "email": "Email",
    "phone": "Phone",
    "phoneNumber": "Phone",
    "resume": "Resume",
    "coverLetter": "Cover Letter",
    "cover_letter": "Cover Letter",
    "linkedIn": "LinkedIn",
    "linkedin": "LinkedIn",
    "address": "Address",
    "city": "City",
    "state": "State",
    "zip": "Zip Code",
    "website": "Website",
    "portfolio": "Portfolio",
}


def _apply_url(token: str, job_id: str) -> str:
    """Construct the BambooHR apply page URL."""
    return f"https://{token}.bamboohr.com/careers/{job_id}/detail"


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Return [{label, name, type, values, required}] parsed from BambooHR apply page."""
    url = _apply_url(token, job_id)
    resp = requests.get(url, headers=UA, timeout=25)
    if resp.status_code == 404:
        # Try alternate URL format
        url = f"https://{token}.bamboohr.com/jobs/view.php?id={job_id}"
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

    # Find all form inputs
    for form in soup.select("form"):
        for inp in form.select("input[name], textarea[name], select[name]"):
            name = inp.get("name", "")
            if not name or name in seen or name.startswith("_"):
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
            else:
                ftype = "input"

            # Get label
            label = _STD.get(name, "")
            if not label:
                # Look for associated label
                label_el = soup.select_one(f'label[for="{inp.get("id", "")}"]')
                if label_el:
                    label = label_el.get_text(" ", strip=True)
                else:
                    # Convert field name to human-readable
                    label = _name_to_label(name)

            # Check if required
            required = inp.has_attr("required") or "required" in inp.get("class", [])

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

    # If no fields found in forms, try finding inputs anywhere
    if not fields:
        for inp in soup.select("input[name], textarea[name], select[name]"):
            name = inp.get("name", "")
            if not name or name in seen or name.startswith("_"):
                continue
            seen.add(name)
            input_type = inp.get("type", "text")
            ftype = "textarea" if inp.name == "textarea" else ("file" if input_type == "file" else "input")
            label = _STD.get(name, _name_to_label(name))
            fields.append({"label": label, "name": name, "type": ftype, "values": [], "required": False})

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

        # Check type
        type_match = re.search(r'type=["\']([^"\']+)["\']', match.group(0), re.I)
        input_type = type_match.group(1) if type_match else "text"
        ftype = "file" if input_type == "file" else "input"

        # Check required
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

        # Use central field knowledge base for category detection
        # lookup_field returns (category, profile_field, resolution)
        cat, _profile_field, _resolution = lookup_field(label, name)
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
    # Demo: test with a real BambooHR job
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
        print(f"BambooHR {token} job {job_id}: {res['ready_pct']}% ready "
              f"({res['ready_count']}/{res['total']}), "
              f"ai_needed={len(res['ai_needed'])}, user_needed={len(res['user_needed'])}")
        for r in res["resolved"]:
            print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:30]}")
    except Exception as e:
        print(f"Error: {e}")
