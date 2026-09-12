-- ============================================
-- NEWGRAD RADAR - SMART RECOMMENDATIONS
-- Migration: 013_recommendations.sql
-- User preferences, behavior tracking, and collaborative filtering
-- ============================================

-- ============================================
-- TABLE: user_match_preferences
-- User preferences for job matching and recommendations
-- ============================================
CREATE TABLE user_match_preferences (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,

  -- Explicit preferences (user-specified)
  preferred_roles TEXT[] DEFAULT '{}',           -- ['swe', 'backend', 'ml']
  preferred_tiers TEXT[] DEFAULT '{}',           -- ['faang', 'ai', 'unicorn']
  preferred_locations TEXT[] DEFAULT '{}',       -- ['San Francisco, CA', 'New York, NY']
  remote_preference TEXT,                        -- 'remote', 'hybrid', 'onsite', 'any'
  salary_min_expectation INT,                    -- Minimum salary expectation
  preferred_company_sizes TEXT[] DEFAULT '{}',   -- ['startup', 'mid', 'large']
  preferred_industries TEXT[] DEFAULT '{}',      -- ['ai', 'fintech', 'healthcare']
  skills TEXT[] DEFAULT '{}',                    -- ['python', 'react', 'kubernetes']

  -- Implicit preferences (auto-learned from behavior)
  implicit_roles TEXT[] DEFAULT '{}',            -- Roles user frequently views/saves
  implicit_tiers TEXT[] DEFAULT '{}',            -- Tiers user frequently views/saves
  implicit_companies TEXT[] DEFAULT '{}',        -- Company slugs user shows interest in

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for preference matching queries
CREATE INDEX idx_user_match_preferences_roles ON user_match_preferences USING GIN(preferred_roles);
CREATE INDEX idx_user_match_preferences_tiers ON user_match_preferences USING GIN(preferred_tiers);
CREATE INDEX idx_user_match_preferences_locations ON user_match_preferences USING GIN(preferred_locations);
CREATE INDEX idx_user_match_preferences_skills ON user_match_preferences USING GIN(skills);

-- ============================================
-- TABLE: user_behavior_events
-- Track user interactions for recommendation learning
-- ============================================
CREATE TABLE user_behavior_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL,                      -- 'view', 'save', 'apply', 'unsave', 'dismiss', 'click_apply'
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT,                               -- Browser session identifier
  source_page TEXT,                              -- 'all_jobs', 'my_list', 'saved', 'search', 'recommendations'
  search_query TEXT,                             -- Search query if from search
  filter_context JSONB DEFAULT '{}',             -- Active filters when event occurred
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for behavior analysis
CREATE INDEX idx_behavior_events_user ON user_behavior_events(user_id);
CREATE INDEX idx_behavior_events_job ON user_behavior_events(job_id);
CREATE INDEX idx_behavior_events_type ON user_behavior_events(event_type);
CREATE INDEX idx_behavior_events_created ON user_behavior_events(created_at DESC);
CREATE INDEX idx_behavior_events_user_type ON user_behavior_events(user_id, event_type);
CREATE INDEX idx_behavior_events_user_created ON user_behavior_events(user_id, created_at DESC);

-- ============================================
-- TABLE: job_similarities
-- Pre-computed job similarity scores for content-based filtering
-- ============================================
CREATE TABLE job_similarities (
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  similar_job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  similarity_score FLOAT NOT NULL,               -- 0.0 to 1.0, higher = more similar
  similarity_reasons TEXT[] DEFAULT '{}',        -- ['same_company', 'same_role', 'similar_title']
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (job_id, similar_job_id)
);

-- Indexes for similarity lookups
CREATE INDEX idx_job_similarities_job ON job_similarities(job_id);
CREATE INDEX idx_job_similarities_score ON job_similarities(job_id, similarity_score DESC);

-- ============================================
-- MATERIALIZED VIEW: job_cosaves
-- Collaborative filtering: jobs frequently saved together
-- Refreshed periodically via cron or on-demand
-- ============================================
CREATE MATERIALIZED VIEW job_cosaves AS
SELECT
  a.job_id AS job_a,
  b.job_id AS job_b,
  COUNT(DISTINCT a.user_id) AS co_save_count,
  -- Confidence based on overlap / union (Jaccard-like)
  COUNT(DISTINCT a.user_id)::FLOAT / (
    SELECT COUNT(DISTINCT user_id)
    FROM saved_jobs
    WHERE job_id = a.job_id OR job_id = b.job_id
  ) AS confidence
FROM saved_jobs a
INNER JOIN saved_jobs b ON a.user_id = b.user_id AND a.job_id < b.job_id
GROUP BY a.job_id, b.job_id
HAVING COUNT(DISTINCT a.user_id) >= 2  -- Minimum 2 users for significance
WITH DATA;

-- Indexes on the materialized view
CREATE INDEX idx_job_cosaves_job_a ON job_cosaves(job_a);
CREATE INDEX idx_job_cosaves_job_b ON job_cosaves(job_b);
CREATE INDEX idx_job_cosaves_count ON job_cosaves(co_save_count DESC);
CREATE INDEX idx_job_cosaves_confidence ON job_cosaves(confidence DESC);

-- ============================================
-- FUNCTION: refresh_job_cosaves
-- Refresh the materialized view for collaborative filtering
-- ============================================
CREATE OR REPLACE FUNCTION refresh_job_cosaves()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY job_cosaves;
END;
$$;

-- ============================================
-- TRIGGER: Update updated_at for user_match_preferences
-- ============================================
CREATE TRIGGER update_user_match_preferences_updated_at
  BEFORE UPDATE ON user_match_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE user_match_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_behavior_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_similarities ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own match preferences
CREATE POLICY "Users manage own match preferences" ON user_match_preferences
  FOR ALL USING (auth.uid() = user_id);

-- Users can only manage their own behavior events
CREATE POLICY "Users manage own behavior events" ON user_behavior_events
  FOR ALL USING (auth.uid() = user_id);

-- Job similarities are public read (pre-computed, no user data)
CREATE POLICY "Public read job similarities" ON job_similarities
  FOR SELECT USING (true);

-- Service role can write job similarities (computed by background jobs)
CREATE POLICY "Service writes job similarities" ON job_similarities
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service updates job similarities" ON job_similarities
  FOR UPDATE USING (true);

CREATE POLICY "Service deletes job similarities" ON job_similarities
  FOR DELETE USING (true);

-- ============================================
-- DONE
-- ============================================
