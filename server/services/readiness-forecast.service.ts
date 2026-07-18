/**
 * R-PDF-1 — Predictive readiness service.
 *
 * Drizzle-backed adapter for the pure engine (server/lib/readiness-forecast-engine.ts)
 * plus the clinic-scoped orchestrator entry point used by the Analytics route.
 *
 * Multi-tenancy: EVERY read below filters its target table by clinicId. v1 adds
 * NO schema — demand is inferred from existing appointment fields (metadata +
 * inventoryItemId); no per-procedure template table exists yet.
 */

import { and, eq, gte, lte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  db,
  appointments,
  equipment,
  containerItems,
  dispenseEvents,
  poLines,
  purchaseOrders,
} from "../db.js";
import { getReadinessRules } from "./equipment-readiness-rules.service.js";
import { incrementMetric } from "../lib/metrics.js";
import {
  ScheduleDemandSource,
  computeReadinessForecast,
  toRedactedForecastDTO,
  DEFAULT_HORIZON_HOURS,
  type ReadinessForecastReader,
  type ReadinessForecastDTO,
  type ScheduledProcedureRow,
  type EquipmentUnitRow,
  type ConsumableStockRow,
  type ConsumptionRow,
  type IncomingStockRow,
  type ForecastWindow,
  type DemandUnitConflict,
} from "../lib/readiness-forecast-engine.js";

const ACTIVE_DISPENSE_STATES = ["CONFIRMED", "COMPLETED"] as const;
const INCOMING_PO_STATES = ["ordered", "partial"] as const;

/** Loose shape of an appointment's metadata that carries requirements. All
 *  fields are optional — v1 reads whatever existing config populated. */
interface AppointmentRequirementsMeta {
  requiredEquipment?: Array<{ assetTypeId?: unknown; quantity?: unknown; unit?: unknown }>;
  requiredConsumables?: Array<{ itemId?: unknown; quantity?: unknown; unit?: unknown }>;
  dispenseQuantity?: unknown;
}

/**
 * Resolve a requirement quantity from loosely-typed metadata. An ABSENT value
 * (undefined/null) falls back to `fallbackWhenAbsent`; an explicitly-provided but
 * INVALID value (0, negative, NaN, non-number) returns null so the caller DROPS
 * the requirement. Coercing invalid input to a default would invent demand,
 * violating the precision-first bias.
 */
export function resolveQuantity(v: unknown, fallbackWhenAbsent: number): number | null {
  if (v === undefined || v === null) return fallbackWhenAbsent;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return null;
}

/** Derive required equipment/consumables from EXISTING appointment fields only
 *  (metadata arrays + the inventoryItemId column). No schema, no template table. */
export function extractRequirements(row: {
  metadata: unknown;
  inventoryItemId: string | null;
}): Pick<ScheduledProcedureRow, "requiredEquipment" | "requiredConsumables"> {
  const meta = (row.metadata ?? {}) as AppointmentRequirementsMeta;

  const requiredEquipment: NonNullable<ScheduledProcedureRow["requiredEquipment"]> = [];
  for (const e of Array.isArray(meta.requiredEquipment) ? meta.requiredEquipment : []) {
    if (typeof e?.assetTypeId === "string" && e.assetTypeId) {
      const quantity = resolveQuantity(e.quantity, 1);
      if (quantity === null) continue; // explicit-invalid → drop (do not invent demand)
      requiredEquipment.push({
        assetTypeId: e.assetTypeId,
        quantity,
        unit: typeof e.unit === "string" ? e.unit : undefined,
      });
    }
  }

  const requiredConsumables: NonNullable<ScheduledProcedureRow["requiredConsumables"]> = [];
  const seenItems = new Set<string>();
  for (const c of Array.isArray(meta.requiredConsumables) ? meta.requiredConsumables : []) {
    if (typeof c?.itemId === "string" && c.itemId) {
      // Mark referenced up-front so the inventoryItemId fallback below never
      // resurrects an item whose explicit quantity we just dropped as invalid.
      seenItems.add(c.itemId);
      const quantity = resolveQuantity(c.quantity, 1);
      if (quantity === null) continue; // explicit-invalid → drop (do not invent demand)
      requiredConsumables.push({
        itemId: c.itemId,
        quantity,
        unit: typeof c.unit === "string" ? c.unit : undefined,
      });
    }
  }
  // The medication task's primary item column — count it once (not if already listed).
  if (row.inventoryItemId && !seenItems.has(row.inventoryItemId)) {
    const quantity = resolveQuantity(meta.dispenseQuantity, 1);
    if (quantity !== null) {
      requiredConsumables.push({ itemId: row.inventoryItemId, quantity });
    }
  }

  return { requiredEquipment, requiredConsumables };
}

/**
 * Postgres/Drizzle implementation of the forecast reader port. Every method
 * filters its target table by clinicId (multi-tenancy), reads existing columns
 * only, and returns the plain row shapes the pure engine consumes.
 */
export class DrizzleReadinessForecastReader implements ReadinessForecastReader {
  async scheduledProcedures(clinicId: string, window: ForecastWindow): Promise<ScheduledProcedureRow[]> {
    const rows = await db
      .select({
        id: appointments.id,
        clinicId: appointments.clinicId,
        startTime: appointments.startTime,
        status: appointments.status,
        metadata: appointments.metadata,
        inventoryItemId: appointments.inventoryItemId,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          notInArray(appointments.status, ["completed", "cancelled"]),
          gte(appointments.startTime, new Date(window.fromMs)),
          lte(appointments.startTime, new Date(window.toMs)),
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      clinicId: r.clinicId,
      startTimeMs: r.startTime.getTime(),
      status: r.status,
      ...extractRequirements({ metadata: r.metadata, inventoryItemId: r.inventoryItemId }),
    }));
  }

  async equipmentUnits(clinicId: string): Promise<EquipmentUnitRow[]> {
    const rows = await db
      .select({
        id: equipment.id,
        clinicId: equipment.clinicId,
        assetTypeId: equipment.assetTypeId,
        readinessState: equipment.readinessState,
        readinessStateSince: equipment.readinessStateSince,
        usageState: equipment.usageState,
        custodyState: equipment.custodyState,
        reservedForSessionId: equipment.reservedForSessionId,
        deletedAt: equipment.deletedAt,
      })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)));

    return rows.map((r) => ({
      id: r.id,
      clinicId: r.clinicId,
      assetTypeId: r.assetTypeId,
      readinessState: r.readinessState,
      readinessStateSince: r.readinessStateSince ? r.readinessStateSince.getTime() : null,
      usageState: r.usageState,
      custodyState: r.custodyState,
      reservedForSessionId: r.reservedForSessionId,
      deletedAt: r.deletedAt ? r.deletedAt.getTime() : null,
    }));
  }

  async readinessRules(clinicId: string) {
    return getReadinessRules(clinicId);
  }

  async consumableStock(clinicId: string, itemIds: string[]): Promise<ConsumableStockRow[]> {
    if (itemIds.length === 0) return [];
    const rows = await db
      .select({
        itemId: containerItems.itemId,
        onHand: sql<number>`COALESCE(SUM(${containerItems.quantity}), 0)::int`,
      })
      .from(containerItems)
      .where(and(eq(containerItems.clinicId, clinicId), inArray(containerItems.itemId, itemIds)))
      .groupBy(containerItems.itemId);

    // Consumables have NO reservation concept → reserved = 0 (verified: no
    // reservations table exists; migration 170 only adds an advisory column).
    return rows.map((r) => ({ itemId: r.itemId, clinicId, onHand: Number(r.onHand), reserved: 0, unit: "unit" }));
  }

  async consumption(clinicId: string, fromMs: number, toMs: number, itemIds: string[]): Promise<ConsumptionRow[]> {
    if (itemIds.length === 0) return [];
    // Burn keys on WHEN the dispense actually happened: completedAt for COMPLETED
    // events, confirmedAt for CONFIRMED-not-yet-completed events. COALESCE falls
    // back to createdAt only if both are somehow null (defensive; should not occur
    // for CONFIRMED/COMPLETED rows).
    const dispensedAt = sql`COALESCE(${dispenseEvents.completedAt}, ${dispenseEvents.confirmedAt}, ${dispenseEvents.createdAt})`;
    const rows = await db
      .select({ items: dispenseEvents.items })
      .from(dispenseEvents)
      .where(
        and(
          eq(dispenseEvents.clinicId, clinicId),
          inArray(dispenseEvents.status, ACTIVE_DISPENSE_STATES as unknown as string[]),
          sql`${dispensedAt} >= ${new Date(fromMs)}`,
          sql`${dispensedAt} <= ${new Date(toMs)}`,
        ),
      );

    const wanted = new Set(itemIds);
    const consumed = new Map<string, number>();
    for (const row of rows) {
      const items = Array.isArray(row.items) ? (row.items as Array<{ itemId?: unknown; quantity?: unknown }>) : [];
      for (const it of items) {
        if (typeof it?.itemId === "string" && wanted.has(it.itemId) && typeof it.quantity === "number") {
          consumed.set(it.itemId, (consumed.get(it.itemId) ?? 0) + Math.max(0, it.quantity));
        }
      }
    }
    return [...consumed.entries()].map(([itemId, consumedUnits]) => ({ itemId, clinicId, consumedUnits }));
  }

  async incomingStock(clinicId: string, _horizonEndMs: number, itemIds: string[]): Promise<IncomingStockRow[]> {
    if (itemIds.length === 0) return [];
    const rows = await db
      .select({
        itemId: poLines.itemId,
        purchaseOrderId: poLines.purchaseOrderId,
        quantityOrdered: poLines.quantityOrdered,
        quantityReceived: poLines.quantityReceived,
        expectedAt: purchaseOrders.expectedAt,
      })
      .from(poLines)
      .innerJoin(purchaseOrders, eq(poLines.purchaseOrderId, purchaseOrders.id))
      .where(
        and(
          eq(poLines.clinicId, clinicId),
          // Tenancy: the JOINED purchaseOrders table must also be clinic-scoped,
          // not only poLines (repo rule — every query filters clinicId).
          eq(purchaseOrders.clinicId, clinicId),
          inArray(poLines.itemId, itemIds),
          inArray(purchaseOrders.status, INCOMING_PO_STATES as unknown as Array<"ordered" | "partial">),
        ),
      );

    return rows
      .map((r) => ({
        itemId: r.itemId,
        clinicId,
        purchaseOrderId: r.purchaseOrderId,
        // Outstanding (not-yet-received) quantity. quantityOrdered is already in
        // item units, so unitsPerPack = 1 (identity conversion — real, testable
        // mechanism, no invented pack data).
        quantity: Math.max(0, r.quantityOrdered - r.quantityReceived),
        unitsPerPack: 1,
        etaMs: r.expectedAt ? r.expectedAt.getTime() : null,
      }))
      .filter((r) => r.quantity > 0);
  }
}

/**
 * Compute the redacted predictive-readiness forecast for a clinic. Read-only:
 * produces PO RECOMMENDATIONS only — it creates no purchase orders.
 */
export async function getReadinessForecast(
  clinicId: string,
  options: { nowMs?: number; horizonHours?: number } = {},
): Promise<ReadinessForecastDTO> {
  const reader = new DrizzleReadinessForecastReader();
  const nowMs = options.nowMs ?? Date.now();
  const horizonHours = options.horizonHours ?? DEFAULT_HORIZON_HOURS;

  // A freeform-metadata unit conflict degrades that key only (it is excluded from
  // the forecast); every other key still forecasts. Count + log it — bounded
  // counter (no keyId/unit label leaks into the metric). Distinct dropped keys are
  // tracked so the returned DTO can signal that the forecast is PARTIAL rather than
  // masquerade as complete (an omitted requirement would otherwise read as "no
  // shortfall" in the Analytics panel).
  const droppedKeys = new Set<string>();
  const onUnitConflict = (conflict: DemandUnitConflict): void => {
    droppedKeys.add(conflict.keyId);
    incrementMetric("readiness_forecast_demand_unit_conflict");
    console.warn(
      `[readiness-forecast] demand unit conflict for ${conflict.keyId} ("${conflict.existingUnit}" vs "${conflict.conflictingUnit}") — key excluded`,
    );
  };

  const { shortfalls } = await computeReadinessForecast(
    { reader, demandSource: new ScheduleDemandSource(reader, { onUnitConflict }), nowMs, horizonHours, onUnitConflict },
    clinicId,
  );

  return toRedactedForecastDTO(clinicId, shortfalls, {
    horizonHours,
    generatedAtMs: nowMs,
    omittedRequirementCount: droppedKeys.size,
  });
}
