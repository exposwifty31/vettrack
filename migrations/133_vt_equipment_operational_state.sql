ALTER TABLE "vt_equipment"
  ADD COLUMN IF NOT EXISTS "asset_type_id" text REFERENCES "vt_asset_types"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "dock_id" text REFERENCES "vt_docks"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "dock_confirmed_ready_at" timestamp,
  ADD COLUMN IF NOT EXISTS "dock_confirmed_by_id" text REFERENCES "vt_users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "custody_state" text NOT NULL DEFAULT 'untracked'
    CHECK ("custody_state" IN ('docked','checked_out','untracked','returned')),
  ADD COLUMN IF NOT EXISTS "custody_state_since" timestamp,
  ADD COLUMN IF NOT EXISTS "untracked_departure_at" timestamp,
  ADD COLUMN IF NOT EXISTS "emergency_override_at" timestamp,
  ADD COLUMN IF NOT EXISTS "emergency_override_by_id" text REFERENCES "vt_users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "readiness_state" text NOT NULL DEFAULT 'unknown'
    CHECK ("readiness_state" IN ('ready','not_ready','unknown')),
  ADD COLUMN IF NOT EXISTS "readiness_state_since" timestamp,
  ADD COLUMN IF NOT EXISTS "usage_state" text NOT NULL DEFAULT 'available'
    CHECK ("usage_state" IN ('available','staged','in_use','emergency_use','procedure_bound')),
  ADD COLUMN IF NOT EXISTS "usage_state_since" timestamp,
  ADD COLUMN IF NOT EXISTS "procedure_bound_hospitalization_id" text
    REFERENCES "vt_hospitalizations"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "vt_equipment_operational_state_idx"
  ON "vt_equipment"("custody_state", "readiness_state", "asset_type_id");

-- Backfill: equipment with an active checkout → checked_out
UPDATE "vt_equipment"
  SET "custody_state" = 'checked_out',
      "custody_state_since" = COALESCE("checked_out_at", now())
  WHERE "checked_out_by_id" IS NOT NULL
    AND "deleted_at" IS NULL;
-- All other equipment defaults to 'untracked' (safer than assuming docked)
