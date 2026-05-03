-- First-class dispense event entity.
-- State machine: DRAFT → CONFIRMED → COMPLETED | EMERGENCY_PENDING → CONFIRMED → COMPLETED

CREATE TABLE IF NOT EXISTS vt_dispense_events (
  id                 TEXT PRIMARY KEY,
  clinic_id          TEXT NOT NULL REFERENCES vt_clinics(id) ON DELETE RESTRICT,
  container_id       TEXT NOT NULL REFERENCES vt_containers(id) ON DELETE RESTRICT,
  patient_id         TEXT REFERENCES vt_animals(id) ON DELETE SET NULL,
  status             VARCHAR(30)  NOT NULL DEFAULT 'DRAFT',
  inventory_status   VARCHAR(20),
  inventory_mismatch BOOLEAN      NOT NULL DEFAULT FALSE,
  requires_completion BOOLEAN     NOT NULL DEFAULT FALSE,
  items              JSONB        NOT NULL,
  bypass_reason      TEXT,
  idempotency_key    TEXT         NOT NULL,
  created_by         TEXT         NOT NULL REFERENCES vt_users(id) ON DELETE RESTRICT,
  confirmed_by       TEXT         REFERENCES vt_users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  confirmed_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  billing_event_id   TEXT         REFERENCES vt_billing_ledger(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS vt_dispense_events_idempotency_uq
  ON vt_dispense_events (clinic_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_vt_dispense_events_clinic_status
  ON vt_dispense_events (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_vt_dispense_events_clinic_created
  ON vt_dispense_events (clinic_id, created_at);

CREATE INDEX IF NOT EXISTS idx_vt_dispense_events_requires_completion
  ON vt_dispense_events (clinic_id, requires_completion, status)
  WHERE requires_completion = TRUE;
