"""Conservative quality decisions for scraped interview questions.

This module deliberately prefers false negatives over false positives. A row
is rejected only when it matches a strong junk signal; ambiguous prose is kept
for review instead of being silently removed.
"""
from __future__ import annotations

from dataclasses import dataclass
import re

FILTER_VERSION = "rules-v2"

_PROMPT_SIGNALS = (
    "asked at", "leetcode", "hackerrank", "time complexity", "space complexity",
    "algorithm", "linked list", "binary tree", "binary search", "system design",
    "given a", "given an", "write a", "design a", "implement a", "two sum",
    "substring", "subarray", "dynamic programming", "hash map", "hash table",
    "difference between", "walk me through", "tell me about a time", "how would you",
    "what is", "what are", "data structure", "big o", "interview question",
)
_PROMPT_STARTERS = {
    "implement", "write", "design", "given", "find", "reverse", "explain", "describe",
    "merge", "sort", "return", "build", "create", "calculate", "count", "determine",
    "list", "define", "compare", "discuss", "tell", "what", "how", "why", "when",
    "which", "who", "where", "maximum", "minimum", "longest", "shortest", "remove",
    "add", "search", "check", "validate", "rotate", "group", "detect", "generate",
    "convert", "parse", "evaluate", "compute", "traverse", "insert", "delete", "can",
    "have", "do", "does", "are", "is", "would", "should", "will",
}
_MARKETING = re.compile(
    r"\b(subscribe|sign[ -]?up|buy now|limited offer|premium course|enroll now|"
    r"free trial|use coupon|download our|join our newsletter|sponsored by)\b",
    re.IGNORECASE,
)
_CODE_ONLY = re.compile(
    r"^(?:from\s+\w+\s+import|import\s+\w+|def\s+\w+\s*\(|class\s+\w+\s*[:({]|"
    r"(?:const|let|var)\s+\w+\s*=|#include\s*[<\"]|SELECT\s+.+\s+FROM\s+)",
    re.IGNORECASE | re.DOTALL,
)
_NAVIGATION = re.compile(
    r"^(?:home|about us|privacy policy|terms of service|cookie policy|log in|sign in|"
    r"next page|previous page|table of contents)$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class QualityDecision:
    is_junk: bool
    reason: str | None = None


def _normalized(text: str) -> str:
    value = re.sub(r"\s+", " ", (text or "").strip())
    value = re.sub(r"^(?:[-*+]\s+|#{1,6}\s+|>\s+|\d+[.)]\s+)+", "", value)
    return value.strip("`*_ ")


def classify_question(text: str, question_type: str | None = None) -> QualityDecision:
    """Return a high-confidence junk decision and a machine-readable reason."""
    value = _normalized(text)
    if not value:
        return QualityDecision(True, "empty")
    if len(value) < 8:
        return QualityDecision(True, "too_short")
    if not re.search(r"[\w\u0080-\uffff]", value):
        return QualityDecision(True, "no_readable_text")

    lowered = value.lower()
    has_prompt_signal = (
        "?" in value
        or "？" in value
        or any(signal in lowered for signal in _PROMPT_SIGNALS)
        or re.split(r"[\s:,.]+", lowered, 1)[0] in _PROMPT_STARTERS
    )
    if _MARKETING.search(value):
        return QualityDecision(True, "marketing")
    if has_prompt_signal:
        return QualityDecision(False)
    if _NAVIGATION.fullmatch(value):
        return QualityDecision(True, "navigation")
    if _CODE_ONLY.match(value) and "?" not in value:
        return QualityDecision(True, "code_fragment")
    if value[0].isascii() and value[0].islower() and len(value) < 55:
        return QualityDecision(True, "short_sentence_fragment")
    # Kept, but with no strong prompt signal — a borderline "weak keep". Marked
    # so classify_question_smart() can send just these to Jev for arbitration.
    return QualityDecision(False, "weak_signal")


def classify_question_smart(text: str, question_type: str | None = None) -> QualityDecision:
    """Heuristic gate, with Jev arbitrating only the borderline "weak keep" cases.

    The heuristic already decides the clear cases for free (obvious junk, or a
    strong prompt signal). Jev is consulted ONLY when the heuristic kept a row
    with no strong signal — the exact rows where junk slips through — so we spend
    at most one fast decision call per borderline item, not per question. Any Jev
    problem falls back to the heuristic's keep.
    """
    decision = classify_question(text, question_type)
    if decision.is_junk or decision.reason != "weak_signal":
        return decision  # obvious junk, or a confident keep — no Jev needed

    try:
        import jev
        if not jev.jev_available():
            return QualityDecision(False)
        answers = jev.evaluate(
            _normalized(text),
            {"is_real": {
                "type": "boolean",
                "instructions": "Would an interviewer ask this OF a candidate during a job interview?",
                "criteria": {
                    "true": "a genuine interview question: coding/algorithm/data-structure, SQL, system design, ML, a CS/technical concept, or a behavioral question",
                    "false": "anything else even if phrased as a question — study/prep advice, 'how do you study', discussion, opinions, job-search chatter, meta commentary, headings, navigation, ads, or fragments",
                },
            }},
        )
        p = jev.boolean(answers, "is_real")
        if p is not None and p < 0.35:
            return QualityDecision(True, "jev_not_a_question")
    except Exception:
        pass
    return QualityDecision(False)


def is_quality_question(text: str, question_type: str | None = None) -> bool:
    return not classify_question(text, question_type).is_junk


def is_junk(text: str, question_type: str | None = None) -> bool:
    return classify_question(text, question_type).is_junk
