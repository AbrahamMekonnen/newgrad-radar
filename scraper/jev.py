"""Jev decision engine via the Vercel AI Gateway HTTP evaluation API.

Jev (TypeSafe AI) is a non-LLM "System 1" model: instead of generating text it
answers TYPED questions about a piece of state — boolean (yes/no probability),
choice (pick one option), score (rubric) — all in one fast call with calibrated
confidence. That's a perfect, cheap, high-throughput fit for our DECISION work:
classifying jobs (role / level / is-technical / sponsorship) and gating scraped
interview questions (real vs junk, type, difficulty).

Design rules:
- Never raises. Any problem (missing key, unverified account, network, non-200,
  bad shape) returns None so callers fall back to their existing heuristics/LLM.
- One HTTP call can carry many questions (answered in parallel).
- Model + endpoint are fixed to Jev on the Vercel AI Gateway.
"""
from __future__ import annotations

import os
import logging
from typing import Any, Optional

import requests

logger = logging.getLogger("jev")

GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/evaluate"
MODEL = "typesafe-ai/jev"
# Once the account is confirmed unverified/over-quota we stop hammering the API
# for the rest of the process run (avoids per-item latency on every fallback).
_disabled = False


def jev_available() -> bool:
    """True if a gateway key is configured and Jev hasn't been disabled this run."""
    return bool(os.getenv("AI_GATEWAY_API_KEY")) and not _disabled


def evaluate(state: Any, questions: dict, timeout: float = 12.0, retries: int = 0) -> Optional[dict]:
    """Evaluate `state` against typed `questions`; return the answers map or None.

    `questions` uses the Vercel AI Gateway shape, e.g.:
        {"is_real": {"type": "boolean", "instructions": "..."},
         "role": {"type": "choice", "instructions": "...", "criteria": {...}}}
    Returns the `answers` dict (same keys) or None on any failure.

    retries: how many times to retry on a 429 (upstream overload — Jev is new and
    frequently rate-limited) with exponential backoff. Default 0 = fast-fail, so
    the latency-sensitive live scrape falls back immediately; backfills pass a few.
    """
    global _disabled
    import time
    key = os.getenv("AI_GATEWAY_API_KEY")
    if not key or _disabled or not questions:
        return None
    attempt = 0
    while True:
        try:
            r = requests.post(
                GATEWAY_URL,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": MODEL, "state": state, "questions": questions},
                timeout=timeout,
            )
            if r.status_code == 200:
                answers = r.json().get("answers")
                return answers if isinstance(answers, dict) else None
            body = (r.text or "")[:200]
            # Billing/verification won't fix itself mid-run — disable to avoid
            # adding latency to every item's fallback path.
            if r.status_code in (402, 403) or "customer_verification" in body or "credit card" in body:
                _disabled = True
                logger.warning("Jev disabled for this run (account not enabled): %s", body)
                return None
            # 429 = upstream overload; retry with backoff if we have budget.
            if r.status_code == 429 and attempt < retries:
                time.sleep(min(8.0, 1.5 * (2 ** attempt)))
                attempt += 1
                continue
            logger.debug("Jev HTTP %s: %s", r.status_code, body)
            return None
        except Exception as e:
            if attempt < retries:
                time.sleep(min(8.0, 1.5 * (2 ** attempt)))
                attempt += 1
                continue
            logger.debug("Jev call failed: %s", e)
            return None


# --- Answer helpers -------------------------------------------------------

def boolean(answers: Optional[dict], key: str) -> Optional[float]:
    """Probability (0..1) for a boolean question, or None if unavailable."""
    a = (answers or {}).get(key)
    if isinstance(a, dict) and a.get("type") == "boolean":
        p = a.get("probability")
        if isinstance(p, (int, float)):
            return float(p)
    return None


def choice(answers: Optional[dict], key: str) -> tuple[Optional[str], float]:
    """(selected choice, confidence 0..1) for a choice question, or (None, 0)."""
    a = (answers or {}).get(key)
    if isinstance(a, dict) and a.get("type") == "choice":
        sel = a.get("choice")
        probs = a.get("probabilities") or {}
        conf = float(probs.get(sel, 0.0)) if sel in probs else 0.0
        if isinstance(sel, str):
            return sel, conf
    return None, 0.0


def score(answers: Optional[dict], key: str) -> Optional[float]:
    """Interpolated score for a score question, or None."""
    a = (answers or {}).get(key)
    if isinstance(a, dict) and a.get("type") == "score":
        s = a.get("score")
        if isinstance(s, (int, float)):
            return float(s)
    return None
