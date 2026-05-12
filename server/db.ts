import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { getPostgresqlConnectionString } from "./lib/postgresql.js";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  varchar,
  jsonb,
  date,
  time,
  uuid,
  index,
  uniqueIndex,
  primaryKey,
  doublePrecision,
  bigserial,
} from "drizzle-orm/pg-core";

// Managed Postgres providers (Neon, Supabase, Heroku, Railway public proxy, …)
// require TLS and signal it via `sslmode=require` in the URL. Enable SSL when
// either the URL asks for it or we're in production.
const DB_URL = getPostgresqlConnectionString();
const URL_REQUIRES_SSL = /[?&]sslmode=(require|verify-ca|verify-full)\b/i.test(DB_URL);

export const pool = new Pool({
  connectionString: DB_URL,
  ssl:
    process.env.NODE_ENV === "production" || URL_REQUIRES_SSL
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" }
      : false,
  max: Number.parseInt(process.env.DB_POOL_MAX ?? "20", 10) || 20,
  idleTimeoutMillis: Number.parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? "30000", 10) || 30000,
  connectionTimeoutMillis: Number.parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? "10000", 10) || 10000,
});

export const db = drizzle(pool);

export const users = pgTable("vt_users", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  clerkId: text("clerk_id").unique().notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  role: varchar("role", { length: 20 }).notNull().default("technician"),
  secondaryRole: varchar("secondary_role", { length: 20 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  preferredLocale: varchar("preferred_locale", { length: 10 }).notNull().default("he"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
});

export const owners = pgTable("vt_owners", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  fullName: text("full_name").notNull().default(""),
  phone: text("phone"),
  nationalId: text("national_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clinics = pgTable("vt_clinics", {
  id: text("id").primaryKey(),
  pharmacyEmail: text("pharmacy_email"),
  forecastPdfSourceFormat: varchar("forecast_pdf_source_format", { length: 20 }).notNull().default("smartflow"),
  erModeState: varchar("er_mode_state", { length: 20 }).notNull().default("disabled"),
  /** Minutes until a low-severity intake auto-escalates to medium (SLA aging). */
  erIntakeEscalateLowMinutes: integer("er_intake_escalate_low_minutes").notNull().default(15),
  /** Minutes a medium-severity intake waits before auto-escalating to high. */
  erIntakeEscalateMediumMinutes: integer("er_intake_escalate_medium_minutes").notNull().default(15),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const animals = pgTable("vt_animals", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  ownerId: text("owner_id").references(() => owners.id, { onDelete: "set null" }),
  name: text("name").notNull().default(""),
  species: text("species"),
  recordNumber: text("record_number"),
  breed: text("breed"),
  sex: text("sex"),
  color: text("color"),
  weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  externalId: text("external_id"),
  externalSource: text("external_source"),
  externalSyncedAt: timestamp("external_synced_at"),
});

export const appointments = pgTable("vt_appointments", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  animalId: text("animal_id").references(() => animals.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => owners.id, { onDelete: "set null" }),
  vetId: text("vet_id").references(() => users.id, { onDelete: "restrict" }),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /**
   * Extended status values include 'approved' (vet gate for medication tasks).
   * Full machine: pending → approved → in_progress → completed | cancelled
   */
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  /** Links this task to the specific hospitalization episode it belongs to. */
  hospitalizationId: text("hospitalization_id"),
  /** Scheduling type/purpose (e.g. 'checkup', 'followup', 'medication', 'maintenance'). */
  appointmentType: varchar("appointment_type", { length: 40 }),
  /** Who created this appointment/task. */
  createdBy: text("created_by"),
  conflictOverride: boolean("conflict_override").notNull().default(false),
  overrideReason: text("override_reason"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  priority: varchar("priority", { length: 20 }).notNull().default("normal"),
  taskType: varchar("task_type", { length: 20 }),
  /** Medication: inventory container for billing + stock deduction (see also metadata.containerId legacy). */
  containerId: text("container_id"),
  /** Medication: primary vt_items row for the cabinet line (Smart Cop / orphan checks). */
  inventoryItemId: text("inventory_item_id"),
  /** Automation: overdue escalation target — does not replace vet_id (technician ownership). */
  escalatedTo: text("escalated_to").references(() => users.id, { onDelete: "set null" }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  stuckNotifiedAt: timestamp("stuck_notified_at", { withTimezone: true }),
  overdueNotifiedAt: timestamp("overdue_notified_at", { withTimezone: true }),
  prestartReminderAt: timestamp("prestart_reminder_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  externalId: text("external_id"),
  externalSource: text("external_source"),
  externalSyncedAt: timestamp("external_synced_at"),
});

export const folders = pgTable("vt_folders", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("manual"),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
});

export const rooms = pgTable(
  "vt_rooms",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    floor: text("floor"),
    masterNfcTagId: text("master_nfc_tag_id").unique(),
    syncStatus: varchar("sync_status", { length: 20 }).notNull().default("stale"),
    lastAuditAt: timestamp("last_audit_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    clinicNameUnique: uniqueIndex("vt_rooms_clinic_name_unique").on(table.clinicId, table.name),
  }),
);

export const occupancySourceEnum = pgEnum("vt_occupancy_source", ["manual"]);
export const billingChargeKindEnum = pgEnum("vt_billing_charge_kind", ["per_scan_hour", "per_unit"]);
export const billingLedgerItemTypeEnum = pgEnum("vt_billing_ledger_item_type", ["EQUIPMENT", "CONSUMABLE"]);
export const billingLedgerStatusEnum = pgEnum("vt_billing_ledger_status", ["pending", "synced", "voided"]);
export const usageSessionStatusEnum = pgEnum("vt_usage_session_status", ["open", "closed"]);
export const inventoryLogTypeEnum = pgEnum("vt_inventory_log_type", ["restock", "blind_audit", "adjustment"]);

export const billingItems = pgTable("vt_billing_items", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  code: text("code").notNull(),
  description: text("description").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  chargeKind: billingChargeKindEnum("charge_kind").notNull().default("per_unit"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const drugFormulary = pgTable(
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

export const pharmacyOrders = pgTable(
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
export const pharmacyForecastParses = pgTable(
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
export const pharmacyForecastExclusions = pgTable(
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

export const medicationTasks = pgTable(
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

export const equipment = pgTable("vt_equipment", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  serialNumber: text("serial_number"),
  model: text("model"),
  manufacturer: text("manufacturer"),
  purchaseDate: text("purchase_date"),
  expiryDate: date("expiry_date", { mode: "string" }),
  expiryNotifiedAt: timestamp("expiry_notified_at"),
  location: text("location"),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("ok"),
  lastSeen: timestamp("last_seen"),
  lastStatus: varchar("last_status", { length: 20 }),
  lastMaintenanceDate: timestamp("last_maintenance_date"),
  lastSterilizationDate: timestamp("last_sterilization_date"),
  maintenanceIntervalDays: integer("maintenance_interval_days"),
  imageUrl: text("image_url"),
  nfcTagId: text("nfc_tag_id").unique(),
  billingItemId: text("billing_item_id").references(() => billingItems.id, { onDelete: "set null" }),
  lastVerifiedAt: timestamp("last_verified_at"),
  lastVerifiedById: text("last_verified_by_id"),
  // Checkout / ownership
  checkedOutById: text("checked_out_by_id"),
  checkedOutByEmail: text("checked_out_by_email"),
  checkedOutAt: timestamp("checked_out_at"),
  checkedOutLocation: text("checked_out_location"),
  expectedReturnMinutes: integer("expected_return_minutes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  version: integer("version").notNull().default(1),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
});

export const patientRoomAssignments = pgTable("vt_patient_room_assignments", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  animalId: text("animal_id")
    .notNull()
    .references(() => animals.id, { onDelete: "cascade" }),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  source: occupancySourceEnum("source").notNull(),
});

export const billingLedger = pgTable("vt_billing_ledger", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  /** Nullable: capture is allowed before a patient is linked (e.g. code-blue). */
  animalId: text("animal_id")
    .references(() => animals.id, { onDelete: "set null" }),
  itemType: billingLedgerItemTypeEnum("item_type").notNull(),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  totalAmountCents: integer("total_amount_cents").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: billingLedgerStatusEnum("status").notNull().default("pending"),
  /**
   * Immutable snapshot of how price was resolved at billing time.
   * Persists: priceCents, currency, contextType, contextId, resolvedAt,
   * priceSource, resolutionPath[], contextUsed, formularyId?, formularyVersion?
   */
  pricingSnapshot: jsonb("pricing_snapshot"),
  /** CHARGE = original charge; REVERSAL = negates a prior charge (append-only correction). */
  entryType: varchar("entry_type", { length: 10 }).notNull().default("CHARGE"),
  /** For REVERSAL rows only: references the original CHARGE row being reversed. */
  reversesId: text("reverses_id"),
  /** Reason for reversal — required on REVERSAL entries. */
  reversalReason: text("reversal_reason"),
  /** Source traceability: which task produced this charge. */
  taskId: text("task_id"),
  /** Source traceability: which dispense event produced this charge. */
  dispenseEventId: text("dispense_event_id"),
  /** Who created this billing entry (userId). */
  createdBy: text("created_by"),
  /** Formulary reference if charge was derived from a medication task. */
  formularyId: text("formulary_id"),
  formularyVersion: integer("formulary_version"),
  /** Indicates the origin of this charge: TASK | DISPENSE | MANUAL */
  sourceType: varchar("source_type", { length: 10 }),
  /** Source traceability: which scan log event produced this charge (nullable — populated when billing is triggered via scan). */
  scanLogId: text("scan_log_id"),
  /** Source traceability: which usage session produced this charge (nullable — populated by equipment-seen flow). */
  usageSessionId: text("usage_session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  externalId: text("external_id"),
  externalSource: text("external_source"),
  externalSyncedAt: timestamp("external_synced_at"),
});

export const usageSessions = pgTable("vt_usage_sessions", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  animalId: text("animal_id")
    .notNull()
    .references(() => animals.id, { onDelete: "cascade" }),
  equipmentId: text("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
  billingItemId: text("billing_item_id")
    .notNull()
    .references(() => billingItems.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  lastBilledThrough: timestamp("last_billed_through", { withTimezone: true }),
  status: usageSessionStatusEnum("status").notNull().default("open"),
});

export const containers = pgTable("vt_containers", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  department: text("department").notNull().default(""),
  targetQuantity: integer("target_quantity").notNull().default(0),
  currentQuantity: integer("current_quantity").notNull().default(0),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  billingItemId: text("billing_item_id").references(() => billingItems.id, { onDelete: "set null" }),
  nfcTagId: text("nfc_tag_id").unique(),
});

export const inventoryItems = pgTable(
  "vt_items",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** Classification: DRUG | CONSUMABLE | EQUIPMENT */
    itemType: varchar("item_type", { length: 20 }).notNull().default("CONSUMABLE"),
    /** Physical unit for this SKU (e.g. mL, mg, vial, unit, tablet). */
    unit: varchar("unit", { length: 30 }),
    nfcTagId: text("nfc_tag_id").unique(),
    category: text("category"),
    isBillable: boolean("is_billable").notNull().default(true),
    minimumDispenseToCapture: integer("minimum_dispense_to_capture").notNull().default(1),
    /** Soft-delete: inactive items cannot be used in new operations. */
    isActive: boolean("is_active").notNull().default(true),
    /** For DRUG-type items: references the drug formulary entry (clinical source of truth). */
    formularyId: text("formulary_id").references(() => drugFormulary.id, { onDelete: "restrict" }),
    /** Formulary version captured at the time of item-formulary linkage. */
    formularyVersion: integer("formulary_version"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    externalId: text("external_id"),
    externalSource: text("external_source"),
    externalSyncedAt: timestamp("external_synced_at"),
  },
  (table) => ({
    clinicCodeUnique: uniqueIndex("vt_items_clinic_code_unique").on(table.clinicId, table.code),
    clinicIdx: index("idx_items_clinic").on(table.clinicId),
    clinicActiveIdx: index("idx_items_clinic_active").on(table.clinicId, table.isActive),
    formularyIdx: index("idx_items_formulary_id").on(table.formularyId),
  }),
);

/**
 * Context-aware pricing for inventory items.
 * Resolution order (most-specific first):
 *   1. exact (containerId + usageType)
 *   2. container-level (containerId, no usageType)
 *   3. usage-level (usageType, no containerId)
 *   4. global (contextType=GLOBAL)
 * Missing price → PRICE_NOT_FOUND error (no silent fallback).
 */
export const inventoryItemPrices = pgTable(
  "vt_inventory_item_prices",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    itemId: text("item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
    /** CONTAINER | USAGE | GLOBAL */
    contextType: varchar("context_type", { length: 20 }).notNull(),
    /** containerId for CONTAINER context, usageType string for USAGE context, null for GLOBAL */
    contextId: text("context_id"),
    priceCents: integer("price_cents").notNull(),
    currency: varchar("currency", { length: 10 }).notNull().default("ILS"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    itemContextIdx: index("idx_vt_item_prices_item_context").on(table.clinicId, table.itemId, table.contextType),
    effectiveFromIdx: index("idx_vt_item_prices_effective").on(table.itemId, table.effectiveFrom),
  }),
);

export type InventoryItemPrice = typeof inventoryItemPrices.$inferSelect;

export const containerItems = pgTable(
  "vt_container_items",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    containerItemUnique: uniqueIndex("vt_container_items_container_item_unique").on(table.containerId, table.itemId),
    clinicIdx: index("idx_container_items_clinic").on(table.clinicId),
  }),
);

export const restockSessions = pgTable(
  "vt_restock_sessions",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "cascade" }),
    ownedByUserId: text("owned_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Session lifecycle: active | completed | cancelled */
    status: text("status").notNull().default("active"),
    /** Snapshot of container_items quantities at session start time. Record<itemId, quantity> */
    baselineSnapshot: jsonb("baseline_snapshot"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => ({
    clinicContainerIdx: index("idx_restock_sessions_clinic_container").on(table.clinicId, table.containerId),
    ownerIdx: index("idx_restock_sessions_owner").on(table.ownedByUserId),
  }),
);

export const restockEvents = pgTable(
  "vt_restock_events",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => restockSessions.id, { onDelete: "cascade" }),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    delta: integer("delta").notNull(),
    /** Absolute item count the technician observed during this scan. */
    observedQuantity: integer("observed_quantity"),
    /** PAR target used at scan time to compute delta. */
    targetPar: integer("target_par"),
    /** Who performed this individual scan. */
    scannedByUserId: text("scanned_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index("idx_restock_events_session").on(table.sessionId),
    containerIdx: index("idx_restock_events_container").on(table.containerId),
    itemSessionIdx: index("idx_restock_events_item_session").on(table.sessionId, table.itemId),
  }),
);

export const inventoryLogs = pgTable(
  "vt_inventory_logs",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "cascade" }),
    taskId: text("task_id"),
    logType: inventoryLogTypeEnum("log_type").notNull(),
    quantityBefore: integer("quantity_before").notNull(),
    quantityAdded: integer("quantity_added").notNull().default(0),
    quantityAfter: integer("quantity_after").notNull(),
    consumedDerived: integer("consumed_derived"),
    variance: integer("variance"),
    animalId: text("animal_id").references(() => animals.id, { onDelete: "set null" }),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    note: text("note"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Set when a consumable dispense produced a vt_billing_ledger row (revenue capture). */
    billingEventId: text("billing_event_id").references(() => billingLedger.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    taskClinicIdx: index("vt_inventory_logs_task_clinic_idx").on(table.taskId, table.clinicId),
    taskClinicTypeUnique: uniqueIndex("inventory_logs_task_clinic_type_idx").on(
      table.taskId,
      table.clinicId,
      table.logType,
    ),
  }),
);

/**
 * First-class dispense event entity.
 * DRAFT → CONFIRMED (billing in TX) → COMPLETED (inventory async).
 * EMERGENCY_PENDING → CONFIRMED (after staff completion).
 */
export const dispenseEvents = pgTable(
  "vt_dispense_events",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "restrict" }),
    patientId: text("patient_id").references(() => animals.id, { onDelete: "set null" }),
    /** DRAFT | CONFIRMED | COMPLETED | EMERGENCY_PENDING */
    status: varchar("status", { length: 30 }).notNull().default("DRAFT"),
    /** PENDING | SUCCESS | FAILED — populated after confirmation */
    inventoryStatus: varchar("inventory_status", { length: 20 }),
    /** True when stock was insufficient but dispense was allowed to proceed */
    inventoryMismatch: boolean("inventory_mismatch").notNull().default(false),
    /** True for emergency events that must be explicitly completed */
    requiresCompletion: boolean("requires_completion").notNull().default(false),
    /** Items dispensed: [{ itemId, quantity }] */
    items: jsonb("items").notNull(),
    bypassReason: text("bypass_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    confirmedBy: text("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Linked billing ledger row created at confirmation. */
    billingEventId: text("billing_event_id").references(() => billingLedger.id, { onDelete: "set null" }),
  },
  (table) => ({
    clinicStatusIdx: index("idx_vt_dispense_events_clinic_status").on(table.clinicId, table.status),
    clinicCreatedIdx: index("idx_vt_dispense_events_clinic_created").on(table.clinicId, table.createdAt),
    idempotencyUnique: uniqueIndex("vt_dispense_events_idempotency_uq").on(table.clinicId, table.idempotencyKey),
    requiresCompletionIdx: index("idx_vt_dispense_events_requires_completion").on(
      table.clinicId,
      table.requiresCompletion,
      table.status,
    ),
  }),
);

export type DispenseEvent = typeof dispenseEvents.$inferSelect;
export type NewDispenseEvent = typeof dispenseEvents.$inferInsert;

/** Immutable audit record for dose changes on a medication task. */
export const medTaskDoseEdits = pgTable(
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

export const inventoryJobs = pgTable(
  "vt_inventory_jobs",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    taskId: text("task_id").notNull(),
    containerId: text("container_id").notNull(),
    requiredVolumeMl: numeric("required_volume_ml").notNull(),
    animalId: text("animal_id"),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => ({
    taskUnique: uniqueIndex("vt_inventory_jobs_task_unique").on(table.taskId),
  }),
);

export const shiftSessions = pgTable("vt_shift_sessions", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  startedByUserId: text("started_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  note: text("note"),
});


export const equipmentReturns = pgTable("vt_equipment_returns", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  returnedById: text("returned_by_id").notNull(),
  returnedByEmail: text("returned_by_email").notNull(),
  returnedAt: timestamp("returned_at").defaultNow().notNull(),
  isPluggedIn: boolean("is_plugged_in").notNull().default(false),
  plugInDeadlineMinutes: integer("plug_in_deadline_minutes").notNull().default(30),
  plugInAlertSentAt: timestamp("plug_in_alert_sent_at"),
  chargeAlertJobId: text("charge_alert_job_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const shiftRole = pgEnum("vt_shift_role", ["technician", "senior_technician", "admin"]);

export const shifts = pgTable("vt_shifts", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  date: date("date", { mode: "string" }).notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  employeeName: text("employee_name").notNull(),
  role: shiftRole("role").notNull(),
});

export const shiftImports = pgTable("vt_shift_imports", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  importedBy: text("imported_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
});

export const doctorShifts = pgTable(
  "vt_doctor_shifts",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    shiftName: text("shift_name").notNull(),
    operationalRole: varchar("operational_role", { length: 40 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    clinicDateRoleIdx: index("idx_doctor_shifts_clinic_date_role").on(
      table.clinicId,
      table.date,
      table.operationalRole,
    ),
  }),
);

export type DoctorShift = typeof doctorShifts.$inferSelect;
export type NewDoctorShift = typeof doctorShifts.$inferInsert;

export const scanLogs = pgTable("vt_scan_logs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id"),
  userId: text("user_id").notNull(),
  userEmail: text("user_email").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  note: text("note"),
  photoUrl: text("photo_url"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const transferLogs = pgTable("vt_transfer_logs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id"),
  fromFolderId: text("from_folder_id"),
  fromFolderName: text("from_folder_name"),
  toFolderId: text("to_folder_id"),
  toFolderName: text("to_folder_name"),
  userId: text("user_id").notNull(),
  note: text("note"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const whatsappAlerts = pgTable("vt_whatsapp_alerts", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  note: text("note"),
  phoneNumber: text("phone_number"),
  message: text("message").notNull(),
  waUrl: text("wa_url").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export const alertAcks = pgTable("vt_alert_acks", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  alertType: varchar("alert_type", { length: 30 }).notNull(),
  acknowledgedById: text("acknowledged_by_id").notNull(),
  acknowledgedByEmail: text("acknowledged_by_email").notNull(),
  acknowledgedAt: timestamp("acknowledged_at").defaultNow().notNull(),
  remindAt: timestamp("remind_at"),
  remindedAt: timestamp("reminded_at"),
  /** Two-level status: SEEN = awareness (alerts continue); RESOLVED = handled (alerts stop). */
  ackStatus: varchar("ack_status", { length: 10 }).notNull().default("SEEN"),
  /** Set when user marks as RESOLVED. Persisted — row is never deleted. */
  resolvedAt: timestamp("resolved_at"),
  resolvedById: text("resolved_by_id"),
  resolutionNote: text("resolution_note"),
});

export const undoTokens = pgTable("vt_undo_tokens", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  actorId: text("actor_id").notNull(),
  scanLogId: text("scan_log_id").notNull(),
  previousState: text("previous_state").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumed: boolean("consumed").notNull().default(false),
});

export const serverConfig = pgTable("vt_server_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const integrationConfigs = pgTable("vt_integration_configs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  adapterId: text("adapter_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  syncPatients: boolean("sync_patients").notNull().default(false),
  syncInventory: boolean("sync_inventory").notNull().default(false),
  syncAppointments: boolean("sync_appointments").notNull().default(false),
  exportBilling: boolean("export_billing").notNull().default(false),
  lastPatientSyncAt: timestamp("last_patient_sync_at"),
  lastInventorySyncAt: timestamp("last_inventory_sync_at"),
  lastAppointmentSyncAt: timestamp("last_appointment_sync_at"),
  lastBillingExportAt: timestamp("last_billing_export_at"),
  /** Control-plane metadata (ownership, SLA, migration, flags); validated via Zod at API boundary. */
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Inbound merge conflicts (patients first; Phase B Sprint 2). */
export const integrationSyncConflicts = pgTable("vt_integration_sync_conflicts", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  adapterId: text("adapter_id").notNull(),
  entityType: text("entity_type").notNull(),
  localId: text("local_id").notNull(),
  externalId: text("external_id").notNull(),
  status: text("status").notNull().default("open"),
  policyUsed: text("policy_used").notNull(),
  payloadSnapshot: jsonb("payload_snapshot"),
  /** LOW = auto-resolved (external_wins / vettrack_wins); HIGH = manual review required. */
  severity: varchar("severity", { length: 10 }).notNull().default("HIGH"),
  /** How the conflict was resolved: 'auto_external_wins' | 'auto_vettrack_wins' | 'pending_manual' */
  resolution: varchar("resolution", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const integrationSyncLog = pgTable("vt_integration_sync_log", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull(),
  adapterId: text("adapter_id").notNull(),
  syncType: text("sync_type").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  recordsAttempted: integer("records_attempted").notNull().default(0),
  recordsSucceeded: integer("records_succeeded").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  error: text("error"),
  jobId: text("job_id"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  metadata: jsonb("metadata"),
});

/** Low-confidence / ambiguous mapping queue — Phase D Sprint 4. */
export const integrationMappingReviews = pgTable("vt_integration_mapping_reviews", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  adapterId: text("adapter_id").notNull(),
  entityType: text("entity_type").notNull(),
  externalId: text("external_id").notNull(),
  localId: text("local_id"),
  confidence: doublePrecision("confidence"),
  snapshot: jsonb("snapshot"),
  reviewStatus: text("review_status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Vendor → VetTrack webhook payloads (Phase B Sprint 4). Signature outcome stored; payload is opaque JSON (never logged). */
export const integrationWebhookEvents = pgTable("vt_integration_webhook_events", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  adapterId: text("adapter_id").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("received"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

export const integrationWebhookEventsArchive = pgTable("vt_integration_webhook_events_archive", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull(),
  adapterId: text("adapter_id").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").notNull(),
  processedAt: timestamp("processed_at"),
  archivedAt: timestamp("archived_at").defaultNow().notNull(),
});

export const integrationSyncLogArchive = pgTable("vt_integration_sync_log_archive", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull(),
  adapterId: text("adapter_id").notNull(),
  syncType: text("sync_type").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  recordsAttempted: integer("records_attempted").notNull().default(0),
  recordsSucceeded: integer("records_succeeded").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  error: text("error"),
  jobId: text("job_id"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  metadata: jsonb("metadata"),
  archivedAt: timestamp("archived_at").defaultNow().notNull(),
});

export const pushSubscriptions = pgTable("vt_push_subscriptions", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  technicianReturnRemindersEnabled: boolean("technician_return_reminders_enabled").notNull().default(true),
  seniorOwnReturnRemindersEnabled: boolean("senior_own_return_reminders_enabled").notNull().default(true),
  seniorTeamOverdueAlertsEnabled: boolean("senior_team_overdue_alerts_enabled").notNull().default(true),
  adminHourlySummaryEnabled: boolean("admin_hourly_summary_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scheduledNotifications = pgTable("vt_scheduled_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  userId: text("user_id").notNull(),
  equipmentId: text("equipment_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  payload: jsonb("payload"),
});

export const supportTickets = pgTable("vt_support_tickets", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: varchar("severity", { length: 10 }).notNull().default("medium"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  userId: text("user_id").notNull(),
  userEmail: text("user_email").notNull(),
  pageUrl: text("page_url"),
  deviceInfo: text("device_info"),
  appVersion: text("app_version"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const bulkAuditLog = pgTable("vt_bulk_audit_log", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  eventType: varchar("event_type", { length: 30 }).notNull(),
  equipmentId: text("equipment_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  equipmentStatus: varchar("equipment_status", { length: 20 }),
  actorId: text("actor_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  note: text("note"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const auditLogs = pgTable("vt_audit_logs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  performedBy: text("performed_by").notNull(),
  performedByEmail: text("performed_by_email").notNull(),
  targetId: text("target_id"),
  targetType: varchar("target_type", { length: 50 }),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

/** Transactional outbox for durable, ordered clinical/domain events (see `server/lib/event-publisher.ts`). */
export const eventOutbox = pgTable(
  "vt_event_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Incremented when the outbox publisher fails while processing this row's batch. */
    retryCount: integer("retry_count").notNull().default(0),
    /** Last time a publish attempt failed for this row (set with retry_count bump). */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    /** After a transient publish failure, row is not eligible until this time (exponential backoff). */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /** Schema evolution for payload shape; default 1 for all new rows. */
    eventVersion: integer("event_version").notNull().default(1),
    /** Set on publish failure: `transient` (auto-retry) vs `permanent` (excluded from publisher loop). */
    errorType: varchar("error_type", { length: 20 }),
    /** Severity level for client-side prioritisation: INFO | WARNING | CRITICAL */
    level: varchar("level", { length: 10 }).notNull().default("INFO"),
    /** Domain category for filtering: TASK | PATIENT | INVENTORY | ALERT | SYSTEM */
    category: varchar("category", { length: 20 }).notNull().default("SYSTEM"),
  },
  (table) => ({
    unpublishedIdx: index("idx_vt_event_outbox_unpublished").on(table.id).where(sql`${table.publishedAt} IS NULL`),
  }),
);

export const poStatusEnum = pgEnum("vt_po_status", ["draft", "ordered", "partial", "received", "cancelled"]);

export const purchaseOrders = pgTable(
  "vt_purchase_orders",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    supplierName: text("supplier_name").notNull(),
    status: poStatusEnum("status").notNull().default("draft"),
    orderedAt: timestamp("ordered_at"),
    expectedAt: timestamp("expected_at"),
    notes: text("notes"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    clinicIdx: index("idx_po_clinic").on(table.clinicId, table.createdAt),
  }),
);

export const poLines = pgTable(
  "vt_po_lines",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantityOrdered: integer("quantity_ordered").notNull(),
    quantityReceived: integer("quantity_received").notNull().default(0),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    poIdx: index("idx_po_lines_po").on(table.purchaseOrderId),
  }),
);

// outcome is stored as TEXT with a CHECK constraint in migration 067 (not a PG enum type).
// Using text().$type preserves TS safety without declaring a phantom enum type.
type CodeBlueOutcome = "rosc" | "died" | "transferred" | "ongoing";

export const codeBlueEvents = pgTable(
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

// status stored as TEXT CHECK — consistent with codeBlueOutcome pattern
export type HospitalizationStatus = "admitted" | "observation" | "critical" | "recovering" | "discharged" | "deceased";

export const hospitalizations = pgTable(
  "vt_hospitalizations",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    animalId: text("animal_id").notNull().references(() => animals.id, { onDelete: "cascade" }),
    admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull().defaultNow(),
    dischargedAt: timestamp("discharged_at", { withTimezone: true }),
    status: text("status").$type<HospitalizationStatus>().notNull().default("admitted"),
    ward: text("ward"),
    bay: text("bay"),
    admissionReason: text("admission_reason"),
    admittingVetId: text("admitting_vet_id").references(() => users.id, { onDelete: "set null" }),
    dischargeNotes: text("discharge_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicActiveIdx: index("idx_vt_hospitalizations_clinic_active").on(table.clinicId, table.admittedAt),
    animalIdx: index("idx_vt_hospitalizations_animal").on(table.animalId),
  }),
);

// ─── Code Blue Sessions ───────────────────────────────────────────────────────

// Stored as TEXT with CHECK constraints in migrations — $type<> preserves TS safety.
type CodeBlueSessionStatus = "active" | "ended";
type CodeBlueSessionOutcome = "rosc" | "died" | "transferred" | "ongoing";
type CodeBlueLogCategory = "drug" | "shock" | "cpr" | "note" | "equipment";

export const codeBlueSessions = pgTable(
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

export const codeBlueLogEntries = pgTable(
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

export const codeBluePresence = pgTable(
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

export const crashCartItems = pgTable(
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

export const crashCartChecks = pgTable(
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

export const shiftMessages = pgTable(
  "vt_shift_messages",
  {
    id: text("id").primaryKey(),
    shiftSessionId: text("shift_session_id")
      .notNull()
      .references(() => shiftSessions.id, { onDelete: "cascade" }),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    senderId: text("sender_id").references(() => users.id, { onDelete: "set null" }),
    senderName: text("sender_name"),
    senderRole: text("sender_role"),
    body: text("body").notNull().default(""),
    type: text("type").notNull().default("regular"), // regular | broadcast | system
    broadcastKey: text("broadcast_key"),
    systemEventType: text("system_event_type"),
    systemEventPayload: jsonb("system_event_payload"),
    roomTag: text("room_tag"),
    isUrgent: boolean("is_urgent").notNull().default(false),
    mentionedUserIds: jsonb("mentioned_user_ids").notNull().default(sql`'[]'::jsonb`),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    pinnedByUserId: text("pinned_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shiftIdx: index("vt_shift_messages_shift_idx").on(table.shiftSessionId),
    clinicIdx: index("vt_shift_messages_clinic_idx").on(table.clinicId),
    createdIdx: index("vt_shift_messages_created_idx").on(table.createdAt),
  }),
);

export const shiftMessageAcks = pgTable(
  "vt_shift_message_acks",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => shiftMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // acknowledged | snoozed
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.messageId, table.userId] }),
  }),
);

export const shiftMessageReactions = pgTable(
  "vt_shift_message_reactions",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => shiftMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(), // 👍 | ✅ | 👀
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
  }),
);

export type ShiftMessage = typeof shiftMessages.$inferSelect;
export type ShiftMessageAck = typeof shiftMessageAcks.$inferSelect;
export type ShiftMessageReaction = typeof shiftMessageReactions.$inferSelect;

export const erIntakeEvents = pgTable(
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
    /** Scheduler scans due escalations (low/medium tiers only). */
    escalatesAtIdx: index("idx_er_intake_escalates_at")
      .on(table.escalatesAt)
      .where(
        sql`${table.escalatesAt} IS NOT NULL AND ${table.severity} IN ('low', 'medium') AND ${table.status} IN ('waiting', 'assigned', 'in_progress')`,
      ),
  }),
);

export const doctorAdmissionState = pgTable(
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

export const shiftHandoffs = pgTable(
  "vt_shift_handoffs",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    hospitalizationId: text("hospitalization_id")
      .references(() => hospitalizations.id, { onDelete: "set null" }),
    outgoingUserId: text("outgoing_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clinicStatusIdx: index("idx_shift_handoffs_clinic_status").on(
      table.clinicId,
      table.status
    ),
    clinicCreatedIdx: index("idx_shift_handoffs_clinic_created").on(
      table.clinicId,
      table.createdAt
    ),
  }),
);
export const shiftHandoffItems = pgTable(
  "vt_shift_handoff_items",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    handoffId: text("handoff_id")
      .notNull()
      .references(() => shiftHandoffs.id, { onDelete: "cascade" }),
    activeIssue: text("active_issue").notNull(),
    nextAction: text("next_action").notNull(),
    currentStability: text("current_stability").notNull().default(""),
    pendingTasks: text("pending_tasks").notNull().default(""),
    criticalWarnings: text("critical_warnings").notNull().default(""),
    etaMinutes: integer("eta_minutes").notNull(),
    ownerUserId: text("owner_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    riskFlags: jsonb("risk_flags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    pendingMedicationTaskId: text("pending_medication_task_id"),
    note: text("note"),
    ackBy: text("ack_by")
      .references(() => users.id, { onDelete: "set null" }),
    ackAt: timestamp("ack_at"),
    slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),
    overriddenBy: text("overridden_by")
      .references(() => users.id, { onDelete: "set null" }),
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    handoffIdx: index("idx_shift_handoff_items_handoff").on(table.handoffId),
    clinicOwnerIdx: index("idx_shift_handoff_items_clinic_owner").on(
      table.clinicId,
      table.ownerUserId
    ),
  }),
);

export const erKpiDaily = pgTable(
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
/** Append-only ER board / intake / handoff / SLA workflow events (system of record). */
export const erBoardEventLog = pgTable(
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

export const erBaselineSnapshots = pgTable(
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

/**
 * Persisted per-shift handover snapshot.
 * Written on shift end — the incoming shift reads this to understand the state
 * they're inheriting. Immutable after creation.
 */
export const shiftHandoverSnapshots = pgTable(
  "vt_shift_handover_snapshots",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    shiftSessionId: text("shift_session_id")
      .notNull()
      .references(() => shiftSessions.id, { onDelete: "restrict" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Full patient-centric JSON payload — array of per-patient objects. */
    patientsPayload: jsonb("patients_payload").notNull(),
    /** Summary counts: {patientCount, pendingTaskCount, overdueCount, unresolvedEmergencyCount} */
    summaryCounts: jsonb("summary_counts").notNull(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => ({
    clinicShiftIdx: index("idx_vt_shift_handover_snapshots_clinic_shift").on(table.clinicId, table.shiftSessionId),
    clinicGeneratedIdx: index("idx_vt_shift_handover_snapshots_clinic_generated").on(table.clinicId, table.generatedAt),
  }),
);

export type ShiftHandoverSnapshot = typeof shiftHandoverSnapshots.$inferSelect;

/** Operational / system follow-ups (e.g. billing reconciliation). */
export const operationalTasks = pgTable(
  "vt_tasks",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: text("patient_id").references(() => animals.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    tag: text("tag").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clinicCreatedIdx: index("idx_vt_tasks_clinic_created").on(table.clinicId, table.createdAt),
  }),
);

/** Cached HTTP responses for Idempotency-Key replays (financial / clinical mutations). */
export const idempotencyKeys = pgTable(
  "vt_idempotency_keys",
  {
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    requestHash: text("request_hash").notNull(),
    /** HTTP status captured when the handler finished (replay must match). */
    statusCode: integer("status_code").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clinicId, table.key] }),
    clinicCreatedIdx: index("idx_vt_idempotency_keys_clinic_created").on(table.clinicId, table.createdAt),
  }),
);

// ─── Shift Patient Handoffs (Option B) ───────────────────────────────────────

export const shiftPatientHandoffs = pgTable(
  "vt_shift_patient_handoffs",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    outgoingUserId: text("outgoing_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    receivingUserId: text("receiving_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clinicStatusIdx: index("idx_vt_sph_clinic_status").on(t.clinicId, t.status),
    receivingIdx: index("idx_vt_sph_receiving").on(t.receivingUserId, t.status),
    outgoingIdx: index("idx_vt_sph_outgoing").on(t.outgoingUserId, t.status),
  }),
);
export type ShiftPatientHandoff = typeof shiftPatientHandoffs.$inferSelect;

export const shiftPatientHandoffItems = pgTable(
  "vt_shift_patient_handoff_items",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    handoffId: text("handoff_id")
      .notNull()
      .references(() => shiftPatientHandoffs.id, { onDelete: "cascade" }),
    hospitalizationId: text("hospitalization_id")
      .notNull()
      .references(() => hospitalizations.id, { onDelete: "restrict" }),
    animalId: text("animal_id")
      .notNull()
      .references(() => animals.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    skipReason: text("skip_reason"),
    currentStability: text("current_stability").notNull().default(""),
    pendingTasksNote: text("pending_tasks_note").notNull().default(""),
    criticalWarnings: text("critical_warnings").notNull().default(""),
    clinicalNote: text("clinical_note").notNull().default(""),
    patientSnapshot: jsonb("patient_snapshot").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    handoffIdx: index("idx_vt_sphi_handoff").on(t.handoffId),
    handoffHospUq: uniqueIndex("uq_vt_sphi_handoff_hosp").on(t.handoffId, t.hospitalizationId),
  }),
);
export type ShiftPatientHandoffItem = typeof shiftPatientHandoffItems.$inferSelect;

export async function initDb() {
  // Schema initialization is now handled by the migration runner (server/migrate.ts).
  // This function is kept as a thin wrapper for backwards compatibility.
  console.log("✅ Database ready");
}
