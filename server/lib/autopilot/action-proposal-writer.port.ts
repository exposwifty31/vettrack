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

export interface StageOutcome {
  proposal: ActionProposalRow;
  /** False when the (clinicId, kind, sourceSessionId) triple was already staged — the existing row is returned. */
  created: boolean;
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

export interface TransitionAndRecordDecisionMeta {
  stagedSummary: string;
  stagedCitedFacts: unknown;
  stagedDraftContent: unknown;
}

/** Drizzle transaction client from `db.transaction` — mirrors `AuditDbExecutor` (`server/lib/audit.ts`), same technique, this module's own type. */
export type ActionProposalTransactionExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TransitionAndRecordInput {
  clinicId: string;
  proposalId: string;
  patch: ActionProposalTransitionPatch;
  decisionMeta: TransitionAndRecordDecisionMeta;
  /**
   * Task 1.1 §4 — kind-dispatched approve side effect (e.g.
   * `restock_po_on_burn` inserting real `vt_purchase_orders`/`vt_po_lines`
   * rows). Executed INSIDE the same atomic unit as the transition +
   * decision-log append:
   *   - Drizzle impl: inside the same `db.transaction` — receives the `tx`
   *     handle so its inserts commit/rollback together with the transition.
   *     A throw here rolls back the WHOLE transaction, so the proposal
   *     row's `status` update never commits either — the proposal is left
   *     `staged` in the DB, exactly as if the decision never happened.
   *   - InMemory fake: invoked before any of this call's mutations are
   *     applied to the in-memory maps — a throw leaves the proposal
   *     untouched (still staged), mirroring the Drizzle rollback semantics
   *     without a real transaction.
   * `approveProposal` AND `editProposal` (owner decision 2026-07-22: edit =
   * fix-then-execute, running the side effect with the edited content) pass
   * this for kinds with a registered side effect; `rejectProposal`, and any
   * decision on the other 3 kinds, leaves it `undefined` — a pure status
   * flip, unchanged.
   */
  sideEffect?: (tx: ActionProposalTransactionExecutor) => Promise<void>;
}

export interface TransitionAndRecordResult {
  proposal: ActionProposalRow;
  decision: ActionProposalDecisionRow;
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
  stage(input: StageActionProposalInput): Promise<StageOutcome>;
  /** Guards `status === "staged"` — throws `ActionProposalAlreadyDecidedError` on a second decision attempt. */
  transition(clinicId: string, id: string, patch: ActionProposalTransitionPatch): Promise<ActionProposalRow>;
  recordDecision(entry: NewActionProposalDecisionInput): Promise<ActionProposalDecisionRow>;
  /**
   * Task 1.1 §3.A carry-over fix (disclosed in the §1 review): the transition
   * (status flip, guarded on `status === "staged"`) and the decision-log
   * append happen as ONE atomic unit — the Drizzle implementation wraps both
   * in a single `db.transaction`, so a decision-log row exists **iff** the
   * transition succeeded (never an orphaned decision row, never a
   * transitioned proposal with no decision-log entry). `decide()` in
   * `action-proposal-service.ts` calls this instead of `transition` +
   * `recordDecision` separately. `logAudit` stays fire-and-forget OUTSIDE
   * this call, per CLAUDE.md's audit-logging convention.
   */
  transitionAndRecord(input: TransitionAndRecordInput): Promise<TransitionAndRecordResult>;
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
      .orderBy(desc(actionProposal.createdAt));

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

  async stage(input: StageActionProposalInput): Promise<StageOutcome> {
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
    if (existing) return { proposal: existing, created: false };

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

    if (row) return { proposal: row, created: true };

    // Lost the race against a concurrent stage of the same triple.
    const winner = await this.stage(input);
    return { proposal: winner.proposal, created: false };
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

  async transitionAndRecord(input: TransitionAndRecordInput): Promise<TransitionAndRecordResult> {
    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .update(actionProposal)
        .set({
          status: input.patch.status,
          editedContent: input.patch.editedContent ?? null,
          rejectionReason: input.patch.rejectionReason ?? null,
          decidedByUserId: input.patch.decidedByUserId,
          decidedAt: input.patch.decidedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(actionProposal.clinicId, input.clinicId),
            eq(actionProposal.id, input.proposalId),
            eq(actionProposal.status, "staged"),
          ),
        )
        .returning();

      if (!proposal) throw new ActionProposalAlreadyDecidedError(input.proposalId);

      if (input.sideEffect) {
        await input.sideEffect(tx);
      }

      const [decision] = await tx
        .insert(actionProposalDecisionLog)
        .values({
          id: randomUUID(),
          proposalId: proposal.id,
          clinicId: input.clinicId,
          stagedSummary: input.decisionMeta.stagedSummary,
          stagedCitedFacts: input.decisionMeta.stagedCitedFacts,
          stagedDraftContent: input.decisionMeta.stagedDraftContent,
          decision: input.patch.status,
          decidedByUserId: input.patch.decidedByUserId,
          decidedAt: input.patch.decidedAt,
          editedContent: input.patch.editedContent ?? null,
          rejectionReason: input.patch.rejectionReason ?? null,
        })
        .returning();

      if (!decision) throw new Error("transitionAndRecord: decision insert returned no row");
      return { proposal, decision };
    });
  }
}

/** Test fake. Mirrors the real writer's `clinicId`-scoping semantics — a lookup under the wrong clinic returns nothing. */
export class InMemoryActionProposalWriter implements ActionProposalWriter {
  private readonly proposals = new Map<string, ActionProposalRow>();
  private readonly stagedKeys = new Map<string, string>();
  private readonly decisions: ActionProposalDecisionRow[] = [];

  private stageKey(clinicId: string, kind: string, sourceSessionId: string): string {
    return `${clinicId}::${kind}::${sourceSessionId}`;
  }

  async findStaged(clinicId: string, filters: ActionProposalListFilters = {}): Promise<ActionProposalRow[]> {
    let rows = [...this.proposals.values()]
      .filter((row) => row.clinicId === clinicId)
      .sort((a, b) => (b.createdAt as unknown as Date).getTime() - (a.createdAt as unknown as Date).getTime());
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

  async stage(input: StageActionProposalInput): Promise<StageOutcome> {
    const key = this.stageKey(input.clinicId, input.kind, input.sourceSessionId);
    const existingId = this.stagedKeys.get(key);
    if (existingId) {
      const existing = this.proposals.get(existingId);
      if (existing) return { proposal: existing, created: false };
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
    return { proposal: row, created: true };
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
    } as unknown as ActionProposalDecisionRow;
    this.decisions.push(row);
    return row;
  }

  /**
   * Mirrors the Drizzle impl's atomicity: the guard check (`status ===
   * "staged"`) and both mutations (proposal row + decision-log row) happen
   * in one synchronous pass — a throw leaves neither mutated (in-memory is
   * single-threaded, so this is naturally all-or-nothing, matching the real
   * `db.transaction` semantics it stands in for).
   */
  async transitionAndRecord(input: TransitionAndRecordInput): Promise<TransitionAndRecordResult> {
    const row = this.proposals.get(input.proposalId);
    if (!row || row.clinicId !== input.clinicId || row.status !== "staged") {
      throw new ActionProposalAlreadyDecidedError(input.proposalId);
    }

    // Mirrors the Drizzle impl's transaction ordering: the side effect runs
    // AFTER the staged-status guard passes but BEFORE any mutation is
    // applied to `this.proposals`/`this.decisions` below — a throw here
    // propagates out with neither map touched, matching a rolled-back tx.
    if (input.sideEffect) {
      await input.sideEffect(undefined as unknown as ActionProposalTransactionExecutor);
    }

    const updatedProposal = {
      ...row,
      status: input.patch.status,
      editedContent: input.patch.editedContent ?? null,
      rejectionReason: input.patch.rejectionReason ?? null,
      decidedByUserId: input.patch.decidedByUserId,
      decidedAt: input.patch.decidedAt,
      updatedAt: new Date(),
    } as ActionProposalRow;

    const decisionRow = {
      id: randomUUID(),
      proposalId: updatedProposal.id,
      clinicId: input.clinicId,
      stagedSummary: input.decisionMeta.stagedSummary,
      stagedCitedFacts: input.decisionMeta.stagedCitedFacts,
      stagedDraftContent: input.decisionMeta.stagedDraftContent,
      decision: input.patch.status,
      decidedByUserId: input.patch.decidedByUserId,
      decidedAt: input.patch.decidedAt,
      editedContent: input.patch.editedContent ?? null,
      rejectionReason: input.patch.rejectionReason ?? null,
    } as unknown as ActionProposalDecisionRow;

    this.proposals.set(updatedProposal.id, updatedProposal);
    this.decisions.push(decisionRow);
    return { proposal: updatedProposal, decision: decisionRow };
  }

  /** Test-only accessor — not part of the `ActionProposalWriter` contract. */
  allDecisions(): ActionProposalDecisionRow[] {
    return [...this.decisions];
  }
}
