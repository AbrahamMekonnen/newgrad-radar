"""Unified 'prepare application' engine — the fast replacement for browser-use.

Given a job + a user profile, it:
  1. fetches the real form via the right ATS adapter (greenhouse / lever / ...)
  2. resolves ~80% of fields deterministically from the profile (no LLM)
  3. AI-drafts ONLY the free-text gaps (cover letter, essays), grounded in the
     resume + story bank
  4. returns a fully-prepared application: every field with a value + source,
     what (if anything) still needs the user, and a ready %.

Submission stays human-in-the-loop: this produces the data; the user's browser
clears the final CAPTCHA + submit. No bot-detection evasion.

    from autoapply.prepare import prepare_application
    result = prepare_application(job_dict, profile)
"""
from __future__ import annotations

import sys
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import greenhouse_adapter as gh          # noqa: E402
import lever_adapter as lv               # noqa: E402
import ashby_adapter as ab               # noqa: E402
import smartrecruiters_adapter as sr     # noqa: E402
import bamboohr_adapter as bhr           # noqa: E402
import jobvite_adapter as jv             # noqa: E402
import jazzhr_adapter as jazz            # noqa: E402
import recruitee_adapter as rec          # noqa: E402
import breezyhr_adapter as breezy        # noqa: E402
import icims_adapter as icims            # noqa: E402
import taleo_adapter as taleo            # noqa: E402
import workday_adapter as wd             # noqa: E402
from ai_drafter import draft_answers     # noqa: E402

SUPPORTED = {"greenhouse", "lever", "ashby", "smartrecruiters", "bamboohr", "jobvite", "jazzhr", "recruitee", "breezyhr", "icims", "taleo", "workday"}


def prepare_application(job: dict, profile) -> dict:
    """job: {ats_type, ats_token, ats_job_id, company_name, job_title}. Returns a
    prepared-application dict. Never raises for a supported ATS."""
    ats = (job.get("ats_type") or "").lower()
    if ats not in SUPPORTED:
        return {"status": "unsupported_ats", "ats": ats, "fields": [],
                "message": f"{ats or 'unknown'} is not supported yet"}

    token, jid = job.get("ats_token"), job.get("ats_job_id")
    if not token or not jid:
        return {"status": "missing_ids", "ats": ats, "fields": []}

    try:
        if ats == "greenhouse":
            res = gh.resolve(gh.fetch_form(token, jid), profile)
        elif ats == "ashby":
            res = ab.resolve(ab.fetch_form(token, jid), profile)
        elif ats == "smartrecruiters":
            res = sr.resolve(sr.fetch_form(token, jid), profile)
        elif ats == "bamboohr":
            res = bhr.resolve(bhr.fetch_form(token, jid), profile)
        elif ats == "jobvite":
            res = jv.resolve(jv.fetch_form(token, jid), profile)
        elif ats == "jazzhr":
            res = jazz.resolve(jazz.fetch_form(token, jid), profile)
        elif ats == "recruitee":
            res = rec.resolve(rec.fetch_form(token, jid), profile)
        elif ats == "breezyhr":
            res = breezy.resolve(breezy.fetch_form(token, jid), profile)
        elif ats == "icims":
            res = icims.resolve(icims.fetch_form(token, jid), profile)
        elif ats == "taleo":
            res = taleo.resolve(taleo.fetch_form(token, jid), profile)
        elif ats == "workday":
            res = wd.resolve(wd.fetch_form(token, jid), profile)
        else:
            res = lv.resolve(lv.fetch_form(token, jid), profile)
    except Exception as e:
        return {"status": "form_fetch_failed", "ats": ats, "fields": [], "error": str(e)}

    # A form we couldn't read (e.g. Ashby's closed GraphQL, or a posting whose
    # form failed to parse) yields zero fields. Do NOT pass it off as a 0%-ready
    # "prepared" application — that just clutters the inbox with useless cards.
    if not res.get("resolved"):
        return {"status": "form_unavailable", "ats": ats, "fields": [],
                "message": f"could not read the {ats} application form"}

    # AI-draft the free-text gaps in one call, then fill them in.
    ai_fields = res["ai_needed"]
    drafts = {}
    if ai_fields:
        try:
            drafts = draft_answers(ai_fields, profile, {
                "company_name": job.get("company_name", ""),
                "job_title": job.get("job_title", ""),
            })
        except Exception:
            drafts = {}
    for r in res["resolved"]:
        if r.source == "ai_needed" and drafts.get(r.label):
            r.value, r.source = drafts[r.label], "ai_drafted"

    fields = [{"label": r.label, "name": r.name, "type": r.type, "required": r.required,
               "category": r.category, "value": r.value, "source": r.source,
               "values": getattr(r, "values", []) or []}
              for r in res["resolved"]]
    filled = [f for f in fields if f["source"] in ("profile", "matched", "eeo", "file", "ai_drafted")]
    user_needed = [f for f in fields if f["source"] == "user_needed" and f["required"]]
    total = len(fields) or 1

    return {
        "status": "prepared",
        "ats": ats,
        "company_name": job.get("company_name", ""),
        "job_title": job.get("job_title", ""),
        "ready_pct": round(100 * len(filled) / total),
        "filled_count": len(filled),
        "total_fields": len(fields),
        "ai_drafted_count": sum(1 for f in fields if f["source"] == "ai_drafted"),
        "needs_user": user_needed,          # required fields we won't guess
        "auto_ready": len(user_needed) == 0,  # can be prepared with zero user input
        "fields": fields,
    }


if __name__ == "__main__":
    # load env for the LLM chain
    import os
    for p in (HERE.parent / ".env", HERE.parent.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

    import requests
    ats = sys.argv[1] if len(sys.argv) > 1 else "greenhouse"
    token = sys.argv[2] if len(sys.argv) > 2 else ("airtable" if ats == "greenhouse" else "palantir")
    if ats == "greenhouse":
        jid = requests.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs",
                           headers=gh.UA, timeout=20).json()["jobs"][0]["id"]
    else:
        jid = requests.get(f"https://api.lever.co/v0/postings/{token}?mode=json",
                           headers=lv.UA, timeout=20).json()[0]["id"]

    prof = gh.Profile(
        first_name="Alex", last_name="Doe", email="alex@example.com", phone="+1 555 123 4567",
        location="San Francisco, CA", linkedin_url="https://linkedin.com/in/alexdoe",
        github_url="https://github.com/alexdoe", resume_url="resume.pdf",
        work_authorized=True, require_sponsorship=False, willing_to_relocate=True,
        years_experience="1",
    )
    prof.resume_text = ("New-grad SWE. Built a job-tracking web app (Next.js/Supabase). "
                        "Fintech internship: shipped a payments dashboard for 300 merchants. Python, TS.")
    prof.story_bank = {"Proud of": "Shipping the payments dashboard solo in 6 weeks."}

    out = prepare_application({"ats_type": ats, "ats_token": token, "ats_job_id": jid,
                               "company_name": token.title(), "job_title": "New Grad SWE"}, prof)
    print(f"{out['status']} | {ats}/{token} | ready {out.get('ready_pct')}% "
          f"({out.get('filled_count')}/{out.get('total_fields')}), "
          f"ai_drafted={out.get('ai_drafted_count')}, auto_ready={out.get('auto_ready')}, "
          f"needs_user={len(out.get('needs_user', []))}")
    for f in out.get("fields", []):
        print(f"  [{f['source']:11}] {f['label'][:40]:40} -> {str(f['value'])[:36]}")
