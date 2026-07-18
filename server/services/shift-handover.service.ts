/**
 * R-SH-F1.5 — Shift-handover acknowledge / unconfirm service.
 *
 * The read + the two persisted mutations behind `/handoff`:
 *   - `getCurrentHandover`  — the current (max-revision) artifact for a session.
 *   - `acknowledgeHandover` — records `acknowledgedBy` + `acknowledgedAt` and
 *      flips the persisted, clinic-scoped `notificationReadAt` read-state to
 *      *read*. A DELIBERATE confirm (the sanctioned attestation exception to
 *      undo-first). Fires NO push and never retracts a delivered device
 *      notification — it only updates server read-state.
 *   - `unconfirmHandover`   — the persisted UNCONFIRM (`DELETE .../acknowledge`):
 *      clears `acknowledgedBy`/`acknowledgedAt` and restores `notificationReadAt`
 *      → null (unread). Its own `shift_handover_unconfirmed` audit row records
 *      the actor, clinicId, handover id, and the ack→unread transition — the
 *      reversal is server-persisted, not local-only.
 *
 * Authorization: BOTH mutations are gated by `resolveAckAuthorizedUserIds`,
 * which is the SAME next-shift-roster helper (`resolveNextShiftRoster`) that
 * selects the generate push-targets — so the users who may ack are exactly the
 * users who were paged; a cross-clinic user is in neither set.
 *
 * Every read/write carries an explicit `clinicId` predicate on `vt_shift_handover`.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, shiftHandover, users } from "../db.js";
import type { ShiftHandoverRow } from "../schema/ops.js";
import type {
  PatientWorklist,
  ShiftHandoverDeltas,
  ShiftHandoverOpenItem,
  ShiftHandoverObservedSignal,
} from "../lib/shift-handover.js";
import { logAudit } from "../lib/audit.js";
import { resolveShiftWindow } from "../lib/shift-handover-generator.js";
import { resolveNextShiftRoster } from "../lib/shift-handover-roster.js";

/** The handover id did not resolve to a row in the caller's clinic. */
export class ShiftHandoverNotFoundError extends Error {
  constructor(handoverId: string) {
    super(`shift-handover not found: ${handoverId}`);
    this.name = "ShiftHandoverNotFoundError";
  }
}

/** The actor is not on the next-shift roster authorized to (un)acknowledge. */
export class ShiftHandoverAccessError extends Error {
  constructor(handoverId: string, actorUserId: string) {
    super(`user ${actorUserId} is not authorized to acknowledge handover ${handoverId}`);
    this.name = "ShiftHandoverAccessError";
  }
}

export interface AcknowledgeHandoverInput {
  clinicId: string;
  handoverId: string;
  actorUserId: string;
  actorEmail: string;
  actorRole?: string | null;
}

/** Load a single handover row scoped to its clinic (explicit `clinicId` predicate). */
async function loadHandover(clinicId: string, handoverId: string): Promise<ShiftHandoverRow> {
  const [row] = await db
    .select()
    .from(shiftHandover)
    .where(and(eq(shiftHandover.id, handoverId), eq(shiftHandover.clinicId, clinicId)))
    .limit(1);
  if (!row) throw new ShiftHandoverNotFoundError(handoverId);
  return row;
}

/**
 * The users authorized to (un)acknowledge a handover = the next-shift roster for
 * its clinic (resolved off the handover's own shift window end). Identical to
 * the generate push-target set by construction.
 */
export async function resolveAckAuthorizedUserIds(
  clinicId: string,
  handoverId: string,
): Promise<string[]> {
  const row = await loadHandover(clinicId, handoverId);
  const window = await resolveShiftWindow(clinicId, row.shiftSessionId);
  return resolveNextShiftRoster(clinicId, window.end);
}

async function assertAuthorized(clinicId: string, handoverId: string, actorUserId: string): Promise<void> {
  const authorized = await resolveAckAuthorizedUserIds(clinicId, handoverId);
  if (!authorized.includes(actorUserId)) {
    throw new ShiftHandoverAccessError(handoverId, actorUserId);
  }
}

export async function getCurrentHandover(
  clinicId: string,
  shiftSessionId: string,
): Promise<ShiftHandoverRow | null> {
  const [row] = await db
    .select()
    .from(shiftHandover)
    .where(and(eq(shiftHandover.clinicId, clinicId), eq(shiftHandover.shiftSessionId, shiftSessionId)))
    .orderBy(desc(shiftHandover.revision))
    .limit(1);
  return row ?? null;
}

/** The most recently generated handover artifact for a clinic — the /handoff read. */
export async function getLatestHandoverForClinic(clinicId: string): Promise<ShiftHandoverRow | null> {
  const [row] = await db
    .select()
    .from(shiftHandover)
    .where(eq(shiftHandover.clinicId, clinicId))
    .orderBy(desc(shiftHandover.generatedAt), desc(shiftHandover.revision))
    .limit(1);
  return row ?? null;
}

export interface HandoverArtifactStaff {
  userId: string;
  name: string;
}

/**
 * The wire shape the `/handoff` surface consumes: the artifact with ISO
 * timestamps + a resolved `staff` list (worklist `byTechId`s → their VetTrack
 * display names, clinic-scoped) so the client can bidi-isolate LTR staff names
 * without a second round-trip. No PMS ids leak beyond the worklist's own
 * `externalId`/`display`.
 */
export interface SerializedHandoverArtifact {
  id: string;
  shiftSessionId: string;
  revision: number;
  deltas: ShiftHandoverDeltas;
  openItems: ShiftHandoverOpenItem[];
  observedSignals: ShiftHandoverObservedSignal[];
  patientWorklist: PatientWorklist;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  notificationReadAt: string | null;
  generatedAt: string;
  staff: HandoverArtifactStaff[];
}

export async function serializeHandoverArtifact(
  clinicId: string,
  row: ShiftHandoverRow,
): Promise<SerializedHandoverArtifact> {
  const techIds =
    row.patientWorklist.state === "ready"
      ? Array.from(new Set(row.patientWorklist.entries.map((e) => e.byTechId)))
      : [];
  const staff: HandoverArtifactStaff[] = [];
  if (techIds.length > 0) {
    const rows = await db
      .select({ id: users.id, name: users.name, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.clinicId, clinicId), inArray(users.id, techIds)));
    for (const u of rows) {
      staff.push({ userId: u.id, name: u.displayName || u.name || u.id });
    }
  }
  return {
    id: row.id,
    shiftSessionId: row.shiftSessionId,
    revision: row.revision,
    deltas: row.deltas,
    openItems: row.openItems,
    observedSignals: row.observedSignals,
    patientWorklist: row.patientWorklist,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    notificationReadAt: row.notificationReadAt ? row.notificationReadAt.toISOString() : null,
    generatedAt: row.generatedAt.toISOString(),
    staff,
  };
}

/** Records the actor + flips `notificationReadAt` → read. No push, no retraction. */
export async function acknowledgeHandover(input: AcknowledgeHandoverInput): Promise<ShiftHandoverRow> {
  const { clinicId, handoverId, actorUserId, actorEmail, actorRole } = input;
  await loadHandover(clinicId, handoverId); // 404s before authorizing
  await assertAuthorized(clinicId, handoverId, actorUserId);

  const now = new Date();
  const [updated] = await db
    .update(shiftHandover)
    .set({ acknowledgedBy: actorUserId, acknowledgedAt: now, notificationReadAt: now })
    .where(and(eq(shiftHandover.id, handoverId), eq(shiftHandover.clinicId, clinicId)))
    .returning();
  if (!updated) throw new ShiftHandoverNotFoundError(handoverId);

  logAudit({
    clinicId,
    actionType: "shift_handover_acknowledged",
    performedBy: actorUserId,
    performedByEmail: actorEmail,
    targetId: handoverId,
    targetType: "shift_handover",
    actorRole: actorRole ?? null,
    metadata: { readStateTransition: "unread_to_read" },
  });

  return updated;
}

/** Clears the ack + restores `notificationReadAt` → null; writes its own audit row. */
export async function unconfirmHandover(input: AcknowledgeHandoverInput): Promise<ShiftHandoverRow> {
  const { clinicId, handoverId, actorUserId, actorEmail, actorRole } = input;
  await loadHandover(clinicId, handoverId);
  await assertAuthorized(clinicId, handoverId, actorUserId);

  const [updated] = await db
    .update(shiftHandover)
    .set({ acknowledgedBy: null, acknowledgedAt: null, notificationReadAt: null })
    .where(and(eq(shiftHandover.id, handoverId), eq(shiftHandover.clinicId, clinicId)))
    .returning();
  if (!updated) throw new ShiftHandoverNotFoundError(handoverId);

  logAudit({
    clinicId,
    actionType: "shift_handover_unconfirmed",
    performedBy: actorUserId,
    performedByEmail: actorEmail,
    targetId: handoverId,
    targetType: "shift_handover",
    actorRole: actorRole ?? null,
    metadata: { readStateTransition: "read_to_unread" },
  });

  return updated;
}
