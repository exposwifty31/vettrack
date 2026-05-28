import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("F10: unitConditionStates clinicId filter", () => {
  it("F10: dock-return path filters unitConditionStates by clinicId", () => {
    const src = readFileSync("server/routes/equipment-operational-state.ts", "utf8");
    const dockBlock = src.slice(src.indexOf("// 1. Upsert unit condition states"));
    expect(dockBlock).toContain("eq(unitConditionStates.clinicId, clinicId)");
  });
});
