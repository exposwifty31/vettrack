import { randomUUID } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, equipmentAnchors, type EquipmentAnchor } from "../db.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type InvalidationReason = "checkout" | "rfid_elsewhere" | "sweep_missing" | "not_found_here";
export type AnchorSource = "return_toggle" | "sweep" | "citizen" | "smart_charger";

export type AnchorEvent =
  | { kind: "time_elapsed" }
  | { kind: "contradiction"; reason: InvalidationReason };

/**
 * Pure D-13 reducer: an anchor is never invalidated by time — only by an
 * explicit contradiction. Already-invalidated is a terminal, idempotent
 * state (no further reason change).
 */
export function nextAnchorState(
  state: { invalidatedAt: Date | null },
  event: AnchorEvent,
): { invalidated: boolean; reason: InvalidationReason | null } {
  if (state.invalidatedAt !== null) {
    return { invalidated: true, reason: null };
  }
  if (event.kind === "contradiction") {
    return { invalidated: true, reason: event.reason };
  }
  return { invalidated: false, reason: null };
}

export type CreateAnchorInput = {
  clinicId: string;
  equipmentId: string;
  dockId?: string | null;
  roomId?: string | null;
  assertedById?: string | null;
  source: AnchorSource;
};

/**
 * Creates a new open anchor, superseding any prior open anchor for this
 * item (invalidated_at set, invalidated_reason left NULL — NULL reason
 * means "superseded", not a contradiction).
 */
export async function createAnchor(tx: Tx | typeof db, input: CreateAnchorInput): Promise<EquipmentAnchor> {
  await tx
    .update(equipmentAnchors)
    .set({ invalidatedAt: new Date() })
    .where(
      and(
        eq(equipmentAnchors.clinicId, input.clinicId),
        eq(equipmentAnchors.equipmentId, input.equipmentId),
        isNull(equipmentAnchors.invalidatedAt),
      ),
    );

  const [inserted] = await tx
    .insert(equipmentAnchors)
    .values({
      id: randomUUID(),
      clinicId: input.clinicId,
      equipmentId: input.equipmentId,
      dockId: input.dockId ?? null,
      roomId: input.roomId ?? null,
      assertedById: input.assertedById ?? null,
      source: input.source,
    })
    .returning();

  if (!inserted) throw new Error("createAnchor: insert returned no row");
  return inserted;
}

export type InvalidateCurrentAnchorInput = {
  clinicId: string;
  equipmentId: string;
  reason: InvalidationReason;
};

/**
 * Contradicts the current open anchor for this item. Idempotent: a no-op
 * when no open anchor exists (D-13 — time never invalidates, so this must
 * be called explicitly and must tolerate being called with nothing open).
 */
export async function invalidateCurrentAnchor(
  tx: Tx | typeof db,
  input: InvalidateCurrentAnchorInput,
): Promise<void> {
  await tx
    .update(equipmentAnchors)
    .set({ invalidatedAt: new Date(), invalidatedReason: input.reason })
    .where(
      and(
        eq(equipmentAnchors.clinicId, input.clinicId),
        eq(equipmentAnchors.equipmentId, input.equipmentId),
        isNull(equipmentAnchors.invalidatedAt),
      ),
    );
}

/** The current open anchor for this item (or null). Clinic-scoped. */
export async function getCurrentAnchor(clinicId: string, equipmentId: string): Promise<EquipmentAnchor | null> {
  const rows = await db
    .select()
    .from(equipmentAnchors)
    .where(
      and(
        eq(equipmentAnchors.clinicId, clinicId),
        eq(equipmentAnchors.equipmentId, equipmentId),
        isNull(equipmentAnchors.invalidatedAt),
      ),
    )
    .orderBy(desc(equipmentAnchors.assertedAt))
    .limit(1);
  return rows[0] ?? null;
}
