-- ============================================
-- INTERVIEW QUESTIONS DATABASE
-- Comprehensive schema for storing interview questions from multiple sources
-- Designed for: filtering by company+role+date, aggregation by type, source tracking
-- ============================================

-- ============================================
-- ENUM: question_type
-- Categories of interview questions
-- ============================================
DO $$ BEGIN
  CREATE TYPE question_type AS ENUM (
    'technical_coding',      -- LeetCode-style coding problems
    'technical_conceptual',  -- CS fundamentals, language-specific
    'system_design',         -- Architecture, scalability
    'behavioral',            -- STAR method, leadership principles
    'case_study',            -- Product sense, estimation
    'take_home',             -- Take-home assignments
    'oa',                    -- Online assessment questions
    'brain_teaser',          -- Logic puzzles, probability
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- ENUM: difficulty_level
-- Question difficulty ratings
-- ============================================
DO $$ BEGIN
  CREATE TYPE difficulty_level AS ENUM (
    'easy',
    'medium',
    'hard',
    'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- TABLE: interview_sources
-- Track scraper sources and their metadata
-- ============================================
CREATE TABLE IF NOT EXISTS interview_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,                    -- 'geeksforgeeks', 'leetcode_discuss', 'dev_to'
  display_name TEXT NOT NULL,                   -- 'GeeksforGeeks', 'LeetCode Discuss', 'Dev.to'
  source_type TEXT NOT NULL,                    -- 'scraper', 'api', 'user_submitted', 'partner'
  base_url TEXT,                                -- 'https://www.geeksforgeeks.org'
  scraper_path TEXT,                            -- Path to scraper file
  is_active BOOLEAN DEFAULT true,               -- Whether we're actively scraping
  requires_auth BOOLEAN DEFAULT false,          -- Whether source requires authentication
  rate_limit_per_hour INTEGER DEFAULT 100,      -- Rate limiting config
  last_scraped_at TIMESTAMPTZ,                  -- Last successful scrape
  last_error TEXT,                              -- Last error message if failed
  total_questions_scraped INTEGER DEFAULT 0,    -- Running count
  metadata JSONB DEFAULT '{}',                  -- Additional source-specific config
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_interview_sources_active ON interview_sources(is_active) WHERE is_active = true;
CREATE INDEX idx_interview_sources_type ON interview_sources(source_type);

-- ============================================
-- TABLE: interview_questions
-- Core table for all interview questions
-- ============================================
CREATE TABLE IF NOT EXISTS interview_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Company and position linking
  company_slug TEXT REFERENCES companies(slug) ON DELETE SET NULL,
  company_name TEXT NOT NULL,                   -- Denormalized for display/search
  position TEXT,                                -- 'Software Engineer', 'Senior SWE', 'ML Engineer'
  position_level TEXT,                          -- 'new_grad', 'intern', 'mid', 'senior', 'staff'
  team TEXT,                                    -- Specific team if mentioned

  -- Question content
  question_type question_type NOT NULL DEFAULT 'other',
  question_text TEXT NOT NULL,                  -- The actual question
  question_title TEXT,                          -- Short title/summary if available
  difficulty difficulty_level DEFAULT 'unknown',

  -- Answer/solution (if available)
  answer_text TEXT,                             -- Answer or solution
  answer_approach TEXT,                         -- Approach/hints

  -- Interview context
  interview_round TEXT,                         -- 'phone_screen', 'onsite_1', 'final', 'oa'
  interview_date DATE,                          -- When the interview occurred
  interview_year INTEGER,                       -- Extracted year for filtering
  interview_month INTEGER,                      -- Extracted month for filtering
  interviewer_role TEXT,                        -- Role of interviewer if known

  -- Source tracking
  source_id UUID REFERENCES interview_sources(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,                    -- Denormalized: 'geeksforgeeks', 'reddit'
  source_url TEXT,                              -- Direct link to the source
  source_post_id TEXT,                          -- Original post/article ID
  scraped_at TIMESTAMPTZ DEFAULT NOW(),         -- When we scraped this

  -- Verification and quality
  is_verified BOOLEAN DEFAULT false,            -- Human-verified accuracy
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  confidence_score DECIMAL(3,2) DEFAULT 0.5,    -- AI confidence 0.00-1.00

  -- Engagement metrics
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  report_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,

  -- Deduplication
  content_hash TEXT,                            -- MD5 hash for deduplication
  is_duplicate BOOLEAN DEFAULT false,
  duplicate_of UUID REFERENCES interview_questions(id) ON DELETE SET NULL,

  -- Metadata
  language TEXT DEFAULT 'en',                   -- Content language
  region TEXT,                                  -- 'us', 'india', 'china', etc.
  raw_metadata JSONB DEFAULT '{}',              -- Original scraped data

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Primary indexes for common queries
CREATE INDEX idx_iq_company_slug ON interview_questions(company_slug);
CREATE INDEX idx_iq_company_name ON interview_questions(company_name);
CREATE INDEX idx_iq_company_name_lower ON interview_questions(LOWER(company_name));
CREATE INDEX idx_iq_position ON interview_questions(position);
CREATE INDEX idx_iq_position_level ON interview_questions(position_level);
CREATE INDEX idx_iq_question_type ON interview_questions(question_type);
CREATE INDEX idx_iq_difficulty ON interview_questions(difficulty);

-- Date-based filtering (critical for "past 4-5 months" queries)
CREATE INDEX idx_iq_interview_date ON interview_questions(interview_date DESC);
CREATE INDEX idx_iq_interview_year_month ON interview_questions(interview_year DESC, interview_month DESC);
CREATE INDEX idx_iq_scraped_at ON interview_questions(scraped_at DESC);

-- Composite indexes for common query patterns
CREATE INDEX idx_iq_company_date ON interview_questions(company_slug, interview_date DESC);
CREATE INDEX idx_iq_company_position_date ON interview_questions(company_slug, position, interview_date DESC);
CREATE INDEX idx_iq_company_type_date ON interview_questions(company_slug, question_type, interview_date DESC);
CREATE INDEX idx_iq_source_date ON interview_questions(source_name, scraped_at DESC);

-- Quality and verification
CREATE INDEX idx_iq_verified ON interview_questions(is_verified) WHERE is_verified = true;
CREATE INDEX idx_iq_not_duplicate ON interview_questions(is_duplicate) WHERE is_duplicate = false;
CREATE INDEX idx_iq_high_confidence ON interview_questions(confidence_score DESC) WHERE confidence_score >= 0.7;

-- Deduplication
CREATE INDEX idx_iq_content_hash ON interview_questions(content_hash);

-- Full-text search
CREATE INDEX idx_iq_question_text_search ON interview_questions USING GIN(to_tsvector('english', question_text));
CREATE INDEX idx_iq_combined_search ON interview_questions USING GIN(
  to_tsvector('english', COALESCE(question_title, '') || ' ' || question_text || ' ' || COALESCE(company_name, ''))
);

-- ============================================
-- TABLE: question_tags
-- Tags for skills, topics, and categories
-- ============================================
CREATE TABLE IF NOT EXISTS question_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,                    -- 'dynamic_programming', 'arrays', 'sql'
  display_name TEXT NOT NULL,                   -- 'Dynamic Programming', 'Arrays', 'SQL'
  category TEXT NOT NULL,                       -- 'algorithm', 'data_structure', 'language', 'concept'
  description TEXT,
  question_count INTEGER DEFAULT 0,             -- Denormalized count
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_question_tags_category ON question_tags(category);
CREATE INDEX idx_question_tags_name ON question_tags(name);

-- ============================================
-- TABLE: interview_question_tags (junction)
-- Many-to-many relationship between questions and tags
-- ============================================
CREATE TABLE IF NOT EXISTS interview_question_tags (
  question_id UUID REFERENCES interview_questions(id) ON DELETE CASCADE NOT NULL,
  tag_id UUID REFERENCES question_tags(id) ON DELETE CASCADE NOT NULL,
  confidence DECIMAL(3,2) DEFAULT 1.0,          -- Tag confidence (AI-assigned)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (question_id, tag_id)
);

CREATE INDEX idx_iqt_question ON interview_question_tags(question_id);
CREATE INDEX idx_iqt_tag ON interview_question_tags(tag_id);

-- ============================================
-- TABLE: user_question_interactions
-- Track user engagement with questions
-- ============================================
CREATE TABLE IF NOT EXISTS user_question_interactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  question_id UUID REFERENCES interview_questions(id) ON DELETE CASCADE NOT NULL,
  interaction_type TEXT NOT NULL,               -- 'view', 'upvote', 'downvote', 'save', 'report'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, question_id, interaction_type)
);

CREATE INDEX idx_uqi_user ON user_question_interactions(user_id);
CREATE INDEX idx_uqi_question ON user_question_interactions(question_id);
CREATE INDEX idx_uqi_type ON user_question_interactions(interaction_type);

-- ============================================
-- TABLE: scraper_runs
-- Track each scraper execution
-- ============================================
CREATE TABLE IF NOT EXISTS scraper_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID REFERENCES interview_sources(id) ON DELETE CASCADE NOT NULL,
  source_name TEXT NOT NULL,                    -- Denormalized
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',                -- 'running', 'completed', 'failed', 'partial'
  questions_found INTEGER DEFAULT 0,
  questions_new INTEGER DEFAULT 0,
  questions_updated INTEGER DEFAULT 0,
  questions_duplicate INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'                   -- Additional run stats
);

CREATE INDEX idx_scraper_runs_source ON scraper_runs(source_id);
CREATE INDEX idx_scraper_runs_status ON scraper_runs(status);
CREATE INDEX idx_scraper_runs_started ON scraper_runs(started_at DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- interview_questions: Public read, admin write
ALTER TABLE interview_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Interview questions are publicly readable"
  ON interview_questions FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage interview questions"
  ON interview_questions FOR ALL
  USING (auth.role() = 'service_role');

-- interview_sources: Public read, admin write
ALTER TABLE interview_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Interview sources are publicly readable"
  ON interview_sources FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage interview sources"
  ON interview_sources FOR ALL
  USING (auth.role() = 'service_role');

-- question_tags: Public read, admin write
ALTER TABLE question_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Question tags are publicly readable"
  ON question_tags FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage question tags"
  ON question_tags FOR ALL
  USING (auth.role() = 'service_role');

-- interview_question_tags: Public read, admin write
ALTER TABLE interview_question_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Question tag mappings are publicly readable"
  ON interview_question_tags FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage question tag mappings"
  ON interview_question_tags FOR ALL
  USING (auth.role() = 'service_role');

-- user_question_interactions: User owns their own data
ALTER TABLE user_question_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own interactions"
  ON user_question_interactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own interactions"
  ON user_question_interactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own interactions"
  ON user_question_interactions FOR DELETE
  USING (auth.uid() = user_id);

-- scraper_runs: Public read, admin write
ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scraper runs are publicly readable"
  ON scraper_runs FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage scraper runs"
  ON scraper_runs FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to get recent questions by company and position
CREATE OR REPLACE FUNCTION get_recent_interview_questions(
  p_company_slug TEXT DEFAULT NULL,
  p_position TEXT DEFAULT NULL,
  p_question_type question_type DEFAULT NULL,
  p_months_back INTEGER DEFAULT 5,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  company_name TEXT,
  position TEXT,
  question_type question_type,
  question_text TEXT,
  question_title TEXT,
  difficulty difficulty_level,
  interview_date DATE,
  source_name TEXT,
  source_url TEXT,
  upvotes INTEGER,
  is_verified BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    iq.id,
    iq.company_name,
    iq.position,
    iq.question_type,
    iq.question_text,
    iq.question_title,
    iq.difficulty,
    iq.interview_date,
    iq.source_name,
    iq.source_url,
    iq.upvotes,
    iq.is_verified
  FROM interview_questions iq
  WHERE
    iq.is_duplicate = false
    AND (p_company_slug IS NULL OR iq.company_slug = p_company_slug)
    AND (p_position IS NULL OR iq.position ILIKE '%' || p_position || '%')
    AND (p_question_type IS NULL OR iq.question_type = p_question_type)
    AND (
      iq.interview_date >= (CURRENT_DATE - (p_months_back * INTERVAL '1 month'))::DATE
      OR iq.scraped_at >= (CURRENT_DATE - (p_months_back * INTERVAL '1 month'))
    )
  ORDER BY
    COALESCE(iq.interview_date, iq.scraped_at::DATE) DESC,
    iq.upvotes DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get question type distribution for a company
CREATE OR REPLACE FUNCTION get_question_type_distribution(
  p_company_slug TEXT,
  p_months_back INTEGER DEFAULT 5
)
RETURNS TABLE (
  question_type question_type,
  count BIGINT,
  percentage DECIMAL(5,2)
) AS $$
BEGIN
  RETURN QUERY
  WITH counts AS (
    SELECT
      iq.question_type,
      COUNT(*) as cnt
    FROM interview_questions iq
    WHERE
      iq.company_slug = p_company_slug
      AND iq.is_duplicate = false
      AND (
        iq.interview_date >= (CURRENT_DATE - (p_months_back * INTERVAL '1 month'))::DATE
        OR iq.scraped_at >= (CURRENT_DATE - (p_months_back * INTERVAL '1 month'))
      )
    GROUP BY iq.question_type
  ),
  total AS (
    SELECT SUM(cnt) as total_count FROM counts
  )
  SELECT
    c.question_type,
    c.cnt as count,
    ROUND((c.cnt::DECIMAL / NULLIF(t.total_count, 0) * 100), 2) as percentage
  FROM counts c, total t
  ORDER BY c.cnt DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to update tag counts (trigger-based)
CREATE OR REPLACE FUNCTION update_tag_question_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE question_tags SET question_count = question_count + 1 WHERE id = NEW.tag_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE question_tags SET question_count = question_count - 1 WHERE id = OLD.tag_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_tag_count
AFTER INSERT OR DELETE ON interview_question_tags
FOR EACH ROW EXECUTE FUNCTION update_tag_question_count();

-- Function to update source scrape stats
CREATE OR REPLACE FUNCTION update_source_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE interview_sources
    SET
      total_questions_scraped = total_questions_scraped + 1,
      updated_at = NOW()
    WHERE name = NEW.source_name;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_source_stats
AFTER INSERT ON interview_questions
FOR EACH ROW EXECUTE FUNCTION update_source_stats();

-- ============================================
-- SEED DATA: Common tags
-- ============================================
INSERT INTO question_tags (name, display_name, category) VALUES
  -- Algorithm tags
  ('arrays', 'Arrays', 'data_structure'),
  ('strings', 'Strings', 'data_structure'),
  ('linked_lists', 'Linked Lists', 'data_structure'),
  ('trees', 'Trees', 'data_structure'),
  ('graphs', 'Graphs', 'data_structure'),
  ('hash_tables', 'Hash Tables', 'data_structure'),
  ('heaps', 'Heaps', 'data_structure'),
  ('stacks', 'Stacks', 'data_structure'),
  ('queues', 'Queues', 'data_structure'),
  ('tries', 'Tries', 'data_structure'),

  -- Algorithm technique tags
  ('dynamic_programming', 'Dynamic Programming', 'algorithm'),
  ('recursion', 'Recursion', 'algorithm'),
  ('backtracking', 'Backtracking', 'algorithm'),
  ('binary_search', 'Binary Search', 'algorithm'),
  ('two_pointers', 'Two Pointers', 'algorithm'),
  ('sliding_window', 'Sliding Window', 'algorithm'),
  ('greedy', 'Greedy', 'algorithm'),
  ('divide_conquer', 'Divide and Conquer', 'algorithm'),
  ('bfs', 'BFS', 'algorithm'),
  ('dfs', 'DFS', 'algorithm'),
  ('sorting', 'Sorting', 'algorithm'),
  ('bit_manipulation', 'Bit Manipulation', 'algorithm'),
  ('math', 'Math', 'algorithm'),

  -- System design tags
  ('scalability', 'Scalability', 'system_design'),
  ('distributed_systems', 'Distributed Systems', 'system_design'),
  ('databases', 'Databases', 'system_design'),
  ('caching', 'Caching', 'system_design'),
  ('load_balancing', 'Load Balancing', 'system_design'),
  ('api_design', 'API Design', 'system_design'),
  ('microservices', 'Microservices', 'system_design'),

  -- Language/technology tags
  ('python', 'Python', 'language'),
  ('java', 'Java', 'language'),
  ('javascript', 'JavaScript', 'language'),
  ('cpp', 'C++', 'language'),
  ('sql', 'SQL', 'language'),
  ('react', 'React', 'technology'),
  ('aws', 'AWS', 'technology'),

  -- Behavioral tags
  ('leadership', 'Leadership', 'behavioral'),
  ('conflict_resolution', 'Conflict Resolution', 'behavioral'),
  ('teamwork', 'Teamwork', 'behavioral'),
  ('problem_solving', 'Problem Solving', 'behavioral'),
  ('communication', 'Communication', 'behavioral')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- SEED DATA: Initial sources
-- ============================================
INSERT INTO interview_sources (name, display_name, source_type, base_url, is_active) VALUES
  ('geeksforgeeks', 'GeeksforGeeks', 'scraper', 'https://www.geeksforgeeks.org', true),
  ('leetcode_discuss', 'LeetCode Discuss', 'scraper', 'https://leetcode.com/discuss', true),
  ('dev_to', 'Dev.to', 'api', 'https://dev.to', true),
  ('hacker_news', 'Hacker News', 'api', 'https://news.ycombinator.com', true),
  ('reddit', 'Reddit', 'api', 'https://reddit.com', true),
  ('github', 'GitHub', 'api', 'https://github.com', true),
  ('glassdoor', 'Glassdoor', 'scraper', 'https://www.glassdoor.com', false),
  ('blind', 'Blind', 'scraper', 'https://www.teamblind.com', false),
  ('nowcoder', 'Nowcoder (牛客网)', 'scraper', 'https://www.nowcoder.com', true),
  ('user_submitted', 'User Submitted', 'user_submitted', NULL, true)
ON CONFLICT (name) DO NOTHING;

-- Grant access to authenticated users for interaction table
GRANT SELECT, INSERT, DELETE ON user_question_interactions TO authenticated;
GRANT SELECT ON interview_questions TO anon, authenticated;
GRANT SELECT ON interview_sources TO anon, authenticated;
GRANT SELECT ON question_tags TO anon, authenticated;
GRANT SELECT ON interview_question_tags TO anon, authenticated;
GRANT SELECT ON scraper_runs TO anon, authenticated;
