-- ============================================
-- Migration: Enhanced Application Pipeline
-- Full Kanban-style application tracking with
-- timeline events and company insights
-- ============================================

-- ============================================
-- ENUM: pipeline_stage
-- All possible stages in the application funnel
-- ============================================
DO $$ BEGIN
  CREATE TYPE pipeline_stage AS ENUM (
    'saved',
    'applied',
    'oa',
    'phone_screen',
    'technical',
    'onsite',
    'team_match',
    'offer',
    'negotiating',
    'accepted',
    'rejected',
    'withdrawn',
    'ghosted'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- TABLE: applications
-- Enhanced version of saved_jobs with full pipeline tracking
-- ============================================
CREATE TABLE IF NOT EXISTS applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Job reference (nullable for manual entries)
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  company_slug TEXT REFERENCES companies(slug) ON DELETE SET NULL,

  -- Denormalized job info (in case job_id is null or job deleted)
  company_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  job_url TEXT,

  -- Pipeline stage tracking
  stage pipeline_stage NOT NULL DEFAULT 'saved',
  previous_stage pipeline_stage,
  stage_changed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Stage timestamps (when each stage was first reached)
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  oa_received_at TIMESTAMPTZ,
  phone_screen_at TIMESTAMPTZ,
  onsite_at TIMESTAMPTZ,
  offer_at TIMESTAMPTZ,
  final_decision_at TIMESTAMPTZ,

  -- Interview scheduling
  next_interview_at TIMESTAMPTZ,
  interview_location TEXT,
  interview_notes TEXT,

  -- Offer details
  offer_base_salary INTEGER,
  offer_bonus INTEGER,
  offer_equity TEXT,                          -- e.g., "$50k over 4 years" or "10,000 RSUs"
  offer_deadline TIMESTAMPTZ,

  -- Rejection tracking
  rejection_reason TEXT,
  rejection_stage pipeline_stage,             -- Which stage they rejected at

  -- Meta
  notes TEXT,
  priority SMALLINT DEFAULT 1 CHECK (priority >= 0 AND priority <= 2),  -- 0=low, 1=normal, 2=high
  source TEXT DEFAULT 'manual',               -- 'manual', 'saved_jobs_import', 'auto_apply'
  referrer_name TEXT,
  referrer_contact TEXT,
  is_archived BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, job_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_applications_company ON applications(company_slug);
CREATE INDEX IF NOT EXISTS idx_applications_archived ON applications(user_id, is_archived) WHERE is_archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_applications_next_interview ON applications(user_id, next_interview_at) WHERE next_interview_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_priority ON applications(user_id, priority DESC);
CREATE INDEX IF NOT EXISTS idx_applications_updated ON applications(user_id, updated_at DESC);

COMMENT ON TABLE applications IS 'Full application pipeline tracking with Kanban-style stages';
COMMENT ON COLUMN applications.priority IS '0=low, 1=normal, 2=high priority';
COMMENT ON COLUMN applications.source IS 'How this application was created: manual, saved_jobs_import, auto_apply';

-- ============================================
-- TABLE: application_events
-- Timeline of all events for each application
-- ============================================
CREATE TABLE IF NOT EXISTS application_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Event classification
  event_type TEXT NOT NULL,                   -- 'stage_change', 'note_added', 'interview_scheduled', 'email_received', 'reminder'
  event_data JSONB DEFAULT '{}',              -- Flexible data for event-specific info

  -- Stage transition (for stage_change events)
  from_stage pipeline_stage,
  to_stage pipeline_stage,

  -- Email integration fields
  email_subject TEXT,
  email_snippet TEXT,                         -- First ~200 chars of email body
  email_detected_at TIMESTAMPTZ,
  confidence_score DECIMAL(3,2),              -- 0.00-1.00 confidence in email classification

  -- Scheduling
  scheduled_at TIMESTAMPTZ,                   -- For interview_scheduled events

  -- Source tracking
  source TEXT DEFAULT 'manual',               -- 'manual', 'email_parsing', 'auto_apply'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_application ON application_events(application_id);
CREATE INDEX IF NOT EXISTS idx_events_user ON application_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON application_events(application_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON application_events(application_id, created_at DESC);

COMMENT ON TABLE application_events IS 'Timeline events for each application (stage changes, emails, interviews, notes)';
COMMENT ON COLUMN application_events.confidence_score IS 'ML confidence in email classification (0.00-1.00)';

-- ============================================
-- TABLE: company_insights
-- Aggregated statistics per company
-- ============================================
CREATE TABLE IF NOT EXISTS company_insights (
  company_slug TEXT PRIMARY KEY REFERENCES companies(slug) ON DELETE CASCADE,

  -- Volume stats
  total_applications INTEGER DEFAULT 0,
  response_count INTEGER DEFAULT 0,           -- Got past 'applied' stage
  interview_count INTEGER DEFAULT 0,          -- Reached phone_screen or beyond
  offer_count INTEGER DEFAULT 0,

  -- Timing metrics (in days)
  avg_response_days DECIMAL(5,1),             -- Avg days from applied to first response
  avg_to_interview_days DECIMAL(5,1),         -- Avg days from applied to first interview
  avg_to_offer_days DECIMAL(5,1),             -- Avg days from applied to offer

  -- Conversion rates (as percentages)
  response_rate DECIMAL(5,2),                 -- % of applications that get response
  interview_rate DECIMAL(5,2),                -- % of applications that reach interview
  offer_rate DECIMAL(5,2),                    -- % of applications that get offer
  offer_accept_rate DECIMAL(5,2),             -- % of offers that get accepted

  -- Process characteristics
  typical_rounds INTEGER,                     -- Most common number of interview rounds
  has_oa BOOLEAN,                             -- Usually has online assessment
  has_technical BOOLEAN,                      -- Usually has technical interview
  has_onsite BOOLEAN,                         -- Usually has onsite/final round
  has_team_match BOOLEAN,                     -- Usually has team matching

  -- Community knowledge
  interview_tips TEXT[],                      -- Array of tips from community
  common_questions JSONB DEFAULT '[]',        -- [{question, stage, frequency}]

  -- Meta
  sample_size INTEGER DEFAULT 0,              -- Number of data points
  last_refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insights_response ON company_insights(response_rate DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_insights_offer ON company_insights(offer_rate DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_insights_sample ON company_insights(sample_size DESC);

COMMENT ON TABLE company_insights IS 'Aggregated application statistics per company';
COMMENT ON COLUMN company_insights.interview_tips IS 'Community-contributed interview preparation tips';

-- ============================================
-- VIEW: pipeline_summary
-- Aggregated stats for Kanban header display
-- ============================================
CREATE OR REPLACE VIEW pipeline_summary AS
SELECT
  user_id,
  COUNT(*) FILTER (WHERE stage = 'saved' AND NOT is_archived) AS saved_count,
  COUNT(*) FILTER (WHERE stage = 'applied' AND NOT is_archived) AS applied_count,
  COUNT(*) FILTER (WHERE stage = 'oa' AND NOT is_archived) AS oa_count,
  COUNT(*) FILTER (WHERE stage = 'phone_screen' AND NOT is_archived) AS phone_screen_count,
  COUNT(*) FILTER (WHERE stage = 'technical' AND NOT is_archived) AS technical_count,
  COUNT(*) FILTER (WHERE stage = 'onsite' AND NOT is_archived) AS onsite_count,
  COUNT(*) FILTER (WHERE stage = 'team_match' AND NOT is_archived) AS team_match_count,
  COUNT(*) FILTER (WHERE stage = 'offer' AND NOT is_archived) AS offer_count,
  COUNT(*) FILTER (WHERE stage = 'negotiating' AND NOT is_archived) AS negotiating_count,
  COUNT(*) FILTER (WHERE stage = 'accepted' AND NOT is_archived) AS accepted_count,
  COUNT(*) FILTER (WHERE stage = 'rejected' AND NOT is_archived) AS rejected_count,
  COUNT(*) FILTER (WHERE stage = 'withdrawn' AND NOT is_archived) AS withdrawn_count,
  COUNT(*) FILTER (WHERE stage = 'ghosted' AND NOT is_archived) AS ghosted_count,
  COUNT(*) FILTER (WHERE NOT is_archived) AS total_active,
  COUNT(*) FILTER (WHERE is_archived) AS total_archived,
  COUNT(*) FILTER (WHERE next_interview_at IS NOT NULL AND next_interview_at > NOW() AND NOT is_archived) AS upcoming_interviews,
  COUNT(*) FILTER (WHERE offer_deadline IS NOT NULL AND offer_deadline > NOW() AND stage IN ('offer', 'negotiating') AND NOT is_archived) AS pending_offers
FROM applications
GROUP BY user_id;

COMMENT ON VIEW pipeline_summary IS 'Aggregated counts per pipeline stage for Kanban header';

-- ============================================
-- FUNCTION: Record stage change event
-- Automatically creates timeline event on stage change
-- ============================================
CREATE OR REPLACE FUNCTION record_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when stage actually changes
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    -- Update previous_stage and stage_changed_at
    NEW.previous_stage := OLD.stage;
    NEW.stage_changed_at := NOW();

    -- Update stage-specific timestamps
    CASE NEW.stage
      WHEN 'applied' THEN
        IF NEW.applied_at IS NULL THEN NEW.applied_at := NOW(); END IF;
      WHEN 'oa' THEN
        IF NEW.oa_received_at IS NULL THEN NEW.oa_received_at := NOW(); END IF;
      WHEN 'phone_screen' THEN
        IF NEW.phone_screen_at IS NULL THEN NEW.phone_screen_at := NOW(); END IF;
      WHEN 'onsite' THEN
        IF NEW.onsite_at IS NULL THEN NEW.onsite_at := NOW(); END IF;
      WHEN 'offer' THEN
        IF NEW.offer_at IS NULL THEN NEW.offer_at := NOW(); END IF;
      WHEN 'accepted', 'rejected', 'withdrawn' THEN
        IF NEW.final_decision_at IS NULL THEN NEW.final_decision_at := NOW(); END IF;
        -- Track rejection stage
        IF NEW.stage = 'rejected' AND NEW.rejection_stage IS NULL THEN
          NEW.rejection_stage := OLD.stage;
        END IF;
      ELSE
        NULL;
    END CASE;

    -- Insert timeline event
    INSERT INTO application_events (
      application_id,
      user_id,
      event_type,
      from_stage,
      to_stage,
      source
    ) VALUES (
      NEW.id,
      NEW.user_id,
      'stage_change',
      OLD.stage,
      NEW.stage,
      'manual'
    );
  END IF;

  -- Always update updated_at
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_record_stage_change ON applications;
CREATE TRIGGER trigger_record_stage_change
  BEFORE UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION record_stage_change();

-- ============================================
-- FUNCTION: refresh_company_insights
-- Recalculate company statistics from applications
-- ============================================
CREATE OR REPLACE FUNCTION refresh_company_insights()
RETURNS void AS $$
DECLARE
  comp RECORD;
  stats RECORD;
BEGIN
  -- Loop through each company with applications
  FOR comp IN
    SELECT DISTINCT company_slug
    FROM applications
    WHERE company_slug IS NOT NULL
  LOOP
    -- Calculate statistics
    SELECT
      COUNT(*) AS total_apps,
      COUNT(*) FILTER (WHERE stage NOT IN ('saved', 'applied', 'ghosted')) AS responses,
      COUNT(*) FILTER (WHERE stage IN ('phone_screen', 'technical', 'onsite', 'team_match', 'offer', 'negotiating', 'accepted')) AS interviews,
      COUNT(*) FILTER (WHERE stage IN ('offer', 'negotiating', 'accepted')) AS offers,
      COUNT(*) FILTER (WHERE stage = 'accepted') AS accepts,
      -- Timing calculations
      AVG(EXTRACT(EPOCH FROM (COALESCE(oa_received_at, phone_screen_at) - applied_at)) / 86400)
        FILTER (WHERE applied_at IS NOT NULL AND (oa_received_at IS NOT NULL OR phone_screen_at IS NOT NULL)) AS resp_days,
      AVG(EXTRACT(EPOCH FROM (phone_screen_at - applied_at)) / 86400)
        FILTER (WHERE applied_at IS NOT NULL AND phone_screen_at IS NOT NULL) AS int_days,
      AVG(EXTRACT(EPOCH FROM (offer_at - applied_at)) / 86400)
        FILTER (WHERE applied_at IS NOT NULL AND offer_at IS NOT NULL) AS offer_days,
      -- Process characteristics
      BOOL_OR(oa_received_at IS NOT NULL) AS has_oa_flag,
      BOOL_OR(stage = 'technical' OR stage = 'onsite') AS has_tech_flag,
      BOOL_OR(onsite_at IS NOT NULL) AS has_onsite_flag,
      BOOL_OR(stage = 'team_match') AS has_match_flag
    INTO stats
    FROM applications
    WHERE company_slug = comp.company_slug
      AND stage != 'saved';  -- Exclude unsent applications

    -- Upsert insights
    INSERT INTO company_insights (
      company_slug,
      total_applications,
      response_count,
      interview_count,
      offer_count,
      avg_response_days,
      avg_to_interview_days,
      avg_to_offer_days,
      response_rate,
      interview_rate,
      offer_rate,
      offer_accept_rate,
      has_oa,
      has_technical,
      has_onsite,
      has_team_match,
      sample_size,
      last_refreshed_at,
      updated_at
    ) VALUES (
      comp.company_slug,
      stats.total_apps,
      stats.responses,
      stats.interviews,
      stats.offers,
      ROUND(stats.resp_days::NUMERIC, 1),
      ROUND(stats.int_days::NUMERIC, 1),
      ROUND(stats.offer_days::NUMERIC, 1),
      CASE WHEN stats.total_apps > 0 THEN ROUND((stats.responses::NUMERIC / stats.total_apps) * 100, 2) ELSE 0 END,
      CASE WHEN stats.total_apps > 0 THEN ROUND((stats.interviews::NUMERIC / stats.total_apps) * 100, 2) ELSE 0 END,
      CASE WHEN stats.total_apps > 0 THEN ROUND((stats.offers::NUMERIC / stats.total_apps) * 100, 2) ELSE 0 END,
      CASE WHEN stats.offers > 0 THEN ROUND((stats.accepts::NUMERIC / stats.offers) * 100, 2) ELSE NULL END,
      COALESCE(stats.has_oa_flag, FALSE),
      COALESCE(stats.has_tech_flag, FALSE),
      COALESCE(stats.has_onsite_flag, FALSE),
      COALESCE(stats.has_match_flag, FALSE),
      stats.total_apps,
      NOW(),
      NOW()
    )
    ON CONFLICT (company_slug)
    DO UPDATE SET
      total_applications = EXCLUDED.total_applications,
      response_count = EXCLUDED.response_count,
      interview_count = EXCLUDED.interview_count,
      offer_count = EXCLUDED.offer_count,
      avg_response_days = EXCLUDED.avg_response_days,
      avg_to_interview_days = EXCLUDED.avg_to_interview_days,
      avg_to_offer_days = EXCLUDED.avg_to_offer_days,
      response_rate = EXCLUDED.response_rate,
      interview_rate = EXCLUDED.interview_rate,
      offer_rate = EXCLUDED.offer_rate,
      offer_accept_rate = EXCLUDED.offer_accept_rate,
      has_oa = EXCLUDED.has_oa,
      has_technical = EXCLUDED.has_technical,
      has_onsite = EXCLUDED.has_onsite,
      has_team_match = EXCLUDED.has_team_match,
      sample_size = EXCLUDED.sample_size,
      last_refreshed_at = NOW(),
      updated_at = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_company_insights IS 'Recalculates company statistics from all application data. Run periodically via cron.';

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_insights ENABLE ROW LEVEL SECURITY;

-- Applications: users manage their own
CREATE POLICY "Users manage own applications" ON applications
  FOR ALL USING (auth.uid() = user_id);

-- Events: users manage their own
CREATE POLICY "Users manage own events" ON application_events
  FOR ALL USING (auth.uid() = user_id);

-- Company insights: public read, service write
CREATE POLICY "Public read company insights" ON company_insights
  FOR SELECT USING (true);

CREATE POLICY "Service writes company insights" ON company_insights
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service updates company insights" ON company_insights
  FOR UPDATE USING (true);

-- ============================================
-- MIGRATION HELPER: Import existing saved_jobs
-- Run this once after migration to import data
-- ============================================
CREATE OR REPLACE FUNCTION migrate_saved_jobs_to_applications()
RETURNS INTEGER AS $$
DECLARE
  imported_count INTEGER := 0;
  sj RECORD;
BEGIN
  FOR sj IN
    SELECT
      sj.*,
      j.company_slug,
      j.company_name,
      j.title,
      j.url
    FROM saved_jobs sj
    JOIN jobs j ON j.id = sj.job_id
    WHERE NOT EXISTS (
      SELECT 1 FROM applications a
      WHERE a.user_id = sj.user_id AND a.job_id = sj.job_id
    )
  LOOP
    INSERT INTO applications (
      user_id,
      job_id,
      company_slug,
      company_name,
      job_title,
      job_url,
      stage,
      saved_at,
      applied_at,
      notes,
      source,
      created_at,
      updated_at
    ) VALUES (
      sj.user_id,
      sj.job_id,
      sj.company_slug,
      sj.company_name,
      sj.title,
      sj.url,
      CASE sj.status
        WHEN 'saved' THEN 'saved'::pipeline_stage
        WHEN 'applied' THEN 'applied'::pipeline_stage
        WHEN 'interviewing' THEN 'phone_screen'::pipeline_stage
        WHEN 'rejected' THEN 'rejected'::pipeline_stage
        WHEN 'offer' THEN 'offer'::pipeline_stage
        ELSE 'saved'::pipeline_stage
      END,
      sj.created_at,
      sj.applied_at,
      sj.notes,
      'saved_jobs_import',
      sj.created_at,
      sj.updated_at
    );
    imported_count := imported_count + 1;
  END LOOP;

  RETURN imported_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION migrate_saved_jobs_to_applications IS 'One-time migration helper to import saved_jobs into applications table';

-- ============================================
-- DONE
-- ============================================
