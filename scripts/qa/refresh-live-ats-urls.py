"""Refresh QA URLs with currently live postings. Never submits applications."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import requests
from supabase import create_client

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".qa" / "urls.json"


def load_env() -> None:
    for path in (ROOT / ".env.local", ROOT / "scraper" / ".env"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def greenhouse_parts(url: str) -> tuple[str, str] | None:
    token = re.search(r"(?:for=|greenhouse\.io/)([^/?&#]+)", url or "", re.I)
    job = re.search(r"(?:token=|gh_jid=|/jobs/)(\d{4,})", url or "", re.I)
    return (token.group(1), job.group(1)) if token and job else None


def main() -> None:
    load_env()
    client = create_client(
        os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.environ["SUPABASE_URL"],
        os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"],
    )
    rows = (client.table("jobs").select("apply_url,url")
            .eq("ats_type", "greenhouse").eq("is_active", True)
            .limit(1000).execute().data or [])
    live, seen = [], set()
    session = requests.Session()
    for row in rows:
        parts = greenhouse_parts(row.get("apply_url") or row.get("url") or "")
        if not parts or parts in seen:
            continue
        seen.add(parts)
        token, job_id = parts
        try:
            response = session.get(
                f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?questions=true",
                timeout=12,
            )
            if response.status_code != 200:
                continue
        except requests.RequestException:
            continue
        live.append(f"https://job-boards.greenhouse.io/embed/job_app?for={token}&token={job_id}")
        if len(live) >= 125:
            break
    existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    existing["greenhouse"] = live
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    print(json.dumps({"greenhouse_live": len(live), "output": str(OUT)}, indent=2))


if __name__ == "__main__":
    main()
