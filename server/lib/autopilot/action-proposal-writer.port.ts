/**
 * Task 0.3 spike — writer PORT for staging + transitioning `action_proposal`
 * rows. Mirrors the reader port's interface+fake+real trio: tests use
 * `InMemoryActionProposalWriter` (tests/autopilot-spike.test.ts), production
 * (the worker + the approval route) uses `DrizzleActionProposalWriter`.
 */
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, actionProposal, actionProposalDecisionLog } from "../../db.js";
import type {
  ActionProposalKind,
  ActionProposalRecord,
  ActionProposalDecisionRecord,
  NewActionProposalInput,
  ActionProposalTransitionInput,
} from "./action-proposal-types.js";
import { ACTION_PROPOSAL_DECISIONS } from "./action-proposal-types.js";

export interface ActionProposalWriter {
  /** The current staged proposal for this dedup key, if any (idempotency check). */
  findStaged(
    clinicId: string,
    kind: ActionProposalKind,
    sourceSessionId: string,
  ): Promise<ActionProposalRecord | undefined>;
  get(clinicId: string, id: string): Promise<ActionProposalRecord | undefined>;
  /** Insert a new `staged` row. Callers are responsible for the idempotency check via `findStaged` first. */
  stage(input: NewActionProposalInput): Promise<ActionProposalRecord>;
  /** Approve/edit/reject transition — status moves off `staged` exactly once. */
  transition(
    clinicId: string,
    id: string,
    patch: ActionProposalTransitionInput,
  ): Promise<ActionProposalRecord>;
  /** Append the operations-memory decision row. Never updated once written. */
  recordDecision(record: ActionProposalDecisionRecord): Promise<void>;
}

function toRecord(row: typeof actionProposal.$inferSelect): ActionProposalRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    kind: row.kind,
    status: row.status,
    sourceSessionId: row.sourceSessionId,
    summary: row.summary,
    citedFacts: row.citedFacts,
    draftContent: row.draftContent,
    sourceRef: row.sourceRef,
    citationValidation: row.citationValidation,
    editedContent: row.editedContent ?? null,
    rejectionReason: row.rejectionReason ?? null,
    decidedByUserId: row.decidedByUserId ?? null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Real Drizzle implementation — clinicId-scoped on every read/write. Typecheck-only in this spike (not route-wired beyond the minimal approval route). */
export class DrizzleActionProposalWriter implements ActionProposalWriter {
  async findStaged(
    clinicId: string,
    kind: ActionProposalKind,
    sourceSessionId: string,
  ): Promise<ActionProposalRecord | undefined> {
    const [row] = await db
      .select()
      .from(actionProposal)
      .where(
        and(
          eq(actionProposal.clinicId, clinicId),
          eq(actionProposal.kind, kind),
          eq(actionProposal.sourceSessionId, sourceSessionId),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  async get(clinicId: string, id: string): Promise<ActionProposalRecord | undefined> {
    const [row] = await db
      .select()
      .from(actionProposal)
      .where(and(eq(actionProposal.id, id), eq(actionProposal.clinicId, clinicId)))
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  async stage(input: NewActionProposalInput): Promise<ActionProposalRecord> {
    const [row] = await db
      .insert(actionProposal)
      .values({
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
      })
      .returning();
    if (!row) throw new Error("action-proposal: INSERT ... RETURNING produced no row");
    return toRecord(row);
  }

  async transition(
    clinicId: string,
    id: string,
    patch: ActionProposalTransitionInput,
  ): Promise<ActionProposalRecord> {
    const [row] = await db
      .update(actionProposal)
      .set({
        status: patch.status,
        decidedByUserId: patch.decidedByUserId,
        decidedAt: new Date(),
        editedContent: patch.editedContent ?? null,
        rejectionReason: patch.rejectionReason ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionProposal.id, id),
          eq(actionProposal.clinicId, clinicId),
          eq(actionProposal.status, "staged"),
        ),
      )
      .returning();
    if (!row) {
      throw new Error(`action-proposal: no staged proposal ${id} for clinic ${clinicId}`);
    }
    return toRecord(row);
  }

  async recordDecision(record: ActionProposalDecisionRecord): Promise<void> {
    if (!ACTION_PROPOSAL_DECISIONS.includes(record.decision)) {
      throw new Error(`action-proposal: invalid decision kind ${record.decision}`);
    }
    await db.insert(actionProposalDecisionLog).values({
      id: record.id,
      clinicId: record.clinicId,
      proposalId: record.proposalId,
      kind: record.kind,
      decision: record.decision,
      decidedByUserId: record.decidedByUserId,
      decidedAt: new Date(record.decidedAt),
      stagedSummary: record.stagedSummary,
      stagedCitedFacts: record.stagedCitedFacts,
      stagedDraftContent: record.stagedDraftContent,
      editedContent: record.editedContent ?? null,
      rejectionReason: record.rejectionReason ?? null,
    });
  }
}

/** Convenience factory so callers don't need `randomUUID` imported separately. */
export function newActionProposalId(): string {
  return randomUUID();
}
