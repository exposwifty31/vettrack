-- Migration 135: vt_operational_metrics — operational ROI and observability metrics
-- Additive only. Opt-in via ENABLE_OPERATIONAL_METRICS env var.

CREATE TABLE IF NOT EXISTS "vt_operational_metrics" (
  "id" text PRIMARY KEY,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE RESTRICT,
  "equipment_id" text REFERENCES "vt_equipment"("id") ON DELETE SET NULL,
  "room_id" text REFERENCES "vt_rooms"("id") ON DELETE SET NULL,
  "user_id" text REFERENCES "vt_users"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "duration_ms" bigint CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "vt_operational_metrics_event_idx"
  ON "vt_operational_metrics"("clinic_id", "event_type", "created_at");
CREATE INDEX IF NOT EXISTS "vt_operational_metrics_equipment_idx"
  ON "vt_operational_metrics"("equipment_id", "created_at");
CREATE INDEX IF NOT EXISTS "vt_operational_metrics_room_idx"
  ON "vt_operational_metrics"("room_id", "created_at");
