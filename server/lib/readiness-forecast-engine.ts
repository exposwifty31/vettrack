/**
 * R-PDF-1 — Predictive readiness engine ("will you be ready").
 *
 * Pure, DB-free forecasting core (mirrors the analytics-kpis.ts precedent so the
 * demand / supply / shortfall math is unit-testable without a database). All DB
 * reads live behind the ReadinessForecastReader port; the Drizzle adapter +
 * orchestrator wiring live in server/services/readiness-forecast.service.ts.
 *
 * Design invariants (pinned by the R-PDF-1 sub-spec):
 *  - Demand is SCHEDULE-ONLY in v1. Burn rate is a SEPARATE shortfall term, never
 *    folded into demand (consumption is counted exactly once).
 *  - readySupply is the INTERSECTION of available ∧ ready (never a sum).
 *  - Everything is computed per demand key in that key's canonical unit; equipment
 *    unit-counts and consumable quantities are never summed into one aggregate.
 *  - Conservative / precision-first: required rounds UP, available rounds DOWN.
 *  - v1 adds NO schema — existing fields/configuration only.
 */

import type { EquipmentReadinessRulesV1 } from "../../shared/equipment-readiness-rules.js";

// ---------------------------------------------------------------------------
// Demand model (R-PDF-1.1) — a single DemandSource interface. v1 = schedule-only.
// ---------------------------------------------------------------------------

export type DemandKind = "equipment" | "consumable";

/** A demand key. Identity is `kind:ref` — `unit` is display/conversion metadata
 *  only, so demand and supply keys join by ref even if their unit strings differ. */
export interface DemandKey {
  kind: DemandKind;
  ref: string; // assetTypeId (equipment) | itemId (consumable)
  unit: string; // canonical unit ("unit" for equipment; the item's stock unit for a consumable)
}

/** Stable key identity — deliberately excludes `unit`. */
export function demandKeyId(key: DemandKey): string {
  return `${key.kind}:${key.ref}`;
}

export interface DemandEntry {
  key: DemandKey;
  /** Required quantity across the forecast window, in `key.unit`. */
  requiredQuantity: number;
  /** Source appointment ids (explainability — ids only, never PII). */
  sourceAppointmentIds: string[];
}

export interface ForecastWindow {
  fromMs: number;
  toMs: number;
  horizonHours: number;
}

/**
 * A scheduled procedure with its required items ALREADY extracted from existing
 * appointment fields (metadata + inventoryItemId) by the reader adapter. The
 * schedule demand source only aggregates — it never re-parses raw rows, and it
 * never reads consumption. This keeps the DemandSource interface free of any
 * inference-only assumption (a template impl fills the same shape differently).
 */
export interface ScheduledProcedureRow {
  id: string;
  clinicId: string;
  startTimeMs: number;
  status: string;
  requiredEquipment?: Array<{ assetTypeId: string; quantity?: number; unit?: string }>;
  requiredConsumables?: Array<{ itemId: string; quantity: number; unit?: string }>;
}

/** Port: fetch scheduled procedures for a clinic + window (clinicId-filtered). */
export interface ScheduleReader {
  scheduledProcedures(clinicId: string, window: ForecastWindow): Promise<ScheduledProcedureRow[]>;
}

/** The R-PDF-1.1 seam. Both the v1 schedule impl and a future per-procedure
 *  template impl satisfy this exact contract, so templates arrive with no rewrite. */
export interface DemandSource {
  getDemand(clinicId: string, window: ForecastWindow): Promise<DemandEntry[]>;
}

const EQUIPMENT_UNIT = "unit";

/**
 * v1 DemandSource: required equipment/consumables inferred from scheduled
 * procedures only. Historical usage/burn rate is intentionally NOT read here —
 * it is a separate shortfall term (R-PDF-1.3), so consumption is counted once.
 */
export class ScheduleDemandSource implements DemandSource {
  constructor(private readonly reader: ScheduleReader) {}

  async getDemand(clinicId: string, window: ForecastWindow): Promise<DemandEntry[]> {
    const procedures = await this.reader.scheduledProcedures(clinicId, window);

    const byKey = new Map<string, DemandEntry>();
    const add = (key: DemandKey, quantity: number, appointmentId: string): void => {
      if (!(quantity > 0)) return;
      const id = demandKeyId(key);
      const existing = byKey.get(id);
      if (existing) {
        existing.requiredQuantity += quantity;
        if (!existing.sourceAppointmentIds.includes(appointmentId)) {
          existing.sourceAppointmentIds.push(appointmentId);
        }
        return;
      }
      byKey.set(id, {
        key,
        requiredQuantity: quantity,
        sourceAppointmentIds: [appointmentId],
      });
    };

    for (const p of procedures) {
      for (const eq of p.requiredEquipment ?? []) {
        add(
          { kind: "equipment", ref: eq.assetTypeId, unit: eq.unit ?? EQUIPMENT_UNIT },
          eq.quantity ?? 1,
          p.id,
        );
      }
      for (const c of p.requiredConsumables ?? []) {
        add(
          { kind: "consumable", ref: c.itemId, unit: c.unit ?? EQUIPMENT_UNIT },
          c.quantity,
          p.id,
        );
      }
    }

    return [...byKey.values()];
  }
}

// ---------------------------------------------------------------------------
// Supply model (R-PDF-1.2) — readySupply = intersection of available ∧ ready.
// ---------------------------------------------------------------------------

/** An equipment unit with the operational-state columns the forecast reads. */
export interface EquipmentUnitRow {
  id: string;
  clinicId: string;
  assetTypeId: string | null;
  readinessState: string; // ready | not_ready | unknown
  readinessStateSince: number | null;
  usageState: string; // available | staged | in_use | emergency_use | procedure_bound
  custodyState: string; // untracked | docked | checked_out | returned
  reservedForSessionId: string | null;
  deletedAt: number | null;
}

/** Usage states that mean a unit is actively committed and NOT free to allocate. */
const COMMITTED_USAGE_STATES = new Set(["in_use", "emergency_use", "procedure_bound", "staged"]);

/**
 * A unit is AVAILABLE when it is free to be allocated: not soft-deleted, not
 * checked out to a technician, not actively in use/staged, and not soft-reserved
 * for an active Code Blue session. (Consumables have no reservation concept.)
 */
export function isUnitAvailable(u: EquipmentUnitRow): boolean {
  if (u.deletedAt != null) return false;
  if (u.custodyState === "checked_out") return false;
  if (COMMITTED_USAGE_STATES.has(u.usageState)) return false;
  if (u.reservedForSessionId != null) return false;
  return true;
}

/**
 * A unit is READY when its persisted readinessState is "ready" AND its readiness
 * evidence is not stale beyond the clinic's staleEvidenceMs (composes the
 * readiness-rules service). A ready unit with stale evidence can no longer be
 * trusted as ready, so it is excluded from supply.
 */
export function isUnitReady(u: EquipmentUnitRow, rules: EquipmentReadinessRulesV1, nowMs: number): boolean {
  if (u.readinessState !== "ready") return false;
  if (u.readinessStateSince != null && nowMs - u.readinessStateSince > rules.staleEvidenceMs) {
    return false;
  }
  return true;
}

export interface AssetTypeSupply {
  /** |available ∧ ready| — the exact term consumed by the shortfall equation. */
  readySupply: number;
  /** |available| — for cross-checks only; NEVER summed with `ready`. */
  available: number;
  /** |ready| — for cross-checks only; NEVER summed with `available`. */
  ready: number;
}

/**
 * Per-asset-type readySupply as the intersection of available ∧ ready. Each unit
 * is evaluated once and contributes at most one to `readySupply`. Units with no
 * asset type are ignored (they cannot satisfy a typed demand key).
 */
export function computeReadySupply(
  units: EquipmentUnitRow[],
  rules: EquipmentReadinessRulesV1,
  nowMs: number,
): Map<string, AssetTypeSupply> {
  const byType = new Map<string, AssetTypeSupply>();
  for (const u of units) {
    if (!u.assetTypeId) continue;
    let row = byType.get(u.assetTypeId);
    if (!row) {
      row = { readySupply: 0, available: 0, ready: 0 };
      byType.set(u.assetTypeId, row);
    }
    const available = isUnitAvailable(u);
    const ready = isUnitReady(u, rules, nowMs);
    if (available) row.available++;
    if (ready) row.ready++;
    if (available && ready) row.readySupply++; // intersection — counted once
  }
  return byType;
}

// ---------------------------------------------------------------------------
// Shortfall join + burn-rate projection (R-PDF-1.3).
// ---------------------------------------------------------------------------

/** Trailing consumption window (days) used to derive the per-hour burn rate. */
export const BURN_WINDOW_DAYS = 14;
/** Default forecast horizon (hours) — the next scheduled-procedure window. */
export const DEFAULT_HORIZON_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

/** Consumable on-hand snapshot per SKU. reserved is 0 for consumables (no
 *  reservation concept exists), but the field is carried for completeness. */
export interface ConsumableStockRow {
  itemId: string;
  clinicId: string;
  onHand: number;
  reserved: number;
  unit: string;
}

/** Total consumed units per SKU across the trailing burn window. */
export interface ConsumptionRow {
  itemId: string;
  clinicId: string;
  consumedUnits: number;
}

/** An inbound purchase-order line. `quantity` is in packs; `unitsPerPack` is the
 *  explicit per-item conversion applied so incoming supply is in the item's unit. */
export interface IncomingStockRow {
  itemId: string;
  clinicId: string;
  purchaseOrderId: string;
  quantity: number;
  unitsPerPack: number;
  etaMs: number | null;
}

export interface ShortfallInput {
  demand: DemandEntry[];
  /** Per-asset-type readySupply count (from computeReadySupply). */
  readySupplyByAssetType: Map<string, number>;
  consumableStock: ConsumableStockRow[];
  consumption: ConsumptionRow[];
  incoming: IncomingStockRow[];
  window: ForecastWindow;
}

export interface ShortfallSource {
  appointmentIds: string[];
  stock: { onHand: number; reserved: number } | null;
  burn: { consumedUnits: number; windowDays: number } | null;
  incoming: Array<{ purchaseOrderId: string; quantityUnits: number; etaMs: number | null }>;
}

export interface ShortfallRow {
  key: DemandKey;
  keyId: string;
  demand: number;
  burnRatePerHour: number;
  requiredThroughHorizon: number; // ceil
  readySupply: number;
  availableCurrentStock: number;
  incomingStock: number;
  availableSupplyThroughHorizon: number; // floor
  shortfall: number; // max(0, required − available)
  source: ShortfallSource;
}

/** Normalize trailing-window consumption to units-per-hour so `× horizonHours`
 *  stays dimensionally consistent regardless of the resolved horizon. */
export function burnRatePerHour(consumedUnits: number, windowDays: number = BURN_WINDOW_DAYS): number {
  return consumedUnits / (windowDays * 24);
}

/**
 * Compute the shortfall for every demand key INDEPENDENTLY, in that key's
 * canonical unit. Equipment unit-counts and consumable quantities are never
 * summed into one aggregate. required rounds UP (ceil), available rounds DOWN
 * (floor) so shortfall is never understated. Ordered by descending shortfall,
 * then key id.
 */
export function computeShortfalls(input: ShortfallInput, _nowMs: number = Date.now()): ShortfallRow[] {
  const { window } = input;
  const stockByItem = new Map(input.consumableStock.map((s) => [s.itemId, s]));
  const consumedByItem = new Map(input.consumption.map((c) => [c.itemId, c.consumedUnits]));
  const incomingByItem = new Map<string, IncomingStockRow[]>();
  for (const row of input.incoming) {
    const arr = incomingByItem.get(row.itemId) ?? [];
    arr.push(row);
    incomingByItem.set(row.itemId, arr);
  }

  // Aggregate demand per key (a key may span several demand entries).
  const demandByKey = new Map<string, { key: DemandKey; quantity: number; appointmentIds: string[] }>();
  for (const entry of input.demand) {
    const id = demandKeyId(entry.key);
    const agg = demandByKey.get(id);
    if (agg) {
      agg.quantity += entry.requiredQuantity;
      for (const a of entry.sourceAppointmentIds) if (!agg.appointmentIds.includes(a)) agg.appointmentIds.push(a);
    } else {
      demandByKey.set(id, { key: entry.key, quantity: entry.requiredQuantity, appointmentIds: [...entry.sourceAppointmentIds] });
    }
  }

  const rows: ShortfallRow[] = [];
  for (const [keyId, agg] of demandByKey) {
    const isConsumable = agg.key.kind === "consumable";

    // Supply terms — each nonzero only for its own key kind (per-key, same unit).
    const readySupply = agg.key.kind === "equipment" ? input.readySupplyByAssetType.get(agg.key.ref) ?? 0 : 0;

    let availableCurrentStock = 0;
    let stockSource: ShortfallSource["stock"] = null;
    if (isConsumable) {
      const s = stockByItem.get(agg.key.ref);
      if (s) {
        availableCurrentStock = Math.max(0, s.onHand - s.reserved);
        stockSource = { onHand: s.onHand, reserved: s.reserved };
      }
    }

    let consumedUnits = 0;
    let burnSource: ShortfallSource["burn"] = null;
    if (isConsumable && consumedByItem.has(agg.key.ref)) {
      consumedUnits = consumedByItem.get(agg.key.ref)!;
      burnSource = { consumedUnits, windowDays: BURN_WINDOW_DAYS };
    }
    const perHour = isConsumable ? burnRatePerHour(consumedUnits) : 0;

    // incomingStock counts ONLY arrivals within the horizon; no-ETA is excluded.
    let incomingStock = 0;
    const incomingSource: ShortfallSource["incoming"] = [];
    if (isConsumable) {
      for (const inc of incomingByItem.get(agg.key.ref) ?? []) {
        if (inc.etaMs == null || inc.etaMs > window.toMs) continue;
        const units = inc.quantity * inc.unitsPerPack; // explicit packs→units conversion
        incomingStock += units;
        incomingSource.push({ purchaseOrderId: inc.purchaseOrderId, quantityUnits: units, etaMs: inc.etaMs });
      }
    }

    const requiredThroughHorizon = Math.ceil(agg.quantity + perHour * window.horizonHours);
    const availableSupplyThroughHorizon = Math.floor(readySupply + availableCurrentStock + incomingStock);
    const shortfall = Math.max(0, requiredThroughHorizon - availableSupplyThroughHorizon);

    rows.push({
      key: agg.key,
      keyId,
      demand: agg.quantity,
      burnRatePerHour: perHour,
      requiredThroughHorizon,
      readySupply,
      availableCurrentStock,
      incomingStock,
      availableSupplyThroughHorizon,
      shortfall,
      source: {
        appointmentIds: agg.appointmentIds,
        stock: stockSource,
        burn: burnSource,
        incoming: incomingSource,
      },
    });
  }

  rows.sort((a, b) => b.shortfall - a.shortfall || (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
  return rows;
}

// ---------------------------------------------------------------------------
// Orchestrator — joins demand + supply + stock behind one reader port.
// ---------------------------------------------------------------------------

/** Full data-access port for the forecast. Every method is clinicId-scoped;
 *  the Drizzle adapter filters the target table by clinicId on every read. */
export interface ReadinessForecastReader extends ScheduleReader {
  equipmentUnits(clinicId: string): Promise<EquipmentUnitRow[]>;
  readinessRules(clinicId: string): Promise<EquipmentReadinessRulesV1>;
  consumableStock(clinicId: string, itemIds: string[]): Promise<ConsumableStockRow[]>;
  consumption(clinicId: string, fromMs: number, toMs: number, itemIds: string[]): Promise<ConsumptionRow[]>;
  incomingStock(clinicId: string, horizonEndMs: number, itemIds: string[]): Promise<IncomingStockRow[]>;
}

export interface ForecastDeps {
  reader: ReadinessForecastReader;
  demandSource: DemandSource;
  nowMs?: number;
  horizonHours?: number;
}

export interface ForecastResult {
  window: ForecastWindow;
  demand: DemandEntry[];
  shortfalls: ShortfallRow[];
}

/** Run the forecast pipeline for a single clinic. */
export async function computeReadinessForecast(deps: ForecastDeps, clinicId: string): Promise<ForecastResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const horizonHours = deps.horizonHours ?? DEFAULT_HORIZON_HOURS;
  const window: ForecastWindow = { fromMs: nowMs, toMs: nowMs + horizonHours * MS_PER_HOUR, horizonHours };

  const demand = await deps.demandSource.getDemand(clinicId, window);

  const [units, rules] = await Promise.all([deps.reader.equipmentUnits(clinicId), deps.reader.readinessRules(clinicId)]);
  const supply = computeReadySupply(units, rules, nowMs);
  const readySupplyByAssetType = new Map<string, number>();
  for (const [assetTypeId, s] of supply) readySupplyByAssetType.set(assetTypeId, s.readySupply);

  const consumableItemIds = [...new Set(demand.filter((d) => d.key.kind === "consumable").map((d) => d.key.ref))];
  const [consumableStock, consumption, incoming] = await Promise.all([
    consumableItemIds.length ? deps.reader.consumableStock(clinicId, consumableItemIds) : Promise.resolve([]),
    consumableItemIds.length ? deps.reader.consumption(clinicId, nowMs - BURN_WINDOW_DAYS * 24 * MS_PER_HOUR, nowMs, consumableItemIds) : Promise.resolve([]),
    consumableItemIds.length ? deps.reader.incomingStock(clinicId, window.toMs, consumableItemIds) : Promise.resolve([]),
  ]);

  const shortfalls = computeShortfalls(
    { demand, readySupplyByAssetType, consumableStock, consumption, incoming, window },
    nowMs,
  );

  return { window, demand, shortfalls };
}
