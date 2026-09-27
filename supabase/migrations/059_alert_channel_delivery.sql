-- Track push and email independently so one successful channel cannot hide a
-- failure on the other channel. Existing delivered rows remain terminal.
ALTER TABLE alert_matches
  ADD COLUMN IF NOT EXISTS push_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (push_status IN ('pending', 'delivered', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'delivered', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS push_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_delivery_error TEXT;

UPDATE alert_matches
SET push_status = 'delivered',
    email_status = 'delivered',
    push_delivered_at = COALESCE(push_delivered_at, delivered_at),
    email_delivered_at = COALESCE(email_delivered_at, delivered_at)
WHERE delivery_status = 'delivered';

CREATE INDEX IF NOT EXISTS idx_alert_matches_channel_retry
  ON alert_matches(delivery_mode, delivery_status, delivery_attempts)
  WHERE delivery_status = 'pending';

NOTIFY pgrst, 'reload schema';
