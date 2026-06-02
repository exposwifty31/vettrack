import { sql } from "drizzle-orm";
import {
  text, timestamp, boolean, integer,
  index, uniqueIndex, primaryKey, jsonb,
} from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, users } from "./core.js";
import { equipment } from "./equipment.js";

// Stored as TEXT with CHECK constraints in migrations — $type<> preserves TS safety.
type CodeBlueOutcome = "rosc" | "died" | "transferred" | "ongoing";
type CodeBlueSessionStatus = "active" | "ended";
type CodeBlueSessionOutcome = "rosc" | "died" | "transferred" | "ongoing";
type CodeBlueLogCategory = "equipment" | "note";

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
