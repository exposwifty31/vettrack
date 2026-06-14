import { randomUUID } from "crypto";
import { db, equipment, undoTokens } from "../../db.js";
import { and, eq, sql } from "drizzle-orm";
import type { AuditDbExecutor } from "../../lib/audit.js";

type EquipmentRow = typeof equipment.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const _parsedUndoTtl = parseInt(process.env.UNDO_TTL_MS ?? "", 10);
const UNDO_TTL_MS = Number.isFinite(_parsedUndoTtl) && _parsedUndoTtl > 0 ? _parsedUndoTtl : 90_000;

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

type DbExecutor = AuditDbExecutor | typeof db;

export function snapshotEquipmentState(row: EquipmentRow): EquipmentPreviousState {
  return {
    status: row.status,
    lastSeen: row.lastSeen,
    lastStatus: row.lastStatus,
    lastMaintenanceDate: row.lastMaintenanceDate,
    lastSterilizationDate: row.lastSterilizationDate,
    checkedOutById: row.checkedOutById,
    checkedOutByEmail: row.checkedOutByEmail,
    checkedOutAt: row.checkedOutAt,
    checkedOutLocation: row.checkedOutLocation,
  };
}

export async function insertEquipmentUndoToken(
  tx: Tx,
  params: {
    clinicId: string;
    equipmentId: string;
    actorId: string;
    scanLogId: string;
    previousState: EquipmentPreviousState;
  },
): Promise<string> {
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + UNDO_TTL_MS);
  await tx.insert(undoTokens).values({
    id: tokenId,
    clinicId: params.clinicId,
    equipmentId: params.equipmentId,
    actorId: params.actorId,
    scanLogId: params.scanLogId,
    previousState: JSON.stringify(params.previousState),
    expiresAt,
  });
  return tokenId;
}

/**
 * Atomically marks an undo token consumed. Pass the transaction client from
 * `db.transaction` so consumption rolls back with the rest of the revert.
 */
export async function consumeUndoToken(
  clinicId: string,
  tokenId: string,
  equipmentId: string,
  actorId: string,
  executor: DbExecutor = db,
): Promise<{ scanLogId: string; previousState: EquipmentPreviousState } | null> {
  const [entry] = await executor
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
