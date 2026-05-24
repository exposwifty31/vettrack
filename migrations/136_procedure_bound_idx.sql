-- Partial index: fast lookup of equipment currently procedure_bound per clinic
-- No CONCURRENTLY — migration runner wraps each file in BEGIN/COMMIT
-- Naming follows V1 convention: "vt_<table>_<description>_idx"
CREATE INDEX IF NOT EXISTS "vt_equipment_procedure_bound_idx"
  ON vt_equipment (clinic_id, procedure_bound_hospitalization_id)
  WHERE usage_state = 'procedure_bound';
