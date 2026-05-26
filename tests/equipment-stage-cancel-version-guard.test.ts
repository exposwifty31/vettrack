/**
 * Staging claim cancel must not leave equipment staged with zero active claims.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("server/routes/equipment-operational-state.ts", "utf8");

describe("equipment stage cancel — version guard", () => {
  it("rolls back when staged→available revert loses optimistic version race", () => {
    const cancelStart = routeSource.indexOf(
      'router.delete("/equipment/:equipmentId/stage/:claimId"',
    );
    const cancelEnd = routeSource.indexOf("void promoteStagingQueueNext", cancelStart);
    const cancelBody = routeSource.slice(cancelStart, cancelEnd);

    expect(cancelBody).toContain("revertResult");
    expect(cancelBody).toMatch(/pgUpdateMatchedZeroRows\(revertResult\)/);
    expect(cancelBody).toContain('throw new Error("VERSION_CONFLICT")');
    expect(cancelBody).toMatch(
      /VERSION_CONFLICT[\s\S]*operationalState\.versionConflict/,
    );
  });
});
