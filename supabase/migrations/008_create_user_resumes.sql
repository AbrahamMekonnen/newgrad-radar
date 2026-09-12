-- ============================================================================
-- Migration: Create user_resumes table
-- Purpose: Store user resume data with support for multiple resume versions
--
-- Columns:
--   - id: UUID primary key
--   - user_id: References auth.users, links resume to a user
--   - resume_data: JSONB containing parsed resume structure (education,
--                  experience, skills, projects, etc.)
--   - is_base: Boolean flag indicating if this is the user's default/base resume
--              (only one resume per user should have is_base = true)
--   - created_at: Timestamp when the resume was created
--   - updated_at: Timestamp when the resume was last modified
--
-- Features:
--   - RLS enabled for user data isolation
--   - Partial unique index ensures only one base resume per user
--   - Auto-updating updated_at via trigger
--   - GIN index on resume_data for fast JSONB queries
-- ============================================================================

-- Create the user_resumes table
CREATE TABLE IF NOT EXISTS user_resumes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_base BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_resumes_user_id ON user_resumes(user_id);

-- Partial unique index: only one base resume per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_resumes_one_base_per_user
  ON user_resumes(user_id)
  WHERE is_base = true;

-- GIN index for efficient JSONB queries on resume_data
CREATE INDEX IF NOT EXISTS idx_user_resumes_resume_data_gin
  ON user_resumes USING GIN(resume_data);

-- Enable Row Level Security
ALTER TABLE user_resumes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own resumes
CREATE POLICY "Users can view own resumes" ON user_resumes
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own resumes
CREATE POLICY "Users can insert own resumes" ON user_resumes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own resumes
CREATE POLICY "Users can update own resumes" ON user_resumes
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Users can delete their own resumes
CREATE POLICY "Users can delete own resumes" ON user_resumes
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_resumes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_user_resumes_updated_at
  BEFORE UPDATE ON user_resumes
  FOR EACH ROW
  EXECUTE FUNCTION update_user_resumes_updated_at();

-- Comment on table and columns for documentation
COMMENT ON TABLE user_resumes IS 'Stores parsed user resume data with support for multiple versions';
COMMENT ON COLUMN user_resumes.resume_data IS 'JSONB containing structured resume: {name, email, phone, education[], experience[], skills[], projects[]}';
COMMENT ON COLUMN user_resumes.is_base IS 'True if this is the user''s default base resume (max one per user)';
