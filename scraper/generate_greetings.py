"""Weekly: generate a fresh pool of fun dashboard greeting lines via the LLM
chain and store them in site_content (key='greeting_lines').

The frontend reads these and rotates through them by time bucket, so the
dashboard subtitle stays fresh without any runtime AI cost. Falls back to the
baked-in lines in the app if this table is empty or the job hasn't run.
"""
from __future__ import annotations

import os
import sys
import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("generate_greetings")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "sources" / "interview_questions"))


def _load_env() -> None:
    for p in (HERE / ".env", HERE.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_PROMPT = (
    "Write 25 short, upbeat one-liners for the subtitle of a tech-job-search "
    "dashboard. Each should be witty and encouraging, about job hunting, "
    "applying, interviews, or landing a role — the kind of line that makes a "
    "job seeker smile and keep going. Rules: max ~60 characters each, no emojis, "
    "no hashtags, no quotes around them, varied (don't repeat a structure), "
    "clean and inclusive, present tense, no company names.\n"
    'Reply ONLY with a JSON array of 25 strings. Example: '
    '["Your dream job is out there refreshing its careers page.", "..."]'
)


def _clean(lines) -> list:
    out, seen = [], set()
    for s in lines if isinstance(lines, list) else []:
        if not isinstance(s, str):
            continue
        s = s.strip().strip('"').strip()
        if 8 <= len(s) <= 90 and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


def main() -> None:
    _load_env()
    import llm_enrich
    if not llm_enrich.llm_available():
        logger.error("No LLM available (set GEMINI_API_KEY / GROQ_API_KEY / etc.)")
        return
    logger.info(f"LLM providers: {llm_enrich.available_llm_providers()}")

    import time
    lines: list = []
    for attempt in range(5):
        raw = llm_enrich._generate(_PROMPT)
        lines = _clean(llm_enrich._parse_json(raw or ""))
        if len(lines) >= 8:
            break
        logger.info(f"attempt {attempt + 1}: got {len(lines)} lines, retrying…")
        time.sleep(3 * (attempt + 1))
    if len(lines) < 8:
        logger.error(f"generation produced too few lines ({len(lines)}); leaving existing")
        return
    logger.info(f"generated {len(lines)} greeting lines")

    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    import datetime as dt
    client.table("site_content").upsert({
        "key": "greeting_lines",
        "value": lines,
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }, on_conflict="key").execute()
    logger.info(f"DONE: stored {len(lines)} greeting lines")


if __name__ == "__main__":
    main()
