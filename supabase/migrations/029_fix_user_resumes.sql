-- Fix user_resumes table: add unique constraint and resume_data column
-- This resolves the conflict between migrations 006 and 008

-- Add resume_data column if it doesn't exist (from migration 008's intended schema)
ALTER TABLE user_resumes
ADD COLUMN IF NOT EXISTS resume_data JSONB DEFAULT '{}'::jsonb;

-- Add unique constraint on (user_id, name) for proper upsert behavior
-- Drop existing constraint if any to avoid conflicts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_resumes_user_id_name_key'
  ) THEN
    ALTER TABLE user_resumes ADD CONSTRAINT user_resumes_user_id_name_key UNIQUE (user_id, name);
  END IF;
END $$;

-- Add GIN index on resume_data for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_user_resumes_resume_data_gin
  ON user_resumes USING GIN(resume_data);

-- Comment for documentation
COMMENT ON COLUMN user_resumes.resume_data IS 'JSONB containing structured resume: {name, email, phone, education[], experience[], skills[], projects[]}';
