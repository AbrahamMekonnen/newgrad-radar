-- Add apply_url column for direct application links
-- This enables auto-apply to go directly to the application form

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS apply_url TEXT;

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_jobs_apply_url ON jobs(apply_url) WHERE apply_url IS NOT NULL;

-- Function to generate apply_url from job URL based on ATS type
CREATE OR REPLACE FUNCTION generate_apply_url(job_url TEXT, ats_source TEXT)
RETURNS TEXT AS $$
BEGIN
  CASE ats_source
    -- Greenhouse: Add #app or /apply suffix
    WHEN 'greenhouse' THEN
      IF job_url LIKE '%#app' THEN
        RETURN job_url;
      ELSE
        RETURN job_url || '#app';
      END IF;

    -- Lever: Add /apply suffix
    WHEN 'lever' THEN
      IF job_url LIKE '%/apply' THEN
        RETURN job_url;
      ELSE
        RETURN RTRIM(job_url, '/') || '/apply';
      END IF;

    -- Ashby: Application is embedded on the job page
    WHEN 'ashby' THEN
      RETURN job_url;

    -- Workday: Complex, keep as-is (forms are multi-step)
    WHEN 'workday' THEN
      RETURN job_url;

    -- Default: return original URL
    ELSE
      RETURN job_url;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill existing jobs with apply_url based on source
UPDATE jobs
SET apply_url = generate_apply_url(url, source::TEXT)
WHERE apply_url IS NULL AND source IS NOT NULL;

-- For jobs without a known source, try to detect from URL
UPDATE jobs
SET apply_url = CASE
  WHEN url LIKE '%greenhouse.io%' THEN url || '#app'
  WHEN url LIKE '%lever.co%' AND url NOT LIKE '%/apply' THEN RTRIM(url, '/') || '/apply'
  WHEN url LIKE '%ashbyhq.com%' THEN url
  WHEN url LIKE '%jobvite.com%' THEN url
  ELSE url
END
WHERE apply_url IS NULL;

-- Add comment
COMMENT ON COLUMN jobs.apply_url IS 'Direct URL to the application form (not job description)';
