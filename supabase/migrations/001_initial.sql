-- ============================================
-- NEWGRAD RADAR - INITIAL MIGRATION
-- Run via: supabase db push or Supabase SQL Editor
-- ============================================

-- Drop existing tables if re-running (safe for initial setup)
DROP TABLE IF EXISTS user_preferences CASCADE;
DROP TABLE IF EXISTS saved_jobs CASCADE;
DROP TABLE IF EXISTS user_lists CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- ============================================
-- TABLE: companies
-- Master list of tracked companies with ATS information
-- ============================================
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

CREATE INDEX idx_companies_tier ON companies(tier);

-- ============================================
-- TABLE: jobs
-- All scraped job postings (shared across all users)
-- ============================================
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

CREATE INDEX idx_jobs_company ON jobs(company_slug);
CREATE INDEX idx_jobs_tier ON jobs(tier);
CREATE INDEX idx_jobs_active ON jobs(is_active) WHERE is_active = true;
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX idx_jobs_role_types ON jobs USING GIN(role_types);

-- ============================================
-- TABLE: user_lists
-- User's tracked companies ("My List")
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
-- Jobs a user has saved or applied to
-- Status: saved, applied, interviewing, rejected, offer
-- ============================================
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

CREATE INDEX idx_saved_jobs_user ON saved_jobs(user_id);
CREATE INDEX idx_saved_jobs_status ON saved_jobs(user_id, status);

-- ============================================
-- TABLE: user_preferences
-- User notification and filter settings
-- ============================================
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

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Public read policies (anyone can read)
CREATE POLICY "Public read companies" ON companies
  FOR SELECT USING (true);

CREATE POLICY "Public read jobs" ON jobs
  FOR SELECT USING (true);

-- User-specific policies (users can only access their own data)
CREATE POLICY "Users manage own lists" ON user_lists
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own saved" ON saved_jobs
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own prefs" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

-- Service role policies (for scraper to write jobs/companies)
CREATE POLICY "Service writes jobs" ON jobs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service updates jobs" ON jobs
  FOR UPDATE USING (true);

CREATE POLICY "Service writes companies" ON companies
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service updates companies" ON companies
  FOR UPDATE USING (true);

-- ============================================
-- DONE
-- ============================================
