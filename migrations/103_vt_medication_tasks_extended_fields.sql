-- Extend vt_medication_tasks with administered-side fields, inventory tracking,
-- cancellation support, and due-at scheduling.

ALTER TABLE vt_medication_tasks
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by  TEXT,
  ADD COLUMN IF NOT EXISTS due_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_volume NUMERIC,
  ADD COLUMN IF NOT EXISTS administered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS inventory_mismatch BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS vt_med_tasks_due_at_idx
  ON vt_medication_tasks (clinic_id, due_at)
  WHERE due_at IS NOT NULL;
