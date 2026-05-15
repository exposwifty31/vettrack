-- Phase 3 PR 3.1: Typed task-ownership schema foundation.
--
-- Adds nullable acknowledged_user_id (FK -> vt_users.id) and acknowledged_at
-- columns on vt_appointments, plus a partial index suitable for the future
-- stale-ownership sweeper lookup. This PR is foundation-only:
--   * no service code reads or writes these columns
--   * no evaluator or worker consumes them
--   * no backfill
-- The existing free-form metadata.acknowledgedBy string remains the
-- authoritative ownership marker and is untouched. ON DELETE SET NULL
-- mirrors the existing pattern on vt_appointments.escalated_to so user
-- deletions do not cascade-destroy task rows or audit lineage.

ALTER TABLE vt_appointments
  ADD COLUMN IF NOT EXISTS acknowledged_user_id TEXT
    REFERENCES vt_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- Partial index supports the future stale-ownership sweeper (Phase 3 PR 3.6+),
-- which scans for (clinic, owner, status) when an owner's clinical check-in
-- ends. The WHERE clause keeps the index lean while the column rolls out.
CREATE INDEX IF NOT EXISTS idx_vt_appointments_clinic_acked_user_status
  ON vt_appointments (clinic_id, acknowledged_user_id, status)
  WHERE acknowledged_user_id IS NOT NULL;
