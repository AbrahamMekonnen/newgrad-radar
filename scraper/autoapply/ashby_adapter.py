"""Ashby application adapter.

Ashby uses GraphQL for form definitions. Fields use `_systemfield_` prefix for
standard fields (name, email, phone, resume, etc.) and custom UUIDs for customs.

    from autoapply.ashby_adapter import fetch_form, resolve
    form = fetch_form("stripe", "job-id")
    result = resolve(form, profile)
"""
from __future__ import annotations

import json

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)",
      "Content-Type": "application/json"}

# Verified against the live Ashby job board (captured from jobs.ashbyhq.com's own
# request). The form lives at jobPosting.applicationForm.sections[].fieldEntries[],
# and `field` is a JSON scalar holding {path,title,type,selectableValues,...}.
# (The old `applicationFormDefinition` field was removed from Ashby's schema.)
_ASHBY_Q = (
    "query ApiJobPosting($o: String!, $j: String!) { "
    "jobPosting(organizationHostedJobsPageName: $o, jobPostingId: $j) { "
    "applicationForm { sections { title fieldEntries { isRequired isHidden field } } } } }"
)


# Reuse the Profile and ResolvedField from greenhouse
from greenhouse_adapter import Profile, ResolvedField, _resolve_one  # noqa: E402
from field_knowledge_base import lookup_field  # noqa: E402


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Return Ashby form fields: [{label, name, type, required, values}]."""
    r = requests.post(
        "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting",
        json={"operationName": "ApiJobPosting",
              "variables": {"o": token, "j": job_id},
              "query": _ASHBY_Q},
        headers=UA, timeout=20,
    )
    r.raise_for_status()

    data = r.json()
    if data.get("errors"):
        raise RuntimeError(f"ashby graphql: {data['errors'][0].get('message')}")
    form = (((data or {}).get("data") or {}).get("jobPosting") or {}).get("applicationForm") or {}

    fields = []
    for sec in form.get("sections", []):
        for fe in sec.get("fieldEntries", []):
            if fe.get("isHidden"):
                continue
            f = fe.get("field") or {}          # JSON scalar: {path,title,type,selectableValues}
            fields.append({
                "label": f.get("title") or f.get("humanReadablePath") or "",
                "name": f.get("path") or f.get("id") or "",
                "type": _map_type(f.get("type", "")),
                "required": bool(fe.get("isRequired")),
                "values": _extract_values(f),
            })
    return fields


def _map_type(ashby_type: str) -> str:
    """Map Ashby field types (String, Email, File, Boolean, ValueSelect, ...)."""
    t = (ashby_type or "").lower()
    if t in ("longtext", "richtext"):
        return "textarea"
    if t in ("string", "shorttext", "email", "phone", "url", "number"):
        return "input_text"
    if t == "file":
        return "input_file"
    if t in ("valueselect", "select", "dropdown", "singleselect", "boolean", "yesno"):
        return "select"
    if t in ("multivalueselect", "multiselect", "checkbox"):
        return "multi_value_single_select"
    return "input_text"


def _extract_values(field: dict) -> list[dict]:
    """Extract select options. Ashby Boolean fields have no options, so we supply
    the Yes/No pair so option-matching + the completion box work."""
    opts = field.get("selectableValues") or field.get("options") or []
    if opts:
        return [{"label": o.get("label") or o.get("value") or str(o),
                 "value": o.get("value") or o.get("label")}
                for o in opts if isinstance(o, dict)]
    if (field.get("type") or "").lower() in ("boolean", "yesno"):
        return [{"label": "Yes", "value": "true"}, {"label": "No", "value": "false"}]
    return []


def resolve(form: list[dict], p: Profile) -> dict:
    """Resolve every Ashby form field from the profile. Returns a summary dict."""
    resolved: list[ResolvedField] = []
    for q in form:
        label = q.get("label", "")
        name = q.get("name", "")
        ftype = q.get("type", "")
        required = bool(q.get("required"))
        values = q.get("values", [])

        # Use central knowledge base for category detection (handles _systemfield_* paths)
        cat = lookup_field(label, name)[0]

        rf = ResolvedField(label=label, name=name, type=ftype, required=required, category=cat,
                           values=values or [])
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


def list_jobs(token: str) -> list[dict]:
    """Return list of jobs for an Ashby board."""
    r = requests.get(f"https://api.ashbyhq.com/posting-api/job-board/{token}",
                     headers={"User-Agent": UA["User-Agent"]}, timeout=20)
    r.raise_for_status()
    return r.json().get("jobs", [])


if __name__ == "__main__":
    import sys
    # demo: list jobs and resolve a form
    token = sys.argv[1] if len(sys.argv) > 1 else "anthropic"
    jobs = list_jobs(token)
    if not jobs:
        print(f"No jobs for {token}")
        sys.exit(1)
    jid = jobs[0]["id"]
    print(f"Fetching form for {token}/{jid}...")
    form = fetch_form(token, jid)
    print(f"Found {len(form)} fields:")
    for f in form:
        print(f"  {f['label'][:40]:40} ({f['type']:15}) req={f['required']}")

    demo = Profile(first_name="Alex", last_name="Doe", email="alex@example.com",
                   phone="+1 555 123 4567", location="San Francisco, CA",
                   linkedin_url="https://linkedin.com/in/alexdoe",
                   resume_url="resume.pdf", work_authorized=True, require_sponsorship=False)
    res = resolve(form, demo)
    print(f"\n{token} job {jid}: {res['ready_pct']}% ready ({res['ready_count']}/{res['total']}), "
          f"auto_ready={res['auto_ready']}, ai_needed={len(res['ai_needed'])}, "
          f"user_needed={len(res['user_needed'])}")
    for r in res["resolved"]:
        print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:34]}")
