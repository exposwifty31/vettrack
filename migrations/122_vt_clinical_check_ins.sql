-- Phase 2.5 PR 1: Clinical check-in table.
-- Records explicit clinical presence ("checked in for a shift") for a user
-- within a clinic. Operational role is optional and only meaningful for
-- doctors/vets whose shift assignment carries an operational dimension.
--
-- This PR adds the schema only — no resolver, route, middleware, cache,
-- or worker reads/writes this table yet.

CREATE TABLE IF NOT EXISTS vt_clinical_check_ins (
  id                         TEXT         PRIMARY KEY,
  clinic_id                  TEXT         NOT NULL REFERENCES vt_clinics(id) ON DELETE RESTRICT,
  user_id                    TEXT         NOT NULL REFERENCES vt_users(id)   ON DELETE RESTRICT,
  checked_in_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  checked_out_at             TIMESTAMPTZ,
  operational_role           VARCHAR(40),
  clinical_role_at_check_in  VARCHAR(20)  NOT NULL,
  active_shift_id            TEXT,
  shift_session_id           TEXT,
  check_out_reason           VARCHAR(40),
  client_id                  VARCHAR(64),
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Enforce at most one open check-in per (clinic, user). Partial index on
-- checked_out_at IS NULL is what makes this a single-active-session guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_clinical_check_ins_open_per_user
  ON vt_clinical_check_ins (clinic_id, user_id)
  WHERE checked_out_at IS NULL;

-- Fast lookup for "who is checked in right now" within a clinic.
CREATE INDEX IF NOT EXISTS idx_vt_clinical_check_ins_clinic_open
  ON vt_clinical_check_ins (clinic_id)
  WHERE checked_out_at IS NULL;

-- Recent check-in history per user, newest first.
CREATE INDEX IF NOT EXISTS idx_vt_clinical_check_ins_user_recent
  ON vt_clinical_check_ins (user_id, checked_in_at DESC);
