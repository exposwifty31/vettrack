import { index, jsonb, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, users } from "./core.js";
import { appointments } from "./tasks.js";

export const equipmentIntelligenceRuns = vtTable(
  "vt_equipment_intelligence_runs",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: varchar("kind", { length: 32 }).notNull(),
    contextSummary: jsonb("context_summary").notNull(),
    evidenceGraph: jsonb("evidence_graph").notNull(),
    responsePayload: jsonb("response_payload").notNull(),
    openaiModel: text("openai_model"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicCreatedIdx: index("vt_equipment_intelligence_runs_clinic_created_idx").on(
      t.clinicId,
      t.createdAt,
    ),
  }),
);

export const equipmentIntelligenceRecommendations = vtTable(
  "vt_equipment_intelligence_recommendations",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    runId: text("run_id")
      .notNull()
      .references(() => equipmentIntelligenceRuns.id, { onDelete: "cascade" }),
    finding: text("finding").notNull(),
    severity: varchar("severity", { length: 16 }).notNull(),
    confidence: varchar("confidence", { length: 16 }).notNull(),
    evidence: jsonb("evidence").notNull(),
    impact: text("impact").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    suggestedTaskType: varchar("suggested_task_type", { length: 16 }),
    status: varchar("status", { length: 24 }).notNull().default("proposed"),
    taskId: text("task_id").references(() => appointments.id, { onDelete: "set null" }),
    approvedById: text("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index("vt_equipment_intelligence_recs_run_idx").on(t.runId),
    clinicStatusIdx: index("vt_equipment_intelligence_recs_clinic_status_idx").on(
      t.clinicId,
      t.status,
    ),
  }),
);
