/**
 * Static-analysis tests for inventory job recovery scheduler (PR 1.3).
 *
 * Billing inventory jobs were removed — recovery is a no-op and is no longer
 * registered from start-schedulers.ts.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const schedulers = read("server/app/start-schedulers.ts");
const recovery = read("server/lib/inventory-job-recovery.ts");

describe("inventory-job-recovery — scheduler wiring", () => {
  it("is not imported or scheduled from start-schedulers.ts", () => {
    expect(schedulers).not.toContain("recoverPendingInventoryJobs");
    expect(schedulers).not.toContain("inventory-job-recovery");
    expect(schedulers).not.toContain("INVENTORY_RECOVERY_INTERVAL_MS");
  });
});

describe("inventory-job-recovery — no-op contract", () => {
  it("documents billing inventory removal", () => {
    expect(recovery).toContain("no-op");
  });

  it("returns enqueued/skipped metrics without touching inventoryJobs", () => {
    expect(recovery).toContain("enqueued");
    expect(recovery).toContain("skipped");
    expect(recovery).not.toContain("inventoryJobs");
  });
});
