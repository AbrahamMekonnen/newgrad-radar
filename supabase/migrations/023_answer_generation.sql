-- =============================================
-- AI Answer Generation System
-- Migration: 023_answer_generation.sql
--
-- Tables for storing STAR-formatted experiences,
-- pre-generated answers, and company-specific responses
-- =============================================

-- =============================================
-- User Story Bank
-- =============================================
-- Core experiences that power answer generation (STAR format)

CREATE TABLE user_story_bank (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Story classification
  story_type TEXT NOT NULL CHECK (story_type IN (
    'project', 'teamwork', 'conflict', 'leadership',
    'failure', 'achievement', 'technical', 'growth'
  )),

  -- Story content
  title TEXT NOT NULL,
  context TEXT CHECK (context IN (
    'internship', 'class', 'personal', 'hackathon', 'work', 'research', 'volunteer'
  )),
  organization TEXT, -- Company/school name (can be anonymized)

  -- STAR components
  situation TEXT NOT NULL,
  task TEXT NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of action statements
  results JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of {metric, value, description}

  -- Additional context
  team_size INTEGER,
  duration TEXT,
  technologies TEXT[],
  skills_demonstrated TEXT[],
  challenges_faced TEXT[],
  lessons_learned TEXT[],

  -- Question mapping
  applicable_categories TEXT[], -- Which question categories this answers
  strength_rating INTEGER CHECK (strength_rating BETWEEN 1 AND 5),

  -- Usage tracking
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  last_used_company TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user_story_bank
CREATE INDEX idx_story_bank_user ON user_story_bank(user_id);
CREATE INDEX idx_story_bank_type ON user_story_bank(user_id, story_type);
CREATE INDEX idx_story_bank_categories ON user_story_bank USING GIN(applicable_categories);
CREATE INDEX idx_story_bank_strength ON user_story_bank(user_id, strength_rating DESC);

-- Updated_at trigger
CREATE TRIGGER update_story_bank_updated_at
  BEFORE UPDATE ON user_story_bank
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Pre-Generated Answer Bank
-- =============================================
-- Cached answers generated from story bank

CREATE TABLE answer_bank (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id UUID REFERENCES user_story_bank(id) ON DELETE CASCADE,

  -- Question classification
  question_category TEXT NOT NULL CHECK (question_category IN (
    'why_company', 'why_role', 'challenging_project', 'teamwork',
    'conflict_resolution', 'failure_learning', 'leadership',
    'problem_solving', 'strengths', 'weaknesses', 'career_goals',
    'achievement', 'generic'
  )),
  word_count_target INTEGER NOT NULL CHECK (word_count_target > 0), -- 75, 150, 250, 350
  variation_index INTEGER NOT NULL DEFAULT 1, -- For multiple versions

  -- Generated content
  answer_text TEXT NOT NULL,
  answer_structure TEXT CHECK (answer_structure IN (
    'result_first', 'challenge_first', 'standard_star', 'chronological'
  )),

  -- Personalization slots
  variable_slots JSONB DEFAULT '{}'::jsonb, -- {company: null, product: null, ...}

  -- Quality metadata
  generation_model TEXT, -- 'gemini-1.5-flash', 'gpt-4', etc.
  generation_prompt_version TEXT,

  -- Usage tracking
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(story_id, question_category, word_count_target, variation_index)
);

-- Indexes for answer_bank
CREATE INDEX idx_answer_bank_user ON answer_bank(user_id);
CREATE INDEX idx_answer_bank_category ON answer_bank(user_id, question_category);
CREATE INDEX idx_answer_bank_lookup ON answer_bank(user_id, question_category, word_count_target);

-- =============================================
-- Company-Specific Answers
-- =============================================
-- Personalized "Why Company" answers

CREATE TABLE company_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Company info
  company_slug TEXT NOT NULL,
  company_name TEXT NOT NULL,

  -- Pre-generated answers by length
  why_company_short TEXT, -- 75 words
  why_company_standard TEXT, -- 150 words
  why_company_long TEXT, -- 300 words

  -- Context used for generation
  company_mission TEXT,
  company_products TEXT[],
  recent_news TEXT[],
  user_connection TEXT, -- Personal reason
  relevant_experience TEXT, -- From story bank

  -- Metadata
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  generation_model TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, company_slug)
);

-- Indexes for company_answers
CREATE INDEX idx_company_answers_user ON company_answers(user_id);
CREATE INDEX idx_company_answers_company ON company_answers(company_slug);
CREATE INDEX idx_company_answers_lookup ON company_answers(user_id, company_slug);

-- Updated_at trigger
CREATE TRIGGER update_company_answers_updated_at
  BEFORE UPDATE ON company_answers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Generation History (for debugging/improvement)
-- =============================================

CREATE TABLE generation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Request
  request_type TEXT CHECK (request_type IN (
    'bulk_stories', 'company_specific', 'single_question', 'regenerate'
  )),
  input_data JSONB,
  prompt_used TEXT,

  -- Response
  model_used TEXT,
  tokens_used INTEGER,
  generation_time_ms INTEGER,
  output_data JSONB,

  -- Status
  success BOOLEAN DEFAULT true,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for generation_log
CREATE INDEX idx_generation_log_user ON generation_log(user_id);
CREATE INDEX idx_generation_log_type ON generation_log(user_id, request_type);
CREATE INDEX idx_generation_log_created ON generation_log(created_at DESC);

-- =============================================
-- Row Level Security (RLS) Policies
-- =============================================

-- Enable RLS on all tables
ALTER TABLE user_story_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_log ENABLE ROW LEVEL SECURITY;

-- user_story_bank policies
CREATE POLICY "Users can view own stories"
  ON user_story_bank FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stories"
  ON user_story_bank FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stories"
  ON user_story_bank FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own stories"
  ON user_story_bank FOR DELETE
  USING (auth.uid() = user_id);

-- answer_bank policies
CREATE POLICY "Users can view own answers"
  ON answer_bank FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own answers"
  ON answer_bank FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own answers"
  ON answer_bank FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own answers"
  ON answer_bank FOR DELETE
  USING (auth.uid() = user_id);

-- company_answers policies
CREATE POLICY "Users can view own company answers"
  ON company_answers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own company answers"
  ON company_answers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own company answers"
  ON company_answers FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own company answers"
  ON company_answers FOR DELETE
  USING (auth.uid() = user_id);

-- generation_log policies
CREATE POLICY "Users can view own generation logs"
  ON generation_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generation logs"
  ON generation_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- generation_log is append-only for users (no update/delete)

-- =============================================
-- Comments for documentation
-- =============================================

COMMENT ON TABLE user_story_bank IS 'STAR-formatted experiences used for answer generation';
COMMENT ON TABLE answer_bank IS 'Pre-generated answers cached from LLM generation';
COMMENT ON TABLE company_answers IS 'Company-specific "Why this company?" answers';
COMMENT ON TABLE generation_log IS 'Debug log for LLM answer generation requests';

COMMENT ON COLUMN user_story_bank.story_type IS 'Category: project, teamwork, conflict, leadership, failure, achievement, technical, growth';
COMMENT ON COLUMN user_story_bank.actions IS 'JSON array of action statements taken';
COMMENT ON COLUMN user_story_bank.results IS 'JSON array of {metric, value, description} outcomes';
COMMENT ON COLUMN user_story_bank.applicable_categories IS 'Question categories this story can answer';

COMMENT ON COLUMN answer_bank.question_category IS 'Type of question this answer addresses';
COMMENT ON COLUMN answer_bank.word_count_target IS 'Target word count: 75 (short), 150 (standard), 300 (long)';
COMMENT ON COLUMN answer_bank.variable_slots IS 'Runtime variables: {company}, {product}, {role}, etc.';

COMMENT ON COLUMN company_answers.company_slug IS 'URL-safe company identifier';
COMMENT ON COLUMN company_answers.user_connection IS 'Personal reason for interest in this company';
