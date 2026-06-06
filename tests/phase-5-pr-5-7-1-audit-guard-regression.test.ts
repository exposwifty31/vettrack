/**
 * Phase 5 PR 5.7.1 — enforce-audit attempt-ordering regression.
 *
 * Locks the §9.4 attempt-ordering contract for the
 * `clinical_invariant_orphan_dispense_denied` audit emitter on the
 * enforce-deny path. Phase 3 PR 3.8.1's `force: true` audit-guard
 * regression is the structural template.
 *
 * The contract this test pins:
 *
 *   1. On an enforce-mode deny verdict, the deny-audit emitter
 *      (`emitClinicalInvariantOrphanDispenseDeniedAuditInTx`) is
 *      invoked **before** the `ClinicalInvariantDenyError` is thrown
 *      — i.e. before the 422 response is rendered by the route
 *      layer. This ordering keeps observability of "a denial was
 *      attempted" maximally close to the moment of the throw.
 *
 *   2. The emitter receives the in-tx `AuditDbExecutor` argument
 *      (so the audit attempt is bound to the same transaction the
 *      deny verdict will roll back).
 *
 *   3. The emitter receives the correct payload — `clinicId`,
 *      `animalId`, `containerId`, `requestId`, and the verdict's
 *      `orphanLines`.
 *
 *   4. On the enforce-deny path, the shadow-mode emitter
 *      (`emitClinicalInvariantShadowWouldHaveBlockedAudit`) is
 *      **NOT** invoked — enforce-deny and shadow-would-have-blocked
 *      are mutually exclusive observability paths and one must not
 *      bleed into the other.
 *
 *   5. The enforce-only metrics (`blockedTotal`, the per-reason
 *      counter) tick BEFORE the emitter call, so the deterministic
 *      record of "a denial fired" (counters) is always set even if
 *      the emitter is silently gated off by `AUTHORITY_OBS_V1`.
 *
 * What this PR explicitly does NOT verify (CI-26 / §9.4):
 *
 *   - Durable persistence of the audit row in the database. The row
 *     is written inside the same transaction that the deny verdict
 *     rolls back; per the Phase 5 plan it is **best-effort, not
 *     durable**. Durable observability for denied attempts is the
 *     metric counters + 422 response (with `requestId`) + server
 *     log line.
 *
 * No new product behaviour is introduced; this PR is regression-only
 * (CI-20 — hardening sub-PRs introduce zero runtime control-flow
 * changes; runtime control flow ownership lives at the wiring layer
 * landed in PR 5.7).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted spies / state (shared module mocks) ──────────────────────────
const {
  resolveClinicalInvariantEnforcementModeMock,
  evaluateClinicalInvariantMock,
  loadInventoryItemLabelCodeMock,
  emitOrphanDeniedMock,
  emitShadowWouldHaveBlockedMock,
  emitEmergencyBypassMock,
  emitFailOpenMock,
} = vi.hoisted(() => ({
  resolveClinicalInvariantEnforcementModeMock: vi.fn(),
  evaluateClinicalInvariantMock: vi.fn(),
  loadInventoryItemLabelCodeMock: vi.fn(),
  emitOrphanDeniedMock: vi.fn(),
  emitShadowWouldHaveBlockedMock: vi.fn(),
  emitEmergencyBypassMock: vi.fn(),
  emitFailOpenMock: vi.fn(),
}));

// Recording call-order observer — every call site we care about
// pushes its identifier here so we can assert relative ordering.
const callLog: string[] = [];

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
    loadInventoryItemLabelCode: (...args: unknown[]) =>
      loadInventoryItemLabelCodeMock(...args),
  };
});

vi.mock(
  "../server/lib/authority/enforcement/clinical-invariant.audit.js",
  () => ({
    emitClinicalInvariantOrphanDispenseDeniedAuditInTx: (...args: unknown[]) => {
      callLog.push("emit:orphan_dispense_denied");
      return emitOrphanDeniedMock(...args);
    },
    emitClinicalInvariantShadowWouldHaveBlockedAudit: (...args: unknown[]) => {
      callLog.push("emit:shadow_would_have_blocked");
      return emitShadowWouldHaveBlockedMock(...args);
    },
    emitClinicalInvariantEmergencyBypassAudit: (...args: unknown[]) => {
      callLog.push("emit:emergency_bypass");
      return emitEmergencyBypassMock(...args);
    },
    emitClinicalInvariantFailOpenAudit: (...args: unknown[]) => {
      callLog.push("emit:fail_open");
      return emitFailOpenMock(...args);
    },
  }),
);

vi.mock("../server/lib/authority/enforcement/clinical-invariant.metrics.js", () => ({
  clinicalInvariantMetrics: {
    wouldHaveBlocked: () => {
      callLog.push("metric:would_have_blocked");
    },
    wouldHaveBlockedReason: () => {
      callLog.push("metric:would_have_blocked_reason");
    },
    blockedTotal: () => {
      callLog.push("metric:blocked_total");
    },
    blockedReason: () => {
      callLog.push("metric:blocked_reason");
    },
    emergencyBypassTotal: () => {
      callLog.push("metric:emergency_bypass_total");
    },
    failOpenTotal: () => {
      callLog.push("metric:fail_open_total");
    },
    failClosedTotal: () => {
      callLog.push("metric:fail_closed_total");
    },
    evaluatorFailureTotal: () => {
      callLog.push("metric:evaluator_failure_total");
    },
  },
}));

// ─── DB mock — minimal shape needed for confirmDispense ──────────────────
type ChainKind = "select" | "update" | "insert";

const dispenseEventRow = {
  id: "event-1",
  clinicId: "clinic-1",
  containerId: "container-1",
  patientId: "animal-1",
  status: "DRAFT" as string,
  bypassReason: null as string | null,
  items: [{ itemId: "item-1", quantity: 1 }],
};

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
      if (tblName === "vt_containers") {
        return resolve([{ id: "container-1", clinicId: "clinic-1" }]);
      }
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
    return resolve(undefined);
  };
  return chain;
}

vi.mock("../server/db.js", () => {
  const tableRef = (name: string) => ({ _: { name } });
  const makeTx = () => ({
    select: () => {
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
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
        const inner = makeChain("select", target);
        return (inner as { then: (r: (v: unknown) => unknown) => unknown }).then(resolve);
      };
      return chain;
    },
    update: (target: unknown) => makeChain("update", target),
    insert: (target: unknown) => makeChain("insert", target),
  });
  return {
    db: {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()),
      update: (target: unknown) => makeChain("update", target),
      select: () => makeChain("select", null),
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

vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return {
    ...actual,
    logAudit: vi.fn(() => {
      callLog.push("logAudit:dispense_confirmed");
    }),
  };
});

vi.mock("../server/lib/shift-chat-presence.js", () => ({
  postSystemMessage: vi.fn(),
}));

vi.mock("../server/lib/container-consumable-billing.js", () => ({
  captureConsumableBillingForDispenseLine: vi.fn().mockResolvedValue({
    billingEventId: "billing-1",
  }),
}));

import {
  confirmDispense,
  ClinicalInvariantDenyError,
} from "../server/services/dispense.service.js";

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
    requestId: "req-pr-5-7-1",
  };
}

const sampleOrphanLines = [
  {
    itemId: "item-1",
    quantity: 1,
    label: "Drug X",
    reasons: ["NO_ACTIVE_ORDER"] as const,
    matchingOrderIds: [] as string[],
  },
];

beforeEach(() => {
  callLog.length = 0;
  resolveClinicalInvariantEnforcementModeMock.mockReset();
  evaluateClinicalInvariantMock.mockReset();
  loadInventoryItemLabelCodeMock.mockReset();
  loadInventoryItemLabelCodeMock.mockResolvedValue({ label: "Drug X", code: "DX" });
  emitOrphanDeniedMock.mockReset();
  emitOrphanDeniedMock.mockResolvedValue(undefined);
  emitShadowWouldHaveBlockedMock.mockReset();
  emitEmergencyBypassMock.mockReset();
  emitFailOpenMock.mockReset();
  dispenseEventRow.status = "DRAFT";
  dispenseEventRow.bypassReason = null;
  delete process.env.SMART_COP_VALIDATION_FAIL_OPEN;
});

afterEach(() => {
  callLog.length = 0;
  delete process.env.SMART_COP_VALIDATION_FAIL_OPEN;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Emitter is INVOKED on the enforce-deny path
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7.1 — enforce-deny audit attempt is made before the throw", () => {
  it("enforce + deny verdict ⇒ orphan-denied emitter is invoked exactly once", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });

    await expect(confirmDispense(defaultInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    expect(emitOrphanDeniedMock).toHaveBeenCalledTimes(1);
  });

  it("emitter receives the in-tx AuditDbExecutor as its first arg", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });

    await expect(confirmDispense(defaultInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    expect(emitOrphanDeniedMock).toHaveBeenCalledTimes(1);
    const [tx, args] = emitOrphanDeniedMock.mock.calls[0] as [unknown, unknown];
    // The tx is the executor object the wiring layer threaded into the
    // emitter — non-null and not the second positional `args` object.
    expect(tx).toBeDefined();
    expect(tx).not.toBe(args);
  });

  it("emitter receives the full §9.3 payload (clinicId/animalId/containerId/requestId/orphanLines)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });

    await expect(confirmDispense(defaultInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    const [, args] = emitOrphanDeniedMock.mock.calls[0] as [
      unknown,
      {
        clinicId: string;
        animalId: string | null;
        containerId: string;
        requestId: string;
        orphanLines: typeof sampleOrphanLines;
      },
    ];
    expect(args).toMatchObject({
      clinicId: "clinic-1",
      animalId: null,
      containerId: "container-1",
      requestId: "req-pr-5-7-1",
      orphanLines: sampleOrphanLines,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ordering — emitter is invoked BEFORE the deny throw / 422 envelope
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7.1 — emitter ordering relative to throw + metrics", () => {
  it("emitter is invoked AFTER blockedTotal + blockedReason but BEFORE the deny throw", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });
    // Tag the throw point — once the deny error reaches the test we
    // can verify the emitter ran first (the throw cannot push to
    // callLog because the catch is outside the service call).
    await expect(confirmDispense(defaultInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    // Ordering contract: deterministic metrics → emitter attempt →
    // throw. The throw is the boundary of the in-tx work; the
    // post-commit emitters (shadow/emergency/fail-open) do NOT
    // appear in this log because the throw rolls back the tx.
    const orphanDeniedIdx = callLog.indexOf("emit:orphan_dispense_denied");
    const blockedTotalIdx = callLog.indexOf("metric:blocked_total");
    const blockedReasonIdx = callLog.indexOf("metric:blocked_reason");

    expect(orphanDeniedIdx).toBeGreaterThan(-1);
    expect(blockedTotalIdx).toBeGreaterThan(-1);
    expect(blockedReasonIdx).toBeGreaterThan(-1);
    // Metrics tick before the emitter (deterministic counters are
    // always set so the durable record of "a denial fired" — metrics
    // — is in place even if the emitter is silently gated off by
    // AUTHORITY_OBS_V1 at runtime).
    expect(blockedTotalIdx).toBeLessThan(orphanDeniedIdx);
    expect(blockedReasonIdx).toBeLessThan(orphanDeniedIdx);
  });

  it("post-commit logAudit('dispense_confirmed') is NOT invoked on deny (throw rolled back the flow)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });

    await expect(confirmDispense(defaultInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    // The dispense_confirmed audit only fires post-commit (after the
    // tx resolves). On deny the tx throws and the post-commit block
    // never runs.
    expect(callLog).not.toContain("logAudit:dispense_confirmed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Shadow/emergency/fail-open emitters do NOT fire on the enforce-deny path
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7.1 — enforce-deny path does not bleed into other observability kinds", () => {
  it("shadow emitter is NOT invoked on enforce-deny (paths are mutually exclusive)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });

    await expect(confirmDispense(defaultInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    expect(emitShadowWouldHaveBlockedMock).not.toHaveBeenCalled();
  });

  it("emergency-bypass emitter is NOT invoked on enforce-deny", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });

    await expect(confirmDispense(defaultInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    expect(emitEmergencyBypassMock).not.toHaveBeenCalled();
  });

  it("fail-open emitter is NOT invoked on enforce-deny (deny is not a fail-open path)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });

    await expect(confirmDispense(defaultInput())).rejects.toBeInstanceOf(
      ClinicalInvariantDenyError,
    );

    expect(emitFailOpenMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Negative — shadow path does NOT invoke the enforce-deny emitter
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7.1 — shadow path does not invoke the enforce-deny emitter", () => {
  it("shadow + would-have-blocked verdict ⇒ enforce-deny emitter is NOT called", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("shadow");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "allow",
      disposition: "WOULD_HAVE_BLOCKED_SHADOW",
      orphanLines: sampleOrphanLines,
    });

    await confirmDispense(defaultInput());

    expect(emitOrphanDeniedMock).not.toHaveBeenCalled();
    // The shadow emitter, by contrast, IS invoked post-commit.
    expect(emitShadowWouldHaveBlockedMock).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The thrown error carries the §6.3 envelope (422 body precedes serialisation)
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7.1 — thrown ClinicalInvariantDenyError carries the §6.3 envelope", () => {
  it("error.body matches the §6.3 stability matrix (built AFTER the emitter runs)", async () => {
    resolveClinicalInvariantEnforcementModeMock.mockResolvedValue("enforce");
    evaluateClinicalInvariantMock.mockResolvedValue({
      action: "deny",
      reason: "ORPHAN_DISPENSE_BLOCKED",
      orphanLines: sampleOrphanLines,
    });

    await expect(confirmDispense(defaultInput())).rejects.toMatchObject({
      name: "ClinicalInvariantDenyError",
      status: 422,
      body: {
        code: "CLINICAL_INVARIANT_VIOLATION",
        reason: "ORPHAN_DISPENSE_BLOCKED",
        clinical: true,
        requestId: "req-pr-5-7-1",
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CI-26 non-durability is deliberately NOT tested
// ─────────────────────────────────────────────────────────────────────────────

describe("PR 5.7.1 — durable persistence is deliberately NOT asserted (CI-26)", () => {
  it("documents the scope boundary — this test file MUST NOT query the audit_logs table or assert row survival post-rollback", () => {
    // This test is a documentation marker. Per Phase 5 plan §9.4 and
    // CI-26, the `clinical_invariant_orphan_dispense_denied` audit
    // row is written inside the same transaction that the deny
    // verdict rolls back. It is therefore best-effort and NOT
    // durable. Durable observability for denied attempts is:
    //   - metric counters (`clinical_invariant_blocked_total`,
    //     per-reason counters)
    //   - the 422 response (correlated by `requestId`)
    //   - the server log line emitted by the wiring layer
    //
    // PR 5.7.1's regression test verifies attempt-ordering ONLY,
    // mirroring Phase 3 PR 3.8.1's scope. A durable post-rollback
    // denial audit (on a separate connection) is out of Phase 5
    // scope and a follow-up workstream — see Phase 5 plan §22
    // Open Item 3a.
    expect(true).toBe(true);
  });
});
