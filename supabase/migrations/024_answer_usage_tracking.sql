-- =============================================
-- Answer Usage Tracking
-- Migration: 024_answer_usage_tracking.sql
--
-- Tracks which answers/stories have been used for which companies
-- to enable smart rotation and prevent repetitive answers
-- =============================================

-- =============================================
-- Answer Usage History Table
-- =============================================

CREATE TABLE answer_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES user_story_bank(id) ON DELETE CASCADE,

  -- Usage context
  question_category TEXT NOT NULL CHECK (question_category IN (
    'why_company', 'why_role', 'challenging_project', 'teamwork',
    'conflict_resolution', 'failure_learning', 'leadership',
    'problem_solving', 'strengths', 'weaknesses', 'career_goals',
    'achievement', 'generic'
  )),
  company_slug TEXT NOT NULL,

  -- Metadata
  answer_bank_id UUID REFERENCES answer_bank(id) ON DELETE SET NULL,
  word_count_used INTEGER,
  personalized BOOLEAN DEFAULT true,

  used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient lookup
CREATE INDEX idx_answer_usage_user ON answer_usage(user_id);
CREATE INDEX idx_answer_usage_category ON answer_usage(user_id, question_category);
CREATE INDEX idx_answer_usage_story ON answer_usage(user_id, story_id);
CREATE INDEX idx_answer_usage_recent ON answer_usage(user_id, question_category, used_at DESC);
CREATE INDEX idx_answer_usage_company ON answer_usage(user_id, company_slug);

-- =============================================
-- Helper Function: Increment times_used
-- =============================================
-- Used by the selector to atomically increment usage count

CREATE OR REPLACE FUNCTION increment_times_used()
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE((
    SELECT times_used FROM user_story_bank
    WHERE id = NEW.id
  ), 0) + 1;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- Usage Statistics View
-- =============================================
-- Aggregated view for answer selection optimization

CREATE OR REPLACE VIEW answer_usage_stats AS
SELECT
  user_id,
  story_id,
  question_category,
  COUNT(*) as total_uses,
  COUNT(DISTINCT company_slug) as unique_companies,
  MAX(used_at) as last_used_at,
  ARRAY_AGG(DISTINCT company_slug ORDER BY company_slug) as companies_used
FROM answer_usage
GROUP BY user_id, story_id, question_category;

COMMENT ON VIEW answer_usage_stats IS 'Aggregated usage statistics for answer rotation optimization';

-- =============================================
-- Recent Usage Function
-- =============================================
-- Get recently used story IDs for a category (optimized for rotation)

CREATE OR REPLACE FUNCTION get_recently_used_stories(
  p_user_id UUID,
  p_category TEXT,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE(story_id UUID, used_at TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (au.story_id) au.story_id, au.used_at
  FROM answer_usage au
  WHERE au.user_id = p_user_id
    AND au.question_category = p_category
  ORDER BY au.story_id, au.used_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================
-- Row Level Security (RLS) Policies
-- =============================================

ALTER TABLE answer_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage history"
  ON answer_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage records"
  ON answer_usage FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Usage history is append-only (no update/delete for audit trail)
-- But allow delete for data cleanup if needed
CREATE POLICY "Users can delete own usage records"
  ON answer_usage FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================
-- Add short/standard/long columns to answer_bank
-- =============================================
-- Makes it easier to store multiple lengths per story

ALTER TABLE answer_bank
  ADD COLUMN IF NOT EXISTS short TEXT,
  ADD COLUMN IF NOT EXISTS standard TEXT,
  ADD COLUMN IF NOT EXISTS long TEXT;

COMMENT ON COLUMN answer_bank.short IS 'Short version (~75 words)';
COMMENT ON COLUMN answer_bank.standard IS 'Standard version (~150 words)';
COMMENT ON COLUMN answer_bank.long IS 'Long version (~300 words)';

-- =============================================
-- Cleanup function for old usage records
-- =============================================
-- Keep only last 6 months of usage history

CREATE OR REPLACE FUNCTION cleanup_old_answer_usage()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM answer_usage
  WHERE used_at < NOW() - INTERVAL '6 months';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_answer_usage IS 'Removes usage records older than 6 months';

-- =============================================
-- Comments
-- =============================================

COMMENT ON TABLE answer_usage IS 'Tracks which stories/answers were used for which companies to enable smart rotation';
COMMENT ON COLUMN answer_usage.question_category IS 'Category of question this answer was used for';
COMMENT ON COLUMN answer_usage.company_slug IS 'Company the answer was used for';
COMMENT ON FUNCTION get_recently_used_stories IS 'Returns recently used story IDs for a category, optimized for answer rotation';
