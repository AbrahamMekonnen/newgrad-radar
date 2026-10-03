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

# Two interchangeable backends speak the Jev System-One contract:
#   1. Vercel AI Gateway ("typesafe-ai/jev"): POST /v1/evaluate, question type
#      "boolean", answer {type:"boolean", probability}. Gated to PAID accounts
#      (free tier lost access Sep 2026 — hence the fallback below).
#   2. OpenJev / Codiv (open-source, github.com/razorback16/openjev): the same
#      System-One idea on DiffusionGemma. Free hosted tier at codiv.ai gives
#      100M tokens with no card, so cleanup effectively never runs out. Different
#      wire dialect: POST /v1/systemone, question type "noul", answer
#      {noul: <prob>, confidence: <0..1>}. Self-hostable (needs a GPU) if the
#      hosted tier ever changes.
# We prefer OpenJev when its key is set (the un-gated, never-run-out path) and
# fall back to the Vercel gateway otherwise. evaluate() NORMALIZES both into the
# same answer shape, so backfill/quality callers are backend-agnostic.
GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/evaluate"
MODEL = "typesafe-ai/jev"
OPENJEV_MODEL = os.getenv("OPENJEV_MODEL", "openjev-latest")
# Once the account is confirmed unverified/over-quota we stop hammering the API
# for the rest of the process run (avoids per-item latency on every fallback).
_disabled = False


def _openjev_key() -> Optional[str]:
    return (os.getenv("OPENJEV_API_KEY") or os.getenv("CODIV_API_KEY")
            or os.getenv("TYPESAFE_API_KEY"))


def _openjev_base() -> str:
    return (os.getenv("OPENJEV_BASE_URL") or "https://api.codiv.ai").rstrip("/")


def jev_available() -> bool:
    """True if ANY backend key is configured and Jev hasn't been disabled this run."""
    return bool(_openjev_key() or os.getenv("AI_GATEWAY_API_KEY")) and not _disabled


def evaluate(state: Any, questions: dict, timeout: float = 12.0, retries: int = 0) -> Optional[dict]:
    """Evaluate `state` against typed `questions`; return the answers map or None.

    `questions` uses the Jev shape, e.g.:
        {"is_real": {"type": "boolean", "instructions": "...", "criteria": {...}},
         "role": {"type": "choice", "instructions": "...", "criteria": {...}}}
    Returns the `answers` dict (same keys), NORMALIZED to the Vercel shape
    regardless of backend, so callers use boolean()/choice()/score()/confidence()
    unchanged. Returns None on any failure.

    Prefers OpenJev/Codiv (free, un-gated) when its key is set, else the Vercel
    gateway. retries: 429 backoff budget (0 = fast-fail for the live scrape;
    backfills pass a few).
    """
    if _disabled or not questions:
        return None
    ok = _openjev_key()
    if ok:
        return _evaluate_openjev(ok, state, questions, timeout, retries)
    vk = os.getenv("AI_GATEWAY_API_KEY")
    if vk:
        return _evaluate_vercel(vk, state, questions, timeout, retries)
    return None


def _request_with_retries(url: str, headers: dict, payload: dict, timeout: float, retries: int):
    """POST with 429 backoff. Returns the response, or None on exhausted retries/
    network error. Raises nothing."""
    import time
    attempt = 0
    while True:
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=timeout)
            if r.status_code == 429 and attempt < retries:
                time.sleep(min(8.0, 1.5 * (2 ** attempt)))
                attempt += 1
                continue
            return r
        except Exception as e:
            if attempt < retries:
                time.sleep(min(8.0, 1.5 * (2 ** attempt)))
                attempt += 1
                continue
            logger.debug("Jev call failed: %s", e)
            return None


def _evaluate_vercel(key: str, state: Any, questions: dict, timeout: float, retries: int) -> Optional[dict]:
    global _disabled
    r = _request_with_retries(
        GATEWAY_URL,
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        {"model": MODEL, "state": state, "questions": questions},
        timeout, retries,
    )
    if r is None:
        return None
    if r.status_code == 200:
        answers = r.json().get("answers")
        return answers if isinstance(answers, dict) else None
    body = (r.text or "")[:200]
    if r.status_code in (402, 403) or "customer_verification" in body or "credit card" in body:
        _disabled = True
        logger.warning("Jev (Vercel) disabled for this run (account not enabled): %s", body)
        return None
    logger.debug("Jev (Vercel) HTTP %s: %s", r.status_code, body)
    return None


def _evaluate_openjev(key: str, state: Any, questions: dict, timeout: float, retries: int) -> Optional[dict]:
    """OpenJev/Codiv dialect: POST /v1/systemone, question type 'noul' for yes/no,
    answers come back as {noul, confidence}. We translate the request type and
    normalize the response to the Vercel shape so callers don't change."""
    global _disabled
    # Translate our "boolean" questions to OpenJev's "noul"; choice/score pass through.
    tq = {}
    for qid, q in questions.items():
        if isinstance(q, dict) and q.get("type") == "boolean":
            q = {**q, "type": "noul"}
        tq[qid] = q
    r = _request_with_retries(
        f"{_openjev_base()}/v1/systemone",
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        {"model": OPENJEV_MODEL, "state": state, "questions": tq},
        timeout, retries,
    )
    if r is None:
        return None
    if r.status_code == 200:
        raw = r.json().get("answers")
        return _normalize_openjev(raw) if isinstance(raw, dict) else None
    body = (r.text or "")[:200]
    # Quota exhaustion / auth won't fix itself mid-run — disable to avoid per-item latency.
    if r.status_code in (401, 402, 403) or "quota" in body.lower() or "credit" in body.lower():
        _disabled = True
        logger.warning("OpenJev/Codiv disabled for this run (auth/quota): %s", body)
        return None
    logger.debug("OpenJev HTTP %s: %s", r.status_code, body)
    return None


def _normalize_openjev(raw: dict) -> dict:
    """Map OpenJev answers to the Vercel answer shape the helpers expect:
      noul   -> {type:'boolean', probability, confidence}
      choice -> {type:'choice', choice, probabilities, confidence}
      score  -> {type:'score', score, probabilities, confidence}"""
    out: dict = {}
    for k, a in raw.items():
        if not isinstance(a, dict):
            continue
        conf = a.get("confidence")
        if "noul" in a:
            out[k] = {"type": "boolean", "probability": a.get("noul"), "confidence": conf}
        elif "choice" in a:
            out[k] = {"type": "choice", "choice": a.get("choice"),
                      "probabilities": a.get("probabilities") or {}, "confidence": conf}
        elif "score" in a:
            out[k] = {"type": "score", "score": a.get("score"),
                      "probabilities": a.get("probabilities") or {}, "confidence": conf}
        else:
            out[k] = a
    return out


# --- Answer helpers -------------------------------------------------------

def boolean(answers: Optional[dict], key: str) -> Optional[float]:
    """Probability (0..1) for a boolean question, or None if unavailable."""
    a = (answers or {}).get(key)
    if isinstance(a, dict) and a.get("type") == "boolean":
        p = a.get("probability")
        if isinstance(p, (int, float)):
            return float(p)
    return None


def confidence(answers: Optional[dict], key: str) -> Optional[float]:
    """Model's own certainty (0..1) for an answer, or None if the backend didn't
    provide one (the Vercel gateway doesn't; OpenJev/Codiv does). Callers use this
    to only act on HIGH-confidence verdicts and keep anything the model is unsure of."""
    a = (answers or {}).get(key)
    if isinstance(a, dict):
        c = a.get("confidence")
        if isinstance(c, (int, float)):
            return float(c)
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
