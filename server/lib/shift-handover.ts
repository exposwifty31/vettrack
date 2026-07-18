/**
 * R-SH-F1.1 — shift-handover artifact contract (PMS-agnostic).
 *
 * The single source of truth for the `vt_shift_handover` artifact's JSON shapes
 * and the persistence serializer for its `patientWorklist`. This module imports
 * nothing from the DB layer (zod only) so the schema (`server/schema/ops.ts`)
 * can `import type` from it without a runtime cycle.
 *
 * `patientWorklist` is a discriminated union — NOT a bare nullable — so a PMS
 * failure can never be serialized or read as an empty/ready worklist:
 *   { state: 'not_configured' }                                  // no PMS wired
 *   { state: 'ready', entries: [{ externalId, display, byTechId }] }
 *   { state: 'error', code }                                     // configured, failing
 *
 * `externalId`/`display` are the external PMS (Priza) animal id + label.
 * `byTechId` is the INTERNAL VetTrack `vt_users.id` of the technician who
 * worked that animal — every `byTechId` MUST resolve to a user in the SAME
 * clinic (validated on generate; a cross-clinic id is rejected, never
 * persisted). `code` is a CLOSED enum of safe error codes — never a raw PMS
 * message, identifier, URL, or credential; the serializer strips any such
 * unsafe adapter fields BEFORE persistence.
 */
import { z } from "zod";

/** Closed set of safe worklist error codes — never a raw PMS message/url/credential. */
export const PATIENT_WORKLIST_ERROR_CODES = [
  "unreachable",
  "auth_failed",
  "timeout",
  "malformed",
  "unknown",
] as const;

export type PatientWorklistErrorCode = (typeof PATIENT_WORKLIST_ERROR_CODES)[number];

const patientWorklistEntrySchema = z
  .object({
    externalId: z.string().min(1),
    display: z.string(),
    byTechId: z.string().min(1),
  })
  // `.strip()` (zod default) drops any extra adapter fields (e.g. raw PMS
  // secrets) rather than persisting them.
  .strip();

/**
 * Discriminated-union schema. Each branch strips unknown keys, so a raw adapter
 * `message` / `url` / `credential` smuggled onto the error state is dropped
 * before persistence, and an unknown `error.code` fails the closed enum.
 */
export const patientWorklistSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not_configured") }).strip(),
  z.object({ state: z.literal("ready"), entries: z.array(patientWorklistEntrySchema) }).strip(),
  z.object({ state: z.literal("error"), code: z.enum(PATIENT_WORKLIST_ERROR_CODES) }).strip(),
]);

export type PatientWorklist = z.infer<typeof patientWorklistSchema>;
export type PatientWorklistEntry = z.infer<typeof patientWorklistEntrySchema>;

/** Thrown when a `ready` worklist entry's `byTechId` is not a user in the target clinic. */
export class CrossClinicWorklistError extends Error {
  readonly byTechId: string;
  constructor(byTechId: string) {
    super(`patientWorklist entry byTechId is not a user in the target clinic: ${byTechId}`);
    this.name = "CrossClinicWorklistError";
    this.byTechId = byTechId;
  }
}

export interface SerializePatientWorklistContext {
  /** The internal vt_users.id set for the target clinic — every ready entry's byTechId must be a member. */
  validTechIds: Iterable<string>;
}

/**
 * Validate + normalize a `patientWorklist` for persistence:
 *   - parses against the closed discriminated union (rejects unknown states/codes),
 *   - strips any unsafe adapter fields (message/url/credential/PMS secrets),
 *   - rejects a `ready` entry whose `byTechId` is not in the target clinic's
 *     user set (cross-clinic id — never persisted).
 * Returns a fresh, safe-to-persist object; never mutates the input.
 */
export function serializePatientWorklist(
  input: unknown,
  ctx: SerializePatientWorklistContext,
): PatientWorklist {
  const parsed = patientWorklistSchema.parse(input);
  if (parsed.state === "ready") {
    const valid = ctx.validTechIds instanceof Set ? ctx.validTechIds : new Set(ctx.validTechIds);
    for (const entry of parsed.entries) {
      if (!valid.has(entry.byTechId)) {
        throw new CrossClinicWorklistError(entry.byTechId);
      }
    }
  }
  return parsed;
}

/**
 * A single shift-window delta entry, sourced from `vt_audit_logs` /
 * `vt_event_outbox` (external ids only — no FKs to removed internal tables).
 * The delta generator (R-SH-F1.2) populates these; card R-SH-F1.1 fixes the shape.
 */
export interface ShiftHandoverDeltaEntry {
  /** The source audit-log / outbox id the delta was derived from. */
  sourceId: string;
  /** The audit action-type / outbox event-type. */
  kind: string;
  targetId: string | null;
  targetType: string | null;
  /** ISO-8601 timestamp of the underlying event. */
  at: string;
}

/** The four locked delta dimensions (owner): custody, task-state, alerts, dispenses. */
export interface ShiftHandoverDeltas {
  custody: ShiftHandoverDeltaEntry[];
  taskState: ShiftHandoverDeltaEntry[];
  alerts: ShiftHandoverDeltaEntry[];
  dispenses: ShiftHandoverDeltaEntry[];
}

/** An unresolved item carried across the handover (e.g. an open alert, an in-progress task). */
export interface ShiftHandoverOpenItem {
  id: string;
  kind: string;
  summary: string;
}

/** A system-derived observation attributable to the shift window (custody/scan/readiness/alert). */
export interface ShiftHandoverObservedSignal {
  sourceId: string;
  kind: string;
  at: string;
}
