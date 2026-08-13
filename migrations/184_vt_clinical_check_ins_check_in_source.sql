-- 184_vt_clinical_check_ins_check_in_source.sql
-- Doctor shift gate: immutable origin of a check-in row, computed ONCE at
-- insert ('doctor_gate' | 'legacy'). The 14h expiry sweep targets
-- check_in_source = 'doctor_gate'; inferring origin from the LIVE
-- vt_users.allowed_operational_roles is unsafe — removing "admission" later
-- would let the sweep expire a legacy row, adding it later would leave a
-- gate row open forever — so the classification is persisted here instead.
ALTER TABLE vt_clinical_check_ins
  ADD COLUMN IF NOT EXISTS check_in_source varchar(20) NOT NULL DEFAULT 'legacy';

-- Backfill: 'icu' / 'internal_medicine' did not exist before the doctor gate,
-- so any pre-existing row on them is a gate row by construction. Ambiguous
-- 'admission' rows and everything else keep the 'legacy' default (never
-- auto-expired). Idempotent: re-runs match no rows.
UPDATE vt_clinical_check_ins
SET check_in_source = 'doctor_gate'
WHERE operational_role IN ('icu', 'internal_medicine')
  AND check_in_source = 'legacy';
