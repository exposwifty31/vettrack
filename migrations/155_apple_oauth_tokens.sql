-- Sign in with Apple refresh-token store.
--
-- Supports App Store Guideline 5.1.1(v) in-app account deletion: when a user
-- deletes their account we must call Apple's `/auth/revoke` REST endpoint to
-- invalidate their tokens. Clerk's native id-token flow never gives us a
-- refresh token, so we capture the Apple `authorizationCode` at sign-in,
-- exchange it at `/auth/token`, and store the resulting refresh token here.
--
-- The refresh token is stored AES-256-GCM encrypted (the `enc:v1:` envelope
-- from server/lib/config-crypto.ts) — never plaintext.
--
-- ON DELETE CASCADE on user_id removes the row automatically when the user row
-- is hard-deleted. The deletion flow revokes at Apple BEFORE the row is gone.

CREATE TABLE IF NOT EXISTS vt_apple_oauth_tokens (
  id            TEXT PRIMARY KEY,
  clinic_id     TEXT NOT NULL REFERENCES vt_clinics (id) ON DELETE RESTRICT,
  user_id       TEXT NOT NULL UNIQUE REFERENCES vt_users (id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  apple_sub     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vt_apple_oauth_tokens_clinic
  ON vt_apple_oauth_tokens (clinic_id);
