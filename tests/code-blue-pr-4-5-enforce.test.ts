/**
 * Phase 4 PR 4.5 — Per-clinic enforce activation tests.
 *
 * Three layers:
 *
 *   1. Env-default invariant: no env var set → resolvers return `"off"` for
 *      every Phase 4 mode flag. PR 4.5 must NOT flip any env default to
 *      `enforce` (master plan §11). The shadow soak gate is operator-
 *      driven and per-clinic.
 *
 *   2. Static-analysis: each route translates `verdict.action === "deny"`
 *      into a 403 with a stable reason code BEFORE any side-effecting work
 *      (initiation: DB insert / push / system message / "started" audit;
 *      end: 15-min gate / UPDATE / archive; drug/shock logs: DB insert).
 *
 *   3. Runtime: `evaluateDrugShockActorForRoute` returns the correct
 *      verdict shape in each mode (off / shadow / enforce), emits the
 *      correct audit kind / counter family, and rate-limits within
 *      (clinicId, sessionId, actorUserId, reason).
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
// Static-analysis: route translates `verdict.action === "deny"` into 403
// ─────────────────────────────────────────────────────────────────────────────

function extractHandlerBlock(routeStartPattern: RegExp): string {
  const start = routeSrc.search(routeStartPattern);
  expect(start, `route ${routeStartPattern} not found`).toBeGreaterThanOrEqual(0);
  const end = routeSrc.indexOf("\nrouter.", start + 1);
  return routeSrc.slice(start, end > start ? end : start + 8000);
}

describe("PR 4.5 — POST /sessions enforce-mode 403", () => {
  const block = extractHandlerBlock(/router\.post\(\s*["']\/sessions["']/);

  it("acts on initiation verdict action === \"deny\" by returning 403", () => {
    expect(block).toMatch(/initiationVerdict\.action\s*===\s*["']deny["']/);
    expect(block).toContain("status(403)");
    expect(block).toContain("MANAGER_NOT_CODE_BLUE_ELIGIBLE");
  });

  it("403 response includes the verdict's reason code (stable contract)", () => {
    // The 403 response body's `reason` field carries the verdict's narrowed
    // reason value. Locate the actual apiError-call code path (not the doc
    // comment that also mentions the code name). Accept shorthand
    // `reason,` (object-literal short property) or explicit `reason: ...`.
    const handlerIdx = block.indexOf('code: "MANAGER_NOT_CODE_BLUE_ELIGIBLE"');
    expect(handlerIdx).toBeGreaterThan(0);
    const handlerSlice = block.slice(handlerIdx, handlerIdx + 400);
    expect(handlerSlice).toMatch(
      /reason\s*[,:](\s*(initiationVerdict\.reason|reason\b))?/,
    );
  });

  it("403 fires BEFORE any side effect (DB insert / push / system message)", () => {
    const denyIdx = block.indexOf("MANAGER_NOT_CODE_BLUE_ELIGIBLE");
    const insertIdx = block.indexOf("insert(codeBlueSessions)");
    const pushIdx = block.indexOf("enqueueNotificationJob");
    const sysMsgIdx = block.indexOf("postSystemMessage");
    expect(denyIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(denyIdx);
    expect(pushIdx).toBeGreaterThan(denyIdx);
    expect(sysMsgIdx).toBeGreaterThan(denyIdx);
  });

  it("403 fires ONLY for operational-role denials (Codex P2): USER_MISSING / MANAGER_CROSS_CLINIC fall through to INVALID_MANAGER", () => {
    // The new 403 path must be gated on the operational-role deny reasons
    // ONLY. USER_MISSING and MANAGER_CROSS_CLINIC are input-validation
    // signals; they fall through to the existing 400 INVALID_MANAGER
    // response. Look at the slice between the deny-handler if-statement
    // and the actual INVALID_MANAGER apiError call site (skipping doc
    // comments that also mention "INVALID_MANAGER").
    const denyHandlerIdx = block.indexOf('initiationVerdict.action === "deny"');
    expect(denyHandlerIdx).toBeGreaterThanOrEqual(0);
    const invalidManagerCodeIdx = block.indexOf('code: "INVALID_MANAGER"');
    expect(invalidManagerCodeIdx).toBeGreaterThan(denyHandlerIdx);
    const denyHandlerSlice = block.slice(denyHandlerIdx, invalidManagerCodeIdx);
    // The narrowing guard must reference both operational-role reasons.
    const guardedReasonsRegex = /reason\s*===\s*["'](OPROLE_NOT_IN_CB_ALLOWLIST|NO_OPEN_CHECK_IN)["']/g;
    const guardMatches = denyHandlerSlice.match(guardedReasonsRegex) ?? [];
    expect(guardMatches.length).toBeGreaterThanOrEqual(2);
    // The 403 must be returned from inside the guarded branch.
    expect(denyHandlerSlice).toContain('"MANAGER_NOT_CODE_BLUE_ELIGIBLE"');
  });
});

describe("PR 4.5 — PATCH /sessions/:id/end enforce-mode 403", () => {
  const block = extractHandlerBlock(/router\.patch\(\s*["']\/sessions\/:id\/end["']/);

  it("acts on end-side verdict action === \"deny\" by returning 403", () => {
    expect(block).toMatch(/endVerdict\?\.action\s*===\s*["']deny["']/);
    expect(block).toContain("MANAGER_NOT_CODE_BLUE_ELIGIBLE");
  });

  it("403 response includes the verdict's reason code", () => {
    // Same as initiation. Accept shorthand or explicit form.
    const handlerIdx = block.indexOf('code: "MANAGER_NOT_CODE_BLUE_ELIGIBLE"');
    expect(handlerIdx).toBeGreaterThan(0);
    const handlerSlice = block.slice(handlerIdx, handlerIdx + 400);
    expect(handlerSlice).toMatch(
      /reason\s*[,:](\s*(endVerdict\.reason|reason\b))?/,
    );
  });

  it("403 fires BEFORE the UPDATE / archive flow (no CPR duration gate)", () => {
    const denyIdx = block.lastIndexOf("MANAGER_NOT_CODE_BLUE_ELIGIBLE");
    const updateIdx = block.indexOf(".update(codeBlueSessions)");
    const archiveIdx = block.indexOf("insert(codeBlueEvents)");
    expect(denyIdx).toBeGreaterThan(0);
    expect(block).not.toContain("FIFTEEN_MINUTES_MS");
    expect(updateIdx).toBeGreaterThan(denyIdx);
    expect(archiveIdx).toBeGreaterThan(denyIdx);
  });

  it("retains the fault-open contract: try/catch around the evaluator absorbs all errors", () => {
    // The deny-403 branch must only fire when endVerdict was actually set
    // by a successful evaluator call. The try/catch leaves endVerdict null
    // on throw → no 403, session-end continues. This is the fault-open
    // invariant locked by master plan §9.
    expect(block).toMatch(/let endVerdict[^;]*\|?\s*null/);
    expect(block).toMatch(/catch\s*\(\s*evalErr/);
  });
});

describe("POST /sessions/:id/logs — equipment-focused categories", () => {
  const block = extractHandlerBlock(/router\.post\(\s*["']\/sessions\/:id\/logs["']/);

  it("logEntrySchema allows only equipment and note", () => {
    expect(routeSrc).toMatch(/category:\s*z\.enum\(\[["']equipment["'],\s*["']note["']\]\)/);
  });

  it("does not invoke drug/shock authority evaluator on log writes", () => {
    const codeOnly = block.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("evaluateDrugShockActorForRoute");
    expect(codeOnly).not.toContain("detectDrugShockActorDrift");
    expect(codeOnly).not.toContain("DRUG_SHOCK_AUTHORITY_REQUIRED");
  });

  it("persists log rows via codeBlueLogEntries insert", () => {
    expect(block).toContain("insert(codeBlueLogEntries)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Env-default invariant — no env var → off
// ─────────────────────────────────────────────────────────────────────────────

const mockGetServerConfigValue = vi.fn();
vi.mock("../server/db.js", () => ({ db: {}, users: {} }));
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: (...args: unknown[]) => mockGetServerConfigValue(...args),
}));

const {
  __resetEnforcementConfigCacheForTests,
  resolveCodeBlueManagerEnforcementMode,
  resolveCodeBlueLogDrugShockEnforcementMode,
} = await import("../server/lib/authority/enforcement/config.js");

beforeEach(() => {
  __resetEnforcementConfigCacheForTests();
  mockGetServerConfigValue.mockReset();
  mockGetServerConfigValue.mockResolvedValue(null);
  delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
  delete process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1;
});

afterEach(() => {
  __resetEnforcementConfigCacheForTests();
});

describe("PR 4.5 — env-default invariant (master plan §11: no global flip)", () => {
  it("manager initiation: no env, no per-clinic → 'off'", async () => {
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-1", "initiation"),
    ).toBe("off");
  });

  it("manager end: no env, no per-clinic → 'off'", async () => {
    expect(await resolveCodeBlueManagerEnforcementMode("clinic-1", "end")).toBe(
      "off",
    );
  });

  it("drug/shock: no env, no per-clinic → 'off'", async () => {
    expect(await resolveCodeBlueLogDrugShockEnforcementMode("clinic-1")).toBe(
      "off",
    );
  });

  it("no env default resolves to 'enforce' under any Phase 4 sub-key", async () => {
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-q", "initiation"),
    ).not.toBe("enforce");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-q", "end"),
    ).not.toBe("enforce");
    expect(
      await resolveCodeBlueLogDrugShockEnforcementMode("clinic-q"),
    ).not.toBe("enforce");
  });
});

describe("PR 4.5 — per-clinic enable / disable (layered rollback)", () => {
  it("manager initiation: per-clinic 'enforce' beats env 'shadow'", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-e", "initiation"),
    ).toBe("enforce");
  });

  it("manager end: per-clinic config takes precedence; rollback flips back within TTL", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-e2", "end"),
    ).toBe("enforce");
    __resetEnforcementConfigCacheForTests();
    mockGetServerConfigValue.mockResolvedValue("shadow");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-e2", "end"),
    ).toBe("shadow");
    __resetEnforcementConfigCacheForTests();
    mockGetServerConfigValue.mockResolvedValue("off");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-e2", "end"),
    ).toBe("off");
  });

  it("drug/shock: per-clinic enable isolates to that clinic (other clinics stay off)", async () => {
    mockGetServerConfigValue
      .mockResolvedValueOnce("enforce") // clinic-a
      .mockResolvedValueOnce(null); // clinic-b (no override)
    expect(await resolveCodeBlueLogDrugShockEnforcementMode("clinic-a")).toBe(
      "enforce",
    );
    expect(await resolveCodeBlueLogDrugShockEnforcementMode("clinic-b")).toBe(
      "off",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime: evaluateDrugShockActorForRoute verdict shape
// ─────────────────────────────────────────────────────────────────────────────

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

const { evaluateDrugShockActorForRoute } = await import(
  "../server/lib/authority/code-blue-log-drug-shock.js"
);
const { resetMetrics, getMetricsSnapshot } = await import(
  "../server/lib/metrics.js"
);

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");

function snapshotOk() {
  return {
    systemRole: "User" as const,
    clinicalRole: "vet" as const,
    activeShiftRole: "vet" as const,
    operationalRole: "senior_lead" as const,
    effectiveClinicalRole: "vet" as const,
    source: "check_in" as const,
    reason: "CHECKED_IN" as const,
    resolvedAt: FIXED_NOW.toISOString(),
  };
}

describe("evaluateDrugShockActorForRoute — verdict shape under each mode", () => {
  beforeEach(() => {
    resetMetrics();
    logAuditMock.mockReset();
    process.env.AUTHORITY_OBS_V1 = "true";
  });
  afterEach(() => {
    resetMetrics();
    delete process.env.AUTHORITY_OBS_V1;
    delete process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1;
  });

  it("mode off → allow, MODE_OFF protected, no emit", async () => {
    const verdict = await evaluateDrugShockActorForRoute({
      clinicId: "c-off",
      sessionId: "s",
      snapshot: snapshotOk(),
      actorUserId: "u",
      actorEmail: "u@e.com",
      category: "shock",
      now: FIXED_NOW,
    });
    expect(verdict).toEqual({ action: "allow", protected: "MODE_OFF" });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("mode shadow + eligible → allow, ALLOWLIST_OK, allow counter", async () => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();
    const verdict = await evaluateDrugShockActorForRoute({
      clinicId: "c-sa",
      sessionId: "s",
      snapshot: snapshotOk(),
      actorUserId: "u",
      actorEmail: "u@e.com",
      category: "shock",
      now: FIXED_NOW,
    });
    expect(verdict).toEqual({ action: "allow", protected: "ALLOWLIST_OK" });
    expect(getMetricsSnapshot().codeBlue.logDrugShockActor.allow).toBe(1);
  });

  it("mode shadow + ineligible → allow, SHADOW_WOULD_HAVE_DENIED, shadow counter + audit", async () => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();
    const verdict = await evaluateDrugShockActorForRoute({
      clinicId: "c-si",
      sessionId: "s",
      snapshot: { ...snapshotOk(), operationalRole: "night_admission_only" },
      actorUserId: "u",
      actorEmail: "u@e.com",
      category: "shock",
      now: FIXED_NOW,
    });
    expect(verdict).toEqual({
      action: "allow",
      protected: "SHADOW_WOULD_HAVE_DENIED",
    });
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.shadowWouldHaveDenied
        .oproleNotInAllowlist,
    ).toBe(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].actionType).toBe(
      "code_blue_log_drug_shock_authority_shadow_denied",
    );
  });

  it("mode enforce + ineligible → deny + enforce counter + denied audit kind (distinct from shadow)", async () => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    const verdict = await evaluateDrugShockActorForRoute({
      clinicId: "c-ei",
      sessionId: "s",
      snapshot: { ...snapshotOk(), operationalRole: "night_admission_only" },
      actorUserId: "u",
      actorEmail: "u@e.com",
      category: "shock",
      now: FIXED_NOW,
    });
    expect(verdict).toEqual({
      action: "deny",
      reason: "OPROLE_NOT_IN_CB_ALLOWLIST",
    });
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.denied.oproleNotInAllowlist,
    ).toBe(1);
    // Shadow counter NOT incremented in enforce mode.
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.shadowWouldHaveDenied
        .oproleNotInAllowlist,
    ).toBe(0);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].actionType).toBe(
      "code_blue_log_drug_shock_authority_denied",
    );
  });

  it("mode enforce + checked-in-no-oprole → deny NO_OPEN_CHECK_IN + enforce counter", async () => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    const verdict = await evaluateDrugShockActorForRoute({
      clinicId: "c-en",
      sessionId: "s",
      snapshot: {
        ...snapshotOk(),
        operationalRole: null,
        reason: "CHECKED_IN_NO_OPROLE",
      },
      actorUserId: "u",
      actorEmail: "u@e.com",
      category: "shock",
      now: FIXED_NOW,
    });
    expect(verdict).toEqual({ action: "deny", reason: "NO_OPEN_CHECK_IN" });
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.denied.noOpenCheckIn,
    ).toBe(1);
  });

  it("mode enforce + Strategy A inactive → allow (mode_inactive bypass)", async () => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    const verdict = await evaluateDrugShockActorForRoute({
      clinicId: "c-esa",
      sessionId: "s",
      snapshot: { ...snapshotOk(), operationalRole: null, reason: "EZSHIFT_NONE" },
      actorUserId: "u",
      actorEmail: "u@e.com",
      category: "shock",
      now: FIXED_NOW,
    });
    expect(verdict).toEqual({
      action: "allow",
      protected: "MODE_INACTIVE_STRATEGY_A",
    });
    // Strategy A clinics are never blocked, even in enforce mode.
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("missing snapshot → allow, FAULT_OPEN_INTERNAL (never strands the route)", async () => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    const verdict = await evaluateDrugShockActorForRoute({
      clinicId: "c-eo",
      sessionId: "s",
      snapshot: null,
      actorUserId: "u",
      actorEmail: "u@e.com",
      category: "shock",
      now: FIXED_NOW,
    });
    expect(verdict).toEqual({
      action: "allow",
      protected: "FAULT_OPEN_INTERNAL",
    });
  });

  it("rate-limiter: enforce-mode same key → counter increments 5×, audit fires once", async () => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    const ineligible = { ...snapshotOk(), operationalRole: "night_admission_only" as const };
    for (let i = 0; i < 5; i++) {
      await evaluateDrugShockActorForRoute({
        clinicId: "c-rate",
        sessionId: "s-rate",
        snapshot: ineligible,
        actorUserId: "u-rate",
        actorEmail: "u@e.com",
        category: "shock",
        now: FIXED_NOW,
      });
    }
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.denied.oproleNotInAllowlist,
    ).toBe(5);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  it("never throws on internal failure (config rejection → fault_open_internal, route continues)", async () => {
    mockGetServerConfigValue.mockRejectedValue(new Error("config blip"));
    delete process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1;
    __resetEnforcementConfigCacheForTests();
    const verdict = await evaluateDrugShockActorForRoute({
      clinicId: "c-x",
      sessionId: "s",
      snapshot: snapshotOk(),
      actorUserId: "u",
      actorEmail: "u@e.com",
      category: "shock",
      now: FIXED_NOW,
    });
    // Config throw → mode resolution falls through to "off" (the
    // resolver's documented behavior) → returns MODE_OFF.
    expect(verdict.action).toBe("allow");
  });
});
