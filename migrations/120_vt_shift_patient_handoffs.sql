-- Directed multi-patient technician-to-technician shift handoff.
-- Lifecycle: draft → submitted → reviewed | cancelled. No SLA, no ownership transfer.

CREATE TABLE IF NOT EXISTS vt_shift_patient_handoffs (
  id                TEXT         PRIMARY KEY,
  clinic_id         TEXT         NOT NULL REFERENCES vt_clinics(id)  ON DELETE RESTRICT,
  outgoing_user_id  TEXT         NOT NULL REFERENCES vt_users(id)    ON DELETE RESTRICT,
  receiving_user_id TEXT         NOT NULL REFERENCES vt_users(id)    ON DELETE RESTRICT,
  -- draft | submitted | reviewed | cancelled
  status            VARCHAR(20)  NOT NULL DEFAULT 'draft',
  -- optimistic concurrency token; incremented on every state-changing write
  version           INTEGER      NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  submitted_at      TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vt_sph_clinic_status
  ON vt_shift_patient_handoffs (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_vt_sph_receiving
  ON vt_shift_patient_handoffs (receiving_user_id, status);
CREATE INDEX IF NOT EXISTS idx_vt_sph_outgoing
  ON vt_shift_patient_handoffs (outgoing_user_id, status);

-- Per-patient content rows. Snapshot is empty during draft; populated atomically on submit.
CREATE TABLE IF NOT EXISTS vt_shift_patient_handoff_items (
  id                   TEXT        PRIMARY KEY,
  clinic_id            TEXT        NOT NULL REFERENCES vt_clinics(id)                ON DELETE RESTRICT,
  handoff_id           TEXT        NOT NULL REFERENCES vt_shift_patient_handoffs(id) ON DELETE CASCADE,
  hospitalization_id   TEXT        NOT NULL REFERENCES vt_hospitalizations(id)       ON DELETE RESTRICT,
  animal_id            TEXT        NOT NULL REFERENCES vt_animals(id)                ON DELETE RESTRICT,
  -- draft | ready | skipped | invalidated
  status               VARCHAR(20) NOT NULL DEFAULT 'draft',
  skip_reason          TEXT,
  current_stability    TEXT        NOT NULL DEFAULT '',
  pending_tasks_note   TEXT        NOT NULL DEFAULT '',
  critical_warnings    TEXT        NOT NULL DEFAULT '',
  clinical_note        TEXT        NOT NULL DEFAULT '',
  -- immutable; written once when parent header transitions to "submitted"
  patient_snapshot     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  version              INTEGER     NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vt_sphi_handoff
  ON vt_shift_patient_handoff_items (handoff_id);

-- Enforce one row per patient per handoff
CREATE UNIQUE INDEX IF NOT EXISTS uq_vt_sphi_handoff_hosp
  ON vt_shift_patient_handoff_items (handoff_id, hospitalization_id);
