-- R-M1.2c — Idempotent `possible_egress` signal store `vt_rfid_egress_signals`.
--
-- A directional RFID exit through a boundary/dock gate (gate_type ∈ {boundary,dock})
-- toward the external-zone (NULL) endpoint, with NO matching prior entry in the window,
-- is a "possible egress" (the asset may have physically left the clinic). R-M1.2c pins
-- this as an IDEMPOTENT bounded-enum signal: exactly one row per genuine egress.
--
-- Correlation key (PINNED): (clinic_id, equipment_id, gate_id, source_event_id). The
-- source_event_id is a deterministic fingerprint of the intrinsic read (equipment +
-- gateway + readAt + direction) — NOT the batch id — so a retry or an out-of-order batch
-- that re-reports the SAME physical read collapses to the SAME key and dedupes, while two
-- distinct exits through one gate (different readAt) stay separate rows. The UNIQUE
-- constraint makes `INSERT ... ON CONFLICT DO NOTHING` the dedup primitive.
--
-- Advisory-only (ADR-006): this table records movement EVIDENCE. It NEVER mutates custody.
--
-- Tenant safety is enforced IN THE DB (not merely in service queries): the correlation
-- UNIQUE is clinic-scoped, and composite FKs pin equipment_id + gate_id to the SAME clinic.
-- Both need UNIQUE (clinic_id, id) on their target tables (added below if absent).

-- --- FK targets: UNIQUE (clinic_id, id) (idempotent) ---
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vt_equipment_clinic_id_uq'
  ) THEN
    ALTER TABLE vt_equipment ADD CONSTRAINT vt_equipment_clinic_id_uq UNIQUE (clinic_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vt_rfid_readers_clinic_id_uq'
  ) THEN
    ALTER TABLE vt_rfid_readers ADD CONSTRAINT vt_rfid_readers_clinic_id_uq UNIQUE (clinic_id, id);
  END IF;
END $$;

-- --- egress signal store ---
CREATE TABLE IF NOT EXISTS vt_rfid_egress_signals (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  equipment_id TEXT NOT NULL,
  -- the gate (reader) the exit was detected through
  gate_id TEXT NOT NULL,
  gateway_code TEXT NOT NULL,
  -- deterministic fingerprint of the intrinsic read (dedup key component)
  source_event_id TEXT NOT NULL,
  -- internal room the asset exited FROM (the boundary/dock gate's non-null endpoint)
  from_room_id TEXT,
  -- batch that produced this signal (diagnostic only; NOT part of the correlation key)
  batch_id TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- PINNED correlation key — idempotency primitive (retries + out-of-order batches dedupe)
  CONSTRAINT vt_rfid_egress_signals_correlation_uq
    UNIQUE (clinic_id, equipment_id, gate_id, source_event_id),

  -- Tenant-safe composite FKs: equipment + gate are same-clinic (enforced in the DB).
  CONSTRAINT vt_rfid_egress_signals_equipment_fk
    FOREIGN KEY (clinic_id, equipment_id) REFERENCES vt_equipment (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT vt_rfid_egress_signals_gate_fk
    FOREIGN KEY (clinic_id, gate_id) REFERENCES vt_rfid_readers (clinic_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS vt_rfid_egress_signals_clinic_equipment_detected_idx
  ON vt_rfid_egress_signals (clinic_id, equipment_id, detected_at);
