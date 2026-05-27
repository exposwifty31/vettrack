CREATE TABLE IF NOT EXISTS "vt_equipment_waitlist" (
  "id" text PRIMARY KEY,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE RESTRICT,
  "equipment_id" text NOT NULL REFERENCES "vt_equipment"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "vt_users"("id") ON DELETE CASCADE,
  "joined_at" timestamp NOT NULL DEFAULT now(),
  "priority" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'waiting'
    CHECK ("status" IN ('waiting','notified','fulfilled','cancelled','expired')),
  "reservation_expires_at" timestamp,
  "notified_at" timestamp,
  "fulfilled_at" timestamp,
  "cancelled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "vt_equipment_waitlist_user_active_uq"
  ON "vt_equipment_waitlist"("equipment_id", "user_id")
  WHERE "status" IN ('waiting', 'notified');

CREATE UNIQUE INDEX IF NOT EXISTS "vt_equipment_waitlist_one_notified_uq"
  ON "vt_equipment_waitlist"("equipment_id")
  WHERE "status" = 'notified';

CREATE INDEX IF NOT EXISTS "vt_equipment_waitlist_clinic_equipment"
  ON "vt_equipment_waitlist"("clinic_id", "equipment_id", "status");

CREATE INDEX IF NOT EXISTS "vt_equipment_waitlist_reservation_expiry"
  ON "vt_equipment_waitlist"("reservation_expires_at")
  WHERE "status" = 'notified' AND "reservation_expires_at" IS NOT NULL;
