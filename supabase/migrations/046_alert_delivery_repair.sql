-- Repair missing smart-alert queue and matching trigger on existing deployments.
CREATE TABLE IF NOT EXISTS alert_matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID REFERENCES job_alerts(id) ON DELETE CASCADE NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'delivered', 'failed', 'skipped')),
  delivered_at TIMESTAMPTZ,
  delivery_mode TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(alert_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_matches_pending
  ON alert_matches(delivery_status, delivery_mode) WHERE delivery_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_alert_matches_alert ON alert_matches(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_matches_job ON alert_matches(job_id);
ALTER TABLE alert_matches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users read own alert matches" ON alert_matches FOR SELECT
  USING (EXISTS (SELECT 1 FROM job_alerts a WHERE a.id = alert_id AND a.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION match_job_to_alerts(p_job_id TEXT)
RETURNS TABLE (alert_id UUID, user_id UUID, delivery_mode TEXT, push_enabled BOOLEAN, email_enabled BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_job RECORD;
BEGIN
  SELECT j.* INTO v_job FROM jobs j WHERE j.id = p_job_id;
  IF v_job IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT a.id, a.user_id, a.delivery_mode, a.push_enabled, a.email_enabled
  FROM job_alerts a
  WHERE a.is_active = TRUE
    AND (a.filters = '{}'::jsonb OR (
      (NOT a.filters ? 'tiers' OR COALESCE(jsonb_array_length(a.filters->'tiers'), 0) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.filters->'tiers') x WHERE LOWER(x) = LOWER(COALESCE(v_job.tier, ''))))
      AND (NOT a.filters ? 'role_types' OR COALESCE(jsonb_array_length(a.filters->'role_types'), 0) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.filters->'role_types') x
                   WHERE LOWER(x) = ANY(SELECT LOWER(r) FROM unnest(COALESCE(v_job.role_types, ARRAY[]::TEXT[])) r)))
      AND (NOT a.filters ? 'companies' OR COALESCE(jsonb_array_length(a.filters->'companies'), 0) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.filters->'companies') x WHERE LOWER(x) = LOWER(COALESCE(v_job.company_slug, ''))))
      AND (NOT a.filters ? 'locations' OR COALESCE(jsonb_array_length(a.filters->'locations'), 0) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.filters->'locations') x WHERE LOWER(COALESCE(v_job.location, '')) LIKE '%' || LOWER(x) || '%'))
      AND (NOT a.filters ? 'title_keywords' OR COALESCE(jsonb_array_length(a.filters->'title_keywords'), 0) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.filters->'title_keywords') x WHERE LOWER(COALESCE(v_job.title, '')) LIKE '%' || LOWER(x) || '%'))
      AND (NOT a.filters ? 'title_exclude' OR COALESCE(jsonb_array_length(a.filters->'title_exclude'), 0) = 0
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.filters->'title_exclude') x WHERE LOWER(COALESCE(v_job.title, '')) LIKE '%' || LOWER(x) || '%'))
      AND (NOT a.filters ? 'experience_levels' OR COALESCE(jsonb_array_length(a.filters->'experience_levels'), 0) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.filters->'experience_levels') x WHERE LOWER(x) = LOWER(COALESCE(v_job.experience_level, ''))))
      AND (NOT a.filters ? 'sources' OR COALESCE(jsonb_array_length(a.filters->'sources'), 0) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.filters->'sources') x WHERE LOWER(COALESCE(v_job.source, '')) LIKE '%' || LOWER(x) || '%'))
      AND (NOT a.filters ? 'salary_min' OR v_job.salary_min IS NULL OR v_job.salary_min >= (a.filters->>'salary_min')::INTEGER)
    ));
END;
$$;

CREATE OR REPLACE FUNCTION process_new_job_alerts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO alert_matches(alert_id, job_id, delivery_mode)
  SELECT m.alert_id, NEW.id, m.delivery_mode FROM match_job_to_alerts(NEW.id) m
  ON CONFLICT (alert_id, job_id) DO NOTHING;
  UPDATE job_alerts SET last_triggered_at = NOW(), trigger_count = trigger_count + 1, updated_at = NOW()
  WHERE id IN (SELECT m.alert_id FROM match_job_to_alerts(NEW.id) m);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_process_new_job_alerts ON jobs;
CREATE TRIGGER trigger_process_new_job_alerts
AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION process_new_job_alerts();

NOTIFY pgrst, 'reload schema';
