import { describe, it, expect } from "vitest";
import { formatTruthLocationSummary } from "../src/lib/equipment-truth-display";

describe("formatTruthLocationSummary", () => {
  it("formats room summary", () => {
    expect(formatTruthLocationSummary("room:ICU Bay 2")).toContain("ICU Bay 2");
  });

  it("returns unknown label for unknown token", () => {
    expect(formatTruthLocationSummary("unknown")).not.toBe("unknown");
  });
});
