import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { logAudit } from "../server/lib/audit.js";
import {
  aggregateDeltasViaReader,
  type ShiftDeltaReader,
  type RawAuditDeltaRow,
  type RawOutboxDeltaRow,
} from "../server/lib/autopilot/shift-delta-reader.port.js";
import {
  composeAndStageHandoverDraft,
  approveProposal,
  editProposal,
  rejectProposal,
} from "../server/lib/autopilot/action-proposal-service.js";
import {
  validateProposalCitation,
  validateProposalCitations,
} from "../server/lib/autopilot/action-proposal-citation-validator.js";
import type {
  ActionProposalWriter,
} from "../server/lib/autopilot/action-proposal-writer.port.js";
import type {
  ActionProposalRecord,
  ActionProposalDecisionRecord,
  NewActionProposalInput,
  ActionProposalTransitionInput,
  ActionProposalKind,
  ActionProposalCitedFact,
} from "../server/lib/autopilot/action-proposal-types.js";
import type { ShiftWindow } from "../server/lib/shift-handover-generator.js";

/**
 * Task 0.3 spike — "Shift Autopilot" propose->approve loop, proving the
 * mechanism end-to-end for ONE proposal type (shift-handover draft).
 *
 * This test suite does NOT touch Postgres: the shift-delta reader and the
 * action-proposal writer are both in-memory fakes implementing the same
 * ports the real (Drizzle) implementations satisfy — mirroring the
 * ScheduleReader/DemandSource DI pattern in readiness-forecast-engine.ts.
 */

const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const SHIFT_SESSION_ID = "sess-morning-1";

const WINDOW: ShiftWindow = {
  start: new Date("2026-07-19T06:00:00.000Z"),
  end: new Date("2026-07-19T14:00:00.000Z"),
};

class InMemoryShiftDeltaReader implements ShiftDeltaReader {
  constructor(
    private audit: RawAuditDeltaRow[],
    private outbox: RawOutboxDeltaRow[],
  ) {}
  async auditRows(clinicId: string, window: ShiftWindow): Promise<RawAuditDeltaRow[]> {
    return this.audit.filter(
      (r) => r.timestamp >= window.start && r.timestamp < window.end,
    );
  }
  async outboxRows(clinicId: string, window: ShiftWindow): Promise<RawOutboxDeltaRow[]> {
    return this.outbox.filter(
      (r) => r.occurredAt >= window.start && r.occurredAt < window.end,
    );
  }
}

/** Array-backed fake satisfying the same ActionProposalWriter port the Drizzle impl does. */
class InMemoryActionProposalWriter implements ActionProposalWriter {
  proposals: ActionProposalRecord[] = [];
  decisions: ActionProposalDecisionRecord[] = [];

  async findStaged(
    clinicId: string,
    kind: ActionProposalKind,
    sourceSessionId: string,
  ): Promise<ActionProposalRecord | undefined> {
    return this.proposals.find(
      (p) => p.clinicId === clinicId && p.kind === kind && p.sourceSessionId === sourceSessionId,
    );
  }

  async get(clinicId: string, id: string): Promise<ActionProposalRecord | undefined> {
    return this.proposals.find((p) => p.clinicId === clinicId && p.id === id);
  }

  async stage(input: NewActionProposalInput): Promise<ActionProposalRecord> {
    const now = new Date().toISOString();
    const record: ActionProposalRecord = {
      id: input.id,
      clinicId: input.clinicId,
      kind: input.kind,
      status: "staged",
      sourceSessionId: input.sourceSessionId,
      summary: input.summary,
      citedFacts: input.citedFacts,
      draftContent: input.draftContent,
      sourceRef: input.sourceRef,
      citationValidation: input.citationValidation,
      editedContent: null,
      rejectionReason: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.proposals.push(record);
    return record;
  }

  async transition(
    clinicId: string,
    id: string,
    patch: ActionProposalTransitionInput,
  ): Promise<ActionProposalRecord> {
    const record = this.proposals.find(
      (p) => p.clinicId === clinicId && p.id === id && p.status === "staged",
    );
    if (!record) throw new Error(`no staged proposal ${id} for clinic ${clinicId}`);
    record.status = patch.status;
    record.decidedByUserId = patch.decidedByUserId;
    record.decidedAt = new Date().toISOString();
    record.editedContent = patch.editedContent ?? null;
    record.rejectionReason = patch.rejectionReason ?? null;
    record.updatedAt = record.decidedAt;
    return record;
  }

  async recordDecision(record: ActionProposalDecisionRecord): Promise<void> {
    this.decisions.push(record);
  }
}

function auditRow(o: Partial<RawAuditDeltaRow> & { id: string; actionType: string }): RawAuditDeltaRow {
  return {
    targetId: null,
    targetType: null,
    timestamp: new Date("2026-07-19T08:00:00.000Z"),
    ...o,
  };
}

function outboxRow(o: Partial<RawOutboxDeltaRow> & { id: string; type: string }): RawOutboxDeltaRow {
  return {
    targetId: null,
    targetType: null,
    occurredAt: new Date("2026-07-19T09:00:00.000Z"),
    ...o,
  };
}

describe("Task 0.3 spike — action-proposal staging (shift-handover draft)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stages exactly ONE shift_handover_draft proposal whose cited facts are real outbox/audit row references", async () => {
    const reader = new InMemoryShiftDeltaReader(
      [auditRow({ id: "aud-uuid-1", actionType: "equipment_checked_out", targetId: "eq-1" })],
      [
        outboxRow({ id: "42", type: "task_completed", targetId: "task-1" }),
        // Outside the window — must NOT be picked up.
        outboxRow({ id: "999", type: "task_completed", occurredAt: new Date("2026-07-19T23:00:00.000Z") }),
      ],
    );
    const writer = new InMemoryActionProposalWriter();

    const { deltas } = await aggregateDeltasViaReader(CLINIC_A, WINDOW, reader);
    const { proposal, created } = await composeAndStageHandoverDraft({
      clinicId: CLINIC_A,
      shiftSessionId: SHIFT_SESSION_ID,
      window: WINDOW,
      deltas,
      writer,
    });

    expect(created).toBe(true);
    expect(proposal.kind).toBe("shift_handover_draft");
    expect(proposal.status).toBe("staged");
    expect(writer.proposals).toHaveLength(1);

    // Cited facts trace back to exactly the two in-window rows the reader returned.
    const sourceIds = proposal.citedFacts.map((f) => f.sourceId).sort();
    expect(sourceIds).toEqual(["42", "aud-uuid-1"]);
    expect(proposal.citedFacts.find((f) => f.sourceId === "999")).toBeUndefined();
    expect(proposal.citationValidation.valid).toBe(true);

    const outboxCitation = proposal.citedFacts.find((f) => f.sourceId === "42");
    const auditCitation = proposal.citedFacts.find((f) => f.sourceId === "aud-uuid-1");
    expect(outboxCitation?.sourceTable).toBe("vt_event_outbox");
    expect(auditCitation?.sourceTable).toBe("vt_audit_logs");

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC_A, actionType: "action_proposal_staged", targetId: proposal.id }),
    );
  });

  it("is idempotent per (clinicId, kind, sourceSessionId) — a retry never double-stages", async () => {
    const reader = new InMemoryShiftDeltaReader(
      [],
      [outboxRow({ id: "7", type: "inventory_dispensed" })],
    );
    const writer = new InMemoryActionProposalWriter();
    const { deltas } = await aggregateDeltasViaReader(CLINIC_A, WINDOW, reader);

    const first = await composeAndStageHandoverDraft({
      clinicId: CLINIC_A,
      shiftSessionId: SHIFT_SESSION_ID,
      window: WINDOW,
      deltas,
      writer,
    });
    const second = await composeAndStageHandoverDraft({
      clinicId: CLINIC_A,
      shiftSessionId: SHIFT_SESSION_ID,
      window: WINDOW,
      deltas,
      writer,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.proposal.id).toBe(first.proposal.id);
    expect(writer.proposals).toHaveLength(1);
  });

  it("is clinicId-scoped — a proposal staged for one clinic is never visible to another", async () => {
    const reader = new InMemoryShiftDeltaReader([], [outboxRow({ id: "3", type: "alert_resolved" })]);
    const writer = new InMemoryActionProposalWriter();
    const { deltas } = await aggregateDeltasViaReader(CLINIC_A, WINDOW, reader);

    await composeAndStageHandoverDraft({
      clinicId: CLINIC_A,
      shiftSessionId: SHIFT_SESSION_ID,
      window: WINDOW,
      deltas,
      writer,
    });

    const crossClinic = await writer.findStaged(CLINIC_B, "shift_handover_draft", SHIFT_SESSION_ID);
    expect(crossClinic).toBeUndefined();
  });
});

describe("Task 0.3 spike — citation grounding (anti-hallucination proof)", () => {
  it("passes when every cited fact resolves to a real ground-truth row", async () => {
    const reader = new InMemoryShiftDeltaReader(
      [auditRow({ id: "aud-uuid-9", actionType: "task_started", targetId: "task-9" })],
      [outboxRow({ id: "15", type: "equipment_custody_state_changed" })],
    );
    const { citedFacts } = await aggregateDeltasViaReader(CLINIC_A, WINDOW, reader);

    const result = validateProposalCitations(citedFacts, citedFacts);
    expect(result.valid).toBe(true);
  });

  it("rejects/flags a proposal whose citation does NOT resolve to a real outbox/audit row (fabricated sourceId)", async () => {
    const reader = new InMemoryShiftDeltaReader(
      [],
      [outboxRow({ id: "15", type: "equipment_custody_state_changed" })],
    );
    const { citedFacts: groundTruth } = await aggregateDeltasViaReader(CLINIC_A, WINDOW, reader);

    const fabricated: ActionProposalCitedFact = {
      sourceTable: "vt_event_outbox",
      sourceId: "999999-does-not-exist",
      kind: "equipment_custody_state_changed",
      category: "custody",
      at: new Date().toISOString(),
    };

    const singleResult = validateProposalCitation(fabricated, groundTruth);
    expect(singleResult.valid).toBe(false);
    if (!singleResult.valid) {
      expect(singleResult.errors.some((e) => e.startsWith("citation_not_grounded:"))).toBe(true);
    }

    const tampered = [...groundTruth, fabricated];
    const wholeResult = validateProposalCitations(tampered, groundTruth);
    expect(wholeResult.valid).toBe(false);

    // The untampered set still passes — the check only flags the fabricated addition.
    expect(validateProposalCitations(groundTruth, groundTruth).valid).toBe(true);
  });
});

describe("Task 0.3 spike — approve/edit/reject (operations-memory capture)", () => {
  async function stageOne(writer: InMemoryActionProposalWriter): Promise<ActionProposalRecord> {
    const reader = new InMemoryShiftDeltaReader(
      [auditRow({ id: "aud-uuid-2", actionType: "equipment_returned", targetId: "eq-2" })],
      [outboxRow({ id: "21", type: "task_completed" })],
    );
    const { deltas } = await aggregateDeltasViaReader(CLINIC_A, WINDOW, reader);
    const { proposal } = await composeAndStageHandoverDraft({
      clinicId: CLINIC_A,
      shiftSessionId: SHIFT_SESSION_ID,
      window: WINDOW,
      deltas,
      writer,
    });
    vi.clearAllMocks();
    return proposal;
  }

  it("approve: transitions status, writes a labeled operations-memory decision, and emits action_proposal_approved", async () => {
    const writer = new InMemoryActionProposalWriter();
    const staged = await stageOne(writer);

    const updated = await approveProposal({
      clinicId: CLINIC_A,
      proposalId: staged.id,
      decidedByUserId: "user-vet-1",
      writer,
    });

    expect(updated.status).toBe("approved");
    expect(updated.decidedByUserId).toBe("user-vet-1");
    expect(writer.decisions).toHaveLength(1);
    expect(writer.decisions[0]).toMatchObject({
      proposalId: staged.id,
      decision: "approved",
      decidedByUserId: "user-vet-1",
      stagedSummary: staged.summary,
    });
    expect(writer.decisions[0].stagedCitedFacts).toEqual(staged.citedFacts);

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC_A, actionType: "action_proposal_approved", targetId: staged.id }),
    );
  });

  it("edit: transitions status to edited, captures the edited content as operations-memory, and emits action_proposal_edited", async () => {
    const writer = new InMemoryActionProposalWriter();
    const staged = await stageOne(writer);
    const editedContent = { deltas: { custody: [], taskState: [], alerts: [], dispenses: [] }, note: "corrected by reviewer" };

    const updated = await editProposal({
      clinicId: CLINIC_A,
      proposalId: staged.id,
      decidedByUserId: "user-vet-2",
      editedContent,
      writer,
    });

    expect(updated.status).toBe("edited");
    expect(updated.editedContent).toEqual(editedContent);
    expect(writer.decisions).toHaveLength(1);
    expect(writer.decisions[0].decision).toBe("edited");
    expect(writer.decisions[0].editedContent).toEqual(editedContent);

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC_A, actionType: "action_proposal_edited", targetId: staged.id }),
    );
  });

  it("reject: transitions status to rejected with a reason, captures it as operations-memory, and emits action_proposal_rejected", async () => {
    const writer = new InMemoryActionProposalWriter();
    const staged = await stageOne(writer);

    const updated = await rejectProposal({
      clinicId: CLINIC_A,
      proposalId: staged.id,
      decidedByUserId: "user-vet-3",
      rejectionReason: "duplicate of an earlier verbal handover",
      writer,
    });

    expect(updated.status).toBe("rejected");
    expect(updated.rejectionReason).toBe("duplicate of an earlier verbal handover");
    expect(writer.decisions).toHaveLength(1);
    expect(writer.decisions[0].decision).toBe("rejected");
    expect(writer.decisions[0].rejectionReason).toBe("duplicate of an earlier verbal handover");

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC_A, actionType: "action_proposal_rejected", targetId: staged.id }),
    );
  });

  it("a second decision on an already-decided proposal is rejected, never silently overwritten", async () => {
    const writer = new InMemoryActionProposalWriter();
    const staged = await stageOne(writer);

    await approveProposal({ clinicId: CLINIC_A, proposalId: staged.id, decidedByUserId: "user-vet-1", writer });

    await expect(
      rejectProposal({
        clinicId: CLINIC_A,
        proposalId: staged.id,
        decidedByUserId: "user-vet-4",
        rejectionReason: "too late",
        writer,
      }),
    ).rejects.toThrow();

    // Still exactly one decision recorded (the approve) — the failed reject never appended a second.
    expect(writer.decisions).toHaveLength(1);
  });
});
