import { sql } from "drizzle-orm";
import {
  text, timestamp, integer, numeric, boolean, varchar, jsonb,
  uuid, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, users } from "./core.js";

export const drugFormulary = vtTable(
  "vt_drug_formulary",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    genericName: text("generic_name").notNull(),
    brandNames: jsonb("brand_names").notNull().default(sql`'[]'::jsonb`),
    targetSpecies: jsonb("target_species"),
    category: text("category"),
    dosageNotes: text("dosage_notes"),
    concentrationMgMl: numeric("concentration_mg_ml", { precision: 10, scale: 4 }).notNull(),
    standardDose: numeric("standard_dose", { precision: 10, scale: 4 }).notNull(),
    minDose: numeric("min_dose", { precision: 10, scale: 4 }),
    maxDose: numeric("max_dose", { precision: 10, scale: 4 }),
    doseUnit: varchar("dose_unit", { length: 20 }).notNull().default("mg_per_kg"),
    defaultRoute: varchar("default_route", { length: 100 }),
    unitVolumeMl: numeric("unit_volume_ml", { precision: 10, scale: 4 }),
    unitType: varchar("unit_type", { length: 20 }),
    criBufferPct: numeric("cri_buffer_pct", { precision: 5, scale: 4 }),
    /** Monotonically increasing version per (clinicId, genericName, concentration) lineage. */
    version: integer("version").notNull().default(1),
    /** Only one active version per (clinicId, genericName, concentration). Superseded rows have isActive=false. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    clinicGenericConcActiveUnique: uniqueIndex("vt_drug_formulary_clinic_generic_conc_active_uq")
      .on(table.clinicId, sql`lower(trim(${table.genericName}))`, table.concentrationMgMl)
      .where(sql`${table.isActive} = true AND ${table.deletedAt} is null`),
    clinicNameSearchIdx: index("vt_drug_formulary_clinic_name_search_idx").on(
      table.clinicId,
      sql`lower(${table.name})`,
    ),
    clinicActiveIdx: index("idx_drug_formulary_clinic_active").on(table.clinicId, table.isActive),
  }),
);

export const pharmacyOrders = vtTable(
  "vt_pharmacy_orders",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    approvedBy: text("approved_by").notNull(),
    windowHours: integer("window_hours").notNull(),
    delivery: text("delivery").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (table) => ({
    clinicCreatedIdx: index("vt_pharmacy_orders_clinic_created_idx").on(table.clinicId, table.createdAt),
  }),
);

/** Short-lived server parse; approve must use parse id + manual quantities only. */
export const pharmacyForecastParses = vtTable(
  "vt_pharmacy_forecast_parses",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    result: jsonb("result").notNull(),
    /** SHA-256 hex of uploaded PDF or pasted text — idempotent re-parse within TTL. */
    contentHash: text("content_hash"),
  },
  (table) => ({
    clinicIdx: index("vt_pharmacy_forecast_parses_clinic_idx").on(table.clinicId),
    expiresIdx: index("vt_pharmacy_forecast_parses_expires_idx").on(table.expiresAt),
    idemIdx: index("vt_pharmacy_forecast_parses_idem_idx").on(
      table.clinicId,
      table.createdBy,
      table.contentHash,
    ),
  }),
);

/** Substrings matched case-insensitively against parsed med lines to drop non-pharmacy items. */
export const pharmacyForecastExclusions = vtTable(
  "vt_pharmacy_forecast_exclusions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    matchSubstring: text("match_substring").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clinicMatchUnique: uniqueIndex("vt_pharmacy_forecast_exclusions_clinic_match_unique").on(
      table.clinicId,
      sql`lower(${table.matchSubstring})`,
    ),
    clinicIdx: index("vt_pharmacy_forecast_exclusions_clinic_idx").on(table.clinicId),
  }),
);

export const medicationTasks = vtTable(
  "vt_medication_tasks",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    animalId: text("animal_id").notNull(),
    drugId: text("drug_id").notNull(),
    route: text("route").notNull(),
    calculationSnapshot: jsonb("calculation_snapshot").notNull(),
    safetyLevel: varchar("safety_level", { length: 20 }).notNull(),
    overrideReason: text("override_reason"),
    /** Extended status: pending | in_progress | completed | cancelled */
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    assignedTo: text("assigned_to"),
    createdBy: text("created_by").notNull(),
    /** Formulary row id used at task creation — clinical source of truth. */
    formularyId: text("formulary_id"),
    /** Formulary version at the time of task creation — immutable reference. */
    formularyVersion: integer("formulary_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by"),
    /** When medication is due to be administered. */
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Volume actually administered by the technician (ml or tablet count). */
    actualVolume: numeric("actual_volume"),
    /** Exact time the drug was administered to the patient. */
    administeredAt: timestamp("administered_at", { withTimezone: true }),
    /** Async inventory deduction state: PENDING | SUCCESS | FAILED */
    inventoryStatus: varchar("inventory_status", { length: 20 }),
    /** True when the deduction succeeded but available stock was insufficient. */
    inventoryMismatch: boolean("inventory_mismatch").notNull().default(false),
  },
  (table) => ({
    clinicIdx: index("vt_medication_tasks_clinic_idx").on(table.clinicId),
    statusIdx: index("vt_medication_tasks_status_idx").on(table.status),
    assignedIdx: index("vt_medication_tasks_assigned_idx").on(table.assignedTo),
    clinicStatusIdx: index("vt_med_tasks_clinic_status_idx").on(table.clinicId, table.status),
    dueAtIdx: index("vt_med_tasks_due_at_idx").on(table.clinicId, table.dueAt),
    openAnimalDrugRouteUnique: uniqueIndex("vt_med_tasks_open_animal_drug_route_uq")
      .on(table.clinicId, table.animalId, table.drugId, table.route)
      .where(sql`${table.status} in ('pending', 'in_progress')`),
  }),
);

export type MedicationTask = typeof medicationTasks.$inferSelect;
export type NewMedicationTask = typeof medicationTasks.$inferInsert;

/** Immutable audit record for dose changes on a medication task. */
export const medTaskDoseEdits = vtTable(
  "vt_med_task_dose_edits",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    taskId: text("task_id").notNull(),
    previousDoseMg: numeric("previous_dose_mg").notNull(),
    newDoseMg: numeric("new_dose_mg").notNull(),
    editedBy: text("edited_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index("idx_vt_med_task_dose_edits_task").on(table.clinicId, table.taskId),
  }),
);
