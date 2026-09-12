-- =============================================================================
-- Migration: 023_user_story_bank
-- Description: Create user_story_bank table for storing STAR interview stories
-- =============================================================================

-- Story type enum
CREATE TYPE story_type AS ENUM (
  'project',
  'teamwork',
  'leadership',
  'failure',
  'conflict',
  'challenge',
  'achievement',
  'initiative',
  'learning',
  'problem_solving'
);

-- User Story Bank table
CREATE TABLE IF NOT EXISTS user_story_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Story metadata
  title TEXT NOT NULL,
  story_type story_type NOT NULL DEFAULT 'project',

  -- STAR components
  situation TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',

  -- Tags and categorization
  technologies TEXT[] NOT NULL DEFAULT '{}',
  skills TEXT[] NOT NULL DEFAULT '{}',

  -- Quality rating (1-5)
  strength_rating INTEGER NOT NULL DEFAULT 3 CHECK (strength_rating >= 1 AND strength_rating <= 5),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX idx_story_bank_user_id ON user_story_bank(user_id);
CREATE INDEX idx_story_bank_story_type ON user_story_bank(story_type);
CREATE INDEX idx_story_bank_strength_rating ON user_story_bank(strength_rating);
CREATE INDEX idx_story_bank_technologies ON user_story_bank USING gin(technologies);
CREATE INDEX idx_story_bank_skills ON user_story_bank USING gin(skills);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_story_bank_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_story_bank_updated_at
  BEFORE UPDATE ON user_story_bank
  FOR EACH ROW
  EXECUTE FUNCTION update_story_bank_updated_at();

-- Row Level Security
ALTER TABLE user_story_bank ENABLE ROW LEVEL SECURITY;

-- Users can only see and modify their own stories
CREATE POLICY "Users can view own stories"
  ON user_story_bank
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stories"
  ON user_story_bank
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stories"
  ON user_story_bank
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own stories"
  ON user_story_bank
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comments for documentation
COMMENT ON TABLE user_story_bank IS 'Stores STAR interview stories for behavioral interview preparation';
COMMENT ON COLUMN user_story_bank.title IS 'Short memorable title for the story';
COMMENT ON COLUMN user_story_bank.story_type IS 'Category of the story for matching to interview questions';
COMMENT ON COLUMN user_story_bank.situation IS 'STAR: Context and background';
COMMENT ON COLUMN user_story_bank.task IS 'STAR: The specific responsibility or challenge';
COMMENT ON COLUMN user_story_bank.action IS 'STAR: Actions taken to address the task';
COMMENT ON COLUMN user_story_bank.result IS 'STAR: Outcomes and learnings';
COMMENT ON COLUMN user_story_bank.technologies IS 'Technologies/tools used in the story';
COMMENT ON COLUMN user_story_bank.skills IS 'Soft skills demonstrated in the story';
COMMENT ON COLUMN user_story_bank.strength_rating IS 'Self-assessed confidence level (1-5)';
