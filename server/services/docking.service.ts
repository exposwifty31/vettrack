import type { Dock } from "../db.js";

type HomeDockInput = { homeRoomId: string | null; assetTypeId: string | null };
type DockLike = Pick<Dock, "id" | "roomId" | "assetTypeId"> & Record<string, unknown>;

export function resolveHomeDock<T extends DockLike>(input: HomeDockInput, docksInRoom: T[]): T | null {
  if (!input.homeRoomId || !input.assetTypeId) return null;
  return docksInRoom.find((d) => d.roomId === input.homeRoomId && d.assetTypeId === input.assetTypeId) ?? null;
}

export function dockExpectedFill(
  dock: { roomId: string | null; assetTypeId: string | null },
  equipment: Array<{ homeRoomId: string | null; assetTypeId: string | null }>,
): number {
  if (!dock.roomId || !dock.assetTypeId) return 0;
  return equipment.filter((e) => e.homeRoomId === dock.roomId && e.assetTypeId === dock.assetTypeId).length;
}

/**
 * Room readiness (design doc §6.4) is present-vs-expected per category, so
 * an item that's home-roomed but has no category is "Unassigned" (§6.2),
 * not part of a room's expected fill — exclude category-less equipment.
 */
export function roomExpected(
  roomId: string,
  equipment: Array<{ homeRoomId: string | null; assetTypeId: string | null }>,
): number {
  return equipment.filter((e) => e.homeRoomId === roomId && e.assetTypeId !== null).length;
}
