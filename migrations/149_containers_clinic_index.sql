-- vt_containers was missing a clinic_id index.
-- Every inventory list, restock, and dispense operation filters by clinic_id.
CREATE INDEX IF NOT EXISTS idx_vt_containers_clinic
  ON vt_containers (clinic_id);
