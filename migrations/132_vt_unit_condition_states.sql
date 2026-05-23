CREATE TABLE IF NOT EXISTS "vt_unit_condition_states" (
  "id" text PRIMARY KEY,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE RESTRICT,
  "equipment_id" text NOT NULL REFERENCES "vt_equipment"("id") ON DELETE CASCADE,
  "condition_id" text NOT NULL REFERENCES "vt_asset_type_conditions"("id") ON DELETE CASCADE,
  "verified" boolean NOT NULL DEFAULT false,
  "verified_at" timestamp,
  "verified_by_id" text REFERENCES "vt_users"("id") ON DELETE SET NULL,
  "notes" text,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CHECK ("verified" = false OR "verified_at" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "vt_unit_condition_states_unique"
  ON "vt_unit_condition_states"("equipment_id", "condition_id");

CREATE INDEX IF NOT EXISTS "vt_unit_condition_states_clinic_equipment"
  ON "vt_unit_condition_states"("clinic_id", "equipment_id");
