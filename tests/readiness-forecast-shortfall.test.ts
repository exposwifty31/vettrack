import { describe, it, expect, vi } from "vitest";
import {
  computeShortfalls,
  computeReadinessForecast,
  burnRatePerHour,
  ScheduleDemandSource,
  BURN_WINDOW_DAYS,
  DEFAULT_HORIZON_HOURS,
  type ShortfallInput,
  type DemandEntry,
  type DemandUnitConflict,
  type ConsumableStockRow,
  type ConsumptionRow,
  type IncomingStockRow,
  type ForecastWindow,
  type EquipmentUnitRow,
  type ScheduledProcedureRow,
  type ReadinessForecastReader,
} from "../server/lib/readiness-forecast-engine.js";
import { DEFAULT_EQUIPMENT_READINESS_RULES_V1 } from "../shared/equipment-readiness-rules.js";

/**
 * R-PDF-1.3 — Shortfall join + burn-rate projection.
 *
 *   required  = ceil( demand + burnRatePerHour × horizonHours )
 *   available = floor( readySupply + availableCurrentStock + incomingStock(within horizon) )
 *   shortfall = max(0, required − available)     [per demand key, in its canonical unit]
 *
 * Burn rate INCREASES required (it never reduces shortfall). Everything is
 * per-key; equipment unit-counts are never summed with consumable quantities.
 */

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;
const HORIZON = 24;
const WINDOW: ForecastWindow = { fromMs: NOW, toMs: NOW + HORIZON * HOUR, horizonHours: HORIZON };

function consumableDemand(itemId: string, qty: number, apptIds: string[]): DemandEntry {
  return { key: { kind: "consumable", ref: itemId, unit: "unit" }, requiredQuantity: qty, sourceAppointmentIds: apptIds };
}
function stock(itemId: string, onHand: number, reserved = 0): ConsumableStockRow {
  return { itemId, clinicId: "clinic-a", onHand, reserved, unit: "unit" };
}
function consumed(itemId: string, units: number): ConsumptionRow {
  return { itemId, clinicId: "clinic-a", consumedUnits: units };
}
function base(overrides: Partial<ShortfallInput>): ShortfallInput {
  return {
    demand: [],
    readySupplyByAssetType: new Map(),
    consumableStock: [],
    consumption: [],
    incoming: [],
    window: WINDOW,
    ...overrides,
  };
}

describe("R-PDF-1.3 · burnRatePerHour", () => {
  it("normalizes trailing-14-day consumption to a per-hour rate", () => {
    expect(BURN_WINDOW_DAYS).toBe(14);
    expect(DEFAULT_HORIZON_HOURS).toBe(24);
    expect(burnRatePerHour(336)).toBeCloseTo(1, 9); // 336 / (14*24) = 1 unit/hour
    expect(burnRatePerHour(0)).toBe(0);
  });
});

describe("R-PDF-1.3 · computeShortfalls", () => {
  it("a HIGHER burn rate RAISES the shortfall (sign correct)", () => {
    const demand = [consumableDemand("iv", 10, ["appt-1"])];
    const low = computeShortfalls(base({ demand, consumption: [consumed("iv", 0)] }), NOW);
    const high = computeShortfalls(base({ demand, consumption: [consumed("iv", 336)] }), NOW);
    const lowRow = low.find((r) => r.keyId === "consumable:iv")!;
    const highRow = high.find((r) => r.keyId === "consumable:iv")!;
    expect(lowRow.shortfall).toBe(10); // required = ceil(10 + 0)
    expect(highRow.shortfall).toBe(34); // required = ceil(10 + 1*24) = 34
    expect(highRow.shortfall).toBeGreaterThan(lowRow.shortfall);
  });

  it("shortfall is never negative — max(0, …)", () => {
    const rows = computeShortfalls(
      base({ demand: [consumableDemand("iv", 5, ["a"])], consumableStock: [stock("iv", 100)] }),
      NOW,
    );
    expect(rows.find((r) => r.keyId === "consumable:iv")?.shortfall).toBe(0);
  });

  it("on-hand availableCurrentStock REDUCES the shortfall (enough stock → zero)", () => {
    const demand = [consumableDemand("iv", 5, ["a"])];
    const short = computeShortfalls(base({ demand, consumableStock: [stock("iv", 0)] }), NOW);
    const covered = computeShortfalls(base({ demand, consumableStock: [stock("iv", 5)] }), NOW);
    expect(short.find((r) => r.keyId === "consumable:iv")?.shortfall).toBe(5);
    expect(covered.find((r) => r.keyId === "consumable:iv")?.shortfall).toBe(0);
  });

  it("reserved units are excluded from availableCurrentStock", () => {
    const rows = computeShortfalls(
      base({ demand: [consumableDemand("iv", 5, ["a"])], consumableStock: [stock("iv", 8, 6)] }),
      NOW,
    );
    // unreserved = 8 - 6 = 2 → shortfall 3
    expect(rows.find((r) => r.keyId === "consumable:iv")?.shortfall).toBe(3);
  });

  it("incomingStock counts ONLY arrivals within the horizon (later arrivals excluded)", () => {
    const demand = [consumableDemand("iv", 10, ["a"])];
    const incoming: IncomingStockRow[] = [
      { itemId: "iv", clinicId: "clinic-a", purchaseOrderId: "po-early", quantity: 4, unitsPerPack: 1, etaMs: NOW + 12 * HOUR },
      { itemId: "iv", clinicId: "clinic-a", purchaseOrderId: "po-late", quantity: 100, unitsPerPack: 1, etaMs: NOW + 48 * HOUR },
      { itemId: "iv", clinicId: "clinic-a", purchaseOrderId: "po-noeta", quantity: 100, unitsPerPack: 1, etaMs: null },
    ];
    const rows = computeShortfalls(base({ demand, incoming }), NOW);
    const row = rows.find((r) => r.keyId === "consumable:iv")!;
    expect(row.incomingStock).toBe(4); // only po-early; late + no-ETA excluded
    expect(row.shortfall).toBe(6);
    expect(row.source.incoming.map((i) => i.purchaseOrderId)).toEqual(["po-early"]);
  });

  it("COUNTS an overdue-but-outstanding PO (stale PAST ETA) — no spurious shortfall", () => {
    // `purchaseOrders.expectedAt` is set once at PO creation and never updated, so
    // an overdue order that is still 'ordered' (quantityOrdered 10, received 0)
    // keeps a past ETA. That stock is genuinely still incoming (never received →
    // not in on-hand). It must NOT be dropped by a lower ETA bound, or the units
    // vanish from both supply terms and a spurious shortfall + re-order is invented.
    const demand = [consumableDemand("iv", 10, ["a"])];
    const incoming: IncomingStockRow[] = [
      {
        itemId: "iv",
        clinicId: "clinic-a",
        purchaseOrderId: "po-overdue",
        quantity: 10, // quantityOrdered − quantityReceived, still outstanding
        unitsPerPack: 1,
        etaMs: NOW - 3 * 24 * HOUR, // expected 3 days ago, still not received
      },
    ];
    const rows = computeShortfalls(base({ demand, incoming }), NOW);
    const row = rows.find((r) => r.keyId === "consumable:iv")!;
    expect(row.incomingStock).toBe(10); // counted, not dropped
    expect(row.shortfall).toBe(0); // 10 required − 10 incoming = 0 (no spurious shortfall)
    expect(row.source.incoming.map((i) => i.purchaseOrderId)).toEqual(["po-overdue"]);
  });

  it("applies an explicit per-item packs→units conversion (unitsPerPack)", () => {
    const demand = [consumableDemand("iv", 10, ["a"])];
    const incoming: IncomingStockRow[] = [
      { itemId: "iv", clinicId: "clinic-a", purchaseOrderId: "po-1", quantity: 2, unitsPerPack: 3, etaMs: NOW + 6 * HOUR },
    ];
    const rows = computeShortfalls(base({ demand, incoming }), NOW);
    // 2 packs × 3 units/pack = 6 units → shortfall 4
    expect(rows.find((r) => r.keyId === "consumable:iv")?.incomingStock).toBe(6);
    expect(rows.find((r) => r.keyId === "consumable:iv")?.shortfall).toBe(4);
  });

  it("required rounds UP (ceil); available rounds DOWN (floor) — shortfall never understated", () => {
    // burn: 10 units / 336h ≈ 0.02976/h × 24h ≈ 0.714 → required = ceil(10.714) = 11
    // incoming: 3 packs × 1.5 units/pack = 4.5 → available = floor(4.5) = 4
    const demand = [consumableDemand("iv", 10, ["a"])];
    const rows = computeShortfalls(
      base({
        demand,
        consumption: [consumed("iv", 10)],
        incoming: [{ itemId: "iv", clinicId: "clinic-a", purchaseOrderId: "po-1", quantity: 3, unitsPerPack: 1.5, etaMs: NOW + HOUR }],
      }),
      NOW,
    );
    const row = rows.find((r) => r.keyId === "consumable:iv")!;
    expect(row.requiredThroughHorizon).toBe(11);
    expect(row.availableSupplyThroughHorizon).toBe(4);
    expect(row.shortfall).toBe(7);
  });

  it("computes per-key: equipment counts are NEVER summed with consumable quantities", () => {
    const demand: DemandEntry[] = [
      { key: { kind: "equipment", ref: "asset-vent", unit: "unit" }, requiredQuantity: 3, sourceAppointmentIds: ["a"] },
      consumableDemand("iv", 5, ["a"]),
    ];
    const rows = computeShortfalls(
      base({
        demand,
        readySupplyByAssetType: new Map([["asset-vent", 1]]),
        consumableStock: [stock("iv", 2)],
      }),
      NOW,
    );
    const equip = rows.find((r) => r.keyId === "equipment:asset-vent")!;
    const cons = rows.find((r) => r.keyId === "consumable:iv")!;
    expect(equip.readySupply).toBe(1);
    expect(equip.availableCurrentStock).toBe(0); // equipment has no consumable stock
    expect(equip.shortfall).toBe(2); // 3 - 1
    expect(cons.readySupply).toBe(0); // consumable has no equipment supply
    expect(cons.shortfall).toBe(3); // 5 - 2
    expect(equip.key.unit).toBe("unit");
  });

  it("orders by descending shortfall, then key id", () => {
    const demand: DemandEntry[] = [
      consumableDemand("aaa", 3, ["x"]), // shortfall 3
      consumableDemand("bbb", 9, ["x"]), // shortfall 9
      consumableDemand("ccc", 3, ["x"]), // shortfall 3 (tie with aaa → key id asc)
    ];
    const rows = computeShortfalls(base({ demand }), NOW);
    expect(rows.map((r) => r.keyId)).toEqual(["consumable:bbb", "consumable:aaa", "consumable:ccc"]);
  });

  it("does NOT offset demand with SUPPLY counted in a mismatched unit (shortfall survives)", () => {
    // Demand is in mL; the item's on-hand + incoming stock are counted in vials.
    // The two are dimensionally incompatible, so mismatched supply must NOT cancel
    // the demand — a real shortfall would otherwise be silently suppressed.
    const demand: DemandEntry[] = [
      { key: { kind: "consumable", ref: "iv", unit: "mL" }, requiredQuantity: 10, sourceAppointmentIds: ["a"] },
    ];
    const rows = computeShortfalls(
      base({
        demand,
        consumableStock: [{ itemId: "iv", clinicId: "clinic-a", onHand: 100, reserved: 0, unit: "vial" }],
        incoming: [{ itemId: "iv", clinicId: "clinic-a", purchaseOrderId: "po-1", quantity: 50, unitsPerPack: 1, etaMs: NOW + HOUR }],
      }),
      NOW,
    );
    const row = rows.find((r) => r.keyId === "consumable:iv")!;
    expect(row.availableCurrentStock).toBe(0); // mismatched-unit on-hand cannot offset
    expect(row.incomingStock).toBe(0); // mismatched-unit incoming cannot offset either
    expect(row.shortfall).toBe(10); // preserved — NOT cancelled by 100 vials + 50 incoming
  });

  it("still offsets demand when the supply unit MATCHES the demand unit (no false shortfall)", () => {
    const demand: DemandEntry[] = [
      { key: { kind: "consumable", ref: "iv", unit: "mL" }, requiredQuantity: 10, sourceAppointmentIds: ["a"] },
    ];
    const rows = computeShortfalls(
      base({ demand, consumableStock: [{ itemId: "iv", clinicId: "clinic-a", onHand: 4, reserved: 0, unit: "mL" }] }),
      NOW,
    );
    const row = rows.find((r) => r.keyId === "consumable:iv")!;
    expect(row.availableCurrentStock).toBe(4); // same unit → offsets normally
    expect(row.shortfall).toBe(6);
  });

  it("degrades a same-key unit conflict PER KEY (excludes it, forecasts every other key)", () => {
    const demand: DemandEntry[] = [
      { key: { kind: "consumable", ref: "iv", unit: "mL" }, requiredQuantity: 2, sourceAppointmentIds: ["a"] },
      { key: { kind: "consumable", ref: "iv", unit: "vial" }, requiredQuantity: 3, sourceAppointmentIds: ["b"] }, // conflict
      { key: { kind: "consumable", ref: "gauze", unit: "unit" }, requiredQuantity: 5, sourceAppointmentIds: ["c"] },
    ];
    const onUnitConflict = vi.fn<(c: DemandUnitConflict) => void>();
    const rows = computeShortfalls(base({ demand }), NOW, { onUnitConflict });

    // Conflicting key excluded; unrelated key still forecasts.
    expect(rows.find((r) => r.keyId === "consumable:iv")).toBeUndefined();
    expect(rows.find((r) => r.keyId === "consumable:gauze")?.shortfall).toBe(5);
    expect(onUnitConflict).toHaveBeenCalledTimes(1);
    expect(onUnitConflict).toHaveBeenCalledWith({ keyId: "consumable:iv", existingUnit: "mL", conflictingUnit: "vial" });
  });

  it("exposes source appointment / stock / burn rows for explainability", () => {
    const rows = computeShortfalls(
      base({
        demand: [consumableDemand("iv", 10, ["appt-7", "appt-8"])],
        consumableStock: [stock("iv", 3, 1)],
        consumption: [consumed("iv", 168)],
      }),
      NOW,
    );
    const row = rows.find((r) => r.keyId === "consumable:iv")!;
    expect(row.source.appointmentIds).toEqual(["appt-7", "appt-8"]);
    expect(row.source.stock).toEqual({ onHand: 3, reserved: 1 });
    expect(row.source.burn).toEqual({ consumedUnits: 168, windowDays: 14 });
  });
});

// ---------------------------------------------------------------------------
// Orchestrator + cross-tenant negative (join across demand + supply + stock).
// ---------------------------------------------------------------------------

class InMemoryReader implements ReadinessForecastReader {
  constructor(
    private data: {
      procedures: ScheduledProcedureRow[];
      units: EquipmentUnitRow[];
      stock: ConsumableStockRow[];
      consumption: ConsumptionRow[];
      incoming: IncomingStockRow[];
    },
  ) {}
  async scheduledProcedures(clinicId: string, window: ForecastWindow): Promise<ScheduledProcedureRow[]> {
    return this.data.procedures.filter(
      (p) => p.clinicId === clinicId && p.status !== "completed" && p.status !== "cancelled" && p.startTimeMs >= window.fromMs && p.startTimeMs <= window.toMs,
    );
  }
  async equipmentUnits(clinicId: string): Promise<EquipmentUnitRow[]> {
    return this.data.units.filter((u) => u.clinicId === clinicId);
  }
  async readinessRules() {
    return DEFAULT_EQUIPMENT_READINESS_RULES_V1;
  }
  async consumableStock(clinicId: string, itemIds: string[]): Promise<ConsumableStockRow[]> {
    return this.data.stock.filter((s) => s.clinicId === clinicId && itemIds.includes(s.itemId));
  }
  async consumption(clinicId: string, _fromMs: number, _toMs: number, itemIds: string[]): Promise<ConsumptionRow[]> {
    return this.data.consumption.filter((c) => c.clinicId === clinicId && itemIds.includes(c.itemId));
  }
  async incomingStock(clinicId: string, _horizonEndMs: number, itemIds: string[]): Promise<IncomingStockRow[]> {
    return this.data.incoming.filter((i) => i.clinicId === clinicId && itemIds.includes(i.itemId));
  }
}

describe("R-PDF-1.3 · computeReadinessForecast (join) + cross-tenant isolation", () => {
  const proc = (o: Partial<ScheduledProcedureRow> & { id: string; clinicId: string }): ScheduledProcedureRow => ({
    startTimeMs: NOW + 2 * HOUR,
    status: "scheduled",
    requiredEquipment: [],
    requiredConsumables: [],
    ...o,
  });

  it("joins schedule demand + supply + stock into ordered shortfalls", async () => {
    const reader = new InMemoryReader({
      procedures: [proc({ id: "a-1", clinicId: "clinic-a", requiredConsumables: [{ itemId: "iv", quantity: 10, unit: "unit" }] })],
      units: [],
      stock: [stock("iv", 2)],
      consumption: [consumed("iv", 0)],
      incoming: [],
    });
    const { shortfalls, window } = await computeReadinessForecast(
      { reader, demandSource: new ScheduleDemandSource(reader), nowMs: NOW },
      "clinic-a",
    );
    expect(window.horizonHours).toBe(DEFAULT_HORIZON_HOURS);
    expect(shortfalls.find((r) => r.keyId === "consumable:iv")?.shortfall).toBe(8); // 10 - 2
  });

  it("cross-tenant negative: forecast reflects ONLY the requested clinic's rows", async () => {
    const reader = new InMemoryReader({
      procedures: [
        proc({ id: "a-1", clinicId: "clinic-a", requiredConsumables: [{ itemId: "iv", quantity: 10, unit: "unit" }] }),
        proc({ id: "b-1", clinicId: "clinic-b", requiredConsumables: [{ itemId: "iv", quantity: 999, unit: "unit" }] }),
      ],
      units: [],
      stock: [stock("iv", 2), { itemId: "iv", clinicId: "clinic-b", onHand: 500, reserved: 0, unit: "unit" }],
      consumption: [consumed("iv", 0), { itemId: "iv", clinicId: "clinic-b", consumedUnits: 99999 }],
      incoming: [],
    });
    const { shortfalls } = await computeReadinessForecast(
      { reader, demandSource: new ScheduleDemandSource(reader), nowMs: NOW },
      "clinic-a",
    );
    const row = shortfalls.find((r) => r.keyId === "consumable:iv")!;
    expect(row.shortfall).toBe(8); // clinic-a demand 10 − stock 2; clinic-b's 999/500/99999 excluded
    expect(row.source.appointmentIds).toEqual(["a-1"]); // no b-1 leak
  });
});
