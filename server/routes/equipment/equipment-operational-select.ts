import { equipment } from "../../db.js";

/** V1 operational state columns returned on list/detail reads for deployability UI. */
export const equipmentOperationalStateSelect = {
  custodyState: equipment.custodyState,
  readinessState: equipment.readinessState,
  usageState: equipment.usageState,
  assetTypeId: equipment.assetTypeId,
  dockId: equipment.dockId,
} as const;
