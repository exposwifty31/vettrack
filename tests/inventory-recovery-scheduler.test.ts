/**
 * Inventory job recovery scheduler — retired with billing inventory jobs.
 *
 * Verifies the recovery helper is a no-op and is absent from start-schedulers.
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

describe("inventory-job-recovery — retired scheduler", () => {
  it("recoverPendingInventoryJobs is not imported in start-schedulers.ts", () => {
    expect(schedulers).not.toContain("recoverPendingInventoryJobs");
    expect(schedulers).not.toContain("inventory-job-recovery");
    expect(schedulers).not.toContain("INVENTORY_RECOVERY_INTERVAL_MS");
  });

  it("recovery module is a documented no-op stub", () => {
    expect(recovery).toMatch(/no-op/i);
    expect(recovery).toContain("export async function recoverPendingInventoryJobs");
  });
});
