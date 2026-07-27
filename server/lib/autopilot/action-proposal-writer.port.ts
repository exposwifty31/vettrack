/**
 * VetTrack 2.0, Task 1.1 §1.3 — `ActionProposalWriter` port. Kind-agnostic:
 * every proposal kind (§2–§5) shares this one port, since it operates only on
 * the common `vt_action_proposal` / `vt_action_proposal_decision` tables.
 *
 * Every method is `clinicId`-scoped — no exceptions (CLAUDE.md multi-tenancy
 * rule). `get`/`findStaged` return nothing (`null` / empty) for a row that
 * exists under a different clinic — never a distinguishable "forbidden"
 * signal that would leak cross-tenant existence.
 */
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, actionProposal, actionProposalDecisionLog } from "../../db.js";
import type {
  ActionProposalRow,
  ActionProposalDecisionRow,
} from "../../schema/ops.js";
import type {
  ActionProposalKind,
  ActionProposalStatus,
  NewActionProposalInput,
} from "./action-proposal-types.js";

export class ActionProposalAlreadyDecidedError extends Error {
  constructor(proposalId: string) {
    super(`Action proposal ${proposalId} has already been decided`);
    this.name = "ActionProposalAlreadyDecidedError";
  }
}

export interface ActionProposalListFilters {
  status?: ActionProposalStatus;
  kind?: ActionProposalKind;
  limit?: number;
  offset?: number;
}

export interface StageActionProposalInput extends NewActionProposalInput {
  citationValidation: unknown;
}

export interface ActionProposalTransitionPatch {
  status: Exclude<ActionProposalStatus, "staged">;
  decidedByUserId: string;
  decidedAt: Date;
  editedContent?: unknown;
  rejectionReason?: string;
}

export interface NewActionProposalDecisionInput {
  proposalId: string;
  clinicId: string;
  stagedSummary: string;
  stagedCitedFacts: unknown;
  stagedDraftContent: unknown;
  decision: Exclude<ActionProposalStatus, "staged">;
  decidedByUserId: string;
  decidedAt: Date;
  editedContent?: unknown;
  rejectionReason?: string;
}

export interface ActionProposalWriter {
  findStaged(clinicId: string, filters?: ActionProposalListFilters): Promise<ActionProposalRow[]>;
  get(clinicId: string, id: string): Promise<ActionProposalRow | null>;
  /** Idempotent per (clinicId, kind, sourceSessionId) — a repeat stage returns the existing row unchanged. */
  stage(input: StageActionProposalInput): Promise<ActionProposalRow>;
  /** Guards `status === "staged"` — throws `ActionProposalAlreadyDecidedError` on a second decision attempt. */
  transition(clinicId: string, id: string, patch: ActionProposalTransitionPatch): Promise<ActionProposalRow>;
  recordDecision(entry: NewActionProposalDecisionInput): Promise<ActionProposalDecisionRow>;
}

export class DrizzleActionProposalWriter implements ActionProposalWriter {
  async findStaged(clinicId: string, filters: ActionProposalListFilters = {}): Promise<ActionProposalRow[]> {
    const conditions = [eq(actionProposal.clinicId, clinicId)];
    if (filters.status) conditions.push(eq(actionProposal.status, filters.status));
    if (filters.kind) conditions.push(eq(actionProposal.kind, filters.kind));

    const query = db
      .select()
      .from(actionProposal)
      .where(and(...conditions))
      .orderBy(desc(actionProposal.createdAt), desc(actionProposal.id));

    if (typeof filters.limit === "number") {
      const limited = query.limit(filters.limit);
      if (typeof filters.offset === "number") return limited.offset(filters.offset);
      return limited;
    }
    return query;
  }

  async get(clinicId: string, id: string): Promise<ActionProposalRow | null> {
    const [row] = await db
      .select()
      .from(actionProposal)
      .where(and(eq(actionProposal.clinicId, clinicId), eq(actionProposal.id, id)))
      .limit(1);
    return row ?? null;
  }

  async stage(input: StageActionProposalInput): Promise<ActionProposalRow> {
    const [existing] = await db
      .select()
      .from(actionProposal)
      .where(
        and(
          eq(actionProposal.clinicId, input.clinicId),
          eq(actionProposal.kind, input.kind),
          eq(actionProposal.sourceSessionId, input.sourceSessionId),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [row] = await db
      .insert(actionProposal)
      .values({
        id: randomUUID(),
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
      .onConflictDoNothing({
        target: [actionProposal.clinicId, actionProposal.kind, actionProposal.sourceSessionId],
      })
      .returning();

    if (row) return row;

    // Lost the race against a concurrent stage of the same triple.
    const winner = await this.stage(input);
    return winner;
  }

  async transition(
    clinicId: string,
    id: string,
    patch: ActionProposalTransitionPatch,
  ): Promise<ActionProposalRow> {
    const [row] = await db
      .update(actionProposal)
      .set({
        status: patch.status,
        editedContent: patch.editedContent ?? null,
        rejectionReason: patch.rejectionReason ?? null,
        decidedByUserId: patch.decidedByUserId,
        decidedAt: patch.decidedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionProposal.clinicId, clinicId),
          eq(actionProposal.id, id),
          eq(actionProposal.status, "staged"),
        ),
      )
      .returning();

    if (!row) throw new ActionProposalAlreadyDecidedError(id);
    return row;
  }

  async recordDecision(entry: NewActionProposalDecisionInput): Promise<ActionProposalDecisionRow> {
    const [row] = await db
      .insert(actionProposalDecisionLog)
      .values({
        id: randomUUID(),
        proposalId: entry.proposalId,
        clinicId: entry.clinicId,
        stagedSummary: entry.stagedSummary,
        stagedCitedFacts: entry.stagedCitedFacts,
        stagedDraftContent: entry.stagedDraftContent,
        decision: entry.decision,
        decidedByUserId: entry.decidedByUserId,
        decidedAt: entry.decidedAt,
        editedContent: entry.editedContent ?? null,
        rejectionReason: entry.rejectionReason ?? null,
      })
      .returning();
    // Non-null: an unconditional single-row INSERT with .returning() always
    // yields exactly one row — Drizzle's type can't narrow that.
    return row!;
  }
}

/** Test fake. Mirrors the real writer's `clinicId`-scoping semantics — a lookup under the wrong clinic returns nothing. */
export class InMemoryActionProposalWriter implements ActionProposalWriter {
  private readonly proposals = new Map<string, ActionProposalRow>();
  private readonly stagedKeys = new Map<string, string>();
  private readonly decisions: ActionProposalDecisionRow[] = [];

  private stageKey(clinicId: string, kind: string, sourceSessionId: string): string {
    // JSON identity: delimiter concatenation collides when a component
    // contains the delimiter; the serialized tuple cannot.
    return JSON.stringify([clinicId, kind, sourceSessionId]);
  }

  async findStaged(clinicId: string, filters: ActionProposalListFilters = {}): Promise<ActionProposalRow[]> {
    let rows = [...this.proposals.values()]
      .filter((row) => row.clinicId === clinicId)
      .sort((a, b) => {
        const dt = b.createdAt.getTime() - a.createdAt.getTime();
        return dt !== 0 ? dt : b.id.localeCompare(a.id);
      });
    if (filters.status) rows = rows.filter((row) => row.status === filters.status);
    if (filters.kind) rows = rows.filter((row) => row.kind === filters.kind);
    if (typeof filters.offset === "number") rows = rows.slice(filters.offset);
    if (typeof filters.limit === "number") rows = rows.slice(0, filters.limit);
    return rows;
  }

  async get(clinicId: string, id: string): Promise<ActionProposalRow | null> {
    const row = this.proposals.get(id);
    if (!row || row.clinicId !== clinicId) return null;
    return row;
  }

  async stage(input: StageActionProposalInput): Promise<ActionProposalRow> {
    const key = this.stageKey(input.clinicId, input.kind, input.sourceSessionId);
    const existingId = this.stagedKeys.get(key);
    if (existingId) {
      const existing = this.proposals.get(existingId);
      if (existing) return existing;
    }

    const now = new Date();
    const row = {
      id: randomUUID(),
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
      // Test-fake cast: jsonb columns infer as `unknown` on the Drizzle row
      // type; this literal is structurally the row shape but TS can't prove
      // the jsonb fields without the DB round-trip.
    } as unknown as ActionProposalRow;

    this.proposals.set(row.id, row);
    this.stagedKeys.set(key, row.id);
    return row;
  }

  async transition(
    clinicId: string,
    id: string,
    patch: ActionProposalTransitionPatch,
  ): Promise<ActionProposalRow> {
    const row = this.proposals.get(id);
    if (!row || row.clinicId !== clinicId || row.status !== "staged") {
      throw new ActionProposalAlreadyDecidedError(id);
    }

    const updated = {
      ...row,
      status: patch.status,
      editedContent: patch.editedContent ?? null,
      rejectionReason: patch.rejectionReason ?? null,
      decidedByUserId: patch.decidedByUserId,
      decidedAt: patch.decidedAt,
      updatedAt: new Date(),
      // Test-fake cast: spread of a stored row + patch fields is structurally
      // the row shape; TS can't re-narrow the jsonb-typed fields post-spread.
    } as ActionProposalRow;
    this.proposals.set(id, updated);
    return updated;
  }

  async recordDecision(entry: NewActionProposalDecisionInput): Promise<ActionProposalDecisionRow> {
    const row = {
      id: randomUUID(),
      proposalId: entry.proposalId,
      clinicId: entry.clinicId,
      stagedSummary: entry.stagedSummary,
      stagedCitedFacts: entry.stagedCitedFacts,
      stagedDraftContent: entry.stagedDraftContent,
      decision: entry.decision,
      decidedByUserId: entry.decidedByUserId,
      decidedAt: entry.decidedAt,
      editedContent: entry.editedContent ?? null,
      rejectionReason: entry.rejectionReason ?? null,
      // Test-fake cast: same jsonb-column reasoning as the stage() fake above.
    } as unknown as ActionProposalDecisionRow;
    this.decisions.push(row);
    return row;
  }

  /** Test-only accessor — not part of the `ActionProposalWriter` contract. */
  allDecisions(): ActionProposalDecisionRow[] {
    return [...this.decisions];
  }
}
