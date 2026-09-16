-- Cache the extracted plain text of each user's resume PDF so the AI drafter can
-- ground application answers in the applicant's REAL background (education, work
-- history, projects). Populated once, lazily, from resume_url the first time we
-- prepare an application for the user.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS resume_text TEXT;

COMMENT ON COLUMN user_profiles.resume_text IS
  'Plain text extracted from resume_url (PDF). Grounds AI-drafted answers.';

NOTIFY pgrst, 'reload schema';
