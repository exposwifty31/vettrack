-- Clinic join codes — invite-free sign-up membership.
--
-- Hand-authored (NOT drizzle-kit generated): the Drizzle snapshot is drifted
-- (see 164_docking_ownership.sql / 177_vt_shift_handover.sql), so `generate`
-- emits spurious rename/drop prompts across unrelated tables. This migration is
-- purely additive: one nullable column + its unique index on vt_clinics.
--
-- signup_join_code: opaque per-clinic join code. NULL = joining disabled
-- (the default for every clinic until an admin generates one). A holder of the
-- code can only provision themselves as a status='pending' vt_users row in that
-- clinic via POST /api/auth/join-clinic — the admin approval gate stays the
-- authorization step. Globally unique so the code alone resolves the clinic
-- (same pattern as vt_display_devices.token_hash).
--
-- Additive/idempotent throughout: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE
-- INDEX IF NOT EXISTS — safe to replay.

ALTER TABLE vt_clinics ADD COLUMN IF NOT EXISTS signup_join_code text;

CREATE UNIQUE INDEX IF NOT EXISTS vt_clinics_signup_join_code_unique
  ON vt_clinics (signup_join_code)
  WHERE signup_join_code IS NOT NULL;
