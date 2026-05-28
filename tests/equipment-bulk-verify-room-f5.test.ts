import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("F5: bulk-verify-room version pin", () => {
  it("F5: per-row version guard and skipped response field", () => {
    const src = readFileSync(
      "server/routes/equipment/handlers/post-equipment-bulk-verify-room.ts",
      "utf8",
    );
    expect(src).toContain("eq(equipment.version, item.version)");
    expect(src).toContain("skipped");
    expect(src).toContain("res.json({ affected, skipped, roomName })");
  });
});
