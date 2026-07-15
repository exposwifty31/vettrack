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

export type ReconciliationBucket =
  | "at_home"
  | "checked_out"
  | "returned_unverified"
  | "returned_away"
  | "misplaced_at_station"
  | "missing"
  | "unassigned"
  | "no_station";

// Mirrors InvalidationReason in equipment-anchor.service.ts (D-13 contradiction reasons).
type ContradictionReason = "checkout" | "rfid_elsewhere" | "sweep_missing" | "not_found_here";

export type ClassifierItem = {
  checkedOutById: string | null;
  homeRoomId: string | null;
  assetTypeId: string | null;
  roomId: string | null; // current room assignment (presence)
  lastRfidRoomId: string | null; // last RFID-observed room (presence), may be null
};

export type ClassifierCtx = {
  homeDock: { id: string } | null; // resolveHomeDock(...) result for this item
  currentAnchor: { dockId: string | null } | null; // the current OPEN anchor (getCurrentAnchor), or null
  lastContradictionReason: ContradictionReason | null; // reason of the most-recent invalidated anchor when no open anchor
};

/**
 * Reconciliation bucket ladder (design doc §6.2 buckets; §3.3 ownership-vs-presence;
 * D-9 checked-out-first). Order is the spec — do not reorder without re-checking §6.2.
 */
export function classifyReconciliationBucket(item: ClassifierItem, ctx: ClassifierCtx): ReconciliationBucket {
  if (item.checkedOutById) return "checked_out";
  if (!item.homeRoomId || !item.assetTypeId) return "unassigned";
  if (!ctx.homeDock) return "no_station";
  if (ctx.currentAnchor && ctx.currentAnchor.dockId === ctx.homeDock.id) return "at_home";
  if (ctx.currentAnchor) return "misplaced_at_station";

  const presenceRoom = item.lastRfidRoomId ?? item.roomId;
  if (presenceRoom && presenceRoom !== item.homeRoomId) return "returned_away";

  if (ctx.lastContradictionReason === "not_found_here" || ctx.lastContradictionReason === "sweep_missing") {
    return "missing";
  }

  return "returned_unverified";
}
