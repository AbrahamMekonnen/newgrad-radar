-- Server-side direct submission for CAPTCHA-FREE application forms only.
--
-- Greenhouse (modern job-boards host) and Lever both run an invisible
-- reCAPTCHA/hCaptcha on submit that only a real browser clears, so the worker
-- NEVER tries to defeat a captcha. It submits only forms that have no captcha
-- (a small tail: older embedded boards, some non-GH/Lever ATSes) and marks
-- everything else 'needs_captcha' so it stays a one-tap-open in the inbox.

ALTER TABLE autoapply_job_queue
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submit_log JSONB;  -- {mode, http_status, detail, at}

COMMENT ON COLUMN autoapply_job_queue.submit_log IS
  'Audit of the last submit attempt: what was sent + the result. Never a bypass.';

-- Per-user opt-in: only auto-submit (vs. hold for review) when the user turns
-- this on. Submitting a real application to a real company is irreversible.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS auto_apply_autosubmit BOOLEAN DEFAULT FALSE;

-- Atomic claim for the submit worker: flip 'submit_requested' -> 'submitting'
-- for up to p_limit rows so parallel workers never double-submit the same job.
CREATE OR REPLACE FUNCTION claim_autoapply_submit(p_limit INT)
RETURNS SETOF autoapply_job_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE autoapply_job_queue q
     SET status = 'submitting', submitted_at = now()
   WHERE q.id IN (
     SELECT id FROM autoapply_job_queue
      WHERE status = 'submit_requested'
      ORDER BY priority, created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END;
$$;

-- Reaper for the submit lane: a row stuck 'submitting' (crashed worker) goes
-- back to 'prepared' so the user can retry it — never silently to 'submitted'.
CREATE OR REPLACE FUNCTION requeue_stale_submit(p_minutes INT DEFAULT 15)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE n INT;
BEGIN
  UPDATE autoapply_job_queue
     SET status = 'prepared'
   WHERE status = 'submitting'
     AND submitted_at < now() - (p_minutes || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

NOTIFY pgrst, 'reload schema';
