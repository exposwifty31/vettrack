import { describe, it, expect } from "vitest";
import { shouldBlockForShift } from "@/lib/shift-gate";

const base = { hasActiveShift: false, shiftError: false, canActOffShift: false };

describe("shouldBlockForShift", () => {
  it("never blocks a role with equipment.actOffShift", () => {
    expect(shouldBlockForShift({ ...base, canActOffShift: true })).toBe(false);
  });
  it("defers to the server on a shift-query error", () => {
    expect(shouldBlockForShift({ ...base, shiftError: true })).toBe(false);
  });
  it("blocks a gated role with no active shift", () => {
    expect(shouldBlockForShift(base)).toBe(true);
  });
  it("does not block with an active shift", () => {
    expect(shouldBlockForShift({ ...base, hasActiveShift: true })).toBe(false);
  });
});
