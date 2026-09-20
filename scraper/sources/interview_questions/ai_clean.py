"""AI backfill: verify questionable interview rows and remove non-questions.

Targets the noisy sources (HackerNews, unknown, github_gist) that leak comment
fragments past the heuristic filter. Asks the LLM (batched) whether each row is
a real interview question; marks the non-questions is_junk=true. Real ones are
kept and stamped so they're not re-checked.

    python -m sources.interview_questions.ai_clean --limit 200 --dry-run
    python -m sources.interview_questions.ai_clean            # full backfill
"""
from __future__ import annotations

import os
import sys
import time
import argparse
import logging
import datetime as dt
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_clean")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from ai_quality import classify_batch, AI_FILTER_VERSION  # noqa: E402

NOISY_SOURCES = ["hackernews", "unknown", "github_gist"]


def _load_env() -> None:
    for p in (HERE.parents[1] / ".env", HERE.parents[2] / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def run(sources=None, limit=None, batch_size=25, dry_run=False) -> dict:
    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    sources = sources or NOISY_SOURCES
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    processed, junked = 0, 0

    while limit is None or processed < limit:
        take = batch_size if limit is None else min(batch_size, limit - processed)
        rows = (client.table("interview_questions")
                .select("id, question_text")
                .in_("source_name", sources)
                .eq("is_duplicate", False).eq("is_junk", False)
                .or_(f"quality_filter_version.is.null,quality_filter_version.neq.{AI_FILTER_VERSION}")
                .limit(take).execute().data) or []
        if not rows:
            break
        verdicts = classify_batch([r.get("question_text") or "" for r in rows])
        if verdicts is None:
            # LLM unavailable — do NOT stamp these rows; stop so a later run
            # retries them instead of marking them done-but-unclassified.
            logger.warning("LLM unavailable; stopping so remaining rows are retried later")
            break
        junk_ids = [r["id"] for r, ok in zip(rows, verdicts) if not ok]
        keep_ids = [r["id"] for r, ok in zip(rows, verdicts) if ok]
        processed += len(rows)
        junked += len(junk_ids)
        if not dry_run:
            if junk_ids:
                client.table("interview_questions").update({
                    "is_junk": True, "junk_reason": "ai_not_a_question",
                    "quality_filter_version": AI_FILTER_VERSION, "quality_checked_at": now,
                }).in_("id", junk_ids).execute()
            if keep_ids:
                client.table("interview_questions").update({
                    "quality_filter_version": AI_FILTER_VERSION, "quality_checked_at": now,
                }).in_("id", keep_ids).execute()
        else:
            # dry-run can't stamp rows, so avoid re-fetching the same batch forever
            if not junk_ids and not keep_ids:
                break
            if len(rows) < take:
                break
        logger.info(f"  processed {processed}, junked {junked}")
        if dry_run and processed >= (limit or 0):
            break
        time.sleep(1.0)  # pace to ease free-tier LLM rate limits
    logger.info(f"DONE: processed {processed}, junked {junked} "
                f"({'dry-run' if dry_run else 'applied'})")
    return {"processed": processed, "junked": junked}


if __name__ == "__main__":
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--batch-size", type=int, default=25)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--sources", nargs="*", default=None)
    args = ap.parse_args()
    run(sources=args.sources, limit=args.limit, batch_size=args.batch_size, dry_run=args.dry_run)
