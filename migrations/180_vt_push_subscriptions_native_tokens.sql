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

-- 3b. per-platform column validity (added AFTER the web columns become nullable).
--     Route validation only guards the API surface — this CHECK protects direct
--     DB writers and future code paths. Web rows must carry the web-push triple
--     (endpoint/p256dh/auth) and NO token; native rows (ios/android/expo) must
--     carry a token and NONE of the web columns. Existing web rows (triple set,
--     token NULL) and route-inserted native rows (token only) both satisfy it.
ALTER TABLE vt_push_subscriptions
  DROP CONSTRAINT IF EXISTS vt_push_subscriptions_platform_columns_check;
ALTER TABLE vt_push_subscriptions
  ADD CONSTRAINT vt_push_subscriptions_platform_columns_check
  CHECK (
    (platform = 'web'
      AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL
      AND token IS NULL)
    OR
    (platform IN ('ios', 'android', 'expo')
      AND token IS NOT NULL
      AND endpoint IS NULL AND p256dh IS NULL AND auth IS NULL)
  );

-- 4. one row per (clinic, native device token). Partial + CLINIC-SCOPED: native
--    token ownership is per-tenant, so the same physical device token can register
--    in two clinics without one clinic's re-register deleting the other clinic's
--    row (the route's delete-by-token dedup is likewise scoped by clinic_id). Web
--    rows have token NULL and are excluded (Postgres permits many NULLs). Drop the
--    earlier global single-column index if a prior version of this migration ran.
DROP INDEX IF EXISTS ux_vt_push_subscriptions_token;
CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_push_subscriptions_clinic_token
  ON vt_push_subscriptions (clinic_id, token)
  WHERE token IS NOT NULL;
