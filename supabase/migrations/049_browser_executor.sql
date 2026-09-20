-- Durable browser-side execution for user-authorized auto-apply jobs.
-- Pairing secrets are stored only as hashes. A browser can claim only rows
-- belonging to its paired user, and a lease prevents duplicate execution.

CREATE TABLE IF NOT EXISTS autoapply_browser_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Browser helper',
  pairing_code_hash TEXT,
  pairing_expires_at TIMESTAMPTZ,
  device_token_hash TEXT,
  paired_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_autoapply_browser_token
  ON autoapply_browser_devices(device_token_hash)
  WHERE device_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_autoapply_browser_user
  ON autoapply_browser_devices(user_id, created_at DESC);

ALTER TABLE autoapply_browser_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own browser devices"
  ON autoapply_browser_devices FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE autoapply_job_queue
  DROP CONSTRAINT IF EXISTS autoapply_job_queue_status_check;
ALTER TABLE autoapply_job_queue
  ADD CONSTRAINT autoapply_job_queue_status_check CHECK (status IN (
    'pending', 'processing', 'prepared', 'submit_requested', 'submitting',
    'waiting_for_browser', 'browser_filling', 'waiting_for_user',
    'submitted', 'applied', 'completed', 'failed', 'error',
    'form_fetch_failed', 'form_unavailable', 'unsupported', 'job_missing',
    'cancelled', 'expired', 'skipped'
  ));

ALTER TABLE autoapply_job_queue
  ADD COLUMN IF NOT EXISTS authorization_source TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS execution_channel TEXT NOT NULL DEFAULT 'user_browser',
  ADD COLUMN IF NOT EXISTS browser_device_id UUID REFERENCES autoapply_browser_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS browser_lease_id UUID,
  ADD COLUMN IF NOT EXISTS browser_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS browser_stage TEXT,
  ADD COLUMN IF NOT EXISTS browser_progress JSONB;

CREATE INDEX IF NOT EXISTS idx_autoapply_browser_claim
  ON autoapply_job_queue(user_id, priority, created_at)
  WHERE status IN ('submit_requested', 'waiting_for_browser');

CREATE OR REPLACE FUNCTION claim_browser_autoapply_job(
  p_user_id UUID,
  p_device_id UUID,
  p_lease_minutes INT DEFAULT 10
)
RETURNS SETOF autoapply_job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE autoapply_job_queue
     SET status = 'waiting_for_browser',
         browser_device_id = NULL,
         browser_lease_id = NULL,
         browser_lease_expires_at = NULL,
         browser_stage = 'lease_expired'
   WHERE user_id = p_user_id
     AND status IN ('browser_filling', 'waiting_for_user')
     AND browser_lease_expires_at < now();

  RETURN QUERY
  UPDATE autoapply_job_queue q
     SET status = 'browser_filling',
         browser_device_id = p_device_id,
         browser_lease_id = uuid_generate_v4(),
         browser_lease_expires_at = now() + make_interval(mins => LEAST(GREATEST(p_lease_minutes, 2), 30)),
         browser_stage = 'claimed',
         browser_progress = jsonb_build_object('at', now()),
         updated_at = now()
   WHERE q.id = (
     SELECT id
       FROM autoapply_job_queue
      WHERE user_id = p_user_id
        AND status IN ('submit_requested', 'waiting_for_browser')
        AND prepared_data IS NOT NULL
        AND execution_channel = 'user_browser'
      ORDER BY priority, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_browser_autoapply_job(UUID, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_browser_autoapply_job(UUID, UUID, INT) TO service_role;

NOTIFY pgrst, 'reload schema';
