-- Queue of companies users want recruiters sourced for. The Recruiters tab lets
-- a user request a company we don't have yet; the next scheduled backfill
-- (recruiters/enrich.py --from-requests) picks up pending rows and fills them.
CREATE TABLE IF NOT EXISTS recruiter_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_slug TEXT,
  company_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | done | failed
  requested_by UUID,                        -- optional: auth.users id
  request_count INT NOT NULL DEFAULT 1,     -- how many users asked (dedupe bumps this)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- One open request per company: dedupe by slug (when known) else by name.
CREATE UNIQUE INDEX IF NOT EXISTS recruiter_requests_slug_uniq
  ON recruiter_requests (company_slug) WHERE company_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS recruiter_requests_status_idx
  ON recruiter_requests (status);

ALTER TABLE recruiter_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can create a request and read the queue; only the service role (used by
-- the backfill job) updates/deletes.
DROP POLICY IF EXISTS recruiter_requests_insert ON recruiter_requests;
CREATE POLICY recruiter_requests_insert ON recruiter_requests
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS recruiter_requests_select ON recruiter_requests;
CREATE POLICY recruiter_requests_select ON recruiter_requests
  FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';
