-- Extend vt_items (inventory catalog SKUs) with:
--   itemType (DRUG|CONSUMABLE|EQUIPMENT)
--   unit (physical unit string)
--   isActive (soft-delete flag)
--   formularyId / formularyVersion (clinical coupling for DRUG SKUs)

ALTER TABLE vt_items
  ADD COLUMN IF NOT EXISTS item_type   VARCHAR(20)  NOT NULL DEFAULT 'CONSUMABLE',
  ADD COLUMN IF NOT EXISTS unit        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS formulary_id TEXT         REFERENCES vt_drug_formulary(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS formulary_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_items_clinic_active
  ON vt_items (clinic_id, is_active);

CREATE INDEX IF NOT EXISTS idx_items_formulary_id
  ON vt_items (formulary_id)
  WHERE formulary_id IS NOT NULL;

-- Service-level constraint: DRUG ↔ formulary must both be set or both null.
-- Enforced in application code; DB-level CHECK adds a safety net.
ALTER TABLE vt_items
  ADD CONSTRAINT vt_items_drug_formulary_consistency
  CHECK (
    (item_type = 'DRUG' AND formulary_id IS NOT NULL AND formulary_version IS NOT NULL)
    OR
    (item_type != 'DRUG' AND formulary_id IS NULL AND formulary_version IS NULL)
  );
