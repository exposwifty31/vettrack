-- Web-push endpoint scoped to clinic (issue #226) — companion to migration 180's
-- clinic-scoped native token index. `endpoint` has been GLOBALLY unique since
-- 003_add_push_subscriptions.sql; 180 dropped only its NOT NULL, never the
-- uniqueness, when it extended the table to native tokens. server/routes/push.ts's
-- web-subscribe handler deletes-then-inserts scoped to (clinicId, endpoint) — code
-- written for a per-clinic model the schema never actually enforced — so the same
-- browser subscribing under a second clinic collides on
-- vt_push_subscriptions_endpoint_key and the insert throws a real unique-violation.
--
-- Same reasoning as 180's ux_vt_push_subscriptions_clinic_token: ownership is
-- per-tenant, so the same physical browser/endpoint can hold independent push
-- subscriptions in two clinics (e.g. staff working across locations) without one
-- clinic's row colliding with another's.
--
-- Idempotent (DROP..IF EXISTS / CREATE..IF NOT EXISTS) — safe to replay.

ALTER TABLE vt_push_subscriptions
  DROP CONSTRAINT IF EXISTS vt_push_subscriptions_endpoint_key;

-- Partial + CLINIC-SCOPED, mirroring ux_vt_push_subscriptions_clinic_token exactly.
-- Native rows have endpoint NULL (platform_columns_check) and are excluded (Postgres
-- permits many NULLs in a unique index).
CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_push_subscriptions_clinic_endpoint
  ON vt_push_subscriptions (clinic_id, endpoint)
  WHERE endpoint IS NOT NULL;
