-- Create vt_integration_sync_conflicts if it doesn't exist yet, then add
-- Fix B fields: severity (LOW/HIGH) and resolution tracking.

CREATE TABLE IF NOT EXISTS vt_integration_sync_conflicts (
  id           TEXT        PRIMARY KEY,
  clinic_id    TEXT        NOT NULL REFERENCES vt_clinics(id) ON DELETE CASCADE,
  adapter_id   TEXT        NOT NULL,
  entity_type  TEXT        NOT NULL,
  local_id     TEXT        NOT NULL,
  external_id  TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'open',
  policy_used  TEXT        NOT NULL,
  payload_snapshot JSONB,
  severity     VARCHAR(10) NOT NULL DEFAULT 'HIGH',
  resolution   VARCHAR(30),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

-- Idempotent: add columns if table already existed without them
ALTER TABLE vt_integration_sync_conflicts
  ADD COLUMN IF NOT EXISTS severity   VARCHAR(10)  NOT NULL DEFAULT 'HIGH',
  ADD COLUMN IF NOT EXISTS resolution VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_vt_integration_sync_conflicts_clinic_status
  ON vt_integration_sync_conflicts (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_vt_integration_sync_conflicts_severity
  ON vt_integration_sync_conflicts (clinic_id, severity, status);
