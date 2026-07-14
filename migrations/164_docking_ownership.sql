-- Docking ownership schema (docking-as-first-class, P1).
--
-- Hand-authored (NOT drizzle-kit generated): the Drizzle snapshot is drifted
-- (see 160_vt_display_devices.sql), so `generate` emits spurious rename/drop
-- prompts and DROP/ALTER statements across dozens of unrelated tables/enums.
-- This migration is purely additive: two new columns on vt_docks, one new
-- column on vt_equipment, and two new indexes.
--
-- `docks.asset_type_id` is nullable-in-transition rather than the design
-- doc's target of NOT NULL: existing dock rows have no category, and a
-- NOT NULL add is not additive-safe against them. Uniqueness is enforced
-- with a partial index (`WHERE asset_type_id IS NOT NULL`) instead, mirroring
-- how `equipment.asset_type_id` (server/schema/equipment.ts:148) stays
-- nullable. A later migration can tighten to NOT NULL once every dock has
-- been assigned a category.
--
-- Lock-safety + idempotency: the migration runner wraps every file in a single
-- BEGIN/COMMIT (server/migrate.ts), so `CREATE INDEX CONCURRENTLY` cannot be
-- used here — both indexes below build under a standard lock, acceptable at
-- per-clinic table sizes. The two new foreign keys are added column-first, then
-- `NOT VALID` (skips the initial validating scan — a no-op anyway since both
-- columns are brand-new and NULL on every existing row, and it keeps ADD
-- CONSTRAINT a fast metadata-only change instead of a SHARE ROW EXCLUSIVE scan
-- lock), then immediately `VALIDATE CONSTRAINT` so the catalog records both FKs
-- as fully validated (also a no-op scan on the all-NULL columns). Each ADD
-- CONSTRAINT is guarded by a pg_constraint existence check, and VALIDATE on an
-- already-valid constraint is a no-op, so the whole file is safe to replay.

ALTER TABLE vt_docks ADD COLUMN IF NOT EXISTS asset_type_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vt_docks_asset_type_id_fkey' AND conrelid = 'vt_docks'::regclass
  ) THEN
    ALTER TABLE vt_docks
      ADD CONSTRAINT vt_docks_asset_type_id_fkey
      FOREIGN KEY (asset_type_id) REFERENCES vt_asset_types (id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE vt_docks VALIDATE CONSTRAINT vt_docks_asset_type_id_fkey;

ALTER TABLE vt_docks ADD COLUMN IF NOT EXISTS capacity INTEGER;

ALTER TABLE vt_equipment ADD COLUMN IF NOT EXISTS home_room_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vt_equipment_home_room_id_fkey' AND conrelid = 'vt_equipment'::regclass
  ) THEN
    ALTER TABLE vt_equipment
      ADD CONSTRAINT vt_equipment_home_room_id_fkey
      FOREIGN KEY (home_room_id) REFERENCES vt_rooms (id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE vt_equipment VALIDATE CONSTRAINT vt_equipment_home_room_id_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS vt_docks_clinic_room_assettype_uq
  ON vt_docks (clinic_id, room_id, asset_type_id) WHERE asset_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vt_equipment_clinic_home_room
  ON vt_equipment (clinic_id, home_room_id);
