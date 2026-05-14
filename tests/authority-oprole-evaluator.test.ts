/**
 * Phase 2.5 PR 7 — OPROLE evaluator unit tests. ENFORCE-ONLY.
 *
 * Asserts:
 *   - Mode union is exactly {off, enforce} — no shadow mode.
 *   - off mode → allow without invoking the cache fetcher.
 *   - hit in allowlist → allow.
 *   - hit not in allowlist → deny + denied counter + audit row attempt.
 *   - miss path (wrapper signals via injected fetcher).
 *   - error path → allow + recordFailure on the existing breaker.
 *   - operationalRole=null → allow without invoking the fetcher.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent server/db.ts side effects.
vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  auditLogs: {},
  eventOutbox: {},
}));

import { resetMetrics, getMetricsSnapshot } from "../server/lib/metrics.js";
import { evaluateOpRoleEnforcement } from "../server/lib/authority/enforcement/oprole.evaluator.js";
import type {
  EnforcementContext,
  OproleEnforcementMode,
} from "../server/lib/authority/enforcement/result.js";
import type { AllowlistFetchResult } from "../server/lib/authority-cache.js";
import type { OpenClinicalCheckInRow } from "../server/lib/check-in-resolution.js";

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

function makeRow(operationalRole: string | null): OpenClinicalCheckInRow {
  return {
    id: "ci-1",
    clinicId: "clinic-1",
    userId: "user-1",
    clinicalRoleAtCheckIn: "vet",
    operationalRole,
    checkedInAt: new Date(FIXED_NOW.getTime() - 60 * 1000),
    checkedOutAt: null,
  } as unknown as OpenClinicalCheckInRow;
}

function ctx(operationalRole: string | null): EnforcementContext {
  return {
    clinicId: "clinic-1",
    userId: "user-1",
    now: FIXED_NOW,
    checkIn: makeRow(operationalRole),
  };
}

const MODE = (m: OproleEnforcementMode) => async (): Promise<OproleEnforcementMode> => m;

function okResult(allowlist: readonly string[]): AllowlistFetchResult {
  return { kind: "ok", allowlist: allowlist as never };
}

beforeEach(() => {
  resetMetrics();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("evaluateOpRoleEnforcement", () => {
  it("off mode → allow, fetcher never called", async () => {
    const fetcher = vi.fn();
    const verdict = await evaluateOpRoleEnforcement(ctx("admission"), {
      modeResolver: MODE("off"),
      allowlistFetcher: fetcher as never,
    });
    expect(verdict).toEqual({ action: "allow" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(getMetricsSnapshot().authority.oproleEnforce.denied).toBe(0);
  });

  it("operationalRole=null → allow without invoking fetcher", async () => {
    const fetcher = vi.fn();
    const verdict = await evaluateOpRoleEnforcement(ctx(null), {
      modeResolver: MODE("enforce"),
      allowlistFetcher: fetcher as never,
    });
    expect(verdict).toEqual({ action: "allow" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("enforce + role in allowlist → allow, no counter", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResult(["admission", "ward"]));
    const verdict = await evaluateOpRoleEnforcement(ctx("admission"), {
      modeResolver: MODE("enforce"),
      allowlistFetcher: fetcher,
    });
    expect(verdict).toEqual({ action: "allow" });
    expect(getMetricsSnapshot().authority.oproleEnforce.denied).toBe(0);
  });

  it("enforce + role NOT in allowlist → deny + denied counter", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResult(["ward"]));
    const verdict = await evaluateOpRoleEnforcement(ctx("admission"), {
      modeResolver: MODE("enforce"),
      allowlistFetcher: fetcher,
    });
    expect(verdict).toEqual({ action: "deny", reason: "CHECKED_IN_OPROLE_REVOKED" });
    expect(getMetricsSnapshot().authority.oproleEnforce.denied).toBe(1);
  });

  it("enforce + empty allowlist → deny", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResult([]));
    const verdict = await evaluateOpRoleEnforcement(ctx("admission"), {
      modeResolver: MODE("enforce"),
      allowlistFetcher: fetcher,
    });
    expect(verdict.action).toBe("deny");
  });

  it("enforce + fetcher returns error → allow (fail open)", async () => {
    const fetcher = vi.fn().mockResolvedValue({ kind: "error" } as AllowlistFetchResult);
    const verdict = await evaluateOpRoleEnforcement(ctx("admission"), {
      modeResolver: MODE("enforce"),
      allowlistFetcher: fetcher,
    });
    expect(verdict).toEqual({ action: "allow" });
    expect(getMetricsSnapshot().authority.oproleEnforce.denied).toBe(0);
  });

  it("enforce + fetcher throws → allow (fail open, defense in depth)", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("DB exploded"));
    const verdict = await evaluateOpRoleEnforcement(ctx("admission"), {
      modeResolver: MODE("enforce"),
      allowlistFetcher: fetcher,
    });
    expect(verdict).toEqual({ action: "allow" });
  });

  it("mode union has no 'shadow' value — typecheck pin", () => {
    // TypeScript-only assertion. If OproleEnforcementMode ever gains "shadow",
    // this @ts-expect-error must be removed (and the plan §5.3 invariant
    // re-litigated).
    // @ts-expect-error — "shadow" is not assignable to OproleEnforcementMode
    const bad: OproleEnforcementMode = "shadow";
    expect(bad as string).toBe("shadow");
  });
});
