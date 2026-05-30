CREATE TABLE IF NOT EXISTS "vt_equipment_intelligence_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE restrict,
  "user_id" text NOT NULL REFERENCES "vt_users"("id") ON DELETE restrict,
  "kind" varchar(32) NOT NULL,
  "context_summary" jsonb NOT NULL,
  "evidence_graph" jsonb NOT NULL,
  "response_payload" jsonb NOT NULL,
  "openai_model" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "vt_equipment_intelligence_runs_clinic_created_idx"
  ON "vt_equipment_intelligence_runs" ("clinic_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "vt_equipment_intelligence_recommendations" (
  "id" text PRIMARY KEY NOT NULL,
  "clinic_id" text NOT NULL REFERENCES "vt_clinics"("id") ON DELETE restrict,
  "run_id" text NOT NULL REFERENCES "vt_equipment_intelligence_runs"("id") ON DELETE cascade,
  "finding" text NOT NULL,
  "severity" varchar(16) NOT NULL,
  "confidence" varchar(16) NOT NULL,
  "evidence" jsonb NOT NULL,
  "impact" text NOT NULL,
  "recommended_action" text NOT NULL,
  "suggested_task_type" varchar(16),
  "status" varchar(24) DEFAULT 'proposed' NOT NULL,
  "task_id" text REFERENCES "vt_appointments"("id") ON DELETE set null,
  "approved_by_id" text REFERENCES "vt_users"("id") ON DELETE set null,
  "approved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "vt_equipment_intelligence_recs_run_idx"
  ON "vt_equipment_intelligence_recommendations" ("run_id");

CREATE INDEX IF NOT EXISTS "vt_equipment_intelligence_recs_clinic_status_idx"
  ON "vt_equipment_intelligence_recommendations" ("clinic_id", "status");
