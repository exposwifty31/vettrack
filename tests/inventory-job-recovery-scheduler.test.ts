/**
 * Inventory job recovery — billing inventory jobs removed.
 *
 * recoverPendingInventoryJobs is a no-op stub and is NOT registered in
 * start-schedulers.ts (recovery scheduler retired with billing surface).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const schedulerSource = fs.readFileSync(
  path.join(repoRoot, "server", "app", "start-schedulers.ts"),
  "utf8",
);

const indexSource = fs.readFileSync(
  path.join(repoRoot, "server", "index.ts"),
  "utf8",
);

const recoverySource = fs.readFileSync(
  path.join(repoRoot, "server", "lib", "inventory-job-recovery.ts"),
  "utf8",
);

describe("recoverPendingInventoryJobs — no-op stub", () => {
  it("returns { enqueued: 0, skipped: 0 } without touching the database", async () => {
    const { recoverPendingInventoryJobs } = await import(
      "../server/lib/inventory-job-recovery.js"
    );
    await expect(recoverPendingInventoryJobs()).resolves.toEqual({
      enqueued: 0,
      skipped: 0,
    });
    await expect(recoverPendingInventoryJobs("clinic-a")).resolves.toEqual({
      enqueued: 0,
      skipped: 0,
    });
  });

  it("source documents billing inventory jobs removal", () => {
    expect(recoverySource).toMatch(/no-op/i);
    expect(recoverySource).toContain("enqueued: 0");
    expect(recoverySource).toContain("skipped: 0");
  });
});

describe("Inventory recovery scheduler — not wired", () => {
  it("start-schedulers.ts does not import inventory-job-recovery", () => {
    expect(schedulerSource).not.toContain("inventory-job-recovery");
    expect(schedulerSource).not.toContain("recoverPendingInventoryJobs");
    expect(schedulerSource).not.toContain("INVENTORY_RECOVERY_INTERVAL_MS");
  });

  it("index.ts does not register inline inventory recovery", () => {
    expect(indexSource).not.toContain("runInventoryRecovery");
    expect(indexSource).not.toContain("inventory-job-recovery");
  });
});
