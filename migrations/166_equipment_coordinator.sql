-- Equipment Coordinator model (docking P3 T3.4-i-a, server foundation).
--
-- Eligibility (who's qualified) is a static, manager-set per-user flag —
-- separate from `secondary_role` (a single-valued authority-elevation
-- field; wrong semantics for "can be picked as this shift's coordinator").
-- Assignment (which qualified tech is coordinator THIS shift) is
-- auto-derived (server/services/equipment-coordinator.service.ts) and,
-- when ambiguous, recorded here as a per-(clinic, shift_date) confirmation.
--
-- Additive/idempotent throughout: ADD COLUMN IF NOT EXISTS on the existing,
-- populated vt_users table; CREATE TABLE/INDEX IF NOT EXISTS for the
-- brand-new vt_shift_equipment_coordinator table (empty by construction, so
-- no DO-block/NOT VALID staging is required — see 165_equipment_anchors.sql).

ALTER TABLE vt_users ADD COLUMN IF NOT EXISTS is_equipment_coordinator BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS vt_shift_equipment_coordinator (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  shift_date DATE NOT NULL,
  coordinator_user_id TEXT NOT NULL REFERENCES vt_users (id) ON DELETE RESTRICT,
  source TEXT NOT NULL,               -- 'auto' | 'confirmed' | 'fallback_senior'
  assigned_by_user_id TEXT REFERENCES vt_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vt_shift_eq_coordinator_clinic_date_uq
  ON vt_shift_equipment_coordinator (clinic_id, shift_date);
