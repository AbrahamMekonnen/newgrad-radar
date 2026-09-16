"""Deterministic Lever application adapter.

Lever has no form API, so we parse the public apply page: standard fields
(name/email/phone/resume/urls[...]) plus custom questions (`cards[uuid][...]`)
whose labels sit next to them in the DOM. Resolves each field from the profile
using the SAME category->profile logic as the Greenhouse adapter, so behaviour
is consistent across ATSes.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from greenhouse_adapter import Profile, ResolvedField, _category, _resolve_one  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)"}

_STD = {
    "name": "Full name", "email": "Email", "phone": "Phone",
    "org": "Current company", "resume": "Resume/CV", "comments": "Additional information",
}


def fetch_form(token: str, job_id: str) -> list[dict]:
    """Return [{label, name, type, values}] parsed from the Lever apply page."""
    html = requests.get(f"https://jobs.lever.co/{token}/{job_id}/apply", headers=UA, timeout=25).text
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return _regex_fallback(html)
    soup = BeautifulSoup(html, "html.parser")
    fields, seen = [], set()

    # standard + url fields
    for inp in soup.select("input[name], textarea[name], select[name]"):
        name = inp.get("name", "")
        if not name or name in seen:
            continue
        if name in _STD:
            seen.add(name)
            fields.append({"label": _STD[name], "name": name,
                           "type": "textarea" if name == "comments" else "input", "values": []})
        elif name.startswith("urls["):
            seen.add(name)
            key = re.search(r"urls\[([^\]]+)\]", name)
            fields.append({"label": key.group(1) if key else name, "name": name,
                           "type": "input", "values": []})

    # custom questions: each application-question block has a label + card inputs
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
        fields.append({"label": label[:80], "name": name, "type": ftype, "values": values})
    return fields


def _regex_fallback(html: str) -> list[dict]:
    out, seen = [], set()
    for name in re.findall(r'name="([^"]+)"', html):
        if name in seen:
            continue
        seen.add(name)
        if name in _STD:
            out.append({"label": _STD[name], "name": name, "type": "input", "values": []})
        elif name.startswith("urls["):
            out.append({"label": name, "name": name, "type": "input", "values": []})
    return out


def resolve(fields: list[dict], p: Profile) -> dict:
    resolved = []
    for f in fields:
        label, name = f["label"], f["name"]
        ftype, values = f.get("type", ""), f.get("values", [])
        required = name in ("name", "email")  # Lever marks few as hard-required
        cat = _category(label)
        val, src = _resolve_one(cat, ftype, values, p, label)
        resolved.append(ResolvedField(label=label, name=name, type=ftype, required=required,
                                      category=cat, value=val, source=src, values=values or []))
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
    token = sys.argv[1] if len(sys.argv) > 1 else "palantir"
    jobs = requests.get(f"https://api.lever.co/v0/postings/{token}?mode=json", headers=UA, timeout=20).json()
    jid = jobs[0]["id"]
    demo = Profile(first_name="Alex", last_name="Doe", email="a@x.com", phone="+15551234567",
                   linkedin_url="https://linkedin.com/in/alexdoe", github_url="https://github.com/alexdoe",
                   resume_url="resume.pdf", work_authorized=True, require_sponsorship=False)
    res = resolve(fetch_form(token, jid), demo)
    print(f"{token} job {jid}: {res['ready_pct']}% ready ({res['ready_count']}/{res['total']}), "
          f"ai_needed={len(res['ai_needed'])}, user_needed={len(res['user_needed'])}")
    for r in res["resolved"]:
        print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:30]}")
