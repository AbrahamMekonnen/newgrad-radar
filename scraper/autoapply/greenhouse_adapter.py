"""Deterministic Greenhouse application adapter.

Given a Greenhouse job + a user profile, fetch the real form (structured
?questions=true API) and RESOLVE every field to a value, deterministically,
with no LLM for the ~80% that are standard. Returns exactly what's ready, what
still needs an AI draft (free-text customs), and what needs the user (unknown
required fields) — plus a ready % so the UI can show "18/20 filled".

This is the fast replacement for the browser-use agent: no per-field LLM steps,
just a dictionary lookup + option matching. Submission stays human-in-the-loop
(the user clears the final CAPTCHA in their own browser); this prepares the data.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; hireradar-autoapply)"}


# ---- profile ----------------------------------------------------------------
@dataclass
class Profile:
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    linkedin_url: str = ""
    github_url: str = ""
    portfolio_url: str = ""
    resume_url: str = ""                     # file to upload (handled at submit)
    work_authorized: Optional[bool] = None   # authorized to work in US
    require_sponsorship: Optional[bool] = None
    years_experience: str = ""
    start_date: str = ""                     # e.g. "Immediately"
    salary_expectation: str = ""
    willing_to_relocate: Optional[bool] = None
    how_heard: str = "Company website"
    custom_answers: dict = field(default_factory=dict)  # learned {question: answer}


@dataclass
class ResolvedField:
    label: str
    name: str            # the actual Greenhouse form field name
    type: str
    required: bool
    category: str
    value: Optional[object] = None
    source: str = "unfilled"   # profile | matched | eeo | ai_needed | user_needed | file
    values: list = field(default_factory=list)  # dropdown options [{label,value}]


# ---- form fetch -------------------------------------------------------------
def fetch_form(token: str, job_id) -> list[dict]:
    """Return Greenhouse questions: [{label, required, fields:[{name,type,values}]}]."""
    r = requests.get(
        f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?questions=true",
        headers=UA, timeout=20,
    )
    r.raise_for_status()
    return r.json().get("questions", [])


# ---- option matching (for selects/dropdowns) --------------------------------
def _match_option(values: list[dict], *wanted: str) -> Optional[str]:
    """Pick the option whose label/value contains any wanted substring."""
    for v in values or []:
        label = str(v.get("label", "")).lower()
        for w in wanted:
            if w in label:
                return v.get("value", v.get("label"))
    return None


def _decline_option(values: list[dict]) -> Optional[str]:
    return _match_option(values, "decline", "prefer not", "don't wish", "do not wish",
                         "not to disclose", "not to answer")


def _yesno(values: list[dict], yes: bool) -> Optional[str]:
    return _match_option(values, "yes") if yes else _match_option(values, "no")


def _authorized_option(values: list[dict], authorized: bool) -> Optional[str]:
    """Match work-authorization options, which use varied phrasing beyond yes/no
    (e.g. 'I am authorized to work', 'No, I will require sponsorship')."""
    for v in values or []:
        lo = str(v.get("label", "")).lower()
        neg = any(k in lo for k in ("not ", "n't", "require sponsor", "will require", "do not"))
        pos = lo.startswith("yes") or ("authorized" in lo and not neg) or ("do not require" in lo)
        if authorized and (lo.startswith("yes") or ("authorized" in lo and not neg)):
            return v.get("value", v.get("label"))
        if not authorized and (lo.startswith("no") or neg):
            return v.get("value", v.get("label"))
        _ = pos
    return _yesno(values, authorized)


# ---- category detection (label-driven) --------------------------------------
_CAT = [
    ("first_name", r"\bfirst name\b"),
    ("last_name",  r"\blast name\b"),
    ("full_name",  r"\b(full name|^name$|legal name)\b"),
    ("email",      r"\bemail\b"),
    ("phone",      r"\bphone|mobile\b"),
    ("resume",     r"\bresume|cv\b"),
    ("cover_letter", r"\bcover letter\b"),
    ("linkedin",   r"\blinkedin\b"),
    ("github",     r"\bgithub\b"),
    ("portfolio",  r"\bportfolio|website|personal site\b"),
    ("location",   r"\b(location|city|current location|address|zip|postal)\b"),
    # sponsorship BEFORE work_auth: a "sponsorship for work authorization"
    # question is about sponsorship, not work auth. sponsor\w* so "sponsorship"
    # matches, not just the bare word "sponsor".
    ("sponsorship", r"\b(sponsor\w*|visa)\b"),
    # authoriz\w* so "authorization"/"authorized" match (bare \bauthoriz\b never did).
    ("work_auth",  r"\b(authoriz\w*|eligible to work|legally.*work|work permit)\b"),
    ("relocate",   r"\brelocat\b"),
    ("salary",     r"\b(salary|compensation|pay expectation|desired|expected comp)\b"),
    # "notice period", not bare "notice" — else "Privacy Notice" mis-matched here.
    ("start_date", r"\b(start date|available|availability|notice period)\b"),
    ("source",     r"\b(how did you hear|referr|where did you)\b"),
    # Acknowledgement / consent checkboxes — never auto-answered; the user ticks
    # these explicitly in the completion box.
    ("consent",    r"\b(acknowledge|consent|agree to|arbitration|privacy notice|terms|i have read)\b"),
    ("gender",     r"\bgender\b"),
    ("race",       r"\b(race|ethnic|hispanic|latino)\b"),
    ("veteran",    r"\bveteran\b"),
    ("disability", r"\bdisab\b"),
    ("age",        r"\b(18\+|are you .*18|at least 18|age of 18)\b"),
    ("experience", r"\byears? (of )?experience\b"),
]


def _category(label: str) -> str:
    lo = (label or "").lower()
    for cat, pat in _CAT:
        if re.search(pat, lo):
            return cat
    return "custom"


# ---- resolve ----------------------------------------------------------------
def resolve(questions: list[dict], p: Profile) -> dict:
    """Resolve every form field from the profile. Returns a summary dict."""
    resolved: list[ResolvedField] = []
    for q in questions:
        label = q.get("label", "")
        required = bool(q.get("required"))
        gfields = q.get("fields", []) or [{}]
        # a question can have multiple fields (e.g. resume: file + text). Use the first.
        gf = gfields[0]
        name = gf.get("name", "")
        ftype = gf.get("type", "")
        values = gf.get("values", [])
        cat = _category(label)
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
        "ai_needed": ai_needed,          # free-text customs -> draft with AI
        "user_needed": user_needed,      # required unknowns -> ask the user once
        "auto_ready": len(user_needed) == 0,  # can be prepared with no user input
    }


def _resolve_one(cat, ftype, values, p: Profile, label: str):
    """Return (value, source) for one field."""
    simple = {
        "first_name": p.first_name, "last_name": p.last_name, "email": p.email,
        "phone": p.phone, "linkedin": p.linkedin_url, "github": p.github_url,
        "portfolio": p.portfolio_url, "location": p.location,
        "salary": p.salary_expectation, "experience": p.years_experience,
    }
    if cat == "full_name":
        return (f"{p.first_name} {p.last_name}".strip() or None,
                "profile" if p.first_name else "user_needed")
    if cat in simple:
        v = simple[cat]
        return (v, "profile") if v else ("unfilled", "unfilled" if not _is_required_like(label) else "user_needed")
    if cat == "resume":
        return (p.resume_url or None, "file")
    if cat == "cover_letter":
        return (None, "ai_needed")   # optional AI draft
    if cat == "source":
        return (_match_option(values, p.how_heard.lower()) or p.how_heard, "matched")
    if cat == "work_auth" and p.work_authorized is not None:
        v = _authorized_option(values, p.work_authorized) if values else ("Yes" if p.work_authorized else "No")
        return (v, "matched") if v else (None, "user_needed")
    if cat == "sponsorship" and p.require_sponsorship is not None:
        # "will you require sponsorship?" -> Yes iff they require it.
        v = _yesno(values, p.require_sponsorship) if values else ("Yes" if p.require_sponsorship else "No")
        return (v, "matched") if v else (None, "user_needed")
    if cat == "relocate" and p.willing_to_relocate is not None:
        return (_yesno(values, p.willing_to_relocate) if values else ("Yes" if p.willing_to_relocate else "No"), "matched")
    if cat == "start_date":
        return (_match_option(values, "immediat", "flexible") or p.start_date or "Immediately", "matched")
    if cat in ("gender", "race", "veteran", "disability"):
        # EEO — default to decline unless the user set a value; never block.
        return (_decline_option(values), "eeo")
    if cat in ("consent", "age"):
        # Legal attestations (acknowledge/agree/18+) — never auto-answered; the
        # user ticks these once in the completion box.
        return (None, "user_needed")
    # custom question: check learned answers first
    if label and p.custom_answers.get(label):
        return (p.custom_answers[label], "profile")
    # unknown: free-text -> AI; select/choice -> ask user (we don't guess options)
    t = (ftype or "").lower()
    if "textarea" in t or t in ("input_text", "text"):
        return (None, "ai_needed")
    return (None, "user_needed")


def _is_required_like(label: str) -> bool:
    return bool(re.search(r"\b(email|name|phone|resume)\b", (label or "").lower()))


if __name__ == "__main__":
    import sys, json
    # demo: resolve a real Greenhouse form against a sample profile
    token = sys.argv[1] if len(sys.argv) > 1 else "stripe"
    jobs = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
                        headers=UA, timeout=20).json()["jobs"]
    jid = jobs[0]["id"]
    form = fetch_form(token, jid)
    demo = Profile(first_name="Alex", last_name="Doe", email="alex@example.com",
                   phone="+1 555 123 4567", location="San Francisco, CA",
                   linkedin_url="https://linkedin.com/in/alexdoe",
                   github_url="https://github.com/alexdoe", resume_url="resume.pdf",
                   work_authorized=True, require_sponsorship=False,
                   willing_to_relocate=True, years_experience="1")
    res = resolve(form, demo)
    print(f"{token} job {jid}: {res['ready_pct']}% ready ({res['ready_count']}/{res['total']}), "
          f"auto_ready={res['auto_ready']}, ai_needed={len(res['ai_needed'])}, "
          f"user_needed={len(res['user_needed'])}")
    for r in res["resolved"]:
        print(f"  [{r.source:11}] {r.label[:42]:42} -> {str(r.value)[:34]}")
