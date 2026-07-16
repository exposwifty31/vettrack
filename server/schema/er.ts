import { sql } from "drizzle-orm";
import {
  text, timestamp, boolean, integer, bigint,
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

/**
 * R-CBF-1.1a — durable idempotency CLAIM record for the one-tap Code Blue start.
 *
 * The FIRST transactional step of R-CBF-1.1's orchestration, written in its OWN
 * durable write BEFORE any cart lookup or the session transaction. The
 * per-gesture `(clinicId, token)` (R-CBF-1.3) is the natural key; a duplicate
 * start is resolved by claim `state`:
 *   - `claimed`  (fence, leaseUntil) — an in-flight owner holds a monotonic fence.
 *   - `committed`                    — bound to a committed session; a retry REPLAYS.
 *   - `released`                     — owner aborted its session txn; reclaimable now.
 *
 * `fence` is a MONOTONIC version token: a short TTL alone is unsafe against a
 * slow-but-still-active owner, so reclamation issues a strictly higher fence and
 * only the current fence-holder may flip the claim to `committed` (a superseded
 * fence is rejected on commit). `sessionId` is a plain nullable ref (NOT a FK) —
 * mirroring the soft-reserve rationale: the committed session is never deleted
 * and a hard FK would add an equipment/code-blue schema cycle. Clinic-scoped on
 * every query; state kept as TEXT + CHECK in the migration ($type-narrowed here).
 */
export const codeBlueStartClaims = vtTable(
  "vt_code_blue_start_claims",
  {
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    fence: bigint("fence", { mode: "number" }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
    state: text("state").$type<"claimed" | "committed" | "released">().notNull().default("claimed"),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clinicId, t.token] }),
    clinicStateIdx: index("idx_vt_code_blue_start_claims_clinic_state").on(t.clinicId, t.state),
  }),
);
export type CodeBlueStartClaim = typeof codeBlueStartClaims.$inferSelect;
