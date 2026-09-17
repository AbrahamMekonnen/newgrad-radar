"""Deliver pending smart job alerts created by the database insert trigger."""
from __future__ import annotations

import argparse
import os
from pathlib import Path


def load_env() -> None:
    root = Path(__file__).resolve().parent
    for path in (root / ".env", root.parent / ".env.local"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("instant", "daily", "weekly"), default="instant")
    args = parser.parse_args()

    load_env()
    from alerts import process_digest_alerts, process_instant_alerts
    from db import get_client

    if args.mode in ("daily", "weekly"):
        result = process_digest_alerts(args.mode, dry_run=False)
    else:
        rows = (get_client().table("alert_matches").select("job_id")
                .eq("delivery_status", "pending").eq("delivery_mode", "instant")
                .limit(500).execute().data) or []
        job_ids = list(dict.fromkeys(row["job_id"] for row in rows))
        result = process_instant_alerts([{"id": job_id} for job_id in job_ids], dry_run=False)
    print(f"Alert delivery complete ({args.mode}): {result}")


if __name__ == "__main__":
    main()
