CREATE TABLE IF NOT EXISTS "vt_docks" (
  "id" text PRIMARY KEY,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "description" text,
  "room_id" text REFERENCES "vt_rooms"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "vt_docks_clinic_name_unique" ON "vt_docks"("clinic_id", "name");
