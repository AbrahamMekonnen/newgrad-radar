-- A queue claim is an attempt, not a submission. Only stamp submitted_at after
-- the ATS confirms success (or after the user explicitly confirms a manual
-- browser submission).

CREATE OR REPLACE FUNCTION claim_autoapply_submit(p_limit INT)
RETURNS SETOF autoapply_job_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE autoapply_job_queue q
     SET status = 'submitting',
         submitted_at = NULL,
         updated_at = now()
   WHERE q.id IN (
     SELECT id
       FROM autoapply_job_queue
      WHERE status = 'submit_requested'
      ORDER BY priority, created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END;
$$;

CREATE OR REPLACE FUNCTION requeue_stale_submit(p_minutes INT DEFAULT 15)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  reset_count INT;
BEGIN
  UPDATE autoapply_job_queue
     SET status = 'prepared',
         submitted_at = NULL,
         submit_log = jsonb_build_object(
           'status', 'submit_failed',
           'detail', 'Submission worker timed out before ATS confirmation.',
           'at', now()
         ),
         updated_at = now()
   WHERE status = 'submitting'
     AND updated_at < now() - (p_minutes || ' minutes')::interval;

  GET DIAGNOSTICS reset_count = ROW_COUNT;
  RETURN reset_count;
END;
$$;

-- Repair timestamps written by the old claim function. Keep timestamps for
-- ATS-confirmed submissions and explicit user-confirmed manual submissions.
UPDATE autoapply_job_queue
   SET submitted_at = NULL
 WHERE submitted_at IS NOT NULL
   AND status NOT IN ('submitted', 'applied');

UPDATE application_logs
   SET submitted_at = NULL
 WHERE submitted_at IS NOT NULL
   AND status NOT IN (
     'submitted', 'applied', 'in_review', 'interview_scheduled',
     'interviewing', 'rejected', 'offer'
   );

ALTER TABLE autoapply_job_queue
  DROP CONSTRAINT IF EXISTS autoapply_submitted_at_matches_status;

ALTER TABLE autoapply_job_queue
  ADD CONSTRAINT autoapply_submitted_at_matches_status
  CHECK (submitted_at IS NULL OR status IN ('submitted', 'applied'));
