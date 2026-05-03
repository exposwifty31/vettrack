-- Fix A: CHARGE/REVERSAL entry type + append-only void model.
-- Fix B: source traceability (taskId, dispenseEventId, createdBy, formularyId/Version, sourceType).

ALTER TABLE vt_billing_ledger
  ADD COLUMN IF NOT EXISTS entry_type      VARCHAR(10)  NOT NULL DEFAULT 'CHARGE',
  ADD COLUMN IF NOT EXISTS reverses_id     TEXT,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS task_id         TEXT,
  ADD COLUMN IF NOT EXISTS dispense_event_id TEXT,
  ADD COLUMN IF NOT EXISTS created_by      TEXT,
  ADD COLUMN IF NOT EXISTS formulary_id    TEXT,
  ADD COLUMN IF NOT EXISTS formulary_version INTEGER,
  -- TASK | DISPENSE | MANUAL
  ADD COLUMN IF NOT EXISTS source_type     VARCHAR(10);

-- Self-referential FK: REVERSAL rows reference the original CHARGE.
-- Deferred to avoid circular insert issues; validated in application code.
-- (Omitted at DB level to avoid migration complexity — enforced in service layer.)

CREATE INDEX IF NOT EXISTS idx_vt_billing_task_id
  ON vt_billing_ledger (task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vt_billing_dispense_event_id
  ON vt_billing_ledger (dispense_event_id)
  WHERE dispense_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vt_billing_reverses_id
  ON vt_billing_ledger (reverses_id)
  WHERE reverses_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vt_billing_entry_type
  ON vt_billing_ledger (clinic_id, entry_type);
