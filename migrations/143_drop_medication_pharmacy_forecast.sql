-- Remove medication tasks, drug formulary, and pharmacy forecast tables.

ALTER TABLE vt_items DROP CONSTRAINT IF EXISTS vt_items_formulary_id_vt_drug_formulary_id_fk;
ALTER TABLE vt_items DROP COLUMN IF EXISTS formulary_id;
ALTER TABLE vt_items DROP COLUMN IF EXISTS formulary_version;

ALTER TABLE vt_clinics DROP COLUMN IF EXISTS pharmacy_email;
ALTER TABLE vt_clinics DROP COLUMN IF EXISTS forecast_pdf_source_format;

DROP TABLE IF EXISTS vt_med_task_dose_edits CASCADE;
DROP TABLE IF EXISTS vt_medication_tasks CASCADE;
DROP TABLE IF EXISTS vt_pharmacy_forecast_exclusions CASCADE;
DROP TABLE IF EXISTS vt_pharmacy_forecast_parses CASCADE;
DROP TABLE IF EXISTS vt_pharmacy_orders CASCADE;
DROP TABLE IF EXISTS vt_drug_formulary CASCADE;
