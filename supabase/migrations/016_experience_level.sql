-- ============================================
-- EXPERIENCE LEVEL CLASSIFICATION
-- Migration 016: Add experience level columns to jobs table
-- ============================================

-- Add experience level classification columns
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_level TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_confidence FLOAT DEFAULT 0.0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_matched_patterns TEXT[] DEFAULT '{}';

-- Add comments for documentation
COMMENT ON COLUMN jobs.experience_level IS 'Classified experience level: new_grad, entry_level, junior, mid, senior, staff';
COMMENT ON COLUMN jobs.experience_confidence IS 'Confidence score for experience classification (0.0 to 1.0)';
COMMENT ON COLUMN jobs.experience_matched_patterns IS 'Patterns that matched for classification';

-- Index for filtering by experience level
CREATE INDEX IF NOT EXISTS idx_jobs_experience_level ON jobs(experience_level);

-- ============================================
-- DONE
-- ============================================
