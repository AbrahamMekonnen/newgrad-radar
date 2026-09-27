-- Make the durable ATS receipt the single source of truth for submission state.
CREATE OR REPLACE FUNCTION reconcile_autoapply_submission_receipt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE autoapply_job_queue
     SET status = 'submitted',
         submitted_at = NEW.submitted_at,
         browser_stage = 'submitted',
         browser_progress = jsonb_build_object('stage', 'submitted', 'at', NEW.submitted_at),
         browser_device_id = NULL,
         browser_lease_id = NULL,
         browser_lease_expires_at = NULL,
         handoff_token = NULL,
         handoff_expires_at = NULL,
         submit_log = jsonb_build_object(
           'status', 'browser_confirmed',
           'detail', 'The ATS displayed a verified submission success page.',
           'source', NEW.confirmation_source,
           'at', NEW.submitted_at
         ),
         updated_at = now()
   WHERE id = NEW.queue_id
      OR (user_id = NEW.user_id AND job_id = NEW.job_id
          AND status NOT IN ('submitted', 'applied'));

  INSERT INTO saved_jobs(user_id, job_id, status, applied_at, updated_at)
  VALUES(NEW.user_id, NEW.job_id, 'applied', NEW.submitted_at, now())
  ON CONFLICT (user_id, job_id) DO UPDATE SET
    status = 'applied',
    applied_at = COALESCE(saved_jobs.applied_at, EXCLUDED.applied_at),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_reconcile_autoapply_submission_receipt
  ON autoapply_submission_receipts;
CREATE TRIGGER trigger_reconcile_autoapply_submission_receipt
AFTER INSERT OR UPDATE OF submitted_at ON autoapply_submission_receipts
FOR EACH ROW EXECUTE FUNCTION reconcile_autoapply_submission_receipt();

-- Repair any receipts whose downstream synchronization previously failed.
UPDATE autoapply_submission_receipts SET submitted_at = submitted_at;

NOTIFY pgrst, 'reload schema';
