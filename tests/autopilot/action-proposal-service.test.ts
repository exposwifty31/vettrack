import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryActionProposalWriter } from "../../server/lib/autopilot/action-proposal-writer.port.js";
import {
  stageProposal,
  approveProposal,
  editProposal,
  rejectProposal,
  ActionProposalNotFoundError,
} from "../../server/lib/autopilot/action-proposal-service.js";
import { ActionProposalAlreadyDecidedError } from "../../server/lib/autopilot/action-proposal-writer.port.js";
import type { ActionProposalCitedFact, NewActionProposalInput } from "../../server/lib/autopilot/action-proposal-types.js";

vi.mock("../../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));
vi.mock("../../server/lib/metrics.js", () => ({
  incrementMetric: vi.fn(),
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
    const staged = await stageProposal(
      { writer },
      { input: buildInput(), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
    );
    expect(staged.status).toBe("staged");

    const approved = await approveProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR });
    expect(approved.status).toBe("approved");
    expect(approved.decidedByUserId).toBe(ACTOR.actorUserId);
  });

  it("enforces the single-decision invariant: approve then reject on the same id throws, decision log stays length 1", async () => {
    const staged = await stageProposal(
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
    const staged = await stageProposal(
      { writer },
      { input: buildInput({ sourceSessionId: "session-edit" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
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
    const staged = await stageProposal(
      { writer },
      { input: buildInput({ sourceSessionId: "session-reject" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
    );
    await expect(
      rejectProposal({ writer }, { clinicId: CLINIC_A, proposalId: staged.id, ...ACTOR, rejectionReason: "" }),
    ).rejects.toThrow();
  });

  it("is idempotent: staging the same (clinicId, kind, sourceSessionId) twice does not double-stage", async () => {
    const input = buildInput({ sourceSessionId: "session-idempotent" });
    const first = await stageProposal({ writer }, { input, groundTruthFacts: buildFacts(), stagedBy: STAGED_BY });
    const second = await stageProposal({ writer }, { input, groundTruthFacts: buildFacts(), stagedBy: STAGED_BY });
    expect(second.id).toBe(first.id);

    const staged = await writer.findStaged(CLINIC_A, { kind: "shift_handover_draft" });
    expect(staged.filter((row) => row.sourceSessionId === "session-idempotent")).toHaveLength(1);
  });

  it("cross-tenant negative: a proposal staged for clinic A cannot be fetched or approved with clinic B's id (not-found, not forbidden-leak)", async () => {
    const staged = await stageProposal(
      { writer },
      { input: buildInput({ sourceSessionId: "session-cross-tenant" }), groundTruthFacts: buildFacts(), stagedBy: STAGED_BY },
    );

    await expect(
      approveProposal({ writer }, { clinicId: CLINIC_B, proposalId: staged.id, ...ACTOR }),
    ).rejects.toThrow(ActionProposalNotFoundError);
  });
});

describe("writer determinism + key identity (CodeRabbit #134 outside-diff round)", () => {
  it("findStaged orders same-timestamp rows deterministically (stable id tie-breaker)", async () => {
    const writer = new InMemoryActionProposalWriter();
    const now = new Date("2026-07-23T08:00:00.000Z");
    const rows = [];
    for (const s of ["s-a", "s-b", "s-c"]) {
      const proposal = await writer.stage({
        clinicId: "clinic-a", kind: "shift_handover_draft", sourceSessionId: s,
        summary: "x", citedFacts: [], draftContent: {}, sourceRef: {}, citationValidation: {},
      });
      (proposal as unknown as { createdAt: Date }).createdAt = now;
      rows.push(proposal.id);
    }
    const first = (await writer.findStaged("clinic-a")).map((r) => r.id);
    const second = (await writer.findStaged("clinic-a")).map((r) => r.id);
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual([...rows].sort());
    expect(first).toEqual([...first].sort().reverse());
  });

  it("stage identity cannot collide across tuple components containing the delimiter", async () => {
    const writer = new InMemoryActionProposalWriter();
    const base = { summary: "x", citedFacts: [], draftContent: {}, sourceRef: {}, citationValidation: {} };
    const a = await writer.stage({ clinicId: "c::x", kind: "shift_handover_draft", sourceSessionId: "s", ...base });
    const b = await writer.stage({ clinicId: "c", kind: "shift_handover_draft", sourceSessionId: "x::s", ...base });
    expect(a.id).not.toBe(b.id);
  });
});
