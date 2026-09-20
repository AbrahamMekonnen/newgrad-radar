"""AI verification of scraped interview questions.

The heuristic filter (quality.py) is deliberately conservative, so noisy sources
(HackerNews comment threads, gist snippets, misc "unknown") still leak fragments
that read question-ish (a stray "?" or long prose). This asks an LLM, in
batches, whether each item is ACTUALLY an interview question/problem a candidate
could be asked. Non-questions are marked junk; real ones are kept.

Batched + provider-fallthrough so it rides free-tier limits. Used by
ai_clean.py for the backfill and can gate ingest for the noisy sources.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import llm_enrich  # noqa: E402

AI_FILTER_VERSION = "ai-v1"

_PROMPT = (
    "You are cleaning a database of INTERVIEW QUESTIONS. For each numbered item, "
    "decide if it is genuinely a question or problem that could be asked to a "
    "candidate in a job interview — coding, technical, conceptual, behavioral, "
    "system-design, or a take-home/online-assessment prompt.\n"
    "Answer FALSE for anything that is NOT that: forum/comment fragments, replies, "
    "opinions, marketing, job ads, code snippets, config, navigation text, article "
    "prose, or truncated sentence fragments.\n"
    "Be strict: when in doubt that it is a real interview question, answer false.\n\n"
    "ITEMS:\n{items}\n\n"
    'Reply ONLY with a JSON object mapping each number (as a string) to true or '
    'false, e.g. {{"0": true, "1": false}}.'
)


def classify_batch(texts: list[str]) -> list[bool]:
    """Return is_question per text. On total LLM failure, returns all True
    (keep) so a provider outage never deletes data."""
    if not texts:
        return []
    items = "\n".join(f"[{i}] {(t or '').strip()[:400]}" for i, t in enumerate(texts))
    prompt = _PROMPT.format(items=items)
    for _ in range(3):
        data = llm_enrich._parse_json(llm_enrich._generate(prompt) or "")
        if isinstance(data, dict) and data:
            out = []
            for i in range(len(texts)):
                v = data.get(str(i))
                # default keep (True) when the model omits an index
                out.append(True if v is None else bool(v) if not isinstance(v, str)
                           else v.strip().lower() in ("true", "yes", "1"))
            return out
    return [True] * len(texts)  # LLM unavailable → keep, never delete blindly


if __name__ == "__main__":
    samples = [
        "Implement a function to reverse a linked list.",
        "> Why ask for a proof?",
        "FAANG interviews",
        "How would you design a rate limiter?",
        "t meant to be solutions. When you see something like that",
        "Tell me about a time you disagreed with your manager.",
    ]
    for t, ok in zip(samples, classify_batch(samples)):
        print(("QUESTION " if ok else "JUNK     ") + t[:60])
