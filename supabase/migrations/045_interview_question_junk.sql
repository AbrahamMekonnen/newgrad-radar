-- Reversible quality review for scraped interview-question content.
-- Junk and duplicate are separate states: a bad scrape is not a duplicate.
ALTER TABLE public.interview_questions
  ADD COLUMN IF NOT EXISTS is_junk BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS junk_reason TEXT,
  ADD COLUMN IF NOT EXISTS quality_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quality_filter_version TEXT;

CREATE INDEX IF NOT EXISTS idx_iq_visible_recent
  ON public.interview_questions (interview_date DESC, scraped_at DESC)
  WHERE is_duplicate = FALSE AND is_junk = FALSE;

CREATE INDEX IF NOT EXISTS idx_iq_quality_filter_version
  ON public.interview_questions (quality_filter_version)
  WHERE is_junk = TRUE;

COMMENT ON COLUMN public.interview_questions.is_junk IS
  'Hidden by content-quality review; independent from duplicate detection.';
COMMENT ON COLUMN public.interview_questions.junk_reason IS
  'Machine-readable reason assigned by the quality filter.';
COMMENT ON COLUMN public.interview_questions.quality_filter_version IS
  'Rule version that made the decision, used for targeted rollback.';

NOTIFY pgrst, 'reload schema';
