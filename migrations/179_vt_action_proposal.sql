-- VetTrack 2.0, Task 1.1 §1.1 — Shift Autopilot `action_proposal` shared
-- infrastructure (vt_action_proposal, vt_action_proposal_decision).
--
-- Hand-authored (NOT drizzle-kit generated): `drizzle-kit generate` fails in
-- this worktree on a pre-existing ESM/CJS resolution error in
-- server/schema/index.ts ("Cannot find module './core.js'"), independently
-- reproduced during this migration's authoring — same failure mode recorded
-- by the Task 0.2/0.3 spikes. This migration is purely additive: two new
-- enums + two new tables, cross-checked column-for-column against
-- server/schema/ops.ts.
--
-- Multi-tenancy: clinic_id is NOT NULL on both tables; every application
-- query filters by it (see server/lib/autopilot/action-proposal-writer.port.ts).
--
-- Idempotency: ux_vt_action_proposal_clinic_kind_session enforces one staged
-- proposal per (clinic_id, kind, source_session_id) — a worker's repeat scan
-- of the same session must not double-stage.
--
-- vt_action_proposal_decision is the append-only operations-memory table:
-- one row per approve/edit/reject, snapshotting the staged content alongside
-- the decision. Never updated once written.

DO $$ BEGIN
  CREATE TYPE vt_action_proposal_kind AS ENUM (
    'shift_handover_draft',
    'coordinator_reassign_off_roster',
    'restock_po_on_burn',
    'crash_cart_drift'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vt_action_proposal_status AS ENUM ('staged', 'approved', 'edited', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vt_action_proposal (
  id                    TEXT PRIMARY KEY,
  clinic_id             TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  kind                  vt_action_proposal_kind NOT NULL,
  status                vt_action_proposal_status NOT NULL DEFAULT 'staged',
  source_session_id     TEXT NOT NULL,
  summary               TEXT NOT NULL,
  cited_facts           JSONB NOT NULL,
  draft_content         JSONB NOT NULL,
  source_ref            JSONB NOT NULL,
  citation_validation   JSONB NOT NULL,
  edited_content        JSONB,
  rejection_reason      TEXT,
  decided_by_user_id    TEXT REFERENCES vt_users (id) ON DELETE SET NULL,
  decided_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_action_proposal_clinic_kind_session
  ON vt_action_proposal (clinic_id, kind, source_session_id);

CREATE INDEX IF NOT EXISTS idx_vt_action_proposal_clinic_status
  ON vt_action_proposal (clinic_id, status);

CREATE TABLE IF NOT EXISTS vt_action_proposal_decision (
  id                    TEXT PRIMARY KEY,
  proposal_id           TEXT NOT NULL REFERENCES vt_action_proposal (id) ON DELETE RESTRICT,
  clinic_id             TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  staged_summary        TEXT NOT NULL,
  staged_cited_facts    JSONB NOT NULL,
  staged_draft_content  JSONB NOT NULL,
  decision              vt_action_proposal_status NOT NULL,
  decided_by_user_id    TEXT NOT NULL REFERENCES vt_users (id) ON DELETE RESTRICT,
  decided_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_content        JSONB,
  rejection_reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_vt_action_proposal_decision_proposal
  ON vt_action_proposal_decision (proposal_id);

CREATE INDEX IF NOT EXISTS idx_vt_action_proposal_decision_clinic
  ON vt_action_proposal_decision (clinic_id);
