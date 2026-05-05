-- Medication container reference for billing + stock deduction on vt_appointments.
-- Companion to inventory_item_id (added in 092). Nullable — existing rows unaffected.
-- Resolves: ERROR: column "container_id" does not exist on vt_appointments.

ALTER TABLE vt_appointments
  ADD COLUMN IF NOT EXISTS container_id TEXT;

CREATE INDEX IF NOT EXISTS idx_vt_appointments_container
  ON vt_appointments (clinic_id, container_id)
  WHERE container_id IS NOT NULL;
