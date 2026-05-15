/**
 * Phase 4 PR 4.1 — Code Blue manager audit-kind registration + emit-and-receive.
 *
 * Asserts that the new audit kinds are wired through `logAudit` with the
 * correct `actionType` strings when the evaluator emits in shadow / enforce /
 * fault-open paths. The `AUTHORITY_OBS_V1` gate is set explicitly for these
 * tests.
 *
 * Audit kinds covered:
 *   - code_blue_manager_authority_shadow_denied (shadow path)
 *   - code_blue_manager_authority_denied (enforce path)
 *   - code_blue_manager_authority_fault_open (fail-open path)
 *
 * `code_blue_initiator_authority_denied` is registered as a kind but emitted
 * only by PR 4.2 wiring — not exercised here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  auditLogs: {},
  eventOutbox: {},
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

import { evaluateCodeBlueManagerAuthority } from "../server/lib/authority/enforcement/code-blue-manager.evaluator.js";
import { resetMetrics } from "../server/lib/metrics.js";
import type {
  CodeBlueManagerContext,
  CodeBlueManagerEnforcementMode,
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

// Audit emitters use module-level rate limiters keyed on
// (kind, clinicId, managerUserId, endpoint). Each test uses a unique
// clinic+manager combination so tests do not dedupe one another's emissions.
let testCounter = 0;
function freshIds(): { clinicId: string; managerUserId: string } {
  testCounter += 1;
  return {
    clinicId: `clinic-${testCounter}`,
    managerUserId: `manager-${testCounter}`,
  };
}

function ctx(
  overrides: Partial<CodeBlueManagerContext> = {},
): CodeBlueManagerContext {
  const { clinicId, managerUserId } = freshIds();
  return {
    clinicId,
    now: FIXED_NOW,
    endpoint: "end",
    managerUserId,
    lookup: { kind: "snapshot", snapshot: snapshot() },
    ...overrides,
  };
}

function modeResolver(mode: CodeBlueManagerEnforcementMode) {
  return async () => mode;
}

beforeEach(() => {
  resetMetrics();
  logAuditMock.mockReset();
  process.env.AUTHORITY_OBS_V1 = "true";
});

afterEach(() => {
  resetMetrics();
  delete process.env.AUTHORITY_OBS_V1;
});

describe("PR 4.1 audit-kind emit — shadow path", () => {
  it("emits code_blue_manager_authority_shadow_denied with reason metadata", async () => {
    const c = ctx({
      lookup: {
        kind: "snapshot",
        snapshot: snapshot({ operationalRole: "night_admission_only" }),
      },
    });
    await evaluateCodeBlueManagerAuthority(c, {
      modeResolver: modeResolver("shadow"),
    });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.actionType).toBe("code_blue_manager_authority_shadow_denied");
    expect(call.clinicId).toBe(c.clinicId);
    expect(call.performedBy).toBe(c.managerUserId);
    expect(call.targetType).toBe("code_blue_manager_authority_decision");
    expect(call.metadata).toMatchObject({
      kind: "shadow_denied",
      reason: "OPROLE_NOT_IN_CB_ALLOWLIST",
      endpoint: "end",
      managerUserId: c.managerUserId,
      severity: "info",
    });
  });

  it("emits shadow_denied for user_missing lookup", async () => {
    await evaluateCodeBlueManagerAuthority(
      ctx({ lookup: { kind: "user_missing" } }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].metadata).toMatchObject({
      reason: "USER_MISSING",
    });
  });
});

describe("PR 4.1 audit-kind emit — enforce path", () => {
  it("emits code_blue_manager_authority_denied with reason metadata", async () => {
    await evaluateCodeBlueManagerAuthority(
      ctx({ lookup: { kind: "cross_clinic" } }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.actionType).toBe("code_blue_manager_authority_denied");
    expect(call.metadata).toMatchObject({
      kind: "denied",
      reason: "MANAGER_CROSS_CLINIC",
      endpoint: "end",
      severity: "info",
    });
  });
});

describe("PR 4.1 audit-kind emit — fail-open path (severity=high)", () => {
  it("emits code_blue_manager_authority_fault_open with severity=high in shadow mode", async () => {
    await evaluateCodeBlueManagerAuthority(
      ctx({ lookup: { kind: "resolver_fault" } }),
      { modeResolver: modeResolver("shadow") },
    );
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.actionType).toBe("code_blue_manager_authority_fault_open");
    expect(call.metadata).toMatchObject({
      kind: "fault_open",
      severity: "high",
    });
  });

  it("emits code_blue_manager_authority_fault_open with severity=high in enforce mode", async () => {
    await evaluateCodeBlueManagerAuthority(
      ctx({ lookup: { kind: "resolver_fault" } }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].actionType).toBe(
      "code_blue_manager_authority_fault_open",
    );
    expect(logAuditMock.mock.calls[0][0].metadata.severity).toBe("high");
  });
});

describe("PR 4.1 audit-kind emit — gating", () => {
  it("does NOT emit when AUTHORITY_OBS_V1 is unset", async () => {
    delete process.env.AUTHORITY_OBS_V1;
    await evaluateCodeBlueManagerAuthority(
      ctx({ lookup: { kind: "user_missing" } }),
      { modeResolver: modeResolver("enforce") },
    );
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("does NOT emit in mode 'off' even with AUTHORITY_OBS_V1=true", async () => {
    await evaluateCodeBlueManagerAuthority(
      ctx({ lookup: { kind: "user_missing" } }),
      { modeResolver: modeResolver("off") },
    );
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("PR 4.1 audit-kind type-level registration", () => {
  // Compile-time: import the type and reference each new audit kind as an
  // assignment. If any kind is missing from AuditActionType, this file will
  // not type-check.
  it("AuditActionType union includes all four new Code Blue kinds", async () => {
    const mod = await vi.importActual<typeof import("../server/lib/audit.js")>(
      "../server/lib/audit.js",
    );
    type AuditActionType = Parameters<typeof mod.logAudit>[0]["actionType"];
    const kinds: AuditActionType[] = [
      "code_blue_initiator_authority_denied",
      "code_blue_manager_authority_shadow_denied",
      "code_blue_manager_authority_denied",
      "code_blue_manager_authority_fault_open",
    ];
    expect(kinds.length).toBe(4);
  });
});
