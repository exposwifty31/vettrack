import { text, integer, varchar, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, animals } from "./core.js";

export const billingChargeKindEnum = pgEnum("vt_billing_charge_kind", ["per_scan_hour", "per_unit"]);
export const billingLedgerItemTypeEnum = pgEnum("vt_billing_ledger_item_type", ["EQUIPMENT", "CONSUMABLE"]);
export const billingLedgerStatusEnum = pgEnum("vt_billing_ledger_status", ["pending", "synced", "voided"]);
export const usageSessionStatusEnum = pgEnum("vt_usage_session_status", ["open", "closed"]);

export const billingItems = vtTable("vt_billing_items", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  code: text("code").notNull(),
  description: text("description").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  chargeKind: billingChargeKindEnum("charge_kind").notNull().default("per_unit"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const billingLedger = vtTable("vt_billing_ledger", {
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
