import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { db, inventoryItemPrices } from "../db.js";

export type PriceContextType = "CONTAINER" | "USAGE" | "GLOBAL";

export interface PriceResolutionInput {
  clinicId: string;
  itemId: string;
  /** Container from which the item is being dispensed (if applicable). */
  containerId?: string | null;
  /** Usage type string, e.g. "medication_task", "emergency_dispense" (if applicable). */
  usageType?: string | null;
  /** Timestamp to evaluate price effectivity against (defaults to now). */
  timestamp?: Date;
  /** For DRUG items: formularyId for inclusion in snapshot. */
  formularyId?: string | null;
  /** For DRUG items: formularyVersion for inclusion in snapshot. */
  formularyVersion?: number | null;
}

export interface PriceResolutionResult {
  priceCents: number;
  currency: string;
  contextType: PriceContextType;
  contextId: string | null;
  resolvedAt: string;
  /** Which level of the resolution hierarchy produced this result. */
  priceSource: "exact" | "container" | "usage" | "global";
  /** Ordered path of context types checked during resolution. */
  resolutionPath: string[];
  contextUsed: {
    containerId: string | null;
    usageType: string | null;
  };
  formularyId: string | null;
  formularyVersion: number | null;
}

export class PriceNotFoundError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly clinicId: string,
    public readonly contextTried: string[],
  ) {
    super(
      `No price found for item '${itemId}' in clinic '${clinicId}'. ` +
        `Tried: ${contextTried.join(" → ")}. ` +
        `Add a price entry via /api/inventory-items/${itemId}/prices.`,
    );
    this.name = "PriceNotFoundError";
  }
}

/**
 * Resolve item price using four-level context hierarchy.
 *
 * Resolution order (most specific → least specific):
 *   1. exact       — containerId + usageType both match
 *   2. container   — containerId matches, no usageType filter
 *   3. usage       — usageType matches, no containerId filter
 *   4. global      — contextType = GLOBAL
 *
 * If no price is found at any level → throws PriceNotFoundError.
 * No silent fallback. No auto-created defaults.
 */
export async function resolvePrice(input: PriceResolutionInput): Promise<PriceResolutionResult> {
  const { clinicId, itemId, containerId, usageType, timestamp, formularyId, formularyVersion } = input;
  const at = timestamp ?? new Date();
  const resolutionPath: string[] = [];

  const baseWhere = and(
    eq(inventoryItemPrices.clinicId, clinicId),
    eq(inventoryItemPrices.itemId, itemId),
    lte(inventoryItemPrices.effectiveFrom, at),
  );

  // ── Level 1: exact match (containerId + usageType) ──────────────────────
  if (containerId && usageType) {
    resolutionPath.push(`exact(container=${containerId},usage=${usageType})`);
    const [exact] = await db
      .select()
      .from(inventoryItemPrices)
      .where(
        and(
          baseWhere,
          eq(inventoryItemPrices.contextType, "CONTAINER"),
          eq(inventoryItemPrices.contextId, `${containerId}:${usageType}`),
        ),
      )
      .orderBy(desc(inventoryItemPrices.effectiveFrom))
      .limit(1);
    if (exact) {
      return buildResult(exact, "exact", resolutionPath, containerId, usageType, formularyId, formularyVersion, at);
    }
  }

  // ── Level 2: container-level ─────────────────────────────────────────────
  if (containerId) {
    resolutionPath.push(`container(${containerId})`);
    const [containerRow] = await db
      .select()
      .from(inventoryItemPrices)
      .where(
        and(
          baseWhere,
          eq(inventoryItemPrices.contextType, "CONTAINER"),
          eq(inventoryItemPrices.contextId, containerId),
        ),
      )
      .orderBy(desc(inventoryItemPrices.effectiveFrom))
      .limit(1);
    if (containerRow) {
      return buildResult(containerRow, "container", resolutionPath, containerId, usageType ?? null, formularyId, formularyVersion, at);
    }
  }

  // ── Level 3: usage-level ─────────────────────────────────────────────────
  if (usageType) {
    resolutionPath.push(`usage(${usageType})`);
    const [usageRow] = await db
      .select()
      .from(inventoryItemPrices)
      .where(
        and(
          baseWhere,
          eq(inventoryItemPrices.contextType, "USAGE"),
          eq(inventoryItemPrices.contextId, usageType),
        ),
      )
      .orderBy(desc(inventoryItemPrices.effectiveFrom))
      .limit(1);
    if (usageRow) {
      return buildResult(usageRow, "usage", resolutionPath, containerId ?? null, usageType, formularyId, formularyVersion, at);
    }
  }

  // ── Level 4: global ──────────────────────────────────────────────────────
  resolutionPath.push("global");
  const [globalRow] = await db
    .select()
    .from(inventoryItemPrices)
    .where(
      and(
        baseWhere,
        eq(inventoryItemPrices.contextType, "GLOBAL"),
        isNull(inventoryItemPrices.contextId),
      ),
    )
    .orderBy(desc(inventoryItemPrices.effectiveFrom))
    .limit(1);

  if (globalRow) {
    return buildResult(globalRow, "global", resolutionPath, containerId ?? null, usageType ?? null, formularyId, formularyVersion, at);
  }

  // ── No price found — explicit error, no silent fallback ──────────────────
  throw new PriceNotFoundError(itemId, clinicId, resolutionPath);
}

function buildResult(
  row: typeof inventoryItemPrices.$inferSelect,
  source: PriceResolutionResult["priceSource"],
  resolutionPath: string[],
  containerId: string | null,
  usageType: string | null,
  formularyId: string | null | undefined,
  formularyVersion: number | null | undefined,
  resolvedAt: Date,
): PriceResolutionResult {
  return {
    priceCents: row.priceCents,
    currency: row.currency,
    contextType: row.contextType as PriceContextType,
    contextId: row.contextId,
    resolvedAt: resolvedAt.toISOString(),
    priceSource: source,
    resolutionPath: [...resolutionPath],
    contextUsed: { containerId, usageType },
    formularyId: formularyId ?? null,
    formularyVersion: formularyVersion ?? null,
  };
}

/**
 * Build the immutable pricingSnapshot object for persisting on billing ledger rows.
 * Call this with the result of resolvePrice() and store it in billingLedger.pricingSnapshot.
 */
export function buildPricingSnapshot(result: PriceResolutionResult): Record<string, unknown> {
  return {
    priceCents: result.priceCents,
    currency: result.currency,
    contextType: result.contextType,
    contextId: result.contextId,
    resolvedAt: result.resolvedAt,
    priceSource: result.priceSource,
    resolutionPath: result.resolutionPath,
    contextUsed: result.contextUsed,
    formularyId: result.formularyId,
    formularyVersion: result.formularyVersion,
  };
}
