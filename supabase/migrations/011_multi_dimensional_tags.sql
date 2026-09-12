-- ============================================
-- MULTI-DIMENSIONAL TAGGING SYSTEM
-- Migration 011: Tags, badges, and discovery sources
-- ============================================

-- ============================================
-- TABLE: tag_registry
-- Central registry for all tag types with metadata
-- ============================================
CREATE TABLE IF NOT EXISTS tag_registry (
  id TEXT PRIMARY KEY,                      -- Unique identifier: "ghc_sponsor", "remote", "just_funded"
  category TEXT NOT NULL,                   -- "discovery_source", "diversity", "work_mode", "badge"
  name TEXT NOT NULL,                       -- Human-readable: "Grace Hopper Sponsor"
  color_light TEXT NOT NULL,                -- Tailwind classes for light mode
  color_dark TEXT NOT NULL,                 -- Tailwind classes for dark mode
  icon TEXT,                                -- Lucide icon name or emoji
  priority INTEGER DEFAULT 0,               -- Sort order within category (higher = first)
  parent_id TEXT REFERENCES tag_registry(id), -- For hierarchical tags
  is_active BOOLEAN DEFAULT true,           -- Soft delete / disable
  description TEXT,                         -- Tooltip / help text
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tag_registry_category ON tag_registry(category);
CREATE INDEX idx_tag_registry_active ON tag_registry(is_active) WHERE is_active = true;
CREATE INDEX idx_tag_registry_parent ON tag_registry(parent_id) WHERE parent_id IS NOT NULL;

-- ============================================
-- ADD TAG COLUMNS TO JOBS TABLE
-- ============================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS discovery_sources TEXT[] DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS diversity_tags TEXT[] DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_modes TEXT[] DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS badges TEXT[] DEFAULT '{}';

-- Add comments for documentation
COMMENT ON COLUMN jobs.discovery_sources IS 'Where the job was discovered: greenhouse, lever, simplify, etc.';
COMMENT ON COLUMN jobs.diversity_tags IS 'DEI-related tags: ghc_sponsor, nsbe_sponsor, etc.';
COMMENT ON COLUMN jobs.work_modes IS 'Work arrangement: remote, hybrid, onsite, flexible';
COMMENT ON COLUMN jobs.badges IS 'Special badges: just_funded, hot_hiring, yc_w26, etc.';

-- ============================================
-- GIN INDEXES FOR EFFICIENT ARRAY QUERIES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_jobs_discovery_sources ON jobs USING GIN(discovery_sources);
CREATE INDEX IF NOT EXISTS idx_jobs_diversity_tags ON jobs USING GIN(diversity_tags);
CREATE INDEX IF NOT EXISTS idx_jobs_work_modes ON jobs USING GIN(work_modes);
CREATE INDEX IF NOT EXISTS idx_jobs_badges ON jobs USING GIN(badges);

-- ============================================
-- SEED DATA: DISCOVERY SOURCES
-- Where jobs are discovered/aggregated from
-- ============================================
INSERT INTO tag_registry (id, category, name, color_light, color_dark, icon, priority, description) VALUES
  -- ATS Systems
  ('greenhouse', 'discovery_source', 'Greenhouse', 'bg-green-100 text-green-800', 'bg-green-900 text-green-200', 'leaf', 100, 'Greenhouse ATS direct integration'),
  ('lever', 'discovery_source', 'Lever', 'bg-blue-100 text-blue-800', 'bg-blue-900 text-blue-200', 'toggle-left', 99, 'Lever ATS direct integration'),
  ('ashby', 'discovery_source', 'Ashby', 'bg-purple-100 text-purple-800', 'bg-purple-900 text-purple-200', 'box', 98, 'Ashby ATS direct integration'),
  ('workday', 'discovery_source', 'Workday', 'bg-orange-100 text-orange-800', 'bg-orange-900 text-orange-200', 'building', 97, 'Workday ATS integration'),

  -- Job Boards & Aggregators
  ('linkedin', 'discovery_source', 'LinkedIn', 'bg-sky-100 text-sky-800', 'bg-sky-900 text-sky-200', 'linkedin', 90, 'LinkedIn Jobs'),
  ('indeed', 'discovery_source', 'Indeed', 'bg-indigo-100 text-indigo-800', 'bg-indigo-900 text-indigo-200', 'search', 89, 'Indeed job listings'),
  ('simplify', 'discovery_source', 'Simplify', 'bg-cyan-100 text-cyan-800', 'bg-cyan-900 text-cyan-200', 'zap', 88, 'Simplify.jobs aggregator'),
  ('adzuna', 'discovery_source', 'Adzuna', 'bg-lime-100 text-lime-800', 'bg-lime-900 text-lime-200', 'globe', 87, 'Adzuna job search'),

  -- VC Portfolio & Startup Lists
  ('a16z', 'discovery_source', 'a16z Portfolio', 'bg-rose-100 text-rose-800', 'bg-rose-900 text-rose-200', 'trending-up', 80, 'Andreessen Horowitz portfolio companies'),
  ('sequoia', 'discovery_source', 'Sequoia Portfolio', 'bg-red-100 text-red-800', 'bg-red-900 text-red-200', 'tree-pine', 79, 'Sequoia Capital portfolio companies'),
  ('yc_jobs', 'discovery_source', 'YC Jobs', 'bg-orange-100 text-orange-800', 'bg-orange-900 text-orange-200', 'rocket', 78, 'Y Combinator Work at a Startup'),

  -- Community & Events
  ('conference', 'discovery_source', 'Conference', 'bg-violet-100 text-violet-800', 'bg-violet-900 text-violet-200', 'calendar', 70, 'Career fair or conference'),
  ('hackathon', 'discovery_source', 'Hackathon', 'bg-amber-100 text-amber-800', 'bg-amber-900 text-amber-200', 'code', 69, 'Discovered at hackathon'),
  ('newsletter', 'discovery_source', 'Newsletter', 'bg-teal-100 text-teal-800', 'bg-teal-900 text-teal-200', 'mail', 68, 'Job newsletter or digest'),
  ('hn', 'discovery_source', 'Hacker News', 'bg-orange-100 text-orange-800', 'bg-orange-900 text-orange-200', 'message-square', 67, 'HN Who is Hiring'),

  -- Government
  ('usajobs', 'discovery_source', 'USAJobs', 'bg-blue-100 text-blue-800', 'bg-blue-900 text-blue-200', 'flag', 60, 'Federal government jobs')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  color_light = EXCLUDED.color_light,
  color_dark = EXCLUDED.color_dark,
  icon = EXCLUDED.icon,
  priority = EXCLUDED.priority,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ============================================
-- SEED DATA: DIVERSITY TAGS
-- DEI programs, sponsorships, and partnerships
-- Using gradient colors for visual distinction
-- ============================================
INSERT INTO tag_registry (id, category, name, color_light, color_dark, icon, priority, description) VALUES
  -- Major Conference Sponsors
  ('ghc_sponsor', 'diversity', 'GHC Sponsor', 'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white', 'bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white', 'heart', 100, 'Grace Hopper Celebration sponsor - supports women in computing'),
  ('tapia_sponsor', 'diversity', 'Tapia Sponsor', 'bg-gradient-to-r from-amber-500 to-orange-500 text-white', 'bg-gradient-to-r from-amber-600 to-orange-600 text-white', 'star', 99, 'ACM Richard Tapia Conference sponsor - celebrates diversity in computing'),
  ('nsbe_sponsor', 'diversity', 'NSBE Sponsor', 'bg-gradient-to-r from-yellow-500 to-amber-500 text-black', 'bg-gradient-to-r from-yellow-600 to-amber-600 text-black', 'users', 98, 'National Society of Black Engineers sponsor'),
  ('shpe_sponsor', 'diversity', 'SHPE Sponsor', 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white', 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white', 'globe-2', 97, 'Society of Hispanic Professional Engineers sponsor'),
  ('afrotech_sponsor', 'diversity', 'AfroTech Sponsor', 'bg-gradient-to-r from-purple-500 to-violet-500 text-white', 'bg-gradient-to-r from-purple-600 to-violet-600 text-white', 'sparkles', 96, 'AfroTech Conference sponsor'),

  -- Partnerships & Programs
  ('hbcu_partner', 'diversity', 'HBCU Partner', 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white', 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white', 'graduation-cap', 90, 'Partners with Historically Black Colleges and Universities'),
  ('mlh_partner', 'diversity', 'MLH Partner', 'bg-gradient-to-r from-red-500 to-rose-500 text-white', 'bg-gradient-to-r from-red-600 to-rose-600 text-white', 'trophy', 89, 'Major League Hacking partner company'),
  ('women_in_tech', 'diversity', 'Women in Tech', 'bg-gradient-to-r from-pink-500 to-rose-500 text-white', 'bg-gradient-to-r from-pink-600 to-rose-600 text-white', 'heart-handshake', 88, 'Active Women in Tech initiatives'),
  ('dei_committed', 'diversity', 'DEI Committed', 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white', 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white', 'badge-check', 85, 'Publicly committed to diversity, equity, and inclusion')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  color_light = EXCLUDED.color_light,
  color_dark = EXCLUDED.color_dark,
  icon = EXCLUDED.icon,
  priority = EXCLUDED.priority,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ============================================
-- SEED DATA: WORK MODES
-- Remote, hybrid, onsite flexibility
-- ============================================
INSERT INTO tag_registry (id, category, name, color_light, color_dark, icon, priority, description) VALUES
  ('remote', 'work_mode', 'Remote', 'bg-green-100 text-green-800', 'bg-green-900 text-green-200', 'home', 100, 'Fully remote position'),
  ('hybrid', 'work_mode', 'Hybrid', 'bg-blue-100 text-blue-800', 'bg-blue-900 text-blue-200', 'building-2', 90, 'Mix of remote and in-office'),
  ('onsite', 'work_mode', 'Onsite', 'bg-gray-100 text-gray-800', 'bg-gray-800 text-gray-200', 'map-pin', 80, 'In-office required'),
  ('flexible', 'work_mode', 'Flexible', 'bg-purple-100 text-purple-800', 'bg-purple-900 text-purple-200', 'shuffle', 70, 'Flexible work arrangement')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  color_light = EXCLUDED.color_light,
  color_dark = EXCLUDED.color_dark,
  icon = EXCLUDED.icon,
  priority = EXCLUDED.priority,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ============================================
-- SEED DATA: BADGES
-- Special recognition and status indicators
-- ============================================
INSERT INTO tag_registry (id, category, name, color_light, color_dark, icon, priority, description) VALUES
  -- Funding & Growth
  ('just_funded', 'badge', 'Just Funded', 'bg-gradient-to-r from-green-400 to-emerald-500 text-white', 'bg-gradient-to-r from-green-500 to-emerald-600 text-white', 'banknote', 100, 'Recently raised funding round'),
  ('hot_hiring', 'badge', 'Hot Hiring', 'bg-gradient-to-r from-orange-400 to-red-500 text-white', 'bg-gradient-to-r from-orange-500 to-red-600 text-white', 'flame', 99, 'Actively hiring at scale'),
  ('fast_growing', 'badge', 'Fast Growing', 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white', 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white', 'trending-up', 98, 'Rapid company growth'),

  -- Timing & Urgency
  ('new_listing', 'badge', 'New Listing', 'bg-blue-100 text-blue-800', 'bg-blue-900 text-blue-200', 'sparkle', 95, 'Posted within last 48 hours'),
  ('closing_soon', 'badge', 'Closing Soon', 'bg-red-100 text-red-800', 'bg-red-900 text-red-200', 'clock', 94, 'Application deadline approaching'),

  -- Special Programs
  ('hidden_gem', 'badge', 'Hidden Gem', 'bg-gradient-to-r from-violet-400 to-purple-500 text-white', 'bg-gradient-to-r from-violet-500 to-purple-600 text-white', 'gem', 90, 'Lesser-known but excellent opportunity'),
  ('yc_w26', 'badge', 'YC W26', 'bg-orange-100 text-orange-800', 'bg-orange-900 text-orange-200', 'rocket', 89, 'Y Combinator Winter 2026 batch'),
  ('intern_to_ng', 'badge', 'Intern to NG', 'bg-teal-100 text-teal-800', 'bg-teal-900 text-teal-200', 'arrow-up-right', 88, 'Strong intern-to-new-grad pipeline'),
  ('rotational', 'badge', 'Rotational', 'bg-indigo-100 text-indigo-800', 'bg-indigo-900 text-indigo-200', 'rotate-ccw', 87, 'Rotational program across teams')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  color_light = EXCLUDED.color_light,
  color_dark = EXCLUDED.color_dark,
  icon = EXCLUDED.icon,
  priority = EXCLUDED.priority,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ============================================
-- MIGRATE EXISTING SOURCE COLUMN TO ARRAY
-- Move single source value to discovery_sources array
-- ============================================
UPDATE jobs
SET discovery_sources = ARRAY[source]
WHERE source IS NOT NULL
  AND source != ''
  AND (discovery_sources IS NULL OR discovery_sources = '{}');

-- ============================================
-- ROW LEVEL SECURITY FOR TAG_REGISTRY
-- ============================================
ALTER TABLE tag_registry ENABLE ROW LEVEL SECURITY;

-- Public read access (everyone can see tags)
CREATE POLICY "Public read tags" ON tag_registry
  FOR SELECT USING (true);

-- Service role write access (for admin management)
CREATE POLICY "Service writes tags" ON tag_registry
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service updates tags" ON tag_registry
  FOR UPDATE USING (true);

CREATE POLICY "Service deletes tags" ON tag_registry
  FOR DELETE USING (true);

-- ============================================
-- HELPER FUNCTION: Get tags by category
-- ============================================
CREATE OR REPLACE FUNCTION get_tags_by_category(p_category TEXT)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  color_light TEXT,
  color_dark TEXT,
  icon TEXT,
  description TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    tr.id,
    tr.name,
    tr.color_light,
    tr.color_dark,
    tr.icon,
    tr.description
  FROM tag_registry tr
  WHERE tr.category = p_category
    AND tr.is_active = true
  ORDER BY tr.priority DESC, tr.name ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- HELPER FUNCTION: Get jobs with specific tags
-- ============================================
CREATE OR REPLACE FUNCTION get_jobs_by_tags(
  p_diversity_tags TEXT[] DEFAULT NULL,
  p_work_modes TEXT[] DEFAULT NULL,
  p_badges TEXT[] DEFAULT NULL,
  p_sources TEXT[] DEFAULT NULL
)
RETURNS SETOF jobs AS $$
BEGIN
  RETURN QUERY
  SELECT j.*
  FROM jobs j
  WHERE j.is_active = true
    AND (p_diversity_tags IS NULL OR j.diversity_tags && p_diversity_tags)
    AND (p_work_modes IS NULL OR j.work_modes && p_work_modes)
    AND (p_badges IS NULL OR j.badges && p_badges)
    AND (p_sources IS NULL OR j.discovery_sources && p_sources)
  ORDER BY j.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- UPDATED_AT TRIGGER FOR TAG_REGISTRY
-- ============================================
CREATE OR REPLACE FUNCTION update_tag_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tag_registry_updated_at
  BEFORE UPDATE ON tag_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_tag_registry_updated_at();

-- ============================================
-- DONE
-- ============================================
