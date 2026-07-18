import { describe, it, expect } from "vitest";
import {
  extractRequirements,
  resolveQuantity,
} from "../server/services/readiness-forecast.service.js";

/**
 * R-PDF-1 service — requirement extraction from EXISTING appointment fields.
 *
 * Precision-first: an ABSENT quantity defaults to 1, but an explicitly-provided
 * INVALID quantity (0 / negative / malformed) is DROPPED rather than coerced —
 * coercing invalid input to a default would invent demand.
 */

describe("resolveQuantity — absent vs explicit-invalid", () => {
  it("uses the fallback ONLY when the value is absent (undefined/null)", () => {
    expect(resolveQuantity(undefined, 1)).toBe(1);
    expect(resolveQuantity(null, 1)).toBe(1);
  });
  it("returns null for an explicitly-provided invalid value (never coerces to the fallback)", () => {
    expect(resolveQuantity(0, 1)).toBeNull();
    expect(resolveQuantity(-3, 1)).toBeNull();
    expect(resolveQuantity(Number.NaN, 1)).toBeNull();
    expect(resolveQuantity("2", 1)).toBeNull();
    expect(resolveQuantity(Infinity, 1)).toBeNull();
  });
  it("passes a valid positive number through unchanged", () => {
    expect(resolveQuantity(5, 1)).toBe(5);
    expect(resolveQuantity(2.5, 1)).toBe(2.5);
  });
});

describe("extractRequirements — existing fields only, no invented demand", () => {
  it("returns empty requirement arrays when metadata is absent", () => {
    expect(extractRequirements({ metadata: null, inventoryItemId: null })).toEqual({
      requiredEquipment: [],
      requiredConsumables: [],
    });
  });

  it("defaults an ABSENT consumable quantity to 1", () => {
    const r = extractRequirements({
      metadata: { requiredConsumables: [{ itemId: "iv" }] },
      inventoryItemId: null,
    });
    expect(r.requiredConsumables).toEqual([{ itemId: "iv", quantity: 1, unit: undefined }]);
  });

  it("DROPS a consumable with an explicit invalid quantity (0/negative) — no demand invented", () => {
    const r = extractRequirements({
      metadata: { requiredConsumables: [{ itemId: "iv", quantity: 0 }, { itemId: "gauze", quantity: -2 }] },
      inventoryItemId: null,
    });
    expect(r.requiredConsumables).toEqual([]);
  });

  it("DROPS equipment with an explicit invalid quantity", () => {
    const r = extractRequirements({
      metadata: { requiredEquipment: [{ assetTypeId: "vent", quantity: 0 }] },
      inventoryItemId: null,
    });
    expect(r.requiredEquipment).toEqual([]);
  });

  it("does NOT let inventoryItemId resurrect an item whose explicit quantity was dropped", () => {
    const r = extractRequirements({
      metadata: { requiredConsumables: [{ itemId: "iv", quantity: 0 }] },
      inventoryItemId: "iv", // same item as the dropped one
    });
    expect(r.requiredConsumables).toEqual([]);
  });

  it("adds the inventoryItemId column item once (qty 1 when dispenseQuantity absent)", () => {
    const r = extractRequirements({ metadata: {}, inventoryItemId: "med-x" });
    expect(r.requiredConsumables).toEqual([{ itemId: "med-x", quantity: 1 }]);
  });

  it("respects an explicit valid dispenseQuantity for the inventoryItemId item", () => {
    const r = extractRequirements({ metadata: { dispenseQuantity: 4 }, inventoryItemId: "med-x" });
    expect(r.requiredConsumables).toEqual([{ itemId: "med-x", quantity: 4 }]);
  });

  it("DROPS the inventoryItemId item when its dispenseQuantity is explicitly invalid", () => {
    const r = extractRequirements({ metadata: { dispenseQuantity: -1 }, inventoryItemId: "med-x" });
    expect(r.requiredConsumables).toEqual([]);
  });
});
