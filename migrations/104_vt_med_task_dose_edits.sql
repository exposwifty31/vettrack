-- Immutable audit log for dose changes on medication tasks.
-- Snapshot remains unchanged; this table records who changed what and when.

CREATE TABLE IF NOT EXISTS vt_med_task_dose_edits (
  id            TEXT PRIMARY KEY,
  clinic_id     TEXT NOT NULL REFERENCES vt_clinics(id) ON DELETE RESTRICT,
  task_id       TEXT NOT NULL,
  previous_dose_mg NUMERIC NOT NULL,
  new_dose_mg   NUMERIC NOT NULL,
  edited_by     TEXT NOT NULL REFERENCES vt_users(id) ON DELETE RESTRICT,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vt_med_task_dose_edits_task
  ON vt_med_task_dose_edits (clinic_id, task_id);
