import type {
  AssetTypeCondition,
  EquipmentRfidRead,
  StagingQueueRow,
  UnitConditionState,
} from "../../../db.js";
import type { EquipmentWaitlistSnapshot } from "../../../../shared/equipment-waitlist.js";
import type { AnchorSource } from "../../../services/equipment-anchor.service.js";

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
  /** Damage-tracking status (R-EQ-F3). Optional so existing synthetic-graph test fixtures need no changes. */
  conditionStatus?: string;
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

/**
 * The current OPEN anchor for the item (docking P2, design §3.3/§4) — the
 * latest `vt_equipment_anchors` row with `invalidatedAt IS NULL`, joined to
 * `vt_docks` for the station name. Invalidated/superseded anchors never appear
 * here. `null` when the item has no open anchor.
 */
export interface EvidenceCurrentAnchor {
  id: string;
  dockId: string | null;
  dockName: string | null;
  roomId: string | null;
  assertedAt: Date;
  assertedById: string | null;
  source: AnchorSource;
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
  /** Latest OPEN anchor (docking P2) or null — see EvidenceCurrentAnchor. Always set by both loadEvidenceGraph and buildSyntheticEvidenceGraph (never left undefined). */
  currentAnchor: EvidenceCurrentAnchor | null;
}

export interface ResolverContext {
  clinicId: string;
  equipmentId: string;
  now: Date;
  /** When resolving waitlist “my position”. */
  viewerUserId?: string;
}
