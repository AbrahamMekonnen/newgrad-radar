-- Application intelligence profile fields and one-time browser handoff tokens.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS preferred_name TEXT,
  ADD COLUMN IF NOT EXISTS pronouns TEXT,
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'United States',
  ADD COLUMN IF NOT EXISTS current_company TEXT,
  ADD COLUMN IF NOT EXISTS current_title TEXT,
  ADD COLUMN IF NOT EXISTS prior_employers TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS default_source TEXT DEFAULT 'Company careers page',
  ADD COLUMN IF NOT EXISTS referral_name TEXT,
  ADD COLUMN IF NOT EXISTS is_adult BOOLEAN,
  ADD COLUMN IF NOT EXISTS bay_area_resident BOOLEAN,
  ADD COLUMN IF NOT EXISTS education_school TEXT,
  ADD COLUMN IF NOT EXISTS education_degree TEXT,
  ADD COLUMN IF NOT EXISTS education_major TEXT,
  ADD COLUMN IF NOT EXISTS education_graduation_date TEXT,
  ADD COLUMN IF NOT EXISTS education_gpa TEXT,
  ADD COLUMN IF NOT EXISTS writing_sample TEXT,
  ADD COLUMN IF NOT EXISTS preferred_tone TEXT DEFAULT 'natural',
  ADD COLUMN IF NOT EXISTS proud_project TEXT,
  ADD COLUMN IF NOT EXISTS career_goals TEXT;

ALTER TABLE autoapply_job_queue
  ADD COLUMN IF NOT EXISTS handoff_token TEXT,
  ADD COLUMN IF NOT EXISTS handoff_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_autoapply_handoff_token
  ON autoapply_job_queue(handoff_token)
  WHERE handoff_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
