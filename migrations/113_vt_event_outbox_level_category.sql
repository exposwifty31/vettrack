-- Add severity level and domain category to vt_event_outbox.
-- Used by SSE clients for prioritised rendering and push notification mapping.

ALTER TABLE vt_event_outbox
  ADD COLUMN IF NOT EXISTS level    VARCHAR(10)  NOT NULL DEFAULT 'INFO',
  ADD COLUMN IF NOT EXISTS category VARCHAR(20)  NOT NULL DEFAULT 'SYSTEM';

-- Index to efficiently surface WARNING/CRITICAL events for admin dashboards.
CREATE INDEX IF NOT EXISTS idx_vt_event_outbox_level
  ON vt_event_outbox (clinic_id, level)
  WHERE level IN ('WARNING', 'CRITICAL');
