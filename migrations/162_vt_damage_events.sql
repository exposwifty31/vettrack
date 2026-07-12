-- Damage report log for equipment (T-24a · R-EQ-F3).
--
-- Hand-authored (NOT drizzle-kit generated): the Drizzle snapshot is drifted
-- (see 160_vt_display_devices.sql), so `generate` emits spurious rename/drop
-- prompts and DROP/ALTER statements across dozens of unrelated tables/enums.
-- This migration is purely additive: one new table, one index, and one new
-- column on the existing vt_equipment table.
--
-- `condition_status` defaults to 'ok', mirroring the existing `status` column's
-- "ok" vocabulary (server/schema/equipment.ts) so every pre-existing
-- vt_equipment row backfills as not-damaged with no manual data migration.

ALTER TABLE vt_equipment ADD COLUMN IF NOT EXISTS condition_status TEXT NOT NULL DEFAULT 'ok';
-- Only 'ok' and 'damaged' are produced anywhere in the codebase today
-- (server/routes/equipment-damage.ts); extend this list (NOT VALID + VALIDATE
-- for a large table) if a future migration introduces another condition value.
ALTER TABLE vt_equipment ADD CONSTRAINT chk_vt_equipment_condition_status
  CHECK (condition_status IN ('ok', 'damaged'));

CREATE TABLE IF NOT EXISTS vt_damage_events (
  id            TEXT PRIMARY KEY,
  clinic_id     TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  equipment_id  TEXT NOT NULL REFERENCES vt_equipment (id) ON DELETE CASCADE,
  reported_by   TEXT NOT NULL,
  at            TIMESTAMP NOT NULL DEFAULT NOW(),
  note          TEXT,
  resolved_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vt_damage_events_clinic_equipment ON vt_damage_events (clinic_id, equipment_id);
