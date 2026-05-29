import { and, eq } from "drizzle-orm";
import { db, docks, rooms } from "../db.js";

export type DockReturnResolveInput = {
  dockId?: string;
  masterNfcTagId?: string;
};

export type DockReturnResolveResult =
  | { ok: true; dockId: string; via: "dock_id" | "master_nfc_tag" }
  | {
      ok: false;
      status: 404 | 422;
      reason: "dock_not_found" | "room_not_found" | "no_dock_in_room" | "ambiguous_docks";
      docks?: Array<{ id: string; name: string }>;
    };

export async function resolveDockIdForReturn(
  clinicId: string,
  input: DockReturnResolveInput,
): Promise<DockReturnResolveResult> {
  if (input.dockId) {
    const [dock] = await db
      .select({ id: docks.id })
      .from(docks)
      .where(and(eq(docks.id, input.dockId), eq(docks.clinicId, clinicId)))
      .limit(1);
    if (!dock) return { ok: false, status: 404, reason: "dock_not_found" };
    return { ok: true, dockId: dock.id, via: "dock_id" };
  }

  const masterTag = input.masterNfcTagId?.trim();
  if (!masterTag) {
    return { ok: false, status: 422, reason: "dock_not_found" };
  }

  const [room] = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(eq(rooms.clinicId, clinicId), eq(rooms.masterNfcTagId, masterTag)))
    .limit(1);

  if (!room) return { ok: false, status: 404, reason: "room_not_found" };

  const dockRows = await db
    .select({ id: docks.id, name: docks.name })
    .from(docks)
    .where(and(eq(docks.clinicId, clinicId), eq(docks.roomId, room.id)));

  if (dockRows.length === 0) {
    return { ok: false, status: 422, reason: "no_dock_in_room" };
  }
  if (dockRows.length > 1) {
    return {
      ok: false,
      status: 422,
      reason: "ambiguous_docks",
      docks: dockRows.map((d) => ({ id: d.id, name: d.name })),
    };
  }

  return { ok: true, dockId: dockRows[0]!.id, via: "master_nfc_tag" };
}
