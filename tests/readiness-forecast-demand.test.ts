import { describe, it, expect, vi } from "vitest";
import {
  ScheduleDemandSource,
  demandKeyId,
  type DemandEntry,
  type DemandSource,
  type DemandUnitConflict,
  type ForecastWindow,
  type ScheduledProcedureRow,
  type ScheduleReader,
} from "../server/lib/readiness-forecast-engine.js";

/**
 * R-PDF-1.1 — Demand model behind a single interface (inference-first).
 *
 * v1 demand is SCHEDULE-ONLY: required equipment/consumables inferred from
 * scheduled procedures (vt_appointments). Historical usage / burn rate is a
 * SEPARATE term in the shortfall equation (R-PDF-1.3) and must NEVER enter
 * schedule-only demand — so consumption is counted exactly once.
 */

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;
const WINDOW: ForecastWindow = { fromMs: NOW, toMs: NOW + 24 * HOUR, horizonHours: 24 };

/**
 * In-memory schedule reader. Holds BOTH scheduled procedures and a separate
 * "usage history" bag that the schedule demand source must never read. The
 * reader faithfully filters scheduled procedures by clinicId (multi-tenancy)
 * and by the forecast window, exactly like the Drizzle adapter.
 */
class InMemoryScheduleReader implements ScheduleReader {
  usageHistory: Array<{ clinicId: string; itemId: string; consumedUnits: number }> = [];
  constructor(private procedures: ScheduledProcedureRow[]) {}
  async scheduledProcedures(clinicId: string, window: ForecastWindow): Promise<ScheduledProcedureRow[]> {
    return this.procedures.filter(
      (p) =>
        p.clinicId === clinicId &&
        p.status !== "completed" &&
        p.status !== "cancelled" &&
        p.startTimeMs >= window.fromMs &&
        p.startTimeMs <= window.toMs,
    );
  }
}

function proc(o: Partial<ScheduledProcedureRow> & { id: string; clinicId: string }): ScheduledProcedureRow {
  return {
    startTimeMs: NOW + 2 * HOUR,
    status: "scheduled",
    requiredEquipment: [],
    requiredConsumables: [],
    ...o,
  };
}

describe("R-PDF-1.1 · ScheduleDemandSource — schedule-only demand", () => {
  it("infers demand keys + quantities from scheduled procedures", async () => {
    const reader = new InMemoryScheduleReader([
      proc({
        id: "appt-1",
        clinicId: "clinic-a",
        requiredEquipment: [{ assetTypeId: "asset-ventilator", quantity: 1 }],
        requiredConsumables: [{ itemId: "item-ivset", quantity: 2, unit: "unit" }],
      }),
      proc({
        id: "appt-2",
        clinicId: "clinic-a",
        requiredConsumables: [{ itemId: "item-ivset", quantity: 3, unit: "unit" }],
      }),
    ]);
    const source = new ScheduleDemandSource(reader);
    const demand = await source.getDemand("clinic-a", WINDOW);

    const byKey = new Map(demand.map((d) => [demandKeyId(d.key), d]));
    expect(byKey.get("equipment:asset-ventilator")?.requiredQuantity).toBe(1);
    // Aggregated across both appointments (2 + 3), source rows collected.
    const ivset = byKey.get("consumable:item-ivset");
    expect(ivset?.requiredQuantity).toBe(5);
    expect(new Set(ivset?.sourceAppointmentIds)).toEqual(new Set(["appt-1", "appt-2"]));
  });

  it("is SCHEDULE-ONLY: varying usage history NEVER changes the demand result", async () => {
    const reader = new InMemoryScheduleReader([
      proc({ id: "appt-1", clinicId: "clinic-a", requiredConsumables: [{ itemId: "item-ivset", quantity: 4, unit: "unit" }] }),
    ]);
    const source = new ScheduleDemandSource(reader);

    const before = await source.getDemand("clinic-a", WINDOW);

    // Mutate usage/consumption history dramatically between runs.
    reader.usageHistory = [
      { clinicId: "clinic-a", itemId: "item-ivset", consumedUnits: 999 },
      { clinicId: "clinic-a", itemId: "item-ivset", consumedUnits: 5000 },
    ];
    const after = await source.getDemand("clinic-a", WINDOW);

    expect(after).toEqual(before);
    // Consumption never leaks into schedule-only demand.
    expect(after.find((d) => demandKeyId(d.key) === "consumable:item-ivset")?.requiredQuantity).toBe(4);
  });

  it("excludes completed/cancelled procedures and those outside the horizon window", async () => {
    const reader = new InMemoryScheduleReader([
      proc({ id: "done", clinicId: "clinic-a", status: "completed", requiredConsumables: [{ itemId: "x", quantity: 1, unit: "unit" }] }),
      proc({ id: "cancelled", clinicId: "clinic-a", status: "cancelled", requiredConsumables: [{ itemId: "x", quantity: 1, unit: "unit" }] }),
      proc({ id: "future", clinicId: "clinic-a", startTimeMs: NOW + 72 * HOUR, requiredConsumables: [{ itemId: "x", quantity: 1, unit: "unit" }] }),
      proc({ id: "in-window", clinicId: "clinic-a", requiredConsumables: [{ itemId: "x", quantity: 7, unit: "unit" }] }),
    ]);
    const source = new ScheduleDemandSource(reader);
    const demand = await source.getDemand("clinic-a", WINDOW);
    const x = demand.find((d) => demandKeyId(d.key) === "consumable:x");
    expect(x?.requiredQuantity).toBe(7);
    expect(x?.sourceAppointmentIds).toEqual(["in-window"]);
  });

  it("interface contract: a stub template impl yields the same DemandEntry shape", async () => {
    const scheduleSource: DemandSource = new ScheduleDemandSource(
      new InMemoryScheduleReader([
        proc({ id: "appt-1", clinicId: "clinic-a", requiredConsumables: [{ itemId: "item-ivset", quantity: 2, unit: "unit" }] }),
      ]),
    );

    // A future template-backed impl of the SAME interface (R-PDF-1.1 seam).
    const templateSource: DemandSource = {
      async getDemand(): Promise<DemandEntry[]> {
        return [
          { key: { kind: "consumable", ref: "item-ivset", unit: "unit" }, requiredQuantity: 2, sourceAppointmentIds: ["tmpl-1"] },
        ];
      },
    };

    const a = await scheduleSource.getDemand("clinic-a", WINDOW);
    const b = await templateSource.getDemand("clinic-a", WINDOW);
    const shapeKeys = (e: DemandEntry) => Object.keys(e).sort();
    expect(shapeKeys(a[0])).toEqual(shapeKeys(b[0]));
    expect(Object.keys(a[0].key).sort()).toEqual(Object.keys(b[0].key).sort());
  });

  it("degrades a unit conflict PER KEY: excludes the conflicting key, keeps every other key", async () => {
    const reader = new InMemoryScheduleReader([
      // iv-set has a same-key/different-unit conflict (mL then vial) → excluded.
      proc({ id: "appt-1", clinicId: "clinic-a", requiredConsumables: [{ itemId: "iv-set", quantity: 2, unit: "mL" }] }),
      proc({ id: "appt-2", clinicId: "clinic-a", requiredConsumables: [{ itemId: "iv-set", quantity: 3, unit: "vial" }] }),
      // gauze is unrelated and must still forecast normally.
      proc({ id: "appt-3", clinicId: "clinic-a", requiredConsumables: [{ itemId: "gauze", quantity: 4, unit: "unit" }] }),
    ]);
    const onUnitConflict = vi.fn<(c: DemandUnitConflict) => void>();
    const source = new ScheduleDemandSource(reader, { onUnitConflict });

    const demand = await source.getDemand("clinic-a", WINDOW);
    const keyIds = demand.map((d) => demandKeyId(d.key));

    // Conflicting key dropped; unrelated key preserved (whole clinic NOT denied).
    expect(keyIds).not.toContain("consumable:iv-set");
    expect(demand.find((d) => demandKeyId(d.key) === "consumable:gauze")?.requiredQuantity).toBe(4);

    // Surfaced exactly once via the degradation hook, with both units.
    expect(onUnitConflict).toHaveBeenCalledTimes(1);
    expect(onUnitConflict).toHaveBeenCalledWith({ keyId: "consumable:iv-set", existingUnit: "mL", conflictingUnit: "vial" });
  });

  it("degrades silently (no throw) when no conflict hook is provided", async () => {
    const reader = new InMemoryScheduleReader([
      proc({ id: "appt-1", clinicId: "clinic-a", requiredConsumables: [{ itemId: "iv-set", quantity: 2, unit: "mL" }] }),
      proc({ id: "appt-2", clinicId: "clinic-a", requiredConsumables: [{ itemId: "iv-set", quantity: 3, unit: "vial" }] }),
      proc({ id: "appt-3", clinicId: "clinic-a", requiredConsumables: [{ itemId: "gauze", quantity: 4, unit: "unit" }] }),
    ]);
    const demand = await new ScheduleDemandSource(reader).getDemand("clinic-a", WINDOW);
    expect(demand.map((d) => demandKeyId(d.key))).toEqual(["consumable:gauze"]);
  });

  it("cross-tenant negative: demand includes ONLY the requested clinic's appointment rows", async () => {
    const reader = new InMemoryScheduleReader([
      proc({ id: "a-1", clinicId: "clinic-a", requiredConsumables: [{ itemId: "shared-item", quantity: 2, unit: "unit" }] }),
      proc({ id: "b-1", clinicId: "clinic-b", requiredConsumables: [{ itemId: "shared-item", quantity: 99, unit: "unit" }] }),
    ]);
    const source = new ScheduleDemandSource(reader);

    const demandA = await source.getDemand("clinic-a", WINDOW);
    const itemA = demandA.find((d) => demandKeyId(d.key) === "consumable:shared-item");
    expect(itemA?.requiredQuantity).toBe(2); // NOT 2 + 99
    expect(itemA?.sourceAppointmentIds).toEqual(["a-1"]);
    // No clinic-b row leaks in.
    expect(demandA.flatMap((d) => d.sourceAppointmentIds)).not.toContain("b-1");
  });
});
