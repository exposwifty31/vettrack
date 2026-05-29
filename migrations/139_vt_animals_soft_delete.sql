-- Soft-delete for animals: deleted patients leave the active list immediately;
-- rows are hard-purged after 90 days with no clinical activity or re-admission.

ALTER TABLE "vt_animals" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "vt_animals" ADD COLUMN IF NOT EXISTS "deleted_by" text;

DO $$ BEGIN
  ALTER TABLE "vt_animals" ADD CONSTRAINT "vt_animals_deleted_by_vt_users_id_fk"
    FOREIGN KEY ("deleted_by") REFERENCES "vt_users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_vt_animals_clinic_deleted"
  ON "vt_animals" ("clinic_id", "deleted_at")
  WHERE "deleted_at" IS NOT NULL;
