-- R-M1.1c — durable state for the per-clinic RFID HMAC secret-rotation contract.
--
-- The plaintext secrets themselves live ONLY in the encrypted credential blob
-- (vt_server_config via credential-manager, adapter "rfid": webhook_secret +
-- previous_webhook_secret). This table stores rotation *state* — never the
-- plaintext — so a same-key retry can replay the original envelope without
-- re-issuing (or re-delivering) a secret. See server/lib/rfid/provisioning.ts.
--
-- Lifecycle (status):
--   grace       -> current + previous both verify during rotation_started_at..grace_expires_at;
--                  previous is retained; rollback is available.
--   completed   -> previous invalidated (grace expired OR every snapshot reader acked, whichever
--                  first) OR a no-previous / no-active-reader rotation that finalized immediately;
--                  rollback unavailable.
--   rolled_back -> previous restored as current + the newly issued secret invalidated.
--
-- previous_retained mirrors "rollback still possible": true ONLY while status='grace' and the
-- previous secret is still valid. It is the concurrency key: a partial UNIQUE index guarantees
-- AT MOST ONE in-flight (previous_retained) rotation per clinic, so two admins rotating at once
-- resolve to exactly one winner (the loser's INSERT trips the index → ROTATION_IN_PROGRESS).
--
-- snapshot_reader_ids / acked_reader_ids are JSONB arrays of vt_rfid_readers.id snapshotted at
-- rotation start (readers added mid-grace never block completion). All lifecycle queries are
-- clinic-scoped; (clinic_id, id) is uniquely addressable so a cross-clinic rotationId is NOT_FOUND.
--
-- Hand-authored: drizzle-kit generate is non-functional in this repo (its CJS loader cannot
-- resolve the schema's ESM `.js` imports), matching migrations 164-172. Additive + idempotent.

CREATE TABLE IF NOT EXISTS vt_rfid_secret_rotations (
  clinic_id           TEXT NOT NULL REFERENCES vt_clinics(id) ON DELETE CASCADE,
  id                  TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'grace'
                        CHECK (status IN ('grace', 'completed', 'rolled_back')),
  rotation_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grace_expires_at    TIMESTAMPTZ NOT NULL,
  snapshot_reader_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  acked_reader_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  previous_retained   BOOLEAN NOT NULL DEFAULT true,
  secret_delivered    BOOLEAN NOT NULL DEFAULT true,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotency uniqueness is clinic-scoped: a same-key retry replays the original.
  PRIMARY KEY (clinic_id, idempotency_key)
);

-- A rotationId must be uniquely addressable within a clinic (rollback / ack lookups).
CREATE UNIQUE INDEX IF NOT EXISTS vt_rfid_secret_rotations_clinic_id_uq
  ON vt_rfid_secret_rotations (clinic_id, id);

-- Concurrency gate: AT MOST ONE in-flight (previous-retained) rotation per clinic.
CREATE UNIQUE INDEX IF NOT EXISTS vt_rfid_secret_rotations_one_inflight_uq
  ON vt_rfid_secret_rotations (clinic_id)
  WHERE previous_retained = true;
