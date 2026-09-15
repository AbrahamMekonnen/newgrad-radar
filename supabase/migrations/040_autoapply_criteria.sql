-- Standing auto-apply criteria: the user picks filters once (same filters as the
-- jobs page) and every new matching job is queued + prepared automatically.
-- Company-driven auto-apply (watchlist / user_lists.auto_apply) stays separate.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS auto_apply_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_apply_min_match INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_apply_rules_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profiles.auto_apply_filters IS
  'Standing auto-apply filter set: {roles[],experience_levels[],locations[],'
  'tiers[],sources[],sponsorship,salary_min,keywords[],exclude_keywords[]}.';
COMMENT ON COLUMN user_profiles.auto_apply_rules_enabled IS
  'Master toggle for filter-based auto-apply (separate from watchlist auto-apply).';

NOTIFY pgrst, 'reload schema';
