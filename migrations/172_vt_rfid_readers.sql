-- R-M1.1a — Managed RFID reader entity `vt_rfid_readers`.
--
-- Promotes "reader" from an inferred derived-list (rooms.gateway_code) to a
-- first-class, directional, tenant-safe managed entity. Additive and idempotent
-- throughout (IF NOT EXISTS / guarded DO-blocks): the table is brand-new/empty by
-- construction and the backfill projects the existing populated vt_rooms mapping.
--
-- PINNED tenant safety is enforced IN THE DB (not merely in service queries):
--   * composite UNIQUE (clinic_id, gateway_code) — the authoritative gateway↔reader
--     registry, unique per clinic (not globally).
--   * composite FKs (clinic_id, room_id|from_room_id|to_room_id) -> vt_rooms(clinic_id, id)
--     so every non-null room endpoint references a room IN THE SAME clinic. The FKs are
--     nullable (MATCH SIMPLE): a NULL endpoint = the external zone and is not checked;
--     a non-null endpoint is always same-clinic. This needs UNIQUE (clinic_id, id) on
--     vt_rooms (added below if absent) as the FK target.
--
-- PINNED directional-pair validity + roomId-membership fire ONLY when gate_type is SET.
-- A legacy_unconfigured reader (gate_type UNSET, room_id set, both endpoints NULL) is
-- EXEMPT + VALID — it serves last-seen but NOT directional egress until an admin
-- completes configuration. See ADR-006 (RFID advisory-only, vendor-neutral).
--
-- Gateway ownership (single source of truth): rooms.gateway_code is migrated INTO
-- vt_rfid_readers via a one-time backfill (one managed reader per populated
-- rooms.gateway_code, provisioning_state='legacy_unconfigured', gate_type/adjacency
-- UNSET). After this, the gateway registry lives in vt_rfid_readers; the two mappings
-- are no longer independent. rooms.gateway_code is retained (ingest still reads it) and
-- the ingest-resolution flip to vt_rfid_readers is a later card (R-M1.2) — never a
-- second independent mapping.

-- --- FK target: UNIQUE (clinic_id, id) on vt_rooms (idempotent) ---
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vt_rooms_clinic_id_uq'
  ) THEN
    ALTER TABLE vt_rooms ADD CONSTRAINT vt_rooms_clinic_id_uq UNIQUE (clinic_id, id);
  END IF;
END $$;

-- --- managed reader entity ---
CREATE TABLE IF NOT EXISTS vt_rfid_readers (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  gateway_code TEXT NOT NULL,
  -- canonical physical mounting room (where the device sits)
  room_id TEXT,
  -- directional adjacency endpoints (external zone = NULL); routing keys off gate_type
  from_room_id TEXT,
  to_room_id TEXT,
  -- typed, deterministic boundary classification the egress rule (R-M1.2c) keys on.
  -- UNSET (NULL) => legacy_unconfigured: serves last-seen but not directional egress.
  gate_type TEXT,
  physical_location TEXT,           -- descriptive only; NEVER used for routing
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,         -- informational: last accepted asset (equipment) read; display only
  last_reader_heartbeat_at TIMESTAMPTZ, -- dedicated reader-health timestamp (R-M1.1d)
  provisioning_state TEXT NOT NULL DEFAULT 'legacy_unconfigured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- gate_type is either UNSET or one of the three typed classifications
  CONSTRAINT vt_rfid_readers_gate_type_ck
    CHECK (gate_type IS NULL OR gate_type IN ('internal', 'boundary', 'dock')),

  -- Directional-pair validity + roomId membership — ONLY when gate_type is SET.
  -- gate_type IS NULL (legacy_unconfigured) short-circuits to TRUE: fully exempt.
  CONSTRAINT vt_rfid_readers_directional_ck CHECK (
    gate_type IS NULL
    OR (
      gate_type = 'internal'
      AND from_room_id IS NOT NULL
      AND to_room_id IS NOT NULL
      AND from_room_id <> to_room_id
      AND room_id IS NOT NULL
      AND (room_id = from_room_id OR room_id = to_room_id)
    )
    OR (
      gate_type IN ('boundary', 'dock')
      AND (
        (room_id IS NOT NULL AND from_room_id IS NOT NULL AND to_room_id IS NULL AND room_id = from_room_id)
        OR (room_id IS NOT NULL AND from_room_id IS NULL AND to_room_id IS NOT NULL AND room_id = to_room_id)
      )
    )
  ),

  -- Tenant-safe composite unique registry: (clinic_id, gateway_code)
  CONSTRAINT vt_rfid_readers_clinic_gateway_uq UNIQUE (clinic_id, gateway_code),

  -- Tenant-safe composite FKs: every non-null room endpoint is same-clinic.
  -- PG15+ COLUMN-LIST `ON DELETE SET NULL (room column)`: a plain SET NULL would try to
  -- null the NOT NULL clinic_id too and error. Column-list SET NULL nulls ONLY the room
  -- column and preserves clinic_id — mirroring equipment.roomId soft-null. Because the
  -- directional CHECK requires both endpoints of a configured internal gate to be non-null,
  -- SET-NULLing an endpoint of a CONFIGURED reader violates the CHECK and the room delete is
  -- blocked (must reconfigure first); a legacy_unconfigured reader (gate_type UNSET) is exempt
  -- and simply loses its room_id.
  CONSTRAINT vt_rfid_readers_room_fk
    FOREIGN KEY (clinic_id, room_id) REFERENCES vt_rooms (clinic_id, id) ON DELETE SET NULL (room_id),
  CONSTRAINT vt_rfid_readers_from_room_fk
    FOREIGN KEY (clinic_id, from_room_id) REFERENCES vt_rooms (clinic_id, id) ON DELETE SET NULL (from_room_id),
  CONSTRAINT vt_rfid_readers_to_room_fk
    FOREIGN KEY (clinic_id, to_room_id) REFERENCES vt_rooms (clinic_id, id) ON DELETE SET NULL (to_room_id)
);

CREATE INDEX IF NOT EXISTS vt_rfid_readers_clinic_room_idx
  ON vt_rfid_readers (clinic_id, room_id);

-- --- one-time backfill: rooms.gateway_code -> managed reader (legacy_unconfigured) ---
-- NOT EXISTS guard keeps this idempotent and safe against partial re-runs.
INSERT INTO vt_rfid_readers
  (id, clinic_id, name, gateway_code, room_id, provisioning_state, status, created_at)
SELECT
  gen_random_uuid()::text,
  r.clinic_id,
  'Gateway ' || r.gateway_code,
  r.gateway_code,
  r.id,
  'legacy_unconfigured',
  'active',
  now()
FROM vt_rooms r
WHERE r.gateway_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vt_rfid_readers rr
    WHERE rr.clinic_id = r.clinic_id AND rr.gateway_code = r.gateway_code
  );
