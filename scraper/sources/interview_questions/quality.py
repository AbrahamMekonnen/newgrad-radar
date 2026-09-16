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
    return QualityDecision(False)


def is_quality_question(text: str, question_type: str | None = None) -> bool:
    return not classify_question(text, question_type).is_junk


def is_junk(text: str, question_type: str | None = None) -> bool:
    return classify_question(text, question_type).is_junk
