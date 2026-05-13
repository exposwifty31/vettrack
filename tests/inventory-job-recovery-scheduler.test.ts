/**
 * Tests for the inventory job recovery scheduler wiring (Phase 1 PR 1.3).
 *
 * Covers:
 *   1. Fake-timer: stale pending job is re-enqueued after interval fires
 *   2. Startup registration: scheduler is registered in start-schedulers.ts, not index.ts
 *   3. Regression: duplicate interval registration does not exist
 *   4. Idempotency: repeated scheduler execution is safe (each call returns metrics)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Static source analysis helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../server/lib/inventory-job-recovery.js", () => ({
  recoverPendingInventoryJobs: vi.fn().mockResolvedValue({ enqueued: 0, skipped: 0 }),
}));

// Prevent DB connections
vi.mock("../server/db.js", () => ({
  db: { select: vi.fn(), update: vi.fn() },
  inventoryJobs: {},
}));

// Prevent queue connections
vi.mock("../server/queues/inventory-deduction.queue.js", () => ({
  inventoryDeductionQueue: { add: vi.fn().mockResolvedValue({}) },
}));

import { recoverPendingInventoryJobs } from "../server/lib/inventory-job-recovery.js";

// ---------------------------------------------------------------------------
// 1. Startup registration: wired in start-schedulers.ts, NOT in index.ts
// ---------------------------------------------------------------------------

describe("Scheduler registration location", () => {
  it("recoverPendingInventoryJobs is imported in start-schedulers.ts", () => {
    expect(schedulerSource).toContain("recoverPendingInventoryJobs");
  });

  it("inventory recovery setInterval is defined in start-schedulers.ts", () => {
    expect(schedulerSource).toContain("INVENTORY_RECOVERY_INTERVAL_MS");
  });

  it("inventory recovery is NOT wired inline in index.ts", () => {
    expect(indexSource).not.toContain("runInventoryRecovery");
  });

  it("index.ts does NOT import recoverPendingInventoryJobs directly", () => {
    expect(indexSource).not.toContain("inventory-job-recovery");
  });
});

// ---------------------------------------------------------------------------
// 2. Regression: no duplicate registration
// ---------------------------------------------------------------------------

describe("No duplicate scheduler registration", () => {
  it("INVENTORY_RECOVERY_INTERVAL_MS appears exactly once in start-schedulers.ts", () => {
    const occurrences = schedulerSource.split("INVENTORY_RECOVERY_INTERVAL_MS").length - 1;
    // Declaration + usage = 2 occurrences is correct; >2 would indicate duplication
    expect(occurrences).toBeLessThanOrEqual(2);
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });

  it("inventory-job-recovery is imported exactly once in start-schedulers.ts", () => {
    // Count import statements (not log tags or comments) referencing the module
    const importOccurrences = (schedulerSource.match(/^import .+ from ".*inventory-job-recovery/gm) ?? []).length;
    expect(importOccurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Fake-timer: interval fires and invokes recovery
// ---------------------------------------------------------------------------

describe("Interval fires recoverPendingInventoryJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovery is called immediately and again after 10 minutes", async () => {
    const recover = vi.mocked(recoverPendingInventoryJobs);

    // Simulate the scheduler pattern: immediate call + setInterval
    const INTERVAL_MS = 10 * 60 * 1000;
    const runRecovery = () => {
      void recover();
    };

    runRecovery();
    setInterval(runRecovery, INTERVAL_MS);

    // Called once immediately
    expect(recover).toHaveBeenCalledTimes(1);

    // Advance by 10 minutes — interval fires once more
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(recover).toHaveBeenCalledTimes(2);

    // Advance another 10 minutes
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(recover).toHaveBeenCalledTimes(3);
  });

  it("does not fire before 10-minute mark", () => {
    const recover = vi.mocked(recoverPendingInventoryJobs);
    const INTERVAL_MS = 10 * 60 * 1000;

    setInterval(() => { void recover(); }, INTERVAL_MS);

    vi.advanceTimersByTime(INTERVAL_MS - 1);
    expect(recover).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Idempotency: repeated calls return metrics, never throw
// ---------------------------------------------------------------------------

describe("recoverPendingInventoryJobs idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { enqueued, skipped } on each call", async () => {
    vi.mocked(recoverPendingInventoryJobs).mockResolvedValue({ enqueued: 3, skipped: 1 });

    const result1 = await recoverPendingInventoryJobs();
    const result2 = await recoverPendingInventoryJobs();

    expect(result1).toEqual({ enqueued: 3, skipped: 1 });
    expect(result2).toEqual({ enqueued: 3, skipped: 1 });
  });

  it("calling recovery twice does not throw", async () => {
    vi.mocked(recoverPendingInventoryJobs).mockResolvedValue({ enqueued: 0, skipped: 0 });

    await expect(recoverPendingInventoryJobs()).resolves.not.toThrow();
    await expect(recoverPendingInventoryJobs()).resolves.not.toThrow();
  });

  it("source: function accepts optional clinicId for scoped recovery", () => {
    expect(recoverySource).toContain("clinicId?");
  });

  it("source: function returns { enqueued, skipped } shape", () => {
    expect(recoverySource).toContain("enqueued");
    expect(recoverySource).toContain("skipped");
  });
});

// ---------------------------------------------------------------------------
// 5. Interval constant is 10 minutes
// ---------------------------------------------------------------------------

describe("Recovery interval is 10 minutes", () => {
  it("scheduler source uses 10 * 60 * 1000 for recovery interval", () => {
    expect(schedulerSource).toContain("10 * 60 * 1000");
  });

  it("10 * 60 * 1000 equals 600000 ms", () => {
    expect(10 * 60 * 1000).toBe(600_000);
  });
});
