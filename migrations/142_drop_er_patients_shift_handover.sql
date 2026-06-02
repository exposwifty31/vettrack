-- Remove ER module, shift handover, and patient/animal/hospitalization data model.

-- Drop FK columns on surviving tables first
ALTER TABLE "vt_code_blue_sessions" DROP CONSTRAINT IF EXISTS "vt_code_blue_sessions_patient_id_vt_animals_id_fk";
ALTER TABLE "vt_code_blue_sessions" DROP CONSTRAINT IF EXISTS "vt_code_blue_sessions_hospitalization_id_vt_hospitalizations_id_fk";
ALTER TABLE "vt_code_blue_sessions" DROP COLUMN IF EXISTS "patient_id";
ALTER TABLE "vt_code_blue_sessions" DROP COLUMN IF EXISTS "hospitalization_id";

ALTER TABLE "vt_equipment" DROP CONSTRAINT IF EXISTS "vt_equipment_procedure_bound_hospitalization_id_vt_hospitalizations_id_fk";
ALTER TABLE "vt_equipment" DROP COLUMN IF EXISTS "procedure_bound_hospitalization_id";

ALTER TABLE "vt_appointments" DROP CONSTRAINT IF EXISTS "vt_appointments_animal_id_vt_animals_id_fk";
ALTER TABLE "vt_appointments" DROP CONSTRAINT IF EXISTS "vt_appointments_owner_id_vt_owners_id_fk";
ALTER TABLE "vt_appointments" DROP COLUMN IF EXISTS "animal_id";
ALTER TABLE "vt_appointments" DROP COLUMN IF EXISTS "owner_id";
ALTER TABLE "vt_appointments" DROP COLUMN IF EXISTS "hospitalization_id";

DROP INDEX IF EXISTS "vt_med_tasks_open_animal_drug_route_uq";
ALTER TABLE "vt_medication_tasks" DROP COLUMN IF EXISTS "animal_id";
CREATE UNIQUE INDEX IF NOT EXISTS "vt_med_tasks_open_clinic_drug_route_uq"
  ON "vt_medication_tasks" ("clinic_id", "drug_id", "route")
  WHERE "status" IN ('pending', 'in_progress');

ALTER TABLE "vt_inventory_logs" DROP CONSTRAINT IF EXISTS "vt_inventory_logs_animal_id_vt_animals_id_fk";
ALTER TABLE "vt_inventory_logs" DROP COLUMN IF EXISTS "animal_id";

ALTER TABLE "vt_dispense_events" DROP CONSTRAINT IF EXISTS "vt_dispense_events_patient_id_vt_animals_id_fk";
ALTER TABLE "vt_dispense_events" DROP COLUMN IF EXISTS "patient_id";

ALTER TABLE "vt_tasks" DROP CONSTRAINT IF EXISTS "vt_tasks_patient_id_vt_animals_id_fk";
ALTER TABLE "vt_tasks" DROP COLUMN IF EXISTS "patient_id";

ALTER TABLE "vt_clinics" DROP COLUMN IF EXISTS "er_mode_state";
ALTER TABLE "vt_clinics" DROP COLUMN IF EXISTS "er_intake_escalate_low_minutes";
ALTER TABLE "vt_clinics" DROP COLUMN IF EXISTS "er_intake_escalate_medium_minutes";

-- ER tables
DROP TABLE IF EXISTS "vt_er_baseline_snapshots" CASCADE;
DROP TABLE IF EXISTS "vt_er_board_event_log" CASCADE;
DROP TABLE IF EXISTS "vt_er_kpi_daily" CASCADE;
DROP TABLE IF EXISTS "vt_doctor_admission_state" CASCADE;
DROP TABLE IF EXISTS "vt_er_intake_events" CASCADE;

-- Shift handover / patient handoff tables
DROP TABLE IF EXISTS "vt_shift_handover_snapshots" CASCADE;
DROP TABLE IF EXISTS "vt_shift_patient_handoff_items" CASCADE;
DROP TABLE IF EXISTS "vt_shift_patient_handoffs" CASCADE;
DROP TABLE IF EXISTS "vt_shift_handoff_items" CASCADE;
DROP TABLE IF EXISTS "vt_shift_handoffs" CASCADE;

-- Patient / room assignment tables
DROP TABLE IF EXISTS "vt_patient_room_assignments" CASCADE;
DROP TABLE IF EXISTS "vt_hospitalizations" CASCADE;
DROP TABLE IF EXISTS "vt_animals" CASCADE;
DROP TABLE IF EXISTS "vt_owners" CASCADE;
