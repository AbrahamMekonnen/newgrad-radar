-- Sync saved_jobs status changes to application_logs for live stats updates
-- When a user updates their saved_job status, this trigger creates/updates application_logs

-- Status mapping:
-- saved_jobs.status    -> application_logs.status
-- 'saved'              -> (no entry, just bookmarked)
-- 'applied'            -> 'submitted'
-- 'in_review'          -> 'in_review'
-- 'interviewing'       -> 'interview_scheduled'
-- 'rejected'           -> 'rejected'
-- 'offer'              -> 'offer'

-- Create function to sync saved_jobs to application_logs
CREATE OR REPLACE FUNCTION sync_saved_job_to_application_log()
RETURNS TRIGGER AS $$
DECLARE
  mapped_status TEXT;
BEGIN
  -- Map saved_jobs status to application_logs status
  CASE NEW.status
    WHEN 'applied' THEN mapped_status := 'submitted';
    WHEN 'in_review' THEN mapped_status := 'in_review';
    WHEN 'interviewing' THEN mapped_status := 'interview_scheduled';
    WHEN 'rejected' THEN mapped_status := 'rejected';
    WHEN 'offer' THEN mapped_status := 'offer';
    ELSE mapped_status := NULL; -- 'saved' status doesn't create an application log
  END CASE;

  -- If status is 'saved', delete any existing application_log (user un-applied)
  IF NEW.status = 'saved' THEN
    DELETE FROM application_logs
    WHERE user_id = NEW.user_id AND job_id = NEW.job_id;
    RETURN NEW;
  END IF;

  -- Skip if no mapping (shouldn't happen with current statuses)
  IF mapped_status IS NULL THEN
    RETURN NEW;
  END IF;

  -- Upsert into application_logs
  INSERT INTO application_logs (
    user_id,
    job_id,
    status,
    submitted_at,
    created_at
  )
  VALUES (
    NEW.user_id,
    NEW.job_id,
    mapped_status,
    COALESCE(NEW.applied_at, NOW()),
    COALESCE(NEW.created_at, NOW())
  )
  ON CONFLICT (user_id, job_id) DO UPDATE SET
    status = EXCLUDED.status,
    submitted_at = COALESCE(EXCLUDED.submitted_at, application_logs.submitted_at);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on saved_jobs
DROP TRIGGER IF EXISTS trigger_sync_saved_job ON saved_jobs;

CREATE TRIGGER trigger_sync_saved_job
  AFTER INSERT OR UPDATE OF status ON saved_jobs
  FOR EACH ROW
  EXECUTE FUNCTION sync_saved_job_to_application_log();

-- Also handle deletes - remove from application_logs when saved_job is deleted
CREATE OR REPLACE FUNCTION delete_application_log_on_unsave()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM application_logs
  WHERE user_id = OLD.user_id AND job_id = OLD.job_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_delete_application_log ON saved_jobs;

CREATE TRIGGER trigger_delete_application_log
  AFTER DELETE ON saved_jobs
  FOR EACH ROW
  EXECUTE FUNCTION delete_application_log_on_unsave();

-- Backfill: sync existing saved_jobs that aren't 'saved' status
INSERT INTO application_logs (user_id, job_id, status, submitted_at, created_at)
SELECT
  sj.user_id,
  sj.job_id,
  CASE sj.status
    WHEN 'applied' THEN 'submitted'
    WHEN 'in_review' THEN 'in_review'
    WHEN 'interviewing' THEN 'interview_scheduled'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'offer' THEN 'offer'
  END,
  COALESCE(sj.applied_at, sj.created_at),
  sj.created_at
FROM saved_jobs sj
WHERE sj.status != 'saved'
ON CONFLICT (user_id, job_id) DO UPDATE SET
  status = EXCLUDED.status;
