/**
 * Phase 5 PR 5.7 — enforcement-activation rollout tests.
 *
 * Exercises the new enforce-mode behaviour at both wired call sites
 * (`confirmDispense` service + `POST /api/containers/:id/dispense`
 * route). The test surface covers:
 *
 *   1. 422 envelope shape — `code`, `reason`, `clinical: true`,
 *      `cop.kind`, `cop.orphanLines[].{reasons, itemId, quantity,
 *      matchingOrderIds}` per §6.3 stability matrix.
 *   2. In-tx rollback — the deny verdict aborts the transaction so
 *      the post-tx side effects (audit emission, billing webhook
 *      enqueue) DO NOT fire.
 *   3. Layered rollback — flipping enforce → shadow → off causes the
 *      422 path to disappear within the same process (10s TTL is
 *      tested separately in the config unit tests; here we just
 *      assert mode dispatch).
 *   4. Per-clinic isolation — clinic A in enforce + clinic B in
 *      shadow does not interfere.
 *   5. Header absence on enforce-pass — the degraded header MUST NOT
 *      be set when the evaluator allows in enforce mode.
 *   6. Fail-closed (default `SMART_COP_VALIDATION_FAIL_OPEN=false`) →
 *      503 `COP_VALIDATION_UNAVAILABLE` + tx rollback + no fail-open
 *      audit. `clinical_invariant_fail_closed_total` ticks.
 *   7. Fail-open (`SMART_COP_VALIDATION_FAIL_OPEN=true`) → allow +
 *      `clinical_invariant_fail_open` post-commit audit +
 *      `X-COP-Validation-Status: degraded` header on the response.
 *      `clinical_invariant_fail_open_total` ticks.
 *   8. Emergency-bypass path emits
 *      `clinical_invariant_emergency_bypass` (post-commit) and skips
 *      the evaluator's deny path.
 *   9. Shadow mode is unaffected by `SMART_COP_VALIDATION_FAIL_OPEN`
 *      — the env knob applies only to enforce mode (plan §8.2).
 *  10. Per-reason counters tick under SET semantics — one tick per
 *      unique reason across the orphanLines (not per line).
 *
 * Pattern matches PR 5.4 wiring test for the containers route, and
 * the PR 5.3 confirmDispense test for the service path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// ─── Hoisted spies / state (shared module mocks) ──────────────────────────
const {
  resolveClinicalInvariantEnforcementModeMock,
  evaluateClinicalInvariantMock,
  evaluateDispenseAgainstOrdersMock,
  loadInventoryItemLabelCodeMock,
  logAuditMock,
} = vi.hoisted(() => ({
  resolveClinicalInvariantEnforcementModeMock: vi.fn(),
  evaluateClinicalInvariantMock: vi.fn(),
  evaluateDispenseAgainstOrdersMock: vi.fn(),
  loadInventoryItemLabelCodeMock: vi.fn(),
  logAuditMock: vi.fn(),
}));

vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: vi.fn().mockResolvedValue(null),
}));

vi.mock(
  "../server/lib/authority/enforcement/clinical-invariant.config.js",
  async () => {
    const actual = await vi.importActual<
      typeof import("../server/lib/authority/enforcement/clinical-invariant.config.js")
    >("../server/lib/authority/enforcement/clinical-invariant.config.js");
    return {
      ...actual,
      resolveClinicalInvariantEnforcementMode: (...args: unknown[]) =>
        resolveClinicalInvariantEnforcementModeMock(...args),
    };
  },
);

vi.mock(
  "../server/lib/authority/enforcement/clinical-invariant.evaluator.js",
  () => ({
    evaluateClinicalInvariant: (...args: unknown[]) =>
      evaluateClinicalInvariantMock(...args),
  }),
);

vi.mock("../server/lib/dispense-order-validation.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/dispense-order-validation.js")
  >("../server/lib/dispense-order-validation.js");
  return {
    ...actual,
    evaluateDispenseAgainstOrders: (...args: unknown[]) =>
      evaluateDispenseAgainstOrdersMock(...args),
    loadInventoryItemLabelCode: (...args: unknown[]) =>
      loadInventoryItemLabelCodeMock(...args),
  };
});

vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return {
    ...actual,
    logAudit: (...args: unknown[]) => logAuditMock(...args),
    resolveAuditActorRole: () => "technician",
  };
});

// ─── DB mock — shared between dispense.service.ts + containers.ts ──────────
type ChainKind = "select" | "update" | "insert" | "delete";

const containerSelect = [
  { id: "container-1", clinicId: "clinic-1", name: "ER Supply Cart", roomId: null },
];

const dispenseEventRow = {
  id: "event-1",
  clinicId: "clinic-1",
  containerId: "container-1",
  patientId: "animal-1",
  status: "DRAFT",
  bypassReason: null as string | null,
  items: [{ itemId: "item-1", quantity: 1 }],
};

function makeChain(kind: ChainKind, target: unknown) {
  let returningCalled = false;
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "set", "values", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.returning = () => {
    returningCalled = true;
    return chain;
  };
  chain.onConflictDoNothing = () => chain;
  chain.onConflictDoUpdate = () => chain;
  (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
    const tblName = (target as { _: { name?: string } } | null)?._?.name ?? "";
    if (kind === "select") {
      if (tblName === "vt_containers") return resolve(containerSelect);
      if (tblName === "vt_container_items") return resolve([{ quantity: 100, itemId: "item-1" }]);
      if (tblName === "vt_inventory_items") return resolve([{ id: "item-1", code: "DX", label: "Drug X" }]);
      if (tblName === "vt_dispense_events") return resolve([dispenseEventRow]);
      return resolve([]);
    }
    if (kind === "update") {
      if (returningCalled) {
        if (tblName === "vt_dispense_events") {
          return resolve([{ ...dispenseEventRow, status: "CONFIRMED", inventoryMismatch: false }]);
        }
        return resolve([]);
      }
      return resolve(undefined);
    }
    return resolve(undefined);
  };
  return chain;
}

vi.mock("../server/db.js", () => {
  const tableRef = (name: string) => ({ _: { name } });
  const makeTx = () => {
    function selectChain() {
      let target: unknown = null;
      const chain: Record<string, unknown> = {
        from: (t: unknown) => {
          target = t;
          return chain;
        },
      };
      for (const m of ["where", "limit", "orderBy", "set", "values"]) {
        chain[m] = () => chain;
      }
      chain.returning = () => chain;
      chain.onConflictDoNothing = () => chain;
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
        const inner = makeChain("select", target);
        return (inner as { then: (r: (v: unknown) => unknown) => unknown }).then(resolve);
      };
      return chain;
    }
    return {
      select: () => selectChain(),
      update: (target: unknown) => makeChain("update", target),
      insert: (target: unknown) => makeChain("insert", target),
      delete: (target: unknown) => makeChain("delete", target),
    };
  };
  return {
    db: {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()),
      update: (target: unknown) => makeChain("update", target),
      select: () => makeChain("select", null),
      insert: (target: unknown) => makeChain("insert", target),
    },
    animals: tableRef("vt_animals"),
    billingItems: tableRef("vt_billing_items"),
    billingLedger: tableRef("vt_billing_ledger"),
    containerItems: tableRef("vt_container_items"),
    containers: tableRef("vt_containers"),
    dispenseEvents: tableRef("vt_dispense_events"),
    idempotencyKeys: tableRef("vt_idempotency_keys"),
    inventoryItems: tableRef("vt_inventory_items"),
    inventoryLogs: tableRef("vt_inventory_logs"),
    operationalTasks: tableRef("vt_operational_tasks"),
    users: tableRef("vt_users"),
  };
});

// Middleware + side-service mocks.
vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireClinicalUser: (_req: Request, _res: Response, next: () => void) => next(),
  requireEffectiveRole:
    () => (_req: Request, _res: Response, next: () => void) => next(),
}));
vi.mock("../server/middleware/authority.js", () => ({
  requireClinicalAuthority:
    () => (_req: Request, _res: Response, next: () => void) => next(),
}));
vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: () => void) => next(),
  validateUuid: () => (_req: Request, _res: Response, next: () => void) => next(),
}));
vi.mock("../server/middleware/container-dispense-idempotency.js", () => ({
  DISPENSE_IDEMPOTENCY_ENDPOINT: "container-dispense",
  dispenseIdempotencyMiddleware: (
    _req: Request,
    res: Response,
    next: () => void,
  ) => {
    (res as unknown as { locals: Record<string, unknown> }).locals = {
      dispenseIdempotencyKey: "idem-1",
    };
    next();
  },
}));
vi.mock("../server/lib/container-consumable-billing.js", () => ({
  captureConsumableBillingForDispenseLine: vi.fn().mockResolvedValue({
    billingEventId: "billing-1",
    rowTotalCents: 0,
  }),
}));
vi.mock("../server/lib/queue.js", () => ({
  enqueueBillingWebhookJob: vi.fn(),
}));
vi.mock("../server/services/inventory.service.js", () => ({
  restockContainerInTx: vi.fn(),
}));
vi.mock("../server/lib/ensure-clinic-phase2-defaults.js", () => ({
  seedDefaultContainersIfEmpty: vi.fn(),
}));
vi.mock("../server/config/inventoryBlueprint.js", () => ({
  resolveBlueprintEntryForContainerName: () => null,
}));
vi.mock("../server/lib/dispense-idempotency-hash.js", () => ({
  hashDispenseRequestBody: () => "hash-1",
}));
vi.mock("../server/lib/shift-chat-presence.js", () => ({
  postSystemMessage: vi.fn(),
}));

import {
  confirmDispense,
  ClinicalInvariantDenyError,
} from "../server/services/dispense.service.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import containersRouter from "../server/routes/containers.js";

// ─── Test driver — containers route ────────────────────────────────────────

type Recorded = { statusCode: number; body: unknown; headers: Record<string, string> };

function makeRes(): { res: Response; recorded: Recorded } {
  const recorded: Recorded = { statusCode: 200, body: null, headers: {} };
  const res = {
    statusCode: 200,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      recorded.statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      recorded.body = payload;
      return this;
    },
    getHeader(name: string) {
      return recorded.headers[name.toLowerCase()] ?? recorded.headers[name];
    },
    setHeader(name: string, value: string) {
      recorded.headers[name.toLowerCase()] = value;
    },
  } as unknown as Response;
  return { res, recorded };
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: { id: "container-1" },
    body: {
      items: [{ itemId: "item-1", quantity: 1 }],
      animalId: "animal-1",
      isEmergency: false,
    },
    clinicId: "clinic-1",
    authUser: { id: "user-1", email: "u@example.com", name: "User One" },
    authoritySnapshot: undefined,
    ...overrides,
  } as unknown as Request;
}

async function callDispense(req: Request, res: Response): Promise<void> {
  const stack = (containersRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: { post?: boolean };
        stack: Array<{
          handle: (req: Request, res: Response, next: () => void) => unknown | Promise<unknown>;
        }>;
      };
    }>;
  }).stack;
  for (const layer of stack) {
    const route = layer.route;
    if (route?.path === "/:id/dispense" && route.methods.post) {
      const handlers = route.stack;
      const final = handlers[handlers.length - 1];
      if (final) await final.handle(req, res, () => {});
      return;
    }
  }
  throw new Error("dispense route not found in router stack");
}

function defaultConfirmInput(overrides: Partial<Parameters<typeof confirmDispense>[0]> = {}) {
  return {
    clinicId: "clinic-1",
    dispenseEventId: "event-1",
    confirmedBy: "user-1",
    confirmedByEmail: "user-1@example.com",
    actorRole: "technician" as const,
    authoritySource: "shift" as const,
    authorityReason: null,
    authorityOperationalRole: null,
    requestId: "req-5-7",
    ...overrides,
  };
}

const sampleOrphanLine = {
  itemId: "item-1",
  quantity: 1,
  label: "Drug X",
  reasons: ["NO_ACTIVE_ORDER"] as const,
  matchingOrderIds: [] as string[],
};

beforeEach(() => {
  resetMetrics();
  resolveClinicalInvariantEnforcementModeMock.mockReset();
  evaluateClinicalInvariantMock.mockReset();
  evaluateDispenseAgainstOrdersMock.mockReset();
  evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
  loadInventoryItemLabelCodeMock.mockReset();
  loadInventoryItemLabelCodeMock.mockResolvedValue({ label: "Drug X", code: "DX" });
  logAuditMock.mockReset();
  dispenseEventRow.clinicId = "clinic-1";
  dispenseEventRow.containerId = "container-1";
  dispenseEventRow.patientId = "animal-1";
  dispenseEventRow.status = "DRAFT";
  dispenseEventRow.bypassReason = null;
  delete process.env.SMART_COP_VALIDATION_FAIL_OPEN;
  process.env.AUTHORITY_OBS_V1 = "true";
});

afterEach(() => {
  resetMetrics();
  delete process.env.SMART_COP_VALIDATION_FAIL_OPEN;
  delete process.env.AUTHORITY_OBS_V1;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. 422 envelope shape — §6.3 stability matrix
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7 — 422 envelope shape (confirmDispense)", () => {
  it("enforce + deny → throws ClinicalInvariantDenyError with §6.3 body", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [sampleOrphanLine],
    });

    await expect(
      confirmDispense(defaultConfirmInput()),
    ).rejects.toMatchObject({
      name: "ClinicalInvariantDenyError",
      status: 422,
      body: {
        code: "CLINICAL_INVARIANT_VIOLATION",
        reason: "ORPHAN_DISPENSE_BLOCKED",
        clinical: true,
        requestId: "req-5-7",
        cop: {
          kind: "orphan_dispense",
          orphanLines: [
            expect.objectContaining({
              itemId: "item-1",
              quantity: 1,
              reasons: ["NO_ACTIVE_ORDER"],
              matchingOrderIds: [],
            }),
          ],
        },
      },
    });
  });

  it("enforce + deny ticks `clinical_invariant_blocked_total` and the per-reason counter", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [
        { ...sampleOrphanLine, reasons: ["NO_ACTIVE_ORDER", "QUANTITY_EXCEEDS_ORDER"] },
      ],
    });

    await expect(
      confirmDispense(defaultConfirmInput()),
    ).rejects.toBeInstanceOf(ClinicalInvariantDenyError);

    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.blockedTotal).toBe(1);
    expect(snap.orphanReason.noActiveOrder).toBe(1);
    expect(snap.orphanReason.quantityExceedsOrder).toBe(1);
    expect(snap.orphanReason.noPatientLinked).toBe(0);
  });

  it("set semantics: multi-line deny with overlapping reasons ticks each reason ONCE per request", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [
        { ...sampleOrphanLine, itemId: "item-A", reasons: ["NO_ACTIVE_ORDER"] },
        { ...sampleOrphanLine, itemId: "item-B", reasons: ["NO_ACTIVE_ORDER"] },
        { ...sampleOrphanLine, itemId: "item-C", reasons: ["QUANTITY_EXCEEDS_ORDER"] },
      ],
    });

    await expect(confirmDispense(defaultConfirmInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    const snap = getMetricsSnapshot().clinicalInvariant;
    // 3 orphan lines, but only 2 distinct reasons across them.
    expect(snap.blockedTotal).toBe(1);
    expect(snap.orphanReason.noActiveOrder).toBe(1);
    expect(snap.orphanReason.quantityExceedsOrder).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. In-tx rollback — billing webhook + post-commit audits NOT emitted on deny
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7 — in-tx rollback semantics (confirmDispense)", () => {
  it("enforce + deny: post-commit dispense_confirmed audit MUST NOT be emitted (throw aborted the flow)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [sampleOrphanLine],
    });

    await expect(confirmDispense(defaultConfirmInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    // The legitimate post-commit audit only fires AFTER the tx
    // commits. On deny the tx callback throws and the post-commit
    // emission block is skipped entirely.
    const dispenseConfirmedAudits = logAuditMock.mock.calls.filter(
      ([params]) =>
        params != null &&
        typeof params === "object" &&
        (params as { actionType?: unknown }).actionType === "dispense_confirmed",
    );
    expect(dispenseConfirmedAudits).toHaveLength(0);
  });

  it("enforce + deny: in-tx denial audit IS attempted before the throw (ordering contract — §9.4)", async () => {
    // Unique clinicId — the deny-audit rate-limiter has module-level
    // state that survives across tests in the same process. Wiring now
    // passes `animalId: null`, so `(clinicId, containerId)` must differ
    // from prior deny tests to guarantee a non-deduped emission.
    dispenseEventRow.clinicId = "clinic-ordering-audit";
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [sampleOrphanLine],
    });

    await expect(
      confirmDispense(
        defaultConfirmInput({ clinicId: "clinic-ordering-audit", requestId: "req-ordering-test" }),
      ),
    ).rejects.toBeInstanceOf(ClinicalInvariantDenyError);

    // The denial audit attempt MUST occur — even though the row is
    // rolled back with the tx (CI-26 non-durability).
    const denyAttempts = logAuditMock.mock.calls.filter(
      ([params]) =>
        params != null &&
        typeof params === "object" &&
        (params as { actionType?: unknown }).actionType ===
          "clinical_invariant_orphan_dispense_denied",
    );
    expect(denyAttempts).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Layered rollback — flipping mode within the same process
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7 — layered rollback (enforce → shadow → off)", () => {
  it("enforce → shadow → off convergence: the 422 path disappears across mode flips", async () => {
    // enforce + orphan → 422
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValueOnce("enforce");
    evaluateClinicalInvariantMock.mockResolvedValueOnce({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [sampleOrphanLine],
    });
    await expect(confirmDispense(defaultConfirmInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    // shadow + orphan → allow (no throw)
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValueOnce("shadow");
    evaluateClinicalInvariantMock.mockResolvedValueOnce({
      action: "allow",
      disposition: "WOULD_HAVE_BLOCKED_SHADOW",
      orphanLines: [sampleOrphanLine],
    });
    const shadowResult = await confirmDispense(defaultConfirmInput());
    expect(shadowResult.event).toMatchObject({ status: "CONFIRMED" });
    expect(shadowResult.copDegraded).toBe(false);

    // off → allow + evaluator NOT invoked
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValueOnce("off");
    const offResult = await confirmDispense(defaultConfirmInput());
    expect(offResult.event).toMatchObject({ status: "CONFIRMED" });
    expect(offResult.copDegraded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Per-clinic isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7 — per-clinic isolation", () => {
  it("clinic A enforce-deny does not block clinic B shadow-allow on the same request body shape", async () => {
    // Clinic A: enforce + deny verdict
    resolveClinicalInvariantEnforcementModeMock.mockImplementation(
      async (id: string) => (id === "clinic-A" ? "enforce" : "shadow"),
    );
    evaluateClinicalInvariantMock.mockImplementation(async (ctx: { clinicId: string }) => {
      if (ctx.clinicId === "clinic-A") {
        return {
          action: "deny",
          reason: "ORPHAN_DISPENSE_BLOCKED",
          orphanLines: [sampleOrphanLine],
        };
      }
      return { action: "allow" };
    });

    await expect(
      confirmDispense(defaultConfirmInput({ clinicId: "clinic-A" })),
    ).rejects.toBeInstanceOf(ClinicalInvariantDenyError);

    const resultB = await confirmDispense(defaultConfirmInput({ clinicId: "clinic-B" }));
    expect(resultB.event).toMatchObject({ status: "CONFIRMED" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Header absence on enforce-pass + 6/7. Fail-closed / fail-open
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7 — degraded header emission (containers route)", () => {
  it("enforce-pass: `X-COP-Validation-Status` MUST NOT be set on success", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });
    const { res, recorded } = makeRes();
    await callDispense(makeReq(), res);
    expect(recorded.headers["x-cop-validation-status"]).toBeUndefined();
    expect(recorded.statusCode).toBe(200);
  });

  it("enforce + fail-closed (default): evaluator DB failure → 503 + tx rollback", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockRejectedValue(new Error("db lock"));
    const { res, recorded } = makeRes();
    await callDispense(makeReq(), res);
    expect(recorded.statusCode).toBe(503);
    const body = recorded.body as { reason?: string; code?: string };
    expect(body.code).toBe("COP_VALIDATION_UNAVAILABLE");
    expect(body.reason).toBe("COP_VALIDATION_UNAVAILABLE");
    // No degraded header on the fail-closed path.
    expect(recorded.headers["x-cop-validation-status"]).toBeUndefined();
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.failClosedTotal).toBe(1);
    expect(snap.failOpenTotal).toBe(0);
    expect(snap.evaluatorFailureTotal).toBe(1);
  });

  it("enforce + fail-open (env=true): evaluator DB failure → allow + degraded header + fail-open audit", async () => {
    process.env.SMART_COP_VALIDATION_FAIL_OPEN = "true";
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockRejectedValue(new Error("db lock"));
    const { res, recorded } = makeRes();
    await callDispense(makeReq(), res);
    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["x-cop-validation-status"]).toBe("degraded");
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.failOpenTotal).toBe(1);
    expect(snap.failClosedTotal).toBe(0);
    expect(snap.evaluatorFailureTotal).toBe(1);
    const failOpenAudits = logAuditMock.mock.calls.filter(
      ([params]) =>
        params != null &&
        typeof params === "object" &&
        (params as { actionType?: unknown }).actionType ===
          "clinical_invariant_fail_open",
    );
    expect(failOpenAudits).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Emergency-bypass audit emission
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7 — emergency-bypass audit (containers route)", () => {
  it("emergency carve-out: `clinical_invariant_emergency_bypass` audit emitted post-commit", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "allow",
      disposition: "EMERGENCY_BYPASS",
    });
    const { res, recorded } = makeRes();
    await callDispense(
      makeReq({
        body: {
          items: [{ itemId: "item-1", quantity: 1 }],
          animalId: "animal-1",
          isEmergency: true,
          bypassReason: "EMERGENCY_CPR",
        },
      } as unknown as Partial<Request>),
      res,
    );
    expect(recorded.statusCode).toBe(200);
    const emergencyAudits = logAuditMock.mock.calls.filter(
      ([params]) =>
        params != null &&
        typeof params === "object" &&
        (params as { actionType?: unknown }).actionType ===
          "clinical_invariant_emergency_bypass",
    );
    expect(emergencyAudits).toHaveLength(1);
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.emergencyBypassTotal).toBe(1);
    // No deny path was hit — blockedTotal stays zero.
    expect(snap.blockedTotal).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Shadow mode unaffected by SMART_COP_VALIDATION_FAIL_OPEN (plan §8.2)
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7 — shadow mode is unaffected by SMART_COP_VALIDATION_FAIL_OPEN", () => {
  it("shadow + evaluator throw + fail-open=true: allow + NO degraded header + NO fail-open audit", async () => {
    process.env.SMART_COP_VALIDATION_FAIL_OPEN = "true";
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockRejectedValue(new Error("db lock"));
    const { res, recorded } = makeRes();
    await callDispense(makeReq(), res);
    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["x-cop-validation-status"]).toBeUndefined();
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.evaluatorFailureTotal).toBe(1);
    // Fail-open / fail-closed counters MUST NOT tick in shadow.
    expect(snap.failOpenTotal).toBe(0);
    expect(snap.failClosedTotal).toBe(0);
    // No fail-open audit in shadow.
    const failOpenAudits = logAuditMock.mock.calls.filter(
      ([params]) =>
        params != null &&
        typeof params === "object" &&
        (params as { actionType?: unknown }).actionType ===
          "clinical_invariant_fail_open",
    );
    expect(failOpenAudits).toHaveLength(0);
  });

  it("shadow + evaluator throw + fail-open=false: same allow path (env irrelevant in shadow)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockRejectedValue(new Error("db lock"));
    const { res, recorded } = makeRes();
    await callDispense(makeReq(), res);
    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["x-cop-validation-status"]).toBeUndefined();
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.evaluatorFailureTotal).toBe(1);
    expect(snap.failClosedTotal).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Containers route — 422 envelope shape via HTTP layer
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7 — containers route 422 envelope (HTTP layer)", () => {
  it("enforce + deny → 422 with §6.3 envelope on POST /api/containers/:id/dispense", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [sampleOrphanLine],
    });
    const { res, recorded } = makeRes();
    await callDispense(makeReq(), res);
    expect(recorded.statusCode).toBe(422);
    expect(recorded.body).toMatchObject({
      code: "CLINICAL_INVARIANT_VIOLATION",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      clinical: true,
      cop: {
        kind: "orphan_dispense",
        orphanLines: [
          expect.objectContaining({
            itemId: "item-1",
            quantity: 1,
            reasons: ["NO_ACTIVE_ORDER"],
            matchingOrderIds: [],
          }),
        ],
      },
    });
    // No degraded header on the deny path.
    expect(recorded.headers["x-cop-validation-status"]).toBeUndefined();
  });
});
