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

  it("F4: consumes undo token inside the revert transaction so version conflicts can retry", () => {
    const revertSrc = readFileSync(
      "server/routes/equipment/handlers/post-equipment-revert.ts",
      "utf8",
    );
    const tokenSrc = readFileSync("server/routes/equipment/equipment-undo-tokens.ts", "utf8");

    expect(revertSrc).toMatch(
      /db\.transaction\(async \(tx\) => \{[\s\S]*consumeUndoToken\([^)]+,\s*tx\)/,
    );
    expect(revertSrc).not.toMatch(
      /consumeUndoToken\([\s\S]*?\);\s*await db\.transaction/,
    );
    expect(tokenSrc).toContain("executor: DbExecutor = db");
  });
});
