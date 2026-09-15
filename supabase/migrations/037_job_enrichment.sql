-- AI enrichment of jobs from their ATS description: fills experience_level,
-- salary, and sponsorship for jobs the title-classifier couldn't, and flags
-- non-jobs (conference/event/ad listings). Populated by scraper/enrich_jobs.py.
--
-- enriched_at marks a job as already processed so the incremental grind never
-- re-pays for it. is_job=false hides non-job listings from the jobs views.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_job BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN jobs.enriched_at IS 'When AI enrichment last ran for this job (NULL = not yet).';
COMMENT ON COLUMN jobs.is_job IS 'false = detected non-job (conference/event/ad); hidden from listings.';

-- Fast lookup of jobs still needing enrichment.
CREATE INDEX IF NOT EXISTS jobs_unenriched_idx ON jobs (enriched_at) WHERE enriched_at IS NULL;

NOTIFY pgrst, 'reload schema';
