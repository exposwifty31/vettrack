-- Phase 3 PR 3.2: Manual-confirm queue for typed task-ownership backfill.
--
-- The backfill worker (server/workers/taskOwnershipBackfill.worker.ts) writes
-- rows here only when the resolver (server/lib/task-ownership-resolver.ts)
-- cannot auto-resolve a historical `metadata.acknowledgedBy` value to an
-- exact same-clinic active user via `vt_users.id` or `vt_users.clerk_id`.
-- Auto-resolutions do not appear in this table.
--
-- The (clinic_id, appointment_id, raw_acknowledged_by) uniqueness constraint
-- makes the queue idempotent: re-running the backfill never duplicates
-- pending rows. Worker uses ON CONFLICT DO NOTHING.
--
-- Foreign keys:
--   clinic_id        -> vt_clinics(id)        ON DELETE RESTRICT (tenant invariant)
--   appointment_id   -> vt_appointments(id)   ON DELETE CASCADE  (queue row is meaningless if task vanishes)
--   confirmed_user_id, resolved_by_user_id -> vt_users(id) ON DELETE SET NULL
--
-- This PR is backend-only: no UI, no client surface. Admins resolve rows
-- via POST /api/admin/task-ownership/queue/:id/{confirm,reject,skip}.

CREATE TABLE IF NOT EXISTS vt_task_ownership_confirm_queue (
  id                     TEXT         PRIMARY KEY,
  clinic_id              TEXT         NOT NULL REFERENCES vt_clinics(id)      ON DELETE RESTRICT,
  appointment_id         TEXT         NOT NULL REFERENCES vt_appointments(id) ON DELETE CASCADE,
  raw_acknowledged_by    TEXT         NOT NULL,
  candidate_user_ids     JSONB        NOT NULL DEFAULT '[]'::jsonb,
  resolution_reason      VARCHAR(40)  NOT NULL,
  matcher_version        VARCHAR(20)  NOT NULL,
  resolved_source        VARCHAR(30)  NOT NULL DEFAULT 'pending',
  confirmed_user_id      TEXT         REFERENCES vt_users(id) ON DELETE SET NULL,
  resolved_by_user_id    TEXT         REFERENCES vt_users(id) ON DELETE SET NULL,
  resolved_at            TIMESTAMPTZ,
  created_by_job_id      TEXT         NOT NULL,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Idempotency: re-running the backfill never duplicates pending rows for the
-- same (clinic, appointment, raw_acknowledged_by) triple.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_task_ownership_confirm_queue_triple
  ON vt_task_ownership_confirm_queue (clinic_id, appointment_id, raw_acknowledged_by);

-- Powers the admin queue listing and queue-depth gauge: filter pending rows
-- by clinic, ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_vt_task_ownership_confirm_queue_clinic_pending
  ON vt_task_ownership_confirm_queue (clinic_id, created_at)
  WHERE resolved_source = 'pending';

-- Reverse lookup: does a given task have any queue rows?
CREATE INDEX IF NOT EXISTS idx_vt_task_ownership_confirm_queue_appointment
  ON vt_task_ownership_confirm_queue (appointment_id);
