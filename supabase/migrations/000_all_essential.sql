-- ============================================
-- SAFE MIGRATION SCRIPT - All Essential Tables
-- Safe to run multiple times (uses IF NOT EXISTS)
-- ============================================

-- ============================================
-- 001: CORE TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS companies (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  careers_url TEXT,
  tier TEXT DEFAULT 'other',
  industry TEXT,
  size TEXT,
  founded INTEGER,
  headquarters TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  company_slug TEXT REFERENCES companies(slug),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  location TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  posted_at TIMESTAMPTZ,
  source TEXT,
  is_active BOOLEAN DEFAULT true,
  role_type TEXT DEFAULT 'swe',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  company_slug TEXT REFERENCES companies(slug) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_slug)
);

CREATE TABLE IF NOT EXISTS saved_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'saved',
  notes TEXT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, job_id)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_all_jobs BOOLEAN DEFAULT true,
  notify_my_list_only BOOLEAN DEFAULT false,
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,
  ntfy_topic TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on core tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Core policies (safe to run - will fail silently if exist)
DO $$ BEGIN
  CREATE POLICY "Public read companies" ON companies FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Public read jobs" ON jobs FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own lists" ON user_lists FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own saved" ON saved_jobs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own preferences" ON user_preferences FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- 002: RECRUITERS
-- ============================================

CREATE TABLE IF NOT EXISTS recruiters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_slug TEXT REFERENCES companies(slug),
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  linkedin_url TEXT,
  verified BOOLEAN DEFAULT false,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recruiter_votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recruiter_id UUID REFERENCES recruiters(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vote INTEGER CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(recruiter_id, user_id)
);

ALTER TABLE recruiters ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_votes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Public read recruiters" ON recruiters FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own votes" ON recruiter_votes FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- 003: USER PROFILES
-- ============================================

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  github_url TEXT,
  portfolio_url TEXT,
  location TEXT,
  resume_url TEXT,
  resume_filename TEXT,
  work_authorization TEXT DEFAULT 'US Citizen',
  requires_sponsorship BOOLEAN DEFAULT false,
  willing_to_relocate BOOLEAN DEFAULT true,
  earliest_start_date TEXT DEFAULT 'Immediately',
  school TEXT,
  degree TEXT DEFAULT 'Bachelor''s',
  major TEXT DEFAULT 'Computer Science',
  graduation_year TEXT,
  interests TEXT[],
  goals TEXT[],
  strengths TEXT[],
  highlights TEXT[],
  eeo_responses JSONB DEFAULT '{}',
  standard_answers JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS application_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'started',
  error_message TEXT,
  ats_type TEXT,
  fields_filled INTEGER,
  time_spent_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, job_id)
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own profile" ON user_profiles FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own application logs" ON application_logs FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- 009: JOB SOURCE (add column if missing)
-- ============================================
DO $$ BEGIN
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================
-- 011: MULTI-DIMENSIONAL TAGS
-- ============================================

CREATE TABLE IF NOT EXISTS tag_registry (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add tag columns to jobs if missing
DO $$ BEGIN
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS diversity_tags TEXT[];
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS badges TEXT[];
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_mode TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================
-- 012: JOB ALERTS
-- ============================================

CREATE TABLE IF NOT EXISTS job_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  delivery_mode TEXT DEFAULT 'instant' CHECK (delivery_mode IN ('instant', 'daily_digest', 'weekly_digest')),
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT true,
  filters JSONB DEFAULT '{}'::JSONB,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE job_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own alerts" ON job_alerts FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_job_alerts_user_id ON job_alerts(user_id);

-- ============================================
-- 016: EXPERIENCE LEVEL
-- ============================================
DO $$ BEGIN
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_level TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================
-- 018: USER LISTS NOTIFICATIONS
-- ============================================
DO $$ BEGIN
  ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS auto_apply_enabled BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================
-- 019: USER LISTS FILTERS
-- ============================================
DO $$ BEGIN
  ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS filters JSONB DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================
-- 020: FEEDBACK REPORTS
-- ============================================

-- Create enums safely
DO $$ BEGIN
  CREATE TYPE feedback_report_type AS ENUM ('bug', 'feature', 'feedback');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE feedback_report_status AS ENUM ('open', 'acknowledged', 'in_progress', 'resolved', 'wontfix');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE feedback_report_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS feedback_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type feedback_report_type NOT NULL DEFAULT 'feedback',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status feedback_report_status NOT NULL DEFAULT 'open',
  priority feedback_report_priority NOT NULL DEFAULT 'medium',
  screenshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE feedback_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can create own reports" ON feedback_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can read own reports" ON feedback_reports FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_feedback_reports_user_id ON feedback_reports(user_id);

-- ============================================
-- 022: SALARY & AVAILABILITY
-- ============================================
DO $$ BEGIN
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_text TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS h1b_sponsor BOOLEAN;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================
-- 025: AUTO-APPLY JOB QUEUE
-- ============================================

CREATE TABLE IF NOT EXISTS autoapply_job_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  job_url TEXT NOT NULL,
  company_name TEXT,
  job_title TEXT,
  ats_type TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'review')),
  priority INTEGER DEFAULT 0,
  worker_id TEXT,
  locked_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  confirmation_id TEXT,
  error_message TEXT,
  error_type TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE autoapply_job_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own queue" ON autoapply_job_queue FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_autoapply_queue_pending ON autoapply_job_queue(status, priority DESC, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_autoapply_queue_user ON autoapply_job_queue(user_id, status);

-- ============================================
-- 027: APPLY URL
-- ============================================
DO $$ BEGIN
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_url TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================
-- 028: GLOBAL CUSTOM COMPANIES
-- ============================================
DO $$ BEGIN
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS verification_source TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_user_submitted BOOLEAN DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Allow users to insert companies
DO $$ BEGIN
  CREATE POLICY "Users can add companies" ON companies FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- QUEUE FUNCTIONS (for auto-apply worker)
-- ============================================

-- Drop existing functions first (signature may have changed)
DROP FUNCTION IF EXISTS claim_autoapply_job(TEXT, INTERVAL);
DROP FUNCTION IF EXISTS complete_autoapply_job(UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS fail_autoapply_job(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION claim_autoapply_job(p_worker_id TEXT, p_lock_duration INTERVAL DEFAULT '10 minutes')
RETURNS TABLE(
  id UUID,
  user_id UUID,
  job_id TEXT,
  job_url TEXT,
  company_name TEXT,
  job_title TEXT,
  ats_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  UPDATE autoapply_job_queue q
  SET
    status = 'processing',
    worker_id = p_worker_id,
    locked_at = NOW(),
    started_at = COALESCE(started_at, NOW()),
    updated_at = NOW()
  WHERE q.id = (
    SELECT q2.id FROM autoapply_job_queue q2
    WHERE q2.status = 'pending'
      AND (q2.next_retry_at IS NULL OR q2.next_retry_at <= NOW())
    ORDER BY q2.priority DESC, q2.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING q.id, q.user_id, q.job_id, q.job_url, q.company_name, q.job_title, q.ats_type;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION complete_autoapply_job(p_queue_id UUID, p_confirmation_id TEXT DEFAULT NULL, p_result JSONB DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  UPDATE autoapply_job_queue
  SET
    status = 'completed',
    completed_at = NOW(),
    confirmation_id = p_confirmation_id,
    result = p_result,
    updated_at = NOW()
  WHERE id = p_queue_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fail_autoapply_job(p_queue_id UUID, p_error_message TEXT, p_error_type TEXT DEFAULT 'unknown')
RETURNS TABLE(should_retry BOOLEAN, next_retry_at TIMESTAMPTZ) AS $$
DECLARE
  v_retry_count INTEGER;
  v_max_retries INTEGER;
  v_should_retry BOOLEAN;
  v_next_retry TIMESTAMPTZ;
BEGIN
  SELECT retry_count, max_retries INTO v_retry_count, v_max_retries
  FROM autoapply_job_queue WHERE id = p_queue_id;

  v_should_retry := (v_retry_count < v_max_retries) AND (p_error_type NOT IN ('permanent', 'validation'));

  IF v_should_retry THEN
    v_next_retry := NOW() + (POWER(2, v_retry_count) * INTERVAL '1 minute');

    UPDATE autoapply_job_queue
    SET
      status = 'pending',
      error_message = p_error_message,
      error_type = p_error_type,
      retry_count = retry_count + 1,
      next_retry_at = v_next_retry,
      worker_id = NULL,
      locked_at = NULL,
      updated_at = NOW()
    WHERE id = p_queue_id;
  ELSE
    UPDATE autoapply_job_queue
    SET
      status = 'failed',
      error_message = p_error_message,
      error_type = p_error_type,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = p_queue_id;
  END IF;

  RETURN QUERY SELECT v_should_retry, v_next_retry;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- DONE! All essential tables created.
-- ============================================
