-- Migration: 061_profile_experience_sections
-- Store the candidate's FULL structured history on the auto-apply profile, not
-- just the latest company/title + prior-employer names. ATS forms frequently ask
-- applicants to re-enter each job (company, title, dates, location, description)
-- and each school in detail; keeping the full parsed résumé lets auto-apply fill
-- those repeated sections instead of the user copy-pasting from their résumé.
--
-- Stored as jsonb arrays of objects (shape mirrors the résumé parser output):
--   work_experience:   [{ company, title, location, start_date, end_date, current, bullets[] }]
--   education_history:  [{ school, degree, major, location, start_date, end_date, gpa }]
--   projects:           [{ name, technologies, date, bullets[] }]
--   skills_list:        [{ category, items[] }]
-- All nullable; the existing flat fields (current_company, education_school, …)
-- stay for the simple single-value questions.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS work_experience   jsonb,
  ADD COLUMN IF NOT EXISTS education_history jsonb,
  ADD COLUMN IF NOT EXISTS projects          jsonb,
  ADD COLUMN IF NOT EXISTS skills_list       jsonb;

COMMENT ON COLUMN user_profiles.work_experience   IS 'Full work history: [{company,title,location,start_date,end_date,current,bullets[]}]';
COMMENT ON COLUMN user_profiles.education_history  IS 'Full education: [{school,degree,major,location,start_date,end_date,gpa}]';
COMMENT ON COLUMN user_profiles.projects           IS 'Projects: [{name,technologies,date,bullets[]}]';
COMMENT ON COLUMN user_profiles.skills_list        IS 'Skills grouped: [{category,items[]}]';
