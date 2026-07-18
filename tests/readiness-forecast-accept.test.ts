import { describe, it, expect } from "vitest";
import {
  computeReadinessForecast,
  toRedactedForecastDTO,
  ScheduleDemandSource,
  DEFAULT_HORIZON_HOURS,
  type ReadinessForecastReader,
  type ScheduledProcedureRow,
  type EquipmentUnitRow,
  type ConsumableStockRow,
  type ConsumptionRow,
  type IncomingStockRow,
  type ForecastWindow,
} from "../server/lib/readiness-forecast-engine.js";
import { DEFAULT_EQUIPMENT_READINESS_RULES_V1 } from "../shared/equipment-readiness-rules.js";

/**
 * R-PDF-1.5 — acceptance bar.
 *
 * Seeded schedule + supply + stock → the engine emits EXACTLY the expected
 * shortfalls (precision-first, correct sign), the redacted explainability DTO
 * lists source rows for each warning, a no-shortfall clinic yields the calm
 * empty state, and the two-clinic cross-tenant negative holds across demand,
 * supply, shortfall AND explainability (every read filters by clinicId).
 */

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

interface Seed {
  procedures: ScheduledProcedureRow[];
  units: EquipmentUnitRow[];
  stock: ConsumableStockRow[];
  consumption: ConsumptionRow[];
  incoming: IncomingStockRow[];
}

class InMemoryReader implements ReadinessForecastReader {
  constructor(private seed: Seed) {}
  async scheduledProcedures(clinicId: string, window: ForecastWindow): Promise<ScheduledProcedureRow[]> {
    return this.seed.procedures.filter(
      (p) =>
        p.clinicId === clinicId &&
        p.status !== "completed" &&
        p.status !== "cancelled" &&
        p.startTimeMs >= window.fromMs &&
        p.startTimeMs <= window.toMs,
    );
  }
  async equipmentUnits(clinicId: string): Promise<EquipmentUnitRow[]> {
    return this.seed.units.filter((u) => u.clinicId === clinicId);
  }
  async readinessRules() {
    return DEFAULT_EQUIPMENT_READINESS_RULES_V1;
  }
  async consumableStock(clinicId: string, itemIds: string[]): Promise<ConsumableStockRow[]> {
    return this.seed.stock.filter((s) => s.clinicId === clinicId && itemIds.includes(s.itemId));
  }
  async consumption(clinicId: string, _from: number, _to: number, itemIds: string[]): Promise<ConsumptionRow[]> {
    return this.seed.consumption.filter((c) => c.clinicId === clinicId && itemIds.includes(c.itemId));
  }
  async incomingStock(clinicId: string, _end: number, itemIds: string[]): Promise<IncomingStockRow[]> {
    return this.seed.incoming.filter((i) => i.clinicId === clinicId && itemIds.includes(i.itemId));
  }
}

function unit(o: Partial<EquipmentUnitRow> & { id: string; clinicId: string }): EquipmentUnitRow {
  return {
    assetTypeId: "asset-vent",
    readinessState: "ready",
    readinessStateSince: NOW - HOUR,
    usageState: "available",
    custodyState: "docked",
    reservedForSessionId: null,
    deletedAt: null,
    ...o,
  };
}
function proc(o: Partial<ScheduledProcedureRow> & { id: string; clinicId: string }): ScheduledProcedureRow {
  return { startTimeMs: NOW + 2 * HOUR, status: "scheduled", requiredEquipment: [], requiredConsumables: [], ...o };
}

// Two clinics with EQUIVALENT-shaped rows; clinic-b's magnitudes are much larger
// so any cross-tenant leak would visibly corrupt clinic-a's forecast.
function twoClinicSeed(): Seed {
  return {
    procedures: [
      proc({
        id: "a-appt-1",
        clinicId: "clinic-a",
        requiredEquipment: [{ assetTypeId: "asset-vent", quantity: 3 }],
        requiredConsumables: [{ itemId: "iv", quantity: 10, unit: "unit" }],
      }),
      proc({
        id: "b-appt-1",
        clinicId: "clinic-b",
        requiredEquipment: [{ assetTypeId: "asset-vent", quantity: 3 }],
        requiredConsumables: [{ itemId: "iv", quantity: 999, unit: "unit" }],
      }),
    ],
    units: [
      unit({ id: "a-u1", clinicId: "clinic-a" }), // clinic-a: 1 ready ventilator
      unit({ id: "b-u1", clinicId: "clinic-b" }),
      unit({ id: "b-u2", clinicId: "clinic-b" }),
      unit({ id: "b-u3", clinicId: "clinic-b" }),
      unit({ id: "b-u4", clinicId: "clinic-b" }),
      unit({ id: "b-u5", clinicId: "clinic-b" }), // clinic-b: 5 ready ventilators
    ],
    stock: [
      { itemId: "iv", clinicId: "clinic-a", onHand: 2, reserved: 0, unit: "unit" },
      { itemId: "iv", clinicId: "clinic-b", onHand: 500, reserved: 0, unit: "unit" },
    ],
    consumption: [
      { itemId: "iv", clinicId: "clinic-a", consumedUnits: 0 },
      { itemId: "iv", clinicId: "clinic-b", consumedUnits: 99999 },
    ],
    incoming: [],
  };
}

describe("R-PDF-1.5 · acceptance bar", () => {
  it("emits EXACTLY the expected shortfalls for the seeded clinic (precision + sign)", async () => {
    const reader = new InMemoryReader(twoClinicSeed());
    const { shortfalls, window } = await computeReadinessForecast(
      { reader, demandSource: new ScheduleDemandSource(reader), nowMs: NOW },
      "clinic-a",
    );
    expect(window.horizonHours).toBe(DEFAULT_HORIZON_HOURS);
    const byKey = new Map(shortfalls.map((r) => [r.keyId, r]));
    // equipment: demand 3 − readySupply 1 = 2 (clinic-b's 5 ventilators excluded)
    expect(byKey.get("equipment:asset-vent")?.shortfall).toBe(2);
    // consumable: demand 10 − on-hand 2 = 8 (clinic-b's 999/500/99999 excluded)
    expect(byKey.get("consumable:iv")?.shortfall).toBe(8);
    // ordered by descending shortfall (8 before 2)
    expect(shortfalls.map((r) => r.keyId)).toEqual(["consumable:iv", "equipment:asset-vent"]);
  });

  it("redacted explainability lists ONLY the requested clinic's source rows", async () => {
    const reader = new InMemoryReader(twoClinicSeed());
    const { shortfalls } = await computeReadinessForecast(
      { reader, demandSource: new ScheduleDemandSource(reader), nowMs: NOW },
      "clinic-a",
    );
    const dto = toRedactedForecastDTO("clinic-a", shortfalls, { horizonHours: 24, generatedAtMs: NOW });

    // Warnings only for real shortfalls; source appointment ids belong to clinic-a.
    const allAppointmentIds = dto.warnings.flatMap((w) => w.sourceAppointmentIds);
    expect(allAppointmentIds).toContain("a-appt-1");
    expect(allAppointmentIds).not.toContain("b-appt-1");
    // Read-only PO recommendations for the consumable shortfall only.
    expect(dto.recommendations).toEqual([
      { itemId: "iv", unit: "unit", suggestedQuantity: 8, shortfallKeyId: "consumable:iv" },
    ]);
    // DTO carries counts/ids only — never PII fields (structural redaction).
    for (const w of dto.warnings) {
      expect(Object.keys(w).sort()).toEqual(
        [
          "available",
          "burnConsumedUnits",
          "incomingPurchaseOrderIds",
          "incomingUnits",
          "keyId",
          "kind",
          "onHand",
          "ref",
          "required",
          "shortfall",
          "sourceAppointmentCount",
          "sourceAppointmentIds",
          "unit",
        ].sort(),
      );
    }
  });

  it("no-shortfall clinic yields the calm empty state (no warnings, no recommendations)", async () => {
    const seed: Seed = {
      procedures: [proc({ id: "c-1", clinicId: "clinic-c", requiredConsumables: [{ itemId: "iv", quantity: 5, unit: "unit" }] })],
      units: [],
      stock: [{ itemId: "iv", clinicId: "clinic-c", onHand: 100, reserved: 0, unit: "unit" }],
      consumption: [],
      incoming: [],
    };
    const reader = new InMemoryReader(seed);
    const { shortfalls } = await computeReadinessForecast(
      { reader, demandSource: new ScheduleDemandSource(reader), nowMs: NOW },
      "clinic-c",
    );
    const dto = toRedactedForecastDTO("clinic-c", shortfalls, { horizonHours: 24, generatedAtMs: NOW });
    expect(dto.warnings).toEqual([]);
    expect(dto.recommendations).toEqual([]);
  });

  it("cross-tenant: clinic-b's forecast is independently correct (no clinic-a leak)", async () => {
    const reader = new InMemoryReader(twoClinicSeed());
    const { shortfalls } = await computeReadinessForecast(
      { reader, demandSource: new ScheduleDemandSource(reader), nowMs: NOW },
      "clinic-b",
    );
    const byKey = new Map(shortfalls.map((r) => [r.keyId, r]));
    // clinic-b: equipment demand 3 − 5 ready = 0.
    expect(byKey.get("equipment:asset-vent")?.shortfall).toBe(0);
    // consumable: required = ceil(999 + (99999/336)*24) = ceil(8141.86) = 8142;
    // available = on-hand 500 → shortfall 7642 (burn RAISES required, sign correct).
    expect(byKey.get("consumable:iv")?.shortfall).toBe(7642);
    expect(byKey.get("consumable:iv")?.source.appointmentIds).toEqual(["b-appt-1"]);
  });
});
