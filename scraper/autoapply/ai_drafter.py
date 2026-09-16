"""Draft the free-text application answers the deterministic adapters can't fill.

Only the ~20% of fields flagged `ai_needed` come here (cover letters, "why us",
short essays). Uses the shared LLM chain (Gemini -> Groq -> Cerebras -> ...),
grounded in the user's REAL background (resume text + story bank + work history)
so answers are honest and specific, never invented. Batches all of a form's
open questions into ONE call, and reuses learned answers so a question is only
ever drafted once per user.
"""
from __future__ import annotations

import os
import re
import sys
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ai_drafter")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "sources" / "interview_questions"))


def _background_block(profile) -> str:
    """Compact, factual context for the model — resume + story bank + history."""
    parts = []
    name = f"{getattr(profile, 'first_name', '')} {getattr(profile, 'last_name', '')}".strip()
    if name:
        parts.append(f"Applicant: {name}")
    if getattr(profile, "years_experience", ""):
        parts.append(f"Experience: {profile.years_experience} years")
    resume_text = getattr(profile, "resume_text", "") or ""
    if resume_text:
        parts.append("Resume (excerpt):\n" + resume_text[:2500])
    stories = getattr(profile, "story_bank", None) or {}
    if stories:
        parts.append("Story bank (their own words):")
        for q, a in list(stories.items())[:10]:
            parts.append(f"- {q}: {a}")
    return "\n".join(parts) if parts else "(no background provided)"


def draft_answers(questions: list, profile, job: dict, max_chars: int = 900) -> dict:
    """questions: list of ResolvedField (or objects with .label). Returns
    {label: drafted_answer}. Reuses learned custom_answers; drafts the rest in
    one LLM call. Never raises — a failure just leaves that answer for the user."""
    labels = [getattr(q, "label", str(q)) for q in questions]
    labels = [l for l in labels if l]
    if not labels:
        return {}

    # 1) Reuse the application answer library. Match exact and normalized
    # questions, then the compatible generated-answer category.
    learned = getattr(profile, "custom_answers", None) or {}
    normalized_learned = {
        " ".join(re.findall(r"[a-z0-9]+", str(key).lower())): value
        for key, value in learned.items()
    }
    category_aliases = {
        "why_interested": "motivation",
        "describe_project": "experience",
        "tell_about_yourself": "experience",
    }
    try:
        from field_knowledge_base import lookup_category
    except Exception:
        lookup_category = lambda _label: "custom"

    out, todo = {}, []
    for label in labels:
        normalized = " ".join(re.findall(r"[a-z0-9]+", label.lower()))
        category = lookup_category(label)
        answer = (
            learned.get(label)
            or normalized_learned.get(normalized)
            or learned.get(category)
            or learned.get(category_aliases.get(category, ""))
        )
        if answer:
            out[label] = answer
        else:
            todo.append(label)
    if not todo:
        return out

    # 2) draft the rest in one call
    import llm_enrich
    if not llm_enrich.llm_available():
        return out  # leave undrafted for the user

    numbered = "\n".join(f"[{i}] {q}" for i, q in enumerate(todo))
    prompt = (
        "You are helping a candidate fill a job application HONESTLY, using ONLY "
        "the background provided — never invent employers, dates, or achievements. "
        "Write a concise, specific, first-person answer to each numbered question, "
        f"max ~{max_chars} characters each; for a cover letter, tailor it to the "
        "company and role below. If the background lacks the info to answer "
        "truthfully, return an empty string for that item.\n\n"
        f"COMPANY: {job.get('company_name','')}\nROLE: {job.get('job_title','')}\n\n"
        f"BACKGROUND:\n{_background_block(profile)}\n\n"
        f"QUESTIONS:\n{numbered}\n\n"
        'Reply ONLY with a JSON object mapping the number (string) to the answer '
        'string, e.g. {"0":"...","1":"..."}.'
    )
    # Retry a few times: under parallel prepare the free LLM tiers get briefly
    # rate-limited and return empty, which would silently leave essays unfilled.
    import time
    data = {}
    for attempt in range(3):
        data = llm_enrich._parse_json(llm_enrich._generate(prompt) or "")
        if isinstance(data, dict) and any(str(v).strip() for v in data.values()):
            break
        time.sleep(1.5 * (attempt + 1))
    if isinstance(data, dict):
        for k, v in data.items():
            try:
                idx = int(k)
            except (TypeError, ValueError):
                continue
            if 0 <= idx < len(todo) and isinstance(v, str) and v.strip():
                out[todo[idx]] = v.strip()
    return out


if __name__ == "__main__":
    # tiny smoke test with a fake profile
    for p in (HERE.parent / ".env", HERE.parent.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

    class P:
        first_name, last_name, years_experience = "Alex", "Doe", "1"
        resume_text = ("New-grad software engineer. Built a job-tracking web app "
                       "(Next.js, Supabase). Internship at a fintech startup: shipped "
                       "a payments dashboard used by 300 merchants. Strong in Python, TS.")
        story_bank = {"What are you proud of?": "Shipping the payments dashboard solo in 6 weeks."}
        custom_answers = {}

    class Q:
        def __init__(self, l): self.label = l
    qs = [Q("Cover Letter"), Q("Why do you want to work here?"),
          Q("Describe a project you're proud of.")]
    res = draft_answers(qs, P(), {"company_name": "Stripe", "job_title": "New Grad SWE"})
    print(json.dumps({k: v[:120] for k, v in res.items()}, indent=2))
