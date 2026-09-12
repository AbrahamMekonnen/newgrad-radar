-- =============================================
-- Answer Generation Queue
-- Migration: 024_answer_generation_queue.sql
--
-- Background queue for auto-generating "Why Company"
-- answers when users add companies to their list
-- =============================================

-- =============================================
-- Answer Generation Queue Table
-- =============================================
CREATE TABLE answer_generation_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_slug TEXT NOT NULL,
  company_name TEXT NOT NULL,

  -- Queue status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- Waiting to be processed
    'processing',  -- Currently being generated
    'completed',   -- Successfully generated
    'failed',      -- Generation failed
    'cancelled'    -- User removed company before generation
  )),

  -- Processing metadata
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  error_message TEXT,

  -- Rate limiting
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Result tracking
  answer_id UUID REFERENCES company_answers(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate queue entries
  UNIQUE(user_id, company_slug, status) WHERE status IN ('pending', 'processing')
);

-- Indexes for efficient queue processing
CREATE INDEX idx_answer_queue_pending
  ON answer_generation_queue(scheduled_at)
  WHERE status = 'pending';

CREATE INDEX idx_answer_queue_user
  ON answer_generation_queue(user_id, status);

CREATE INDEX idx_answer_queue_processing
  ON answer_generation_queue(status, last_attempt_at)
  WHERE status = 'processing';

-- Updated_at trigger
CREATE TRIGGER update_answer_queue_updated_at
  BEFORE UPDATE ON answer_generation_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- User Notification Preferences for Answers
-- =============================================
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS notify_answer_ready BOOLEAN DEFAULT true;

COMMENT ON COLUMN user_profiles.notify_answer_ready IS
  'Whether to notify user when Why Company answers are ready';

-- =============================================
-- Answer Ready Notifications Table
-- =============================================
CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Notification type and content
  type TEXT NOT NULL CHECK (type IN (
    'answer_ready',
    'job_alert',
    'application_update',
    'system'
  )),
  title TEXT NOT NULL,
  body TEXT,

  -- Reference to related entity
  reference_type TEXT,
  reference_id TEXT,

  -- Status
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread
  ON user_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX idx_notifications_type
  ON user_notifications(user_id, type, created_at DESC);

-- =============================================
-- Row Level Security
-- =============================================
ALTER TABLE answer_generation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- answer_generation_queue policies
CREATE POLICY "Users can view own queue items"
  ON answer_generation_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queue items"
  ON answer_generation_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own queue items"
  ON answer_generation_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own queue items"
  ON answer_generation_queue FOR DELETE
  USING (auth.uid() = user_id);

-- user_notifications policies
CREATE POLICY "Users can view own notifications"
  ON user_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON user_notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
  ON user_notifications FOR DELETE
  USING (auth.uid() = user_id);

-- System can insert notifications (via service role)
CREATE POLICY "Service can insert notifications"
  ON user_notifications FOR INSERT
  WITH CHECK (true);

-- =============================================
-- Function: Queue answer generation on My List add
-- =============================================
CREATE OR REPLACE FUNCTION queue_answer_generation()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if this is a new insert (not update)
  IF TG_OP = 'INSERT' THEN
    -- Check if answer already exists for this user+company
    IF NOT EXISTS (
      SELECT 1 FROM company_answers
      WHERE user_id = NEW.user_id
      AND company_slug = NEW.company_slug
    ) THEN
      -- Check if already in queue
      IF NOT EXISTS (
        SELECT 1 FROM answer_generation_queue
        WHERE user_id = NEW.user_id
        AND company_slug = NEW.company_slug
        AND status IN ('pending', 'processing')
      ) THEN
        -- Get company name
        INSERT INTO answer_generation_queue (
          user_id,
          company_slug,
          company_name,
          priority,
          scheduled_at
        )
        SELECT
          NEW.user_id,
          NEW.company_slug,
          COALESCE(c.name, NEW.company_slug),
          5, -- Default priority
          NOW() + (RANDOM() * INTERVAL '30 seconds') -- Spread out requests
        FROM companies c
        WHERE c.slug = NEW.company_slug;

        -- If no company found, use slug as name
        IF NOT FOUND THEN
          INSERT INTO answer_generation_queue (
            user_id,
            company_slug,
            company_name,
            priority,
            scheduled_at
          ) VALUES (
            NEW.user_id,
            NEW.company_slug,
            NEW.company_slug,
            5,
            NOW() + (RANDOM() * INTERVAL '30 seconds')
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- Trigger: Auto-queue on user_lists insert
-- =============================================
DROP TRIGGER IF EXISTS trigger_queue_answer_on_list_add ON user_lists;
CREATE TRIGGER trigger_queue_answer_on_list_add
  AFTER INSERT ON user_lists
  FOR EACH ROW
  EXECUTE FUNCTION queue_answer_generation();

-- =============================================
-- Function: Cancel queued generation on remove
-- =============================================
CREATE OR REPLACE FUNCTION cancel_queued_answer_generation()
RETURNS TRIGGER AS $$
BEGIN
  -- Cancel any pending generation for this company
  UPDATE answer_generation_queue
  SET
    status = 'cancelled',
    updated_at = NOW()
  WHERE user_id = OLD.user_id
    AND company_slug = OLD.company_slug
    AND status IN ('pending', 'processing');

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to cancel on user_lists delete
DROP TRIGGER IF EXISTS trigger_cancel_answer_on_list_remove ON user_lists;
CREATE TRIGGER trigger_cancel_answer_on_list_remove
  BEFORE DELETE ON user_lists
  FOR EACH ROW
  EXECUTE FUNCTION cancel_queued_answer_generation();

-- =============================================
-- Function: Get next batch to process
-- =============================================
CREATE OR REPLACE FUNCTION get_answer_generation_batch(
  p_batch_size INTEGER DEFAULT 5,
  p_lock_duration_minutes INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  company_slug TEXT,
  company_name TEXT,
  attempts INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT q.id
    FROM answer_generation_queue q
    WHERE q.status = 'pending'
      AND q.scheduled_at <= NOW()
      AND q.attempts < q.max_attempts
    ORDER BY q.priority ASC, q.scheduled_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE answer_generation_queue q
  SET
    status = 'processing',
    last_attempt_at = NOW(),
    attempts = q.attempts + 1,
    updated_at = NOW()
  FROM batch
  WHERE q.id = batch.id
  RETURNING
    q.id,
    q.user_id,
    q.company_slug,
    q.company_name,
    q.attempts;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Function: Mark generation as completed
-- =============================================
CREATE OR REPLACE FUNCTION complete_answer_generation(
  p_queue_id UUID,
  p_answer_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_company_name TEXT;
BEGIN
  -- Update queue status
  UPDATE answer_generation_queue
  SET
    status = 'completed',
    answer_id = p_answer_id,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_queue_id
  RETURNING user_id, company_name INTO v_user_id, v_company_name;

  -- Create notification if user has it enabled
  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id
    AND notify_answer_ready = true
  ) THEN
    INSERT INTO user_notifications (
      user_id,
      type,
      title,
      body,
      reference_type,
      reference_id,
      metadata
    ) VALUES (
      v_user_id,
      'answer_ready',
      'Why ' || v_company_name || ' answer ready',
      'Your personalized "Why ' || v_company_name || '?" answer is ready to use in your applications.',
      'company_answer',
      p_answer_id::TEXT,
      jsonb_build_object('company_slug', (
        SELECT company_slug FROM answer_generation_queue WHERE id = p_queue_id
      ))
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- Function: Mark generation as failed
-- =============================================
CREATE OR REPLACE FUNCTION fail_answer_generation(
  p_queue_id UUID,
  p_error_message TEXT
)
RETURNS VOID AS $$
DECLARE
  v_attempts INTEGER;
  v_max_attempts INTEGER;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max_attempts
  FROM answer_generation_queue
  WHERE id = p_queue_id;

  IF v_attempts >= v_max_attempts THEN
    -- Max attempts reached, mark as failed
    UPDATE answer_generation_queue
    SET
      status = 'failed',
      error_message = p_error_message,
      updated_at = NOW()
    WHERE id = p_queue_id;
  ELSE
    -- Retry later with exponential backoff
    UPDATE answer_generation_queue
    SET
      status = 'pending',
      error_message = p_error_message,
      scheduled_at = NOW() + (POWER(2, v_attempts) * INTERVAL '1 minute'),
      updated_at = NOW()
    WHERE id = p_queue_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- Comments
-- =============================================
COMMENT ON TABLE answer_generation_queue IS
  'Queue for background generation of Why Company answers';

COMMENT ON TABLE user_notifications IS
  'In-app notifications for users';

COMMENT ON FUNCTION queue_answer_generation() IS
  'Automatically queues answer generation when user adds company to list';

COMMENT ON FUNCTION get_answer_generation_batch(INTEGER, INTEGER) IS
  'Gets and locks a batch of items for processing';
