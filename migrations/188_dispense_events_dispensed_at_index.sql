-- Wave 6 tech-debt survey, Theme E#4. readinessForecast.consumption()
-- (server/services/readiness-forecast.service.ts) filters vt_dispense_events by
-- clinic_id + status IN ('CONFIRMED','COMPLETED') + a range predicate on
-- COALESCE(completed_at, confirmed_at, created_at) — the actual "when this
-- dispense happened" timestamp. None of migration 105's three indexes
-- (clinic_id+status, clinic_id+created_at, the requires_completion partial
-- index) can satisfy a COALESCE range filter: a plain btree on created_at is
-- not usable for a predicate on a different expression. Without a matching
-- index this query is a full clinic-scoped table scan on every forecast run.
--
-- CONCURRENTLY trade-off (same reasoning as 168_sweep_anchor_index.sql and
-- 187_vt_push_subscriptions_clinic_endpoint.sql): the migration runner wraps
-- each file in a single BEGIN/COMMIT (server/migrate.ts), and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction — so this is a standard
-- (briefly blocking) index build.
--
-- Idempotent (CREATE..IF NOT EXISTS) — safe to replay.

CREATE INDEX IF NOT EXISTS idx_vt_dispense_events_clinic_dispensed_at
  ON vt_dispense_events (clinic_id, COALESCE(completed_at, confirmed_at, created_at));
