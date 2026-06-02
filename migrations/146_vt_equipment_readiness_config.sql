CREATE TABLE IF NOT EXISTS "vt_equipment_readiness_config" (
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE restrict,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "vt_equipment_readiness_config_clinic_key_pk" PRIMARY KEY ("clinic_id", "key")
);
