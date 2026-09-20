-- The secured claim function uses search_path=public. Supabase installs
-- uuid-ossp outside that path, so use PostgreSQL's built-in UUID generator.
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
         browser_lease_id = gen_random_uuid(),
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
