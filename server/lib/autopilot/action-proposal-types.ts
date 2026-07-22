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
 * (§3–§5) cite their own tables — kept open via the `string & {}` idiom so
 * those additions don't require touching this file, while still
 * autocompleting the known members. `vt_shift_equipment_coordinator` /
 * `vt_shifts` (§3, `coordinator_reassign_off_roster`) added explicitly per
 * the plan's instruction to extend this union, not rely on the open idiom
 * alone. `vt_container_items` / `vt_items` (§4, `restock_po_on_burn`) added
 * the same way — both literal DB table names (`vt_items` is the real name
 * behind `server/schema/inventory.ts`'s `inventoryItems` export), keeping
 * the "citation label == real table name" pattern every member follows.
 */
export interface ActionProposalCitedFact {
  sourceId: string;
  sourceTable:
    | "vt_audit_logs"
    | "vt_event_outbox"
    | "vt_shift_equipment_coordinator"
    | "vt_shifts"
    | "vt_container_items"
    | "vt_items"
    | (string & {});
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

/**
 * VetTrack 2.0, Task 1.1 §4 (deliverable E, §1.6's carried-forward
 * per-kind-edit-validation note) — per-kind Zod validation of an edit
 * route's `editedContent` body, keyed by `ActionProposalKind`. Only kinds
 * with a registered schema are checked; a kind with no entry passes
 * through unchecked (matches the other 3 kinds' current unbuilt state —
 * this plan does not retroactively build validation for kinds outside its
 * own scope).
 */
export const restockPoOnBurnEditedContentSchema = z
  .object({
    supplierName: z.string().min(1),
    lines: z
      .array(
        z.object({
          itemId: z.string().min(1),
          quantitySuggested: z.number().int().positive(),
        }),
      )
      .min(1),
  })
  .strict();
export type RestockPoOnBurnEditedContent = z.infer<typeof restockPoOnBurnEditedContentSchema>;

const PER_KIND_EDITED_CONTENT_SCHEMAS: Partial<Record<ActionProposalKind, z.ZodTypeAny>> = {
  restock_po_on_burn: restockPoOnBurnEditedContentSchema,
};

export interface EditedContentValidationResult {
  valid: boolean;
  message?: string;
}

export function validateEditedContentForKind(
  kind: ActionProposalKind,
  editedContent: unknown,
): EditedContentValidationResult {
  const schema = PER_KIND_EDITED_CONTENT_SCHEMAS[kind];
  if (!schema) return { valid: true };
  const result = schema.safeParse(editedContent);
  if (result.success) return { valid: true };
  return { valid: false, message: result.error.issues.map((issue) => issue.message).join("; ") };
}
