-- Anchor evidence schema (docking-as-first-class, P2).
--
-- An anchor is an accountable, timestamped "this item is at its station"
-- assertion (design §3.3/§4). It never expires by time — only by
-- contradiction (D-13): a later event invalidates the prior anchor by
-- setting invalidated_at/invalidated_reason on it, never by deleting or
-- updating asserted_* fields. The stream is append-only; the "current
-- anchor" for an item is the latest row with invalidated_at IS NULL.
--
-- This is a brand-new, empty table, so it is idempotent by construction:
-- CREATE TABLE/INDEX IF NOT EXISTS plus inline FK/CHECK constraints. No
-- DO-block/NOT VALID staging is needed here — that pattern (see
-- 164_docking_ownership.sql) is only required when altering an existing,
-- populated table under a lock-safety constraint.

CREATE TABLE IF NOT EXISTS vt_equipment_anchors (
  id                  TEXT PRIMARY KEY,
  clinic_id           TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  equipment_id        TEXT NOT NULL REFERENCES vt_equipment (id) ON DELETE CASCADE,
  dock_id             TEXT REFERENCES vt_docks (id) ON DELETE SET NULL,
  room_id             TEXT REFERENCES vt_rooms (id) ON DELETE SET NULL,
  asserted_by_id      TEXT,
  asserted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source              TEXT NOT NULL CHECK (source IN ('return_toggle', 'sweep', 'citizen', 'smart_charger')),
  invalidated_at      TIMESTAMPTZ,
  invalidated_reason  TEXT CHECK (invalidated_reason IN ('checkout', 'rfid_elsewhere', 'sweep_missing', 'not_found_here')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vt_equipment_anchors_clinic_equipment_asserted
  ON vt_equipment_anchors (clinic_id, equipment_id, asserted_at);
CREATE INDEX IF NOT EXISTS idx_vt_equipment_anchors_current
  ON vt_equipment_anchors (clinic_id, equipment_id) WHERE invalidated_at IS NULL;
