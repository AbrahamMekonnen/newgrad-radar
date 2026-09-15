-- Scalable multi-worker claiming for the auto-apply queue.
--
-- Lets many parallel workers (across users) pull disjoint batches with no
-- double-processing: each call atomically flips up to p_limit 'pending' rows to
-- 'processing' using FOR UPDATE SKIP LOCKED and returns them. Add more workers
-- to serve more users concurrently — they never collide.

CREATE OR REPLACE FUNCTION claim_autoapply_jobs(p_limit INT)
RETURNS SETOF autoapply_job_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE autoapply_job_queue q
     SET status = 'processing', prepared_at = now()
   WHERE q.id IN (
     SELECT id FROM autoapply_job_queue
      WHERE status = 'pending'
      ORDER BY priority, created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END;
$$;

-- Reaper: return rows stuck 'processing' (a crashed worker) to 'pending'.
CREATE OR REPLACE FUNCTION requeue_stale_autoapply(p_minutes INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE n INT;
BEGIN
  UPDATE autoapply_job_queue
     SET status = 'pending'
   WHERE status = 'processing'
     AND prepared_at < now() - (p_minutes || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

NOTIFY pgrst, 'reload schema';
