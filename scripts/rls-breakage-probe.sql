-- G7 RLS breakage probe — cross-clinic-BY-DESIGN paths that a naive
-- "policy on every clinic_id table" would silently break.
--
-- SAFE: every block is BEGIN..ROLLBACK. Postgres DDL is transactional, so the
-- ENABLE/FORCE/CREATE POLICY are undone on ROLLBACK. Nothing persists.
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rls-breakage-probe.sql
--
-- Each probe prints a BEFORE (no RLS) and an AFTER (FORCE RLS, no GUC set).
-- A background scheduler / the migration runner / the auth bootstrap all have
-- NO request context, therefore NO app.clinic_id. AFTER=0 is the breakage.
--
-- NOTE: the app role (vettrack) OWNS these tables and is not BYPASSRLS, so
-- ENABLE alone is a no-op for it. FORCE is the operative flag.

\echo '=== 1. AUTH BOOTSTRAP DEADLOCK (server/middleware/tenant-context.ts:44-51) ==='
SELECT count(*) AS bootstrap_BEFORE
  FROM (SELECT clinic_id FROM vt_users WHERE clerk_id='dev-user-alpha' AND deleted_at IS NULL LIMIT 1) x;
BEGIN;
  ALTER TABLE vt_users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE vt_users FORCE ROW LEVEL SECURITY;
  CREATE POLICY g7_probe ON vt_users USING (clinic_id = current_setting('app.clinic_id', true));
  SELECT count(*) AS bootstrap_AFTER
    FROM (SELECT clinic_id FROM vt_users WHERE clerk_id='dev-user-alpha' AND deleted_at IS NULL LIMIT 1) x;
ROLLBACK;

\echo '=== 2. REALTIME OUTBOX PUBLISHER (server/lib/event-publisher.ts:62-67) ==='
-- Self-seeding: a live publisher elsewhere may drain the real queue, which would
-- make an unseeded probe vacuously 0->0. Seeded rows are rolled back with the rest.
BEGIN;
  INSERT INTO vt_event_outbox (clinic_id, type, payload) VALUES
    ('dev-clinic-default','g7_probe','{}'::jsonb),
    ('rfid-test-a-5e973494','g7_probe','{}'::jsonb);
  SELECT count(*) AS publisher_batch_BEFORE FROM (
    SELECT id, clinic_id, type, payload, occurred_at, event_version, level, category
    FROM vt_event_outbox
    WHERE published_at IS NULL
      AND (error_type IS NULL OR error_type <> 'permanent')
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    ORDER BY id ASC LIMIT 100) x;
  ALTER TABLE vt_event_outbox ENABLE ROW LEVEL SECURITY;
  ALTER TABLE vt_event_outbox FORCE ROW LEVEL SECURITY;
  CREATE POLICY g7_probe ON vt_event_outbox USING (clinic_id = current_setting('app.clinic_id', true));
  SELECT count(*) AS publisher_batch_AFTER FROM (
    SELECT id, clinic_id, type, payload, occurred_at, event_version, level, category
    FROM vt_event_outbox
    WHERE published_at IS NULL
      AND (error_type IS NULL OR error_type <> 'permanent')
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    ORDER BY id ASC LIMIT 100) x;
ROLLBACK;

\echo '=== 3. MIGRATION DML SILENTLY NO-OPS (migrations/127_promote_pending_admin.sql) ==='
SELECT count(*) AS rows_127_SHOULD_touch FROM vt_users WHERE status='pending';
BEGIN;
  ALTER TABLE vt_users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE vt_users FORCE ROW LEVEL SECURITY;
  CREATE POLICY g7_probe ON vt_users USING (clinic_id = current_setting('app.clinic_id', true));
  UPDATE vt_users SET status='active', role='admin' WHERE status='pending';  -- expect UPDATE 0
ROLLBACK;

\echo '=== 4. CLINIC FAN-OUT COLLAPSE (server/lib/ensure-clinic-phase2-defaults.ts:8) ==='
SELECT count(*) AS clinics_BEFORE FROM (SELECT DISTINCT clinic_id FROM vt_users) x;
BEGIN;
  ALTER TABLE vt_users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE vt_users FORCE ROW LEVEL SECURITY;
  CREATE POLICY g7_probe ON vt_users USING (clinic_id = current_setting('app.clinic_id', true));
  SELECT count(*) AS clinics_AFTER_no_guc FROM (SELECT DISTINCT clinic_id FROM vt_users) x;
  SET LOCAL app.clinic_id = 'dev-clinic-default';
  -- a GUC latched on a pooled connection yields a PARTIAL, nondeterministic fan-out
  SELECT count(*) AS clinics_AFTER_leaked_guc FROM (SELECT DISTINCT clinic_id FROM vt_users) x;
ROLLBACK;

\echo '=== CLEANLINESS: both must be 0 ==='
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname LIKE 'vt\_%' AND (c.relrowsecurity OR c.relforcerowsecurity)) AS vt_rls_left,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'vt\_%') AS vt_policies_left;
