/**
 * VetTrack 2.0, Task 1.1 §1.2 — Shift Autopilot `action_proposal` types + Zod
 * contracts, shared across all 4 proposal kinds. Pure types/schemas, no I/O —
 * `server/schema/ops.ts` imports `ActionProposalCitedFact` type-only from here
 * (mirrors its existing type-only import from `../lib/shift-handover.js`).
 */
import { z } from "zod";

export const ACTION_PROPOSAL_KINDS = [
  "shift_handover_draft",
  "coordinator_reassign_off_roster",
  "restock_po_on_burn",
  "crash_cart_drift",
] as const;
export type ActionProposalKind = (typeof ACTION_PROPOSAL_KINDS)[number];

export const ACTION_PROPOSAL_STATUSES = ["staged", "approved", "edited", "rejected"] as const;
export type ActionProposalStatus = (typeof ACTION_PROPOSAL_STATUSES)[number];

/**
 * A single grounding fact a proposal's summary/draft is cited against.
 * `sourceTable` names the DB table the fact came from — the initial two
 * members cover the shift-window content source (§2); later proposal kinds
 * (§3–§5) cite their own tables (e.g. `vt_shift_equipment_coordinator`,
 * `vt_container_items`, `vt_crash_cart_checks`) — kept open via the `string &
 * {}` idiom so those additions don't require touching this file, while still
 * autocompleting the known members.
 */
export interface ActionProposalCitedFact {
  sourceId: string;
  sourceTable: "vt_audit_logs" | "vt_event_outbox" | (string & {});
  kind: string;
  at: string;
}

export interface NewActionProposalInput {
  clinicId: string;
  kind: ActionProposalKind;
  sourceSessionId: string;
  summary: string;
  citedFacts: ActionProposalCitedFact[];
  draftContent: unknown;
  sourceRef: unknown;
}

const nonNullPlainObjectSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => !Array.isArray(value), { message: "must be a plain object, not an array" });

export const approveActionProposalBodySchema = z.object({}).strict();
export type ApproveActionProposalBody = z.infer<typeof approveActionProposalBodySchema>;

export const editActionProposalBodySchema = z
  .object({
    editedContent: nonNullPlainObjectSchema,
  })
  .strict();
export type EditActionProposalBody = z.infer<typeof editActionProposalBodySchema>;

export const rejectActionProposalBodySchema = z
  .object({
    rejectionReason: z.string().min(1),
  })
  .strict();
export type RejectActionProposalBody = z.infer<typeof rejectActionProposalBodySchema>;
