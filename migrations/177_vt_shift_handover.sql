-- R-SH-F1.1 — Shift-handover artifact table (vt_shift_handover).
--
-- Hand-authored (NOT drizzle-kit generated): the Drizzle snapshot is drifted
-- (see 164_docking_ownership.sql), so `generate` emits spurious rename/drop
-- prompts across unrelated tables. This migration is purely additive: one new,
-- brand-new table + its unique key and current-revision lookup index. Nothing
-- else is touched.
--
-- Migration number 177: origin/main is at 171; 172–176 are reserved by the open
-- RFID PR (#113, merges first). 177 is unique regardless of merge order — the
-- table is independent/additive (no FK to RFID or to the removed internal
-- patient/ER tables, migrations 142–143).
--
-- Multi-tenancy: `clinic_id` is NOT NULL and every query filters by it; the
-- unique key and lookup index are both clinic-scoped. `shift_session_id` is
-- FK-free by design — roster-window ids ("win:<clinic>:<date>:<start>") and
-- legacy vt_shift_sessions ids coexist there, mirroring vt_shift_messages.
--
-- Additive/idempotent throughout: CREATE TABLE/INDEX IF NOT EXISTS on a
-- brand-new (empty by construction) table — safe to replay.

CREATE TABLE IF NOT EXISTS vt_shift_handover (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  shift_session_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deltas JSONB NOT NULL,
  open_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  patient_worklist JSONB NOT NULL,
  acknowledged_by TEXT REFERENCES vt_users (id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  -- Explicit per-artifact, clinic-scoped notification read-state:
  -- NULL = unread; a timestamp = read. Acknowledge sets it; unconfirm clears it.
  notification_read_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Persisted key: monotonic revision per (clinic, session); current = max(revision).
CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_shift_handover_clinic_session_revision
  ON vt_shift_handover (clinic_id, shift_session_id, revision);

-- Current-artifact lookup (max revision per session), clinic-scoped.
CREATE INDEX IF NOT EXISTS idx_vt_shift_handover_clinic_session_current
  ON vt_shift_handover (clinic_id, shift_session_id, revision DESC);
