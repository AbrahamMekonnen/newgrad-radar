-- ============================================
-- INTERVIEW QUESTIONS DATABASE OPTIMIZATIONS
-- Pre-computed tsvector, efficient upserts, better indexes
-- ============================================

-- ============================================
-- 1. ADD PRE-COMPUTED TSVECTOR COLUMN
-- Much faster than computing tsvector on each query
-- ============================================

-- Add the search_vector column if not exists
ALTER TABLE interview_questions
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create GIN index on pre-computed vector
CREATE INDEX IF NOT EXISTS idx_iq_search_vector
ON interview_questions USING GIN(search_vector);

-- Function to update the search vector
CREATE OR REPLACE FUNCTION interview_questions_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.question_title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.company_name, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.question_text, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.position, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update search vector on insert/update
DROP TRIGGER IF EXISTS trg_iq_search_vector ON interview_questions;
CREATE TRIGGER trg_iq_search_vector
BEFORE INSERT OR UPDATE OF question_title, company_name, question_text, position
ON interview_questions
FOR EACH ROW
EXECUTE FUNCTION interview_questions_search_vector_update();

-- Backfill existing records
UPDATE interview_questions
SET search_vector =
  setweight(to_tsvector('english', COALESCE(question_title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(company_name, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(question_text, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(position, '')), 'D')
WHERE search_vector IS NULL;


-- ============================================
-- 2. EFFICIENT BATCH UPSERT FUNCTION
-- Single-statement upsert for bulk operations
-- ============================================

CREATE OR REPLACE FUNCTION upsert_interview_questions(
  p_questions JSONB
)
RETURNS TABLE (
  inserted_count INTEGER,
  updated_count INTEGER,
  duplicate_count INTEGER
) AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_updated INTEGER := 0;
  v_duplicate INTEGER := 0;
  v_question JSONB;
  v_content_hash TEXT;
  v_existing_id UUID;
BEGIN
  -- Process each question in the array
  FOR v_question IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    v_content_hash := v_question->>'content_hash';

    -- Check if exists by content_hash
    SELECT id INTO v_existing_id
    FROM interview_questions
    WHERE content_hash = v_content_hash
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Update existing record (increment upvotes if provided)
      UPDATE interview_questions
      SET
        upvotes = GREATEST(upvotes, COALESCE((v_question->>'upvotes')::INTEGER, 0)),
        scraped_at = NOW(),
        updated_at = NOW()
      WHERE id = v_existing_id;

      v_updated := v_updated + 1;
    ELSE
      -- Insert new record
      BEGIN
        INSERT INTO interview_questions (
          company_name, company_slug, position, position_level, team,
          question_type, question_text, question_title, difficulty,
          answer_text, answer_approach,
          interview_round, interview_date, interview_year, interview_month,
          source_name, source_url, source_post_id,
          is_verified, confidence_score,
          upvotes, content_hash, is_duplicate,
          language, region, raw_metadata
        ) VALUES (
          COALESCE(v_question->>'company_name', 'Unknown'),
          v_question->>'company_slug',
          v_question->>'position',
          COALESCE(v_question->>'position_level', 'new_grad'),
          v_question->>'team',
          COALESCE(v_question->>'question_type', 'other')::question_type,
          COALESCE(v_question->>'question_text', ''),
          v_question->>'question_title',
          COALESCE(v_question->>'difficulty', 'unknown')::difficulty_level,
          v_question->>'answer_text',
          v_question->>'answer_approach',
          v_question->>'interview_round',
          (v_question->>'interview_date')::DATE,
          (v_question->>'interview_year')::INTEGER,
          (v_question->>'interview_month')::INTEGER,
          COALESCE(v_question->>'source_name', 'unknown'),
          v_question->>'source_url',
          v_question->>'source_post_id',
          FALSE,
          COALESCE((v_question->>'confidence_score')::DECIMAL, 0.5),
          COALESCE((v_question->>'upvotes')::INTEGER, 0),
          v_content_hash,
          FALSE,
          COALESCE(v_question->>'language', 'en'),
          v_question->>'region',
          COALESCE((v_question->>'raw_metadata')::JSONB, '{}'::JSONB)
        );

        v_inserted := v_inserted + 1;
      EXCEPTION WHEN unique_violation THEN
        v_duplicate := v_duplicate + 1;
      END;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_updated, v_duplicate;
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- 3. GET SOURCE STATISTICS FUNCTION
-- Aggregate stats per source for monitoring
-- ============================================

CREATE OR REPLACE FUNCTION get_source_stats()
RETURNS TABLE (
  source_name TEXT,
  total_questions BIGINT,
  questions_last_7d BIGINT,
  questions_last_30d BIGINT,
  last_scraped TIMESTAMPTZ,
  avg_confidence NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    iq.source_name,
    COUNT(*) as total_questions,
    COUNT(*) FILTER (WHERE iq.scraped_at >= NOW() - INTERVAL '7 days') as questions_last_7d,
    COUNT(*) FILTER (WHERE iq.scraped_at >= NOW() - INTERVAL '30 days') as questions_last_30d,
    MAX(iq.scraped_at) as last_scraped,
    AVG(iq.confidence_score) as avg_confidence
  FROM interview_questions iq
  WHERE iq.is_duplicate = FALSE
  GROUP BY iq.source_name
  ORDER BY total_questions DESC;
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================
-- 4. OPTIMIZED SEARCH FUNCTION
-- Uses pre-computed tsvector for faster searches
-- ============================================

CREATE OR REPLACE FUNCTION search_interview_questions(
  p_query TEXT,
  p_company_slug TEXT DEFAULT NULL,
  p_question_type question_type DEFAULT NULL,
  p_difficulty difficulty_level DEFAULT NULL,
  p_months_back INTEGER DEFAULT 5,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  company_name TEXT,
  company_slug TEXT,
  position TEXT,
  question_type question_type,
  question_text TEXT,
  question_title TEXT,
  difficulty difficulty_level,
  interview_date DATE,
  source_name TEXT,
  source_url TEXT,
  upvotes INTEGER,
  is_verified BOOLEAN,
  rank REAL
) AS $$
BEGIN
  IF p_query IS NOT NULL AND p_query != '' THEN
    -- Full-text search using pre-computed vector
    RETURN QUERY
    SELECT
      iq.id,
      iq.company_name,
      iq.company_slug,
      iq.position,
      iq.question_type,
      iq.question_text,
      iq.question_title,
      iq.difficulty,
      iq.interview_date,
      iq.source_name,
      iq.source_url,
      iq.upvotes,
      iq.is_verified,
      ts_rank(iq.search_vector, plainto_tsquery('english', p_query)) as rank
    FROM interview_questions iq
    WHERE
      iq.is_duplicate = FALSE
      AND iq.search_vector @@ plainto_tsquery('english', p_query)
      AND (p_company_slug IS NULL OR iq.company_slug = p_company_slug)
      AND (p_question_type IS NULL OR iq.question_type = p_question_type)
      AND (p_difficulty IS NULL OR iq.difficulty = p_difficulty)
      AND (
        iq.interview_date >= (CURRENT_DATE - (p_months_back * INTERVAL '1 month'))::DATE
        OR iq.scraped_at >= (CURRENT_DATE - (p_months_back * INTERVAL '1 month'))
      )
    ORDER BY
      rank DESC,
      iq.upvotes DESC,
      COALESCE(iq.interview_date, iq.scraped_at::DATE) DESC
    LIMIT p_limit
    OFFSET p_offset;
  ELSE
    -- No search query, just filter
    RETURN QUERY
    SELECT
      iq.id,
      iq.company_name,
      iq.company_slug,
      iq.position,
      iq.question_type,
      iq.question_text,
      iq.question_title,
      iq.difficulty,
      iq.interview_date,
      iq.source_name,
      iq.source_url,
      iq.upvotes,
      iq.is_verified,
      0::REAL as rank
    FROM interview_questions iq
    WHERE
      iq.is_duplicate = FALSE
      AND (p_company_slug IS NULL OR iq.company_slug = p_company_slug)
      AND (p_question_type IS NULL OR iq.question_type = p_question_type)
      AND (p_difficulty IS NULL OR iq.difficulty = p_difficulty)
      AND (
        iq.interview_date >= (CURRENT_DATE - (p_months_back * INTERVAL '1 month'))::DATE
        OR iq.scraped_at >= (CURRENT_DATE - (p_months_back * INTERVAL '1 month'))
      )
    ORDER BY
      iq.upvotes DESC,
      COALESCE(iq.interview_date, iq.scraped_at::DATE) DESC
    LIMIT p_limit
    OFFSET p_offset;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================
-- 5. ADDITIONAL COMPOSITE INDEXES
-- For common filter patterns
-- ============================================

-- Index for non-duplicate questions (most queries filter this)
CREATE INDEX IF NOT EXISTS idx_iq_active_questions
ON interview_questions (scraped_at DESC)
WHERE is_duplicate = FALSE;

-- Index for verified questions
CREATE INDEX IF NOT EXISTS idx_iq_verified_questions
ON interview_questions (upvotes DESC, scraped_at DESC)
WHERE is_verified = TRUE AND is_duplicate = FALSE;

-- Index for high-confidence questions
CREATE INDEX IF NOT EXISTS idx_iq_confidence_filter
ON interview_questions (confidence_score DESC, scraped_at DESC)
WHERE confidence_score >= 0.7 AND is_duplicate = FALSE;

-- Index for content_hash (critical for deduplication)
CREATE UNIQUE INDEX IF NOT EXISTS idx_iq_content_hash_unique
ON interview_questions (content_hash)
WHERE content_hash IS NOT NULL;

-- Partial index for recent questions (hot data)
CREATE INDEX IF NOT EXISTS idx_iq_recent_30d
ON interview_questions (company_slug, question_type, scraped_at DESC)
WHERE scraped_at >= NOW() - INTERVAL '30 days' AND is_duplicate = FALSE;


-- ============================================
-- 6. COMPANY QUESTION COUNT MATERIALIZED VIEW
-- Fast aggregates for company pages
-- ============================================

CREATE MATERIALIZED VIEW IF NOT EXISTS company_question_counts AS
SELECT
  company_slug,
  company_name,
  COUNT(*) as total_questions,
  COUNT(*) FILTER (WHERE question_type = 'technical_coding') as technical_coding_count,
  COUNT(*) FILTER (WHERE question_type = 'behavioral') as behavioral_count,
  COUNT(*) FILTER (WHERE question_type = 'system_design') as system_design_count,
  COUNT(*) FILTER (WHERE question_type = 'oa') as oa_count,
  COUNT(*) FILTER (WHERE scraped_at >= NOW() - INTERVAL '30 days') as recent_30d_count,
  MAX(scraped_at) as last_question_at
FROM interview_questions
WHERE is_duplicate = FALSE AND company_slug IS NOT NULL
GROUP BY company_slug, company_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cqc_company_slug
ON company_question_counts (company_slug);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_company_question_counts()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY company_question_counts;
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- GRANTS
-- ============================================

GRANT EXECUTE ON FUNCTION upsert_interview_questions(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION get_source_stats() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_interview_questions(TEXT, TEXT, question_type, difficulty_level, INTEGER, INTEGER, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION refresh_company_question_counts() TO service_role;
GRANT SELECT ON company_question_counts TO anon, authenticated;
