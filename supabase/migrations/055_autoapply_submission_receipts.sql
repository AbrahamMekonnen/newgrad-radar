-- Durable idempotency for browser-side application submission.
CREATE TABLE IF NOT EXISTS autoapply_submission_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  queue_id UUID REFERENCES autoapply_job_queue(id) ON DELETE SET NULL,
  ats_type TEXT,
  confirmation_source TEXT NOT NULL DEFAULT 'ats_success_page',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);

ALTER TABLE autoapply_submission_receipts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users can view own submission receipts"
    ON autoapply_submission_receipts FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
     SET status = 'waiting_for_browser', browser_device_id = NULL,
         browser_lease_id = NULL, browser_lease_expires_at = NULL,
         browser_stage = 'lease_expired'
   WHERE user_id = p_user_id
     AND status IN ('browser_filling', 'waiting_for_user')
     AND browser_lease_expires_at < now();

  UPDATE autoapply_job_queue candidate
     SET status = 'submitted',
         submitted_at = receipt.submitted_at,
         browser_stage = 'duplicate_prevented',
         submit_log = jsonb_build_object('status', 'already_recorded', 'detail', 'A verified receipt already exists for this job.', 'at', receipt.submitted_at),
         browser_device_id = NULL, browser_lease_id = NULL, browser_lease_expires_at = NULL,
         updated_at = now()
    FROM autoapply_submission_receipts receipt
   WHERE candidate.user_id = p_user_id
     AND candidate.status IN ('submit_requested', 'waiting_for_browser')
     AND receipt.user_id = candidate.user_id AND receipt.job_id = candidate.job_id;

  RETURN QUERY
  UPDATE autoapply_job_queue q
     SET status = 'browser_filling', browser_device_id = p_device_id,
         browser_lease_id = gen_random_uuid(),
         browser_lease_expires_at = now() + make_interval(mins => LEAST(GREATEST(p_lease_minutes, 2), 30)),
         browser_stage = 'claimed', browser_progress = jsonb_build_object('at', now()), updated_at = now()
   WHERE q.id = (
     SELECT candidate.id
       FROM autoapply_job_queue candidate
      WHERE candidate.user_id = p_user_id
        AND candidate.status IN ('submit_requested', 'waiting_for_browser')
        AND candidate.prepared_data IS NOT NULL
        AND candidate.execution_channel = 'user_browser'
        AND candidate.authorization_source IN ('direct_click', 'standing_rule')
        AND NOT EXISTS (
          SELECT 1 FROM autoapply_submission_receipts receipt
           WHERE receipt.user_id = candidate.user_id AND receipt.job_id = candidate.job_id
        )
      ORDER BY candidate.priority, candidate.created_at
      LIMIT 1 FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END;
$$;

CREATE OR REPLACE FUNCTION record_browser_autoapply_submission(
  p_queue_id UUID,
  p_user_id UUID,
  p_device_id UUID,
  p_lease_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q autoapply_job_queue%ROWTYPE;
  recorded_at TIMESTAMPTZ := now();
  inserted_count INT := 0;
BEGIN
  SELECT * INTO q FROM autoapply_job_queue
   WHERE id = p_queue_id AND user_id = p_user_id
     AND browser_device_id = p_device_id AND browser_lease_id = p_lease_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'lease_expired'); END IF;

  INSERT INTO autoapply_submission_receipts(user_id, job_id, queue_id, ats_type, submitted_at)
  VALUES(q.user_id, q.job_id, q.id, q.ats_type, recorded_at)
  ON CONFLICT (user_id, job_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  UPDATE autoapply_job_queue SET
    status = 'submitted', submitted_at = COALESCE(submitted_at, recorded_at),
    browser_stage = 'submitted',
    browser_progress = jsonb_build_object('stage', 'submitted', 'at', recorded_at),
    browser_lease_expires_at = NULL,
    submit_log = jsonb_build_object('status', 'browser_confirmed', 'detail', 'The ATS displayed a verified submission success page.', 'at', recorded_at),
    updated_at = recorded_at
  WHERE id = q.id;

  INSERT INTO saved_jobs(user_id, job_id, status, applied_at, updated_at)
  VALUES(q.user_id, q.job_id, 'applied', recorded_at, recorded_at)
  ON CONFLICT (user_id, job_id) DO UPDATE SET
    status = 'applied', applied_at = COALESCE(saved_jobs.applied_at, EXCLUDED.applied_at), updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('ok', true, 'alreadyRecorded', inserted_count = 0, 'submittedAt', recorded_at);
END;
$$;

REVOKE ALL ON FUNCTION claim_browser_autoapply_job(UUID, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_browser_autoapply_job(UUID, UUID, INT) TO service_role;
REVOKE ALL ON FUNCTION record_browser_autoapply_submission(UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_browser_autoapply_submission(UUID, UUID, UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
