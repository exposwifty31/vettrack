import { sql } from "drizzle-orm";
import {
  text, timestamp, integer, boolean, varchar, jsonb,
  numeric, index, uniqueIndex, check, pgEnum,
} from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, users } from "./core.js";
import { rooms } from "./equipment.js";

export const inventoryLogTypeEnum = pgEnum("vt_inventory_log_type", ["restock", "blind_audit", "adjustment"]);
export const poStatusEnum = pgEnum("vt_po_status", ["draft", "ordered", "partial", "received", "cancelled"]);

export const containers = vtTable("vt_containers", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  department: text("department").notNull().default(""),
  targetQuantity: integer("target_quantity").notNull().default(0),
  currentQuantity: integer("current_quantity").notNull().default(0),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  nfcTagId: text("nfc_tag_id").unique(),
}, (table) => ({
  // On-hand stock can never be negative — DB-level safety net behind the
  // service-layer flooring (see migration 125).
  currentQuantityNonNegative: check(
    "vt_containers_current_quantity_non_negative",
    sql`${table.currentQuantity} >= 0`,
  ),
  clinicIdx: index("idx_vt_containers_clinic").on(table.clinicId),
}));

export const inventoryItems = vtTable(
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    externalId: text("external_id"),
    externalSource: text("external_source"),
    externalSyncedAt: timestamp("external_synced_at"),
  },
  (table) => ({
    clinicCodeUnique: uniqueIndex("vt_items_clinic_code_unique").on(table.clinicId, table.code),
    clinicIdx: index("idx_items_clinic").on(table.clinicId),
    clinicActiveIdx: index("idx_items_clinic_active").on(table.clinicId, table.isActive),
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
export const inventoryItemPrices = vtTable(
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

export const containerItems = vtTable(
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
    // On-hand stock can never be negative — DB-level safety net behind the
    // service-layer flooring (see migration 125).
    quantityNonNegative: check("vt_container_items_quantity_non_negative", sql`${table.quantity} >= 0`),
  }),
);

export const restockSessions = vtTable(
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

export const restockEvents = vtTable(
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

export const inventoryLogs = vtTable(
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
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    note: text("note"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
 * DRAFT → CONFIRMED → COMPLETED (inventory async).
 * EMERGENCY_PENDING → CONFIRMED (after staff completion).
 */
export const dispenseEvents = vtTable(
  "vt_dispense_events",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "restrict" }),
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

export const purchaseOrders = vtTable(
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

export const poLines = vtTable(
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
