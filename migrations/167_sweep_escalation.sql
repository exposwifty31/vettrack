-- Room Sweep escalation ladder (docking P3 T3.4-ii).
--
-- Extends vt_shift_equipment_coordinator (166_equipment_coordinator.sql) so
-- the same per-(clinic, shift_date) row doubles as the sweep-responsibility +
-- escalation record. The escalation worker (server/workers/sweep-escalation.worker.ts)
-- UPSERTs this row: auto/fallback_senior coordinators (derived, never
-- confirmed) have no stored row until the first stage advances.
--
-- escalation_stage: 0 (none) | 1 (coordinator reminded) | 2 (senior tech
--   notified) | 3 (responsibility auto-transferred to senior) | 4 (open to
--   all techs + manager notified). Monotonic within a shift — the worker
--   only ever advances it, never re-fires an already-reached stage.
-- current_responsible_user_id: null until stage 3 sets it to the senior
--   tech; stage 4 clears it back to null (open to all, no single owner).
-- escalated_at: when escalation_stage last advanced.
--
-- Additive/idempotent: ADD COLUMN IF NOT EXISTS on the existing
-- vt_shift_equipment_coordinator table (populated by 166_equipment_coordinator.sql
-- confirmations) — see 166's own header for why no DO-block/NOT VALID
-- staging is required for a plain nullable/defaulted column add.

ALTER TABLE vt_shift_equipment_coordinator ADD COLUMN IF NOT EXISTS escalation_stage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vt_shift_equipment_coordinator ADD COLUMN IF NOT EXISTS current_responsible_user_id TEXT REFERENCES vt_users (id) ON DELETE SET NULL;
ALTER TABLE vt_shift_equipment_coordinator ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
