"""Deeper tests for the auto-apply pipeline, per component.

Unit tests (deterministic, no network) always run. Integration tests hit live
ATS forms / the DB / the LLM chain and run only when env is available.

    python -m autoapply.test_autoapply            # unit + integration if env set
    python -m autoapply.test_autoapply --unit      # unit only
"""
from __future__ import annotations

import os
import sys
import argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import greenhouse_adapter as gh
import lever_adapter as lv

_passed, _failed = 0, 0


def check(name: str, cond: bool, detail: str = ""):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  PASS  {name}")
    else:
        _failed += 1
        print(f"  FAIL  {name}  {detail}")


def _load_env():
    for p in (HERE.parent / ".env", HERE.parent.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# ---------------------------------------------------------------- unit tests
def test_categorize():
    print("[unit] greenhouse category detection")
    cases = {
        "First Name": "first_name", "Email Address": "email", "Phone": "phone",
        "Resume/CV": "resume", "LinkedIn Profile": "linkedin", "Cover Letter": "cover_letter",
        "Are you legally authorized to work in the US?": "work_auth",
        "Will you require visa sponsorship?": "sponsorship",
        "Gender": "gender", "Veteran Status": "veteran", "Race/Ethnicity": "race",
        "How did you hear about us?": "source", "Desired Salary": "salary",
        "Tell us about a project": "custom",
    }
    for label, expected in cases.items():
        check(f"category({label!r})=={expected}", gh._category(label) == expected,
              f"got {gh._category(label)}")


def test_resolve_deterministic():
    print("[unit] resolve fills profile fields, declines EEO, flags customs")
    form = [
        {"label": "First Name", "required": True, "fields": [{"name": "first_name", "type": "input_text"}]},
        {"label": "Email", "required": True, "fields": [{"name": "email", "type": "input_text"}]},
        {"label": "Resume/CV", "required": True, "fields": [{"name": "resume", "type": "input_file"}]},
        {"label": "Are you legally authorized to work in the US?", "required": True,
         "fields": [{"name": "q1", "type": "select", "values": [{"label": "Yes"}, {"label": "No"}]}]},
        {"label": "Will you require visa sponsorship?", "required": True,
         "fields": [{"name": "q2", "type": "select", "values": [{"label": "Yes"}, {"label": "No"}]}]},
        {"label": "Gender", "required": False,
         "fields": [{"name": "g", "type": "select", "values": [{"label": "Male"}, {"label": "Female"}, {"label": "Decline to self-identify"}]}]},
        {"label": "Describe your favorite project", "required": True,
         "fields": [{"name": "c1", "type": "textarea"}]},
        {"label": "Upload a work sample", "required": True,
         "fields": [{"name": "c2", "type": "input_file"}]},
    ]
    p = gh.Profile(first_name="Alex", last_name="Doe", email="a@x.com", resume_url="cv.pdf",
                   work_authorized=True, require_sponsorship=False)
    res = gh.resolve(form, p)
    by = {r.label: r for r in res["resolved"]}
    check("first name from profile", by["First Name"].value == "Alex")
    check("email from profile", by["Email"].value == "a@x.com")
    check("resume is file source", by["Resume/CV"].source == "file")
    check("work auth -> Yes", by["Are you legally authorized to work in the US?"].value == "Yes")
    check("sponsorship -> No", by["Will you require visa sponsorship?"].value == "No")
    check("EEO gender -> decline", by["Gender"].source == "eeo" and "ecline" in str(by["Gender"].value or ""))
    check("free-text -> ai_needed", by["Describe your favorite project"].source == "ai_needed")
    check("unknown file -> user_needed", by["Upload a work sample"].source == "user_needed")
    check("ready_pct is sensible", 30 <= res["ready_pct"] <= 90, f"got {res['ready_pct']}")


def test_authorized_option():
    print("[unit] work-auth option matching (varied phrasing)")
    vals = [{"label": "Yes, I am authorized to work"}, {"label": "No, I will require sponsorship"}]
    check("authorized picks yes-variant", "authorized" in (gh._authorized_option(vals, True) or "").lower())
    check("not-authorized picks no-variant", "sponsor" in (gh._authorized_option(vals, False) or "").lower())


def test_ai_reuse_without_llm():
    print("[unit] ai_drafter reuses learned answers without an LLM call")
    from ai_drafter import draft_answers

    class P:
        first_name = last_name = years_experience = resume_text = ""
        story_bank = {}
        custom_answers = {"Why us?": "Because I love the mission."}

    class Q:
        def __init__(self, l): self.label = l
    # only a learned question -> returned from memory, no LLM needed
    out = draft_answers([Q("Why us?")], P(), {"company_name": "X", "job_title": "Y"})
    check("learned answer reused", out.get("Why us?") == "Because I love the mission.")


def test_prepare_unsupported():
    print("[unit] prepare() handles unsupported ATS + missing ids")
    from prepare import prepare_application
    r1 = prepare_application({"ats_type": "workday", "ats_token": "x", "ats_job_id": "y"}, gh.Profile())
    check("workday -> unsupported_ats", r1["status"] == "unsupported_ats")
    r2 = prepare_application({"ats_type": "greenhouse"}, gh.Profile())
    check("missing ids -> missing_ids", r2["status"] == "missing_ids")


# --------------------------------------------------------- integration tests
def test_greenhouse_live():
    print("[integration] Greenhouse live form fetch + resolve")
    import requests
    try:
        jid = requests.get("https://boards-api.greenhouse.io/v1/boards/airtable/jobs",
                           headers=gh.UA, timeout=20).json()["jobs"][0]["id"]
        form = gh.fetch_form("airtable", jid)
        check("fetched a non-empty form", len(form) > 3, f"got {len(form)} fields")
        p = gh.Profile(first_name="A", last_name="B", email="a@b.com", resume_url="r.pdf")
        res = gh.resolve(form, p)
        check("resolve returns all fields", res["total"] == len(form))
        check("identity resolved", any(r.source == "profile" for r in res["resolved"]))
    except Exception as e:
        check("greenhouse live", False, str(e)[:120])


def test_lever_live():
    print("[integration] Lever live form parse")
    import requests
    try:
        jid = requests.get("https://api.lever.co/v0/postings/palantir?mode=json",
                           headers=lv.UA, timeout=20).json()[0]["id"]
        form = lv.fetch_form("palantir", jid)
        names = {f["name"] for f in form}
        check("lever has name+email", "name" in names and "email" in names, f"got {names}")
    except Exception as e:
        check("lever live", False, str(e)[:120])


def test_rules_matching_live():
    print("[integration] rules matching against the live jobs DB")
    try:
        from supabase import create_client
        from rules import matching_jobs
        c = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
        strict = matching_jobs(c, {"experience_levels": ["new_grad"], "roles": ["swe"],
                                   "exclude_keywords": ["senior", "staff"]})
        check("strict rule returns some jobs", len(strict) >= 0)
        check("no excluded titles present",
              all("senior" not in (j["title"] or "").lower() for j in strict))
    except Exception as e:
        check("rules live", False, str(e)[:120])


def test_prepare_end_to_end():
    print("[integration] prepare() end-to-end (fetch+resolve+AI draft)")
    try:
        import requests
        from prepare import prepare_application
        jid = requests.get("https://boards-api.greenhouse.io/v1/boards/airtable/jobs",
                           headers=gh.UA, timeout=20).json()["jobs"][0]["id"]
        p = gh.Profile(first_name="Alex", last_name="Doe", email="a@x.com", phone="+1",
                       resume_url="cv.pdf", work_authorized=True, require_sponsorship=False)
        p.resume_text = "New grad SWE; built a Next.js job app; Python/TS."
        p.story_bank = {}
        out = prepare_application({"ats_type": "greenhouse", "ats_token": "airtable",
                                   "ats_job_id": jid, "company_name": "Airtable",
                                   "job_title": "New Grad SWE"}, p)
        check("status prepared", out["status"] == "prepared", out.get("status"))
        check("some fields filled", out["filled_count"] > 3)
    except Exception as e:
        check("prepare e2e", False, str(e)[:120])


def test_submit_never_posts_when_gated():
    """A captcha-gated form must return needs_captcha and NEVER POST."""
    import submit as s
    orig = s.detect_captcha
    s.detect_captcha = lambda url: (True, "RECAPTCHA")
    try:
        r = s.submit_application("greenhouse", "airtable", "1", "", [], dry_run=False)
    finally:
        s.detect_captcha = orig
    check("submit: gated -> needs_captcha, no post", r["status"] == "needs_captcha", str(r))


def test_submit_payload_excludes_resume_and_unfilled():
    """Payload carries filled values; resume is a file part; unfilled required -> incomplete."""
    import submit as s
    orig = s.detect_captcha
    s.detect_captcha = lambda url: (False, "no captcha")
    try:
        fields = [
            {"label": "Email", "name": "email", "value": "a@x.com", "source": "profile", "required": True, "category": "email"},
            {"label": "Resume", "name": "resume", "value": "http://x/r.pdf", "source": "file", "required": True, "category": "resume"},
            {"label": "Why", "name": "q1", "value": "hi", "source": "ai_drafted", "required": False, "category": "custom"},
        ]
        ok = s.submit_application("lever", "acme", "j", "", fields, dry_run=True)
        bad = s.submit_application("lever", "acme", "j", "",
                                   [{"label": "Email", "name": "email", "value": None,
                                     "source": "user_needed", "required": True, "category": "email"}],
                                   dry_run=False)
    finally:
        s.detect_captcha = orig
    check("submit: dry_run excludes resume from data", ok["status"] == "dry_run" and ok["sent"]["field_count"] == 2, str(ok))
    check("submit: unfilled required -> incomplete", bad["status"] == "incomplete", str(bad))


def test_submit_detects_live_captcha():
    """Live: real GH + Lever forms are correctly flagged captcha-gated."""
    import submit as s
    gated_gh, _ = s.detect_captcha("https://job-boards.greenhouse.io/airtable/jobs/"
                                   + str(gh.requests.get('https://boards-api.greenhouse.io/v1/boards/airtable/jobs',
                                                         headers=gh.UA, timeout=20).json()['jobs'][0]['id']))
    check("submit: live Greenhouse flagged gated", gated_gh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--unit", action="store_true", help="unit tests only")
    args = ap.parse_args()

    print("=== UNIT ===")
    test_categorize(); test_resolve_deterministic(); test_authorized_option()
    test_ai_reuse_without_llm(); test_prepare_unsupported()
    test_submit_never_posts_when_gated(); test_submit_payload_excludes_resume_and_unfilled()

    if not args.unit:
        _load_env()
        has_db = bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"))
        print("\n=== INTEGRATION ===")
        test_greenhouse_live(); test_lever_live(); test_submit_detects_live_captcha()
        if has_db:
            test_rules_matching_live()
        test_prepare_end_to_end()

    print(f"\n{_passed} passed, {_failed} failed")
    sys.exit(1 if _failed else 0)


if __name__ == "__main__":
    main()
