/**
 * Equipment, rooms, scan/transfer, alerts, and operational-state types (Slice 6c).
 * No imports from ./index.ts.
 */

export type EquipmentStatus =
  | "ok"
  | "issue"
  | "maintenance"
  | "sterilized"
  | "critical"
  | "needs_attention";

export type AlertType = "overdue" | "issue" | "inactive" | "sterilization_due";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export const ALERT_SEVERITY: Record<AlertType, AlertSeverity> = {
  issue: "critical",
  overdue: "high",
  sterilization_due: "medium",
  inactive: "low",
};

export interface CriticalEquipment {
  id: string;
  name: string;
  category: string;
  status: string;
  lastSeenLocation: string | null;
  lastSeenTimestamp: string | null;
}

export interface DeletedEquipment {
  id: string;
  name: string;
  serialNumber?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  status: string;
  deletedAt: string;
  deletedBy?: string | null;
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  type: "manual" | "smart";
  color?: string;
  createdAt: string;
}

export type RoomSyncStatus = "synced" | "stale" | "requires_audit";

export interface Room {
  id: string;
  name: string;
  floor?: string | null;
  masterNfcTagId?: string | null;
  gatewayCode?: string | null;
  syncStatus: RoomSyncStatus;
  lastAuditAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // Computed counts (returned by GET /api/rooms)
  totalEquipment?: number;
  availableCount?: number;
  inUseCount?: number;
  issueCount?: number;
  recentlyVerifiedCount?: number;
  /** Manual patient linked to this room (GET /api/rooms/:id). */
  linkedPatientName?: string | null;
}

export interface RoomActivityEntry {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string | null;
  equipmentId?: string | null;
  equipmentName?: string | null;
  status: string;
  note?: string | null;
  timestamp: string;
}

export interface CreateRoomRequest {
  name: string;
  floor?: string;
  masterNfcTagId?: string;
  gatewayCode?: string;
}

export interface UpdateRoomRequest {
  name?: string;
  floor?: string | null;
  masterNfcTagId?: string | null;
  gatewayCode?: string | null;
  syncStatus?: RoomSyncStatus;
}

export interface BulkVerifyRoomResult {
  affected: number;
  roomName: string;
}

export interface Equipment {
  id: string;
  name: string;
  nameHe?: string | null;
  serialNumber?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  purchaseDate?: string | null;
  expiryDate?: string | null;
  expiryNotifiedAt?: string | null;
  location?: string | null;
  folderId?: string | null;
  folderName?: string | null;
  roomId?: string | null;
  roomName?: string | null;
  department?: string | null;
  nfcTagId?: string | null;
  rfidTagEpc?: string | null;
  lastRfidSeenAt?: string | null;
  lastRfidRoomId?: string | null;
  lastRfidRoomName?: string | null;
  lastRfidGatewayCode?: string | null;
  /** True when last RFID room has at least one vt_docks row (equipment storage). */
  lastRfidRoomIsDock?: boolean;
  lastVerifiedAt?: string | null;
  lastVerifiedById?: string | null;
  lastVerifiedByName?: string | null;
  status: EquipmentStatus;
  lastSeen?: string | null;
  lastStatus?: string | null;
  lastMaintenanceDate?: string | null;
  lastSterilizationDate?: string | null;
  maintenanceIntervalDays?: number | null;
  imageUrl?: string | null;
  // Checkout / ownership
  checkedOutById?: string | null;
  checkedOutByEmail?: string | null;
  checkedOutAt?: string | null;
  checkedOutLocation?: string | null;
  expectedReturnMinutes?: number | null;
  isPluggedIn?: boolean | null;
  plugInDeadlineMinutes?: number | null;
  plugInAlertSentAt?: string | null;
  createdAt: string;
  linkedAnimalId?: string | null;
  linkedAnimalName?: string | null;
  /** Optimistic-concurrency row version; pass back on PATCH to detect conflicts. */
  version?: number;
  usuallyFoundHere?: string | null;
  searchAlias?: string | null;
  staffNote?: string | null;
  // Operational State V1 fields
  custodyState?: "docked" | "checked_out" | "untracked" | "returned" | null;
  custodyStateSince?: string | null;
  readinessState?: "ready" | "not_ready" | "unknown" | null;
  readinessStateSince?: string | null;
  usageState?: "available" | "staged" | "in_use" | "emergency_use" | "procedure_bound" | null;
  usageStateSince?: string | null;
  assetTypeId?: string | null;
  dockId?: string | null;
  dockConfirmedReadyAt?: string | null;
  emergencyOverrideAt?: string | null;
  procedureBoundHospitalizationId?: string | null;
}

export interface CreateEquipmentRequest {
  name: string;
  nameHe?: string | null;
  serialNumber?: string;
  model?: string;
  manufacturer?: string;
  purchaseDate?: string | null;
  expiryDate?: string | null;
  location?: string;
  folderId?: string;
  roomId?: string;
  nfcTagId?: string;
  rfidTagEpc?: string;
  maintenanceIntervalDays?: number;
  expectedReturnMinutes?: number | null;
  imageUrl?: string;
  usuallyFoundHere?: string | null;
  searchAlias?: string | null;
  staffNote?: string | null;
}

export interface UpdateEquipmentRequest {
  name?: string;
  nameHe?: string | null;
  serialNumber?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  purchaseDate?: string | null;
  expiryDate?: string | null;
  location?: string | null;
  folderId?: string | null;
  roomId?: string | null;
  nfcTagId?: string | null;
  rfidTagEpc?: string | null;
  maintenanceIntervalDays?: number | null;
  expectedReturnMinutes?: number | null;
  isPluggedIn?: boolean | null;
  plugInDeadlineMinutes?: number | null;
  imageUrl?: string | null;
  status?: EquipmentStatus;
  usuallyFoundHere?: string | null;
  searchAlias?: string | null;
  staffNote?: string | null;
  /** Optimistic-concurrency token: the `version` last loaded. When set,
   *  the server rejects the PATCH with 409 if the row has since changed. */
  version?: number;
}

export interface EquipmentReturn {
  id: string;
  clinicId: string;
  equipmentId: string;
  returnedById: string;
  returnedByEmail: string;
  returnedAt: string;
  isPluggedIn: boolean;
  plugInDeadlineMinutes: number;
  plugInAlertSentAt?: string | null;
  chargeAlertJobId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReturnRequest {
  equipmentId: string;
  isPluggedIn: boolean;
  plugInDeadlineMinutes?: number;
}

export interface UpdateReturnRequest {
  isPluggedIn?: boolean;
  plugInDeadlineMinutes?: number;
}

/** Response from POST /api/equipment/:id/seen */
export interface ShiftHandoverSummary {
  windowStart: string;
  windowEnd: string;
  windowSource: "open_shift" | "fallback_12h";
  revenueCents: number;
  averageMedicationDelaySeconds: number;
  unreturned: Array<{
    id: string;
    name: string;
    checkedOutAt: string | null;
    checkedOutByEmail: string | null;
    checkedOutLocation: string | null;
  }>;
  expiringAssets: Array<{ id: string; name: string; expiryDate: string | null }>;
  hotAssets: Array<{ id: string; name: string; scans: number }>;
  openShiftSession: {
    id: string;
    startedAt: string;
    startedByUserId: string;
    note: string | null;
  } | null;
}

export type EquipmentSeenResponse =
  | {
      linked: true;
      animal: { id: string; name: string };
      roomId: string;
      usageSessionId: string;
      ledgerId: string;
      idempotentReplay: boolean;
    }
  | {
      linked: false;
      reason: "no_room" | "no_patient_in_room";
      roomId: string | null;
    };

export interface ScanEquipmentRequest {
  status: EquipmentStatus;
  note?: string;
  photoUrl?: string;
}

export interface ScanLog {
  id: string;
  equipmentId: string;
  equipmentName?: string;
  userId: string;
  userEmail: string;
  status: EquipmentStatus;
  note?: string | null;
  photoUrl?: string | null;
  timestamp: string;
  staffName?: string | null;
  staffRole?: string | null;
}

export interface PilotConfig {
  staleMs: number;
  default: number;
}

export interface PilotCoverageItem {
  id: string;
  name: string;
  location?: string | null;
  usuallyFoundHere?: string | null;
  folderName?: string | null;
  lastSeen?: string | null;
  confirmCount: number;
}

export interface PilotCoverageResponse {
  summary: {
    total: number;
    everConfirmed: number;
    confirmedToday: number;
    neverConfirmed: number;
  };
  items: PilotCoverageItem[];
}

export interface TransferLog {
  id: string;
  equipmentId: string;
  equipmentName?: string;
  fromFolderId?: string | null;
  fromFolderName?: string | null;
  toFolderId?: string | null;
  toFolderName?: string | null;
  userId: string;
  timestamp: string;
}

export interface ActivityFeedItem {
  id: string;
  type: "scan" | "transfer" | "created";
  equipmentId: string;
  equipmentName: string;
  status?: EquipmentStatus;
  note?: string | null;
  fromFolder?: string | null;
  toFolder?: string | null;
  userId: string;
  userEmail: string;
  timestamp: string;
}

export interface AnalyticsSummary {
  totalEquipment: number;
  statusBreakdown: {
    ok: number;
    issue: number;
    maintenance: number;
    sterilized: number;
    overdue: number;
    inactive: number;
  };
  maintenanceComplianceRate: number;
  sterilizationComplianceRate: number;
  scanActivity: Array<{ date: string; count: number }>;
  topProblemEquipment: Array<{
    equipmentId: string;
    name: string;
    issueCount: number;
  }>;
}

export interface BulkDeleteRequest {
  ids: string[];
}

export interface BulkMoveRequest {
  ids: string[];
  folderId: string | null;
}

export interface BulkResult {
  affected: number;
}

export interface WhatsAppAlert {
  id: string;
  equipmentId: string;
  equipmentName: string;
  status: EquipmentStatus;
  note?: string;
  phoneNumber?: string;
  message: string;
  sentAt: string;
}

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  equipmentId: string;
  equipmentName: string;
  detail?: string;
  daysOverdue?: number;
}

export interface AlertAcknowledgment {
  id: string;
  equipmentId: string;
  alertType: string;
  acknowledgedById: string;
  acknowledgedByEmail: string;
  acknowledgedAt: string;
}

export const EQUIPMENT_CATEGORIES = [
  "Surgical",
  "Imaging",
  "Anesthesia & Monitoring",
  "Dental",
  "Laboratory",
  "Sterilization (Autoclave)",
  "Pharmacy",
  "Emergency / ICU",
  "General",
] as const;

export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const STATUS_LABELS: Record<EquipmentStatus, string> = {
  ok: "OK",
  issue: "Issue",
  maintenance: "Maintenance",
  sterilized: "Sterilized",
  critical: "Critical",
  needs_attention: "Needs Attention",
};

export const STATUS_COLORS: Record<EquipmentStatus, string> = {
  ok: "bg-emerald-100 text-emerald-800 border-emerald-200",
  issue: "bg-red-100 text-red-800 border-red-200",
  maintenance: "bg-amber-100 text-amber-800 border-amber-200",
  sterilized: "bg-blue-100 text-blue-800 border-blue-200",
  critical: "bg-red-100 text-red-800 border-red-200",
  needs_attention: "bg-orange-100 text-orange-800 border-orange-200",
};

export type CustodyState = "docked" | "checked_out" | "untracked" | "returned";
export type ReadinessState = "ready" | "not_ready" | "unknown";
export type UsageState = "available" | "staged" | "in_use" | "emergency_use" | "procedure_bound";

export interface AssetType {
  id: string;
  clinicId: string;
  name: string;
  createdAt: string;
}

export interface AssetTypeCondition {
  id: string;
  assetTypeId: string;
  conditionName: string;
  verificationMethod: "visual" | "electronic" | "manual";
  staleAfterMinutes: number;
  displayOrder: number;
}

export interface UnitConditionState {
  id: string;
  equipmentId: string;
  conditionId: string;
  verified: boolean;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
  notes?: string | null;
  updatedAt: string;
}

export interface StagingClaim {
  id: string;
  equipmentId: string;
  requestedById: string;
  requestedByName?: string | null;
  clinicalPriority: "routine" | "urgent" | "emergency";
  stagedAt: string;
  expiresAt?: string | null;
  status: "active" | "expired" | "cancelled" | "fulfilled";
  notes?: string | null;
}

export interface DeployabilityResponse {
  equipmentId: string;
  custodyState: CustodyState;
  readinessState: ReadinessState;
  usageState: UsageState;
  fullDeployable: boolean;
  bundleGate: {
    ok: boolean;
    reason?: string;
    failedConditions?: string[];
    staleConditions?: string[];
    unknownConditions?: string[];
  };
  asOfMs: number;
}

export interface Dock {
  id: string;
  clinicId: string;
  name: string;
  description?: string | null;
  roomId?: string | null;
  roomName?: string | null;
  createdAt: string;
}

export type QuickScanToggleAction = "checkout" | "return" | "blocked";

export interface QuickScanToggleResult {
  equipment: Equipment;
  action: QuickScanToggleAction;
  scanLogId: string;
  undoToken: string;
  checkedOutByEmail?: string;
}

export interface DockReturnRequest {
  dockId?: string;
  masterNfcTagId?: string;
  conditionVerifications: Array<{
    conditionId: string;
    verified: boolean;
    notes?: string;
  }>;
}

export interface DockReturnAmbiguousDocksError {
  error: "AMBIGUOUS_DOCKS";
  docks: Array<{ id: string; name: string }>;
}

export interface OperationalMetricsSummary {
  emergencyOverrides: number;
  bundleFailures: number;
  staleConditions: number;
  procedureBounds: number;
  averageCheckoutMs: number | null;
  averageDockReturnMs: number | null;
  deployableSuccessRate: number | null;
  metricsEnabled: boolean;
  from: string;
  to: string;
}
