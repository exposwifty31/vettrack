-- Performance indexes for vt_appointments (previously unindexed)
-- Covers the dominant query patterns: clinic+status, clinic+start_time,
-- clinic+vet+start_time, ownership lookups, and external-id integration lookups.

CREATE INDEX IF NOT EXISTS idx_vt_appointments_clinic_status
  ON vt_appointments (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_vt_appointments_clinic_start_time
  ON vt_appointments (clinic_id, start_time);

CREATE INDEX IF NOT EXISTS idx_vt_appointments_clinic_vet_start_time
  ON vt_appointments (clinic_id, vet_id, start_time);

CREATE INDEX IF NOT EXISTS idx_vt_appointments_acknowledged_user
  ON vt_appointments (acknowledged_user_id)
  WHERE acknowledged_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vt_appointments_clinic_external
  ON vt_appointments (clinic_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

-- Performance indexes for vt_users
-- clinic_id is a FK queried in every tenant-scoped user list/lookup.

CREATE INDEX IF NOT EXISTS idx_vt_users_clinic
  ON vt_users (clinic_id);

CREATE INDEX IF NOT EXISTS idx_vt_users_clinic_role
  ON vt_users (clinic_id, role);

CREATE INDEX IF NOT EXISTS idx_vt_users_clinic_status
  ON vt_users (clinic_id, status);
