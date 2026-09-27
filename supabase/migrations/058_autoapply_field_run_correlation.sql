-- Correlate every sanitized field outcome with one extension execution run.
ALTER TABLE autoapply_field_events
  ADD COLUMN IF NOT EXISTS run_id TEXT,
  ADD COLUMN IF NOT EXISTS extension_version TEXT;
CREATE INDEX IF NOT EXISTS autoapply_field_events_run_idx
  ON autoapply_field_events(queue_id, run_id, created_at);
COMMENT ON COLUMN autoapply_field_events.run_id IS
  'Random per-claim execution identifier; contains no user or answer data.';
