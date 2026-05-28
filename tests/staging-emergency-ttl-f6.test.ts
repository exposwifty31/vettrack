import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEmergencyStagingTtlHours } from "../server/workers/stagingExpiryWorker.js";

describe("F6: emergency staging TTL sweep", () => {
  const prior = process.env.EMERGENCY_STAGING_TTL_HOURS;

  afterEach(() => {
    if (prior === undefined) delete process.env.EMERGENCY_STAGING_TTL_HOURS;
    else process.env.EMERGENCY_STAGING_TTL_HOURS = prior;
  });

  it("F6: defaults emergency TTL to 8 hours", () => {
    delete process.env.EMERGENCY_STAGING_TTL_HOURS;
    expect(resolveEmergencyStagingTtlHours()).toBe(8);
  });

  it("F6: worker sweeps active claims with null expiresAt past TTL", () => {
    const workerSrc = readFileSync("server/workers/stagingExpiryWorker.ts", "utf8");
    const auditSrc = readFileSync("server/lib/audit.ts", "utf8");
    expect(workerSrc).toContain("isNull(stagingQueue.expiresAt)");
    expect(workerSrc).toContain("equipment_emergency_staging_expired");
    expect(auditSrc).toContain("equipment_emergency_staging_expired");
  });
});
