import { sql } from "drizzle-orm";
import {
  text, timestamp, boolean, varchar, integer, date, doublePrecision,
  index, uniqueIndex, primaryKey, jsonb,
} from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, users, animals, hospitalizations } from "./core.js";
import { equipment } from "./equipment.js";

// Stored as TEXT with CHECK constraints in migrations — $type<> preserves TS safety.
type CodeBlueOutcome = "rosc" | "died" | "transferred" | "ongoing";
type CodeBlueSessionStatus = "active" | "ended";
type CodeBlueSessionOutcome = "rosc" | "died" | "transferred" | "ongoing";
type CodeBlueLogCategory = "drug" | "shock" | "cpr" | "note" | "equipment";

export const codeBlueEvents = vtTable(
  "vt_code_blue_events",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startedByUserId: text("started_by_user_id").references(() => users.id, { onDelete: "set null" }),
    outcome: text("outcome").$type<CodeBlueOutcome>(),
    notes: text("notes"),
    timeline: jsonb("timeline").$type<Array<{ elapsed: number; label: string }>>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicStartedIdx: index("idx_vt_code_blue_events_clinic_started").on(table.clinicId, table.startedAt),
  }),
);

export const codeBlueSessions = vtTable(
  "vt_code_blue_sessions",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    startedBy: text("started_by").notNull(),
    startedByName: text("started_by_name").notNull(),
    managerUserId: text("manager_user_id").notNull(),
    managerUserName: text("manager_user_name").notNull(),
    patientId: text("patient_id").references(() => animals.id, { onDelete: "set null" }),
    hospitalizationId: text("hospitalization_id").references(() => hospitalizations.id, { onDelete: "set null" }),
    status: text("status").$type<CodeBlueSessionStatus>().notNull().default("active"),
    outcome: text("outcome").$type<CodeBlueSessionOutcome>(),
    preCheckPassed: boolean("pre_check_passed"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    isReconciled: boolean("is_reconciled").notNull().default(false),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciledByUserId: text("reconciled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    clinicCreatedIdx: index("idx_vt_code_blue_sessions_clinic_created").on(table.clinicId, table.createdAt),
  }),
);

export const codeBlueLogEntries = vtTable(
  "vt_code_blue_log_entries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => codeBlueSessions.id, { onDelete: "cascade" }),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    elapsedMs: integer("elapsed_ms").notNull(),
    label: text("label").notNull(),
    category: text("category").$type<CodeBlueLogCategory>().notNull(),
    equipmentId: text("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
    loggedByUserId: text("logged_by_user_id").notNull(),
    loggedByName: text("logged_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionElapsedIdx: index("idx_vt_code_blue_log_entries_session").on(table.sessionId, table.elapsedMs),
    idempotencyUniq: uniqueIndex("idx_vt_code_blue_log_entries_idempotency").on(table.sessionId, table.idempotencyKey),
  }),
);

export const codeBluePresence = vtTable(
  "vt_code_blue_presence",
  {
    sessionId: text("session_id").notNull().references(() => codeBlueSessions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.userId] }),
  }),
);

export const crashCartItems = vtTable(
  "vt_crash_cart_items",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    requiredQty: integer("required_qty").notNull().default(1),
    expiryWarnDays: integer("expiry_warn_days"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (table) => ({
    clinicActiveIdx: index("idx_vt_crash_cart_items_clinic").on(table.clinicId),
  }),
);

export type CrashCartItem = typeof crashCartItems.$inferSelect;

export const crashCartChecks = vtTable(
  "vt_crash_cart_checks",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    performedByUserId: text("performed_by_user_id").notNull(),
    performedByName: text("performed_by_name").notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
    itemsChecked: jsonb("items_checked").notNull().$type<Array<{ key: string; label: string; checked: boolean }>>(),
    allPassed: boolean("all_passed").notNull(),
    notes: text("notes"),
  },
  (table) => ({
    clinicPerformedIdx: index("idx_vt_crash_cart_checks_clinic_performed").on(table.clinicId, table.performedAt),
  }),
);

export type CodeBlueSession = typeof codeBlueSessions.$inferSelect;
export type CodeBlueLogEntry = typeof codeBlueLogEntries.$inferSelect;
export type CodeBluePresence = typeof codeBluePresence.$inferSelect;
export type CrashCartCheck = typeof crashCartChecks.$inferSelect;

export const erIntakeEvents = vtTable(
  "vt_er_intake_events",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    animalId: text("animal_id")
      .references(() => animals.id, { onDelete: "set null" }),
    ownerName: text("owner_name"),
    species: text("species").notNull(),
    severity: varchar("severity", { length: 20 }).notNull(),
    chiefComplaint: text("chief_complaint").notNull(),
    waitingSince: timestamp("waiting_since", { withTimezone: true })
      .defaultNow()
      .notNull(),
    assignedUserId: text("assigned_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("waiting"),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull(),
    escalatesAt: timestamp("escalates_at", { withTimezone: true }),
    ambulation: varchar("ambulation", { length: 20 }),
    acceptedByUserId: text("accepted_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    clinicStatusIdx: index("idx_er_intake_clinic_status").on(
      table.clinicId,
      table.status
    ),
    clinicWaitingIdx: index("idx_er_intake_clinic_waiting").on(
      table.clinicId,
      table.waitingSince
    ),
    escalatesAtIdx: index("idx_er_intake_escalates_at")
      .on(table.escalatesAt)
      .where(
        sql`${table.escalatesAt} IS NOT NULL AND ${table.severity} IN ('low', 'medium') AND ${table.status} IN ('waiting', 'assigned', 'in_progress')`,
      ),
  }),
);

export const doctorAdmissionState = vtTable(
  "vt_doctor_admission_state",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    intakeEventId: text("intake_event_id")
      .references(() => erIntakeEvents.id, { onDelete: "set null" }),
    enteredAt: timestamp("entered_at").defaultNow().notNull(),
  },
  (table) => ({
    clinicUserUnique: uniqueIndex("idx_doctor_admission_state_clinic_user").on(
      table.clinicId,
      table.userId,
    ),
  }),
);

export type DoctorAdmissionState = typeof doctorAdmissionState.$inferSelect;
export type NewDoctorAdmissionState = typeof doctorAdmissionState.$inferInsert;

export const erKpiDaily = vtTable(
  "vt_er_kpi_daily",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    doorToTriageMinutesP50: doublePrecision("door_to_triage_minutes_p50"),
    missedHandoffRate: doublePrecision("missed_handoff_rate"),
    medDelayRate: doublePrecision("med_delay_rate"),
    sampleSizeIntakes: integer("sample_size_intakes")
      .notNull()
      .default(0),
    sampleSizeHandoffs: integer("sample_size_handoffs")
      .notNull()
      .default(0),
    sampleSizeMedTasks: integer("sample_size_med_tasks")
      .notNull()
      .default(0),
    computedAt: timestamp("computed_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clinicDateUnique: uniqueIndex("vt_er_kpi_daily_clinic_date_unique").on(
      table.clinicId,
      table.date
    ),
    clinicDateIdx: index("idx_er_kpi_daily_clinic_date").on(
      table.clinicId,
      table.date
    ),
  }),
);

export const erBoardEventLog = vtTable(
  "vt_er_board_event_log",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }),
    entityId: text("entity_id"),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clinicCreatedIdx: index("idx_er_board_event_log_clinic_created").on(
      table.clinicId,
      table.createdAt,
    ),
    entityIdx: index("idx_er_board_event_log_entity").on(
      table.clinicId,
      table.entityType,
      table.entityId,
    ),
  }),
);

export const erBaselineSnapshots = vtTable(
  "vt_er_baseline_snapshots",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    baselineStartDate: date("baseline_start_date", { mode: "string" }).notNull(),
    baselineEndDate: date("baseline_end_date", { mode: "string" }).notNull(),
    doorToTriageMinutesP50: doublePrecision("door_to_triage_minutes_p50"),
    missedHandoffRate: doublePrecision("missed_handoff_rate"),
    medDelayRate: doublePrecision("med_delay_rate"),
    confidenceLevel: varchar("confidence_level", { length: 10 })
      .notNull()
      .default("low"),
    capturedAt: timestamp("captured_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clinicCapturedIdx: index("idx_er_baseline_clinic_captured").on(
      table.clinicId,
      table.capturedAt
    ),
  }),
);
