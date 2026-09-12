-- ============================================
-- NEWGRAD RADAR - SMART JOB ALERTS MIGRATION
-- Run via: supabase db push or Supabase SQL Editor
-- ============================================

-- ============================================
-- TABLE: job_alerts
-- User-configured job alerts with filter criteria
-- ============================================
CREATE TABLE job_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,                         -- "AI Engineer at Top Companies"
  is_active BOOLEAN DEFAULT true,

  -- Delivery settings
  delivery_mode TEXT DEFAULT 'instant' CHECK (delivery_mode IN ('instant', 'daily_digest', 'weekly_digest')),
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT true,

  -- Filter criteria (JSONB for flexibility)
  -- Structure: {
  --   tiers: ["faang", "ai"],
  --   role_types: ["swe", "ml"],
  --   companies: ["anthropic", "openai"],
  --   locations: ["San Francisco", "Remote"],
  --   title_keywords: ["engineer", "developer"],
  --   title_exclude: ["senior", "staff"],
  --   sources: ["greenhouse", "lever"],
  --   h1b_sponsor: true
  -- }
  filters JSONB DEFAULT '{}'::JSONB,

  -- Tracking
  last_triggered_at TIMESTAMPTZ,
  trigger_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_job_alerts_user ON job_alerts(user_id);
CREATE INDEX idx_job_alerts_active ON job_alerts(is_active) WHERE is_active = true;
CREATE INDEX idx_job_alerts_delivery_mode ON job_alerts(delivery_mode);
CREATE INDEX idx_job_alerts_filters ON job_alerts USING GIN(filters);

-- ============================================
-- TABLE: alert_filter_index
-- Denormalized filter index for fast job matching
-- ============================================
CREATE TABLE alert_filter_index (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID REFERENCES job_alerts(id) ON DELETE CASCADE NOT NULL,
  filter_type TEXT NOT NULL,                  -- 'tier', 'role_type', 'company', 'location', 'title_keyword', 'source'
  filter_value TEXT NOT NULL,                 -- The actual filter value (lowercase for matching)
  is_exclude BOOLEAN DEFAULT false,           -- true for exclusion filters (title_exclude)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Composite index for fast lookups during job matching
CREATE INDEX idx_alert_filter_lookup ON alert_filter_index(filter_type, filter_value, is_exclude);
CREATE INDEX idx_alert_filter_alert ON alert_filter_index(alert_id);

-- ============================================
-- TABLE: alert_matches
-- Queue of matched jobs pending delivery
-- ============================================
CREATE TABLE alert_matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID REFERENCES job_alerts(id) ON DELETE CASCADE NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  delivery_status TEXT DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'failed', 'skipped')),
  delivered_at TIMESTAMPTZ,
  delivery_mode TEXT NOT NULL,                -- Snapshot of delivery_mode at match time
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alert_id, job_id)                    -- Prevent duplicate matches
);

-- Index for processing pending deliveries
CREATE INDEX idx_alert_matches_pending ON alert_matches(delivery_status, delivery_mode)
  WHERE delivery_status = 'pending';
CREATE INDEX idx_alert_matches_alert ON alert_matches(alert_id);
CREATE INDEX idx_alert_matches_job ON alert_matches(job_id);
CREATE INDEX idx_alert_matches_created ON alert_matches(created_at DESC);

-- ============================================
-- TABLE: alert_digest_schedule
-- Tracks when digests were last sent to avoid duplicates
-- ============================================
CREATE TABLE alert_digest_schedule (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID REFERENCES job_alerts(id) ON DELETE CASCADE NOT NULL,
  digest_type TEXT NOT NULL CHECK (digest_type IN ('daily', 'weekly')),
  last_sent_at TIMESTAMPTZ,
  next_scheduled_at TIMESTAMPTZ,
  job_count INT DEFAULT 0,                    -- Jobs included in last digest
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alert_id, digest_type)
);

CREATE INDEX idx_alert_digest_next ON alert_digest_schedule(next_scheduled_at)
  WHERE next_scheduled_at IS NOT NULL;
CREATE INDEX idx_alert_digest_alert ON alert_digest_schedule(alert_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE job_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_filter_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_digest_schedule ENABLE ROW LEVEL SECURITY;

-- Users manage their own alerts
CREATE POLICY "Users manage own alerts" ON job_alerts
  FOR ALL USING (auth.uid() = user_id);

-- Users can read their own filter index (through alert ownership)
CREATE POLICY "Users read own filter index" ON alert_filter_index
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM job_alerts
      WHERE job_alerts.id = alert_filter_index.alert_id
      AND job_alerts.user_id = auth.uid()
    )
  );

-- Users can read their own matches
CREATE POLICY "Users read own matches" ON alert_matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM job_alerts
      WHERE job_alerts.id = alert_matches.alert_id
      AND job_alerts.user_id = auth.uid()
    )
  );

-- Users can read their own digest schedule
CREATE POLICY "Users read own digest schedule" ON alert_digest_schedule
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM job_alerts
      WHERE job_alerts.id = alert_digest_schedule.alert_id
      AND job_alerts.user_id = auth.uid()
    )
  );

-- Service role can manage all (for background processing)
CREATE POLICY "Service manages filter index" ON alert_filter_index
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service manages matches" ON alert_matches
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service manages digest schedule" ON alert_digest_schedule
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- FUNCTION: populate_alert_filter_index
-- Auto-populate denormalized index when alerts change
-- ============================================
CREATE OR REPLACE FUNCTION populate_alert_filter_index()
RETURNS TRIGGER AS $$
BEGIN
  -- Clear existing index entries for this alert
  DELETE FROM alert_filter_index WHERE alert_id = NEW.id;

  -- Index tiers
  IF NEW.filters ? 'tiers' AND jsonb_array_length(NEW.filters->'tiers') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'tier', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'tiers') AS value;
  END IF;

  -- Index role_types
  IF NEW.filters ? 'role_types' AND jsonb_array_length(NEW.filters->'role_types') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'role_type', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'role_types') AS value;
  END IF;

  -- Index companies
  IF NEW.filters ? 'companies' AND jsonb_array_length(NEW.filters->'companies') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'company', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'companies') AS value;
  END IF;

  -- Index locations
  IF NEW.filters ? 'locations' AND jsonb_array_length(NEW.filters->'locations') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'location', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'locations') AS value;
  END IF;

  -- Index title_keywords (inclusion)
  IF NEW.filters ? 'title_keywords' AND jsonb_array_length(NEW.filters->'title_keywords') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'title_keyword', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'title_keywords') AS value;
  END IF;

  -- Index title_exclude (exclusion)
  IF NEW.filters ? 'title_exclude' AND jsonb_array_length(NEW.filters->'title_exclude') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'title_keyword', LOWER(value::TEXT), true
    FROM jsonb_array_elements_text(NEW.filters->'title_exclude') AS value;
  END IF;

  -- Index sources
  IF NEW.filters ? 'sources' AND jsonb_array_length(NEW.filters->'sources') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'source', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'sources') AS value;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on INSERT and UPDATE
CREATE TRIGGER trigger_populate_alert_filter_index
  AFTER INSERT OR UPDATE OF filters ON job_alerts
  FOR EACH ROW EXECUTE FUNCTION populate_alert_filter_index();

-- ============================================
-- FUNCTION: match_job_to_alerts
-- Find all alerts that match a given job
-- Returns alert IDs with their delivery modes
-- ============================================
CREATE OR REPLACE FUNCTION match_job_to_alerts(p_job_id TEXT)
RETURNS TABLE (
  alert_id UUID,
  user_id UUID,
  delivery_mode TEXT,
  push_enabled BOOLEAN,
  email_enabled BOOLEAN
) AS $$
DECLARE
  v_job RECORD;
BEGIN
  -- Get job details
  SELECT j.* INTO v_job FROM jobs j WHERE j.id = p_job_id;

  IF v_job IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    ja.id AS alert_id,
    ja.user_id,
    ja.delivery_mode,
    ja.push_enabled,
    ja.email_enabled
  FROM job_alerts ja
  WHERE ja.is_active = true
  AND (
    -- No filters means match all
    ja.filters = '{}'::JSONB
    OR (
      -- Tier filter: job tier must be in alert's tiers (or no tier filter)
      (
        NOT ja.filters ? 'tiers'
        OR jsonb_array_length(ja.filters->'tiers') = 0
        OR ja.filters->'tiers' @> to_jsonb(v_job.tier)
      )
      -- Role type filter: job must have at least one matching role type (or no role_types filter)
      AND (
        NOT ja.filters ? 'role_types'
        OR jsonb_array_length(ja.filters->'role_types') = 0
        OR EXISTS (
          SELECT 1 FROM unnest(v_job.role_types) AS jrt
          WHERE ja.filters->'role_types' @> to_jsonb(jrt)
        )
      )
      -- Company filter: job company must be in alert's companies (or no company filter)
      AND (
        NOT ja.filters ? 'companies'
        OR jsonb_array_length(ja.filters->'companies') = 0
        OR ja.filters->'companies' @> to_jsonb(v_job.company_slug)
      )
      -- Location filter: job location contains one of the filter locations (case-insensitive)
      AND (
        NOT ja.filters ? 'locations'
        OR jsonb_array_length(ja.filters->'locations') = 0
        OR v_job.location IS NULL
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(ja.filters->'locations') AS loc
          WHERE LOWER(v_job.location) LIKE '%' || LOWER(loc) || '%'
        )
      )
      -- Title keywords: job title contains at least one keyword (if specified)
      AND (
        NOT ja.filters ? 'title_keywords'
        OR jsonb_array_length(ja.filters->'title_keywords') = 0
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(ja.filters->'title_keywords') AS kw
          WHERE LOWER(v_job.title) LIKE '%' || LOWER(kw) || '%'
        )
      )
      -- Title exclude: job title must NOT contain any excluded keywords
      AND (
        NOT ja.filters ? 'title_exclude'
        OR jsonb_array_length(ja.filters->'title_exclude') = 0
        OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(ja.filters->'title_exclude') AS ex
          WHERE LOWER(v_job.title) LIKE '%' || LOWER(ex) || '%'
        )
      )
      -- Source filter: job source must be in alert's sources (or no source filter)
      AND (
        NOT ja.filters ? 'sources'
        OR jsonb_array_length(ja.filters->'sources') = 0
        OR ja.filters->'sources' @> to_jsonb(v_job.source)
      )
      -- H1B sponsor filter: only if job has h1b_sponsor field and alert requires it
      AND (
        NOT ja.filters ? 'h1b_sponsor'
        OR (ja.filters->>'h1b_sponsor')::BOOLEAN = false
        OR (v_job.h1b_sponsor IS NOT NULL AND v_job.h1b_sponsor = true)
      )
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: process_new_job_alerts
-- Trigger function to queue matches when new jobs are inserted
-- ============================================
CREATE OR REPLACE FUNCTION process_new_job_alerts()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert matches into queue for all matching alerts
  INSERT INTO alert_matches (alert_id, job_id, delivery_mode)
  SELECT
    m.alert_id,
    NEW.id,
    m.delivery_mode
  FROM match_job_to_alerts(NEW.id) AS m
  ON CONFLICT (alert_id, job_id) DO NOTHING;

  -- Update trigger counts and timestamps for matched alerts
  UPDATE job_alerts
  SET
    trigger_count = trigger_count + 1,
    last_triggered_at = NOW(),
    updated_at = NOW()
  WHERE id IN (
    SELECT alert_id FROM match_job_to_alerts(NEW.id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on new job insertion
CREATE TRIGGER trigger_process_new_job_alerts
  AFTER INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION process_new_job_alerts();

-- ============================================
-- HELPER FUNCTION: Get pending alerts for delivery
-- Used by background job to process instant alerts
-- ============================================
CREATE OR REPLACE FUNCTION get_pending_instant_alerts(p_limit INT DEFAULT 100)
RETURNS TABLE (
  match_id UUID,
  alert_id UUID,
  job_id TEXT,
  user_id UUID,
  alert_name TEXT,
  push_enabled BOOLEAN,
  email_enabled BOOLEAN,
  job_title TEXT,
  job_company TEXT,
  job_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    am.id AS match_id,
    am.alert_id,
    am.job_id,
    ja.user_id,
    ja.name AS alert_name,
    ja.push_enabled,
    ja.email_enabled,
    j.title AS job_title,
    j.company_name AS job_company,
    j.url AS job_url
  FROM alert_matches am
  JOIN job_alerts ja ON ja.id = am.alert_id
  JOIN jobs j ON j.id = am.job_id
  WHERE am.delivery_status = 'pending'
    AND am.delivery_mode = 'instant'
    AND ja.is_active = true
  ORDER BY am.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- HELPER FUNCTION: Mark alerts as delivered
-- ============================================
CREATE OR REPLACE FUNCTION mark_alerts_delivered(p_match_ids UUID[])
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE alert_matches
  SET
    delivery_status = 'delivered',
    delivered_at = NOW()
  WHERE id = ANY(p_match_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- HELPER FUNCTION: Get digest summary
-- Returns aggregated job matches for digest emails
-- ============================================
CREATE OR REPLACE FUNCTION get_digest_summary(
  p_digest_type TEXT,   -- 'daily' or 'weekly'
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  user_id UUID,
  alert_id UUID,
  alert_name TEXT,
  push_enabled BOOLEAN,
  email_enabled BOOLEAN,
  job_count BIGINT,
  job_ids TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ja.user_id,
    ja.id AS alert_id,
    ja.name AS alert_name,
    ja.push_enabled,
    ja.email_enabled,
    COUNT(am.job_id) AS job_count,
    ARRAY_AGG(am.job_id) AS job_ids
  FROM job_alerts ja
  JOIN alert_matches am ON am.alert_id = ja.id
  WHERE ja.is_active = true
    AND ja.delivery_mode = p_digest_type || '_digest'
    AND am.delivery_status = 'pending'
  GROUP BY ja.id, ja.user_id, ja.name, ja.push_enabled, ja.email_enabled
  HAVING COUNT(am.job_id) > 0
  ORDER BY ja.user_id, ja.name
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DONE
-- ============================================
