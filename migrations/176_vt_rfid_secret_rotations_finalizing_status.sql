-- FS-1 — add a `finalizing` intermediate state to the RFID secret-rotation lifecycle.
--
-- Closes the transient-`completed` window in finalizeRotation (see
-- server/lib/rfid/provisioning.ts + docs/audit/rfid-rotation-finalizing-state-backlog.md).
-- The row is now committed to `finalizing` BEFORE the external credential-store delete of
-- the retained previous secret, and only CAS-flips to `completed` AFTER that delete durably
-- commits. A delete failure reverts `finalizing` -> `grace` (previous still retained), so a
-- concurrent ack/reader never observes a terminal `completed` for a rotation that ends in `grace`.
--
-- Lifecycle (status):
--   grace       -> current + previous both verify; previous retained; rollback available.
--   finalizing  -> finalize claimed the row; the external `previous` delete is in flight. Previous
--                  is STILL retained (previous_retained = true) and STILL verifies while the blob
--                  carries it; NON-TERMINAL; rollback unavailable. Reverts to `grace` on delete
--                  failure, advances to `completed` on delete success.
--   completed   -> previous invalidated (delete durably committed); rollback unavailable.
--   rolled_back -> previous restored as current + the newly issued secret invalidated.
--
-- The CHECK constraint from migration 173 was an inline column constraint, so Postgres named it
-- `vt_rfid_secret_rotations_status_check`. Drop + recreate it to widen the accepted set. Safe on
-- a populated table: `finalizing` is purely additive and every pre-existing value is preserved.
--
-- Hand-authored (drizzle-kit generate is non-functional in this repo). Additive + idempotent.

ALTER TABLE vt_rfid_secret_rotations
  DROP CONSTRAINT IF EXISTS vt_rfid_secret_rotations_status_check;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vt_rfid_secret_rotations_status_check'
  ) THEN
    ALTER TABLE vt_rfid_secret_rotations
      ADD CONSTRAINT vt_rfid_secret_rotations_status_check
      CHECK (status IN ('grace', 'finalizing', 'completed', 'rolled_back'));
  END IF;
END $$;
