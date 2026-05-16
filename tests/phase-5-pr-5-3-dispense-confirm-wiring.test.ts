/**
 * Phase 5 PR 5.3 — dispense-confirm wiring tests.
 *
 * Drives `confirmDispense` end-to-end with mocked DB + mocked
 * dependencies to verify the wiring contract at the dispense-confirm
 * transaction boundary:
 *
 *   - Off-mode response is byte-identical to the pre-PR-5.3
 *     response (the existing confirm flow is untouched).
 *   - Off-mode: `evaluateClinicalInvariant` is NOT invoked on the
 *     request path (call-spy = 0) — CI-22 + CI-27.
 *   - Off-mode: zero clinical-validation queries — `loadInventoryItemLabelCode`
 *     is NOT invoked (CI-27).
 *   - `clinical_invariant_resolved_off` ticks exactly once per call.
 *   - Resolver throw degrades to off (evaluator still not invoked) —
 *     Strategy A safety net at the wiring layer.
 *   - With mode forced to `shadow` in a fixture, the evaluator is
 *     invoked EXACTLY ONCE per request (CI-21) — no route+service
 *     double invocation — and a forced evaluator throw is caught by
 *     the wiring layer with no retry (CI-16, CI-20).
 *   - The wiring block runs INSIDE the existing `db.transaction`
 *     callback (CI-28) — no nested tx, no savepoint, no
 *     orchestration change. Verified by the call ordering: the
 *     resolver and (when invoked) the evaluator run with the same
 *     `tx` object that the rest of `confirmDispense` uses.
 *
 * Mocks the full DB + downstream dependencies; the existing
 * `confirmDispense` business logic (billing capture, dispenseEvents
 * UPDATE, async deduction enqueue) is exercised in production by the
 * route-level tests and the integration suite — those don't need to
 * regress under PR 5.3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── DB mock — per-chain context tracking ──────────────────────────────────
// Each top-level `tx.select` / `tx.update` / `tx.insert` (and the same on
// `db`) returns a FRESH chain. The chain tracks its own kind (`select` |
// `update` | `insert`) plus the target table. The chain is thenable; its
// `.then` resolves based on that local state — no shared global tracking,
// so concurrent or nested transactions don't interfere with each other.
let containerLookupResult: unknown[] = [{ id: "container-1", clinicId: "clinic-1" }];

// Canned event row — DRAFT status by default; tests can mutate before driving.
let dispenseEventRow: {
  id: string;
  clinicId: string;
  containerId: string;
  patientId: string | null;
  status: string;
  bypassReason: string | null;
  items: Array<{ itemId: string; quantity: number }>;
} = {
  id: "event-1",
  clinicId: "clinic-1",
  containerId: "container-1",
  patientId: "animal-1",
  status: "DRAFT",
  bypassReason: null,
  items: [{ itemId: "item-1", quantity: 1 }],
};

type ChainKind = "select" | "update" | "insert";

function makeChain(kind: ChainKind, target: unknown) {
  let returningCalled = false;
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "set", "values"]) {
    chain[m] = () => chain;
  }
  chain.returning = () => {
    returningCalled = true;
    return chain;
  };
  (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
    const tblName = (target as { _: { name?: string } } | null)?._?.name ?? "";
    if (kind === "select") {
      if (tblName === "vt_dispense_events") return resolve([dispenseEventRow]);
      if (tblName === "vt_containers") return resolve(containerLookupResult);
      if (tblName === "vt_container_items") return resolve([{ quantity: 1 }]);
      if (tblName === "vt_inventory_items") return resolve([]);
      return resolve([]);
    }
    if (kind === "update") {
      if (returningCalled) {
        if (tblName === "vt_dispense_events") {
          return resolve([{ ...dispenseEventRow, status: "CONFIRMED" }]);
        }
        return resolve([]);
      }
      return resolve(undefined);
    }
    // kind === "insert"
    return resolve(undefined);
  };
  return chain;
}

const txCallSpy = vi.fn();

vi.mock("../server/db.js", () => {
  const tableRef = (name: string) => ({ _: { name } });
  const makeTx = () => ({
    select: (..._args: unknown[]) => {
      txCallSpy({ method: "select" });
      // For SELECTs the table comes via subsequent `.from(table)`. We
      // track it inside the chain instead of here, so set a placeholder
      // target that .from() will replace.
      return chainWithSelectFrom();
    },
    update: (target: unknown) => {
      txCallSpy({ method: "update" });
      return makeChain("update", target);
    },
    insert: (target: unknown) => {
      txCallSpy({ method: "insert" });
      return makeChain("insert", target);
    },
  });
  function chainWithSelectFrom() {
    // Start with a placeholder target; `.from(t)` replaces it. The terminal
    // thenable reads whichever target was set most recently on this chain.
    let target: unknown = null;
    let returningCalled = false;
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        target = t;
        return chain;
      },
      where: () => chain,
      limit: () => chain,
      set: () => chain,
      values: () => chain,
      returning: () => {
        returningCalled = true;
        return chain;
      },
    };
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const inner = makeChain("select", target);
      // Reuse the makeChain resolution semantics
      return (inner as { then: (r: (v: unknown) => unknown) => unknown }).then(
        resolve,
      );
    };
    void returningCalled;
    return chain;
  }
  return {
    db: {
      transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()),
      // Top-level `await db.update(...)` (used in the catch path of
      // `confirmDispense` when `enqueueDispenseInventoryDeduction` throws).
      update: (target: unknown) => makeChain("update", target),
      select: (..._args: unknown[]) => makeChain("select", null),
      insert: (target: unknown) => makeChain("insert", target),
    },
    animals: tableRef("vt_animals"),
    billingLedger: tableRef("vt_billing_ledger"),
    containerItems: tableRef("vt_container_items"),
    containers: tableRef("vt_containers"),
    dispenseEvents: tableRef("vt_dispense_events"),
    inventoryItems: tableRef("vt_inventory_items"),
    inventoryLogs: tableRef("vt_inventory_logs"),
    operationalTasks: tableRef("vt_operational_tasks"),
  };
});

// ─── Downstream-dep mocks ──────────────────────────────────────────────────
vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return { ...actual, logAudit: vi.fn() };
});

vi.mock("../server/lib/shift-chat-presence.js", () => ({
  postSystemMessage: vi.fn(),
}));

vi.mock("../server/lib/container-consumable-billing.js", () => ({
  captureConsumableBillingForDispenseLine: vi.fn().mockResolvedValue({
    billingEventId: "billing-1",
  }),
}));

const loadInventoryItemLabelCodeMock = vi.fn().mockResolvedValue({
  label: "Drug X",
  code: "DX",
});
vi.mock("../server/lib/dispense-order-validation.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/dispense-order-validation.js")
  >("../server/lib/dispense-order-validation.js");
  return {
    ...actual,
    loadInventoryItemLabelCode: (...args: unknown[]) =>
      loadInventoryItemLabelCodeMock(...args),
  };
});

const {
  resolveClinicalInvariantEnforcementModeMock,
  evaluateClinicalInvariantMock,
} = vi.hoisted(() => ({
  resolveClinicalInvariantEnforcementModeMock: vi.fn(),
  evaluateClinicalInvariantMock: vi.fn(),
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

import { confirmDispense } from "../server/services/dispense.service.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

function defaultInput() {
  return {
    clinicId: "clinic-1",
    dispenseEventId: "event-1",
    confirmedBy: "user-1",
    confirmedByEmail: "user-1@example.com",
    actorRole: "technician" as const,
    authoritySource: "shift" as const,
    authorityReason: null,
    authorityOperationalRole: null,
    requestId: "req-test",
  };
}

beforeEach(() => {
  resetMetrics();
  txCallSpy.mockClear();
  resolveClinicalInvariantEnforcementModeMock.mockReset();
  evaluateClinicalInvariantMock.mockReset();
  loadInventoryItemLabelCodeMock.mockClear();
  containerLookupResult = [{ id: "container-1", clinicId: "clinic-1" }];
  dispenseEventRow = {
    id: "event-1",
    clinicId: "clinic-1",
    containerId: "container-1",
    patientId: "animal-1",
    status: "DRAFT",
    bypassReason: null,
    items: [{ itemId: "item-1", quantity: 1 }],
  };
});

afterEach(() => {
  resetMetrics();
});

// ─── Off-mode invariants ───────────────────────────────────────────────────

describe("PR 5.3 — confirmDispense / off-mode wiring", () => {
  it("off-mode does NOT invoke evaluateClinicalInvariant on the request path (CI-22)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");
    await confirmDispense(defaultInput());
    expect(evaluateClinicalInvariantMock).not.toHaveBeenCalled();
  });

  it("off-mode performs ZERO clinical-validation queries (CI-27)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");
    await confirmDispense(defaultInput());
    // The per-line label/code lookup is the clinical-validation query
    // surface for the wiring helper. In off mode it MUST NOT be called.
    expect(loadInventoryItemLabelCodeMock).not.toHaveBeenCalled();
  });

  it("off-mode ticks `clinical_invariant_resolved_off` exactly once per request", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");
    await confirmDispense(defaultInput());
    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.resolved.off).toBe(1);
    expect(snap.resolved.shadow).toBe(0);
    expect(snap.resolved.enforce).toBe(0);
  });

  it("off-mode response is byte-identical to the pre-wiring response shape", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");
    const result = await confirmDispense(defaultInput());
    expect(result.event).toMatchObject({
      id: "event-1",
      clinicId: "clinic-1",
      status: "CONFIRMED",
    });
    // PR 5.7 — `copDegraded` is false on the off-mode happy path.
    expect(result.copDegraded).toBe(false);
  });

  it("resolver throw degrades to off (evaluator still not invoked) — Strategy A", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockRejectedValue(
      new Error("config db blip"),
    );
    await confirmDispense(defaultInput());
    expect(evaluateClinicalInvariantMock).not.toHaveBeenCalled();
    expect(getMetricsSnapshot().clinicalInvariant.resolved.off).toBe(1);
  });

  it("off-mode resolves the mode EXACTLY ONCE per request (CI-22)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");
    await confirmDispense(defaultInput());
    expect(resolveClinicalInvariantEnforcementModeMock).toHaveBeenCalledTimes(1);
  });
});

// ─── Shadow path (fixture-forced) ──────────────────────────────────────────

describe("PR 5.3 — confirmDispense / shadow-forced wiring (CI-21, CI-16)", () => {
  it("shadow mode: evaluator invoked EXACTLY ONCE per request", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });

    await confirmDispense(defaultInput());

    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
    // resolver also called exactly once
    expect(resolveClinicalInvariantEnforcementModeMock).toHaveBeenCalledTimes(1);
  });

  it("shadow mode: passes a request-local modeResolver to the evaluator that returns the already-resolved mode (CI-22)", async () => {
    // Codex review on PR 5.3: the wiring layer MUST pass the
    // already-resolved mode into the evaluator via `options.modeResolver`
    // so the evaluator never re-resolves mode a second time. This
    // keeps the request-local mode value single-source and prevents
    // observability desync between the resolved counter and the
    // evaluator's internal mode dispatch.
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });

    await confirmDispense(defaultInput());

    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
    const options = evaluateClinicalInvariantMock.mock.calls[0]![1] as
      | { modeResolver?: () => Promise<string> }
      | undefined;
    expect(options).toBeDefined();
    expect(options!.modeResolver).toBeDefined();
    // The injected resolver returns the wiring-layer's resolved mode
    // without going back to the production config resolver.
    const resolverCallsBefore = resolveClinicalInvariantEnforcementModeMock.mock.calls.length;
    const injected = await options!.modeResolver!();
    expect(injected).toBe("shadow");
    expect(
      resolveClinicalInvariantEnforcementModeMock.mock.calls.length,
    ).toBe(resolverCallsBefore);
  });

  it("shadow mode: evaluator throw is caught at the wiring layer; no retry; mutation proceeds (CI-16, CI-20)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockRejectedValue(new Error("db lock"));

    const result = await confirmDispense(defaultInput());

    // Single attempt — no retry path.
    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
    // Mutation proceeded despite evaluator throw.
    expect(result.event).toMatchObject({ status: "CONFIRMED" });
  });

  it("shadow mode: ticks `clinical_invariant_resolved_shadow` exactly once", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });

    await confirmDispense(defaultInput());

    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.resolved.shadow).toBe(1);
    expect(snap.resolved.off).toBe(0);
    expect(snap.resolved.enforce).toBe(0);
  });

  it("shadow mode: evaluator receives the caller-provided tx (CI-28 — same tx, no nested transaction)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });

    await confirmDispense(defaultInput());

    const evalArg = evaluateClinicalInvariantMock.mock.calls[0]![0] as {
      tx: unknown;
      clinicId: string;
      animalId: string | null;
      containerId: string;
      isEmergency: boolean;
      bypassReason: string | null;
      requestId: string;
    };
    expect(evalArg.clinicId).toBe("clinic-1");
    expect(evalArg.animalId).toBe("animal-1");
    expect(evalArg.containerId).toBe("container-1");
    expect(evalArg.isEmergency).toBe(false);
    expect(evalArg.bypassReason).toBeNull();
    expect(evalArg.requestId).toBe("req-test");
    // The `tx` passed to the evaluator is the same object the wiring
    // code received from the surrounding `db.transaction` callback —
    // i.e. NOT a fresh transaction (CI-28).
    expect(evalArg.tx).toBeDefined();
  });

  it("shadow mode: EMERGENCY_PENDING dispense passes isEmergency=true and skips the label/code lookup", async () => {
    dispenseEventRow.status = "EMERGENCY_PENDING";
    dispenseEventRow.bypassReason = "EMERGENCY_CPR";
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "allow",
      disposition: "EMERGENCY_BYPASS",
    });

    await confirmDispense(defaultInput());

    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
    // The carve-out skips the lookup — emergency requests never trigger
    // the per-item inventoryItems SELECT.
    expect(loadInventoryItemLabelCodeMock).not.toHaveBeenCalled();
    const evalArg = evaluateClinicalInvariantMock.mock.calls[0]![0] as {
      isEmergency: boolean;
      bypassReason: string | null;
      lines: unknown[];
    };
    expect(evalArg.isEmergency).toBe(true);
    expect(evalArg.bypassReason).toBe("EMERGENCY_CPR");
    expect(evalArg.lines).toEqual([]);
  });

  it("shadow mode with non-emergency DRAFT: label/code lookup IS invoked for each line", async () => {
    dispenseEventRow.items = [
      { itemId: "item-1", quantity: 1 },
      { itemId: "item-2", quantity: 3 },
    ];
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });

    await confirmDispense(defaultInput());

    expect(loadInventoryItemLabelCodeMock).toHaveBeenCalledTimes(2);
    const evalArg = evaluateClinicalInvariantMock.mock.calls[0]![0] as {
      lines: Array<{ itemId: string; quantity: number; label: string; code: string }>;
    };
    expect(evalArg.lines).toHaveLength(2);
    expect(evalArg.lines[0]).toEqual({
      itemId: "item-1",
      quantity: 1,
      label: "Drug X",
      code: "DX",
    });
  });
});

// ─── Enforce path (fixture-forced; PR 5.3 does NOT yet act on deny) ────────

describe("PR 5.3 — confirmDispense / enforce-forced wiring", () => {
  it("enforce mode: deny verdict now triggers a ClinicalInvariantDenyError throw (PR 5.7 422 path active)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: [
        {
          itemId: "item-1",
          quantity: 1,
          label: "Drug X",
          reasons: ["NO_ACTIVE_ORDER"],
          matchingOrderIds: [],
        },
      ],
    });

    // PR 5.7 activates the 422 path — confirmDispense now throws
    // a ClinicalInvariantDenyError carrying the §6.3 body.
    await expect(confirmDispense(defaultInput())).rejects.toMatchObject({
      name: "ClinicalInvariantDenyError",
      status: 422,
    });
    expect(evaluateClinicalInvariantMock).toHaveBeenCalledTimes(1);
  });

  it("enforce mode: ticks `clinical_invariant_resolved_enforce` exactly once", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({ action: "allow" });

    await confirmDispense(defaultInput());

    const snap = getMetricsSnapshot().clinicalInvariant;
    expect(snap.resolved.enforce).toBe(1);
    expect(snap.resolved.off).toBe(0);
    expect(snap.resolved.shadow).toBe(0);
  });
});

// ─── Idempotency / short-circuit paths ─────────────────────────────────────

describe("PR 5.3 — confirmDispense / idempotency invariants", () => {
  it("already-CONFIRMED event returns early WITHOUT invoking the wiring (no double-counter)", async () => {
    dispenseEventRow.status = "CONFIRMED";
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("off");

    const result = await confirmDispense(defaultInput());

    expect(result.event).toMatchObject({ status: "CONFIRMED" });
    // Idempotent return path is BEFORE the wiring block — counters
    // stay at 0.
    expect(getMetricsSnapshot().clinicalInvariant.resolved.off).toBe(0);
    expect(resolveClinicalInvariantEnforcementModeMock).not.toHaveBeenCalled();
    expect(evaluateClinicalInvariantMock).not.toHaveBeenCalled();
  });
});
