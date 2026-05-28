import { db, undoTokens } from "../../db.js";
import { and, eq, sql } from "drizzle-orm";

export interface EquipmentPreviousState {
  status: string;
  lastSeen: Date | string | null;
  lastStatus: string | null;
  lastMaintenanceDate: Date | string | null;
  lastSterilizationDate: Date | string | null;
  checkedOutById: string | null;
  checkedOutByEmail: string | null;
  checkedOutAt: Date | string | null;
  checkedOutLocation: string | null;
}

export async function consumeUndoToken(
  clinicId: string,
  tokenId: string,
  equipmentId: string,
  actorId: string,
): Promise<{ scanLogId: string; previousState: EquipmentPreviousState } | null> {
  const [entry] = await db
    .update(undoTokens)
    .set({ consumed: true } as Partial<typeof undoTokens.$inferInsert>)
    .where(
      and(
        eq(undoTokens.clinicId, clinicId),
        eq(undoTokens.id, tokenId),
        eq(undoTokens.equipmentId, equipmentId),
        eq(undoTokens.actorId, actorId),
        sql`consumed = false`,
        sql`expires_at > NOW()`,
      ),
    )
    .returning();

  if (!entry) return null;

  return {
    scanLogId: entry.scanLogId,
    previousState: JSON.parse(entry.previousState) as EquipmentPreviousState,
  };
}
