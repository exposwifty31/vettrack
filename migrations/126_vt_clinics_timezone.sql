ALTER TABLE "vt_clinics" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'Asia/Jerusalem' NOT NULL;
