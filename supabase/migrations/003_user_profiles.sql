-- ============================================
-- NEWGRAD RADAR - USER PROFILES & AUTO-APPLY
-- Migration: 003_user_profiles.sql
-- ============================================

-- ============================================
-- TABLE: user_profiles
-- User application profiles for auto-apply feature
-- ============================================
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

-- ============================================
-- TABLE: application_logs
-- Track auto-apply attempts and status
-- ============================================
CREATE TABLE application_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,         -- 'pending', 'filling', 'review', 'submitted', 'failed'
  ats_type TEXT,                -- 'greenhouse', 'lever', 'ashby', 'jobvite', 'workday'
  error_message TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, job_id)
);

CREATE INDEX idx_application_logs_user ON application_logs(user_id);
CREATE INDEX idx_application_logs_status ON application_logs(user_id, status);
CREATE INDEX idx_application_logs_job ON application_logs(job_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_logs ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own profile
CREATE POLICY "Users manage own profile" ON user_profiles
  FOR ALL USING (auth.uid() = user_id);

-- Users can only see their own application logs
CREATE POLICY "Users manage own application logs" ON application_logs
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- UPDATED_AT TRIGGER
-- Automatically update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- STORAGE BUCKET FOR RESUMES
-- Note: Storage buckets cannot be created via SQL.
-- Run this in the Supabase Dashboard under Storage:
--
-- 1. Create bucket named "resumes"
-- 2. Set as private (not public)
-- 3. Add the following RLS policies in the Storage section:
--
-- Policy: Users can upload their own resumes
--   - Allowed operation: INSERT
--   - Target roles: authenticated
--   - Policy: (bucket_id = 'resumes') AND (auth.uid()::text = (storage.foldername(name))[1])
--
-- Policy: Users can read their own resumes
--   - Allowed operation: SELECT
--   - Target roles: authenticated
--   - Policy: (bucket_id = 'resumes') AND (auth.uid()::text = (storage.foldername(name))[1])
--
-- Policy: Users can delete their own resumes
--   - Allowed operation: DELETE
--   - Target roles: authenticated
--   - Policy: (bucket_id = 'resumes') AND (auth.uid()::text = (storage.foldername(name))[1])
--
-- File path convention: {user_id}/resume.pdf
-- ============================================

-- ============================================
-- DONE
-- ============================================
