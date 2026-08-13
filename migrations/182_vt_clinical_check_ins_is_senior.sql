-- 182_vt_clinical_check_ins_is_senior.sql
-- Doctor shift gate: per-check-in senior tag. "Senior of ICU now" =
-- open check-in with operational_role='icu' AND is_senior=true.
ALTER TABLE vt_clinical_check_ins
  ADD COLUMN IF NOT EXISTS is_senior boolean NOT NULL DEFAULT false;
