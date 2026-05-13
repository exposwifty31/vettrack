/**
 * Static-analysis tests for inventory job recovery scheduler isolation (PR 1.3).
 *
 * Verifies that the recovery scheduler registration is isolated in its own
 * try/catch block so a failure during registration does not crash the server
 * or prevent other schedulers from starting.
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

// ─────────────────────────────────────────────────────────────────────────────
// Import verification
// ─────────────────────────────────────────────────────────────────────────────

describe("inventory-job-recovery — import", () => {
  it("recoverPendingInventoryJobs is imported", () => {
    expect(schedulers).toContain("recoverPendingInventoryJobs");
    expect(schedulers).toContain("inventory-job-recovery");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("inventory-job-recovery — isolation", () => {
  it("recovery scheduler is wrapped in an isolated try/catch", () => {
    // The recovery block starts after the import line; find the function call site
    const fnBodyStart = schedulers.indexOf("startBackgroundSchedulers");
    const firstCallIdx = schedulers.indexOf("recoverPendingInventoryJobs()", fnBodyStart);
    expect(firstCallIdx).toBeGreaterThan(-1);
    // There must be a try block before the call
    const tryBeforeRecovery = schedulers.lastIndexOf("try", firstCallIdx);
    expect(tryBeforeRecovery).toBeGreaterThan(-1);
    // There must be a catch after the try
    const catchAfterTry = schedulers.indexOf("catch (err)", tryBeforeRecovery);
    expect(catchAfterTry).toBeGreaterThan(tryBeforeRecovery);
    // The catch must contain an error log about scheduler registration failure
    const catchBlock = schedulers.slice(catchAfterTry, catchAfterTry + 300);
    expect(catchBlock).toContain("scheduler registration failed");
  });

  it("startup recovery call logs on success with enqueued/skipped", () => {
    expect(schedulers).toContain("enqueued");
    expect(schedulers).toContain("skipped");
    expect(schedulers).toContain("startup recovery complete");
  });

  it("interval recovery catches errors independently", () => {
    expect(schedulers).toContain("interval recovery failed");
  });

  it("scheduler registration success is logged", () => {
    expect(schedulers).toContain("scheduler registered");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Interval setup
// ─────────────────────────────────────────────────────────────────────────────

describe("inventory-job-recovery — interval", () => {
  it("uses setInterval for periodic recovery", () => {
    const recoveryBlock = schedulers.slice(schedulers.indexOf("recoverPendingInventoryJobs"));
    expect(recoveryBlock).toContain("setInterval");
  });

  it("uses a named interval constant", () => {
    expect(schedulers).toContain("INVENTORY_RECOVERY_INTERVAL_MS");
  });
});
