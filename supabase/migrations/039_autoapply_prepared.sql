-- Store the fully-prepared application (all resolved + AI-drafted fields) that
-- the new prepare engine produces, so the user can review and one-tap submit.
-- Submission stays human-in-the-loop (final CAPTCHA is cleared in their browser).
ALTER TABLE autoapply_job_queue
  ADD COLUMN IF NOT EXISTS prepared_data JSONB,
  ADD COLUMN IF NOT EXISTS ready_pct INT,
  ADD COLUMN IF NOT EXISTS needs_user JSONB,
  ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ;

COMMENT ON COLUMN autoapply_job_queue.prepared_data IS
  'Prepared application: [{label,name,type,value,source,required}] from prepare.py.';

CREATE INDEX IF NOT EXISTS aaq_status_idx ON autoapply_job_queue (status);

NOTIFY pgrst, 'reload schema';
