"""Deliver pending smart job alerts created by the database insert trigger."""
from __future__ import annotations

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
    load_env()
    from db import get_client
    from alerts import process_instant_alerts

    rows = (get_client().table("alert_matches").select("job_id")
            .eq("delivery_status", "pending").eq("delivery_mode", "instant")
            .limit(500).execute().data) or []
    job_ids = list(dict.fromkeys(row["job_id"] for row in rows))
    result = process_instant_alerts([{"id": job_id} for job_id in job_ids], dry_run=False)
    print(f"Alert delivery complete: {result}")


if __name__ == "__main__":
    main()
