-- Add versioning fields to vt_drug_formulary.
-- Every PATCH now creates a new row (version + 1, isActive = true)
-- and sets the previous row's isActive = false — in-place mutations are retired.

ALTER TABLE vt_drug_formulary
  ADD COLUMN IF NOT EXISTS version   INTEGER  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN  NOT NULL DEFAULT TRUE;

-- Mark all existing rows as version 1, active (they were the only row per entry).
UPDATE vt_drug_formulary SET version = 1, is_active = TRUE WHERE version IS NULL OR is_active IS NULL;

-- Replace the old unique index (used deleted_at) with one scoped to is_active=true.
DROP INDEX IF EXISTS vt_drug_formulary_clinic_generic_conc_uq;

CREATE UNIQUE INDEX IF NOT EXISTS vt_drug_formulary_clinic_generic_conc_active_uq
  ON vt_drug_formulary (clinic_id, lower(trim(generic_name)), concentration_mg_ml)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_drug_formulary_clinic_active
  ON vt_drug_formulary (clinic_id, is_active);
