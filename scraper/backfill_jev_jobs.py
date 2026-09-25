"""Backfill: re-classify EXISTING jobs (that still have a description) with Jev,
against ALL of our content-derived filter dimensions in one call — not just level.

For each job we ask Jev everything the job filters care about that can be read
from the posting text:
  - is a real job posting (vs event / conference / ad / generic page)
  - is a technical / software role (belongs on the board)
  - experience level
  - primary role type
  - work mode (remote / hybrid / on-site)
  - visa sponsorship

Writes are conservative — we only FILL fields that are missing/unknown (never
overwrite good data), and only when Jev is confident. Two cleanups are applied:
non-jobs are marked is_job=false, and (opt-in) clearly non-technical roles can be
deactivated. Everything else Jev flags is reported for you to review.

Usage:
  python backfill_jev_jobs.py --dry-run --limit 100        # preview
  python backfill_jev_jobs.py --limit 3000                 # process a batch
  python backfill_jev_jobs.py --deactivate-nontech         # also drop non-tech
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


ROLE_CRITERIA = {
    "swe": "general software engineer",
    "ml": "machine learning / AI engineer",
    "backend": "backend engineer",
    "frontend": "frontend engineer",
    "fullstack": "full-stack engineer",
    "infra": "infrastructure / platform / devops / SRE",
    "data": "data engineer",
    "security": "security engineer",
    "mobile": "mobile (iOS/Android) engineer",
}
LEVEL_CRITERIA = {
    "intern": "an internship / co-op",
    "new_grad": "new grad / entry level / university graduate, 0-2 years",
    "junior": "junior, roughly 1-2 years",
    "mid": "mid-level, roughly 2-5 years",
    "senior": "senior, roughly 5-8 years",
    "staff": "staff level",
    "principal": "principal / distinguished",
}
WORKMODE_CRITERIA = {
    "remote": "fully remote",
    "hybrid": "hybrid (some in-office)",
    "onsite": "fully on-site / in-office",
    "unspecified": "work mode not stated",
}
SPONSOR_CRITERIA = {
    "offers_sponsorship": "explicitly sponsors work visas / H-1B",
    "no_sponsorship": "explicitly no sponsorship / must be work-authorized",
    "unknown": "sponsorship not mentioned",
}

QUESTIONS = {
    "is_real_job": {"type": "boolean", "instructions": "Is this a real individual JOB posting (not an event, conference, career fair, ad, or generic company page)?"},
    "is_technical": {"type": "boolean", "instructions": "Is this a software / engineering / technical role (not sales, recruiting, marketing, finance, HR, etc.)?"},
    "level": {"type": "choice", "instructions": "What experience level is this role aimed at?", "criteria": LEVEL_CRITERIA},
    "role": {"type": "choice", "instructions": "What is the PRIMARY engineering discipline of this role?", "criteria": ROLE_CRITERIA},
    "work_mode": {"type": "choice", "instructions": "What is the work mode?", "criteria": WORKMODE_CRITERIA},
    "sponsorship": {"type": "choice", "instructions": "Does the posting address visa sponsorship?", "criteria": SPONSOR_CRITERIA},
}

CONF = 0.55  # min confidence to write a choice


def main() -> None:
    _load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="max jobs to process (0 = all with a description)")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--only-missing", action="store_true", help="only jobs missing an experience level")
    ap.add_argument("--deactivate-nontech", action="store_true", help="also is_active=false for confident non-technical roles")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    import jev
    if not jev.jev_available():
        print("Jev unavailable (AI_GATEWAY_API_KEY missing). Aborting.")
        return

    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    rows: list = []
    off = 0
    while True:
        q = (client.table("jobs")
             .select("id, title, description, experience_level, role_types, work_modes, work_mode, sponsorship_status, is_job")
             .eq("is_active", True).not_.is_("description", "null"))
        if args.only_missing:
            q = q.is_("experience_level", "null")
        b = q.range(off, off + 999).execute().data or []
        rows.extend(b)
        if len(b) < 1000:
            break
        off += 1000
        if args.limit and len(rows) >= args.limit:
            break
    if args.limit:
        rows = rows[: args.limit]
    print(f"jobs to classify (active, with description): {len(rows)}")

    def classify(job: dict):
        state = f"Job title: {job.get('title')}\n\n{(job.get('description') or '')[:2500]}"
        ans = jev.evaluate(state, QUESTIONS)
        return job, ans

    patches: dict = {}          # id -> patch dict
    nontech: list = []          # ids Jev flags non-technical
    nonjob: list = []           # ids Jev flags not a real job
    stats = {"level": 0, "role": 0, "work_mode": 0, "sponsorship": 0}
    checked = 0

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(classify, r): r for r in rows}
        for fut in as_completed(futs):
            checked += 1
            try:
                job, ans = fut.result()
            except Exception:
                continue
            if ans is None:
                if not jev.jev_available():
                    print("Jev disabled mid-run (quota/billing). Stopping; run again later.")
                    break
                continue

            patch: dict = {}
            real = jev.boolean(ans, "is_real_job")
            tech = jev.boolean(ans, "is_technical")
            if real is not None and real < 0.30:
                nonjob.append(job["id"]); patch["is_job"] = False
            if tech is not None and tech < 0.30:
                nontech.append(job["id"])

            # Fill missing experience level.
            if not job.get("experience_level"):
                lvl, c = jev.choice(ans, "level")
                if lvl and c >= CONF:
                    patch["experience_level"] = lvl; stats["level"] += 1
            # Fill role_types if empty.
            if not job.get("role_types"):
                role, c = jev.choice(ans, "role")
                if role and c >= CONF:
                    patch["role_types"] = [role]; stats["role"] += 1
            # Fill work mode if missing.
            if not job.get("work_modes"):
                wm, c = jev.choice(ans, "work_mode")
                if wm and wm != "unspecified" and c >= CONF:
                    patch["work_modes"] = [wm]
                    if not job.get("work_mode"):
                        patch["work_mode"] = wm
                    stats["work_mode"] += 1
            # Fill sponsorship if unknown/missing.
            if (job.get("sponsorship_status") or "unknown") == "unknown":
                sp, c = jev.choice(ans, "sponsorship")
                if sp and sp != "unknown" and c >= CONF:
                    patch["sponsorship_status"] = sp; stats["sponsorship"] += 1

            if patch:
                patches[job["id"]] = patch
            if checked % 200 == 0:
                print(f"  …checked {checked}/{len(rows)}  fills={stats}  nonjob={len(nonjob)} nontech={len(nontech)}")

    print(f"\nchecked={checked}")
    print(f"  fills: {stats}")
    print(f"  flagged not-a-real-job: {len(nonjob)}")
    print(f"  flagged non-technical: {len(nontech)}  (deactivate={'yes' if args.deactivate_nontech else 'no, review only'})")

    if args.dry_run:
        print("[DRY RUN] no writes")
        return

    # Apply per-job patches (level/role/work_mode/sponsorship/is_job).
    written = 0
    for jid, patch in patches.items():
        try:
            client.table("jobs").update(patch).eq("id", jid).execute()
            written += 1
        except Exception as e:
            print(f"  patch failed {jid}: {e}")
    print(f"applied {written} job patches")

    if args.deactivate_nontech and nontech:
        for i in range(0, len(nontech), 200):
            client.table("jobs").update({"is_active": False}).in_("id", nontech[i:i + 200]).execute()
        print(f"deactivated {len(nontech)} non-technical jobs")


if __name__ == "__main__":
    main()
