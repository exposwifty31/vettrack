ALTER TABLE "vt_equipment" ADD COLUMN IF NOT EXISTS "rfid_tag_epc" text;
ALTER TABLE "vt_equipment" ADD COLUMN IF NOT EXISTS "last_rfid_seen_at" timestamp with time zone;
ALTER TABLE "vt_equipment" ADD COLUMN IF NOT EXISTS "last_rfid_room_id" text REFERENCES "vt_rooms"("id") ON DELETE SET NULL;
ALTER TABLE "vt_equipment" ADD COLUMN IF NOT EXISTS "last_rfid_gateway_code" text;

CREATE INDEX IF NOT EXISTS "vt_equipment_clinic_rfid_tag_epc_idx"
  ON "vt_equipment"("clinic_id", "rfid_tag_epc");

CREATE UNIQUE INDEX IF NOT EXISTS "vt_equipment_clinic_rfid_tag_epc_uq"
  ON "vt_equipment"("clinic_id", "rfid_tag_epc")
  WHERE "rfid_tag_epc" IS NOT NULL;

ALTER TABLE "vt_rooms" ADD COLUMN IF NOT EXISTS "gateway_code" text;

CREATE INDEX IF NOT EXISTS "vt_rooms_clinic_gateway_code_idx"
  ON "vt_rooms"("clinic_id", "gateway_code");

CREATE UNIQUE INDEX IF NOT EXISTS "vt_rooms_clinic_gateway_code_uq"
  ON "vt_rooms"("clinic_id", "gateway_code")
  WHERE "gateway_code" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "vt_equipment_rfid_reads" (
  "id" text PRIMARY KEY,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE RESTRICT,
  "equipment_id" text NOT NULL REFERENCES "vt_equipment"("id") ON DELETE CASCADE,
  "from_room_id" text REFERENCES "vt_rooms"("id") ON DELETE SET NULL,
  "to_room_id" text NOT NULL REFERENCES "vt_rooms"("id") ON DELETE RESTRICT,
  "gateway_code" text NOT NULL,
  "read_at" timestamp with time zone NOT NULL,
  "batch_id" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "vt_equipment_rfid_reads_clinic_equipment_read_at_idx"
  ON "vt_equipment_rfid_reads"("clinic_id", "equipment_id", "read_at" DESC);

CREATE INDEX IF NOT EXISTS "vt_equipment_rfid_reads_clinic_read_at_idx"
  ON "vt_equipment_rfid_reads"("clinic_id", "read_at" DESC);
