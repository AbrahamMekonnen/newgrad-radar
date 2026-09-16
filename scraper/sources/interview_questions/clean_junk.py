"""Review or flag high-confidence junk in ``interview_questions``.

Dry-run is the default. Database changes require an explicit ``--apply``.
Rows are marked with a reason and filter version and can be restored later.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import sys
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger("clean_junk")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from quality import FILTER_VERSION, classify_question  # noqa: E402


def _load_env() -> None:
    for path in (HERE.parents[1] / ".env", HERE.parents[2] / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _client():
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and a service-role key are required")
    return create_client(url, key)


def _require_quality_columns(client: Any) -> None:
    try:
        client.table("interview_questions").select(
            "id,is_junk,junk_reason,quality_checked_at,quality_filter_version"
        ).limit(1).execute()
    except Exception as exc:
        if getattr(exc, "code", None) == "42703" or "42703" in str(exc):
            raise RuntimeError(
                "Quality columns are missing. Apply migration "
                "supabase/migrations/045_interview_question_junk.sql first."
            ) from exc
        raise


def review(client: Any, *, apply: bool = False, page_size: int = 500) -> dict:
    """Scan with stable ID pagination and optionally flag rejected rows."""
    _require_quality_columns(client)
    last_id: str | None = None
    scanned = flagged = protected = 0
    reasons: Counter[str] = Counter()
    samples: list[dict[str, str]] = []

    while True:
        query = (
            client.table("interview_questions")
            .select("id,question_text,question_type,source_name,is_verified")
            .eq("is_duplicate", False)
            .eq("is_junk", False)
            .order("id")
            .limit(page_size)
        )
        if last_id:
            query = query.gt("id", last_id)
        rows = query.execute().data or []
        if not rows:
            break

        updates: dict[str, list[str]] = {}
        for row in rows:
            scanned += 1
            if row.get("is_verified"):
                protected += 1
                continue
            decision = classify_question(
                row.get("question_text") or "", row.get("question_type")
            )
            if not decision.is_junk:
                continue
            reason = decision.reason or "unspecified"
            reasons[reason] += 1
            flagged += 1
            updates.setdefault(reason, []).append(row["id"])
            if len(samples) < 25:
                samples.append({
                    "id": row["id"],
                    "source": row.get("source_name") or "unknown",
                    "reason": reason,
                    "text": (row.get("question_text") or "")[:180],
                })

        if apply:
            checked_at = datetime.now(timezone.utc).isoformat()
            for reason, ids in updates.items():
                (
                    client.table("interview_questions")
                    .update({
                        "is_junk": True,
                        "junk_reason": reason,
                        "quality_checked_at": checked_at,
                        "quality_filter_version": FILTER_VERSION,
                    })
                    .in_("id", ids)
                    .execute()
                )
        last_id = rows[-1]["id"]
        logger.info("scanned=%d flagged=%d protected=%d", scanned, flagged, protected)

    result = {
        "mode": "apply" if apply else "dry-run",
        "filter_version": FILTER_VERSION,
        "scanned": scanned,
        "flagged": flagged,
        "protected_verified": protected,
        "reasons": dict(reasons),
        "samples": samples,
    }
    logger.info("DONE %s", result)
    return result


def restore(client: Any, version: str, *, page_size: int = 500) -> int:
    """Restore rows hidden by one specific quality-filter version."""
    _require_quality_columns(client)
    restored = 0
    while True:
        rows = (
            client.table("interview_questions")
            .select("id")
            .eq("is_junk", True)
            .eq("quality_filter_version", version)
            .limit(page_size)
            .execute().data
            or []
        )
        if not rows:
            break
        ids = [row["id"] for row in rows]
        (
            client.table("interview_questions")
            .update({
                "is_junk": False,
                "junk_reason": None,
                "quality_checked_at": None,
                "quality_filter_version": None,
            })
            .in_("id", ids)
            .execute()
        )
        restored += len(ids)
        logger.info("restored=%d", restored)
    return restored


def main() -> None:
    _load_env()
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="flag high-confidence junk")
    mode.add_argument("--restore", metavar="VERSION", help="restore one filter version")
    parser.add_argument("--page-size", type=int, default=500)
    args = parser.parse_args()
    if not 1 <= args.page_size <= 1000:
        parser.error("--page-size must be between 1 and 1000")

    client = _client()
    if args.restore:
        logger.info("restored=%d", restore(client, args.restore, page_size=args.page_size))
    else:
        review(client, apply=args.apply, page_size=args.page_size)


if __name__ == "__main__":
    main()
