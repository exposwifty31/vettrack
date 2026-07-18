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
    // Arrange
    const fallback = 1;

    // Act
    const fromUndefined = resolveQuantity(undefined, fallback);
    const fromNull = resolveQuantity(null, fallback);

    // Assert
    expect(fromUndefined).toBe(1);
    expect(fromNull).toBe(1);
  });

  it("returns null for an explicitly-provided invalid value (never coerces to the fallback)", () => {
    // Arrange
    const fallback = 1;

    // Act
    const fromZero = resolveQuantity(0, fallback);
    const fromNegative = resolveQuantity(-3, fallback);
    const fromNaN = resolveQuantity(Number.NaN, fallback);
    const fromString = resolveQuantity("2", fallback);
    const fromInfinity = resolveQuantity(Infinity, fallback);

    // Assert
    expect(fromZero).toBeNull();
    expect(fromNegative).toBeNull();
    expect(fromNaN).toBeNull();
    expect(fromString).toBeNull();
    expect(fromInfinity).toBeNull();
  });

  it("passes a valid positive number through unchanged", () => {
    // Arrange
    const fallback = 1;

    // Act
    const fromInteger = resolveQuantity(5, fallback);
    const fromDecimal = resolveQuantity(2.5, fallback);

    // Assert
    expect(fromInteger).toBe(5);
    expect(fromDecimal).toBe(2.5);
  });
});

describe("extractRequirements — existing fields only, no invented demand", () => {
  it("returns empty requirement arrays when metadata is absent", () => {
    // Arrange
    const input = { metadata: null, inventoryItemId: null };

    // Act
    const result = extractRequirements(input);

    // Assert
    expect(result).toEqual({ requiredEquipment: [], requiredConsumables: [] });
  });

  it("defaults an ABSENT consumable quantity to 1", () => {
    // Arrange
    const input = { metadata: { requiredConsumables: [{ itemId: "iv" }] }, inventoryItemId: null };

    // Act
    const result = extractRequirements(input);

    // Assert
    expect(result.requiredConsumables).toEqual([{ itemId: "iv", quantity: 1, unit: undefined }]);
  });

  it("DROPS a consumable with an explicit invalid quantity (0/negative) — no demand invented", () => {
    // Arrange
    const input = {
      metadata: { requiredConsumables: [{ itemId: "iv", quantity: 0 }, { itemId: "gauze", quantity: -2 }] },
      inventoryItemId: null,
    };

    // Act
    const result = extractRequirements(input);

    // Assert
    expect(result.requiredConsumables).toEqual([]);
  });

  it("DROPS equipment with an explicit invalid quantity", () => {
    // Arrange
    const input = { metadata: { requiredEquipment: [{ assetTypeId: "vent", quantity: 0 }] }, inventoryItemId: null };

    // Act
    const result = extractRequirements(input);

    // Assert
    expect(result.requiredEquipment).toEqual([]);
  });

  it("does NOT let inventoryItemId resurrect an item whose explicit quantity was dropped", () => {
    // Arrange
    const input = {
      metadata: { requiredConsumables: [{ itemId: "iv", quantity: 0 }] },
      inventoryItemId: "iv", // same item as the dropped one
    };

    // Act
    const result = extractRequirements(input);

    // Assert
    expect(result.requiredConsumables).toEqual([]);
  });

  it("adds the inventoryItemId column item once (qty 1 when dispenseQuantity absent)", () => {
    // Arrange
    const input = { metadata: {}, inventoryItemId: "med-x" };

    // Act
    const result = extractRequirements(input);

    // Assert
    expect(result.requiredConsumables).toEqual([{ itemId: "med-x", quantity: 1 }]);
  });

  it("respects an explicit valid dispenseQuantity for the inventoryItemId item", () => {
    // Arrange
    const input = { metadata: { dispenseQuantity: 4 }, inventoryItemId: "med-x" };

    // Act
    const result = extractRequirements(input);

    // Assert
    expect(result.requiredConsumables).toEqual([{ itemId: "med-x", quantity: 4 }]);
  });

  it("DROPS the inventoryItemId item when its dispenseQuantity is explicitly invalid", () => {
    // Arrange
    const input = { metadata: { dispenseQuantity: -1 }, inventoryItemId: "med-x" };

    // Act
    const result = extractRequirements(input);

    // Assert
    expect(result.requiredConsumables).toEqual([]);
  });
});
