/**
 * VetTrack 2.0, Task 1.1 §1 — client-side `action_proposal` types. Mirrors the
 * server wire shape (`server/routes/action-proposals.ts`); timestamps are ISO
 * strings. Shared across all 4 proposal kinds — no UI consumes these yet
 * (deferred to the next slice); this is API-client plumbing only.
 */

export type ActionProposalKind =
  | "shift_handover_draft"
  | "coordinator_reassign_off_roster"
  | "restock_po_on_burn"
  | "crash_cart_drift";

export type ActionProposalStatus = "staged" | "approved" | "edited" | "rejected";

export interface ActionProposalCitedFact {
  sourceId: string;
  sourceTable: string;
  kind: string;
  at: string;
}

export interface ActionProposalCitationCheck {
  sourceId: string;
  valid: boolean;
  flag?: string;
}

export interface ActionProposalCitationValidation {
  valid: boolean;
  checks: ActionProposalCitationCheck[];
}

export interface ActionProposal {
  id: string;
  clinicId: string;
  kind: ActionProposalKind;
  status: ActionProposalStatus;
  sourceSessionId: string;
  summary: string;
  citedFacts: ActionProposalCitedFact[];
  draftContent: unknown;
  sourceRef: unknown;
  citationValidation: ActionProposalCitationValidation;
  editedContent: Record<string, unknown> | null;
  rejectionReason: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListActionProposalsResponse {
  proposals: ActionProposal[];
}

export interface ActionProposalResponse {
  proposal: ActionProposal;
}

export interface ListActionProposalsParams {
  status?: ActionProposalStatus;
  kind?: ActionProposalKind;
  limit?: number;
  offset?: number;
}
