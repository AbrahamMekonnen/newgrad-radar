"""Workday application adapter.

Workday is a complex React SPA with multiple tenant configurations. URL patterns:
  - {tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{job_id}
  - Example: adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/job/12345

Known challenges (difficulty 5):
  - Session/CSRF tokens required for some operations
  - Different wd1-wd5 subdomains per company
  - React SPA with dynamic rendering
  - Some companies require authentication

API endpoints (public, may work without auth):
  - GET /wday/cxs/{tenant}/{site}/jobs - job list
  - GET /wday/cxs/{tenant}/{site}/job/{job_id} - job details + form schema

    from autoapply.workday_adapter import fetch_form, resolve
"""
from __future__ import annotations

from typing import Optional, Tuple

import requests

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Content-Type": "application/json",
}

# Reuse Profile and ResolvedField from greenhouse (Profile includes all MASTER_PROFILE_FIELDS)
from greenhouse_adapter import Profile, ResolvedField, _resolve_one

# Use central field knowledge base for categorization
from field_knowledge_base import lookup_field, FIELD_PATTERNS

# Workday uses wd1-wd5 subdomains - try them in order of popularity
WD_SUBDOMAINS = ["wd5", "wd1", "wd3", "wd2", "wd4"]


def parse_url(url: str) -> Tuple[Optional[str], Optional[str]]:
    """Derive (token, job_path) from a Workday job URL — Workday URLs are self-
    contained, so we don't need a per-company token in COMPANIES.

    e.g. https://snc.wd1.myworkdayjobs.com/en-US/snc/job/Lone-Tree-CO/Systems-Engineer_R123
      -> token "snc:wd1:snc", job_path "Lone-Tree-CO/Systems-Engineer_R123"
    """
    from urllib.parse import urlparse
    u = urlparse(url or "")
    host = u.hostname or ""
    if "myworkdayjobs" not in host:
        return None, None
    parts = host.split(".")
    tenant, wd = parts[0], (parts[1] if len(parts) > 1 else "wd5")
    segs = [s for s in u.path.split("/") if s]
    anchor = "job" if "job" in segs else ("details" if "details" in segs else None)
    if not anchor:
        return None, None
    i = segs.index(anchor)
    site = segs[i - 1] if i >= 1 else tenant
    job_path = "/".join(segs[i + 1:])
    if not job_path:
        return None, None
    return f"{tenant}:{wd}:{site}", job_path


def _parse_token(token: str) -> Tuple[str, str, str]:
    """Parse token into (tenant, wd_subdomain, site).

    Formats:
      - "adobe" -> (adobe, wd5, external)
      - "adobe:wd5:external_experienced" -> (adobe, wd5, external_experienced)
      - "adobe.wd5" -> (adobe, wd5, external)
    """
    if not token:
        return "", "wd5", "external"
    if ":" in token:
        parts = token.split(":")
        tenant = parts[0]
        wd = parts[1] if len(parts) > 1 else "wd5"
        site = parts[2] if len(parts) > 2 else "external"
        return tenant, wd, site
    if ".wd" in token:
        tenant, rest = token.split(".wd", 1)
        wd = "wd" + rest.split(".")[0]
        return tenant, wd, "external"
    return token, "wd5", "external"


def _build_api_url(tenant: str, wd: str, site: str, job_id: str = "") -> str:
    """Build Workday API URL."""
    base = f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"
    if job_id:
        return f"{base}/job/{job_id}"
    return f"{base}/jobs"


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Fetch Workday job posting and extract form fields.

    Returns normalized fields: [{label, name, type, required, values}]

    Note: Workday's full form schema often requires session auth. This fetches
    what's publicly available from the job posting endpoint.
    """
    tenant, wd, site = _parse_token(token)

    # Try to fetch job details from the API
    url = _build_api_url(tenant, wd, site, job_id)

    try:
        r = requests.get(url, headers=UA, timeout=20)
        r.raise_for_status()
        data = r.json()
    except requests.exceptions.RequestException:
        # Try alternate wd subdomains
        for alt_wd in WD_SUBDOMAINS:
            if alt_wd == wd:
                continue
            try:
                url = _build_api_url(tenant, alt_wd, site, job_id)
                r = requests.get(url, headers=UA, timeout=15)
                if r.ok:
                    data = r.json()
                    break
            except:
                continue
        else:
            # All attempts failed - return minimal standard fields
            return _standard_workday_fields()

    # Extract form definition from job posting
    job_posting = data.get("jobPostingInfo", data)

    fields = _standard_workday_fields()

    # Extract any additional questions from the posting
    questions = job_posting.get("questionnaire", {}).get("questions", [])
    if not questions:
        questions = job_posting.get("applicationQuestions", [])

    for q in questions:
        qtype = q.get("type", "TEXT").upper()
        field_type = "textarea" if qtype in ("TEXTAREA", "LONG_TEXT") else "input_text"

        if qtype in ("SINGLE_SELECT", "DROPDOWN", "RADIO"):
            field_type = "select"
        elif qtype == "MULTI_SELECT":
            field_type = "multi_select"
        elif qtype in ("BOOLEAN", "YES_NO"):
            field_type = "select"
        elif qtype == "FILE":
            field_type = "input_file"

        values = []
        for opt in q.get("options", []) or q.get("values", []):
            if isinstance(opt, dict):
                values.append({
                    "label": opt.get("label") or opt.get("value") or str(opt),
                    "value": opt.get("value") or opt.get("id") or opt.get("label"),
                })
            else:
                values.append({"label": str(opt), "value": str(opt)})

        if qtype in ("BOOLEAN", "YES_NO") and not values:
            values = [{"label": "Yes", "value": "true"}, {"label": "No", "value": "false"}]

        fields.append({
            "label": q.get("label") or q.get("question") or q.get("text", ""),
            "name": q.get("id") or q.get("fieldId") or f"q_{len(fields)}",
            "type": field_type,
            "required": q.get("required", False),
            "values": values,
        })

    return fields


def _standard_workday_fields() -> list[dict]:
    """Return standard Workday application fields."""
    return [
        {"label": "Legal First Name", "name": "legalNameSection_firstName",
         "type": "input_text", "required": True, "values": []},
        {"label": "Legal Last Name", "name": "legalNameSection_lastName",
         "type": "input_text", "required": True, "values": []},
        {"label": "Email Address", "name": "email",
         "type": "input_text", "required": True, "values": []},
        {"label": "Phone Number", "name": "phone-number",
         "type": "input_text", "required": False, "values": []},
        {"label": "Resume/CV", "name": "file-upload-input-ref",
         "type": "input_file", "required": True, "values": []},
        {"label": "Address - Country", "name": "addressSection_countryRegion",
         "type": "select", "required": False, "values": [
             {"label": "United States of America", "value": "US"}]},
        {"label": "LinkedIn Profile", "name": "linkedInURL",
         "type": "input_text", "required": False, "values": []},
        {"label": "How Did You Hear About Us?", "name": "sourcePrompt",
         "type": "select", "required": False, "values": [
             {"label": "Company Website", "value": "Company Website"},
             {"label": "LinkedIn", "value": "LinkedIn"},
             {"label": "Job Board", "value": "Job Board"}]},
    ]


def resolve(fields: list[dict], p: Profile) -> dict:
    """Resolve Workday form fields from the profile."""
    resolved: list[ResolvedField] = []

    for f in fields:
        label = f.get("label", "")
        name = f.get("name", "")
        ftype = f.get("type", "")
        required = bool(f.get("required"))
        values = f.get("values", [])

        # Use central field knowledge base for categorization
        # lookup_field returns (category, profile_field, resolution)
        cat, _profile_field, _resolution = lookup_field(label, name)

        rf = ResolvedField(label=label, name=name, type=ftype,
                          required=required, category=cat)
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
    }


def list_jobs(token: str, limit: int = 20) -> list[dict]:
    """List jobs for a Workday tenant."""
    tenant, wd, site = _parse_token(token)
    url = _build_api_url(tenant, wd, site)

    try:
        r = requests.get(url, headers=UA, params={"limit": limit}, timeout=20)
        r.raise_for_status()
        data = r.json()
        return data.get("jobPostings", [])
    except:
        return []


def get_apply_url(token: str, job_id: str) -> str:
    """Get the application URL for a Workday job."""
    tenant, wd, site = _parse_token(token)
    return f"https://{tenant}.{wd}.myworkdayjobs.com/en-US/{site}/job/{job_id}/apply"


if __name__ == "__main__":
    import sys

    # Demo: try to fetch a Workday form
    token = sys.argv[1] if len(sys.argv) > 1 else "adobe:wd5:external_experienced"

    jobs = list_jobs(token)
    if jobs:
        jid = jobs[0].get("bulletFields", [{}])[0].get("value") or jobs[0].get("id", "")
        print(f"Found {len(jobs)} jobs for {token}")
        print(f"First job ID: {jid}")

        form = fetch_form(token, jid)
        print(f"\nForm has {len(form)} fields:")
        for f in form:
            print(f"  {f['label'][:40]:40} ({f['type']:15}) req={f['required']}")
    else:
        print(f"No jobs found or API unavailable for {token}")
        print("Workday often requires browser session for full access.")

        # Show standard fields anyway
        form = _standard_workday_fields()
        print(f"\nStandard Workday fields ({len(form)}):")
        for f in form:
            print(f"  {f['label'][:40]:40} ({f['type']:15})")
