import { db, rooms, assetTypes } from "../db.js";
import { and, eq } from "drizzle-orm";

/**
 * Confirms `roomId`/`assetTypeId` (when present) reference rows that
 * actually belong to `clinicId`.
 *
 * The FK constraints on `equipment.homeRoomId`/`assetTypeId` and
 * `docks.roomId`/`assetTypeId` (server/schema/equipment.ts) only guarantee
 * the referenced row exists in *some* clinic — not this one. Without this
 * check, an authenticated admin for one clinic could point an equipment or
 * dock row's home room/category at another clinic's room or asset type, a
 * tenancy-boundary violation (CodeRabbit PR #98, Critical).
 *
 * Shared by `server/routes/docking.ts` (home-assignment single + bulk) and
 * `server/routes/equipment-operational-state.ts` (`createDock`) so the two
 * call sites can't drift.
 */
export async function referencedIdsBelongToClinic(
  clinicId: string,
  roomId: string | null | undefined,
  assetTypeId: string | null | undefined,
): Promise<boolean> {
  if (roomId) {
    const [r] = await db.select({ id: rooms.id }).from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.clinicId, clinicId)));
    if (!r) return false;
  }
  if (assetTypeId) {
    const [a] = await db.select({ id: assetTypes.id }).from(assetTypes)
      .where(and(eq(assetTypes.id, assetTypeId), eq(assetTypes.clinicId, clinicId)));
    if (!a) return false;
  }
  return true;
}
