/**
 * Phase 4 PR 4.1 — Code Blue manager evaluator unit tests.
 *
 * Pure-function tests over (mode, context). No DB. No cache. Mode resolver
 * is injected via options; production env vars are not touched.
 *
 * Covers the full verdict matrix from master plan §23.6 plus the Strategy A
 * precondition invariant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent side effects from importing db.ts via the audit chain.
vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  auditLogs: {},
  eventOutbox: {},
}));

import {
  computeCodeBlueManagerSnapshotDeny,
  evaluateCodeBlueManagerAuthority,
} from "../server/lib/authority/enforcement/code-blue-manager.evaluator.js";
import {
  getMetricsSnapshot,
  resetMetrics,
} from "../server/lib/metrics.js";
import type {
  CodeBlueManagerContext,
  CodeBlueManagerEnforcementMode,
  CodeBlueManagerLookup,
} from "../server/lib/authority/enforcement/code-blue-manager.types.js";
import type { AuthoritySnapshot } from "../shared/authority.js";

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");

function snapshot(overrides: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot {
  return {
    systemRole: "User",
    clinicalRole: "vet",
    activeShiftRole: "vet",
    operationalRole: "senior_lead",
    effectiveClinicalRole: "vet",
    source: "check_in",
    reason: "CHECKED_IN",
    resolvedAt: FIXED_NOW.toISOString(),
    ...overrides,
  };
}

function baseContext(
  overrides: Partial<CodeBlueManagerContext> = {},
): CodeBlueManagerContext {
  return {
    clinicId: "clinic-1",
    now: FIXED_NOW,
    endpoint: "end",
    managerUserId: "manager-1",
    lookup: { kind: "snapshot", snapshot: snapshot() },
    ...overrides,
  };
}

function modeResolver(mode: CodeBlueManagerEnforcementMode) {
  return async () => mode;
}

beforeEach(() => {
  resetMetrics();
  delete process.env.AUTHORITY_OBS_V1;
});

afterEach(() => {
  resetMetrics();
  delete process.env.AUTHORITY_OBS_V1;
});

// ─────────────────────────────────────────────────────────────────────────────
// computeCodeBlueManagerSnapshotDeny — pure helper

describe("computeCodeBlueManagerSnapshotDeny — eligible managers", () => {
  it("senior_lead → allow", () => {
    expect(
      computeCodeBlueManagerSnapshotDeny(snapshot({ operationalRole: "senior_lead" })),
    ).toEqual({ kind: "allow" });
  });

  it("admission → allow", () => {
    expect(
      computeCodeBlueManagerSnapshotDeny(snapshot({ operationalRole: "admission" })),
    ).toEqual({ kind: "allow" });
  });

  it("ward → allow", () => {
    expect(
      computeCodeBlueManagerSnapshotDeny(snapshot({ operationalRole: "ward" })),
    ).toEqual({ kind: "allow" });
  });

  it("night_senior_no_admission → allow", () => {
    expect(
      computeCodeBlueManagerSnapshotDeny(
        snapshot({ operationalRole: "night_senior_no_admission" }),
      ),
    ).toEqual({ kind: "allow" });
  });
});

describe("computeCodeBlueManagerSnapshotDeny — ineligible operational roles", () => {
  it("night_admission_only → deny OPROLE_NOT_IN_CB_ALLOWLIST (DECISION-1 exclusion)", () => {
    expect(
      computeCodeBlueManagerSnapshotDeny(
        snapshot({ operationalRole: "night_admission_only" }),
      ),
    ).toEqual({ kind: "deny", reason: "OPROLE_NOT_IN_CB_ALLOWLIST" });
  });
});

describe("computeCodeBlueManagerSnapshotDeny — Strategy A precondition", () => {
  it("operationalRole=null + EZSHIFT_ACTIVE → mode_inactive", () => {
    expect(
      computeCodeBlueManagerSnapshotDeny(
        snapshot({ operationalRole: null, reason: "EZSHIFT_ACTIVE" }),
      ),
    ).toEqual({ kind: "mode_inactive" });
  });

  it("operationalRole=null + EZSHIFT_NONE → mode_inactive", () => {
    expect(
      computeCodeBlueManagerSnapshotDeny(
        snapshot({ operationalRole: null, reason: "EZSHIFT_NONE" }),
      ),
    ).toEqual({ kind: "mode_inactive" });
  });

  it("operationalRole=null + NOT_CHECKED_IN → mode_inactive", () => {
    expect(
      computeCodeBlueManagerSnapshotDeny(
        snapshot({ operationalRole: null, reason: "NOT_CHECKED_IN" }),
      ),
    ).toEqual({ kind: "mode_inactive" });
  });

  it("operationalRole=null + CHECKED_IN_NO_OPROLE → deny NO_OPEN_CHECK_IN (NOT Strategy A — user IS checked in)", () => {
    // CHECKED_IN_NO_OPROLE means the check-in path IS active and the user IS
    // checked in, but without an operational role — this is a real "manager
    // not eligible" signal, not a Strategy A inactive signal.
    expect(
      computeCodeBlueManagerSnapshotDeny(
        snapshot({ operationalRole: null, reason: "CHECKED_IN_NO_OPROLE" }),
      ),
    ).toEqual({ kind: "deny", reason: "NO_OPEN_CHECK_IN" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateCodeBlueManagerAuthority — full evaluator paths

describe("evaluateCodeBlueManagerAuthority — mode 'off'", () => {
  it("returns allow with protected=MODE_OFF regardless of lookup or snapshot", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        lookup: { kind: "snapshot", snapshot: snapshot({ operationalRole: "night_admission_only" }) },
      }),
      { modeResolver: modeResolver("off") },
    );
    expect(verdict).toEqual({ action: "allow", protected: "MODE_OFF" });
  });

  it("does not emit metrics in mode 'off'", async () => {
    await evaluateCodeBlueManagerAuthority(
      baseContext({ lookup: { kind: "user_missing" } }),
      { modeResolver: modeResolver("off") },
    );
    const snap = getMetricsSnapshot();
    expect(snap.codeBlue.manager.allow).toBe(0);
    expect(snap.codeBlue.manager.shadowWouldHaveDenied.userMissing).toBe(0);
  });
});

describe("evaluateCodeBlueManagerAuthority — shadow mode, snapshot branch", () => {
  it("eligible manager → allow + allow counter", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(baseContext(), {
      modeResolver: modeResolver("shadow"),
    });
    expect(verdict).toEqual({ action: "allow", protected: "ALLOWLIST_OK" });
    expect(getMetricsSnapshot().codeBlue.manager.allow).toBe(1);
  });

  it("ineligible operational role → allow + shadow_denied_oprole_not_in_allowlist counter", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        lookup: { kind: "snapshot", snapshot: snapshot({ operationalRole: "night_admission_only" }) },
      }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({
      action: "allow",
      protected: "SHADOW_WOULD_HAVE_DENIED",
    });
    expect(
      getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.oproleNotInAllowlist,
    ).toBe(1);
  });

  it("Strategy A inactive → allow with MODE_INACTIVE_STRATEGY_A, no shadow audit", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        lookup: {
          kind: "snapshot",
          snapshot: snapshot({ operationalRole: null, reason: "EZSHIFT_NONE" }),
        },
      }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({
      action: "allow",
      protected: "MODE_INACTIVE_STRATEGY_A",
    });
    const s = getMetricsSnapshot();
    expect(s.codeBlue.manager.modeInactiveStrategyA).toBe(1);
    expect(s.codeBlue.manager.shadowWouldHaveDenied.noOpenCheckIn).toBe(0);
  });

  it("checked-in without oprole (not Strategy A) → allow with SHADOW_WOULD_HAVE_DENIED + no_open_check_in counter", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        lookup: {
          kind: "snapshot",
          snapshot: snapshot({ operationalRole: null, reason: "CHECKED_IN_NO_OPROLE" }),
        },
      }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({
      action: "allow",
      protected: "SHADOW_WOULD_HAVE_DENIED",
    });
    expect(getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.noOpenCheckIn).toBe(1);
  });
});

describe("evaluateCodeBlueManagerAuthority — shadow mode, lookup-failure branches", () => {
  it("user_missing → allow + shadow_denied_user_missing", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({ lookup: { kind: "user_missing" } }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({
      action: "allow",
      protected: "SHADOW_WOULD_HAVE_DENIED",
    });
    expect(getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.userMissing).toBe(1);
  });

  it("cross_clinic → allow + shadow_denied_manager_cross_clinic", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({ lookup: { kind: "cross_clinic" } }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({
      action: "allow",
      protected: "SHADOW_WOULD_HAVE_DENIED",
    });
    expect(getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.managerCrossClinic).toBe(1);
  });
});

describe("evaluateCodeBlueManagerAuthority — fail-open posture (master plan §9, DECISION-2)", () => {
  it("resolver_fault in shadow mode → allow + FAULT_OPEN + faultOpen counter", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({ lookup: { kind: "resolver_fault" } }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(verdict).toEqual({ action: "allow", protected: "FAULT_OPEN" });
    expect(getMetricsSnapshot().codeBlue.manager.faultOpen).toBe(1);
  });

  it("resolver_fault in enforce mode → allow + FAULT_OPEN + faultOpen counter (fail-open NOT fail-closed)", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({ lookup: { kind: "resolver_fault" } }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(verdict).toEqual({ action: "allow", protected: "FAULT_OPEN" });
    expect(getMetricsSnapshot().codeBlue.manager.faultOpen).toBe(1);
  });
});

describe("evaluateCodeBlueManagerAuthority — enforce mode, snapshot branch", () => {
  it("eligible manager → allow + allow counter", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(baseContext(), {
      modeResolver: modeResolver("enforce"),
    });
    expect(verdict).toEqual({ action: "allow", protected: "ALLOWLIST_OK" });
    expect(getMetricsSnapshot().codeBlue.manager.allow).toBe(1);
  });

  it("ineligible operational role → deny OPROLE_NOT_IN_CB_ALLOWLIST + denied counter", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        lookup: { kind: "snapshot", snapshot: snapshot({ operationalRole: "night_admission_only" }) },
      }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(verdict).toEqual({
      action: "deny",
      reason: "OPROLE_NOT_IN_CB_ALLOWLIST",
    });
    expect(getMetricsSnapshot().codeBlue.manager.denied.oproleNotInAllowlist).toBe(1);
  });

  it("Strategy A inactive → allow with MODE_INACTIVE_STRATEGY_A even in enforce mode", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        lookup: {
          kind: "snapshot",
          snapshot: snapshot({ operationalRole: null, reason: "EZSHIFT_NONE" }),
        },
      }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(verdict).toEqual({
      action: "allow",
      protected: "MODE_INACTIVE_STRATEGY_A",
    });
    expect(getMetricsSnapshot().codeBlue.manager.denied.noOpenCheckIn).toBe(0);
  });

  it("checked-in without oprole (not Strategy A) → deny NO_OPEN_CHECK_IN", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        lookup: {
          kind: "snapshot",
          snapshot: snapshot({ operationalRole: null, reason: "CHECKED_IN_NO_OPROLE" }),
        },
      }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(verdict).toEqual({ action: "deny", reason: "NO_OPEN_CHECK_IN" });
    expect(getMetricsSnapshot().codeBlue.manager.denied.noOpenCheckIn).toBe(1);
  });
});

describe("evaluateCodeBlueManagerAuthority — enforce mode, lookup-failure branches", () => {
  it("user_missing → deny USER_MISSING", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({ lookup: { kind: "user_missing" } }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(verdict).toEqual({ action: "deny", reason: "USER_MISSING" });
    expect(getMetricsSnapshot().codeBlue.manager.denied.userMissing).toBe(1);
  });

  it("cross_clinic → deny MANAGER_CROSS_CLINIC", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(
      baseContext({ lookup: { kind: "cross_clinic" } }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(verdict).toEqual({ action: "deny", reason: "MANAGER_CROSS_CLINIC" });
    expect(getMetricsSnapshot().codeBlue.manager.denied.managerCrossClinic).toBe(1);
  });
});

describe("evaluateCodeBlueManagerAuthority — endpoint independence", () => {
  it("initiation and end resolve modes independently", async () => {
    const calls: Array<{ clinicId: string; endpoint: string }> = [];
    const customResolver = async (clinicId: string, endpoint: "initiation" | "end") => {
      calls.push({ clinicId, endpoint });
      return endpoint === "initiation" ? ("shadow" as const) : ("enforce" as const);
    };

    const initVerdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        endpoint: "initiation",
        lookup: { kind: "snapshot", snapshot: snapshot({ operationalRole: "night_admission_only" }) },
      }),
      { modeResolver: customResolver },
    );
    expect(initVerdict.action).toBe("allow");

    const endVerdict = await evaluateCodeBlueManagerAuthority(
      baseContext({
        endpoint: "end",
        lookup: { kind: "snapshot", snapshot: snapshot({ operationalRole: "night_admission_only" }) },
      }),
      { modeResolver: customResolver },
    );
    expect(endVerdict.action).toBe("deny");

    expect(calls.map((c) => c.endpoint)).toEqual(["initiation", "end"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tombstone invariants — PR 4.1 foundation-only contract

describe("PR 4.1 foundation tombstones — counters never moved by this PR's code paths", () => {
  it("driftBetweenInitAndEnd stays 0 across all evaluator paths", async () => {
    // Run a representative selection of evaluator paths to ensure no path
    // accidentally increments the drift counter. PR 4.3 will be the first
    // PR to legitimately increment it.
    const lookups: CodeBlueManagerLookup[] = [
      { kind: "snapshot", snapshot: snapshot() }, // allow
      { kind: "snapshot", snapshot: snapshot({ operationalRole: "night_admission_only" }) }, // deny oprole
      { kind: "snapshot", snapshot: snapshot({ operationalRole: null, reason: "EZSHIFT_NONE" }) }, // mode_inactive
      { kind: "user_missing" },
      { kind: "cross_clinic" },
      { kind: "resolver_fault" },
    ];
    for (const lookup of lookups) {
      for (const mode of ["off", "shadow", "enforce"] as const) {
        await evaluateCodeBlueManagerAuthority(baseContext({ lookup }), {
          modeResolver: modeResolver(mode),
        });
      }
    }
    expect(getMetricsSnapshot().codeBlue.manager.driftBetweenInitAndEnd).toBe(0);
  });

  it("initiator.denied stays 0 across all evaluator paths (PR 4.2 owns increments)", async () => {
    await evaluateCodeBlueManagerAuthority(
      baseContext({ lookup: { kind: "user_missing" } }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(getMetricsSnapshot().codeBlue.initiator.denied).toBe(0);
  });
});
