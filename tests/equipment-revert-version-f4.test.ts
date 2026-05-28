import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("F4: revert version pin", () => {
  it("F4: revert handler guards on equipment.version and returns EQUIPMENT_VERSION_CONFLICT", () => {
    const src = readFileSync(
      "server/routes/equipment/handlers/post-equipment-revert.ts",
      "utf8",
    );
    expect(src).toContain("eq(equipment.version, existingItem.version)");
    expect(src).toContain("EQUIPMENT_VERSION_CONFLICT");
    expect(src).toContain("version: sql`${equipment.version} + 1`");
  });
});
