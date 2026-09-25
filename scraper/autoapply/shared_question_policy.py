"""Shared question classification contract used by Python preparation."""
from __future__ import annotations
import json
import re
from pathlib import Path

_CONTRACT = json.loads((Path(__file__).resolve().parents[2] / "shared" / "autoapply-question-policy.json").read_text(encoding="utf-8"))
_RULES = [dict(rule, expressions=[re.compile(p, re.I) for p in rule["patterns"]]) for rule in _CONTRACT["rules"]]

def classify_application_question(label: object):
    normalized = re.sub(r"[^a-z0-9]+", " ", str(label or "").lower()).strip()
    return next((rule for rule in _RULES if any(pattern.search(normalized) for pattern in rule["expressions"])), None)

POLICY_VERSION = _CONTRACT["version"]