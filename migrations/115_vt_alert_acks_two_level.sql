-- Fix F: two-level alert ack model (SEEN → RESOLVED).
-- Rows are now persistent (never deleted on resolution).

ALTER TABLE vt_alert_acks
  ADD COLUMN IF NOT EXISTS ack_status       VARCHAR(10)  NOT NULL DEFAULT 'SEEN',
  ADD COLUMN IF NOT EXISTS resolved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by_id    TEXT,
  ADD COLUMN IF NOT EXISTS resolution_note   TEXT;

CREATE INDEX IF NOT EXISTS idx_vt_alert_acks_clinic_status
  ON vt_alert_acks (clinic_id, ack_status);
