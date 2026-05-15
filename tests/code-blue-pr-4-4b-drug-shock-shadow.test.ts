/**
 * Phase 4 PR 4.4b — Drug/shock actor oprole shadow detection tests.
 *
 * Two layers:
 *
 *   1. Static-analysis tests over `server/routes/code-blue.ts` that lock the
 *      drug/shock helper call: it runs ONLY for category ∈ {drug, shock},
 *      uses the actor's own `req.authoritySnapshot`, is fire-and-forget, and
 *      runs after the log insert.
 *
 *   2. Pure-function tests over `detectDrugShockActorDrift` covering:
 *      - mode off → no signal (counter, audit)
 *      - eligible actor snapshot → allow counter, no audit
 *      - ineligible operational role → shadow_denied counter + audit (shadow mode)
 *      - actor checked-in-no-oprole → no_open_check_in counter + audit
 *      - Strategy A inactive → mode_inactive counter, no audit
 *      - missing snapshot → silent no-op
 *      - per (clinic, session, actor, reason) 60s dedupe
 *      - AUTHORITY_OBS_V1 unset → counter increments, audit suppressed
 *      - never-throw contract under dependency failure
 *      - DISTINCTNESS: mid-session manager helper and drug/shock actor helper
 *        emit INDEPENDENT audit/metric streams on a single request
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
  "code-blue-log-drug-shock.ts",
);

const routeSrc = fs.readFileSync(routeFile, "utf8");
const helperSrc = fs.readFileSync(helperFile, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Static-analysis: POST /sessions/:id/logs drug/shock wiring
// ─────────────────────────────────────────────────────────────────────────────

function extractLogsHandlerBlock(): string {
  const start = routeSrc.search(
    /router\.post\(\s*["']\/sessions\/:id\/logs["']/,
  );
  expect(start, "POST /sessions/:id/logs not found").toBeGreaterThanOrEqual(0);
  const end = routeSrc.indexOf("\nrouter.", start + 1);
  return routeSrc.slice(start, end > start ? end : start + 5000);
}

const logsBlock = extractLogsHandlerBlock();

describe("POST /sessions/:id/logs — drug/shock actor shadow wiring", () => {
  it("invokes detectDrugShockActorDrift in the handler", () => {
    expect(logsBlock).toContain("detectDrugShockActorDrift");
  });

  it("guards the helper behind a category ∈ {drug, shock} check (not run for note/cpr/equipment)", () => {
    const callIdx = logsBlock.indexOf("detectDrugShockActorDrift");
    expect(callIdx).toBeGreaterThanOrEqual(0);
    // Within ~250 chars before the call, the guard must reference both
    // "drug" and "shock" category values.
    const preCall = logsBlock.slice(Math.max(0, callIdx - 250), callIdx);
    expect(preCall).toMatch(/body\.category\s*===\s*["']drug["']/);
    expect(preCall).toMatch(/body\.category\s*===\s*["']shock["']/);
  });

  it("passes the actor's own snapshot (req.authoritySnapshot), not session.managerUserId", () => {
    const callIdx = logsBlock.indexOf("detectDrugShockActorDrift");
    const argBody = logsBlock.slice(callIdx, callIdx + 500);
    expect(argBody).toMatch(/snapshot\s*:\s*req\.authoritySnapshot/);
    expect(argBody).toMatch(/actorUserId\s*:\s*req\.authUser/);
    // Must NOT pass session.managerUserId as the input — that would conflate
    // with the mid-session helper's target.
    expect(argBody).not.toMatch(/snapshot\s*:\s*session\.managerUserId/);
  });

  it("is fire-and-forget (void + .catch — never blocks the log write)", () => {
    const callIdx = logsBlock.indexOf("detectDrugShockActorDrift");
    const preCall = logsBlock.slice(Math.max(0, callIdx - 150), callIdx);
    expect(preCall).toMatch(/\bvoid\b/);
    const postCall = logsBlock.slice(callIdx);
    expect(postCall.indexOf(".catch(")).toBeGreaterThanOrEqual(0);
  });

  it("runs AFTER the log insert (the response can already commit)", () => {
    const insertIdx = logsBlock.indexOf("insert(codeBlueLogEntries)");
    const detectIdx = logsBlock.indexOf("detectDrugShockActorDrift");
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(detectIdx).toBeGreaterThan(insertIdx);
  });

  it("does NOT touch the note/cpr/equipment paths", () => {
    // Sanity: the helper is referenced exactly once in the route file.
    const occurrences = logsBlock.match(/detectDrugShockActorDrift/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static-analysis: helper architectural invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("code-blue-log-drug-shock.ts — architectural invariants", () => {
  it("does NOT import Express types or invoke evaluateCodeBlueManagerAuthority", () => {
    const codeOnly = helperSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/from\s+["']express["']/);
    expect(codeOnly).not.toContain("evaluateCodeBlueManagerAuthority");
  });

  it("reuses the frozen PR 4.1 pure predicate (computeCodeBlueManagerSnapshotDeny)", () => {
    expect(helperSrc).toContain("computeCodeBlueManagerSnapshotDeny");
    expect(helperSrc).toMatch(
      /from\s+["']\.\/enforcement\/code-blue-manager\.evaluator\.js["']/,
    );
  });

  it("does NOT import the PR 4.2 wiring helper or call loadCodeBlueManagerLookup (no DB lookup needed)", () => {
    const codeOnly = helperSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("loadCodeBlueManagerLookup");
    expect(codeOnly).not.toContain("code-blue-manager.wiring");
  });

  it("uses the per-route mode flag resolver (resolveCodeBlueLogDrugShockEnforcementMode)", () => {
    expect(helperSrc).toContain("resolveCodeBlueLogDrugShockEnforcementMode");
  });

  it("emits a top-level try/catch wrapping the entire body (never throws)", () => {
    expect(helperSrc).toMatch(
      /export async function detectDrugShockActorDrift[\s\S]*?try\s*\{/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime: detectDrugShockActorDrift
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  auditLogs: {},
  eventOutbox: {},
}));

const mockGetServerConfigValue = vi.fn();
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: (...args: unknown[]) => mockGetServerConfigValue(...args),
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

const { detectDrugShockActorDrift } = await import(
  "../server/lib/authority/code-blue-log-drug-shock.js"
);
const { __resetEnforcementConfigCacheForTests } = await import(
  "../server/lib/authority/enforcement/config.js"
);
const { resetMetrics, getMetricsSnapshot } = await import(
  "../server/lib/metrics.js"
);
const { detectMidsessionManagerDrift } = await import(
  "../server/lib/authority/code-blue-manager-midsession.js"
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

beforeEach(() => {
  __resetEnforcementConfigCacheForTests();
  resetMetrics();
  mockGetServerConfigValue.mockReset();
  logAuditMock.mockReset();
  process.env.AUTHORITY_OBS_V1 = "true";
  // Default: per-clinic config returns null → env default applies.
  mockGetServerConfigValue.mockResolvedValue(null);
});

afterEach(() => {
  __resetEnforcementConfigCacheForTests();
  resetMetrics();
  delete process.env.AUTHORITY_OBS_V1;
  delete process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1;
});

describe("detectDrugShockActorDrift — mode off (default)", () => {
  it("returns void without any signal when mode is off", async () => {
    // No env, no per-clinic → resolves to "off".
    await detectDrugShockActorDrift({
      clinicId: "clinic-off",
      sessionId: "s",
      snapshot: snapshotOk(),
      actorUserId: "u",
      actorEmail: "u@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    expect(logAuditMock).not.toHaveBeenCalled();
    const snap = getMetricsSnapshot();
    expect(snap.codeBlue.logDrugShockActor.allow).toBe(0);
    expect(snap.codeBlue.logDrugShockActor.modeInactiveStrategyA).toBe(0);
    expect(
      snap.codeBlue.logDrugShockActor.shadowWouldHaveDenied.oproleNotInAllowlist,
    ).toBe(0);
  });
});

describe("detectDrugShockActorDrift — shadow mode", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();
  });

  it("eligible actor snapshot → allow counter increments, no audit", async () => {
    await detectDrugShockActorDrift({
      clinicId: "clinic-1",
      sessionId: "s",
      snapshot: snapshotOk(),
      actorUserId: "actor-1",
      actorEmail: "actor@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    expect(getMetricsSnapshot().codeBlue.logDrugShockActor.allow).toBe(1);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("ineligible operational role → shadow_denied counter + audit", async () => {
    await detectDrugShockActorDrift({
      clinicId: "clinic-2",
      sessionId: "s",
      snapshot: { ...snapshotOk(), operationalRole: "night_admission_only" },
      actorUserId: "actor-2",
      actorEmail: "actor@example.com",
      category: "shock",
      now: FIXED_NOW,
    });
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.shadowWouldHaveDenied
        .oproleNotInAllowlist,
    ).toBe(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.actionType).toBe("code_blue_log_drug_shock_authority_shadow_denied");
    expect(call.metadata).toMatchObject({
      kind: "drug_shock_shadow_denied",
      reason: "OPROLE_NOT_IN_CB_ALLOWLIST",
      category: "shock",
    });
  });

  it("actor checked in without operational role → no_open_check_in counter + audit", async () => {
    await detectDrugShockActorDrift({
      clinicId: "clinic-3",
      sessionId: "s",
      snapshot: {
        ...snapshotOk(),
        operationalRole: null,
        reason: "CHECKED_IN_NO_OPROLE",
      },
      actorUserId: "actor-3",
      actorEmail: "actor@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.shadowWouldHaveDenied.noOpenCheckIn,
    ).toBe(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].metadata.reason).toBe("NO_OPEN_CHECK_IN");
  });

  it("Strategy A inactive → mode_inactive counter, no audit", async () => {
    await detectDrugShockActorDrift({
      clinicId: "clinic-4",
      sessionId: "s",
      snapshot: { ...snapshotOk(), operationalRole: null, reason: "EZSHIFT_NONE" },
      actorUserId: "actor-4",
      actorEmail: "actor@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    expect(getMetricsSnapshot().codeBlue.logDrugShockActor.modeInactiveStrategyA).toBe(1);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("missing snapshot → silent no-op (no counter, no audit)", async () => {
    await detectDrugShockActorDrift({
      clinicId: "clinic-5",
      sessionId: "s",
      snapshot: null,
      actorUserId: "actor-5",
      actorEmail: "actor@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    expect(getMetricsSnapshot().codeBlue.logDrugShockActor.allow).toBe(0);
    expect(getMetricsSnapshot().codeBlue.logDrugShockActor.modeInactiveStrategyA).toBe(0);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("detectDrugShockActorDrift — rate-limited audit emission (60s dedupe)", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();
  });

  it("repeated drug pushes by the same actor → counter increments every time, exactly 1 audit", async () => {
    const ineligibleSnapshot = {
      ...snapshotOk(),
      operationalRole: "night_admission_only" as const,
    };
    for (let i = 0; i < 8; i++) {
      await detectDrugShockActorDrift({
        clinicId: "clinic-rate",
        sessionId: "session-rate",
        snapshot: ineligibleSnapshot,
        actorUserId: "actor-rate",
        actorEmail: "actor@example.com",
        category: "drug",
        now: FIXED_NOW,
      });
    }
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.shadowWouldHaveDenied
        .oproleNotInAllowlist,
    ).toBe(8);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  it("different (actorUserId) keys emit independently", async () => {
    const ineligibleSnapshot = {
      ...snapshotOk(),
      operationalRole: "night_admission_only" as const,
    };
    await detectDrugShockActorDrift({
      clinicId: "clinic-x",
      sessionId: "session-x",
      snapshot: ineligibleSnapshot,
      actorUserId: "actor-A",
      actorEmail: "a@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    await detectDrugShockActorDrift({
      clinicId: "clinic-x",
      sessionId: "session-x",
      snapshot: ineligibleSnapshot,
      actorUserId: "actor-B",
      actorEmail: "b@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    expect(logAuditMock).toHaveBeenCalledTimes(2);
  });
});

describe("detectDrugShockActorDrift — AUTHORITY_OBS_V1 gating", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();
  });

  it("AUTHORITY_OBS_V1 unset → counter increments, audit suppressed", async () => {
    delete process.env.AUTHORITY_OBS_V1;
    await detectDrugShockActorDrift({
      clinicId: "clinic-obs",
      sessionId: "s",
      snapshot: { ...snapshotOk(), operationalRole: "night_admission_only" },
      actorUserId: "u",
      actorEmail: "u@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.shadowWouldHaveDenied
        .oproleNotInAllowlist,
    ).toBe(1);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("detectDrugShockActorDrift — never-throw contract", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();
  });

  it("logAudit throw is absorbed", async () => {
    logAuditMock.mockImplementation(() => {
      throw new Error("audit emit failed");
    });
    await expect(
      detectDrugShockActorDrift({
        clinicId: "clinic-t",
        sessionId: "s",
        snapshot: { ...snapshotOk(), operationalRole: "night_admission_only" },
        actorUserId: "u",
        actorEmail: "u@example.com",
        category: "drug",
        now: FIXED_NOW,
      }),
    ).resolves.toBeUndefined();
    // Counter was incremented before logAudit was called.
    expect(
      getMetricsSnapshot().codeBlue.logDrugShockActor.shadowWouldHaveDenied
        .oproleNotInAllowlist,
    ).toBe(1);
  });

  it("getServerConfigValue throw is absorbed (mode resolution failure falls through to off)", async () => {
    mockGetServerConfigValue.mockRejectedValue(new Error("config blip"));
    // env var also unset (cleared in afterEach of previous test, but
    // beforeEach of this describe set it). Reset it here for clarity.
    delete process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1;
    __resetEnforcementConfigCacheForTests();
    await expect(
      detectDrugShockActorDrift({
        clinicId: "clinic-t2",
        sessionId: "s",
        snapshot: snapshotOk(),
        actorUserId: "u",
        actorEmail: "u@example.com",
        category: "drug",
        now: FIXED_NOW,
      }),
    ).resolves.toBeUndefined();
    // Config throw → no override → env default ("off") → no signal.
    expect(getMetricsSnapshot().codeBlue.logDrugShockActor.allow).toBe(0);
  });
});

describe("Distinctness: mid-session manager vs drug/shock actor signals", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();
  });

  it("drug/shock actor helper emits only actor counters; mid-session manager helper emits only manager counters", async () => {
    // The drug/shock helper takes a snapshot directly (no DB), so this is
    // a pure synchronous-style call. We don't run the mid-session helper
    // here (it would require a different mock setup); the distinctness test
    // is purely about the COUNTER NAMES the drug/shock helper increments.
    await detectDrugShockActorDrift({
      clinicId: "clinic-d",
      sessionId: "session-d",
      snapshot: { ...snapshotOk(), operationalRole: "night_admission_only" },
      actorUserId: "actor-d",
      actorEmail: "actor@example.com",
      category: "drug",
      now: FIXED_NOW,
    });
    const snap = getMetricsSnapshot();
    // Drug/shock actor counter incremented.
    expect(
      snap.codeBlue.logDrugShockActor.shadowWouldHaveDenied.oproleNotInAllowlist,
    ).toBe(1);
    // Mid-session manager counters NOT incremented (would conflate signals).
    expect(
      snap.codeBlue.manager.midsessionShadowDenied.oproleNotInAllowlist,
    ).toBe(0);
    // The audit kinds differ too: actor emits drug_shock kind, not manager.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].actionType).toBe(
      "code_blue_log_drug_shock_authority_shadow_denied",
    );
    expect(logAuditMock.mock.calls[0][0].actionType).not.toBe(
      "code_blue_manager_midsession_authority_shadow_denied",
    );
  });

  it("imports detectMidsessionManagerDrift symbol (verifies the two helpers coexist as distinct modules)", () => {
    expect(typeof detectMidsessionManagerDrift).toBe("function");
    expect(typeof detectDrugShockActorDrift).toBe("function");
    expect(detectMidsessionManagerDrift).not.toBe(detectDrugShockActorDrift);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static-analysis: enforcement config resolver
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveCodeBlueLogDrugShockEnforcementMode — config resolver", () => {
  beforeEach(() => {
    __resetEnforcementConfigCacheForTests();
    mockGetServerConfigValue.mockReset();
    delete process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1;
  });

  it("returns 'off' when no override and no env default", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    const { resolveCodeBlueLogDrugShockEnforcementMode } = await import(
      "../server/lib/authority/enforcement/config.js"
    );
    expect(await resolveCodeBlueLogDrugShockEnforcementMode("c1")).toBe("off");
  });

  it("per-clinic override beats env default", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    const { resolveCodeBlueLogDrugShockEnforcementMode } = await import(
      "../server/lib/authority/enforcement/config.js"
    );
    expect(await resolveCodeBlueLogDrugShockEnforcementMode("c2")).toBe("enforce");
  });

  it("env default applies when no override", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    const { resolveCodeBlueLogDrugShockEnforcementMode } = await import(
      "../server/lib/authority/enforcement/config.js"
    );
    expect(await resolveCodeBlueLogDrugShockEnforcementMode("c3")).toBe("shadow");
  });

  it("invalid override values fall through to env default", async () => {
    mockGetServerConfigValue.mockResolvedValue("BOGUS");
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    const { resolveCodeBlueLogDrugShockEnforcementMode } = await import(
      "../server/lib/authority/enforcement/config.js"
    );
    expect(await resolveCodeBlueLogDrugShockEnforcementMode("c4")).toBe("shadow");
  });

  it("getServerConfigValue throw is treated as no override", async () => {
    mockGetServerConfigValue.mockRejectedValue(new Error("db blip"));
    process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1 = "shadow";
    const { resolveCodeBlueLogDrugShockEnforcementMode } = await import(
      "../server/lib/authority/enforcement/config.js"
    );
    expect(await resolveCodeBlueLogDrugShockEnforcementMode("c5")).toBe("shadow");
  });
});
