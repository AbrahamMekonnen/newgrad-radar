-- ============================================
-- Migration: User Education History
-- Stores education records for auto-apply
-- Supports multiple degrees per user
-- ============================================

-- ============================================
-- TABLE: user_education
-- Education history for auto-apply feature
-- ============================================
CREATE TABLE user_education (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Display order (1 = primary/most recent)
  display_order INTEGER DEFAULT 1,

  -- School Information
  school_name TEXT NOT NULL,
  school_location TEXT,               -- "Berkeley, CA"
  school_country TEXT DEFAULT 'US',   -- ISO country code

  -- Degree Information
  degree_type TEXT NOT NULL,          -- 'bachelors', 'masters', 'doctorate', 'bootcamp', etc.
  degree_name TEXT,                   -- "Bachelor of Science" (full form for display)
  major TEXT NOT NULL,
  minor TEXT,
  concentration TEXT,

  -- Dates (stored as TEXT for flexibility: YYYY-MM format)
  start_date TEXT,                    -- '2020-08'
  end_date TEXT,                      -- '2024-05' or 'present'
  graduation_status TEXT DEFAULT 'completed',  -- 'completed', 'in_progress', 'expected'

  -- GPA
  gpa DECIMAL(5,2),                   -- Supports 4.0, 10.0, or percentage
  gpa_scale DECIMAL(5,1) DEFAULT 4.0, -- 4.0, 5.0, 10.0, 100
  major_gpa DECIMAL(5,2),
  show_gpa BOOLEAN DEFAULT true,      -- User preference to show/hide

  -- Honors & Achievements
  honors TEXT,                        -- 'Cum Laude', 'Magna Cum Laude', 'Summa Cum Laude'
  deans_list BOOLEAN DEFAULT false,
  deans_list_semesters INTEGER,

  -- Additional
  relevant_coursework TEXT[],         -- Array of course names
  thesis_title TEXT,
  awards TEXT[],                      -- Array of award names

  -- Flags
  is_primary BOOLEAN DEFAULT false,   -- Primary degree for applications

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_degree_type CHECK (degree_type IN (
    'high_school', 'associates', 'bachelors', 'masters',
    'doctorate', 'bootcamp', 'certificate', 'other'
  )),
  CONSTRAINT valid_graduation_status CHECK (graduation_status IN (
    'completed', 'in_progress', 'expected'
  )),
  CONSTRAINT valid_gpa_scale CHECK (gpa_scale IN (4.0, 5.0, 10.0, 100)),
  CONSTRAINT valid_gpa CHECK (gpa IS NULL OR (gpa >= 0 AND gpa <= gpa_scale))
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_user_education_user ON user_education(user_id);
CREATE INDEX idx_user_education_primary ON user_education(user_id, is_primary) WHERE is_primary = true;
CREATE INDEX idx_user_education_order ON user_education(user_id, display_order);
CREATE INDEX idx_user_education_degree_type ON user_education(degree_type);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE user_education ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own education records
CREATE POLICY "Users manage own education" ON user_education
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE TRIGGER update_user_education_updated_at
  BEFORE UPDATE ON user_education
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Ensure only one primary education per user
CREATE OR REPLACE FUNCTION ensure_single_primary_education()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE user_education
    SET is_primary = false
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_primary_education_trigger
  BEFORE INSERT OR UPDATE ON user_education
  FOR EACH ROW
  WHEN (NEW.is_primary = true)
  EXECUTE FUNCTION ensure_single_primary_education();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get primary education for a user (for auto-apply)
CREATE OR REPLACE FUNCTION get_primary_education(p_user_id UUID)
RETURNS TABLE (
  school_name TEXT,
  degree_type TEXT,
  degree_name TEXT,
  major TEXT,
  minor TEXT,
  end_date TEXT,
  gpa DECIMAL(5,2),
  gpa_scale DECIMAL(5,1),
  show_gpa BOOLEAN,
  honors TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ue.school_name,
    ue.degree_type,
    ue.degree_name,
    ue.major,
    ue.minor,
    ue.end_date,
    ue.gpa,
    ue.gpa_scale,
    ue.show_gpa,
    ue.honors
  FROM user_education ue
  WHERE ue.user_id = p_user_id
  ORDER BY ue.is_primary DESC, ue.display_order ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- MIGRATION: Copy existing education from user_profiles
-- (If custom_answers contains education data)
-- ============================================

-- This migration preserves any existing education data
-- Manual migration may be needed if education was stored in custom_answers

-- ============================================
-- SAMPLE DATA (for testing)
-- ============================================
-- INSERT INTO user_education (
--   user_id,
--   school_name,
--   school_location,
--   degree_type,
--   degree_name,
--   major,
--   minor,
--   start_date,
--   end_date,
--   graduation_status,
--   gpa,
--   gpa_scale,
--   show_gpa,
--   honors,
--   deans_list,
--   deans_list_semesters,
--   relevant_coursework,
--   is_primary
-- ) VALUES (
--   'user-uuid-here',
--   'University of California, Berkeley',
--   'Berkeley, CA',
--   'bachelors',
--   'Bachelor of Science',
--   'Computer Science',
--   'Mathematics',
--   '2020-08',
--   '2024-05',
--   'completed',
--   3.75,
--   4.0,
--   true,
--   'Magna Cum Laude',
--   true,
--   6,
--   ARRAY['Machine Learning', 'Distributed Systems', 'Algorithms'],
--   true
-- );

-- ============================================
-- DONE
-- ============================================
