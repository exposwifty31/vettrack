-- 181_vt_users_senior_doctor_eligible.sql
-- Doctor shift gate (spec 2026-08-13): admin-set eligibility to claim the
-- per-team "senior" tag at check-in. Mirrors is_equipment_coordinator.
ALTER TABLE vt_users
  ADD COLUMN IF NOT EXISTS senior_doctor_eligible boolean NOT NULL DEFAULT false;
