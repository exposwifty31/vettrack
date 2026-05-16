/**
 * Phase 5 PR 5.4 — container-dispense wiring tests (route-level).
 *
 * Drives the `POST /api/containers/:id/dispense` handler with mocked
 * DB + mocked dependencies to verify the wiring contract at the
 * container-dispense transaction boundary:
 *
 *   - Off-mode: `evaluateClinicalInvariant` is NOT invoked on the
 *     request path (CI-22 + CI-27). The pre-existing legacy
 *     `evaluateDispenseAgainstOrders` direct call still runs as
 *     before (production hard-block unchanged).
 *   - `clinical_invariant_resolved_off` ticks exactly once per
 *     non-emergency dispense.
 *   - Resolver throw degrades to off (evaluator still not invoked).
 *   - With mode forced to `shadow`, the evaluator is invoked EXACTLY
 *     ONCE per request (CI-21) and receives a `modeResolver` option
 *     that pins the wiring-layer's resolved mode (CI-22 single-
 *     source) — the evaluator does NOT re-resolve mode a second
 *     time via the config resolver.
 *   - Evaluator throw is caught by the wiring layer with no retry
 *     (CI-16, CI-20). Mutation proceeds.
 *   - Emergency carve-out: when `isEmergency=true && bypassReason`,
 *     the evaluator is invoked with `lines: []` (its own emergency
 *     carve-out short-circuits) and the per-item label/code lookup
 *     is skipped.
 *
 * Lock-test (forbidden surfaces): the pre-existing legacy
 * `evaluateDispenseAgainstOrders` direct call at `containers.ts`
 * continues to exist — PR 5.4 does NOT remove it; PR 5.7 will
 * consolidate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// ─── Hoisted spies / state ─────────────────────────────────────────────────
const {
  resolveClinicalInvariantEnforcementModeMock,
  evaluateClinicalInvariantMock,
  evaluateDispenseAgainstOrdersMock,
  loadInventoryItemLabelCodeMock,
} = vi.hoisted(() => ({
  resolveClinicalInvariantEnforcementModeMock: vi.fn(),
  evaluateClinicalInvariantMock: vi.fn(),
  evaluateDispenseAgainstOrdersMock: vi.fn(),
  loadInventoryItemLabelCodeMock: vi.fn(),
}));

// ─── Module mocks ──────────────────────────────────────────────────────────
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

// Containers-route DB mock (similar fluent thenable pattern as PR 5.3).
type ChainKind = "select" | "update" | "insert" | "delete";

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
      if (tblName === "vt_containers") {
        return resolve([{ id: "container-1", clinicId: "clinic-1", name: "ER Supply Cart", roomId: null }]);
      }
      if (tblName === "vt_container_items") {
        return resolve([{ quantity: 100, itemId: "item-1" }]);
      }
      if (tblName === "vt_inventory_items") {
        return resolve([{ id: "item-1", code: "DX", label: "Drug X" }]);
      }
      return resolve([]);
    }
    if (kind === "update") {
      if (returningCalled) {
        return resolve([{ id: tblName, quantity: 99 }]);
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
      transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()),
      select: () => makeChain("select", null),
      update: (target: unknown) => makeChain("update", target),
      insert: (target: unknown) => makeChain("insert", target),
    },
    billingItems: tableRef("vt_billing_items"),
    billingLedger: tableRef("vt_billing_ledger"),
    containerItems: tableRef("vt_container_items"),
    containers: tableRef("vt_containers"),
    idempotencyKeys: tableRef("vt_idempotency_keys"),
    inventoryItems: tableRef("vt_inventory_items"),
    inventoryLogs: tableRef("vt_inventory_logs"),
    operationalTasks: tableRef("vt_operational_tasks"),
    users: tableRef("vt_users"),
  };
});

// Middlewares pass-through.
vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
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
  dispenseIdempotencyMiddleware: (req: Request, res: Response, next: () => void) => {
    (res as unknown as { locals: Record<string, unknown> }).locals = {
      dispenseIdempotencyKey: "idem-1",
    };
    next();
  },
}));

vi.mock("../server/lib/container-consumable-billing.js", () => ({
  captureConsumableBillingForDispenseLine: vi.fn().mockResolvedValue({
    billingEventId: "billing-1",
  }),
}));

vi.mock("../server/lib/queue.js", () => ({
  enqueueBillingWebhookJob: vi.fn(),
}));

vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return { ...actual, logAudit: vi.fn(), resolveAuditActorRole: () => "technician" };
});

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

import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import containersRouter from "../server/routes/containers.js";

// ─── Express test driver ──────────────────────────────────────────────────
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
      return recorded.headers[name];
    },
    setHeader(name: string, value: string) {
      recorded.headers[name] = value;
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
  // The /:id/dispense route handler runs inside `containersRouter`. We
  // find the matching layer by hand to avoid spinning up express's HTTP
  // dispatch. Express stores route handlers in `layer.route.stack`
  // (each entry has `.handle` as the raw function).
  const stack = (containersRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: { post?: boolean };
        stack: Array<{ handle: (req: Request, res: Response, next: () => void) => unknown | Promise<unknown> }>;
      };
    }>;
  }).stack;
  for (const layer of stack) {
    const route = layer.route;
    if (route?.path === "/:id/dispense" && route.methods.post) {
      const handlers = route.stack;
      // Run only the final handler (the previous middlewares are mocked
      // pass-throughs).
      const final = handlers[handlers.length - 1];
      if (final) await final.handle(req, res, () => {});
      return;
    }
  }
  throw new Error("dispense route not found in router stack");
}

beforeEach(() => {
  resetMetrics();
  resolveClinicalInvariantEnforcementModeMock.mockReset();
  evaluateClinicalInvariantMock.mockReset();
  evaluateDispenseAgainstOrdersMock.mockReset();
  loadInventoryItemLabelCodeMock.mockReset();
  loadInventoryItemLabelCodeMock.mockResolvedValue({ label: "Drug X", code: "DX" });
  evaluateDispenseAgainstOrdersMock.mockResolvedValue({ orphanLines: [] });
});

afterEach(() => {
  resetMetrics();
});

// ─── Off-mode invariants ───────────────────────────────────────────────────

describe("PR 5.4 — container dispense / off-mode wiring", () => {
  it("off-mode does NOT invoke evaluateClinicalInvariant on the request path (CI-22)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");
    const { res } = makeRes();
    await callDispense(makeReq(), res);
    expect(evaluateClinicalInvariantMock).not.toHaveBeenCalled();
  });

  it("off-mode ticks `clinical_invariant_resolved_off` exactly once per request", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");
    const { res } = makeRes();
    await callDispense(makeReq(), res);
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.resolved.off).toBe(1);
    expect(snap.resolved.shadow).toBe(0);
    expect(snap.resolved.enforce).toBe(0);
  });

  it("resolver throw degrades to off (evaluator still not invoked) — Strategy A", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockRejectedValue(
      new Error("config db blip"),
    );
    const { res } = makeRes();
    await callDispense(makeReq(), res);
    expect(evaluateClinicalInvariantMock).not.toHaveBeenCalled();
    expect(getMetricsSnapshot().clinicalInvariant.resolved.off).toBe(1);
  });

  it("off-mode: legacy `evaluateDispenseAgainstOrders` call still runs (pre-Phase-5 hard-block unchanged)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");
    const { res } = makeRes();
    await callDispense(makeReq(), res);
    // The legacy direct call MUST still run after the wiring block —
    // PR 5.4 preserves the production HTTP 400 hard-block on orphans;
    // PR 5.7 will consolidate.
    expect(evaluateDispenseAgainstOrdersMock).toHaveBeenCalledTimes(1);
  });
});

// ─── Shadow path (fixture-forced) ──────────────────────────────────────────

describe("PR 5.4 — container dispense / shadow-forced wiring (CI-21, CI-22, CI-16)", () => {
  it("shadow mode: evaluateClinicalInvariant invoked EXACTLY ONCE per request", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });
    const { res } = makeRes();
    await callDispense(makeReq(), res);
    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
    expect(resolveClinicalInvariantEnforcementModeMock).toHaveBeenCalledTimes(1);
  });

  it("shadow mode: passes a modeResolver pinned to the wiring-layer's resolved mode (CI-22)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });
    const { res } = makeRes();
    await callDispense(makeReq(), res);

    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
    const options = evaluateClinicalInvariantMock.mock.calls[0]![1] as
      | { modeResolver?: () => Promise<string> }
      | undefined;
    expect(options).toBeDefined();
    expect(options!.modeResolver).toBeDefined();
    const before = resolveClinicalInvariantEnforcementModeMock.mock.calls.length;
    const injected = await options!.modeResolver!();
    expect(injected).toBe("shadow");
    expect(
      resolveClinicalInvariantEnforcementModeMock.mock.calls.length,
    ).toBe(before);
  });

  it("shadow mode: evaluator throw is caught at wiring layer with no retry (CI-16, CI-20)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockRejectedValue(new Error("evaluator boom"));
    const { res } = makeRes();
    await callDispense(makeReq(), res);
    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
    // The legacy call still runs after the wiring catch — mutation
    // proceeds despite the evaluator throw.
    expect(evaluateDispenseAgainstOrdersMock).toHaveBeenCalledTimes(1);
  });

  it("shadow mode: evaluator receives the caller-provided tx + correct args (CI-28)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });
    const { res } = makeRes();
    await callDispense(makeReq(), res);

    const ctx = evaluateClinicalInvariantMock.mock.calls[0]![0] as {
      tx: unknown;
      clinicId: string;
      animalId: string | null;
      containerId: string;
      isEmergency: boolean;
      bypassReason: string | null;
      requestId: string;
    };
    expect(ctx.clinicId).toBe("clinic-1");
    expect(ctx.animalId).toBe("animal-1");
    expect(ctx.containerId).toBe("container-1");
    expect(ctx.isEmergency).toBe(false);
    expect(ctx.bypassReason).toBeNull();
    expect(typeof ctx.requestId).toBe("string");
    expect(ctx.requestId.length).toBeGreaterThan(0);
    expect(ctx.tx).toBeDefined();
  });
});

// ─── Emergency carve-out ───────────────────────────────────────────────────

describe("PR 5.4 — container dispense / emergency carve-out (CI-7)", () => {
  it("isEmergency + bypassReason in shadow: evaluator invoked with lines: [] (label/code lookup skipped)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "allow",
      disposition: "EMERGENCY_BYPASS",
    });
    const { res } = makeRes();
    await callDispense(
      makeReq({
        body: {
          items: [{ itemId: "item-1", quantity: 1 }],
          animalId: "animal-1",
          isEmergency: true,
          bypassReason: "EMERGENCY_CPR",
        } as unknown as Request["body"],
      }),
      res,
    );
    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
    // The carve-out skips the per-item label/code lookup in the wiring
    // block. (Note: the legacy block ALSO skips it when
    // `body.isEmergency`, so the helper may still be called zero times
    // overall — assert wiring-side behaviour via the evaluator args.)
    const ctx = evaluateClinicalInvariantMock.mock.calls[0]![0] as {
      lines: unknown[];
      isEmergency: boolean;
      bypassReason: string | null;
    };
    expect(ctx.lines).toEqual([]);
    expect(ctx.isEmergency).toBe(true);
    expect(ctx.bypassReason).toBe("EMERGENCY_CPR");
  });
});

// ─── Idempotency / forbidden-surface lock ──────────────────────────────────

describe("PR 5.4 — forbidden-surface lock", () => {
  it("the pre-existing legacy evaluateDispenseAgainstOrders direct call still exists in containers.ts source", async () => {
    // PR 5.4 does NOT remove the legacy production hard-block. PR 5.7
    // will consolidate. Verifying the legacy call is still present
    // protects against an accidental "while-here" removal.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(
      path.join(__dirname, "..", "server", "routes", "containers.ts"),
      "utf8",
    );
    // The legacy call invokes `evaluateDispenseAgainstOrders(tx, ...)`
    // and the throw `ORPHAN_DISPENSE_BLOCKED` is the pre-Phase-5
    // production hard-block — both must remain.
    expect(source).toMatch(/await\s+evaluateDispenseAgainstOrders\(\s*tx\s*,/);
    expect(source).toContain('"ORPHAN_DISPENSE_BLOCKED"');
  });
});
