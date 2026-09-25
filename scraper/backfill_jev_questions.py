"""Backfill: re-verify EXISTING interview questions with Jev and drop the junk.

We already trust LeetCode (leetcode_*), so those are skipped. Every other source
(HackerNews, Qiita, Telegram channels, gists, unknown, …) is scraped prose that
can contain non-questions — headings, ads, fragments. This walks the kept
(is_junk=false) rows from those sources, asks Jev "is this a real interview
question?", and marks the confidently-not-real ones is_junk=true so they drop out
of the interview-prep view.

Conservative: a row is only demoted when Jev's probability is BELOW --threshold
(default 0.30). Anything borderline or higher is left as-is.

Usage:
  python backfill_jev_questions.py --dry-run --limit 200   # preview only
  python backfill_jev_questions.py --limit 5000            # process a batch
  python backfill_jev_questions.py                         # process all remaining
"""
from __future__ import annotations

import os
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def _load_env() -> None:
    here = Path(__file__).resolve().parent
    for p in (here / ".env", here.parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# Intent-aware: it must be a question an INTERVIEWER asks a CANDIDATE during a job
# interview — not merely question-shaped text. This is what separates a real
# interview question ("Reverse a linked list") from prep/study chatter ("What do
# you do to study?"), advice, opinions, meta commentary, or fragments.
REAL_Q_INSTRUCTION = (
    "Would an interviewer ask this OF a candidate during a job interview?"
)
REAL_Q_CRITERIA = {
    "true": ("a genuine interview question a candidate was asked: a coding/algorithm/"
             "data-structure problem, SQL, system design, ML, a CS or technical concept "
             "question, or a behavioral question (\"tell me about a time...\")"),
    "false": ("anything else, EVEN IF phrased as a question: study or prep advice, "
              "\"how do you study/prepare\", general discussion, opinions, job-search or "
              "salary chatter, meta commentary, headings, navigation, ads, personal "
              "updates, code dumps, or fragments"),
}


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="max rows to process (0 = all)")
    ap.add_argument("--threshold", type=float, default=0.30, help="drop rows scoring below this")
    ap.add_argument("--batch", type=int, default=12, help="questions packed into one Jev call")
    ap.add_argument("--workers", type=int, default=3, help="concurrent Jev calls (low, to respect rate limits)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    import jev
    if not jev.jev_available():
        print("Jev unavailable (AI_GATEWAY_API_KEY missing). Aborting.")
        return

    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    # Pull kept, non-LeetCode questions (paginated).
    rows: list = []
    off = 0
    while True:
        b = (client.table("interview_questions")
             .select("id, question_text, source_name")
             .eq("is_junk", False)
             .not_.ilike("source_name", "leetcode%")
             # Only rows Jev hasn't already checked, so repeated runs converge to
             # zero work (safe to run continuously / 24-7 until everything's clean).
             .or_("quality_filter_version.is.null,quality_filter_version.neq.jev-v1")
             .range(off, off + 999).execute().data) or []
        rows.extend(b)
        if len(b) < 1000:
            break
        off += 1000
        if args.limit and len(rows) >= args.limit:
            break
    if args.limit:
        rows = rows[: args.limit]
    print(f"candidates (kept, non-leetcode): {len(rows)}")

    # BATCH: pack `batch` questions into one Jev call (one state = a numbered
    # list, one boolean per item). Jev is brand-new and heavily rate-limited, so
    # batching cuts calls ~batch-fold, which is the main lever against 429s.
    def verify_batch(chunk: list):
        # Very short rows are junk without spending a call.
        results: dict = {}
        askable = []
        for r in chunk:
            t = (r.get("question_text") or "").strip()
            if len(t) < 8:
                results[r["id"]] = 0.0
            else:
                askable.append((r["id"], t[:600]))
        if not askable:
            return results
        state = "Interview question candidates:\n" + "\n".join(
            f"[{i}] {t}" for i, (_, t) in enumerate(askable)
        )
        qs = {f"q{i}": {"type": "boolean",
                        "instructions": f"For candidate item [{i}]: {REAL_Q_INSTRUCTION}",
                        "criteria": REAL_Q_CRITERIA}
              for i in range(len(askable))}
        ans = jev.evaluate(state, qs, retries=4)
        if ans is None:
            return None  # signal rate-limit/failure for this chunk
        for i, (qid, _) in enumerate(askable):
            results[qid] = jev.boolean(ans, f"q{i}")
        return results

    chunks = [rows[i:i + args.batch] for i in range(0, len(rows), args.batch)]
    to_drop: list = []
    to_keep: list = []   # checked and judged real -> mark so we never re-check
    checked = 0
    failed_chunks = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(verify_batch, ch): ch for ch in chunks}
        for fut in as_completed(futs):
            try:
                res = fut.result()
            except Exception:
                failed_chunks += 1
                continue
            if res is None:
                failed_chunks += 1
                if not jev.jev_available():
                    print("Jev disabled mid-run (quota/billing). Stopping; run again later.")
                    break
                continue
            for qid, p in res.items():
                if p is None:
                    continue  # couldn't judge -> leave unchecked, retry next run
                checked += 1
                if p < args.threshold:
                    to_drop.append(qid)
                else:
                    to_keep.append(qid)
            print(f"  …checked {checked}/{len(rows)}, flagged {len(to_drop)} junk, failed chunks {failed_chunks}")

    print(f"Jev flagged {len(to_drop)} of {checked} checked as not-real (failed/rate-limited chunks: {failed_chunks})")
    if args.dry_run:
        print("[DRY RUN] no writes")
        return

    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    CHUNK = 200
    # Demote junk (and mark it checked so it isn't re-evaluated).
    for i in range(0, len(to_drop), CHUNK):
        client.table("interview_questions").update(
            {"is_junk": True, "junk_reason": "jev_not_a_question",
             "quality_filter_version": "jev-v1", "quality_checked_at": now}
        ).in_("id", to_drop[i:i + CHUNK]).execute()
    # Mark the real ones as checked too, so continuous runs converge to no work.
    for i in range(0, len(to_keep), CHUNK):
        client.table("interview_questions").update(
            {"quality_filter_version": "jev-v1", "quality_checked_at": now}
        ).in_("id", to_keep[i:i + CHUNK]).execute()
    print(f"DONE: demoted {len(to_drop)} junk, marked {len(to_keep)} real as checked")


if __name__ == "__main__":
    main()
