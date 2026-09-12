-- ============================================
-- NEWGRAD RADAR - USER LISTS NOTIFICATIONS
-- Adds notification settings to user_lists for My List alerts
-- ============================================

-- Add notification columns to user_lists
ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS notify_enabled BOOLEAN DEFAULT true;
ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS notify_mode TEXT DEFAULT 'instant'
  CHECK (notify_mode IN ('instant', 'daily_digest', 'weekly_digest'));

-- Create index for efficient notification queries
CREATE INDEX IF NOT EXISTS idx_user_lists_notify
  ON user_lists(user_id, notify_enabled)
  WHERE notify_enabled = true;

-- ============================================
-- TABLE: user_list_alerts
-- Links user_lists to job_alerts for "My List" notifications
-- ============================================
CREATE TABLE IF NOT EXISTS user_list_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  alert_id UUID REFERENCES job_alerts(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_list_alerts_user ON user_list_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_list_alerts_alert ON user_list_alerts(alert_id);

-- Enable RLS
ALTER TABLE user_list_alerts ENABLE ROW LEVEL SECURITY;

-- Users can manage their own list alerts
CREATE POLICY "Users manage own list alerts" ON user_list_alerts
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- FUNCTION: sync_user_list_alert
-- Syncs user_lists companies to the associated job_alert
-- Called when user_lists changes (add/remove company, toggle notify)
-- ============================================
CREATE OR REPLACE FUNCTION sync_user_list_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_alert_id UUID;
  v_companies TEXT[];
  v_notify_mode TEXT;
BEGIN
  -- Get or create the user's My List alert
  SELECT alert_id INTO v_alert_id
  FROM user_list_alerts
  WHERE user_id = COALESCE(NEW.user_id, OLD.user_id);

  -- If no alert exists, create one
  IF v_alert_id IS NULL THEN
    INSERT INTO job_alerts (user_id, name, delivery_mode, is_active, filters)
    VALUES (
      COALESCE(NEW.user_id, OLD.user_id),
      'My List Alert',
      COALESCE(NEW.notify_mode, 'instant'),
      true,
      '{}'::JSONB
    )
    RETURNING id INTO v_alert_id;

    INSERT INTO user_list_alerts (user_id, alert_id)
    VALUES (COALESCE(NEW.user_id, OLD.user_id), v_alert_id);
  END IF;

  -- Get all companies with notifications enabled for this user
  SELECT ARRAY_AGG(company_slug)
  INTO v_companies
  FROM user_lists
  WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
    AND notify_enabled = true;

  -- Get the most common notify_mode (or default to instant)
  SELECT COALESCE(
    (SELECT notify_mode FROM user_lists
     WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
       AND notify_enabled = true
     GROUP BY notify_mode
     ORDER BY COUNT(*) DESC
     LIMIT 1),
    'instant'
  ) INTO v_notify_mode;

  -- Update the alert with current companies filter
  UPDATE job_alerts
  SET
    filters = CASE
      WHEN v_companies IS NULL OR array_length(v_companies, 1) = 0
      THEN '{}'::JSONB
      ELSE jsonb_build_object('companies', to_jsonb(v_companies))
    END,
    delivery_mode = v_notify_mode,
    is_active = (v_companies IS NOT NULL AND array_length(v_companies, 1) > 0),
    updated_at = NOW()
  WHERE id = v_alert_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to sync alert when user_lists changes
DROP TRIGGER IF EXISTS trigger_sync_user_list_alert ON user_lists;
CREATE TRIGGER trigger_sync_user_list_alert
  AFTER INSERT OR UPDATE OR DELETE ON user_lists
  FOR EACH ROW EXECUTE FUNCTION sync_user_list_alert();

-- ============================================
-- FUNCTION: get_my_list_alert
-- Helper to get or create a user's My List alert
-- ============================================
CREATE OR REPLACE FUNCTION get_my_list_alert(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_alert_id UUID;
BEGIN
  -- Check if alert exists
  SELECT alert_id INTO v_alert_id
  FROM user_list_alerts
  WHERE user_id = p_user_id;

  -- Create if not exists
  IF v_alert_id IS NULL THEN
    INSERT INTO job_alerts (user_id, name, delivery_mode, is_active, filters)
    VALUES (p_user_id, 'My List Alert', 'instant', true, '{}'::JSONB)
    RETURNING id INTO v_alert_id;

    INSERT INTO user_list_alerts (user_id, alert_id)
    VALUES (p_user_id, v_alert_id);
  END IF;

  RETURN v_alert_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: update_my_list_delivery_mode
-- Updates delivery mode for all companies in user's list
-- ============================================
CREATE OR REPLACE FUNCTION update_my_list_delivery_mode(
  p_user_id UUID,
  p_delivery_mode TEXT
)
RETURNS VOID AS $$
DECLARE
  v_alert_id UUID;
BEGIN
  -- Update all user_lists entries
  UPDATE user_lists
  SET notify_mode = p_delivery_mode
  WHERE user_id = p_user_id;

  -- Update the alert delivery mode
  SELECT alert_id INTO v_alert_id
  FROM user_list_alerts
  WHERE user_id = p_user_id;

  IF v_alert_id IS NOT NULL THEN
    UPDATE job_alerts
    SET delivery_mode = p_delivery_mode, updated_at = NOW()
    WHERE id = v_alert_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: toggle_all_my_list_notifications
-- Enables or disables notifications for all companies
-- ============================================
CREATE OR REPLACE FUNCTION toggle_all_my_list_notifications(
  p_user_id UUID,
  p_enabled BOOLEAN
)
RETURNS VOID AS $$
DECLARE
  v_alert_id UUID;
  v_companies TEXT[];
BEGIN
  -- Update all user_lists entries
  UPDATE user_lists
  SET notify_enabled = p_enabled
  WHERE user_id = p_user_id;

  -- Get alert id
  SELECT alert_id INTO v_alert_id
  FROM user_list_alerts
  WHERE user_id = p_user_id;

  IF v_alert_id IS NOT NULL THEN
    IF p_enabled THEN
      -- Get all companies
      SELECT ARRAY_AGG(company_slug) INTO v_companies
      FROM user_lists
      WHERE user_id = p_user_id;

      UPDATE job_alerts
      SET
        is_active = true,
        filters = CASE
          WHEN v_companies IS NULL OR array_length(v_companies, 1) = 0
          THEN '{}'::JSONB
          ELSE jsonb_build_object('companies', to_jsonb(v_companies))
        END,
        updated_at = NOW()
      WHERE id = v_alert_id;
    ELSE
      UPDATE job_alerts
      SET is_active = false, filters = '{}'::JSONB, updated_at = NOW()
      WHERE id = v_alert_id;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DONE
-- ============================================
