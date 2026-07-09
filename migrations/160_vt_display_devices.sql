-- Phase 9 — Display-device pairing.
--
-- A paired, headless display device (kiosk / command board) authenticates with
-- a long-lived bearer token. Only the sha256 hex hash of the token is stored
-- here (token_hash) — the raw token is returned to the device exactly once at
-- pair/claim time and never persisted. Every auth lookup filters on
-- `revoked_at IS NULL`; a revoked row can never authenticate again.
--
-- This is the deliberate opposite of the ephemeral display-heartbeat contract:
-- it IS a persistent device identity, kept separate from the in-process /
-- Redis-TTL heartbeat liveness store. `last_seen_at` is a best-effort presence
-- bump only and carries no clinical, authority, billing, or audit meaning.
--
-- Hand-authored (NOT drizzle-kit generated): the Drizzle snapshot is drifted, so
-- `generate` would emit spurious DROP/ALTER for dozens of tables. One new table,
-- two indexes, zero ALTERs. Columns mirror `displayDevices` in server/schema/ops.ts.

CREATE TABLE IF NOT EXISTS vt_display_devices (
  id            TEXT PRIMARY KEY,
  clinic_id     TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  last_seen_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global uniqueness of the token hash: the auth lookup is by token_hash alone
-- (clinic is derived from the matched row), so a hash must map to one device.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_display_devices_token_hash
  ON vt_display_devices (token_hash);

-- Partial index for the clinic-scoped active-device listing / admin console.
CREATE INDEX IF NOT EXISTS idx_vt_display_devices_clinic_active
  ON vt_display_devices (clinic_id)
  WHERE revoked_at IS NULL;
