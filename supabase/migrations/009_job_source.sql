-- Migration: Add job source tracking
-- This allows tracking where each job listing was discovered

-- Add source column for job origin (ATS or aggregator)
-- Default existing jobs to 'direct' since we don't know their original source
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'direct';

-- Add source_url for attribution links back to the original listing
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Create index for filtering by source
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);

-- Add comment for documentation
COMMENT ON COLUMN jobs.source IS 'Origin of the job listing: greenhouse, lever, ashby, simplify, adzuna, remoteok, usajobs, hn, vc_portfolio, conference, hackathon, github_repo, newsletter, direct';
COMMENT ON COLUMN jobs.source_url IS 'Attribution URL linking back to the original job listing source';
