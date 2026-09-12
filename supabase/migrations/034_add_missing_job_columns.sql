-- 034_add_missing_job_columns.sql
-- Adds columns the frontend queries but that were never created in earlier
-- migrations. Without these, any All-Jobs filter/sort that references them
-- (salary sort, "High Paying", salary range, "Closing Soon", funding stage,
-- work-mode filter) fails with PostgREST 42703 "column does not exist" and
-- blanks the job list.
--
-- Safe to run multiple times (IF NOT EXISTS guards).

-- Salary (used by: sort=salary, "High Paying" smart filter, salary range filter)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_min INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_max INTEGER;

-- Application deadline (used by: "Closing Soon" filter, trending "closing soon")
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deadline DATE;

-- Funding stage of the hiring company (used by: funding-stage filter)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS funding_stage TEXT;

-- Work modes as an array (used by: work-mode filter via .overlaps()).
-- NOTE: the table already has a singular `work_mode` text column; the app
-- queries the plural array form, so we add it separately.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_modes TEXT[] DEFAULT '{}';

-- Discovery sources array (used by: types.ts Job.discovery_sources)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS discovery_sources TEXT[] DEFAULT '{}';

-- Full job description text (used by: types.ts Job.description, detail views)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT;

-- Indexes for the columns used in ORDER BY / range filters
CREATE INDEX IF NOT EXISTS idx_jobs_salary_max ON jobs (salary_max);
CREATE INDEX IF NOT EXISTS idx_jobs_deadline ON jobs (deadline);
CREATE INDEX IF NOT EXISTS idx_jobs_funding_stage ON jobs (funding_stage);
