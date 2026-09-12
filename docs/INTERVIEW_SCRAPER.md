# Interview Question Scraper

This document covers the setup, usage, and troubleshooting of the interview question scraping system.

## Overview

The interview scraper aggregates coding and behavioral interview questions from multiple sources worldwide. It runs daily via GitHub Actions and stores questions in the `interview_questions` table in Supabase.

**Key Features:**
- Parallel execution with concurrency control
- Priority-based scraper ordering (Tier 1-5)
- Incremental mode (only fetch new since last run)
- Resume capability from failed runs
- Content-hash based deduplication
- Full-text search support

## Architecture

```
scraper/
├── interview_orchestrator.py    # Main orchestrator (parallel execution, deduplication)
├── cli.py                       # Command-line interface
├── db_optimizer.py              # Batch inserts, connection pooling
├── config.py                    # Environment variables
└── sources/
    └── interview_questions/     # Individual scraper modules
        ├── geeksforgeeks.py
        ├── leetcode_discuss.py
        ├── github_repos.py
        ├── github_gists.py
        ├── careercup.py
        ├── reddit.py
        ├── hackernews.py
        ├── nowcoder.py          # Chinese
        ├── programmers_kr.py    # Korean
        ├── qiita.py             # Japanese
        ├── habr.py              # Russian
        ├── takeuforward.py      # Indian
        ├── codestudio.py        # Indian
        ├── quant_finance.py     # Quant/prop trading
        ├── wikijob.py           # UK
        ├── dou_ua.py            # Ukrainian
        └── openwork.py          # Japanese
```

## Scraper Tiers

| Tier | Sources | Reliability | Notes |
|------|---------|-------------|-------|
| 1 | devto, hackernews, reddit | API-based | Most reliable, rate-limited |
| 2 | github_repos, github_gists, geeksforgeeks, careercup, leetcode_discuss | Structured | Need HTML parsing |
| 3 | nowcoder, programmers_kr, qiita, habr | International | Require translation |
| 4 | takeuforward, codestudio | Indian | High volume |
| 5 | quantfinance, wikijob, dou_ukraine, openwork | Niche | Specialized audiences |

## Quick Start

### Prerequisites

1. Python 3.12+
2. Supabase project with migrations applied
3. Required environment variables

### Environment Setup

Create `scraper/.env` (or set in GitHub Secrets):

```bash
# Required
SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
SUPABASE_SERVICE_KEY=<your_service_role_key>

# Optional (for enhanced functionality)
GITHUB_TOKEN=<github_pat>           # Higher rate limits for GitHub scrapers
REDDIT_CLIENT_ID=<client_id>        # Reddit API access
REDDIT_CLIENT_SECRET=<client_secret>
GEMINI_API_KEY=<key>                # AI classification
```

### Install Dependencies

```bash
cd scraper
pip install -r requirements.txt
```

### Running Locally

```bash
# List available scrapers
python cli.py list

# Check scraper status (last run times)
python cli.py status

# Run all scrapers
python cli.py run-all

# Run all scrapers (dry run - no database writes)
python cli.py run-all --dry-run

# Run specific scrapers
python cli.py run devto reddit github_repos

# Run with custom time range
python cli.py run-all --months 2
```

### Advanced CLI Usage

The orchestrator supports advanced options:

```bash
# Direct orchestrator usage
python interview_orchestrator.py --help

# Run with concurrency limit
python interview_orchestrator.py --concurrency 3

# Incremental mode (only new since last successful run)
python interview_orchestrator.py --incremental

# Resume from failed run
python interview_orchestrator.py --resume

# Exclude specific scrapers
python interview_orchestrator.py --exclude glassdoor blind

# Disable progress bar (for CI)
python interview_orchestrator.py --no-progress
```

## Database Schema

### Primary Tables

**`interview_questions`** - Core questions table:
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (content hash) |
| `company_slug` | TEXT | FK to companies table |
| `company_name` | TEXT | Denormalized for display |
| `position` | TEXT | Job title |
| `position_level` | TEXT | `new_grad`, `intern`, `mid`, `senior`, `staff` |
| `question_type` | ENUM | `technical_coding`, `system_design`, `behavioral`, `oa`, etc. |
| `question_text` | TEXT | Full question content |
| `difficulty` | ENUM | `easy`, `medium`, `hard`, `unknown` |
| `interview_date` | DATE | When interview occurred |
| `source_name` | TEXT | Source identifier |
| `source_url` | TEXT | Direct link |
| `is_verified` | BOOLEAN | Human-verified |
| `upvotes` | INTEGER | Community votes |
| `content_hash` | TEXT | MD5 for deduplication |

**`interview_sources`** - Source tracking:
| Column | Type | Description |
|--------|------|-------------|
| `name` | TEXT | Unique identifier |
| `last_scraped_at` | TIMESTAMPTZ | Last successful run |
| `total_questions_scraped` | INTEGER | Running count |
| `is_active` | BOOLEAN | Whether actively scraping |

**`question_tags`** - Tags for filtering:
- Algorithm tags: `dynamic_programming`, `binary_search`, `dfs`, etc.
- Data structure tags: `arrays`, `trees`, `graphs`, etc.
- System design tags: `scalability`, `caching`, `api_design`

### Question Types

```sql
CREATE TYPE question_type AS ENUM (
  'technical_coding',      -- LeetCode-style
  'technical_conceptual',  -- CS fundamentals
  'system_design',         -- Architecture
  'behavioral',            -- STAR method
  'case_study',            -- Product sense
  'take_home',             -- Assignments
  'oa',                    -- Online assessments
  'brain_teaser',          -- Logic puzzles
  'other'
);
```

## GitHub Actions

The scraper runs daily at 9am Pacific (16:00 UTC) via `.github/workflows/interview_questions.yml`:

```yaml
on:
  schedule:
    - cron: "0 16 * * *"
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Run without writing to database"
        type: boolean
        default: false
```

### Required Secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

### Manual Trigger

1. Go to Actions tab in GitHub
2. Select "Scrape Interview Questions"
3. Click "Run workflow"
4. Optionally enable dry_run mode

## Adding a New Scraper

1. Create `scraper/sources/interview_questions/<source_name>.py`:

```python
from datetime import datetime
from typing import Optional

def scrape_<source_name>(
    start_date: datetime,
    end_date: datetime,
) -> list[dict]:
    """Scrape interview questions from <source>.
    
    Args:
        start_date: Earliest date to fetch
        end_date: Latest date to fetch
        
    Returns:
        List of question dictionaries
    """
    questions = []
    
    # Your scraping logic here
    
    for item in scraped_data:
        questions.append({
            'company_name': item['company'],
            'company_normalized': normalize_company(item['company']),
            'role': item.get('role', 'Software Engineer'),
            'role_normalized': 'swe',
            'question_text': item['question'],
            'question_type': 'technical_coding',  # or 'behavioral', 'system_design', etc.
            'difficulty': 'medium',  # 'easy', 'medium', 'hard', 'unknown'
            'source': '<source_name>',
            'source_url': item['url'],
            'posted_date': item['date'],
            'upvotes': item.get('upvotes', 0),
            'tags': item.get('tags', []),
        })
    
    return questions
```

2. Register in `interview_orchestrator.py`:

```python
ScraperConfig(
    name='<source_name>',
    source='<source_name>',
    scraper_type='python',
    module_path='sources.interview_questions.<source_name>',
    function_name='scrape_<source_name>',
    priority=3,  # 1-5, lower = higher priority
    schedule='daily',  # or 'hourly', 'weekly'
),
```

3. Test:

```bash
python cli.py run <source_name> --dry-run
```

## Seed Data

For development/testing, seed data is available:

```bash
# Apply via Supabase CLI
supabase db push

# Or manually run
psql $DATABASE_URL < supabase/migrations/032_seed_interview_questions.sql
```

Seed data includes ~50 questions for 20 major companies (Google, Meta, Apple, Amazon, Microsoft, Stripe, OpenAI, Anthropic, Netflix, etc.).

## Troubleshooting

### Common Issues

**1. "SUPABASE_SERVICE_KEY not set"**
```bash
# Check environment
echo $SUPABASE_SERVICE_KEY

# Set in .env file
echo "SUPABASE_SERVICE_KEY=your_key" >> scraper/.env
```

**2. Rate limiting errors**
- Reduce concurrency: `--concurrency 2`
- Add delay in scraper config: `rate_limit_delay: 3.0`
- Use API tokens where available (GitHub, Reddit)

**3. Scraper timeout**
- Increase timeout in ScraperConfig: `timeout: 600`
- Run specific slow scrapers separately: `python cli.py run <scraper>`

**4. Duplicate questions**
- Content-hash based deduplication is automatic
- Check `is_duplicate` field in database
- Run with `--incremental` to only fetch new

**5. Resume after failure**
```bash
# Resume from last incomplete run
python interview_orchestrator.py --resume

# State is stored in scraper/.orchestrator_state.json
```

**6. Import errors**
```bash
# Ensure you're in the scraper directory
cd scraper

# Check module structure
python -c "from sources.interview_questions.devto_interviews import scrape_devto; print('OK')"
```

### Checking Logs

```bash
# Local logs
tail -f scraper/interview_scraper.log

# GitHub Actions
# View in Actions tab > Select run > scrape-interviews job
```

### Database Queries

```sql
-- Recent questions
SELECT company_name, question_type, difficulty, source_name, scraped_at
FROM interview_questions
ORDER BY scraped_at DESC
LIMIT 20;

-- Questions per source
SELECT source_name, COUNT(*) as count
FROM interview_questions
GROUP BY source_name
ORDER BY count DESC;

-- Questions per company
SELECT company_name, COUNT(*) as count
FROM interview_questions
WHERE is_duplicate = false
GROUP BY company_name
ORDER BY count DESC
LIMIT 20;

-- Recent scraper runs
SELECT source_name, started_at, status, questions_new
FROM scraper_runs
ORDER BY started_at DESC
LIMIT 10;
```

## Performance Tips

1. **Use incremental mode** for daily runs:
   ```bash
   python interview_orchestrator.py --incremental
   ```

2. **Limit concurrency** if hitting rate limits:
   ```bash
   python interview_orchestrator.py --concurrency 3
   ```

3. **Run specific scrapers** for testing:
   ```bash
   python cli.py run devto reddit --dry-run
   ```

4. **Monitor with progress bar** (enabled by default):
   ```
   [████████████████████░░░░░░░░░░] 70% | 14/20 | 3 running | 45s
   ```

## Related Files

- Migration: `/supabase/migrations/030_interview_questions.sql`
- Optimization: `/supabase/migrations/031_interview_questions_optimization.sql`
- Seed data: `/supabase/migrations/032_seed_interview_questions.sql`
- GitHub Action: `/.github/workflows/interview_questions.yml`
- Main docs: `/docs/SCRAPER.md`
