"""LLM-based context-aware enrichment for interview questions.

Regex company detection only sees whether a company name appears in the text —
it can't read context ("it was Stripe, not Amazon; I interviewed at Amazon last
month"). This module uses Gemini to assign the company each question was
actually asked at, based on the surrounding message.

Designed to be cheap and fail-safe:
- Batches many messages into one prompt (company-only, so batching is safe).
- Bounded by a per-run call budget.
- Any failure (no key, quota, bad JSON) falls back to the regex answer — the
  caller keeps whatever it already had.
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import List, Optional

import logging

logger = logging.getLogger(__name__)

_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

_genai = None
_configured = False


def _get_model():
    """Lazily configure Gemini; return a model or None if unavailable."""
    global _genai, _configured
    if _configured:
        return _genai
    _configured = True
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    import sys
    # The scraper's utils/ dir (on sys.path) contains a queue.py that shadows
    # the stdlib 'queue' module, which google.generativeai's grpc stack needs.
    # Import genai with utils removed from the path and any shadowed 'queue'
    # dropped, then restore.
    saved_path = list(sys.path)
    bad_q = sys.modules.get("queue")
    if bad_q is not None and not hasattr(bad_q, "LifoQueue"):
        del sys.modules["queue"]
    sys.path[:] = [p for p in sys.path
                   if not p.replace("\\", "/").rstrip("/").endswith("/utils")]
    try:
        import warnings
        warnings.filterwarnings("ignore")
        import queue  # noqa: F401  (force stdlib queue back into sys.modules)
        import google.generativeai as genai
        genai.configure(api_key=key)
        _genai = genai.GenerativeModel(_MODEL)
    except Exception as e:  # pragma: no cover - env dependent
        logger.warning(f"LLM enrich: Gemini unavailable ({e})")
        _genai = None
    finally:
        sys.path[:] = saved_path
    return _genai


_GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")


def _groq_generate(prompt: str) -> Optional[str]:
    """Call Groq's OpenAI-compatible endpoint (via requests — no extra dep)."""
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        return None
    try:
        import requests
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": _GROQ_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
            },
            timeout=60,
        )
        if r.status_code == 200:
            return r.json()["choices"][0]["message"]["content"]
        logger.debug(f"Groq {r.status_code}: {r.text[:200]}")
    except Exception as e:
        logger.debug(f"Groq call failed: {e}")
    return None


def _generate(prompt: str) -> Optional[str]:
    """Provider-agnostic text generation: Gemini first, Groq as fallback.

    Falls back to Groq whenever Gemini is unavailable, errors, hits quota, or
    returns nothing — so enrichment keeps working when one provider is down.
    """
    model = _get_model()
    if model is not None:
        try:
            resp = model.generate_content(prompt)
            text = getattr(resp, "text", "") or ""
            if text.strip():
                return text
        except Exception as e:
            logger.debug(f"Gemini generate failed, trying Groq: {e}")
    return _groq_generate(prompt)


def llm_available() -> bool:
    return _get_model() is not None or bool(os.environ.get("GROQ_API_KEY"))


_JSON_RE = re.compile(r"\{.*\}|\[.*\]", re.DOTALL)


def _parse_json(text: str):
    if not text:
        return None
    # strip ``` fences and locate the JSON body
    text = text.strip().strip("`")
    m = _JSON_RE.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


_VALID_TYPES = {"technical_coding", "technical_conceptual", "system_design",
                "behavioral", "oa", "case_study", "take_home", "brain_teaser", "other"}
_VALID_DIFF = {"easy", "medium", "hard", "unknown"}

_EXTRACT_PROMPT = (
    "You extract REAL technical interview questions from messy chat messages in "
    "interview-prep groups. For EACH numbered message, return the interview "
    "questions it contains. Treat every message INDEPENDENTLY — never carry a "
    "company or detail from one message into another.\n"
    "For each question output: company (the company it was actually asked at, "
    "judged from that message's context, else null), role (backend/frontend/"
    "swe/ml/data/mobile/infra or null), question_type (one of technical_coding, "
    "technical_conceptual, system_design, behavioral, oa, other), difficulty "
    "(easy/medium/hard/unknown), question_text (the cleaned question).\n"
    "IGNORE prep advice ('practice daily'), ads, greetings, and non-technical "
    "questions (visa/immigration/admissions). If a message has no real question, "
    "give it an empty array.\n"
    'Reply ONLY with a JSON object mapping the message number (string) to an '
    'array of question objects. Example: {"0":[{"company":"Stripe","role":'
    '"backend","question_type":"system_design","difficulty":"medium",'
    '"question_text":"Design a rate limiter"}],"1":[]}\n\n'
)


def extract_batch(
    messages: List[str],
    batch_size: int = 6,
    max_calls: int = 120,
    pause: float = 0.4,
) -> Optional[List[List[dict]]]:
    """Context-aware extraction. Returns a per-message list of question dicts.

    ``result[i]`` is the list of question dicts extracted from ``messages[i]``
    (possibly empty). Returns None if the LLM is unavailable so the caller can
    fall back to regex. Messages beyond the call budget come back as [] (the
    caller should regex-handle those). Never raises.
    """
    if not llm_available() or not messages:
        return None
    # None = not processed (caller should regex-fallback); a list = processed by
    # the LLM (trust it, even when empty — regex would only re-add noise).
    out: List[Optional[List[dict]]] = [None for _ in messages]
    calls = 0
    for start in range(0, len(messages), batch_size):
        if calls >= max_calls:
            break
        batch = messages[start:start + batch_size]
        numbered = "\n\n".join(f"[{i}] {m[:1200]}" for i, m in enumerate(batch))
        calls += 1
        data = _parse_json(_generate(_EXTRACT_PROMPT + numbered + "\n\nJSON:") or "")
        if isinstance(data, dict):
            # call succeeded: default every message in this batch to [] (trust
            # "no questions"), then fill in what the model returned.
            for j in range(len(batch)):
                out[start + j] = []
            for k, v in data.items():
                try:
                    idx = int(k)
                except (TypeError, ValueError):
                    continue
                if not (0 <= idx < len(batch)) or not isinstance(v, list):
                    continue
                cleaned = []
                for item in v:
                    if not isinstance(item, dict):
                        continue
                    qt = (item.get("question_text") or "").strip()
                    if len(qt) < 10:
                        continue
                    typ = (item.get("question_type") or "other").lower()
                    diff = (item.get("difficulty") or "unknown").lower()
                    comp = item.get("company")
                    cleaned.append({
                        "question_text": qt,
                        "company": comp.strip() if isinstance(comp, str) and comp.strip()
                                   and comp.strip().lower() not in ("null", "none", "unknown") else None,
                        "role": (item.get("role") or None),
                        "question_type": typ if typ in _VALID_TYPES else "other",
                        "difficulty": diff if diff in _VALID_DIFF else "unknown",
                    })
                out[start + idx] = cleaned
        if pause:
            time.sleep(pause)
    return out


def assign_companies(
    messages: List[str],
    batch_size: int = 12,
    max_calls: int = 300,
    pause: float = 0.4,
) -> List[Optional[str]]:
    """Return a company name (or None) for each message, judged from context.

    ``messages[i]`` is the full source message for question i. Returns a list of
    the same length; entries are a company name string or None (unknown / not
    determinable / LLM unavailable). Never raises.
    """
    out: List[Optional[str]] = [None] * len(messages)
    if not llm_available() or not messages:
        return out

    calls = 0
    for start in range(0, len(messages), batch_size):
        if calls >= max_calls:
            logger.info(f"LLM enrich: hit call budget ({max_calls}), rest left to regex")
            break
        batch = messages[start:start + batch_size]
        numbered = "\n\n".join(
            f"[{i}] {m[:900]}" for i, m in enumerate(batch)
        )
        prompt = (
            "For each numbered chat message below from an interview-prep group, "
            "identify the company the interview question(s) in that message were "
            "actually asked at, using the message's CONTEXT (not just any company "
            "name mentioned). If the message names an unrelated company or none "
            "can be confidently determined, use null.\n"
            'Reply ONLY with a JSON object mapping the number (as a string) to the '
            'company name or null, e.g. {"0":"Stripe","1":null}.\n\n'
            + numbered
            + "\n\nJSON:"
        )
        calls += 1
        data = _parse_json(_generate(prompt) or "")
        if isinstance(data, dict):
            for k, v in data.items():
                try:
                    idx = int(k)
                except (TypeError, ValueError):
                    continue
                if 0 <= idx < len(batch) and isinstance(v, str):
                    name = v.strip()
                    if name and name.lower() not in ("null", "none", "unknown", "n/a"):
                        out[start + idx] = name
        if pause:
            time.sleep(pause)
    return out
