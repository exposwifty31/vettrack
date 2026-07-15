/**
 * Docking P3 T3.4-ii — Room Sweep escalation ladder: DB-backed completion
 * check. Pure stage math (`computeEscalationStage`) lives in
 * sweep-escalation-stage.ts (dependency-free — testable without a DB) and
 * is re-exported here for convenience.
 *
 * "Sweep COMPLETE" (escalation stops): every room with ≥1 item homed to it
 * (`home_room_id`) has a `source:"sweep"` anchor asserted within the
 * current shift window. Rooms with no homed equipment need no sweep.
 */
import { and, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db, equipment, equipmentAnchors } from "../db.js";

export {
  computeEscalationStage,
  DEFAULT_ESCALATION_THRESHOLDS,
  type EscalationStage,
  type EscalationThresholds,
} from "./sweep-escalation-stage.js";

export interface ShiftWindow {
  shiftStart: Date;
  now: Date;
}

/** Distinct non-null `home_room_id` values for the clinic's (non-deleted) equipment. */
async function homedRoomIds(clinicId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ roomId: equipment.homeRoomId })
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), isNotNull(equipment.homeRoomId), isNull(equipment.deletedAt)));
  return new Set(rows.map((r) => r.roomId).filter((id): id is string => Boolean(id)));
}

/**
 * Distinct home-rooms swept within `[shiftStart, now]`. Joins the anchor to
 * the item's `home_room_id` (not the anchor's own `room_id`) — same join
 * shape rooms.ts's per-room "last swept" readout uses, so "swept" always
 * means "the item's home room was confirmed", regardless of which dock the
 * anchor itself points at.
 *
 * A2-7 (CodeRabbit PR #106): a room counts as swept via EITHER of two
 * anchor shapes, both written only by the sweep-commit transaction
 * (docking.ts POST /rooms/:roomId/sweep):
 *  - `source:"sweep"` — a confirmed-present item, windowed on `assertedAt`.
 *  - `invalidated_reason:"sweep_missing"` — an unconfirmed item (A1-1),
 *    windowed on `invalidatedAt` (NOT `assertedAt` — for an item that had
 *    an open anchor from a PRIOR source before being contradicted in place,
 *    `assertedAt` predates this sweep; `invalidatedAt` is when the sweep
 *    itself ran). Without this branch, a sweep that confirms zero items
 *    present (all missing) leaves no `source:"sweep"` anchor at all, so the
 *    room never registers as swept even though the sweep was done.
 */
async function sweptRoomIds(clinicId: string, shiftStart: Date, now: Date): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ roomId: equipment.homeRoomId })
    .from(equipmentAnchors)
    .innerJoin(equipment, and(eq(equipmentAnchors.equipmentId, equipment.id), eq(equipment.clinicId, clinicId)))
    .where(
      and(
        eq(equipmentAnchors.clinicId, clinicId),
        isNotNull(equipment.homeRoomId),
        isNull(equipment.deletedAt),
        or(
          and(
            eq(equipmentAnchors.source, "sweep"),
            gte(equipmentAnchors.assertedAt, shiftStart),
            lte(equipmentAnchors.assertedAt, now),
          ),
          and(
            eq(equipmentAnchors.invalidatedReason, "sweep_missing"),
            isNotNull(equipmentAnchors.invalidatedAt),
            gte(equipmentAnchors.invalidatedAt, shiftStart),
            lte(equipmentAnchors.invalidatedAt, now),
          ),
        ),
      ),
    );
  return new Set(rows.map((r) => r.roomId).filter((id): id is string => Boolean(id)));
}

/**
 * True iff every room with ≥1 item homed to it has been swept within the
 * shift window (homedRooms ⊆ sweptRooms). A clinic with no homed equipment
 * is trivially complete — there is nothing to sweep.
 */
export async function isShiftSweepComplete(clinicId: string, shiftWindow: ShiftWindow): Promise<boolean> {
  const homed = await homedRoomIds(clinicId);
  if (homed.size === 0) return true;

  const swept = await sweptRoomIds(clinicId, shiftWindow.shiftStart, shiftWindow.now);
  for (const roomId of homed) {
    if (!swept.has(roomId)) return false;
  }
  return true;
}
