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

ALTER TABLE vt_docks ADD COLUMN IF NOT EXISTS asset_type_id TEXT
  REFERENCES vt_asset_types (id) ON DELETE SET NULL;
ALTER TABLE vt_docks ADD COLUMN IF NOT EXISTS capacity INTEGER;
ALTER TABLE vt_equipment ADD COLUMN IF NOT EXISTS home_room_id TEXT
  REFERENCES vt_rooms (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vt_docks_clinic_room_assettype_uq
  ON vt_docks (clinic_id, room_id, asset_type_id) WHERE asset_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vt_equipment_clinic_home_room
  ON vt_equipment (clinic_id, home_room_id);
