-- ============================================
-- NEWGRAD RADAR - EXTENDED JOB ALERT FILTERS
-- Run via: supabase db push or Supabase SQL Editor
--
-- Adds support for additional filter types:
--   - experience_levels (match job.experience_level)
--   - diversity_tags (array overlap with job.diversity_tags)
--   - work_modes (array overlap with job.work_modes)
--   - badges (array overlap with job.badges)
--   - salary_min (job.salary_min >= filter value)
-- ============================================

-- ============================================
-- Add salary_min column to jobs if not exists
-- ============================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_min INTEGER;
COMMENT ON COLUMN jobs.salary_min IS 'Minimum salary in USD (if known from job posting)';
CREATE INDEX IF NOT EXISTS idx_jobs_salary_min ON jobs(salary_min) WHERE salary_min IS NOT NULL;

-- ============================================
-- FUNCTION: populate_alert_filter_index (UPDATED)
-- Auto-populate denormalized index when alerts change
-- Now includes: experience_level, diversity_tag, work_mode, badge
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

  -- ============================================
  -- NEW FILTER TYPES
  -- ============================================

  -- Index experience_levels
  IF NEW.filters ? 'experience_levels' AND jsonb_array_length(NEW.filters->'experience_levels') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'experience_level', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'experience_levels') AS value;
  END IF;

  -- Index diversity_tags
  IF NEW.filters ? 'diversity_tags' AND jsonb_array_length(NEW.filters->'diversity_tags') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'diversity_tag', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'diversity_tags') AS value;
  END IF;

  -- Index work_modes
  IF NEW.filters ? 'work_modes' AND jsonb_array_length(NEW.filters->'work_modes') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'work_mode', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'work_modes') AS value;
  END IF;

  -- Index badges
  IF NEW.filters ? 'badges' AND jsonb_array_length(NEW.filters->'badges') > 0 THEN
    INSERT INTO alert_filter_index (alert_id, filter_type, filter_value, is_exclude)
    SELECT NEW.id, 'badge', LOWER(value::TEXT), false
    FROM jsonb_array_elements_text(NEW.filters->'badges') AS value;
  END IF;

  -- Note: salary_min is not indexed (it's a scalar comparison, not a lookup)

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: match_job_to_alerts (UPDATED)
-- Find all alerts that match a given job
-- Now supports: experience_levels, diversity_tags, work_modes, badges, salary_min
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

      -- ============================================
      -- NEW FILTER TYPES
      -- ============================================

      -- Experience level filter: job experience_level must be in alert's experience_levels
      AND (
        NOT ja.filters ? 'experience_levels'
        OR jsonb_array_length(ja.filters->'experience_levels') = 0
        OR v_job.experience_level IS NULL
        OR ja.filters->'experience_levels' @> to_jsonb(v_job.experience_level)
      )

      -- Diversity tags filter: job must have at least one matching diversity tag (array overlap)
      AND (
        NOT ja.filters ? 'diversity_tags'
        OR jsonb_array_length(ja.filters->'diversity_tags') = 0
        OR v_job.diversity_tags IS NULL
        OR ARRAY_LENGTH(v_job.diversity_tags, 1) IS NULL
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(ja.filters->'diversity_tags') AS dt
          WHERE LOWER(dt) = ANY(SELECT LOWER(unnest(v_job.diversity_tags)))
        )
      )

      -- Work modes filter: job must have at least one matching work mode (array overlap)
      AND (
        NOT ja.filters ? 'work_modes'
        OR jsonb_array_length(ja.filters->'work_modes') = 0
        OR v_job.work_modes IS NULL
        OR ARRAY_LENGTH(v_job.work_modes, 1) IS NULL
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(ja.filters->'work_modes') AS wm
          WHERE LOWER(wm) = ANY(SELECT LOWER(unnest(v_job.work_modes)))
        )
      )

      -- Badges filter: job must have at least one matching badge (array overlap)
      AND (
        NOT ja.filters ? 'badges'
        OR jsonb_array_length(ja.filters->'badges') = 0
        OR v_job.badges IS NULL
        OR ARRAY_LENGTH(v_job.badges, 1) IS NULL
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(ja.filters->'badges') AS b
          WHERE LOWER(b) = ANY(SELECT LOWER(unnest(v_job.badges)))
        )
      )

      -- Salary minimum filter: job salary_min must be >= filter value
      AND (
        NOT ja.filters ? 'salary_min'
        OR (ja.filters->>'salary_min')::INTEGER IS NULL
        OR v_job.salary_min IS NULL
        OR v_job.salary_min >= (ja.filters->>'salary_min')::INTEGER
      )
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DONE
-- ============================================
