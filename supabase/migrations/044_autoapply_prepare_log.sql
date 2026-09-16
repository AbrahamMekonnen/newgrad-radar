-- Per-row failure telemetry for the prepare pipeline. Every queued job records
-- WHY it ended where it did (prepared / form_unavailable / form_fetch_failed /
-- unsupported / error + the exception text), so at scale we can query the real
-- failure distribution instead of guessing. One job's failure never affects
-- another — the worker isolates each and always writes an outcome here.
ALTER TABLE autoapply_job_queue
  ADD COLUMN IF NOT EXISTS prepare_log JSONB;  -- {status, reason, ats, at}

COMMENT ON COLUMN autoapply_job_queue.prepare_log IS
  'Outcome of the last prepare attempt: {status, reason, ats, at}. Telemetry.';

-- Handy view of the current failure breakdown across all users.
CREATE OR REPLACE VIEW autoapply_status_breakdown AS
  SELECT status, count(*) AS n
    FROM autoapply_job_queue
   GROUP BY status
   ORDER BY n DESC;

NOTIFY pgrst, 'reload schema';
