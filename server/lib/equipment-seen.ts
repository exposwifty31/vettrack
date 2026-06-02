import { and, eq, isNull } from "drizzle-orm";
import { db, equipment } from "../db.js";

/** Transaction client from `db.transaction`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbTx = any;

export type SeenResult =
  | { ok: true; linked: false; roomId: string | null }
  | { ok: false; error: "NOT_FOUND" };

/** Updates equipment last-seen timestamp (no patient linking). */
export async function processEquipmentSeenInTx(params: {
  tx: DbTx;
  clinicId: string;
  equipmentId: string;
  bodyRoomId: string | null | undefined;
  now: Date;
}): Promise<SeenResult> {
  const { tx, clinicId, equipmentId, bodyRoomId, now } = params;

  const [eqRow] = await tx
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
    .limit(1);

  if (!eqRow) return { ok: false, error: "NOT_FOUND" };

  const roomId = bodyRoomId?.trim() || eqRow.roomId || null;

  await tx
    .update(equipment)
    .set({ lastSeen: now })
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)));

  return { ok: true, linked: false, roomId };
}

export async function recordEquipmentSeen(params: {
  clinicId: string;
  equipmentId: string;
  roomId: string | null | undefined;
  scanLogId?: string | null;
}): Promise<SeenResult> {
  const now = new Date();
  return db.transaction(async (tx) =>
    processEquipmentSeenInTx({
      tx,
      clinicId: params.clinicId,
      equipmentId: params.equipmentId,
      bodyRoomId: params.roomId,
      now,
    }),
  );
}
