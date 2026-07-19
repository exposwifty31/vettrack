/**
 * Task 0.3 spike — "Shift Autopilot" propose→approve loop.
 *
 * Wire contract for the `vt_action_proposal` / `vt_action_proposal_decision`
 * tables (server/schema/ops.ts). Kept in a standalone `zod`-only module (no DB
 * imports) so the schema file can `import type` from here without a runtime
 * cycle — mirrors the `server/lib/shift-handover.ts` pattern for the sibling
 * `vt_shift_handover` artifact.
 *
 * PROPOSAL-CARD ANATOMY (decided before the schema was written — see spike
 * findings §1): a staged proposal must carry (a) a human-readable summary,
 * (b) the specific cited source facts (outbox/audit row ids + types) a human
 * reviewer — and `citation-validator`-style grounding checks — can verify,
 * (c) a closed "kind" discriminator, (d) status, (e) who acted + when, (f)
 * clinicId. Everything below is in service of that list.
 */
import { z } from "zod";

/**
 * Closed-but-growing set of proposal kinds. Task 0.3 ships exactly one
 * (`shift_handover_draft`); the roadmap's other 3 (coordinator-reassign,
 * restock-PO, crash-cart-drift) are Task 1.1's job — see spike findings §8.
 * Kept as a `text` column + `$type` narrowing (not a DB enum) so new kinds
 * don't require a schema migration, mirroring the existing
 * `vt_shift_equipment_coordinator.source` precedent in this same file.
 */
export const ACTION_PROPOSAL_KINDS = ["shift_handover_draft"] as const;
export type ActionProposalKind = (typeof ACTION_PROPOSAL_KINDS)[number];

/** Status lifecycle: staged is the only non-terminal state. */
export const ACTION_PROPOSAL_STATUSES = ["staged", "approved", "edited", "rejected"] as const;
export type ActionProposalStatus = (typeof ACTION_PROPOSAL_STATUSES)[number];

/** Decision kinds recorded in the operations-memory table — staged is never a decision. */
export const ACTION_PROPOSAL_DECISIONS = ["approved", "edited", "rejected"] as const;
export type ActionProposalDecision = (typeof ACTION_PROPOSAL_DECISIONS)[number];

/** The four delta dimensions a shift-handover draft's citations are drawn from. */
export const ACTION_PROPOSAL_CITATION_CATEGORIES = [
  "custody",
  "taskState",
  "alerts",
  "dispenses",
] as const;
export type ActionProposalCitationCategory = (typeof ACTION_PROPOSAL_CITATION_CATEGORIES)[number];

/**
 * A single cited source fact — a concrete `vt_audit_logs` or `vt_event_outbox`
 * row this proposal's summary is grounded in. This is what
 * `action-proposal-citation-validator.ts` checks: every citedFact must
 * resolve to a REAL row the reader actually returned for the shift window,
 * never a fabricated id.
 */
export const actionProposalCitedFactSchema = z
  .object({
    sourceTable: z.enum(["vt_audit_logs", "vt_event_outbox"]),
    sourceId: z.string().min(1),
    kind: z.string().min(1),
    category: z.enum(ACTION_PROPOSAL_CITATION_CATEGORIES),
    at: z.string().min(1),
  })
  .strip();
export type ActionProposalCitedFact = z.infer<typeof actionProposalCitedFactSchema>;

/** Traceability back to the shift window the draft was computed from. */
export const actionProposalSourceRefSchema = z
  .object({
    shiftSessionId: z.string().min(1),
    windowStart: z.string().min(1),
    windowEnd: z.string().min(1),
  })
  .strip();
export type ActionProposalSourceRef = z.infer<typeof actionProposalSourceRefSchema>;

/** A snapshot of the automated grounding check at staging time (belt-and-suspenders — a human can see it without re-running the validator). */
export const actionProposalCitationValidationSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(z.string()),
  })
  .strip();
export type ActionProposalCitationValidation = z.infer<typeof actionProposalCitationValidationSchema>;

/**
 * The draft content itself — for `shift_handover_draft`, the same
 * `ShiftHandoverDeltas`-shaped payload the shipped R-SH-F1 artifact stores
 * (server/lib/shift-handover.ts), so a reviewer comparing a proposal against
 * the live auto-published handover is comparing like-for-like shapes. Kept
 * as a loose `Record<string, unknown>` at the schema layer (validated more
 * strictly by the composer, not the DB) — mirrors how `vt_shift_handover`
 * itself types `deltas` as an app-level interface rather than a zod-parsed
 * column.
 */
export type ActionProposalDraftContent = Record<string, unknown>;

export interface ActionProposalRecord {
  id: string;
  clinicId: string;
  kind: ActionProposalKind;
  status: ActionProposalStatus;
  sourceSessionId: string;
  summary: string;
  citedFacts: ActionProposalCitedFact[];
  draftContent: ActionProposalDraftContent;
  sourceRef: ActionProposalSourceRef;
  citationValidation: ActionProposalCitationValidation;
  editedContent: ActionProposalDraftContent | null;
  rejectionReason: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewActionProposalInput {
  id: string;
  clinicId: string;
  kind: ActionProposalKind;
  sourceSessionId: string;
  summary: string;
  citedFacts: ActionProposalCitedFact[];
  draftContent: ActionProposalDraftContent;
  sourceRef: ActionProposalSourceRef;
  citationValidation: ActionProposalCitationValidation;
}

export interface ActionProposalTransitionInput {
  status: Exclude<ActionProposalStatus, "staged">;
  decidedByUserId: string;
  editedContent?: ActionProposalDraftContent | null;
  rejectionReason?: string | null;
}

export interface ActionProposalDecisionRecord {
  id: string;
  clinicId: string;
  proposalId: string;
  kind: ActionProposalKind;
  decision: ActionProposalDecision;
  decidedByUserId: string;
  decidedAt: string;
  stagedSummary: string;
  stagedCitedFacts: ActionProposalCitedFact[];
  stagedDraftContent: ActionProposalDraftContent;
  editedContent: ActionProposalDraftContent | null;
  rejectionReason: string | null;
}
