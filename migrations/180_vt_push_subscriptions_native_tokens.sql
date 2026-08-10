-- Native push tokens (APNs / FCM / Expo) for vt_push_subscriptions — ADR-009 (G4-2).
--
-- Hand-authored (NOT drizzle-kit generated): the Drizzle snapshot is drifted
-- (see 178_vt_clinics_signup_join_code.sql), so `generate` emits spurious
-- rename/drop prompts across unrelated tables. This migration extends the
-- web-push-only table to a platform-tagged token model so an APNs/FCM/Expo
-- device token can be stored — today the NOT NULL endpoint/p256dh/auth columns
-- plus the URL-endpoint validator reject a native device token outright.
--
-- Additive / idempotent throughout (ADD COLUMN IF NOT EXISTS, DROP..IF EXISTS,
-- ALTER..DROP NOT NULL, CREATE INDEX IF NOT EXISTS) — safe to replay. Existing
-- web rows backfill to platform='web' via the column DEFAULT and are otherwise
-- untouched, so the web PWA path keeps working.

-- 1. platform discriminator. text + CHECK rather than an enum: CREATE TYPE has
--    no IF NOT EXISTS and pg enums are painful to extend. The DEFAULT backfills
--    every existing row to 'web'.
ALTER TABLE vt_push_subscriptions
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'web';

ALTER TABLE vt_push_subscriptions
  DROP CONSTRAINT IF EXISTS vt_push_subscriptions_platform_check;
ALTER TABLE vt_push_subscriptions
  ADD CONSTRAINT vt_push_subscriptions_platform_check
  CHECK (platform IN ('web', 'ios', 'android', 'expo'));

-- 2. native device token (nullable — only ios/android/expo rows carry it).
ALTER TABLE vt_push_subscriptions
  ADD COLUMN IF NOT EXISTS token text;

-- 3. web-push columns become nullable so native rows (endpoint/p256dh/auth NULL)
--    are valid. Existing web rows already have values and are unaffected.
ALTER TABLE vt_push_subscriptions ALTER COLUMN endpoint DROP NOT NULL;
ALTER TABLE vt_push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE vt_push_subscriptions ALTER COLUMN auth DROP NOT NULL;

-- 4. one row per native device token. Partial: web rows have token NULL and are
--    excluded (Postgres permits many NULLs), so native and web rows coexist.
--    Mirrors the existing endpoint UNIQUE for the web path and backs the
--    delete-by-token dedup on device re-register.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_push_subscriptions_token
  ON vt_push_subscriptions (token)
  WHERE token IS NOT NULL;
