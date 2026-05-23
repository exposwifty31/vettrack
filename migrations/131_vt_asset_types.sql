CREATE TABLE IF NOT EXISTS "vt_asset_types" (
  "id" text PRIMARY KEY,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "vt_asset_types_clinic_name_unique" ON "vt_asset_types"("clinic_id", "name");

CREATE TABLE IF NOT EXISTS "vt_asset_type_conditions" (
  "id" text PRIMARY KEY,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE RESTRICT,
  "asset_type_id" text NOT NULL REFERENCES "vt_asset_types"("id") ON DELETE CASCADE,
  "condition_name" text NOT NULL,
  "verification_method" text NOT NULL CHECK ("verification_method" IN ('visual','electronic','manual')),
  "stale_after_minutes" integer NOT NULL CHECK ("stale_after_minutes" > 0),
  "display_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "vt_asset_type_conditions_unique"
  ON "vt_asset_type_conditions"("asset_type_id", "condition_name");
