/**
 * Phase 2.5 PR 5.3 — operationalRole shadow re-validation tests.
 *
 * Pure unit tests. No DB, no HTTP. The allowlist reader and the runner are
 * both stubbed via the module's __set*ForTests hooks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent server/db.ts from being touched by the import chain.
vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
}));

import { resetMetrics, getMetricsSnapshot } from "../server/lib/metrics.js";
import {
  __resetLimitersForTests,
  __resetTokenBucketForTests,
  __setAllowlistReaderForTests,
  __setRunnerOverrideForTests,
  __setTokenBucketCeilingForTests,
  scheduleOperationalRoleShadowValidation,
  type OperationalRoleShadowArgs,
} from "../server/lib/operational-role-shadow.js";

const BASE_ARGS: OperationalRoleShadowArgs = {
  clinicId: "clinic-1",
  userId: "user-1",
  observedOperationalRole: "admission",
  checkInId: "ci-1",
  resolvedAt: "2026-05-14T12:00:00.000Z",
};

function uniqueArgs(suffix: string): OperationalRoleShadowArgs {
  return {
    ...BASE_ARGS,
    clinicId: `clinic-${suffix}`,
    userId: `user-${suffix}`,
    checkInId: `ci-${suffix}`,
  };
}

async function flushMicrotasks(): Promise<void> {
  // Yield twice: once for the runner's first `await`, once for any chained
  // .catch() to settle.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  resetMetrics();
  __resetLimitersForTests();
  __resetTokenBucketForTests();
  __setTokenBucketCeilingForTests(200);
  __setAllowlistReaderForTests(null);
  __setRunnerOverrideForTests(null);
  process.env.AUTHORITY_OPROLE_SHADOW = "true";
});

afterEach(() => {
  delete process.env.AUTHORITY_OPROLE_SHADOW;
  __setAllowlistReaderForTests(null);
  __setRunnerOverrideForTests(null);
});

function snap() {
  return getMetricsSnapshot().authority.oproleShadow;
}

describe("scheduleOperationalRoleShadowValidation", () => {
  it("returns synchronously even when the runner is slow", async () => {
    const slowRunner = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
    );
    __setRunnerOverrideForTests(slowRunner);

    const start = Date.now();
    const result = scheduleOperationalRoleShadowValidation(uniqueArgs("sync"));
    const elapsed = Date.now() - start;

    expect(result).toBeUndefined();
    expect(elapsed).toBeLessThan(50);
  });

  it("is a no-op with the flag unset (no reader call, no counters)", async () => {
    delete process.env.AUTHORITY_OPROLE_SHADOW;
    const reader = vi.fn().mockResolvedValue(["admission"]);
    const runner = vi.fn().mockResolvedValue(undefined);
    __setAllowlistReaderForTests(reader);
    __setRunnerOverrideForTests(runner);

    for (let i = 0; i < 10; i++) {
      scheduleOperationalRoleShadowValidation(uniqueArgs(`flag-off-${i}`));
    }
    await flushMicrotasks();

    expect(reader).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
    const s = snap();
    expect(s.scheduled).toBe(0);
    expect(s.deduped).toBe(0);
    expect(s.throttled).toBe(0);
    expect(s.ran).toBe(0);
  });

  it("does not allocate a runner Promise when guard 2 (null operationalRole) fails", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    __setRunnerOverrideForTests(runner);

    scheduleOperationalRoleShadowValidation({
      ...uniqueArgs("g2"),
      observedOperationalRole: null,
    });
    await flushMicrotasks();

    expect(runner).not.toHaveBeenCalled();
    expect(snap().scheduled).toBe(0);
  });

  it("does not allocate a runner Promise when guard 3 (dedupe) suppresses", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    __setRunnerOverrideForTests(runner);

    const args = uniqueArgs("g3");
    // First call passes guard 3 and dispatches the runner.
    scheduleOperationalRoleShadowValidation(args);
    // Second call (same tuple) is deduped.
    scheduleOperationalRoleShadowValidation(args);
    await flushMicrotasks();

    expect(runner).toHaveBeenCalledTimes(1);
    expect(snap().scheduled).toBe(1);
    expect(snap().deduped).toBe(1);
  });

  it("does not allocate a runner Promise when guard 4 (token bucket) suppresses", async () => {
    __setTokenBucketCeilingForTests(0);
    const runner = vi.fn().mockResolvedValue(undefined);
    __setRunnerOverrideForTests(runner);

    scheduleOperationalRoleShadowValidation(uniqueArgs("g4"));
    await flushMicrotasks();

    expect(runner).not.toHaveBeenCalled();
    expect(snap().throttled).toBe(1);
    expect(snap().scheduled).toBe(0);
  });

  it("dedupe absorbs bursts: 100 same-tuple calls -> 1 scheduled, 99 deduped", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    __setRunnerOverrideForTests(runner);

    const args = uniqueArgs("burst");
    for (let i = 0; i < 100; i++) {
      scheduleOperationalRoleShadowValidation(args);
    }
    await flushMicrotasks();

    const s = snap();
    expect(s.scheduled).toBe(1);
    expect(s.deduped).toBe(99);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("distinct tuples are independent: 10 keys -> 10 scheduled, 0 deduped", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    __setRunnerOverrideForTests(runner);

    for (let i = 0; i < 10; i++) {
      scheduleOperationalRoleShadowValidation(uniqueArgs(`distinct-${i}`));
    }
    await flushMicrotasks();

    const s = snap();
    expect(s.scheduled).toBe(10);
    expect(s.deduped).toBe(0);
    expect(runner).toHaveBeenCalledTimes(10);
  });

  it("token bucket throttles distinct tuples beyond the ceiling", async () => {
    __setTokenBucketCeilingForTests(5);
    const runner = vi.fn().mockResolvedValue(undefined);
    __setRunnerOverrideForTests(runner);

    for (let i = 0; i < 10; i++) {
      scheduleOperationalRoleShadowValidation(uniqueArgs(`bucket-${i}`));
    }
    await flushMicrotasks();

    const s = snap();
    expect(s.scheduled).toBe(5);
    expect(s.throttled).toBe(5);
    expect(runner).toHaveBeenCalledTimes(5);
  });

  it("match: reader contains observed role -> _match increments, no warn", async () => {
    __setAllowlistReaderForTests(async () => ["admission", "ward"]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    scheduleOperationalRoleShadowValidation(uniqueArgs("match"));
    await flushMicrotasks();

    const s = snap();
    expect(s.ran).toBe(1);
    expect(s.match).toBe(1);
    expect(s.driftRevoked).toBe(0);
    expect(s.userMissing).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("drift (populated allowlist excluding observed): _drift_revoked + one warn", async () => {
    __setAllowlistReaderForTests(async () => ["ward"]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    scheduleOperationalRoleShadowValidation(uniqueArgs("drift-populated"));
    await flushMicrotasks();

    const s = snap();
    expect(s.ran).toBe(1);
    expect(s.driftRevoked).toBe(1);
    expect(s.match).toBe(0);
    expect(s.userMissing).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe("[oprole-shadow]");
    warnSpy.mockRestore();
  });

  it("drift (empty allowlist []): _drift_revoked, NOT _user_missing", async () => {
    __setAllowlistReaderForTests(async () => []);

    scheduleOperationalRoleShadowValidation(uniqueArgs("drift-empty"));
    await flushMicrotasks();

    const s = snap();
    expect(s.ran).toBe(1);
    expect(s.driftRevoked).toBe(1);
    expect(s.userMissing).toBe(0);
    expect(s.match).toBe(0);
  });

  it("user-missing (reader returns null): _user_missing, NOT _drift_revoked", async () => {
    __setAllowlistReaderForTests(async () => null);

    scheduleOperationalRoleShadowValidation(uniqueArgs("missing"));
    await flushMicrotasks();

    const s = snap();
    expect(s.ran).toBe(1);
    expect(s.userMissing).toBe(1);
    expect(s.driftRevoked).toBe(0);
    expect(s.match).toBe(0);
  });

  it("runner failure (reader throws): _runner_failed, no rejection escapes", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    __setAllowlistReaderForTests(async () => {
      throw new Error("simulated reader failure");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    scheduleOperationalRoleShadowValidation(uniqueArgs("err"));
    await flushMicrotasks();
    // Yield once more for the .catch handler.
    await flushMicrotasks();

    const s = snap();
    expect(s.runnerFailed).toBe(1);
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
    warnSpy.mockRestore();
  });

  it("scheduler never throws to its caller under any of the above paths", () => {
    __setAllowlistReaderForTests(async () => {
      throw new Error("boom");
    });
    expect(() =>
      scheduleOperationalRoleShadowValidation(uniqueArgs("nothrow")),
    ).not.toThrow();
  });

  it("regression: throttled call does not burn its dedupe slot (PR #305 review)", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    __setRunnerOverrideForTests(runner);

    const args = uniqueArgs("burn-slot");

    // Bucket exhausted: this call must be throttled, NOT deduped, and must
    // not record the dedupe key.
    __setTokenBucketCeilingForTests(0);
    scheduleOperationalRoleShadowValidation(args);
    await flushMicrotasks();

    let s = snap();
    expect(s.throttled).toBe(1);
    expect(s.deduped).toBe(0);
    expect(s.scheduled).toBe(0);
    expect(runner).not.toHaveBeenCalled();

    // Bucket recovers: the same tuple must now go through, NOT be deduped
    // (because the previous throttled call did not burn the dedupe slot).
    __setTokenBucketCeilingForTests(200);
    __resetTokenBucketForTests();
    scheduleOperationalRoleShadowValidation(args);
    await flushMicrotasks();

    s = snap();
    expect(s.scheduled).toBe(1);
    expect(s.throttled).toBe(1);
    expect(s.deduped).toBe(0);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("guard 1 short-circuits before guard 3 (dedupe map untouched)", async () => {
    delete process.env.AUTHORITY_OPROLE_SHADOW;
    const runner = vi.fn().mockResolvedValue(undefined);
    __setRunnerOverrideForTests(runner);

    // 500 distinct calls; if guard 1 didn't short-circuit, guard 3 would
    // hit its maxEntries=500 LRU cap and we'd start losing track. Instead,
    // assert no counter movement at all.
    for (let i = 0; i < 500; i++) {
      scheduleOperationalRoleShadowValidation(uniqueArgs(`flag-off-bulk-${i}`));
    }
    await flushMicrotasks();

    const s = snap();
    expect(s.scheduled).toBe(0);
    expect(s.deduped).toBe(0);
    expect(s.throttled).toBe(0);
    expect(s.ran).toBe(0);
    expect(runner).not.toHaveBeenCalled();
  });
});
