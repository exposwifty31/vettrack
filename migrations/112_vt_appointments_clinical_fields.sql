-- Extend vt_appointments with clinical linkage and identity fields:
--   hospitalizationId  — links a task to a specific hospitalization episode
--   appointmentType    — scheduling/purpose label (separate from taskType)
--   createdBy          — who created this appointment/task
--   'approved' status  — first-class vet-gate state for medication tasks

ALTER TABLE vt_appointments
  ADD COLUMN IF NOT EXISTS hospitalization_id TEXT
    REFERENCES vt_hospitalizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Index for efficient discharge pre-flight: find open tasks for a hospitalization
CREATE INDEX IF NOT EXISTS idx_vt_appointments_hosp_status
  ON vt_appointments (hospitalization_id, status)
  WHERE hospitalization_id IS NOT NULL;
