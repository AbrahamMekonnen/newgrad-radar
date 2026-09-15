-- Tag each recruiter with the hiring focus they own, so a job card shows the
-- recruiters who actually handle that job's level instead of every recruiter at
-- the company. Values: 'new_grad' (university/campus/early-career recruiters),
-- 'experienced' (technical/senior recruiters), 'generic' (fits any level).
ALTER TABLE recruiters
  ADD COLUMN IF NOT EXISTS role_focus TEXT;

COMMENT ON COLUMN recruiters.role_focus IS
  'Hiring focus: new_grad | experienced | generic. Used to match recruiters to a job''s experience level.';

-- Also ensure email_variants exists (was migration 005; add here idempotently
-- in case that migration was never applied to this database).
ALTER TABLE recruiters
  ADD COLUMN IF NOT EXISTS email_variants JSONB DEFAULT NULL;

NOTIFY pgrst, 'reload schema';
