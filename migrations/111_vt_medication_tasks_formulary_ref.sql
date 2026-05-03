-- Add formularyId and formularyVersion to medication tasks.
-- These are captured at task creation and never mutated — they anchor
-- each task to the exact formulary version used for dose calculation.

ALTER TABLE vt_medication_tasks
  ADD COLUMN IF NOT EXISTS formulary_id      TEXT,
  ADD COLUMN IF NOT EXISTS formulary_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_vt_med_tasks_formulary
  ON vt_medication_tasks (formulary_id)
  WHERE formulary_id IS NOT NULL;
