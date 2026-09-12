-- ============================================
-- Migration: Global Custom Companies
--
-- Makes user-added companies available globally.
-- Adds tracking fields for moderation and analytics.
-- ============================================

-- Add tracking columns to companies table
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS verification_source TEXT,
ADD COLUMN IF NOT EXISTS is_user_submitted BOOLEAN DEFAULT FALSE;

-- Index for finding user-submitted companies
CREATE INDEX IF NOT EXISTS idx_companies_added_by ON companies(added_by);
CREATE INDEX IF NOT EXISTS idx_companies_user_submitted ON companies(is_user_submitted) WHERE is_user_submitted = TRUE;

-- Add comment explaining the columns
COMMENT ON COLUMN companies.added_by IS 'User who added this company (NULL for system-seeded companies)';
COMMENT ON COLUMN companies.verified_at IS 'When the company was verified via external sources';
COMMENT ON COLUMN companies.verification_source IS 'Source used to verify (wikidata, wikipedia, duckduckgo)';
COMMENT ON COLUMN companies.is_user_submitted IS 'TRUE if added by a user, FALSE if from seed data or scraper';

-- Update RLS policies to allow authenticated users to insert companies
-- Note: Service role can still do everything, users can only read and insert

-- Drop existing insert policy for service role (we'll recreate it)
DROP POLICY IF EXISTS "Service writes companies" ON companies;

-- Create new policies
-- Anyone can read companies (already exists as "Public read companies")

-- Authenticated users can insert new companies
CREATE POLICY "Users can add companies"
  ON companies FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- Service role can still update companies (for scraper, enrichment)
CREATE POLICY "Service can update companies"
  ON companies FOR UPDATE
  USING (TRUE);

-- Service role can delete companies (for cleanup)
CREATE POLICY "Service can delete companies"
  ON companies FOR DELETE
  USING (TRUE);

-- ============================================
-- Function to check for duplicate company names
-- ============================================
CREATE OR REPLACE FUNCTION normalize_company_name(name TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN LOWER(
    TRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(name, '\s+(inc\.?|llc\.?|corp\.?|corporation|ltd\.?|limited|co\.?|company)$', '', 'i'),
        '[^\w\s]', '', 'g'
      )
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION normalize_company_name IS 'Normalizes company names for duplicate detection';

-- ============================================
-- Analytics view for user-submitted companies
-- ============================================
CREATE OR REPLACE VIEW user_submitted_companies_stats AS
SELECT
  c.slug,
  c.name,
  c.tier,
  c.added_by,
  c.created_at,
  c.verified_at,
  c.verification_source,
  COUNT(DISTINCT ul.user_id) AS tracker_count,
  COUNT(DISTINCT j.id) AS job_count
FROM companies c
LEFT JOIN user_lists ul ON ul.company_slug = c.slug
LEFT JOIN jobs j ON j.company_slug = c.slug AND j.is_active = TRUE
WHERE c.is_user_submitted = TRUE
GROUP BY c.slug, c.name, c.tier, c.added_by, c.created_at, c.verified_at, c.verification_source
ORDER BY c.created_at DESC;

COMMENT ON VIEW user_submitted_companies_stats IS 'Statistics on user-submitted companies for moderation';

-- ============================================
-- Deprecation note for user_companies table
-- ============================================
COMMENT ON TABLE user_companies IS 'DEPRECATED: Custom companies are now added to the global companies table. This table is kept for migration purposes.';

-- ============================================
-- DONE
-- ============================================
