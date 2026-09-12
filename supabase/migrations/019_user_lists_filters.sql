-- ============================================
-- NEWGRAD RADAR - PER-COMPANY JOB FILTERS
-- Adds job_filters to user_lists for per-company notification filtering
-- ============================================

-- Add job_filters JSONB column to user_lists
-- Structure: {
--   role_types: ["swe", "ml"],
--   experience_levels: ["new_grad", "entry_level"],
--   title_keywords: ["engineer"],
--   title_exclude: ["senior", "staff", "principal", "lead", "manager"]
-- }
ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS job_filters JSONB DEFAULT '{}';

-- Add comment describing the structure
COMMENT ON COLUMN user_lists.job_filters IS 'Per-company job filters: role_types[], experience_levels[], title_keywords[], title_exclude[]';

-- Create index for efficient filtering queries
CREATE INDEX IF NOT EXISTS idx_user_lists_job_filters
  ON user_lists USING GIN(job_filters)
  WHERE job_filters != '{}';

-- ============================================
-- FUNCTION: sync_user_list_alert (UPDATED)
-- Now includes per-company filters in the alert
-- ============================================
CREATE OR REPLACE FUNCTION sync_user_list_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_alert_id UUID;
  v_companies TEXT[];
  v_notify_mode TEXT;
  v_company_filters JSONB;
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

  -- Build per-company filters object
  SELECT jsonb_object_agg(company_slug, job_filters)
  INTO v_company_filters
  FROM user_lists
  WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
    AND notify_enabled = true
    AND job_filters IS NOT NULL
    AND job_filters != '{}'::JSONB;

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

  -- Update the alert with current companies filter and per-company filters
  UPDATE job_alerts
  SET
    filters = CASE
      WHEN v_companies IS NULL OR array_length(v_companies, 1) = 0
      THEN '{}'::JSONB
      ELSE jsonb_build_object(
        'companies', to_jsonb(v_companies),
        'company_filters', COALESCE(v_company_filters, '{}'::JSONB)
      )
    END,
    delivery_mode = v_notify_mode,
    is_active = (v_companies IS NOT NULL AND array_length(v_companies, 1) > 0),
    updated_at = NOW()
  WHERE id = v_alert_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: match_job_to_alerts (UPDATED)
-- Now respects per-company filters from My List
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
      -- Per-company filters: if company_filters exists, apply that company's specific filters
      AND (
        NOT ja.filters ? 'company_filters'
        OR NOT ja.filters->'company_filters' ? v_job.company_slug
        OR (
          -- Per-company role_types filter
          (
            NOT ja.filters->'company_filters'->v_job.company_slug ? 'role_types'
            OR jsonb_array_length(ja.filters->'company_filters'->v_job.company_slug->'role_types') = 0
            OR EXISTS (
              SELECT 1 FROM unnest(v_job.role_types) AS jrt
              WHERE ja.filters->'company_filters'->v_job.company_slug->'role_types' @> to_jsonb(jrt)
            )
          )
          -- Per-company experience_levels filter
          AND (
            NOT ja.filters->'company_filters'->v_job.company_slug ? 'experience_levels'
            OR jsonb_array_length(ja.filters->'company_filters'->v_job.company_slug->'experience_levels') = 0
            OR v_job.experience_level IS NULL
            OR ja.filters->'company_filters'->v_job.company_slug->'experience_levels' @> to_jsonb(v_job.experience_level)
          )
          -- Per-company title_keywords filter
          AND (
            NOT ja.filters->'company_filters'->v_job.company_slug ? 'title_keywords'
            OR jsonb_array_length(ja.filters->'company_filters'->v_job.company_slug->'title_keywords') = 0
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(ja.filters->'company_filters'->v_job.company_slug->'title_keywords') AS kw
              WHERE LOWER(v_job.title) LIKE '%' || LOWER(kw) || '%'
            )
          )
          -- Per-company title_exclude filter
          AND (
            NOT ja.filters->'company_filters'->v_job.company_slug ? 'title_exclude'
            OR jsonb_array_length(ja.filters->'company_filters'->v_job.company_slug->'title_exclude') = 0
            OR NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(ja.filters->'company_filters'->v_job.company_slug->'title_exclude') AS ex
              WHERE LOWER(v_job.title) LIKE '%' || LOWER(ex) || '%'
            )
          )
        )
      )
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DONE
-- ============================================
