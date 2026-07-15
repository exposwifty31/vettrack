-- Closed-domain CHECK on vt_shift_equipment_coordinator.source
-- (docking P3 PR #106 CodeRabbit — bound the source enum at the DB).
--
-- Migration 166 created vt_shift_equipment_coordinator.source as a bare TEXT
-- column ('auto' | 'confirmed' | 'fallback_senior' by convention only). 166 is
-- already applied on existing databases, so it must NOT be mutated (the runner
-- tracks applied files by name — server/migrate.ts). This additive follow-up
-- adds the CHECK constraint idempotently, guarded by a pg_constraint existence
-- check so replay is a no-op. Every existing row already satisfies the domain —
-- only these three values are ever written: confirmShiftCoordinator
-- (server/services/equipment-coordinator.service.ts) writes 'confirmed', and the
-- escalation worker (server/workers/sweep-escalation.worker.ts) writes a
-- 'auto' | 'confirmed' | 'fallback_senior'-typed value — so the validating scan
-- passes. The table is small (one row per (clinic, shift_date)); the brief
-- ACCESS EXCLUSIVE lock the validating ADD CONSTRAINT takes is acceptable at
-- that size (CREATE ... CONCURRENTLY is unavailable anyway — the runner wraps
-- each file in a single BEGIN/COMMIT).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vt_shift_equipment_coordinator_source_check'
      AND conrelid = 'vt_shift_equipment_coordinator'::regclass
  ) THEN
    ALTER TABLE vt_shift_equipment_coordinator
      ADD CONSTRAINT vt_shift_equipment_coordinator_source_check
      CHECK (source IN ('auto', 'confirmed', 'fallback_senior'));
  END IF;
END $$;
