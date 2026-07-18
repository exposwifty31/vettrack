-- R-M1.1d — Reader-offline detection: persisted health state for dedup.
--
-- The reader-offline sweep (server/lib/rfid/reader-offline-sweep.ts) computes staleness from
-- vt_rfid_readers.last_reader_heartbeat_at (the reader's OWN heartbeat — a heartbeat ping OR an
-- accepted ingest batch from that reader; NEVER equipment.last_rfid* asset traffic, so a
-- healthy-but-quiet reader is not marked offline). To emit the `rfid_reader_offline` signal (and
-- its clear) ONLY on a status *change* — never a repeat while unchanged — the last-known health
-- state must be persisted, not recomputed-and-forgotten each sweep. This column is that state.
--
-- Values:
--   'unknown'  — never observed healthy (fresh / never-heartbeat reader). Not "offline": a reader
--                that has never transmitted is not a degradation, so it emits no signal.
--   'healthy'  — heartbeat within the per-clinic staleness threshold at last sweep.
--   'offline'  — heartbeat older than the threshold (or lost) at last sweep.
--
-- Only healthy->offline and offline->healthy transitions emit a signal (deduped via a
-- compare-and-set on this column). Additive + idempotent.

ALTER TABLE vt_rfid_readers
  ADD COLUMN IF NOT EXISTS reader_health_status text NOT NULL DEFAULT 'unknown';

ALTER TABLE vt_rfid_readers
  ADD COLUMN IF NOT EXISTS reader_health_changed_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vt_rfid_readers_health_status_ck'
  ) THEN
    ALTER TABLE vt_rfid_readers
      ADD CONSTRAINT vt_rfid_readers_health_status_ck
      CHECK (reader_health_status IN ('healthy', 'offline', 'unknown'));
  END IF;
END $$;

-- The sweep scans active readers per clinic; this supports that scan and the CAS write.
CREATE INDEX IF NOT EXISTS vt_rfid_readers_clinic_status_health_idx
  ON vt_rfid_readers (clinic_id, status, reader_health_status);
