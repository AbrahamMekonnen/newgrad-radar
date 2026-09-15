-- Small key/value store for dynamic, non-critical site content that a scheduled
-- job refreshes (e.g. the rotating dashboard greeting lines). Public read so the
-- app can fetch it with the anon key; only the service role (the generator job)
-- writes.
CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_content_public_read ON site_content;
CREATE POLICY site_content_public_read ON site_content
  FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';
