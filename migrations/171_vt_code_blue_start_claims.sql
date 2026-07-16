-- R-CBF-1.1a — durable idempotency CLAIM record for the one-tap Code Blue start.
--
-- The FIRST transactional step of R-CBF-1.1's orchestration: the per-gesture
-- (clinic_id, token) claim (R-CBF-1.3) is written in its OWN durable write
-- BEFORE any cart lookup or the atomic session transaction, so a session-txn
-- abort leaves the claim intact and its lease lets a later retry reclaim it.
--
-- States: claimed(fence, lease_until) -> committed -> released.
--   * fence is a MONOTONIC version token — a short TTL alone is unsafe against a
--     slow-but-still-active owner. Reclaiming an expired/released claim issues a
--     strictly higher fence, and only the current fence-holder may flip the
--     claim to 'committed' (a superseded fence is rejected on commit). See
--     server/lib/code-blue-start-claim.ts for the compare-and-set lifecycle.
--   * session_id is a plain nullable ref, NOT a FK — mirroring the R-CBF-1.2
--     soft-reserve rationale: a committed session is never deleted and a hard FK
--     would add an equipment/code-blue schema cycle.
--
-- (clinic_id, token) is the natural primary key (idempotency uniqueness). Every
-- lifecycle query is clinic-scoped. `state` is TEXT + CHECK (not a pg enum) so
-- the migration stays additive and matches the $type-narrowed schema.
--
-- Hand-authored: drizzle-kit generate is non-functional in this repo (its CJS
-- loader cannot resolve the schema's ESM `.js` imports — verified again for this
-- card), matching the convention of migrations 164-170. Additive + idempotent
-- (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS vt_code_blue_start_claims (
  clinic_id    TEXT NOT NULL REFERENCES vt_clinics(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  fence        BIGINT NOT NULL,
  lease_until  TIMESTAMPTZ NOT NULL,
  state        TEXT NOT NULL DEFAULT 'claimed'
                 CHECK (state IN ('claimed', 'committed', 'released')),
  session_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clinic_id, token)
);

CREATE INDEX IF NOT EXISTS idx_vt_code_blue_start_claims_clinic_state
  ON vt_code_blue_start_claims (clinic_id, state);
