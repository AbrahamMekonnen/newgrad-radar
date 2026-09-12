-- ============================================
-- Migration: Application Tracking Enhancement
-- Adds detailed field tracking and failure patterns
-- for auto-apply learning and optimization
-- ============================================

-- Add detailed tracking columns to application_logs
ALTER TABLE application_logs
ADD COLUMN IF NOT EXISTS fields_filled JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS fields_failed JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS fields_missing TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS custom_questions JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
ADD COLUMN IF NOT EXISTS error_category TEXT,
ADD COLUMN IF NOT EXISTS application_url TEXT,
ADD COLUMN IF NOT EXISTS automation_method TEXT,
ADD COLUMN IF NOT EXISTS screenshot_url TEXT;

-- Comments for clarity
COMMENT ON COLUMN application_logs.fields_filled IS 'Array of {field, selector, found, filled, duration_ms} for successful fills';
COMMENT ON COLUMN application_logs.fields_failed IS 'Array of {field, selector, found, filled, error} for failed fills';
COMMENT ON COLUMN application_logs.fields_missing IS 'Array of field names that were not found on the page';
COMMENT ON COLUMN application_logs.custom_questions IS 'Array of {question, field_type, options, answer, from_profile, ai_generated}';
COMMENT ON COLUMN application_logs.duration_ms IS 'Total duration of the application attempt in milliseconds';
COMMENT ON COLUMN application_logs.error_category IS 'Categorized error type: network_error, captcha_blocked, login_required, etc.';
COMMENT ON COLUMN application_logs.automation_method IS 'How the application was filled: extension, puppeteer, playwright, manual';

-- ============================================
-- TABLE: ats_field_stats
-- Track which selectors work best per ATS/field
-- ============================================
CREATE TABLE IF NOT EXISTS ats_field_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ats_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  best_selector TEXT NOT NULL,
  success_rate DECIMAL(5,2) DEFAULT 0,
  total_attempts INTEGER DEFAULT 0,
  alternatives JSONB DEFAULT '[]',  -- Array of {selector, success_rate, attempts}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ats_type, field_name)
);

CREATE INDEX IF NOT EXISTS idx_ats_field_stats_type ON ats_field_stats(ats_type);
CREATE INDEX IF NOT EXISTS idx_ats_field_stats_success ON ats_field_stats(ats_type, success_rate DESC);

COMMENT ON TABLE ats_field_stats IS 'Aggregated stats on selector success rates per ATS type and field';

-- ============================================
-- TABLE: failure_patterns
-- Track common failure patterns for learning
-- ============================================
CREATE TABLE IF NOT EXISTS failure_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ats_type TEXT NOT NULL,
  error_category TEXT NOT NULL,
  error_pattern TEXT NOT NULL,  -- First 200 chars of error message
  frequency INTEGER DEFAULT 1,
  suggested_fix TEXT,
  known_issue BOOLEAN DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ats_type, error_category, error_pattern)
);

CREATE INDEX IF NOT EXISTS idx_failure_patterns_type ON failure_patterns(ats_type);
CREATE INDEX IF NOT EXISTS idx_failure_patterns_freq ON failure_patterns(ats_type, frequency DESC);

COMMENT ON TABLE failure_patterns IS 'Aggregated failure patterns for identifying common issues';

-- ============================================
-- TABLE: ats_success_rates
-- Overall success rate per ATS type
-- ============================================
CREATE TABLE IF NOT EXISTS ats_success_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ats_type TEXT UNIQUE NOT NULL,
  total_attempts INTEGER DEFAULT 0,
  successful_attempts INTEGER DEFAULT 0,
  success_rate DECIMAL(5,2) DEFAULT 0,
  avg_duration_ms INTEGER,
  last_attempt_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ats_success_rates_type ON ats_success_rates(ats_type);

COMMENT ON TABLE ats_success_rates IS 'Overall success rates by ATS type for prioritization';

-- ============================================
-- FUNCTION: Update ATS stats on new application log
-- ============================================
CREATE OR REPLACE FUNCTION update_ats_stats()
RETURNS TRIGGER AS $$
DECLARE
  current_rate DECIMAL(5,2);
  current_total INTEGER;
  current_success INTEGER;
BEGIN
  -- Update ats_success_rates
  SELECT total_attempts, successful_attempts, success_rate
  INTO current_total, current_success, current_rate
  FROM ats_success_rates
  WHERE ats_type = NEW.ats_type;

  IF NOT FOUND THEN
    INSERT INTO ats_success_rates (ats_type, total_attempts, successful_attempts, success_rate, avg_duration_ms, last_attempt_at)
    VALUES (
      NEW.ats_type,
      1,
      CASE WHEN NEW.status = 'submitted' THEN 1 ELSE 0 END,
      CASE WHEN NEW.status = 'submitted' THEN 100.00 ELSE 0.00 END,
      NEW.duration_ms,
      NOW()
    );
  ELSE
    UPDATE ats_success_rates
    SET
      total_attempts = total_attempts + 1,
      successful_attempts = successful_attempts + CASE WHEN NEW.status = 'submitted' THEN 1 ELSE 0 END,
      success_rate = (successful_attempts + CASE WHEN NEW.status = 'submitted' THEN 1 ELSE 0 END)::DECIMAL / (total_attempts + 1) * 100,
      avg_duration_ms = COALESCE((avg_duration_ms * total_attempts + COALESCE(NEW.duration_ms, 0)) / (total_attempts + 1), NEW.duration_ms),
      last_attempt_at = NOW(),
      updated_at = NOW()
    WHERE ats_type = NEW.ats_type;
  END IF;

  -- Track failure patterns if failed
  IF NEW.status = 'failed' AND NEW.error_category IS NOT NULL THEN
    INSERT INTO failure_patterns (ats_type, error_category, error_pattern, frequency)
    VALUES (
      NEW.ats_type,
      NEW.error_category,
      COALESCE(LEFT(NEW.error_message, 200), 'Unknown error'),
      1
    )
    ON CONFLICT (ats_type, error_category, error_pattern)
    DO UPDATE SET
      frequency = failure_patterns.frequency + 1,
      last_seen_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop first if exists to allow re-running migration)
DROP TRIGGER IF EXISTS trigger_update_ats_stats ON application_logs;
CREATE TRIGGER trigger_update_ats_stats
  AFTER INSERT ON application_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_ats_stats();

-- ============================================
-- FUNCTION: Update field stats periodically
-- This should be called by a scheduled job
-- ============================================
CREATE OR REPLACE FUNCTION refresh_field_stats()
RETURNS void AS $$
DECLARE
  r RECORD;
  field_rec RECORD;
  stats_rec RECORD;
BEGIN
  -- Process recent successful application logs (last 30 days)
  FOR r IN
    SELECT
      ats_type,
      jsonb_array_elements(fields_filled) AS field_data
    FROM application_logs
    WHERE status = 'submitted'
      AND fields_filled IS NOT NULL
      AND created_at > NOW() - INTERVAL '30 days'
  LOOP
    -- Extract field name and selector
    INSERT INTO ats_field_stats (ats_type, field_name, best_selector, success_rate, total_attempts)
    VALUES (
      r.ats_type,
      r.field_data->>'field',
      r.field_data->>'selector',
      100.00,
      1
    )
    ON CONFLICT (ats_type, field_name)
    DO UPDATE SET
      total_attempts = ats_field_stats.total_attempts + 1,
      -- Keep track of best performing selector
      best_selector = CASE
        WHEN (SELECT success_rate FROM ats_field_stats WHERE ats_type = r.ats_type AND field_name = r.field_data->>'field') < 100
        THEN r.field_data->>'selector'
        ELSE ats_field_stats.best_selector
      END,
      updated_at = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: Application tracking summary
-- ============================================
CREATE OR REPLACE VIEW application_tracking_summary AS
SELECT
  al.ats_type,
  COUNT(*) AS total_attempts,
  SUM(CASE WHEN al.status = 'submitted' THEN 1 ELSE 0 END) AS successful,
  SUM(CASE WHEN al.status = 'failed' THEN 1 ELSE 0 END) AS failed,
  ROUND(SUM(CASE WHEN al.status = 'submitted' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) * 100, 2) AS success_rate,
  AVG(al.duration_ms)::INTEGER AS avg_duration_ms,
  MODE() WITHIN GROUP (ORDER BY al.error_category) AS most_common_error,
  MAX(al.created_at) AS last_attempt
FROM application_logs al
WHERE al.created_at > NOW() - INTERVAL '30 days'
GROUP BY al.ats_type
ORDER BY success_rate DESC;

-- ============================================
-- No RLS on aggregate tables (public stats)
-- ============================================

-- ============================================
-- DONE
-- ============================================
