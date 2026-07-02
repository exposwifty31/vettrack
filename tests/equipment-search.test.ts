import { describe, it, expect } from "vitest";
import { matchesEquipmentQuery } from "@/features/equipment/hooks/use-equipment-search";
import type { Equipment } from "@/types";

// The matcher only reads name/nameHe/serialNumber/model/location; cast a partial.
const eq = (over: Partial<Equipment>): Equipment =>
  ({ id: "e1", name: "Infusion Pump", status: "ok", ...over }) as Equipment;

describe("matchesEquipmentQuery", () => {
  it("matches by name", () => {
    expect(matchesEquipmentQuery(eq({ name: "Infusion Pump" }), "pump")).toBe(true);
  });

  it("matches by serial number", () => {
    expect(matchesEquipmentQuery(eq({ name: "X", serialNumber: "SN-99A" }), "sn-99")).toBe(true);
  });

  it("matches by model", () => {
    expect(matchesEquipmentQuery(eq({ name: "X", model: "Alaris 8100" }), "alaris")).toBe(true);
  });

  it("matches by location", () => {
    expect(matchesEquipmentQuery(eq({ name: "X", location: "ICU Bay 3" }), "icu")).toBe(true);
  });

  it("matches by the secondary-name field", () => {
    expect(matchesEquipmentQuery(eq({ name: "X", nameHe: "alt-label-42" }), "label-42")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesEquipmentQuery(eq({ name: "Monitor", serialNumber: "AB1" }), "pump")).toBe(false);
  });

  it("returns false for an empty query", () => {
    expect(matchesEquipmentQuery(eq({ name: "Monitor" }), "")).toBe(false);
  });

  it("tolerates null/undefined optional fields", () => {
    const item = eq({ name: "Monitor", serialNumber: null, model: null, location: null, nameHe: null });
    expect(matchesEquipmentQuery(item, "mon")).toBe(true);
    expect(matchesEquipmentQuery(item, "xyz")).toBe(false);
  });
});
