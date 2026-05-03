-- Extend restock sessions with baseline snapshot support.
-- Extend restock events with per-scan observed quantity, PAR target, and scanner identity.

ALTER TABLE vt_restock_sessions
  ADD COLUMN IF NOT EXISTS baseline_snapshot JSONB;

ALTER TABLE vt_restock_events
  ADD COLUMN IF NOT EXISTS observed_quantity   INTEGER,
  ADD COLUMN IF NOT EXISTS target_par          INTEGER,
  ADD COLUMN IF NOT EXISTS scanned_by_user_id  TEXT REFERENCES vt_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restock_events_item_session
  ON vt_restock_events (session_id, item_id);
