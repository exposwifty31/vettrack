-- Shift-adjustment requests (Phase 1).
--
-- A rostered person requests to work past their scheduled end ('extend') or to
-- leave before it ('leave_early') with a required reason; an admin approves or
-- rejects. Only an 'approved' row adjusts the effective shift window in
-- role-resolution (wired separately, additively) — the role never changes, only
-- the effective end time moves. On-shift itself stays roster-derived (vt_shifts);
-- this table is the human-approved deviation layer for a stale roster.

DO $$ BEGIN
  CREATE TYPE vt_shift_adjustment_kind AS ENUM ('extend', 'leave_early');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vt_shift_adjustment_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vt_shift_adjustments (
  id                 TEXT PRIMARY KEY,
  clinic_id          TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  requester_user_id  TEXT NOT NULL REFERENCES vt_users (id) ON DELETE RESTRICT,
  requester_name     TEXT NOT NULL,
  kind               vt_shift_adjustment_kind NOT NULL,
  base_shift_date    DATE NOT NULL,
  base_shift_id      TEXT REFERENCES vt_shifts (id) ON DELETE SET NULL,
  current_end_time   TIME NOT NULL,
  requested_end_time TIME NOT NULL,
  reason             TEXT NOT NULL,
  status             vt_shift_adjustment_status NOT NULL DEFAULT 'pending',
  decided_by_user_id TEXT REFERENCES vt_users (id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  decision_note      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vt_shift_adjustments_clinic_status
  ON vt_shift_adjustments (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_vt_shift_adjustments_clinic_requester
  ON vt_shift_adjustments (clinic_id, requester_user_id);

CREATE INDEX IF NOT EXISTS idx_vt_shift_adjustments_active_lookup
  ON vt_shift_adjustments (clinic_id, requester_user_id, base_shift_date, status);
