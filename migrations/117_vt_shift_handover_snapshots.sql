-- Persisted per-shift handover snapshot.
-- Written on shift end; immutable after creation.
-- The incoming shift reads this to understand what they are inheriting.

CREATE TABLE IF NOT EXISTS vt_shift_handover_snapshots (
  id                TEXT         PRIMARY KEY,
  clinic_id         TEXT         NOT NULL REFERENCES vt_clinics(id) ON DELETE RESTRICT,
  shift_session_id  TEXT         NOT NULL REFERENCES vt_shift_sessions(id) ON DELETE RESTRICT,
  generated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Full patient-centric JSON payload
  patients_payload  JSONB        NOT NULL,
  -- Summary counts: {patientCount, pendingTaskCount, overdueCount, unresolvedEmergencyCount}
  summary_counts    JSONB        NOT NULL,
  created_by        TEXT         NOT NULL REFERENCES vt_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_vt_shift_handover_snapshots_clinic_shift
  ON vt_shift_handover_snapshots (clinic_id, shift_session_id);

CREATE INDEX IF NOT EXISTS idx_vt_shift_handover_snapshots_clinic_generated
  ON vt_shift_handover_snapshots (clinic_id, generated_at DESC);
