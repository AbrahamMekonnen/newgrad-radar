"""Run one Python scraper in an isolated process.

A child process can be terminated cleanly when its scraper times out. A thread
cannot, which previously let timed-out attempts continue alongside retries.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import inspect
import json
import traceback
from dataclasses import asdict, is_dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any


def _decode_value(value: Any) -> Any:
    if isinstance(value, dict):
        if value.get("__scraper_type__") == "datetime":
            return datetime.fromisoformat(value["value"])
        return {key: _decode_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_decode_value(item) for item in value]
    return value


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return asdict(value)
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return value.to_dict()
    if hasattr(value, "__dict__"):
        return vars(value)
    return str(value)


def _accepted_kwargs(function: Any, candidates: dict[str, Any]) -> dict[str, Any]:
    try:
        signature = inspect.signature(function)
    except (TypeError, ValueError):
        return {}
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values()):
        return candidates
    return {key: value for key, value in candidates.items() if key in signature.parameters}


def _run(module_path: str, function_name: str, kwargs: dict[str, Any]) -> Any:
    module = importlib.import_module(module_path)
    function = getattr(module, function_name)
    result = function(**_accepted_kwargs(function, kwargs))
    if inspect.isawaitable(result):
        return asyncio.run(result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", required=True)
    parser.add_argument("--function", required=True)
    parser.add_argument("--kwargs", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    output_path = Path(args.output)
    try:
        kwargs = _decode_value(json.loads(args.kwargs))
        result = _run(args.module, args.function, kwargs)
        payload = {"ok": True, "result": result}
        return_code = 0
    except Exception as error:
        payload = {
            "ok": False,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
        }
        return_code = 1

    output_path.write_text(
        json.dumps(payload, default=_json_default, ensure_ascii=False),
        encoding="utf-8",
    )
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
