import { equipment } from "../../db.js";

/** V1 operational state columns returned on list/detail reads for deployability UI. */
export const equipmentOperationalStateSelect = {
  custodyState: equipment.custodyState,
  readinessState: equipment.readinessState,
  usageState: equipment.usageState,
  assetTypeId: equipment.assetTypeId,
  dockId: equipment.dockId,
  // T2.3 (docking P2) — the unified return dialog derives the item's home
  // dock client-side (homeRoomId + assetTypeId matched against listDocks()),
  // so it needs homeRoomId on the same reads as assetTypeId.
  homeRoomId: equipment.homeRoomId,
} as const;
