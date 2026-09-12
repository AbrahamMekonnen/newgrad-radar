-- Scraper run logs for monitoring and error tracking
-- This table stores information about each scraper run so you can monitor health

CREATE TABLE IF NOT EXISTS scraper_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sources_succeeded TEXT[] DEFAULT '{}',
    sources_failed TEXT[] DEFAULT '{}',
    sources_skipped TEXT[] DEFAULT '{}',
    error_count INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    jobs_found INTEGER DEFAULT 0,
    jobs_new INTEGER DEFAULT 0,
    jobs_updated INTEGER DEFAULT 0,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying recent runs
CREATE INDEX idx_scraper_logs_run_time ON scraper_logs(run_time DESC);

-- Index for finding runs with errors
CREATE INDEX idx_scraper_logs_error_count ON scraper_logs(error_count) WHERE error_count > 0;

-- RLS: Only service role can write, authenticated users can read
ALTER TABLE scraper_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert scraper logs"
    ON scraper_logs FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Authenticated users can view scraper logs"
    ON scraper_logs FOR SELECT
    TO authenticated
    USING (true);

-- View for quick health check (last 24 hours)
CREATE OR REPLACE VIEW scraper_health AS
SELECT
    COUNT(*) as runs_24h,
    SUM(error_count) as total_errors_24h,
    SUM(jobs_new) as new_jobs_24h,
    MAX(run_time) as last_run,
    ARRAY_AGG(DISTINCT unnest) as failed_sources_24h
FROM scraper_logs
CROSS JOIN LATERAL unnest(sources_failed) AS unnest
WHERE run_time > NOW() - INTERVAL '24 hours';

COMMENT ON TABLE scraper_logs IS 'Tracks scraper runs for monitoring. Check this if jobs stop appearing.';
