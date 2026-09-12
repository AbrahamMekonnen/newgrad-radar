-- ============================================
-- HISTORICAL HIRING PATTERNS MIGRATION
-- Track job lifecycle events to predict when companies hire
-- ============================================

-- ============================================
-- TABLE: job_lifecycle_events
-- Tracks every state change in a job posting
-- ============================================
CREATE TABLE job_lifecycle_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id TEXT NOT NULL,                           -- References jobs(id), but not FK to preserve history
    company_slug TEXT REFERENCES companies(slug) NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'closed', 'reactivated', 'updated')),
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    title TEXT,                                     -- Title at time of event
    role_types TEXT[] DEFAULT '{}',                 -- Role types at time of event
    location TEXT,
    scraper_run_id UUID REFERENCES scraper_logs(id),
    days_open INTEGER,                              -- Days open (for closed/reactivated events)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual column indexes
CREATE INDEX idx_lifecycle_company ON job_lifecycle_events(company_slug);
CREATE INDEX idx_lifecycle_event_time ON job_lifecycle_events(event_time DESC);
CREATE INDEX idx_lifecycle_job_id ON job_lifecycle_events(job_id);
CREATE INDEX idx_lifecycle_event_type ON job_lifecycle_events(event_type);

-- Composite index for seasonal queries (company + month + event type)
CREATE INDEX idx_lifecycle_seasonal ON job_lifecycle_events(
    company_slug,
    (EXTRACT(MONTH FROM event_time)),
    event_type
);

COMMENT ON TABLE job_lifecycle_events IS 'Tracks all job state changes for historical hiring pattern analysis';

-- ============================================
-- TABLE: hiring_seasons
-- Monthly aggregates of hiring activity per company
-- ============================================
CREATE TABLE hiring_seasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_slug TEXT REFERENCES companies(slug) NOT NULL,
    year INT NOT NULL CHECK (year >= 2020 AND year <= 2100),
    month INT NOT NULL CHECK (month >= 1 AND month <= 12),
    roles_opened INT DEFAULT 0,                     -- Jobs opened this month
    unique_titles TEXT[] DEFAULT '{}',              -- Distinct titles opened
    role_types_opened TEXT[] DEFAULT '{}',          -- Role types that were opened
    roles_closed INT DEFAULT 0,                     -- Jobs closed this month
    avg_days_open NUMERIC(6,2),                     -- Average days jobs stayed open
    net_new_roles INT DEFAULT 0,                    -- opened - closed
    yoy_change_pct NUMERIC(6,2),                    -- Year-over-year % change in roles_opened
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_slug, year, month)
);

CREATE INDEX idx_hiring_seasons_company ON hiring_seasons(company_slug);
CREATE INDEX idx_hiring_seasons_period ON hiring_seasons(year, month);

COMMENT ON TABLE hiring_seasons IS 'Monthly hiring activity aggregates per company for trend analysis';

-- ============================================
-- TABLE: company_hiring_stats
-- Annual summaries and predictions per company
-- ============================================
CREATE TABLE company_hiring_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_slug TEXT REFERENCES companies(slug) NOT NULL,
    year INT NOT NULL CHECK (year >= 2020 AND year <= 2100),
    total_roles_posted INT DEFAULT 0,               -- Total unique roles posted
    total_new_grad_roles INT DEFAULT 0,             -- Roles classified as new grad
    peak_hiring_month INT CHECK (peak_hiring_month >= 1 AND peak_hiring_month <= 12),
    avg_posting_duration_days NUMERIC(6,2),         -- Average days a posting stays open
    role_type_breakdown JSONB DEFAULT '{}',         -- {"swe": 45, "ml": 12, ...}
    location_breakdown JSONB DEFAULT '{}',          -- {"San Francisco": 30, "Remote": 25, ...}
    predicted_start_month INT CHECK (predicted_start_month >= 1 AND predicted_start_month <= 12),
    predicted_end_month INT CHECK (predicted_end_month >= 1 AND predicted_end_month <= 12),
    hiring_velocity TEXT CHECK (hiring_velocity IN ('aggressive', 'steady', 'burst', 'inactive')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_slug, year)
);

CREATE INDEX idx_company_stats_company ON company_hiring_stats(company_slug);
CREATE INDEX idx_company_stats_year ON company_hiring_stats(year);
CREATE INDEX idx_company_stats_velocity ON company_hiring_stats(hiring_velocity);

COMMENT ON TABLE company_hiring_stats IS 'Annual hiring summaries and pattern predictions per company';

-- ============================================
-- TABLE: hiring_predictions
-- Forward-looking predictions for when companies will hire
-- ============================================
CREATE TABLE hiring_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_slug TEXT REFERENCES companies(slug) NOT NULL,
    predicted_month INT NOT NULL CHECK (predicted_month >= 1 AND predicted_month <= 12),
    predicted_year INT NOT NULL CHECK (predicted_year >= 2020 AND predicted_year <= 2100),
    confidence NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),  -- 0.0 to 1.0
    expected_role_types TEXT[] DEFAULT '{}',        -- Role types likely to be posted
    expected_role_count INT,                        -- Estimated number of roles
    based_on_years INT DEFAULT 1,                   -- How many years of data used
    pattern_type TEXT,                              -- "seasonal", "yoy_trend", "historical_avg"
    was_accurate BOOLEAN,                           -- Set after the month passes
    actual_roles INT,                               -- Actual roles posted (set after month)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_company ON hiring_predictions(company_slug);
CREATE INDEX idx_predictions_period ON hiring_predictions(predicted_year, predicted_month);
CREATE INDEX idx_predictions_upcoming ON hiring_predictions(predicted_year, predicted_month)
    WHERE was_accurate IS NULL;  -- Only unverified predictions

COMMENT ON TABLE hiring_predictions IS 'Forward-looking predictions for when companies will post new grad roles';

-- ============================================
-- ADD COLUMNS TO JOBS TABLE
-- Track job visibility lifecycle
-- ============================================
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS times_reactivated INT DEFAULT 0;

-- Backfill first_seen_at from created_at for existing jobs
UPDATE jobs SET first_seen_at = created_at WHERE first_seen_at IS NULL;
UPDATE jobs SET last_seen_at = updated_at WHERE last_seen_at IS NULL;

CREATE INDEX idx_jobs_first_seen ON jobs(first_seen_at DESC);
CREATE INDEX idx_jobs_last_seen ON jobs(last_seen_at DESC);

-- ============================================
-- VIEW: companies_actively_hiring
-- Companies with recent job activity
-- ============================================
CREATE OR REPLACE VIEW companies_actively_hiring AS
SELECT
    c.slug,
    c.name,
    c.tier,
    c.logo_url,
    COUNT(j.id) AS active_jobs,
    COUNT(DISTINCT j.title) AS unique_titles,
    ARRAY_AGG(DISTINCT unnest_role) FILTER (WHERE unnest_role IS NOT NULL) AS active_role_types,
    MAX(j.first_seen_at) AS latest_posting,
    -- Check for recent activity (last 30 days)
    EXISTS (
        SELECT 1 FROM job_lifecycle_events e
        WHERE e.company_slug = c.slug
        AND e.event_type = 'opened'
        AND e.event_time > NOW() - INTERVAL '30 days'
    ) AS has_recent_openings
FROM companies c
LEFT JOIN jobs j ON j.company_slug = c.slug AND j.is_active = true
LEFT JOIN LATERAL unnest(j.role_types) AS unnest_role ON true
GROUP BY c.slug, c.name, c.tier, c.logo_url
HAVING COUNT(j.id) > 0
ORDER BY active_jobs DESC, latest_posting DESC;

COMMENT ON VIEW companies_actively_hiring IS 'Companies with active job postings, ordered by activity level';

-- ============================================
-- VIEW: monthly_hiring_summary
-- Cross-company monthly hiring trends
-- ============================================
CREATE OR REPLACE VIEW monthly_hiring_summary AS
SELECT
    year,
    month,
    COUNT(DISTINCT company_slug) AS companies_hiring,
    SUM(roles_opened) AS total_roles_opened,
    SUM(roles_closed) AS total_roles_closed,
    ROUND(AVG(roles_opened), 2) AS avg_roles_per_company,
    ROUND(AVG(avg_days_open), 2) AS avg_posting_duration,
    SUM(net_new_roles) AS total_net_new
FROM hiring_seasons
GROUP BY year, month
ORDER BY year DESC, month DESC;

COMMENT ON VIEW monthly_hiring_summary IS 'Aggregate monthly hiring activity across all tracked companies';

-- ============================================
-- ROW LEVEL SECURITY
-- Public read access for historical hiring data
-- ============================================
ALTER TABLE job_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_hiring_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE hiring_predictions ENABLE ROW LEVEL SECURITY;

-- Public read policies (historical data is public)
CREATE POLICY "Public read lifecycle events" ON job_lifecycle_events
    FOR SELECT USING (true);

CREATE POLICY "Public read hiring seasons" ON hiring_seasons
    FOR SELECT USING (true);

CREATE POLICY "Public read company stats" ON company_hiring_stats
    FOR SELECT USING (true);

CREATE POLICY "Public read predictions" ON hiring_predictions
    FOR SELECT USING (true);

-- Service role write policies (for scraper and aggregation jobs)
CREATE POLICY "Service writes lifecycle events" ON job_lifecycle_events
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Service manages hiring seasons" ON hiring_seasons
    FOR ALL USING (true);

CREATE POLICY "Service manages company stats" ON company_hiring_stats
    FOR ALL USING (true);

CREATE POLICY "Service manages predictions" ON hiring_predictions
    FOR ALL USING (true);

-- ============================================
-- HELPER FUNCTION: Record job lifecycle event
-- Call this when job state changes
-- ============================================
CREATE OR REPLACE FUNCTION record_job_event(
    p_job_id TEXT,
    p_company_slug TEXT,
    p_event_type TEXT,
    p_title TEXT DEFAULT NULL,
    p_role_types TEXT[] DEFAULT '{}',
    p_location TEXT DEFAULT NULL,
    p_scraper_run_id UUID DEFAULT NULL,
    p_first_seen_at TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
    v_days_open INTEGER;
BEGIN
    -- Calculate days open for closed/reactivated events
    IF p_event_type IN ('closed', 'reactivated') AND p_first_seen_at IS NOT NULL THEN
        v_days_open := EXTRACT(DAY FROM NOW() - p_first_seen_at)::INTEGER;
    END IF;

    INSERT INTO job_lifecycle_events (
        job_id, company_slug, event_type, title, role_types, location, scraper_run_id, days_open
    ) VALUES (
        p_job_id, p_company_slug, p_event_type, p_title, p_role_types, p_location, p_scraper_run_id, v_days_open
    )
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION record_job_event IS 'Records a job lifecycle event and calculates days_open automatically';

-- ============================================
-- DONE
-- ============================================
