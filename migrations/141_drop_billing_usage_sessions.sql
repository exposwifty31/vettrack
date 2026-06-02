-- Remove billing and usage-session tables (product de-scope).

DROP TABLE IF EXISTS "vt_inventory_jobs" CASCADE;
DROP TABLE IF EXISTS "vt_billing_ledger" CASCADE;
DROP TABLE IF EXISTS "vt_billing_items" CASCADE;
DROP TABLE IF EXISTS "vt_usage_sessions" CASCADE;

ALTER TABLE "vt_equipment" DROP COLUMN IF EXISTS "billing_item_id";
ALTER TABLE "vt_containers" DROP COLUMN IF EXISTS "billing_item_id";
ALTER TABLE "vt_inventory_logs" DROP COLUMN IF EXISTS "billing_event_id";
ALTER TABLE "vt_dispense_events" DROP COLUMN IF EXISTS "billing_event_id";

DROP TYPE IF EXISTS "vt_billing_charge_kind";
DROP TYPE IF EXISTS "vt_billing_ledger_item_type";
DROP TYPE IF EXISTS "vt_billing_ledger_status";
DROP TYPE IF EXISTS "vt_usage_session_status";
