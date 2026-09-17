"""Job-specific salary answers using posted ranges, Levels.fyi, then market bands."""
from __future__ import annotations

import json
import re
from pathlib import Path

_DATA = json.loads((Path(__file__).with_name("levels_fyi_new_grad.json")).read_text(encoding="utf-8"))

_TIER_RANGES = {
    "elite": (140_000, 180_000),
    "top": (125_000, 165_000),
    "growth": (110_000, 150_000),
    "standard": (90_000, 130_000),
    "other": (85_000, 125_000),
}


def _valid(value):
    return isinstance(value, (int, float)) and 40_000 <= value <= 1_000_000


def market_salary(job: dict, profile) -> dict:
    """Return min/max/source while honoring an explicit user salary strategy."""
    lo, hi = job.get("salary_min"), job.get("salary_max")
    if _valid(lo) and _valid(hi):
        return {"min": int(lo), "max": int(hi), "source": "job posting"}
    if _valid(lo):
        return {"min": int(lo), "max": int(round(lo * 1.15 / 1000) * 1000), "source": "job posting"}

    slug = re.sub(r"[^a-z0-9-]", "", str(job.get("company_slug") or "").lower())
    levels = _DATA.get(slug)
    if levels:
        return {"min": levels["base_min"], "max": levels["base_max"], "source": "levels.fyi"}

    salary_type = getattr(profile, "salary_type", "market_rate") or "market_rate"
    pmin, pmax = getattr(profile, "salary_min", None), getattr(profile, "salary_max", None)
    target = getattr(profile, "salary_target", None)
    if salary_type == "specific" and _valid(target):
        return {"min": int(target), "max": int(target), "source": "profile target"}
    if salary_type == "range" and _valid(pmin) and _valid(pmax):
        return {"min": int(pmin), "max": int(pmax), "source": "profile range"}

    lo, hi = _TIER_RANGES.get(str(job.get("tier") or "other").lower(), _TIER_RANGES["other"])
    title = str(job.get("title") or job.get("job_title") or "").lower()
    if any(word in title for word in ("senior", "staff", "principal", "manager", "lead")):
        lo, hi = int(lo * 1.2), int(hi * 1.25)
    if any(word in title for word in ("support", "operations", "coordinator")):
        lo, hi = int(lo * .82), int(hi * .85)
    return {"min": round(lo / 1000) * 1000, "max": round(hi / 1000) * 1000, "source": "US role market"}


def salary_answer(label: str, field_type: str, market: dict, profile) -> str:
    salary_type = getattr(profile, "salary_type", "market_rate") or "market_rate"
    strategy = getattr(profile, "salary_display_strategy", "show_range") or "show_range"
    if salary_type == "negotiable" or strategy == "show_negotiable":
        return "Negotiable based on the role and total compensation"
    lo, hi = market["min"], market["max"]
    numeric_only = bool(re.search(r"single|number|amount|minimum", (label or "").lower()))
    if strategy == "show_target" or numeric_only or lo == hi:
        return str(int(round((lo + hi) / 2 / 1000) * 1000))
    return f"${lo:,} - ${hi:,} base"