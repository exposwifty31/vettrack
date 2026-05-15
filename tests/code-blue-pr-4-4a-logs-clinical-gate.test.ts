/**
 * Phase 4 PR 4.4a — POST /api/code-blue/sessions/:id/logs wiring tests.
 *
 * Two layers:
 *
 *   1. Static-analysis tests over `server/routes/code-blue.ts` that lock the
 *      clinical-gate middleware chain on POST /logs, the `allowSystemAdmin:false`
 *      posture, and the mid-session manager-drift detection call.
 *
 *   2. Pure-function tests over `detectMidsessionManagerDrift` covering:
 *      - eligible manager → no audit, no counter increment
 *      - ineligible operational role → mid-session counter + audit (shadow)
 *      - manager checked out (no oprole) → mid-session counter + audit
 *      - Strategy A inactive → silent (no signal)
 *      - resolver fault → silent (no signal, never throws)
 *      - cross-clinic / user_missing → silent (handled by init/end paths)
 *      - throw safety: helper never throws under any dependency failure
 *      - never-block invariant: helper is a void Promise
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const routeFile = path.join(repoRoot, "server", "routes", "code-blue.ts");
const helperFile = path.join(
  repoRoot,
  "server",
  "lib",
  "authority",
  "code-blue-manager-midsession.ts",
);

const routeSrc = fs.readFileSync(routeFile, "utf8");
const helperSrc = fs.readFileSync(helperFile, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Static-analysis: POST /sessions/:id/logs middleware chain + wiring
// ─────────────────────────────────────────────────────────────────────────────

function extractLogsHandlerBlock(): string {
  const start = routeSrc.search(
    /router\.post\(\s*["']\/sessions\/:id\/logs["']/,
  );
  expect(start, "POST /sessions/:id/logs declaration not found").toBeGreaterThanOrEqual(0);
  const end = routeSrc.indexOf("\nrouter.", start + 1);
  return routeSrc.slice(start, end > start ? end : start + 4000);
}

const logsBlock = extractLogsHandlerBlock();

describe("POST /sessions/:id/logs — middleware chain", () => {
  it("uses requireClinicalAuthority (not just requireAuth)", () => {
    expect(logsBlock).toContain("requireClinicalAuthority");
  });

  it("uses requireClinicalUser before requireClinicalAuthority", () => {
    const userIdx = logsBlock.indexOf("requireClinicalUser");
    const authIdx = logsBlock.indexOf("requireClinicalAuthority");
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeLessThan(authIdx);
  });

  it("uses allowSystemAdmin: false on the logs clinical gate (master plan §8)", () => {
    expect(logsBlock).toMatch(/allowSystemAdmin\s*:\s*false/);
  });

  it("uses the standard clinical allow list (vet, senior_technician, technician)", () => {
    expect(logsBlock).toContain('"vet"');
    expect(logsBlock).toContain('"senior_technician"');
    expect(logsBlock).toContain('"technician"');
  });

  it("does NOT use the legacy dispense fallback option on the logs gate", () => {
    expect(logsBlock).not.toContain(
      "allowPermanentClinicalRoleFallbackForLegacyDispense",
    );
  });
});

describe("POST /sessions/:id/logs — mid-session drift detection wiring", () => {
  it("invokes detectMidsessionManagerDrift", () => {
    expect(logsBlock).toContain("detectMidsessionManagerDrift");
  });

  it("mid-session detection uses session.managerUserId (the persisted manager)", () => {
    const callIdx = logsBlock.indexOf("detectMidsessionManagerDrift");
    expect(callIdx).toBeGreaterThanOrEqual(0);
    const argBody = logsBlock.slice(callIdx, callIdx + 400);
    expect(argBody).toMatch(/managerUserId\s*:\s*session\.managerUserId/);
    expect(argBody).not.toMatch(/managerUserId\s*:\s*req\.authUser/);
  });

  it("mid-session detection is fire-and-forget (void + .catch — never blocks)", () => {
    const callIdx = logsBlock.indexOf("detectMidsessionManagerDrift");
    // Look ~150 chars back for the void keyword introducing the call.
    const preCall = logsBlock.slice(Math.max(0, callIdx - 150), callIdx);
    expect(preCall).toMatch(/\bvoid\b/);
    // After the call, a .catch handler must appear before the next major
    // statement so any thrown promise rejection is locally absorbed.
    const postCall = logsBlock.slice(callIdx);
    expect(postCall.indexOf(".catch(")).toBeGreaterThanOrEqual(0);
  });

  it("mid-session detection runs AFTER the log entry is inserted (the response can already commit)", () => {
    const insertIdx = logsBlock.indexOf("insert(codeBlueLogEntries)");
    const detectIdx = logsBlock.indexOf("detectMidsessionManagerDrift");
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(detectIdx).toBeGreaterThan(insertIdx);
  });

  it("session query selects managerUserId (so the mid-session helper has the persisted id)", () => {
    expect(logsBlock).toMatch(
      /managerUserId\s*:\s*codeBlueSessions\.managerUserId/,
    );
  });
});

describe("POST /sessions/:id/logs — preserved existing semantics", () => {
  it("idempotency check on idempotencyKey is preserved", () => {
    expect(logsBlock).toContain("idempotencyKey");
    expect(logsBlock).toContain("duplicate: true");
  });

  it("code_blue_log_entry_created audit is preserved", () => {
    expect(logsBlock).toContain('"code_blue_log_entry_created"');
  });

  it("response shape is unchanged ({ id, duplicate: false })", () => {
    expect(logsBlock).toContain('duplicate: false');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static-analysis: mid-session helper architectural invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("code-blue-manager-midsession.ts — architectural invariants", () => {
  it("does NOT import Express types or dereference req.authoritySnapshot", () => {
    const codeOnly = helperSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/from\s+["']express["']/);
    expect(codeOnly).not.toMatch(/\.authoritySnapshot\b/);
  });

  it("reuses the frozen PR 4.2 wiring helper (loadCodeBlueManagerLookup)", () => {
    expect(helperSrc).toContain("loadCodeBlueManagerLookup");
    expect(helperSrc).toMatch(
      /from\s+["']\.\/code-blue-manager\.wiring\.js["']/,
    );
  });

  it("reuses the frozen PR 4.1 evaluator predicate (computeCodeBlueManagerSnapshotDeny)", () => {
    expect(helperSrc).toContain("computeCodeBlueManagerSnapshotDeny");
    expect(helperSrc).toMatch(
      /from\s+["']\.\/enforcement\/code-blue-manager\.evaluator\.js["']/,
    );
  });

  it("does NOT call evaluateCodeBlueManagerAuthority (wrong audit family)", () => {
    // Doc comments may mention the symbol; the executable-code check is what
    // matters. Strip block/line comments before asserting.
    const codeOnly = helperSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("evaluateCodeBlueManagerAuthority");
  });

  it("emits a top-level try/catch wrapping the entire body (never throws)", () => {
    // The exported async function's body must be wrapped in `try { ... } catch`
    // so the never-block contract holds under all dependency failures.
    expect(helperSrc).toMatch(/export async function detectMidsessionManagerDrift[\s\S]*?try\s*\{/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime: detectMidsessionManagerDrift
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

const logAuditMock = vi.fn();
vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return {
    ...actual,
    logAudit: (...args: unknown[]) => logAuditMock(...args),
  };
});

const { detectMidsessionManagerDrift } = await import(
  "../server/lib/authority/code-blue-manager-midsession.js"
);
const { resetMetrics, getMetricsSnapshot } = await import(
  "../server/lib/metrics.js"
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
  logAuditMock.mockReset();
  process.env.AUTHORITY_OBS_V1 = "true";
});

afterEach(() => {
  resetMetrics();
  delete process.env.AUTHORITY_OBS_V1;
});

describe("detectMidsessionManagerDrift — no-op cases", () => {
  it("returns a void promise (never throws on missing managerUserId)", async () => {
    const result = await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-1",
      managerUserId: null,
      now: FIXED_NOW,
    });
    expect(result).toBeUndefined();
    expect(dbSelectMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("eligible manager → silent (no audit, no counter increment)", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue(snapshotOk());
    await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-1",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied
        .oproleNotInAllowlist,
    ).toBe(0);
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied.noOpenCheckIn,
    ).toBe(0);
  });

  it("Strategy A inactive → silent (handled by init/end paths)", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: null,
      reason: "EZSHIFT_NONE",
    });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-1",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied.noOpenCheckIn,
    ).toBe(0);
  });

  it("cross-clinic → silent (not a mid-session drift signal)", async () => {
    mockUserRow({ clinicId: "clinic-elsewhere" });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-1",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied
        .oproleNotInAllowlist,
    ).toBe(0);
  });

  it("user_missing → silent (not a mid-session drift signal)", async () => {
    dbSelectMock.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }));
    await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-1",
      managerUserId: "ghost",
      now: FIXED_NOW,
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("resolver_fault → silent (caught by frozen wiring helper)", async () => {
    mockUserRow();
    resolveAuthorityMock.mockRejectedValue(new Error("breaker open"));
    await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-1",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("detectMidsessionManagerDrift — drift signals (shadow)", () => {
  it("ineligible operational role → midsession counter + audit", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-7",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied
        .oproleNotInAllowlist,
    ).toBe(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.actionType).toBe(
      "code_blue_manager_midsession_authority_shadow_denied",
    );
    expect(call.clinicId).toBe("clinic-1");
    expect(call.performedBy).toBe("manager-1");
    expect(call.metadata).toMatchObject({
      kind: "midsession_shadow_denied",
      reason: "OPROLE_NOT_IN_CB_ALLOWLIST",
      sessionId: "session-7",
      severity: "info",
    });
  });

  it("manager checked in without oprole (not Strategy A) → no_open_check_in counter + audit", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: null,
      reason: "CHECKED_IN_NO_OPROLE",
    });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-8",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied.noOpenCheckIn,
    ).toBe(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].metadata).toMatchObject({
      reason: "NO_OPEN_CHECK_IN",
    });
  });

  it("AUTHORITY_OBS_V1 unset → counter still increments, audit suppressed", async () => {
    delete process.env.AUTHORITY_OBS_V1;
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-1",
      sessionId: "session-9",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied
        .oproleNotInAllowlist,
    ).toBe(1);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("detectMidsessionManagerDrift — rate-limited audit emission (Codex P2)", () => {
  it("repeated drift calls within 60s for the same (clinicId, sessionId, managerUserId, reason) emit at most one audit row; counter still increments every time", async () => {
    // mockUserRow default `clinicId` must match input.clinicId or the
    // helper's cross-clinic early-return fires.
    mockUserRow({ clinicId: "clinic-r" });
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    // Simulate a frequent log-write pattern: 10 invocations in rapid
    // succession for the same drift condition.
    for (let i = 0; i < 10; i++) {
      await detectMidsessionManagerDrift({
        clinicId: "clinic-r",
        sessionId: "session-rate",
        managerUserId: "manager-rate",
        now: FIXED_NOW,
      });
    }
    // Counter volume IS the signal — every call increments.
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied
        .oproleNotInAllowlist,
    ).toBe(10);
    // Audit rows: at most one per (clinicId, sessionId, managerUserId, reason)
    // per 60s. With the same key across all 10 calls, exactly one row fires.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  it("different (sessionId) keys emit independently within 60s", async () => {
    mockUserRow({ clinicId: "clinic-r2" });
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-r2",
      sessionId: "session-A",
      managerUserId: "manager-r2",
      now: FIXED_NOW,
    });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-r2",
      sessionId: "session-B",
      managerUserId: "manager-r2",
      now: FIXED_NOW,
    });
    expect(logAuditMock).toHaveBeenCalledTimes(2);
  });

  it("different (reason) keys emit independently within 60s", async () => {
    // First call: ineligible operational role → OPROLE_NOT_IN_CB_ALLOWLIST.
    mockUserRow({ clinicId: "clinic-r3" });
    resolveAuthorityMock.mockResolvedValueOnce({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-r3",
      sessionId: "session-r3",
      managerUserId: "manager-r3",
      now: FIXED_NOW,
    });
    // Second call: same session, but now NO_OPEN_CHECK_IN reason.
    resolveAuthorityMock.mockResolvedValueOnce({
      ...snapshotOk(),
      operationalRole: null,
      reason: "CHECKED_IN_NO_OPROLE",
    });
    await detectMidsessionManagerDrift({
      clinicId: "clinic-r3",
      sessionId: "session-r3",
      managerUserId: "manager-r3",
      now: FIXED_NOW,
    });
    expect(logAuditMock).toHaveBeenCalledTimes(2);
  });
});

describe("detectMidsessionManagerDrift — never-throw contract", () => {
  it("DB throw is absorbed (no propagation)", async () => {
    dbSelectMock.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            throw new Error("db blip");
          },
        }),
      }),
    }));
    // Must not throw.
    await expect(
      detectMidsessionManagerDrift({
        clinicId: "clinic-1",
        sessionId: "session-1",
        managerUserId: "manager-1",
        now: FIXED_NOW,
      }),
    ).resolves.toBeUndefined();
  });

  it("logAudit throw is absorbed (counter already incremented; helper still resolves)", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    logAuditMock.mockImplementation(() => {
      throw new Error("audit emit failed");
    });
    await expect(
      detectMidsessionManagerDrift({
        clinicId: "clinic-1",
        sessionId: "session-1",
        managerUserId: "manager-1",
        now: FIXED_NOW,
      }),
    ).resolves.toBeUndefined();
    // Counter was incremented before logAudit was called.
    expect(
      getMetricsSnapshot().codeBlue.manager.midsessionShadowDenied
        .oproleNotInAllowlist,
    ).toBe(1);
  });
});
