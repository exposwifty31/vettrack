CREATE TABLE IF NOT EXISTS "vt_staging_queue" (
  "id" text PRIMARY KEY,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE RESTRICT,
  "equipment_id" text NOT NULL REFERENCES "vt_equipment"("id") ON DELETE CASCADE,
  "requested_by_id" text NOT NULL REFERENCES "vt_users"("id") ON DELETE CASCADE,
  "task_id" text REFERENCES "vt_appointments"("id") ON DELETE SET NULL,
  "clinical_priority" text NOT NULL DEFAULT 'routine'
    CHECK ("clinical_priority" IN ('routine','urgent','emergency')),
  "staged_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp,
  "status" text NOT NULL DEFAULT 'active'
    CHECK ("status" IN ('active','expired','cancelled','fulfilled')),
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Prevent same requester from claiming same equipment twice while active
CREATE UNIQUE INDEX IF NOT EXISTS "vt_staging_queue_no_duplicate_active"
  ON "vt_staging_queue"("equipment_id", "requested_by_id")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "vt_staging_queue_clinic_equipment"
  ON "vt_staging_queue"("clinic_id", "equipment_id", "status");

CREATE INDEX IF NOT EXISTS "vt_staging_queue_expiry"
  ON "vt_staging_queue"("expires_at")
  WHERE "status" = 'active' AND "expires_at" IS NOT NULL;
