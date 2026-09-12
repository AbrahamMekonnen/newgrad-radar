# Database Schema

## Supabase Project

- **Project ID**: `jmrbyubrrpxxvotsljms`
- **URL**: `https://jmrbyubrrpxxvotsljms.supabase.co`
- **Region**: us-east-1 (East US - North Virginia)

## Tables Overview

| Table | Description | RLS |
|-------|-------------|-----|
| `companies` | Master list of ~100 target companies | Public read |
| `jobs` | All scraped job postings | Public read |
| `user_lists` | User's tracked companies ("My List") | User's own data |
| `saved_jobs` | Jobs user saved/applied to | User's own data |
| `user_preferences` | Notification settings | User's own data |
| `user_profiles` | User application profiles for auto-apply | User's own data |
| `application_logs` | Auto-apply application records with status | User's own data |
| `interview_questions` | Interview questions by company/role | Public read |

## Key Relationships

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           ENTITY RELATIONSHIPS                           │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  companies ◄─────┬──────── jobs ◄────────┬─────── saved_jobs             │
│      │           │           │           │              │                │
│      │           │           │           │              │ (trigger sync) │
│      │           │           │           │              ▼                │
│      │           │           │           └────── application_logs        │
│      │           │           │                                           │
│      └───────────┴──────────►│                                           │
│                              │                                           │
│  interview_questions ◄───────┘ (company_name match for Interview Prep)   │
│                                                                          │
│  user_profiles ─────────────────────► application_logs (auto-apply)      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Critical Sync: saved_jobs to application_logs

When a user updates their `saved_jobs.status`, a trigger automatically syncs to `application_logs`:

| saved_jobs.status | application_logs.status |
|-------------------|-------------------------|
| `saved`           | (no entry - just bookmarked) |
| `applied`         | `submitted` |
| `in_review`       | `in_review` |
| `interviewing`    | `interview_scheduled` |
| `rejected`        | `rejected` |
| `offer`           | `offer` |

### Interview Prep Matching

For the Interview Prep feature to show relevant questions:
- `interview_questions.company_name` should match `jobs.company_name`
- Or use `interview_questions.company_slug` to match `jobs.company_slug`

## Schema

### companies

Master list of tracked companies with ATS information.

```sql
CREATE TABLE companies (
  slug TEXT PRIMARY KEY,                  -- "anthropic", "stripe"
  name TEXT NOT NULL,                     -- "Anthropic", "Stripe"
  tier TEXT NOT NULL,                     -- "faang", "ai", "unicorn", "yc", "fintech", "infra"
  ats_type TEXT,                          -- "greenhouse", "lever", "ashby", "workday", null
  ats_token TEXT,                         -- Board token for API calls
  logo_url TEXT,                          -- Company logo URL
  careers_url TEXT,                       -- Link to careers page
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_companies_tier ON companies(tier);
```

**Example data:**
```json
{
  "slug": "anthropic",
  "name": "Anthropic",
  "tier": "ai",
  "ats_type": "greenhouse",
  "ats_token": "anthropic",
  "logo_url": "https://logo.clearbit.com/anthropic.com",
  "careers_url": "https://www.anthropic.com/careers"
}
```

### jobs

All scraped job postings. Shared across all users.

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,                    -- MD5 hash: company_slug + title + url
  company_slug TEXT REFERENCES companies(slug) NOT NULL,
  company_name TEXT NOT NULL,             -- Denormalized for display
  title TEXT NOT NULL,                    -- "Software Engineer, New Grad"
  location TEXT,                          -- "San Francisco, CA" or "Remote"
  url TEXT NOT NULL,                      -- Application URL
  tier TEXT NOT NULL,                     -- Company tier (denormalized)
  role_types TEXT[] DEFAULT '{}',         -- ['swe', 'ml', 'backend']
  source TEXT NOT NULL,                   -- "simplify", "greenhouse", "lever"
  posted DATE,                            -- When job was posted (if known)
  is_active BOOLEAN DEFAULT true,         -- False if job listing closed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_jobs_company ON jobs(company_slug);
CREATE INDEX idx_jobs_tier ON jobs(tier);
CREATE INDEX idx_jobs_active ON jobs(is_active) WHERE is_active = true;
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX idx_jobs_role_types ON jobs USING GIN(role_types);
```

**Example data:**
```json
{
  "id": "a1b2c3d4e5f6",
  "company_slug": "anthropic",
  "company_name": "Anthropic",
  "title": "Software Engineer, New Grad",
  "location": "San Francisco, CA",
  "url": "https://boards.greenhouse.io/anthropic/jobs/123",
  "tier": "ai",
  "role_types": ["swe", "ml"],
  "source": "greenhouse",
  "posted": "2026-09-01",
  "is_active": true
}
```

### user_lists

User's tracked companies ("My List").

```sql
CREATE TABLE user_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  company_slug TEXT REFERENCES companies(slug) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_slug)
);

-- Indexes
CREATE INDEX idx_user_lists_user ON user_lists(user_id);
```

**Example data:**
```json
{
  "id": "uuid-here",
  "user_id": "user-uuid",
  "company_slug": "anthropic",
  "created_at": "2026-09-06T12:00:00Z"
}
```

### saved_jobs

Jobs a user has saved or applied to.

```sql
CREATE TABLE saved_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'saved',            -- "saved", "applied", "interviewing", "rejected", "offer"
  notes TEXT,                             -- User's private notes
  applied_at DATE,                        -- When they applied
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, job_id)
);

-- Indexes
CREATE INDEX idx_saved_jobs_user ON saved_jobs(user_id);
CREATE INDEX idx_saved_jobs_status ON saved_jobs(user_id, status);
```

**Status values:**
| Status | Description |
|--------|-------------|
| `saved` | Bookmarked, not applied yet |
| `applied` | Application submitted |
| `interviewing` | In interview process |
| `rejected` | Got rejected |
| `offer` | Received offer |

### user_preferences

User notification and filter settings.

```sql
CREATE TABLE user_preferences (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  
  -- Notification scope
  notify_scope TEXT DEFAULT 'all',        -- 'all' or 'my_list'
  
  -- Notification methods
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT true,
  ntfy_topic TEXT,                        -- User's personal ntfy topic
  
  -- Role filters (empty = all roles)
  role_filters TEXT[] DEFAULT '{}',       -- ['swe', 'ml', 'backend']
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Default preferences:**
```json
{
  "notify_scope": "all",
  "push_enabled": true,
  "email_enabled": true,
  "ntfy_topic": null,
  "role_filters": []
}
```

### user_profiles

User application profiles for the auto-apply feature.

```sql
CREATE TABLE user_profiles (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,

  -- Basic info
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  location TEXT,
  linkedin_url TEXT,
  portfolio_url TEXT,
  github_url TEXT,

  -- Resume
  resume_url TEXT,              -- Supabase storage URL
  resume_filename TEXT,

  -- Auto-apply settings
  auto_apply_enabled BOOLEAN DEFAULT false,
  auto_submit BOOLEAN DEFAULT false,  -- false = review first, true = full auto

  -- Pre-filled answers (common application questions)
  work_authorization TEXT,      -- 'us_citizen', 'green_card', 'visa', 'need_sponsorship'
  require_sponsorship BOOLEAN,
  years_experience TEXT,
  start_date TEXT,              -- 'immediately', '2_weeks', '1_month', 'other'
  salary_expectation TEXT,
  willing_to_relocate BOOLEAN,

  -- Custom answers (JSON for flexibility)
  custom_answers JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Key fields:**

| Field | Description |
|-------|-------------|
| `auto_apply_enabled` | Master toggle for auto-apply feature |
| `auto_submit` | If `false`, user reviews before submit; if `true`, fully automatic |
| `work_authorization` | Pre-filled sponsorship question answer |
| `custom_answers` | JSON object for any additional application questions |

### application_logs

Tracks auto-apply attempts and manual application status updates.

```sql
CREATE TABLE application_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,         -- 'pending', 'filling', 'review', 'submitted', 'failed', 'interview_scheduled', 'rejected', 'offer'
  ats_type TEXT,                -- 'greenhouse', 'lever', 'ashby', 'jobvite', 'workday'
  error_message TEXT,
  error_category TEXT,          -- 'network_error', 'captcha_blocked', 'login_required', etc.
  
  -- Detailed tracking
  fields_filled JSONB DEFAULT '[]',     -- Array of {field, selector, found, filled, duration_ms}
  fields_failed JSONB DEFAULT '[]',     -- Array of {field, selector, found, filled, error}
  fields_missing TEXT[] DEFAULT '{}',   -- Array of field names not found
  custom_questions JSONB DEFAULT '[]',  -- Array of {question, field_type, options, answer}
  duration_ms INTEGER,                  -- Total duration in milliseconds
  automation_method TEXT,               -- 'extension', 'puppeteer', 'playwright', 'manual'
  application_url TEXT,
  screenshot_url TEXT,
  
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, job_id)
);

-- Indexes
CREATE INDEX idx_application_logs_user ON application_logs(user_id);
CREATE INDEX idx_application_logs_status ON application_logs(user_id, status);
CREATE INDEX idx_application_logs_job ON application_logs(job_id);
```

**Status values:**

| Status | Description |
|--------|-------------|
| `pending` | Queued for auto-apply |
| `filling` | Currently filling form |
| `review` | Filled, awaiting user review |
| `submitted` | Application submitted |
| `failed` | Auto-apply failed |
| `interview_scheduled` | User marked as interviewing (synced from saved_jobs) |
| `rejected` | Rejected (synced from saved_jobs) |
| `offer` | Offer received (synced from saved_jobs) |

### interview_questions

Interview questions scraped from multiple sources.

```sql
CREATE TABLE interview_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Company and position linking
  company_slug TEXT REFERENCES companies(slug) ON DELETE SET NULL,
  company_name TEXT NOT NULL,                   -- Denormalized for display/search
  position TEXT,                                -- 'Software Engineer', 'ML Engineer'
  position_level TEXT,                          -- 'new_grad', 'intern', 'mid', 'senior', 'staff'
  team TEXT,                                    -- Specific team if mentioned

  -- Question content
  question_type question_type NOT NULL DEFAULT 'other',
  question_text TEXT NOT NULL,                  -- The actual question
  question_title TEXT,                          -- Short title/summary
  difficulty difficulty_level DEFAULT 'unknown',

  -- Answer/solution (if available)
  answer_text TEXT,
  answer_approach TEXT,                         -- Approach/hints

  -- Interview context
  interview_round TEXT,                         -- 'phone_screen', 'onsite_1', 'final', 'oa'
  interview_date DATE,
  interview_year INTEGER,
  interview_month INTEGER,

  -- Source tracking
  source_name TEXT NOT NULL,                    -- 'geeksforgeeks', 'leetcode_discuss'
  source_url TEXT,
  source_post_id TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),

  -- Verification and quality
  is_verified BOOLEAN DEFAULT false,
  confidence_score DECIMAL(3,2) DEFAULT 0.5,    -- AI confidence 0.00-1.00

  -- Engagement metrics
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,

  -- Deduplication
  content_hash TEXT,                            -- MD5 hash for deduplication
  is_duplicate BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Primary indexes
CREATE INDEX idx_iq_company_slug ON interview_questions(company_slug);
CREATE INDEX idx_iq_company_name ON interview_questions(company_name);
CREATE INDEX idx_iq_company_name_lower ON interview_questions(LOWER(company_name));
CREATE INDEX idx_iq_question_type ON interview_questions(question_type);
CREATE INDEX idx_iq_difficulty ON interview_questions(difficulty);
CREATE INDEX idx_iq_interview_date ON interview_questions(interview_date DESC);
CREATE INDEX idx_iq_company_date ON interview_questions(company_slug, interview_date DESC);

-- Full-text search
CREATE INDEX idx_iq_question_text_search ON interview_questions USING GIN(to_tsvector('english', question_text));
```

**Question types (enum):**

| Type | Description |
|------|-------------|
| `technical_coding` | LeetCode-style coding problems |
| `technical_conceptual` | CS fundamentals, language-specific |
| `system_design` | Architecture, scalability |
| `behavioral` | STAR method, leadership principles |
| `case_study` | Product sense, estimation |
| `take_home` | Take-home assignments |
| `oa` | Online assessment questions |
| `brain_teaser` | Logic puzzles, probability |
| `other` | Uncategorized |

**Difficulty levels (enum):**
- `easy`
- `medium`
- `hard`
- `unknown`

## Sync Triggers

### saved_jobs to application_logs

When a user updates their `saved_jobs.status`, a trigger automatically syncs to `application_logs`:

```sql
CREATE OR REPLACE FUNCTION sync_saved_job_to_application_log()
RETURNS TRIGGER AS $$
DECLARE
  mapped_status TEXT;
BEGIN
  -- Map saved_jobs status to application_logs status
  CASE NEW.status
    WHEN 'applied' THEN mapped_status := 'submitted';
    WHEN 'in_review' THEN mapped_status := 'in_review';
    WHEN 'interviewing' THEN mapped_status := 'interview_scheduled';
    WHEN 'rejected' THEN mapped_status := 'rejected';
    WHEN 'offer' THEN mapped_status := 'offer';
    ELSE mapped_status := NULL;
  END CASE;

  -- If status is 'saved', delete any existing application_log
  IF NEW.status = 'saved' THEN
    DELETE FROM application_logs
    WHERE user_id = NEW.user_id AND job_id = NEW.job_id;
    RETURN NEW;
  END IF;

  -- Upsert into application_logs
  INSERT INTO application_logs (user_id, job_id, status, submitted_at, created_at)
  VALUES (NEW.user_id, NEW.job_id, mapped_status, COALESCE(NEW.applied_at, NOW()), COALESCE(NEW.created_at, NOW()))
  ON CONFLICT (user_id, job_id) DO UPDATE SET status = EXCLUDED.status;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_saved_job
  AFTER INSERT OR UPDATE OF status ON saved_jobs
  FOR EACH ROW
  EXECUTE FUNCTION sync_saved_job_to_application_log();
```

This ensures:
- Manual status updates in saved_jobs are reflected in application_logs
- Analytics and stats pull from application_logs for a unified view
- Auto-apply entries in application_logs are NOT overwritten by manual saves

## Row Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY;

-- Public tables (anyone can read)
CREATE POLICY "Public read companies" ON companies
  FOR SELECT USING (true);

CREATE POLICY "Public read jobs" ON jobs
  FOR SELECT USING (true);

CREATE POLICY "Interview questions are publicly readable" ON interview_questions
  FOR SELECT USING (true);

-- User-specific tables (users can only access their own data)
CREATE POLICY "Users manage own lists" ON user_lists
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own saved" ON saved_jobs
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own prefs" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own profile" ON user_profiles
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own application logs" ON application_logs
  FOR ALL USING (auth.uid() = user_id);

-- Service role policies (for scraper to write jobs)
CREATE POLICY "Service writes jobs" ON jobs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service updates jobs" ON jobs
  FOR UPDATE USING (true);

CREATE POLICY "Service writes companies" ON companies
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service updates companies" ON companies
  FOR UPDATE USING (true);

CREATE POLICY "Service role can manage interview questions" ON interview_questions
  FOR ALL USING (auth.role() = 'service_role');
```

## Full Migration Script

Run this in Supabase SQL Editor:

```sql
-- ============================================
-- NEWGRAD RADAR - DATABASE MIGRATION
-- Run this in Supabase SQL Editor
-- ============================================

-- Drop existing tables if re-running
DROP TABLE IF EXISTS user_preferences CASCADE;
DROP TABLE IF EXISTS saved_jobs CASCADE;
DROP TABLE IF EXISTS user_lists CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- ============================================
-- TABLE: companies
-- ============================================
CREATE TABLE companies (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  ats_type TEXT,
  ats_token TEXT,
  logo_url TEXT,
  careers_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_tier ON companies(tier);

-- ============================================
-- TABLE: jobs
-- ============================================
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  company_slug TEXT REFERENCES companies(slug) NOT NULL,
  company_name TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  url TEXT NOT NULL,
  tier TEXT NOT NULL,
  role_types TEXT[] DEFAULT '{}',
  source TEXT NOT NULL,
  posted DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_company ON jobs(company_slug);
CREATE INDEX idx_jobs_tier ON jobs(tier);
CREATE INDEX idx_jobs_active ON jobs(is_active) WHERE is_active = true;
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX idx_jobs_role_types ON jobs USING GIN(role_types);

-- ============================================
-- TABLE: user_lists
-- ============================================
CREATE TABLE user_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  company_slug TEXT REFERENCES companies(slug) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_slug)
);

CREATE INDEX idx_user_lists_user ON user_lists(user_id);

-- ============================================
-- TABLE: saved_jobs
-- ============================================
CREATE TABLE saved_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'saved',
  notes TEXT,
  applied_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, job_id)
);

CREATE INDEX idx_saved_jobs_user ON saved_jobs(user_id);
CREATE INDEX idx_saved_jobs_status ON saved_jobs(user_id, status);

-- ============================================
-- TABLE: user_preferences
-- ============================================
CREATE TABLE user_preferences (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  notify_scope TEXT DEFAULT 'all',
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT true,
  ntfy_topic TEXT,
  role_filters TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Public read companies" ON companies FOR SELECT USING (true);
CREATE POLICY "Public read jobs" ON jobs FOR SELECT USING (true);

-- User policies
CREATE POLICY "Users manage own lists" ON user_lists FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own saved" ON saved_jobs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own prefs" ON user_preferences FOR ALL USING (auth.uid() = user_id);

-- Service role writes
CREATE POLICY "Service writes jobs" ON jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Service updates jobs" ON jobs FOR UPDATE USING (true);
CREATE POLICY "Service writes companies" ON companies FOR INSERT WITH CHECK (true);
CREATE POLICY "Service updates companies" ON companies FOR UPDATE USING (true);

-- ============================================
-- DONE
-- ============================================
```

## Common Queries

### Get all active jobs (paginated)
```sql
SELECT * FROM jobs 
WHERE is_active = true 
ORDER BY created_at DESC 
LIMIT 20 OFFSET 0;
```

### Get jobs filtered by tier and role
```sql
SELECT * FROM jobs 
WHERE is_active = true 
  AND tier = 'ai' 
  AND 'ml' = ANY(role_types)
ORDER BY created_at DESC;
```

### Get user's tracked companies with job counts
```sql
SELECT 
  c.*,
  COUNT(j.id) as job_count
FROM user_lists ul
JOIN companies c ON c.slug = ul.company_slug
LEFT JOIN jobs j ON j.company_slug = c.slug AND j.is_active = true
WHERE ul.user_id = auth.uid()
GROUP BY c.slug;
```

### Get jobs from user's tracked companies
```sql
SELECT j.* FROM jobs j
JOIN user_lists ul ON ul.company_slug = j.company_slug
WHERE ul.user_id = auth.uid()
  AND j.is_active = true
ORDER BY j.created_at DESC;
```

### Get user's saved jobs with job details
```sql
SELECT 
  sj.*,
  j.company_name,
  j.title,
  j.location,
  j.url,
  j.tier
FROM saved_jobs sj
JOIN jobs j ON j.id = sj.job_id
WHERE sj.user_id = auth.uid()
ORDER BY sj.created_at DESC;
```

### Get user's application status summary
```sql
SELECT 
  status,
  COUNT(*) as count
FROM application_logs
WHERE user_id = auth.uid()
GROUP BY status
ORDER BY count DESC;
```

### Get user's auto-apply profile status
```sql
SELECT 
  auto_apply_enabled,
  auto_submit,
  CASE 
    WHEN resume_url IS NOT NULL THEN true 
    ELSE false 
  END as has_resume,
  work_authorization
FROM user_profiles
WHERE user_id = auth.uid();
```

### Get interview questions for a company (recent)
```sql
SELECT 
  id,
  question_title,
  question_text,
  question_type,
  difficulty,
  interview_date,
  source_name,
  upvotes
FROM interview_questions
WHERE company_slug = 'anthropic'
  AND is_duplicate = false
  AND interview_date >= (CURRENT_DATE - INTERVAL '6 months')
ORDER BY interview_date DESC, upvotes DESC
LIMIT 50;
```

### Get question type distribution for a company
```sql
SELECT 
  question_type,
  COUNT(*) as count,
  ROUND(COUNT(*)::DECIMAL / SUM(COUNT(*)) OVER() * 100, 2) as percentage
FROM interview_questions
WHERE company_slug = 'stripe'
  AND is_duplicate = false
GROUP BY question_type
ORDER BY count DESC;
```

### Get interview questions matching a job's company
```sql
SELECT iq.*
FROM interview_questions iq
JOIN jobs j ON LOWER(iq.company_name) = LOWER(j.company_name)
WHERE j.id = 'some-job-id'
  AND iq.is_duplicate = false
ORDER BY iq.interview_date DESC
LIMIT 20;
```

## Testing

After running the migration, test with:

```sql
-- Insert a test company
INSERT INTO companies (slug, name, tier, ats_type, ats_token)
VALUES ('test-company', 'Test Company', 'ai', 'greenhouse', 'test');

-- Insert a test job
INSERT INTO jobs (id, company_slug, company_name, title, location, url, tier, role_types, source)
VALUES (
  'test-job-1',
  'test-company',
  'Test Company',
  'Software Engineer, New Grad',
  'San Francisco, CA',
  'https://example.com/apply',
  'ai',
  ARRAY['swe', 'ml'],
  'greenhouse'
);

-- Verify
SELECT * FROM companies;
SELECT * FROM jobs;

-- Clean up test data
DELETE FROM jobs WHERE id = 'test-job-1';
DELETE FROM companies WHERE slug = 'test-company';
```
