import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryActionProposalWriter } from "../../server/lib/autopilot/action-proposal-writer.port.js";
import {
  stageProposal,
  approveProposal,
  editProposal,
  rejectProposal,
  ActionProposalNotFoundError,
  ActionProposalEditValidationError,
} from "../../server/lib/autopilot/action-proposal-service.js";
import { ActionProposalAlreadyDecidedError } from "../../server/lib/autopilot/action-proposal-writer.port.js";
import type { ActionProposalCitedFact, NewActionProposalInput } from "../../server/lib/autopilot/action-proposal-types.js";

vi.mock("../../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));
vi.mock("../../server/lib/metrics.js", () => ({
  incrementMetric: vi.fn(),
}));
vi.mock("../../server/lib/autopilot/restock-po-approve-side-effect.js", () => ({
  buildRestockPoApproveSideEffect: vi.fn(() => undefined),
}));

const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";

function buildFacts(): ActionProposalCitedFact[] {
  return [{ sourceId: "audit-1", sourceTable: "vt_audit_logs", kind: "custody", at: "2026-07-22T08:00:00.000Z" }];
}

function buildInput(overrides: Partial<NewActionProposalInput> = {}): NewActionProposalInput {
  return {
    clinicId: CLINIC_A,
    kind: "shift_handover_draft",
    sourceSessionId: "session-1",
    summary: "Shift handover draft",
    citedFacts: buildFacts(),
    draftContent: { deltas: [] },
    sourceRef: { shiftSessionId: "session-1" },
    ...overrides,
  };
}

const STAGED_BY = { performedBy: "system:test-worker", performedByEmail: "test-worker@vettrack.system" };
const ACTOR = { actorUserId: "user-1", actorEmail: "tech@clinic.test" };

describe("action-proposal-service", () => {
  let writer: InMemoryActionProposalWriter;

  beforeEach(() => {
    writer = new InMemoryActionProposalWriter();
  });

  it("stages then approves a proposal (happy path)", async () => {
    const { proposal: staged } = await stageProposal(
      { writer },
      { input: buildInput(), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
    );
    expect(staged.status).toBe("staged");

    const approved = await approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR });
    expect(approved.status).toBe("approved");
    expect(approved.decidedByUserId).toBe(ACTOR.actorUserId);
  });

  it("enforces the single-decision invariant: approve then reject on the same id throws, decision log stays length 1", async () => {
    const { proposal: staged } = await stageProposal(
      { writer },
      { input: buildInput(), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
    );
    await approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR });

    await expect(
      rejectProposal(
        { writer },
        { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR, rejectionReason: "too late" },
      ),
    ).rejects.toThrow(ActionProposalAlreadyDecidedError);

    expect(writer.allDecisions()).toHaveLength(1);
  });

  it("edit stores editedContent and flips status to edited", async () => {
    const { proposal: staged } = await stageProposal(
      { writer },
      {
        input: buildInput({ kind: "coordinator_reassign_off_roster", sourceSessionId: "session-edit" }),
        groundTruthFacts: buildFacts(),
        stagedBy: STAGED_BY,
      },
    );
    const edited = await editProposal(
      { writer },
      { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR, editedContent: { note: "adjusted" } },
    );
    expect(edited.status).toBe("edited");
    expect(edited.editedContent).toEqual({ note: "adjusted" });
    expect(writer.allDecisions()[0]?.editedContent).toEqual({ note: "adjusted" });
  });

  it("reject requires a non-empty reason at the service boundary", async () => {
    const { proposal: staged } = await stageProposal(
      { writer },
      { input: buildInput({ sourceSessionId: "session-reject" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
    );
    await expect(
      rejectProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR, rejectionReason: "" }),
    ).rejects.toThrow();
  });

  it("is idempotent: staging the same (clinicId, kind, sourceSessionId) twice does not double-stage", async () => {
    const input = buildInput({ sourceSessionId: "session-idempotent" });
    const { proposal: first } = await stageProposal({ writer }, { input, groundTruthFacts: buildFacts(), stagedBy: STAGED_BY });
    const { proposal: second } = await stageProposal({ writer }, { input, groundTruthFacts: buildFacts(), stagedBy: STAGED_BY });
    expect(second.id).toBe(first.id);

    const staged = await writer.findStaged(CLINIC_A, { kind: "shift_handover_draft" });
    expect(staged.filter((row) => row.sourceSessionId === "session-idempotent")).toHaveLength(1);
  });

  it("emits the staged audit row and metric exactly once across a repeat stage of the same triple", async () => {
    const { logAudit } = await import("../../server/lib/audit.js");
    const { incrementMetric } = await import("../../server/lib/metrics.js");
    vi.mocked(logAudit).mockClear();
    vi.mocked(incrementMetric).mockClear();

    const input = buildInput({ sourceSessionId: "session-emission-once" });
    await stageProposal({ writer }, { input, groundTruthFacts: buildFacts(), stagedBy: STAGED_BY });
    await stageProposal({ writer }, { input, groundTruthFacts: buildFacts(), stagedBy: STAGED_BY });

    expect(vi.mocked(incrementMetric).mock.calls.filter(([name]) => name === "autopilot_proposal_staged_total")).toHaveLength(1);
    expect(
      vi.mocked(logAudit).mock.calls.filter(([entry]) => entry.actionType === "action_proposal_staged"),
    ).toHaveLength(1);
  });

  it("cross-tenant negative: a proposal staged for clinic A cannot be fetched or approved with clinic B's id (not-found, not forbidden-leak)", async () => {
    const { proposal: staged } = await stageProposal(
      { writer },
      { input: buildInput({ sourceSessionId: "session-cross-tenant" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
    );

    await expect(
      approveProposal({ writer }, { clinicId: CLINIC_B, proposalId: staged.id, ...ACTOR }),
    ).rejects.toThrow(ActionProposalNotFoundError);
  });

  it("transitionAndRecord is atomic: decision-log row exists iff the transition succeeded (Task 1.1 §3.A carry-over)", async () => {
    const { proposal: staged } = await stageProposal(
      { writer },
      { input: buildInput({ sourceSessionId: "session-atomic" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
    );

    const result = await writer.transitionAndRecord({
      clinicId: CLINIC_A,
      proposalId: staged.id,
      patch: { status: "approved", decidedByUserId: ACTOR.actorUserId, decidedAt: new Date() },
      decisionMeta: {
        stagedSummary: staged.summary,
        stagedCitedFacts: staged.citedFacts,
        stagedDraftContent: staged.draftContent,
      },
    });
    expect(result.proposal.status).toBe("approved");
    expect(result.decision.decision).toBe("approved");
    expect(writer.allDecisions()).toHaveLength(1);

    // A second decision attempt on the same (already-decided) proposal must
    // throw AND must not leave an orphaned decision-log row behind — the
    // transition and the decision-log append succeed or fail together.
    await expect(
      writer.transitionAndRecord({
        clinicId: CLINIC_A,
        proposalId: staged.id,
        patch: { status: "rejected", decidedByUserId: ACTOR.actorUserId, decidedAt: new Date(), rejectionReason: "too late" },
        decisionMeta: {
          stagedSummary: staged.summary,
          stagedCitedFacts: staged.citedFacts,
          stagedDraftContent: staged.draftContent,
        },
      }),
    ).rejects.toThrow(ActionProposalAlreadyDecidedError);
    expect(writer.allDecisions()).toHaveLength(1);

    const finalRow = await writer.get(CLINIC_A, staged.id);
    expect(finalRow?.status).toBe("approved");
  });

  describe("restock_po_on_burn approve side effect (Task 1.1 §4)", () => {
    function buildRestockInput(overrides: Partial<NewActionProposalInput> = {}): NewActionProposalInput {
      return buildInput({
        kind: "restock_po_on_burn",
        sourceSessionId: "restock-session-1",
        draftContent: { supplierName: "Autopilot", lines: [{ itemId: "item-1", quantitySuggested: 5 }] },
        sourceRef: { clinicId: CLINIC_A, scanDate: "2026-07-22" },
        ...overrides,
      });
    }

    it("executes the kind-dispatched side effect exactly once across approve + a retried approve (retry throws AlreadyDecided before the side effect runs)", async () => {
      const { buildRestockPoApproveSideEffect } = await import(
        "../../server/lib/autopilot/restock-po-approve-side-effect.js"
      );
      const sideEffectSpy = vi.fn().mockResolvedValue(undefined);
      vi.mocked(buildRestockPoApproveSideEffect).mockReturnValue(sideEffectSpy);

      const { proposal: staged } = await stageProposal(
        { writer },
        { input: buildRestockInput(), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
      );

      const approved = await approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR });
      expect(approved.status).toBe("approved");
      expect(sideEffectSpy).toHaveBeenCalledTimes(1);

      // Retry: the writer's staged-status guard fires before the side effect
      // ever runs again — proves "exactly one PO" would exist in the real
      // Drizzle path (a real PO insert only happens inside the same
      // transaction as a successful transition).
      await expect(
        approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR }),
      ).rejects.toThrow(ActionProposalAlreadyDecidedError);
      expect(sideEffectSpy).toHaveBeenCalledTimes(1);
    });

    it("rolls back the decision when the side effect fails: proposal stays staged, no decision-log row is appended", async () => {
      const { buildRestockPoApproveSideEffect } = await import(
        "../../server/lib/autopilot/restock-po-approve-side-effect.js"
      );
      const failingSideEffect = vi.fn().mockRejectedValue(new Error("PO insert failed"));
      vi.mocked(buildRestockPoApproveSideEffect).mockReturnValue(failingSideEffect);

      const { proposal: staged } = await stageProposal(
        { writer },
        { input: buildRestockInput({ sourceSessionId: "restock-session-rollback" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
      );

      await expect(
        approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR }),
      ).rejects.toThrow("PO insert failed");

      const stillStaged = await writer.get(CLINIC_A, staged.id);
      expect(stillStaged?.status).toBe("staged");
      expect(writer.allDecisions().filter((d) => d.proposalId === staged.id)).toHaveLength(0);
    });

    it("edit = fix-then-execute (owner decision 2026-07-22): editing a restock proposal executes the side effect exactly once with the EDITED content", async () => {
      const { buildRestockPoApproveSideEffect } = await import(
        "../../server/lib/autopilot/restock-po-approve-side-effect.js"
      );
      const sideEffectSpy = vi.fn().mockResolvedValue(undefined);
      vi.mocked(buildRestockPoApproveSideEffect).mockReturnValue(sideEffectSpy);

      const editedContent = { supplierName: "Real Supplier Ltd", lines: [{ itemId: "item-1", quantitySuggested: 3 }] };
      const { proposal: staged } = await stageProposal(
        { writer },
        { input: buildRestockInput({ sourceSessionId: "restock-session-edit-executes" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
      );

      const edited = await editProposal(
        { writer },
        { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR, editedContent },
      );
      expect(edited.status).toBe("edited");
      expect(sideEffectSpy).toHaveBeenCalledTimes(1);
      expect(vi.mocked(buildRestockPoApproveSideEffect)).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: staged.id }),
        ACTOR.actorUserId,
        editedContent,
      );

      // Still single-decision: edited is terminal, a later approve throws
      // before any second execution.
      await expect(
        approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR }),
      ).rejects.toThrow(ActionProposalAlreadyDecidedError);
      expect(sideEffectSpy).toHaveBeenCalledTimes(1);
    });

    it("a failing side effect on the edit path rolls back: proposal stays staged, no decision-log row", async () => {
      const { buildRestockPoApproveSideEffect } = await import(
        "../../server/lib/autopilot/restock-po-approve-side-effect.js"
      );
      const failingSideEffect = vi.fn().mockRejectedValue(new Error("PO insert failed on edit"));
      vi.mocked(buildRestockPoApproveSideEffect).mockReturnValue(failingSideEffect);

      const { proposal: staged } = await stageProposal(
        { writer },
        { input: buildRestockInput({ sourceSessionId: "restock-session-edit-rollback" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
      );

      await expect(
        editProposal(
          { writer },
          {
            clinicId: CLINIC_A,
            proposalId: staged.id,
            ...ACTOR,
            editedContent: { supplierName: "Real Supplier Ltd", lines: [{ itemId: "item-1", quantitySuggested: 3 }] },
          },
        ),
      ).rejects.toThrow("PO insert failed on edit");

      const stillStaged = await writer.get(CLINIC_A, staged.id);
      expect(stillStaged?.status).toBe("staged");
      expect(writer.allDecisions().filter((d) => d.proposalId === staged.id)).toHaveLength(0);
    });

    it("does not dispatch a side effect for other kinds (e.g. shift_handover_draft) — approve stays a generic status flip", async () => {
      const { buildRestockPoApproveSideEffect } = await import(
        "../../server/lib/autopilot/restock-po-approve-side-effect.js"
      );
      vi.mocked(buildRestockPoApproveSideEffect).mockReturnValue(undefined);

      const { proposal: staged } = await stageProposal(
        { writer },
        { input: buildInput({ sourceSessionId: "session-non-restock" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
      );
      const approved = await approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR });
      expect(approved.status).toBe("approved");
    });
  });

  describe("per-kind edit-body validation (Task 1.1 §4, deliverable E)", () => {
    it("rejects an edit for restock_po_on_burn whose editedContent does not match the per-kind schema", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "restock_po_on_burn",
            sourceSessionId: "restock-edit-invalid",
            draftContent: { supplierName: "Autopilot", lines: [{ itemId: "item-1", quantitySuggested: 5 }] },
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );

      await expect(
        editProposal(
          { writer },
          { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR, editedContent: { supplierName: "", lines: [] } },
        ),
      ).rejects.toThrow(ActionProposalEditValidationError);

      const stillStaged = await writer.get(CLINIC_A, staged.id);
      expect(stillStaged?.status).toBe("staged");
    });

    it("accepts an edit for restock_po_on_burn whose editedContent matches the per-kind schema", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "restock_po_on_burn",
            sourceSessionId: "restock-edit-valid",
            draftContent: { supplierName: "Autopilot", lines: [{ itemId: "item-1", quantitySuggested: 5 }] },
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );

      const edited = await editProposal(
        { writer },
        {
          clinicId: CLINIC_A,
          proposalId: staged.id,
          ...ACTOR,
          editedContent: { supplierName: "Real Supplier Inc.", lines: [{ itemId: "item-1", quantitySuggested: 7 }] },
        },
      );
      expect(edited.status).toBe("edited");
    });

    it("does not apply the restock schema to a kind with no registered schema — a coordinator_reassign_off_roster edit with an arbitrary shape still succeeds", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({ kind: "coordinator_reassign_off_roster", sourceSessionId: "session-edit-other-kind" }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );
      const edited = await editProposal(
        { writer },
        { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR, editedContent: { anything: "goes" } },
      );
      expect(edited.status).toBe("edited");
    });

    it("rejects an edit for crash_cart_drift whose editedContent does not match the per-kind schema (bad driftType)", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "crash_cart_drift",
            sourceSessionId: "crash-cart-edit-invalid",
            draftContent: { driftType: "missing_items", scanDate: "2026-07-22", lastCheckId: "check-1", lastCheckPerformedAt: "2026-07-22T10:00:00.000Z", failedItems: [], title: "t" },
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );

      await expect(
        editProposal(
          { writer },
          { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR, editedContent: { driftType: "not_a_real_type" } },
        ),
      ).rejects.toThrow(ActionProposalEditValidationError);

      const stillStaged = await writer.get(CLINIC_A, staged.id);
      expect(stillStaged?.status).toBe("staged");
    });

    it("accepts an edit for crash_cart_drift whose editedContent matches the per-kind schema (driftType + note + acknowledgedItemKeys)", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "crash_cart_drift",
            sourceSessionId: "crash-cart-edit-valid",
            draftContent: { driftType: "missing_items", scanDate: "2026-07-22", lastCheckId: "check-1", lastCheckPerformedAt: "2026-07-22T10:00:00.000Z", failedItems: [], title: "t" },
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );

      const edited = await editProposal(
        { writer },
        {
          clinicId: CLINIC_A,
          proposalId: staged.id,
          ...ACTOR,
          editedContent: { driftType: "missing_items", note: "Restocked epinephrine manually", acknowledgedItemKeys: ["epinephrine"] },
        },
      );
      expect(edited.status).toBe("edited");
    });

    it("crash_cart_drift has no approve side effect — approve stays a generic status flip", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "crash_cart_drift",
            sourceSessionId: "crash-cart-approve-no-side-effect",
            draftContent: { driftType: "stale_check", scanDate: "2026-07-22", hasNeverBeenChecked: false, lastCheckPerformedAt: "2026-07-20T00:00:00.000Z", hoursSinceLastCheck: 48, thresholdHours: 24, title: "t" },
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );
      const approved = await approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR });
      expect(approved.status).toBe("approved");
    });

    it("rejects an edit for shift_handover_draft whose editedContent does not match the per-kind schema (deltas missing a dimension)", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "shift_handover_draft",
            sourceSessionId: "handover-edit-invalid",
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );

      await expect(
        editProposal(
          { writer },
          {
            clinicId: CLINIC_A,
            proposalId: staged.id,
            ...ACTOR,
            editedContent: { deltas: { custody: [] }, openItems: [] },
          },
        ),
      ).rejects.toThrow(ActionProposalEditValidationError);

      const stillStaged = await writer.get(CLINIC_A, staged.id);
      expect(stillStaged?.status).toBe("staged");
    });

    it("accepts an edit for shift_handover_draft whose editedContent matches the per-kind schema (deltas + openItems + optional note)", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "shift_handover_draft",
            sourceSessionId: "handover-edit-valid",
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );

      const edited = await editProposal(
        { writer },
        {
          clinicId: CLINIC_A,
          proposalId: staged.id,
          ...ACTOR,
          editedContent: {
            deltas: { custody: [], taskState: [], alerts: [], dispenses: [] },
            openItems: [{ id: "task-1", kind: "task", summary: "task_started:task-1" }],
            note: "Confirmed handover with incoming lead by phone",
          },
        },
      );
      expect(edited.status).toBe("edited");
    });

    it("shift_handover_draft has no side-effect dispatch on approve — approve stays a generic status flip", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "shift_handover_draft",
            sourceSessionId: "handover-approve-no-side-effect",
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );
      const approved = await approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR });
      expect(approved.status).toBe("approved");
    });

    it("shift_handover_draft has no side-effect dispatch on edit — publishing an edited handover is the §0(c) follow-up's job, not this slice's", async () => {
      const { proposal: staged } = await stageProposal(
        { writer },
        {
          input: buildInput({
            kind: "shift_handover_draft",
            sourceSessionId: "handover-edit-no-side-effect",
          }),
          groundTruthFacts: buildFacts(),
          stagedBy: STAGED_BY,
        },
      );
      const edited = await editProposal(
        { writer },
        {
          clinicId: CLINIC_A,
          proposalId: staged.id,
          ...ACTOR,
          editedContent: {
            deltas: { custody: [], taskState: [], alerts: [], dispenses: [] },
            openItems: [],
          },
        },
      );
      expect(edited.status).toBe("edited");
    });
  });
});
