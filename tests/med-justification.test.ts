/**
 * Medication dose-deviation justification validation (med-justification.ts).
 * Guards weak/spam justifications before persisting deviated medication tasks.
 */
import { describe, expect, it } from "vitest";
import {
  MedJustificationError,
  resolvePresetLabel,
  validateJustificationText,
} from "../server/lib/med-justification.js";

describe("validateJustificationText", () => {
  it("accepts meaningful text at required tier (≥10 chars)", () => {
    const normalized = validateJustificationText(
      "  Patient non-responsive to standard dose per vet  ",
      "required",
    );
    expect(normalized).toBe("Patient non-responsive to standard dose per vet");
  });

  it("throws JUSTIFICATION_TOO_SHORT when below required minimum", () => {
    expect(() => validateJustificationText("Too short", "required")).toThrow(MedJustificationError);
    try {
      validateJustificationText("Too short", "required");
    } catch (err) {
      expect(err).toBeInstanceOf(MedJustificationError);
      expect((err as MedJustificationError).code).toBe("JUSTIFICATION_TOO_SHORT");
    }
  });

  it("throws JUSTIFICATION_SPAM for repeated character runs", () => {
    expect(() => validateJustificationText("aaaaaaaaaa", "required")).toThrow(MedJustificationError);
    try {
      validateJustificationText("aaaaaaaaaa", "required");
    } catch (err) {
      expect((err as MedJustificationError).code).toBe("JUSTIFICATION_SPAM");
    }
  });

  it("throws JUSTIFICATION_SPAM when letter ratio is too low", () => {
    expect(() => validateJustificationText("12345678901", "required")).toThrow(MedJustificationError);
    try {
      validateJustificationText("12345678901", "required");
    } catch (err) {
      expect((err as MedJustificationError).code).toBe("JUSTIFICATION_SPAM");
    }
  });

  it("allows empty text at none tier", () => {
    expect(validateJustificationText("", "none")).toBe("");
  });
});

describe("resolvePresetLabel", () => {
  it("returns label for a known preset code", () => {
    expect(resolvePresetLabel("NON_RESPONSIVE_STANDARD_DOSE")).toBe("Non-responsive to standard dose");
  });

  it("throws JUSTIFICATION_INVALID_PRESET for unknown code", () => {
    expect(() => resolvePresetLabel("NOT_A_REAL_PRESET")).toThrow(MedJustificationError);
    try {
      resolvePresetLabel("NOT_A_REAL_PRESET");
    } catch (err) {
      expect((err as MedJustificationError).code).toBe("JUSTIFICATION_INVALID_PRESET");
    }
  });
});
