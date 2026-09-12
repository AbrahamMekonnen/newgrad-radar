-- ============================================
-- Migration: Auto-Apply Enhancements
-- Adds per-company auto-apply and custom companies
-- ============================================

-- Add auto_apply toggle to user_lists (per-company setting)
ALTER TABLE user_lists
ADD COLUMN IF NOT EXISTS auto_apply BOOLEAN DEFAULT FALSE;

-- Add global auto-apply setting to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS auto_apply_all_jobs BOOLEAN DEFAULT FALSE;

-- ============================================
-- TABLE: user_companies
-- Custom companies added by users (not in main list)
-- ============================================
CREATE TABLE IF NOT EXISTS user_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slug TEXT NOT NULL,                     -- Generated from name
  name TEXT NOT NULL,
  tier TEXT DEFAULT 'other',              -- User-selected or 'other'
  careers_url TEXT,                       -- Link to careers page
  logo_url TEXT,
  auto_apply BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_user_companies_user ON user_companies(user_id);

-- Enable RLS
ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own custom companies
CREATE POLICY "Users can view own companies"
  ON user_companies FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own companies"
  ON user_companies FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own companies"
  ON user_companies FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own companies"
  ON user_companies FOR DELETE
  USING (auth.uid() = user_id);
