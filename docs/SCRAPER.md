# Scraper Design

## Overview

Python scraper that runs daily via GitHub Actions. Fetches jobs from multiple sources, normalizes them, and writes to Supabase.

## Data Sources (All Free)

| Source | Type | Coverage | Rate Limit |
|--------|------|----------|------------|
| SimplifyJobs GitHub | JSON file | 20k+ curated new grad jobs | None |
| Greenhouse API | REST API | ~40 target companies | None published |
| Lever API | REST API | ~20 target companies | 2 req/sec |
| Ashby API | REST API | ~10 target companies | None published |

## Directory Structure

```
scraper/
├── radar.py                    # Main entry point
├── config.py                   # Settings, Supabase config
├── companies.py                # Company list with ATS mappings
├── sources/
│   ├── __init__.py
│   ├── base.py                 # Base adapter class
│   ├── simplify.py             # SimplifyJobs GitHub
│   ├── greenhouse.py           # Greenhouse API
│   ├── lever.py                # Lever API
│   └── ashby.py                # Ashby API
├── classifier.py               # AI classification (Gemini)
├── db.py                       # Supabase operations
├── notify.py                   # ntfy + email notifications
├── requirements.txt
└── .github/
    └── workflows/
        └── scrape.yml          # Daily cron job
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. FETCH                                                    │
│     Parallel fetch from all sources                          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  2. NORMALIZE                                                │
│     Convert to common Job format                             │
│     - Extract: company, title, location, url                 │
│     - Detect role types from title                           │
│     - Assign company tier                                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  3. FILTER                                                   │
│     - Only target companies (~100)                           │
│     - Remove duplicates (same job, different source)         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  4. CLASSIFY (AI)                                            │
│     Use Gemini to verify:                                    │
│     - Is this actually new grad / entry level?               │
│     - What role types apply?                                 │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  5. UPSERT                                                   │
│     Write to Supabase:                                       │
│     - Insert new jobs                                        │
│     - Update existing jobs                                   │
│     - Mark removed jobs as inactive                          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  6. NOTIFY                                                   │
│     For each new job:                                        │
│     - Find users to notify (all vs my_list)                  │
│     - Send push via ntfy.sh                                  │
│     - Queue email digest                                     │
└─────────────────────────────────────────────────────────────┘
```

## Source Adapters

### SimplifyJobs GitHub

Best curated source. ~20k new grad positions, updated daily by community.

```python
# sources/simplify.py

SIMPLIFY_URL = "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json"

def fetch_simplify() -> list[dict]:
    """Fetch all jobs from SimplifyJobs GitHub repo."""
    response = requests.get(SIMPLIFY_URL)
    data = response.json()
    
    jobs = []
    for item in data:
        if not item.get("active", True):
            continue
        
        jobs.append({
            "company": item.get("company_name", ""),
            "title": item.get("title", ""),
            "locations": item.get("locations", []),
            "url": item.get("url", ""),
            "posted": parse_timestamp(item.get("date_posted")),
            "source": "simplify",
        })
    
    return jobs
```

### Greenhouse API

Free API, no auth required. Returns all jobs for a company board.

```python
# sources/greenhouse.py

def fetch_greenhouse(board_token: str) -> list[dict]:
    """Fetch jobs from a Greenhouse board."""
    url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs"
    response = requests.get(url)
    data = response.json()
    
    jobs = []
    for job in data.get("jobs", []):
        jobs.append({
            "company": board_token,  # Will be mapped to proper name
            "title": job.get("title", ""),
            "location": job.get("location", {}).get("name", ""),
            "url": job.get("absolute_url", ""),
            "posted": parse_iso(job.get("updated_at")),
            "source": "greenhouse",
            "external_id": str(job.get("id")),
        })
    
    return jobs
```

### Lever API

Free API, no auth required.

```python
# sources/lever.py

def fetch_lever(company_slug: str) -> list[dict]:
    """Fetch jobs from a Lever board."""
    url = f"https://api.lever.co/v0/postings/{company_slug}"
    response = requests.get(url)
    data = response.json()
    
    jobs = []
    for job in data:
        jobs.append({
            "company": company_slug,
            "title": job.get("text", ""),
            "location": job.get("categories", {}).get("location", ""),
            "url": job.get("hostedUrl", ""),
            "posted": parse_timestamp_ms(job.get("createdAt")),
            "source": "lever",
            "external_id": job.get("id"),
        })
    
    return jobs
```

### Ashby API

Similar to Greenhouse/Lever.

```python
# sources/ashby.py

def fetch_ashby(board_token: str) -> list[dict]:
    """Fetch jobs from an Ashby board."""
    url = f"https://api.ashbyhq.com/posting-api/job-board/{board_token}"
    response = requests.get(url)
    data = response.json()
    
    jobs = []
    for job in data.get("jobs", []):
        jobs.append({
            "company": board_token,
            "title": job.get("title", ""),
            "location": job.get("location", ""),
            "url": job.get("jobUrl", ""),
            "posted": parse_iso(job.get("publishedAt")),
            "source": "ashby",
            "external_id": job.get("id"),
        })
    
    return jobs
```

## Job Normalization

```python
# radar.py

def normalize_job(raw: dict, company_info: dict) -> dict:
    """Convert raw job to normalized format."""
    
    # Generate stable ID
    id_string = f"{company_info['slug']}|{raw['title']}|{raw['url']}"
    job_id = hashlib.md5(id_string.encode()).hexdigest()[:12]
    
    # Detect role types from title
    role_types = detect_role_types(raw["title"])
    
    return {
        "id": job_id,
        "company_slug": company_info["slug"],
        "company_name": company_info["name"],
        "title": raw["title"],
        "location": normalize_location(raw.get("location") or raw.get("locations", [])),
        "url": raw["url"],
        "tier": company_info["tier"],
        "role_types": role_types,
        "source": raw["source"],
        "posted": raw.get("posted"),
    }


def detect_role_types(title: str) -> list[str]:
    """Detect role types from job title."""
    title_lower = title.lower()
    roles = []
    
    patterns = {
        "ml": ["machine learning", "ml ", "ai ", "deep learning", "research"],
        "backend": ["backend", "back-end", "server", "api", "distributed"],
        "frontend": ["frontend", "front-end", "react", "ui ", "web "],
        "fullstack": ["full stack", "fullstack", "full-stack"],
        "infra": ["infrastructure", "platform", "sre", "devops", "cloud"],
        "data": ["data engineer", "data platform", "etl", "pipeline"],
        "security": ["security", "appsec", "infosec"],
        "mobile": ["ios", "android", "mobile"],
    }
    
    for role, keywords in patterns.items():
        if any(kw in title_lower for kw in keywords):
            roles.append(role)
    
    # Default to "swe" if no specific role detected
    if not roles:
        roles = ["swe"]
    
    return roles
```

## AI Classification

Use Gemini to verify jobs are actually new grad.

```python
# classifier.py

PROMPT = """
You are classifying job postings for NEW GRAD candidates (0-2 years experience).

For each job, determine:
1. is_new_grad: true if entry-level / new grad / junior / 0-2 years
2. role_types: list of applicable types from [swe, ml, backend, frontend, fullstack, infra, data, security, mobile]

Return JSON array with same order as input.

JOBS:
{jobs}
"""

def classify_jobs(jobs: list[dict]) -> list[dict]:
    """Use Gemini to classify jobs."""
    
    if not os.environ.get("GEMINI_API_KEY"):
        # Fallback: use title-based heuristics
        return [j for j in jobs if is_likely_new_grad(j["title"])]
    
    # Format jobs for prompt
    job_texts = [f"{i}. {j['company_name']} - {j['title']}" for i, j in enumerate(jobs)]
    
    response = call_gemini(PROMPT.format(jobs="\n".join(job_texts)))
    classifications = json.loads(response)
    
    # Filter and update jobs
    result = []
    for i, job in enumerate(jobs):
        if classifications[i].get("is_new_grad"):
            job["role_types"] = classifications[i].get("role_types", job["role_types"])
            result.append(job)
    
    return result


def is_likely_new_grad(title: str) -> bool:
    """Heuristic fallback for new grad detection."""
    title_lower = title.lower()
    
    # Positive signals
    if any(kw in title_lower for kw in ["new grad", "entry level", "junior", "associate", "university", "graduate"]):
        return True
    
    # Negative signals
    if any(kw in title_lower for kw in ["senior", "staff", "principal", "lead", "manager", "director", "5+ years"]):
        return False
    
    # Uncertain - include by default
    return True
```

## Supabase Operations

```python
# db.py

from supabase import create_client

def get_client():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"]
    )

def upsert_jobs(jobs: list[dict]) -> tuple[int, int]:
    """Insert or update jobs. Returns (new_count, updated_count)."""
    client = get_client()
    
    # Get existing job IDs
    existing = client.table("jobs").select("id").execute()
    existing_ids = {row["id"] for row in existing.data}
    
    new_jobs = [j for j in jobs if j["id"] not in existing_ids]
    update_jobs = [j for j in jobs if j["id"] in existing_ids]
    
    # Insert new jobs
    if new_jobs:
        client.table("jobs").insert(new_jobs).execute()
    
    # Update existing jobs
    for job in update_jobs:
        client.table("jobs").update({
            "is_active": True,
            "updated_at": "now()",
        }).eq("id", job["id"]).execute()
    
    return len(new_jobs), len(update_jobs)


def mark_inactive(active_ids: set[str]):
    """Mark jobs not in active_ids as inactive."""
    client = get_client()
    
    client.table("jobs").update({
        "is_active": False,
        "updated_at": "now()",
    }).eq("is_active", True).not_.in_("id", list(active_ids)).execute()


def get_users_to_notify(job: dict, scope: str = "all") -> list[dict]:
    """Get users who should be notified about this job."""
    client = get_client()
    
    if scope == "all":
        # Users with notify_scope = 'all'
        result = client.table("user_preferences").select("*").eq("notify_scope", "all").execute()
    else:
        # Users tracking this company
        result = client.table("user_lists").select(
            "user_id, user_preferences(*)"
        ).eq("company_slug", job["company_slug"]).execute()
    
    return result.data
```

## Notifications

```python
# notify.py

import urllib.request

def send_ntfy(topic: str, title: str, message: str, url: str = None):
    """Send push notification via ntfy.sh."""
    headers = {
        "Title": title,
        "Tags": "briefcase",
    }
    if url:
        headers["Click"] = url
    
    req = urllib.request.Request(
        f"https://ntfy.sh/{topic}",
        data=message.encode(),
        headers=headers,
        method="POST"
    )
    urllib.request.urlopen(req, timeout=30)


def notify_users(new_jobs: list[dict]):
    """Notify users about new jobs."""
    
    for job in new_jobs:
        # Get users to notify
        users = get_users_to_notify(job)
        
        for user in users:
            prefs = user.get("user_preferences") or user
            
            # Check role filter
            if prefs.get("role_filters"):
                if not any(r in prefs["role_filters"] for r in job["role_types"]):
                    continue
            
            # Send push notification
            if prefs.get("push_enabled") and prefs.get("ntfy_topic"):
                send_ntfy(
                    topic=prefs["ntfy_topic"],
                    title=f"New job at {job['company_name']}",
                    message=f"{job['title']}\n{job['location']}",
                    url=job["url"]
                )
```

## Main Entry Point

```python
# radar.py

import asyncio
from sources import simplify, greenhouse, lever, ashby
from companies import COMPANIES
from classifier import classify_jobs
from db import upsert_jobs, mark_inactive
from notify import notify_users

def main():
    print("Starting job scrape...")
    
    # 1. Fetch from all sources
    all_jobs = []
    
    # SimplifyJobs (primary source)
    print("Fetching SimplifyJobs...")
    simplify_jobs = simplify.fetch_simplify()
    print(f"  Found {len(simplify_jobs)} jobs")
    all_jobs.extend(simplify_jobs)
    
    # Greenhouse boards
    for slug, info in COMPANIES.items():
        if info["ats_type"] == "greenhouse":
            jobs = greenhouse.fetch_greenhouse(info["ats_token"])
            print(f"  {slug}: {len(jobs)} jobs")
            all_jobs.extend(jobs)
    
    # Lever boards
    for slug, info in COMPANIES.items():
        if info["ats_type"] == "lever":
            jobs = lever.fetch_lever(info["ats_token"])
            print(f"  {slug}: {len(jobs)} jobs")
            all_jobs.extend(jobs)
    
    # Ashby boards
    for slug, info in COMPANIES.items():
        if info["ats_type"] == "ashby":
            jobs = ashby.fetch_ashby(info["ats_token"])
            print(f"  {slug}: {len(jobs)} jobs")
            all_jobs.extend(jobs)
    
    print(f"Total raw jobs: {len(all_jobs)}")
    
    # 2. Normalize
    normalized = []
    for job in all_jobs:
        company_slug = normalize_company(job["company"])
        if company_slug in COMPANIES:
            normalized.append(normalize_job(job, COMPANIES[company_slug]))
    
    print(f"After filtering to target companies: {len(normalized)}")
    
    # 3. Dedupe
    seen = {}
    for job in normalized:
        if job["id"] not in seen:
            seen[job["id"]] = job
    
    deduped = list(seen.values())
    print(f"After dedup: {len(deduped)}")
    
    # 4. Classify with AI
    classified = classify_jobs(deduped)
    print(f"After AI classification: {len(classified)}")
    
    # 5. Upsert to Supabase
    new_count, updated_count = upsert_jobs(classified)
    print(f"New jobs: {new_count}, Updated: {updated_count}")
    
    # Mark inactive jobs
    active_ids = {j["id"] for j in classified}
    mark_inactive(active_ids)
    
    # 6. Notify users about new jobs
    if new_count > 0:
        new_jobs = [j for j in classified if j["id"] in active_ids][:new_count]
        notify_users(new_jobs)
        print(f"Sent notifications for {len(new_jobs)} new jobs")
    
    print("Done!")


if __name__ == "__main__":
    main()
```

## GitHub Actions Workflow

```yaml
# .github/workflows/scrape.yml

name: Scrape Jobs

on:
  schedule:
    - cron: "0 14 * * *"  # Daily at 7am Pacific (14:00 UTC)
  workflow_dispatch: {}    # Manual trigger

jobs:
  scrape:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      
      - name: Install dependencies
        run: |
          cd scraper
          pip install -r requirements.txt
      
      - name: Run scraper
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: |
          cd scraper
          python radar.py
```

## Requirements

```txt
# requirements.txt

requests>=2.31.0
supabase>=2.0.0
python-dotenv>=1.0.0
```

## Environment Variables

| Variable | Description | Where |
|----------|-------------|-------|
| `SUPABASE_URL` | Supabase project URL | GitHub Secrets |
| `SUPABASE_SERVICE_KEY` | Service role key (not anon) | GitHub Secrets |
| `GEMINI_API_KEY` | Google AI Studio key | GitHub Secrets |

## Testing Locally

```bash
cd scraper

# Create .env file
echo "SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co" >> .env
echo "SUPABASE_SERVICE_KEY=your_service_key" >> .env
echo "GEMINI_API_KEY=your_gemini_key" >> .env

# Install deps
pip install -r requirements.txt

# Run
python radar.py
```
