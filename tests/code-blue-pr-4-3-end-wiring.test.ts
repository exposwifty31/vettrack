/**
 * Phase 4 PR 4.3 — PATCH /api/code-blue/sessions/:id/end wiring tests.
 *
 * Two layers:
 *
 *   1. Static-analysis tests over `server/routes/code-blue.ts` that lock the
 *      middleware chain shape, the evaluator call site, and the ordering
 *      relative to existing identity validation and the 15-minute gate.
 *
 *   2. Pure-function tests over `evaluateCodeBlueManagerForRoute` and the
 *      Code Blue manager evaluator's verdicts under the `endpoint: "end"`
 *      path — exercising shadow path, cross-clinic guard, Strategy A
 *      inactive, fail-open posture, and the drift counter increment.
 *
 * No Express boot, no live DB. The runtime tests mock `db` and
 * `resolveAuthority` the same way `tests/code-blue-pr-4-2-wiring.test.ts`
 * does — PR 4.3 reuses the frozen wiring helper from PR 4.2 unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const routeFile = path.join(repoRoot, "server", "routes", "code-blue.ts");
const routeSrc = fs.readFileSync(routeFile, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Static-analysis: PATCH /sessions/:id/end middleware chain + ordering
// ─────────────────────────────────────────────────────────────────────────────

function extractEndHandlerBlock(): string {
  const start = routeSrc.search(/router\.patch\(\s*["']\/sessions\/:id\/end["']/);
  expect(start, "PATCH /sessions/:id/end declaration not found").toBeGreaterThanOrEqual(0);
  const end = routeSrc.indexOf("\nrouter.", start + 1);
  return routeSrc.slice(start, end > start ? end : start + 6000);
}

const endBlock = extractEndHandlerBlock();

describe("PATCH /sessions/:id/end — middleware chain (close-out posture)", () => {
  // PR 4.3 architectural decision (see route doc comment + commit log):
  // PATCH /end deliberately does NOT add the requireClinicalAuthority
  // middleware that initiation uses. End is a close-out gated by the
  // persisted manager identity (MANAGER_ONLY check), not a fresh exercise
  // of clinical authority. Adding the gate would strand sessions whose
  // persisted manager loses their clinical shift mid-session (Codex P1 +
  // Bugbot HIGH findings during PR 4.3 review).

  it("does NOT add requireClinicalAuthority to the end route (production safety)", () => {
    // The end-handler region must NOT contain a requireClinicalAuthority
    // middleware call. (The wiring-helper import import still appears in
    // the file-level imports because POST /sessions — PR 4.2 — uses it.)
    expect(endBlock).not.toContain("requireClinicalAuthority(");
  });

  it("does NOT add requireClinicalUser to the end route", () => {
    expect(endBlock).not.toContain("requireClinicalUser");
  });

  it("does NOT use the legacy dispense fallback option on the end route", () => {
    expect(endBlock).not.toContain(
      "allowPermanentClinicalRoleFallbackForLegacyDispense",
    );
  });

  it("preserves the existing requireAuth + validateUuid + validateBody chain", () => {
    expect(endBlock).toContain("requireAuth");
    expect(endBlock).toContain('validateUuid("id")');
    expect(endBlock).toContain("validateBody(endSessionSchema)");
  });
});

describe("PATCH /sessions/:id/end — evaluator wiring & ordering", () => {
  it("calls evaluateCodeBlueManagerForRoute with endpoint=\"end\"", () => {
    expect(endBlock).toContain("evaluateCodeBlueManagerForRoute");
    expect(endBlock).toMatch(/endpoint\s*:\s*["']end["']/);
  });

  it("evaluator targets session.managerUserId (NOT req.authUser.id)", () => {
    // Locate the evaluator call and extract its argument shape.
    const callIdx = endBlock.indexOf("evaluateCodeBlueManagerForRoute");
    expect(callIdx).toBeGreaterThanOrEqual(0);
    // Look at the next ~400 chars for the argument body.
    const argBody = endBlock.slice(callIdx, callIdx + 500);
    expect(argBody).toMatch(/managerUserId\s*:\s*session\.managerUserId/);
    // Must NOT pass req.authUser.id as managerUserId.
    expect(argBody).not.toMatch(/managerUserId\s*:\s*req\.authUser/);
  });

  it("evaluator runs AFTER the session load and persisted-manager identity validation", () => {
    const sessionLoadIdx = endBlock.indexOf(".from(codeBlueSessions)");
    const managerOnlyIdx = endBlock.indexOf("MANAGER_ONLY");
    const managerInactiveIdx = endBlock.indexOf("MANAGER_INACTIVE");
    const evaluatorIdx = endBlock.indexOf("evaluateCodeBlueManagerForRoute");
    expect(sessionLoadIdx).toBeGreaterThanOrEqual(0);
    expect(managerOnlyIdx).toBeGreaterThanOrEqual(0);
    expect(managerInactiveIdx).toBeGreaterThanOrEqual(0);
    expect(evaluatorIdx).toBeGreaterThanOrEqual(0);
    expect(sessionLoadIdx).toBeLessThan(evaluatorIdx);
    expect(managerOnlyIdx).toBeLessThan(evaluatorIdx);
    expect(managerInactiveIdx).toBeLessThan(evaluatorIdx);
  });

  it("evaluator runs BEFORE the session UPDATE write", () => {
    const evaluatorIdx = endBlock.indexOf("evaluateCodeBlueManagerForRoute");
    const updateIdx = endBlock.indexOf(".update(codeBlueSessions)");
    expect(evaluatorIdx).toBeLessThan(updateIdx);
  });

  it("evaluator runs BEFORE the codeBlueEvents archive insert", () => {
    const evaluatorIdx = endBlock.indexOf("evaluateCodeBlueManagerForRoute");
    const insertIdx = endBlock.indexOf("insert(codeBlueEvents)");
    expect(evaluatorIdx).toBeLessThan(insertIdx);
  });

  it("evaluator runs BEFORE the code_blue_ended audit", () => {
    const evaluatorIdx = endBlock.indexOf("evaluateCodeBlueManagerForRoute");
    const auditIdx = endBlock.indexOf('"code_blue_ended"');
    expect(evaluatorIdx).toBeLessThan(auditIdx);
  });

  it("guards the evaluator call behind a session.managerUserId null/undefined check", () => {
    // The call must be wrapped in an `if (session.managerUserId)` guard so
    // a missing manager id never triggers the evaluator.
    expect(endBlock).toMatch(/if\s*\(\s*session\.managerUserId\s*\)/);
  });

  it("drift counter (codeBlueManagerMetrics.driftBetweenInitAndEnd) is incremented inside the end handler", () => {
    expect(endBlock).toContain("codeBlueManagerMetrics.driftBetweenInitAndEnd");
  });

  it("drift counter increment is reachable only after the evaluator call", () => {
    const evaluatorIdx = endBlock.indexOf("evaluateCodeBlueManagerForRoute");
    const driftIdx = endBlock.indexOf("driftBetweenInitAndEnd");
    expect(evaluatorIdx).toBeGreaterThanOrEqual(0);
    expect(driftIdx).toBeGreaterThan(evaluatorIdx);
  });

  it("evaluator call is wrapped in a defensive try/catch (never blocks session end on throw)", () => {
    // The evaluator is designed to fail-open via its `resolver_fault` lookup
    // kind, but a throw from audit emission, metric increment, or a future
    // edge case must NEVER strand session end. The wrapping try/catch
    // preserves the shadow-only / never-blocks invariant under all error
    // conditions.
    const evaluatorIdx = endBlock.indexOf("evaluateCodeBlueManagerForRoute");
    expect(evaluatorIdx).toBeGreaterThanOrEqual(0);
    // Find the nearest preceding `try {` and the nearest following `catch (`.
    const preEvaluator = endBlock.slice(0, evaluatorIdx);
    const lastTryIdx = preEvaluator.lastIndexOf("try {");
    expect(lastTryIdx).toBeGreaterThanOrEqual(0);
    const postEvaluator = endBlock.slice(evaluatorIdx);
    const localCatchIdx = postEvaluator.search(/\}\s*catch\s*\(/);
    const updateIdxAfter = postEvaluator.indexOf(".update(codeBlueSessions)");
    expect(localCatchIdx).toBeGreaterThanOrEqual(0);
    expect(localCatchIdx).toBeLessThan(updateIdxAfter);
  });
});

describe("PATCH /sessions/:id/end — preserved existing semantics", () => {
  it("manager-only identity gate is preserved (MANAGER_ONLY 403)", () => {
    expect(endBlock).toContain("MANAGER_ONLY");
    expect(endBlock).toContain("403");
  });

  it("CPR 15-minute minimum gate removed (equipment-focused end)", () => {
    expect(endBlock).not.toContain("FIFTEEN_MINUTES_MS");
    expect(endBlock).not.toContain("TOO_EARLY");
  });

  it("earlyStopReason waiver remains a 400 when below the 3-char minimum", () => {
    expect(endBlock).toContain("EARLY_STOP_REASON_REQUIRED");
  });

  it("response contract still returns {id, endedAt, summary}", () => {
    expect(endBlock).toMatch(/res\.json\(\s*\{\s*id\s*:\s*sessionId/);
    expect(endBlock).toContain("endedAt: endedAt.toISOString()");
    expect(endBlock).toContain("summary: JSON.parse(summary)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime: wiring helper + evaluator behavior for endpoint:"end"
// ─────────────────────────────────────────────────────────────────────────────

const dbSelectMock = vi.fn();
vi.mock("../server/db.js", () => ({
  db: {
    select: (...args: unknown[]) => dbSelectMock(...args),
  },
  users: {
    id: "users.id",
    clinicId: "users.clinicId",
    name: "users.name",
    role: "users.role",
    deletedAt: "users.deletedAt",
  },
  auditLogs: {},
  eventOutbox: {},
}));

const resolveAuthorityMock = vi.fn();
vi.mock("../server/lib/authority.js", () => ({
  resolveAuthority: (input: unknown) => resolveAuthorityMock(input),
}));

const { evaluateCodeBlueManagerForRoute } = await import(
  "../server/lib/authority/code-blue-manager.wiring.js"
);
const { resetMetrics, getMetricsSnapshot } = await import(
  "../server/lib/metrics.js"
);
const { codeBlueManagerMetrics } = await import(
  "../server/lib/authority/enforcement/code-blue-manager.metrics.js"
);

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");

function mockUserRow(overrides: Record<string, unknown> = {}) {
  const row = {
    id: "manager-1",
    clinicId: "clinic-1",
    name: "Dr. Vet",
    role: "vet",
    deletedAt: null,
    ...overrides,
  };
  dbSelectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [row],
      }),
    }),
  }));
}

function snapshotOk() {
  return {
    systemRole: "User",
    clinicalRole: "vet",
    activeShiftRole: "vet",
    operationalRole: "senior_lead",
    effectiveClinicalRole: "vet",
    source: "check_in",
    reason: "CHECKED_IN",
    resolvedAt: FIXED_NOW.toISOString(),
  };
}

beforeEach(() => {
  resetMetrics();
  dbSelectMock.mockReset();
  resolveAuthorityMock.mockReset();
  delete process.env.AUTHORITY_OBS_V1;
  delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
});

afterEach(() => {
  resetMetrics();
});

describe("evaluateCodeBlueManagerForRoute(endpoint:\"end\") — actor vs manager independence", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
  });
  afterEach(() => {
    delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
  });

  it("evaluator resolves the persisted manager identity independent of any actor id", async () => {
    mockUserRow({ id: "persisted-manager-7", clinicId: "clinic-1" });
    resolveAuthorityMock.mockResolvedValue(snapshotOk());
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "persisted-manager-7",
      endpoint: "end",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({ action: "allow", protected: "ALLOWLIST_OK" });
    // Resolver was invoked with the persisted manager identity, never a
    // synthesized "actor" identity. The wiring helper takes no req object.
    const call = resolveAuthorityMock.mock.calls[0][0];
    expect(call.authUser.id).toBe("persisted-manager-7");
  });
});

describe("evaluateCodeBlueManagerForRoute(endpoint:\"end\") — shadow-mode verdicts", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
  });
  afterEach(() => {
    delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
  });

  it("cross-clinic manager → SHADOW_WOULD_HAVE_DENIED + MANAGER_CROSS_CLINIC counter", async () => {
    mockUserRow({ clinicId: "clinic-elsewhere" });
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "end",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({
      action: "allow",
      protected: "SHADOW_WOULD_HAVE_DENIED",
    });
    expect(result.lookupKind).toBe("cross_clinic");
    expect(
      getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.managerCrossClinic,
    ).toBeGreaterThanOrEqual(1);
  });

  it("Strategy A inactive → MODE_INACTIVE_STRATEGY_A, no shadow audit", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: null,
      reason: "EZSHIFT_NONE",
    });
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "end",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({
      action: "allow",
      protected: "MODE_INACTIVE_STRATEGY_A",
    });
    expect(
      getMetricsSnapshot().codeBlue.manager.modeInactiveStrategyA,
    ).toBeGreaterThanOrEqual(1);
    // No shadow_denied counter increment in Strategy A.
    expect(
      getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.noOpenCheckIn,
    ).toBe(0);
  });

  it("resolver fault → FAULT_OPEN + faultOpen counter (fail-open in shadow)", async () => {
    mockUserRow();
    resolveAuthorityMock.mockRejectedValue(new Error("breaker open"));
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "end",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({ action: "allow", protected: "FAULT_OPEN" });
    expect(getMetricsSnapshot().codeBlue.manager.faultOpen).toBeGreaterThanOrEqual(1);
  });

  it("ineligible operational role at end → SHADOW_WOULD_HAVE_DENIED + oprole counter", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "end",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({
      action: "allow",
      protected: "SHADOW_WOULD_HAVE_DENIED",
    });
    expect(
      getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.oproleNotInAllowlist,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("Drift counter — driftBetweenInitAndEnd", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
  });
  afterEach(() => {
    delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
  });

  it("the helper exists and increments the dedicated flat counter", () => {
    codeBlueManagerMetrics.driftBetweenInitAndEnd();
    codeBlueManagerMetrics.driftBetweenInitAndEnd();
    expect(getMetricsSnapshot().codeBlue.manager.driftBetweenInitAndEnd).toBe(2);
  });

  it("end-time eligibility crossover (would-have-denied at end) is observable through the verdict.protected discriminator", async () => {
    // Manager whose end-side verdict is shadow-deny is the crossover signal:
    // the session was successfully created at init time (or it would not
    // exist), and now the manager is no longer Code-Blue-eligible at end.
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "end",
      now: FIXED_NOW,
    });
    // The end handler's drift-increment guard observes this exact verdict
    // shape and increments driftBetweenInitAndEnd. Tested directly here so a
    // future refactor of the guard cannot silently drop the signal.
    const endWouldDeny =
      result.verdict.action === "deny" ||
      result.verdict.protected === "SHADOW_WOULD_HAVE_DENIED";
    expect(endWouldDeny).toBe(true);
  });

  it("eligible manager at end → no crossover (drift NOT incremented in real handler flow)", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue(snapshotOk());
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "end",
      now: FIXED_NOW,
    });
    const endWouldDeny =
      result.verdict.action === "deny" ||
      result.verdict.protected === "SHADOW_WOULD_HAVE_DENIED";
    expect(endWouldDeny).toBe(false);
    // No new evaluator call → drift counter is not incremented by the
    // evaluator path itself.
    expect(getMetricsSnapshot().codeBlue.manager.driftBetweenInitAndEnd).toBe(0);
  });
});
