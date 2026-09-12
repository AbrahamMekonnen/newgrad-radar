-- ============================================
-- NEWGRAD RADAR - RECRUITERS MIGRATION
-- Run via: supabase db push or Supabase SQL Editor
-- ============================================

-- ============================================
-- TABLE: recruiters
-- Recruiter contacts for jobs/companies
-- ============================================
CREATE TABLE recruiters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  company_slug TEXT REFERENCES companies(slug),
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  email_verified BOOLEAN DEFAULT false,
  linkedin_url TEXT,
  linkedin_verified BOOLEAN DEFAULT false,
  phone TEXT,
  source TEXT NOT NULL,                     -- 'job_posting', 'pattern', 'user', 'osint'
  added_by UUID REFERENCES auth.users(id),
  verification_status TEXT DEFAULT 'pending', -- 'valid', 'invalid', 'stale'
  last_verified_at TIMESTAMPTZ,
  upvotes INT DEFAULT 0,
  downvotes INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_recruiters_job ON recruiters(job_id);
CREATE INDEX idx_recruiters_company ON recruiters(company_slug);
CREATE INDEX idx_recruiters_email ON recruiters(email) WHERE email IS NOT NULL;
CREATE INDEX idx_recruiters_verification ON recruiters(verification_status);
CREATE INDEX idx_recruiters_created ON recruiters(created_at DESC);

-- ============================================
-- TABLE: recruiter_votes
-- User votes on recruiter accuracy (crowdsourced verification)
-- ============================================
CREATE TABLE recruiter_votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recruiter_id UUID REFERENCES recruiters(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  vote INT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(recruiter_id, user_id)
);

CREATE INDEX idx_recruiter_votes_recruiter ON recruiter_votes(recruiter_id);
CREATE INDEX idx_recruiter_votes_user ON recruiter_votes(user_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE recruiters ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_votes ENABLE ROW LEVEL SECURITY;

-- Anyone can read recruiters
CREATE POLICY "Public read recruiters" ON recruiters
  FOR SELECT USING (true);

-- Authenticated users can add recruiters
CREATE POLICY "Authenticated users add recruiters" ON recruiters
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Service role can write/update recruiters (for scraper)
CREATE POLICY "Service writes recruiters" ON recruiters
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service updates recruiters" ON recruiters
  FOR UPDATE USING (true);

-- Users can read all votes
CREATE POLICY "Public read votes" ON recruiter_votes
  FOR SELECT USING (true);

-- Users can manage their own votes
CREATE POLICY "Users manage own votes" ON recruiter_votes
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- FUNCTION: Update recruiter vote counts
-- Trigger to sync upvotes/downvotes on recruiters table
-- ============================================
CREATE OR REPLACE FUNCTION update_recruiter_vote_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.vote = 1 THEN
      UPDATE recruiters SET upvotes = upvotes + 1, updated_at = NOW() WHERE id = NEW.recruiter_id;
    ELSE
      UPDATE recruiters SET downvotes = downvotes + 1, updated_at = NOW() WHERE id = NEW.recruiter_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.vote = 1 THEN
      UPDATE recruiters SET upvotes = upvotes - 1, updated_at = NOW() WHERE id = OLD.recruiter_id;
    ELSE
      UPDATE recruiters SET downvotes = downvotes - 1, updated_at = NOW() WHERE id = OLD.recruiter_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.vote != NEW.vote THEN
    IF NEW.vote = 1 THEN
      UPDATE recruiters SET upvotes = upvotes + 1, downvotes = downvotes - 1, updated_at = NOW() WHERE id = NEW.recruiter_id;
    ELSE
      UPDATE recruiters SET upvotes = upvotes - 1, downvotes = downvotes + 1, updated_at = NOW() WHERE id = NEW.recruiter_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_recruiter_votes
  AFTER INSERT OR UPDATE OR DELETE ON recruiter_votes
  FOR EACH ROW EXECUTE FUNCTION update_recruiter_vote_counts();

-- ============================================
-- DONE
-- ============================================
