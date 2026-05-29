import type {
  AssetTypeCondition,
  EquipmentRfidRead,
  StagingQueueRow,
  UnitConditionState,
} from "../../../db.js";
import type { EquipmentWaitlistSnapshot } from "../../../../shared/equipment-waitlist.js";

/** Clinic-scoped raw evidence — no interpretation. */
export interface EvidenceEquipmentRow {
  id: string;
  clinicId: string;
  name: string;
  custodyState: string;
  custodyStateSince: Date | null;
  checkedOutById: string | null;
  checkedOutByEmail: string | null;
  checkedOutAt: Date | null;
  checkedOutLocation: string | null;
  readinessState: string;
  usageState: string;
  assetTypeId: string | null;
  roomId: string | null;
  dockId: string | null;
  location: string | null;
  lastRfidSeenAt: Date | null;
  lastRfidRoomId: string | null;
  lastSeen: Date | null;
}

export interface EvidenceScanRow {
  id: string;
  clinicId: string;
  equipmentId: string | null;
  status: string;
  timestamp: Date;
  userEmail: string;
}

export interface EvidenceTransferRow {
  id: string;
  clinicId: string;
  equipmentId: string | null;
  timestamp: Date;
  fromFolderName: string | null;
  toFolderName: string | null;
}

export interface EvidenceReturnRow {
  id: string;
  clinicId: string;
  equipmentId: string;
  returnedAt: Date;
  returnedByEmail: string;
}

interface EvidenceRoomRow {
  id: string;
  clinicId: string;
  name: string;
}

type SupersessionEventType =
  | "return"
  | "transfer"
  | "custody_docked"
  | "custody_returned"
  | "custody_untracked"
  | "re_checkout";

export interface SupersessionEvent {
  type: SupersessionEventType;
  id: string;
  observedAt: Date;
}

export interface EvidenceGraph {
  clinicId: string;
  equipmentId: string;
  loadedAt: Date;
  equipment: EvidenceEquipmentRow | null;
  rooms: Array<{ id: string; clinicId: string; name: string }>;
  assetTypeConditions: AssetTypeCondition[];
  unitConditionStates: UnitConditionState[];
  recentScans: EvidenceScanRow[];
  recentTransfers: EvidenceTransferRow[];
  recentRfidReads: EquipmentRfidRead[];
  recentReturns: EvidenceReturnRow[];
  supersessionEvents: SupersessionEvent[];
  waitlist: EquipmentWaitlistSnapshot | null;
  activeStaging: StagingQueueRow[];
}

export interface ResolverContext {
  clinicId: string;
  equipmentId: string;
  now: Date;
  /** When resolving waitlist “my position”. */
  viewerUserId?: string;
}
