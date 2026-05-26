import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schedulersSrc = fs.readFileSync(
  path.join(repoRoot, "server/app/start-schedulers.ts"),
  "utf8",
);

describe("start-schedulers Phase 1b pilot wiring", () => {
  it("uses startJobRuntime instead of legacy BullMQ worker starters migrated to runtime", () => {
    expect(schedulersSrc).toContain("startJobRuntime");
    expect(schedulersSrc).not.toContain("startChargeAlertWorker");
    expect(schedulersSrc).not.toContain("startInventoryDeductionWorker");
    expect(schedulersSrc).not.toContain("startExpiryCheckWorker");
    expect(schedulersSrc).not.toContain("startStaleCheckInSweepWorker");
  });
});
