import { describe, expect, it } from "vitest";
import type { Equipment } from "@/types";
import { computeAlerts } from "@/lib/utils";

function baseEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "eq-1",
    clinicId: "clinic-1",
    name: "Pump",
    nameHe: null,
    status: "ok",
    lastStatus: "ok",
    serialNumber: null,
    model: null,
    manufacturer: null,
    location: null,
    imageUrl: null,
    maintenanceIntervalDays: null,
    lastMaintenanceDate: null,
    lastSterilizationDate: null,
    lastSeen: new Date().toISOString(),
    // Staleness is derived from lastVerifiedAt (S5b), so a fixture meant to be
    // "healthy apart from the field under test" has to carry a recent
    // verification — a fresh lastSeen alone now (correctly) reads as unverified
    // and would add an unintended `inactive` alert to every row here.
    lastVerifiedAt: new Date().toISOString(),
    checkedOutById: null,
    checkedOutAt: null,
    checkedOutLocation: null,
    folderId: null,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Equipment;
}

describe("computeAlerts status source", () => {
  it("uses status=issue, not stale lastStatus", () => {
    const alerts = computeAlerts([
      baseEquipment({ status: "issue", lastStatus: "ok" }),
      baseEquipment({ id: "eq-2", status: "ok", lastStatus: "issue" }),
    ]);
    expect(alerts.filter((a) => a.type === "issue")).toHaveLength(1);
    expect(alerts[0]?.equipmentId).toBe("eq-1");
  });
});
