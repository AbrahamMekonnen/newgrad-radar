-- =============================================
-- Auto-Apply Job Queue
-- Migration: 025_autoapply_job_queue.sql
--
-- PostgreSQL-backed job queue for auto-apply system
-- Replaces localStorage-based queue with persistent,
-- scalable database queue with atomic job claiming
-- =============================================

-- =============================================
-- Priority Levels
-- =============================================
-- 1 = urgent  (user-initiated "Apply Now")
-- 2 = high    (jobs expiring soon)
-- 3 = normal  (regular auto-apply)
-- 4 = low     (bulk/batch applications)
-- 5 = background (retry attempts)

-- =============================================
-- Job Queue Table
-- =============================================
CREATE TABLE autoapply_job_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- User and job references
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  job_title TEXT NOT NULL,
  company_slug TEXT NOT NULL,
  company_name TEXT NOT NULL,
  job_url TEXT NOT NULL,

  -- ATS information
  ats_type TEXT NOT NULL CHECK (ats_type IN (
    'greenhouse', 'lever', 'ashby', 'workday', 'jobvite', 'icims', 'unknown'
  )),

  -- Queue configuration
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- Waiting to be processed
    'processing',  -- Currently being worked on
    'completed',   -- Successfully applied
    'failed',      -- Exhausted all retries
    'cancelled',   -- User cancelled
    'expired'      -- Job posting expired/closed
  )),

  -- Retry logic
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  error_type TEXT CHECK (error_type IS NULL OR error_type IN (
    'network', 'timeout', 'rate_limit', 'server_error',
    'validation', 'auth', 'ats_error', 'captcha', 'permanent', 'unknown'
  )),

  -- Scheduling
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,  -- For preventing duplicate processing

  -- Application data
  resume_id UUID,  -- Reference to user's selected resume
  cover_letter TEXT,
  answers JSONB DEFAULT '{}'::jsonb,  -- Pre-filled form answers

  -- Results
  confirmation_id TEXT,
  applied_at TIMESTAMPTZ,
  result JSONB,  -- Additional result metadata

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Prevent duplicate pending applications
  CONSTRAINT unique_pending_application
    UNIQUE NULLS NOT DISTINCT (user_id, job_id)
    WHERE status IN ('pending', 'processing')
);

-- =============================================
-- Indexes for Efficient Queue Processing
-- =============================================

-- Primary queue processing index
-- Used by claim_next_job to find pending jobs ordered by priority and schedule
CREATE INDEX idx_autoapply_queue_pending
  ON autoapply_job_queue(priority, scheduled_at)
  WHERE status = 'pending';

-- User's queue view
CREATE INDEX idx_autoapply_queue_user
  ON autoapply_job_queue(user_id, status, created_at DESC);

-- Find jobs by status for monitoring
CREATE INDEX idx_autoapply_queue_status
  ON autoapply_job_queue(status, updated_at DESC);

-- Locked jobs cleanup (for stale processing jobs)
CREATE INDEX idx_autoapply_queue_locked
  ON autoapply_job_queue(locked_until)
  WHERE status = 'processing' AND locked_until IS NOT NULL;

-- Job lookup
CREATE INDEX idx_autoapply_queue_job
  ON autoapply_job_queue(job_id, user_id);

-- =============================================
-- Update Trigger
-- =============================================
CREATE TRIGGER autoapply_queue_updated_at
  BEFORE UPDATE ON autoapply_job_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Atomic Job Claiming Function
-- Uses FOR UPDATE SKIP LOCKED for safe concurrency
-- =============================================
CREATE OR REPLACE FUNCTION claim_autoapply_job(
  p_worker_id TEXT DEFAULT NULL,
  p_lock_duration INTERVAL DEFAULT '5 minutes'
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  job_id TEXT,
  job_title TEXT,
  company_slug TEXT,
  company_name TEXT,
  job_url TEXT,
  ats_type TEXT,
  priority INTEGER,
  attempts INTEGER,
  max_attempts INTEGER,
  resume_id UUID,
  cover_letter TEXT,
  answers JSONB,
  created_at TIMESTAMPTZ
) AS $$
DECLARE
  claimed_id UUID;
BEGIN
  -- First, release any stale locks (jobs that were processing but never completed)
  UPDATE autoapply_job_queue
  SET status = 'pending',
      locked_until = NULL,
      updated_at = NOW()
  WHERE status = 'processing'
    AND locked_until < NOW();

  -- Atomically claim the next pending job
  UPDATE autoapply_job_queue aq
  SET status = 'processing',
      attempts = aq.attempts + 1,
      locked_until = NOW() + p_lock_duration,
      updated_at = NOW()
  WHERE aq.id = (
    SELECT id FROM autoapply_job_queue
    WHERE status = 'pending'
      AND scheduled_at <= NOW()
    ORDER BY priority, scheduled_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING aq.id INTO claimed_id;

  -- Return the claimed job details
  IF claimed_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      aq.id,
      aq.user_id,
      aq.job_id,
      aq.job_title,
      aq.company_slug,
      aq.company_name,
      aq.job_url,
      aq.ats_type,
      aq.priority,
      aq.attempts,
      aq.max_attempts,
      aq.resume_id,
      aq.cover_letter,
      aq.answers,
      aq.created_at
    FROM autoapply_job_queue aq
    WHERE aq.id = claimed_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Complete Job Function
-- =============================================
CREATE OR REPLACE FUNCTION complete_autoapply_job(
  p_queue_id UUID,
  p_confirmation_id TEXT DEFAULT NULL,
  p_result JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE autoapply_job_queue
  SET status = 'completed',
      confirmation_id = p_confirmation_id,
      result = p_result,
      applied_at = NOW(),
      completed_at = NOW(),
      locked_until = NULL,
      updated_at = NOW()
  WHERE id = p_queue_id
    AND status = 'processing';
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Fail Job Function (with retry logic)
-- =============================================
CREATE OR REPLACE FUNCTION fail_autoapply_job(
  p_queue_id UUID,
  p_error_message TEXT,
  p_error_type TEXT DEFAULT 'unknown'
)
RETURNS TABLE (
  should_retry BOOLEAN,
  next_retry_at TIMESTAMPTZ
) AS $$
DECLARE
  v_attempts INTEGER;
  v_max_attempts INTEGER;
  v_retry_delay INTERVAL;
  v_should_retry BOOLEAN := FALSE;
  v_next_retry TIMESTAMPTZ;
BEGIN
  -- Get current attempt count
  SELECT attempts, max_attempts
  INTO v_attempts, v_max_attempts
  FROM autoapply_job_queue
  WHERE id = p_queue_id;

  -- Check if we should retry
  IF v_attempts < v_max_attempts AND p_error_type NOT IN ('permanent', 'validation', 'captcha') THEN
    v_should_retry := TRUE;

    -- Calculate exponential backoff
    -- Base: 60s, doubles each attempt, max 30 minutes
    v_retry_delay := LEAST(
      (60 * POWER(2, v_attempts - 1)) * INTERVAL '1 second',
      INTERVAL '30 minutes'
    );
    v_next_retry := NOW() + v_retry_delay;

    -- Move back to pending with scheduled retry
    UPDATE autoapply_job_queue
    SET status = 'pending',
        last_error = p_error_message,
        error_type = p_error_type,
        scheduled_at = v_next_retry,
        locked_until = NULL,
        updated_at = NOW()
    WHERE id = p_queue_id;
  ELSE
    -- Mark as permanently failed
    UPDATE autoapply_job_queue
    SET status = 'failed',
        last_error = p_error_message,
        error_type = p_error_type,
        completed_at = NOW(),
        locked_until = NULL,
        updated_at = NOW()
    WHERE id = p_queue_id;
  END IF;

  RETURN QUERY SELECT v_should_retry, v_next_retry;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Cancel Job Function
-- =============================================
CREATE OR REPLACE FUNCTION cancel_autoapply_job(
  p_queue_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_cancelled BOOLEAN := FALSE;
BEGIN
  UPDATE autoapply_job_queue
  SET status = 'cancelled',
      completed_at = NOW(),
      locked_until = NULL,
      updated_at = NOW()
  WHERE id = p_queue_id
    AND user_id = p_user_id
    AND status IN ('pending', 'processing')
  RETURNING TRUE INTO v_cancelled;

  RETURN COALESCE(v_cancelled, FALSE);
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Get Queue Stats Function
-- =============================================
CREATE OR REPLACE FUNCTION get_autoapply_queue_stats(
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  pending_count BIGINT,
  processing_count BIGINT,
  completed_count BIGINT,
  failed_count BIGINT,
  cancelled_count BIGINT,
  total_count BIGINT,
  avg_wait_time_seconds NUMERIC,
  success_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'processing'),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COUNT(*),
    AVG(
      CASE WHEN status IN ('completed', 'failed') AND completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (completed_at - created_at))
      END
    )::NUMERIC,
    CASE
      WHEN COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) = 0 THEN 0
      ELSE (COUNT(*) FILTER (WHERE status = 'completed')::NUMERIC /
            COUNT(*) FILTER (WHERE status IN ('completed', 'failed'))::NUMERIC * 100)
    END
  FROM autoapply_job_queue
  WHERE p_user_id IS NULL OR user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Get User's Queue Function
-- =============================================
CREATE OR REPLACE FUNCTION get_user_autoapply_queue(
  p_user_id UUID,
  p_status TEXT[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  job_id TEXT,
  job_title TEXT,
  company_slug TEXT,
  company_name TEXT,
  job_url TEXT,
  ats_type TEXT,
  priority INTEGER,
  status TEXT,
  attempts INTEGER,
  max_attempts INTEGER,
  last_error TEXT,
  error_type TEXT,
  scheduled_at TIMESTAMPTZ,
  confirmation_id TEXT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    aq.id,
    aq.job_id,
    aq.job_title,
    aq.company_slug,
    aq.company_name,
    aq.job_url,
    aq.ats_type,
    aq.priority,
    aq.status,
    aq.attempts,
    aq.max_attempts,
    aq.last_error,
    aq.error_type,
    aq.scheduled_at,
    aq.confirmation_id,
    aq.applied_at,
    aq.created_at,
    aq.updated_at
  FROM autoapply_job_queue aq
  WHERE aq.user_id = p_user_id
    AND (p_status IS NULL OR aq.status = ANY(p_status))
  ORDER BY
    CASE aq.status
      WHEN 'processing' THEN 1
      WHEN 'pending' THEN 2
      WHEN 'completed' THEN 3
      WHEN 'failed' THEN 4
      WHEN 'cancelled' THEN 5
      ELSE 6
    END,
    aq.priority,
    aq.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Cleanup Old Jobs Function
-- =============================================
CREATE OR REPLACE FUNCTION cleanup_autoapply_queue(
  p_completed_older_than INTERVAL DEFAULT '30 days',
  p_failed_older_than INTERVAL DEFAULT '7 days'
)
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM autoapply_job_queue
  WHERE (status = 'completed' AND completed_at < NOW() - p_completed_older_than)
     OR (status IN ('failed', 'cancelled') AND completed_at < NOW() - p_failed_older_than);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Row Level Security
-- =============================================
ALTER TABLE autoapply_job_queue ENABLE ROW LEVEL SECURITY;

-- Users can view their own queue items
CREATE POLICY "Users can view own queue items"
  ON autoapply_job_queue
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own queue items
CREATE POLICY "Users can insert own queue items"
  ON autoapply_job_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending/cancelled items
CREATE POLICY "Users can update own queue items"
  ON autoapply_job_queue
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own cancelled/failed items
CREATE POLICY "Users can delete own cancelled items"
  ON autoapply_job_queue
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND status IN ('cancelled', 'failed'));

-- =============================================
-- Dead Letter Queue for Failed Applications
-- =============================================
CREATE TABLE autoapply_dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_queue_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  job_url TEXT NOT NULL,
  ats_type TEXT NOT NULL,

  -- Failure information
  final_error TEXT,
  error_type TEXT,
  total_attempts INTEGER NOT NULL,
  error_history JSONB DEFAULT '[]'::jsonb,

  -- Original data for manual retry
  resume_id UUID,
  cover_letter TEXT,
  answers JSONB,

  -- Timestamps
  original_created_at TIMESTAMPTZ NOT NULL,
  failed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Manual intervention tracking
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN (
    'manual_apply', 'job_closed', 'permanent_error', 'requeued', 'ignored'
  )),
  notes TEXT
);

CREATE INDEX idx_dlq_user ON autoapply_dead_letter_queue(user_id, failed_at DESC);
CREATE INDEX idx_dlq_unreviewed ON autoapply_dead_letter_queue(reviewed, failed_at DESC)
  WHERE reviewed = FALSE;

-- RLS for DLQ
ALTER TABLE autoapply_dead_letter_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own DLQ items"
  ON autoapply_dead_letter_queue
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- =============================================
-- Move to DLQ Function
-- =============================================
CREATE OR REPLACE FUNCTION move_to_autoapply_dlq(
  p_queue_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_dlq_id UUID;
BEGIN
  INSERT INTO autoapply_dead_letter_queue (
    original_queue_id,
    user_id,
    job_id,
    job_title,
    company_name,
    job_url,
    ats_type,
    final_error,
    error_type,
    total_attempts,
    resume_id,
    cover_letter,
    answers,
    original_created_at
  )
  SELECT
    id,
    user_id,
    job_id,
    job_title,
    company_name,
    job_url,
    ats_type,
    last_error,
    error_type,
    attempts,
    resume_id,
    cover_letter,
    answers,
    created_at
  FROM autoapply_job_queue
  WHERE id = p_queue_id
  RETURNING id INTO v_dlq_id;

  RETURN v_dlq_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Comments
-- =============================================
COMMENT ON TABLE autoapply_job_queue IS 'Persistent job queue for auto-apply system with atomic claiming';
COMMENT ON TABLE autoapply_dead_letter_queue IS 'Failed applications requiring manual intervention';
COMMENT ON FUNCTION claim_autoapply_job IS 'Atomically claims the next pending job using FOR UPDATE SKIP LOCKED';
COMMENT ON FUNCTION fail_autoapply_job IS 'Handles job failure with exponential backoff retry logic';
COMMENT ON FUNCTION complete_autoapply_job IS 'Marks a job as successfully completed';
