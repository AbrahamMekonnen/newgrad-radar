"""BreezyHR application adapter.

BreezyHR uses a clean REST API and React-based forms. Low automation difficulty.

URL patterns:
  - https://{company}.breezy.hr/p/{position_id}
  - https://{company}.breezy.hr/p/{position_id}/apply

API:
  - GET https://{company}.breezy.hr/api/v1/positions - list jobs
  - GET https://{company}.breezy.hr/api/v1/positions/{position_id} - job detail

    from autoapply.breezyhr_adapter import fetch_form, resolve
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

# Standard BreezyHR field name -> label mapping
_STD = {
    "first_name": "First Name",
    "last_name": "Last Name",
    "email": "Email",
    "phone": "Phone",
    "resume": "Resume",
    "cover_letter": "Cover Letter",
    "linkedin": "LinkedIn",
    "linkedin_url": "LinkedIn",
    "website": "Website",
    "portfolio": "Portfolio",
    "address": "Address",
    "city": "City",
    "state": "State",
    "country": "Country",
    "zip": "Zip Code",
    "referral": "How did you hear about us?",
}


def _api_url(token: str) -> str:
    """Construct the BreezyHR API base URL."""
    return f"https://{token}.breezy.hr/api/v1"


def _apply_url(token: str, position_id: str) -> str:
    """Construct the BreezyHR apply page URL."""
    return f"https://{token}.breezy.hr/p/{position_id}/apply"


def fetch_form(token: str, position_id: str) -> list[dict]:
    """Return [{label, name, type, values, required}] for a BreezyHR position.

    Tries API first, falls back to HTML parsing.
    """
    # Try API first
    try:
        api_url = f"{_api_url(token)}/positions/{position_id}"
        resp = requests.get(api_url, headers=UA, timeout=20)
        if resp.ok:
            data = resp.json()
            return _parse_api_response(data)
    except Exception:
        pass

    # Fallback to HTML parsing
    url = _apply_url(token, position_id)
    resp = requests.get(url, headers=UA, timeout=25)
    resp.raise_for_status()
    return _parse_html(resp.text)


def _parse_api_response(data: dict) -> list[dict]:
    """Parse fields from BreezyHR API response."""
    fields = []

    # Standard fields are always present
    standard_fields = [
        {"label": "First Name", "name": "first_name", "type": "input", "required": True},
        {"label": "Last Name", "name": "last_name", "type": "input", "required": True},
        {"label": "Email", "name": "email", "type": "input", "required": True},
        {"label": "Phone", "name": "phone", "type": "input", "required": False},
        {"label": "Resume", "name": "resume", "type": "file", "required": True},
    ]
    fields.extend(standard_fields)

    # Parse custom questions from position data
    questionnaire = data.get("questionnaire") or data.get("questions") or []
    for q in questionnaire:
        qtype = (q.get("type") or "text").lower()

        if qtype in ("textarea", "long_text", "longtext"):
            ftype = "textarea"
        elif qtype in ("select", "dropdown", "single_select"):
            ftype = "select"
        elif qtype in ("multi_select", "checkbox", "checkboxes"):
            ftype = "multi_select"
        elif qtype == "file":
            ftype = "file"
        else:
            ftype = "input"

        # Extract options for select fields
        values = []
        for opt in q.get("options") or q.get("choices") or []:
            if isinstance(opt, dict):
                values.append({"label": opt.get("label") or opt.get("text"),
                              "value": opt.get("value") or opt.get("id")})
            else:
                values.append({"label": str(opt), "value": str(opt)})

        fields.append({
            "label": q.get("label") or q.get("question") or q.get("title", ""),
            "name": q.get("id") or q.get("field_id") or f"q_{len(fields)}",
            "type": ftype,
            "values": values,
            "required": q.get("required", False),
        })

    return fields


def _parse_html(html: str) -> list[dict]:
    """Parse form fields from BreezyHR HTML."""
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

    # Find the application form
    form = soup.select_one('.breezy-application form, #breezy-application-form, form[action*="apply"]')
    if not form:
        form = soup  # Search entire page

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
        else:
            ftype = "input"

        # Get label
        label = _STD.get(name, "")
        if not label:
            label_el = soup.select_one(f'label[for="{inp.get("id", "")}"]')
            if label_el:
                label = label_el.get_text(" ", strip=True)
            else:
                label = _name_to_label(name)

        # Check required
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

    return fields


def _regex_fallback(html: str) -> list[dict]:
    """Fallback regex parser when BeautifulSoup isn't available."""
    out, seen = [], set()

    # Standard fields are always present on BreezyHR
    standard = [
        {"label": "First Name", "name": "first_name", "type": "input", "required": True},
        {"label": "Last Name", "name": "last_name", "type": "input", "required": True},
        {"label": "Email", "name": "email", "type": "input", "required": True},
        {"label": "Phone", "name": "phone", "type": "input", "required": False},
        {"label": "Resume", "name": "resume", "type": "file", "required": True},
    ]
    out.extend(standard)
    seen.update(f["name"] for f in standard)

    # Find additional inputs
    for match in re.finditer(r'<input[^>]+name=["\']([^"\']+)["\'][^>]*>', html, re.I):
        name = match.group(1)
        if name in seen or name.startswith("_"):
            continue
        seen.add(name)

        type_match = re.search(r'type=["\']([^"\']+)["\']', match.group(0), re.I)
        input_type = type_match.group(1) if type_match else "text"
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
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
    s = s.replace("_", " ")
    return s.title()


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve every form field from the profile. Returns a summary dict."""
    resolved = []
    for f in fields:
        label, name = f["label"], f["name"]
        ftype, values = f.get("type", ""), f.get("values", [])
        required = f.get("required", False)

        # Use central field knowledge base for categorization
        cat, profile_field, resolution = lookup_field(label, name)
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


def list_positions(token: str) -> list[dict]:
    """List all open positions for a BreezyHR company."""
    url = f"{_api_url(token)}/positions"
    resp = requests.get(url, headers=UA, timeout=20)
    resp.raise_for_status()
    return resp.json()


if __name__ == "__main__":
    # Demo: test with a BreezyHR company
    token = sys.argv[1] if len(sys.argv) > 1 else "example"
    position_id = sys.argv[2] if len(sys.argv) > 2 else "1"

    demo = Profile(
        first_name="Alex", last_name="Doe", email="alex@example.com",
        phone="+1 555 123 4567", location="San Francisco, CA",
        linkedin_url="https://linkedin.com/in/alexdoe",
        github_url="https://github.com/alexdoe",
        resume_url="resume.pdf",
        work_authorized=True, require_sponsorship=False
    )

    try:
        form = fetch_form(token, position_id)
        res = resolve(form, demo)
        print(f"BreezyHR {token} position {position_id}: {res['ready_pct']}% ready "
              f"({res['ready_count']}/{res['total']}), "
              f"ai_needed={len(res['ai_needed'])}, user_needed={len(res['user_needed'])}")
        for r in res["resolved"]:
            print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:30]}")
    except Exception as e:
        print(f"Error: {e}")
