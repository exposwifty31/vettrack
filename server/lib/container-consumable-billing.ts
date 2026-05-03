import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { billingLedger, inventoryItems } from "../db.js";
import { buildPricingSnapshot, PriceNotFoundError, resolvePrice } from "./price-resolver.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbTx = any;

/**
 * Input for a single consumable billing line from cabinet dispense.
 * Must be executed inside the caller's database transaction.
 */
export interface BillingLineInput {
  clinicId: string;
  /** Container from which the item was dispensed — drives price resolution. */
  containerId: string | null;
  /** Usage type (e.g. "dispense", "medication_task") — second dimension for price resolution. */
  usageType?: string | null;
  inventoryLogId: string;
  itemId: string;
  patientId: string | null;
  qty: number;
  /** Resolved ledger idempotency key for this line (includes HTTP Idempotency-Key when present). */
  idempotencyKey: string;
  /** For DRUG items: formularyId to persist in pricingSnapshot. */
  formularyId?: string | null;
  /** For DRUG items: formularyVersion to persist in pricingSnapshot. */
  formularyVersion?: number | null;
  /** Source type for the billing row (default: DISPENSE). */
  sourceType?: "DISPENSE" | "TASK" | "MANUAL";
  /** Dispense event that triggered this charge. */
  dispenseEventId?: string | null;
  /** Task that triggered this charge (if applicable). */
  taskId?: string | null;
  /** UserId who triggered this billing entry. */
  createdBy?: string | null;
  /** When set (only from routes gated by `VETTRACK_TEST_FORCE_BILLING_FAIL`), throws to verify TX rollback. */
  testForceBillingFail?: boolean;
}

export type ConsumableCaptureResult = {
  billingEventId: string | null;
  exemptReason?: string;
  rowTotalCents: number;
  pricingSnapshot: Record<string, unknown> | null;
};

/**
 * Creates (or reuses) a `vt_billing_ledger` row for a single dispense line.
 *
 * Price is resolved via the four-level context hierarchy (resolvePrice).
 * Missing price → throws PriceNotFoundError (no silent fallback).
 * Resolved price snapshot is persisted immutably on the ledger row.
 */
export async function captureConsumableBillingForDispenseLine(
  tx: DbTx,
  input: BillingLineInput,
): Promise<ConsumableCaptureResult> {
  const {
    clinicId,
    containerId,
    usageType,
    inventoryLogId,
    itemId,
    patientId,
    qty: quantity,
    idempotencyKey: rawKey,
    formularyId,
    formularyVersion,
    testForceBillingFail,
  } = input;

  if (testForceBillingFail) {
    throw Object.assign(new Error("TEST_FORCE_BILLING_FAIL"), { statusCode: 500 });
  }

  const idempotencyKey = rawKey.trim();
  if (!idempotencyKey) {
    throw new Error("idempotencyKey is required for consumable billing capture");
  }

  // Check billability
  const [invItem] = await tx
    .select({
      isBillable: inventoryItems.isBillable,
      minimumDispenseToCapture: inventoryItems.minimumDispenseToCapture,
      isActive: inventoryItems.isActive,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, itemId)))
    .limit(1);

  if (!invItem?.isBillable) {
    return { billingEventId: null, exemptReason: "not_billable", rowTotalCents: 0, pricingSnapshot: null };
  }

  if (quantity < invItem.minimumDispenseToCapture) {
    return { billingEventId: null, exemptReason: "below_minimum_dispense", rowTotalCents: 0, pricingSnapshot: null };
  }

  if (!patientId) {
    return { billingEventId: null, exemptReason: "no_patient", rowTotalCents: 0, pricingSnapshot: null };
  }

  // Idempotency: return existing row if already billed
  const [existing] = await tx
    .select({ id: billingLedger.id, totalAmountCents: billingLedger.totalAmountCents, pricingSnapshot: billingLedger.pricingSnapshot })
    .from(billingLedger)
    .where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.idempotencyKey, idempotencyKey)))
    .limit(1);

  if (existing) {
    return {
      billingEventId: existing.id,
      rowTotalCents: existing.totalAmountCents,
      pricingSnapshot: existing.pricingSnapshot as Record<string, unknown> | null,
    };
  }

  // Resolve price — throws PriceNotFoundError if no price is configured (no silent fallback).
  // Note: resolvePrice uses the main db pool. For TX isolation, callers should ensure
  // the price row is already committed before the TX that inserts the billing row,
  // or pass a resolved price override for tests.
  let priceResolution;
  try {
    priceResolution = await resolvePrice({
      clinicId,
      itemId,
      containerId,
      usageType,
      timestamp: new Date(),
      formularyId,
      formularyVersion,
    });
  } catch (err) {
    if (err instanceof PriceNotFoundError) {
      throw err;
    }
    throw err;
  }

  const unitPriceCents = priceResolution.priceCents;
  const snapshot = buildPricingSnapshot(priceResolution);
  const ledgerId = randomUUID();
  const rowTotalCents = unitPriceCents * quantity;

  await tx.insert(billingLedger).values({
    id: ledgerId,
    clinicId,
    animalId: patientId,
    itemType: "CONSUMABLE",
    itemId,
    quantity,
    unitPriceCents,
    totalAmountCents: rowTotalCents,
    idempotencyKey,
    status: "pending",
    pricingSnapshot: snapshot,
    entryType: "CHARGE",
    sourceType: input.sourceType ?? "DISPENSE",
    dispenseEventId: input.dispenseEventId ?? null,
    taskId: input.taskId ?? null,
    createdBy: input.createdBy ?? null,
    formularyId: priceResolution.formularyId ?? null,
    formularyVersion: priceResolution.formularyVersion ?? null,
  });

  return { billingEventId: ledgerId, rowTotalCents, pricingSnapshot: snapshot };
}

/** Documented bypass reasons for emergency cabinet dispense (route validates / persists separately). */
export type ConsumableBillingBypassReason = "EMERGENCY_CPR" | "PROTOCOL_OVERRIDE" | "TECH_ERROR";
