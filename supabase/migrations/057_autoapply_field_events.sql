-- Sanitized, append-only browser field outcomes for offline ATS conformance analysis.
CREATE TABLE IF NOT EXISTS autoapply_field_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue_id UUID NOT NULL REFERENCES autoapply_job_queue(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ats_type TEXT NOT NULL DEFAULT 'generic',
  event_code TEXT NOT NULL,
  field_key TEXT,
  control_type TEXT,
  answer_source TEXT,
  failure_category TEXT,
  retained BOOLEAN,
  attempt SMALLINT,
  option_count SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS autoapply_field_events_queue_created_idx
  ON autoapply_field_events(queue_id, created_at);
CREATE INDEX IF NOT EXISTS autoapply_field_events_ats_code_idx
  ON autoapply_field_events(ats_type, event_code, created_at DESC);
ALTER TABLE autoapply_field_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users can view own autoapply field events"
    ON autoapply_field_events FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TABLE autoapply_field_events IS
  'Sanitized browser execution outcomes. Never stores question labels, answers, resume text, or option values.';