-- ============================================
-- Migration: Salary & Availability Preferences
-- Enhanced salary expectations and availability
-- settings for the auto-apply feature
-- ============================================

-- ============================================
-- SALARY PREFERENCES
-- Add structured salary fields to user_profiles
-- ============================================

-- How to handle salary questions in applications
-- 'range' = Show min-max range
-- 'specific' = Show single target number
-- 'negotiable' = Mark as negotiable/open
-- 'market_rate' = Leave for market research to decide
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_type TEXT DEFAULT 'range'
CHECK (salary_type IN ('range', 'specific', 'negotiable', 'market_rate'));

-- Salary range (annual)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_min INTEGER;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_max INTEGER;

-- Single target salary (for 'specific' type)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_target INTEGER;

-- How firm the salary requirement is
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_flexibility TEXT DEFAULT 'somewhat_flexible'
CHECK (salary_flexibility IN ('firm', 'somewhat_flexible', 'very_flexible'));

-- What components are included in the stated salary
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_includes TEXT[] DEFAULT ARRAY['base'];

-- How to fill salary fields in applications
-- 'show_range' = Enter min-max or "X - Y"
-- 'show_target' = Enter single number
-- 'show_negotiable' = Enter "negotiable" or "open"
-- 'leave_blank' = Skip/leave empty when possible
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_display_strategy TEXT DEFAULT 'show_range'
CHECK (salary_display_strategy IN ('show_range', 'show_target', 'show_negotiable', 'leave_blank'));

-- Hourly rates (for part-time/contract positions)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS hourly_rate_min NUMERIC(10,2);

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS hourly_rate_max NUMERIC(10,2);

-- Auto-adjust salary based on job location
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_location_adjusted BOOLEAN DEFAULT false;

-- Base location for salary expectations (e.g., "San Francisco, CA")
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS salary_base_location TEXT;

-- ============================================
-- AVAILABILITY PREFERENCES
-- Start date, hours, work mode, relocation
-- ============================================

-- Start date type
-- 'immediate' = Available within 2 weeks
-- 'specific' = Specific date set
-- 'after_graduation' = After graduation_date
-- 'flexible' = Open to discussion
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS start_date_type TEXT DEFAULT 'flexible'
CHECK (start_date_type IN ('immediate', 'specific', 'after_graduation', 'flexible'));

-- Earliest possible start date
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS start_date_earliest DATE;

-- Preferred start date (for 'specific' type)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS start_date_preferred DATE;

-- Expected graduation date (for students)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS graduation_date DATE;

-- Notice period for current job (weeks)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS notice_period_weeks INTEGER;

-- Available hours per week (for part-time/contract)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS hours_per_week_min INTEGER DEFAULT 40;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS hours_per_week_max INTEGER DEFAULT 40;

-- Preferred work schedule
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS preferred_work_schedule TEXT DEFAULT 'standard'
CHECK (preferred_work_schedule IN ('standard', 'flexible', 'shift', 'any'));

-- Work mode preference
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS work_mode_preference TEXT DEFAULT 'any'
CHECK (work_mode_preference IN ('remote', 'hybrid', 'onsite', 'any'));

-- For hybrid, how many days in office preferred
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS hybrid_days_in_office INTEGER
CHECK (hybrid_days_in_office IS NULL OR (hybrid_days_in_office >= 0 AND hybrid_days_in_office <= 7));

-- On-call availability
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS available_for_oncall BOOLEAN;

-- Willingness to travel
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS willing_to_travel BOOLEAN;

-- Maximum travel percentage (0-100)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS travel_percentage_max INTEGER
CHECK (travel_percentage_max IS NULL OR (travel_percentage_max >= 0 AND travel_percentage_max <= 100));

-- Relocation: requires relocation package
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS relocation_requires_package BOOLEAN DEFAULT false;

-- Preferred relocation destinations
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS relocation_preferred_locations TEXT[] DEFAULT '{}';

-- Locations to avoid
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS relocation_excluded_locations TEXT[] DEFAULT '{}';

-- ============================================
-- CONSTRAINTS
-- ============================================

-- Ensure salary_min <= salary_max when both are set
ALTER TABLE user_profiles
ADD CONSTRAINT valid_salary_range
CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max);

-- Ensure hourly rate min <= max when both are set
ALTER TABLE user_profiles
ADD CONSTRAINT valid_hourly_rate_range
CHECK (hourly_rate_min IS NULL OR hourly_rate_max IS NULL OR hourly_rate_min <= hourly_rate_max);

-- Ensure hours_per_week_min <= max
ALTER TABLE user_profiles
ADD CONSTRAINT valid_hours_range
CHECK (hours_per_week_min IS NULL OR hours_per_week_max IS NULL OR hours_per_week_min <= hours_per_week_max);

-- Ensure earliest start date is not after preferred
ALTER TABLE user_profiles
ADD CONSTRAINT valid_start_dates
CHECK (start_date_earliest IS NULL OR start_date_preferred IS NULL OR start_date_earliest <= start_date_preferred);

-- ============================================
-- INDEXES
-- ============================================

-- Index for filtering by salary preferences
CREATE INDEX IF NOT EXISTS idx_user_profiles_salary_type
ON user_profiles(salary_type) WHERE salary_type IS NOT NULL;

-- Index for filtering by work mode preference
CREATE INDEX IF NOT EXISTS idx_user_profiles_work_mode
ON user_profiles(work_mode_preference) WHERE work_mode_preference IS NOT NULL;

-- Index for filtering by relocation willingness
CREATE INDEX IF NOT EXISTS idx_user_profiles_relocation
ON user_profiles(willing_to_relocate) WHERE willing_to_relocate = true;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Calculate effective start date based on user preferences
CREATE OR REPLACE FUNCTION calculate_effective_start_date(p_user_id UUID)
RETURNS DATE AS $$
DECLARE
  v_start_type TEXT;
  v_earliest DATE;
  v_preferred DATE;
  v_graduation DATE;
  v_notice_weeks INTEGER;
  v_result DATE;
BEGIN
  SELECT
    start_date_type,
    start_date_earliest,
    start_date_preferred,
    graduation_date,
    notice_period_weeks
  INTO
    v_start_type,
    v_earliest,
    v_preferred,
    v_graduation,
    v_notice_weeks
  FROM user_profiles
  WHERE user_id = p_user_id;

  CASE v_start_type
    WHEN 'immediate' THEN
      v_result := CURRENT_DATE + INTERVAL '14 days';
    WHEN 'specific' THEN
      v_result := COALESCE(v_preferred, CURRENT_DATE + INTERVAL '28 days');
    WHEN 'after_graduation' THEN
      v_result := COALESCE(v_graduation + INTERVAL '14 days', CURRENT_DATE + INTERVAL '180 days');
    ELSE -- 'flexible'
      v_result := GREATEST(
        COALESCE(v_earliest, CURRENT_DATE + INTERVAL '14 days'),
        CURRENT_DATE + COALESCE(v_notice_weeks, 2) * INTERVAL '7 days'
      );
  END CASE;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Get formatted salary for display
CREATE OR REPLACE FUNCTION format_salary_preference(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_type TEXT;
  v_min INTEGER;
  v_max INTEGER;
  v_target INTEGER;
  v_strategy TEXT;
BEGIN
  SELECT
    salary_type,
    salary_min,
    salary_max,
    salary_target,
    salary_display_strategy
  INTO
    v_type,
    v_min,
    v_max,
    v_target,
    v_strategy
  FROM user_profiles
  WHERE user_id = p_user_id;

  IF v_strategy = 'leave_blank' THEN
    RETURN NULL;
  ELSIF v_strategy = 'show_negotiable' OR v_type = 'negotiable' THEN
    RETURN 'Open to discussion based on total compensation';
  ELSIF v_type = 'specific' AND v_target IS NOT NULL THEN
    RETURN '$' || TO_CHAR(v_target, 'FM999,999');
  ELSIF v_min IS NOT NULL AND v_max IS NOT NULL THEN
    RETURN '$' || TO_CHAR(v_min, 'FM999,999') || ' - $' || TO_CHAR(v_max, 'FM999,999');
  ELSIF v_min IS NOT NULL THEN
    RETURN '$' || TO_CHAR(v_min, 'FM999,999') || '+';
  ELSIF v_max IS NOT NULL THEN
    RETURN 'Up to $' || TO_CHAR(v_max, 'FM999,999');
  ELSE
    RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Check if job location is excluded for relocation
CREATE OR REPLACE FUNCTION is_location_excluded(
  p_user_id UUID,
  p_job_location TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_excluded TEXT[];
  v_loc TEXT;
BEGIN
  SELECT relocation_excluded_locations
  INTO v_excluded
  FROM user_profiles
  WHERE user_id = p_user_id;

  IF v_excluded IS NULL OR array_length(v_excluded, 1) IS NULL THEN
    RETURN false;
  END IF;

  FOREACH v_loc IN ARRAY v_excluded LOOP
    IF LOWER(p_job_location) LIKE '%' || LOWER(v_loc) || '%' THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- MIGRATION: Copy existing salary_expectation to new fields
-- Attempts to parse existing text-based salary expectations
-- ============================================

-- Parse existing salary_expectation text and populate new structured fields
-- This is a best-effort migration for common formats like "$120,000 - $150,000"
DO $$
DECLARE
  r RECORD;
  v_min INTEGER;
  v_max INTEGER;
  v_clean TEXT;
BEGIN
  FOR r IN
    SELECT user_id, salary_expectation
    FROM user_profiles
    WHERE salary_expectation IS NOT NULL
      AND salary_min IS NULL
      AND salary_max IS NULL
  LOOP
    -- Clean the string: remove $, commas, K suffix
    v_clean := UPPER(TRIM(r.salary_expectation));
    v_clean := REPLACE(REPLACE(REPLACE(v_clean, '$', ''), ',', ''), ' ', '');

    -- Try to parse "XXX-YYY" or "XXX - YYY" format
    IF v_clean ~ '^[0-9]+K?[-–][0-9]+K?$' THEN
      -- Extract min and max
      v_min := REGEXP_REPLACE(SPLIT_PART(v_clean, '-', 1), '[^0-9]', '', 'g')::INTEGER;
      v_max := REGEXP_REPLACE(SPLIT_PART(v_clean, '-', 2), '[^0-9]', '', 'g')::INTEGER;

      -- Convert K notation (120K -> 120000)
      IF SPLIT_PART(v_clean, '-', 1) ~ 'K$' AND v_min < 1000 THEN
        v_min := v_min * 1000;
      END IF;
      IF SPLIT_PART(v_clean, '-', 2) ~ 'K$' AND v_max < 1000 THEN
        v_max := v_max * 1000;
      END IF;

      -- Update the record
      UPDATE user_profiles
      SET
        salary_min = v_min,
        salary_max = v_max,
        salary_type = 'range'
      WHERE user_id = r.user_id;

    -- Try to parse single number "XXX" or "XXXK"
    ELSIF v_clean ~ '^[0-9]+K?$' THEN
      v_min := REGEXP_REPLACE(v_clean, '[^0-9]', '', 'g')::INTEGER;

      IF v_clean ~ 'K$' AND v_min < 1000 THEN
        v_min := v_min * 1000;
      END IF;

      UPDATE user_profiles
      SET
        salary_target = v_min,
        salary_type = 'specific'
      WHERE user_id = r.user_id;

    -- Check for "negotiable" or "open"
    ELSIF v_clean ~ 'NEGOTI|OPEN|FLEX' THEN
      UPDATE user_profiles
      SET salary_type = 'negotiable'
      WHERE user_id = r.user_id;
    END IF;
  END LOOP;
END;
$$;

-- ============================================
-- DONE
-- ============================================
