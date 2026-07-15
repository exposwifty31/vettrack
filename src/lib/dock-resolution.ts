/**
 * Client-side mirror of `resolveHomeDock` in
 * `server/services/docking.service.ts` — kept in sync by hand since `src/`
 * must not import from `server/`. Matches an item's home room + asset-type
 * category against the clinic's docks to find its home dock, if any.
 */

export interface HomeDockCandidate {
  id: string;
  name: string;
  roomId?: string | null;
  assetTypeId?: string | null;
}

export interface HomeDockInput {
  homeRoomId?: string | null;
  assetTypeId?: string | null;
}

export function resolveHomeDock<T extends HomeDockCandidate>(input: HomeDockInput, docks: T[]): T | null {
  if (!input.homeRoomId || !input.assetTypeId) return null;
  return docks.find((d) => d.roomId === input.homeRoomId && d.assetTypeId === input.assetTypeId) ?? null;
}
