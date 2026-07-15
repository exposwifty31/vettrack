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
  /** Items homed to this room WITH a category (docking P3 T3.3, design §6.4). */
  expectedFill?: number;
  /** Homed items currently classified "at_home" by the reconciliation ladder. */
  atHomeCount?: number;
  /** Most recent source:"sweep" anchor among items homed to this room (docking P3 T3.4-i-b). */
  lastSweptAt?: string | null;
  /** Display name of whoever asserted that most recent sweep anchor. */
  lastSweptByName?: string | null;
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
  /** Home room assignment (docking P1) — paired with assetTypeId to derive the item's home dock client-side. */
  homeRoomId?: string | null;
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
  // Phase 7e additive KPIs (real-data-backed, point-in-time unless noted).
  readiness?: {
    ready: number;
    notReady: number;
    unknown: number;
    readyPct: number;
    /** Avg dwell (seconds) of equipment currently not_ready — backlog age, not time-to-ready. */
    avgNotReadyDwellSeconds: number | null;
  };
  occupancy?: {
    currentlyCheckedOutPct: number;
    currentlyInUsePct: number;
  };
  perRoom?: Array<{
    roomId: string;
    roomName: string;
    total: number;
    inUse: number;
    ok: number;
    issue: number;
    maintenance: number;
    sterilized: number;
  }>;
  taskOnTime?: {
    onTimeCount: number;
    completedCount: number;
    onTimePct: number | null;
    /** Prior equal-length window; the one genuine week-over-week delta on this payload. */
    previousPct: number | null;
    deltaPct: number | null;
  };
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
  acknowledgedByDisplayName: string | null;
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
  assetTypeId?: string | null;
  assetTypeName?: string | null;
  capacity?: number | null;
  createdAt: string;
}

/** A single item in a docking reconciliation bucket (small projection). */
export interface DockingReconciliationItem {
  id: string;
  name: string;
  homeRoomId: string | null;
  assetTypeId: string | null;
}

/** A single item within the P3 full 8-bucket reconciliation breakdown (T3.6a). */
export interface DockingReconciliationBucketItem {
  id: string;
  name: string;
  bucket: ReconciliationBucket;
  custodyState: string;
  checkedOutById: string | null;
  checkedOutByEmail: string | null;
  homeDockId: string | null;
  homeDockName: string | null;
  homeRoomId: string | null;
}

/**
 * GET /api/docking/reconciliation response — the P1 ownership-derivable
 * buckets (unassigned/noStation/byDock, still consumed by
 * AdminHomeAssignmentPage) plus the P3 full 8-bucket classifier breakdown
 * (counts + byBucket) for the Manager reconciliation worklist.
 *
 * M-5 (phase review): `byBucket.at_home` / `byBucket.checked_out` are
 * trimmed to counts-only (empty arrays) — those two buckets are potentially
 * the whole fleet, and the client only ever renders their `counts`
 * (BucketCountsSummary); ReconciliationWorklist's per-item sections only
 * iterate the 4 drift buckets. The other 6 bucket keys (the 4 drift buckets
 * + unassigned/no_station) still carry full item lists. `counts` is always
 * complete for all 8 buckets.
 */
export interface DockingReconciliation {
  unassigned: DockingReconciliationItem[];
  noStation: DockingReconciliationItem[];
  byDock: Array<{ dock: Dock; expectedFill: number; capacity: number | null }>;
  counts: Record<ReconciliationBucket, number>;
  byBucket: Record<ReconciliationBucket, DockingReconciliationBucketItem[]>;
}

/**
 * The item's current (or superseded) home-station assertion (P2 docking §3.3).
 * Never expires by time — only by contradiction; `invalidatedAt` null means
 * the anchor is currently open. Returned by
 * POST /api/docking/equipment/:id/citizen-anchor.
 */
export interface EquipmentAnchor {
  id: string;
  clinicId: string;
  equipmentId: string;
  dockId: string | null;
  roomId: string | null;
  assertedById: string | null;
  assertedAt: string;
  source: "return_toggle" | "sweep" | "citizen" | "smart_charger";
  invalidatedAt: string | null;
  invalidatedReason: "checkout" | "rfid_elsewhere" | "sweep_missing" | "not_found_here" | null;
  createdAt: string;
}

/** Mirrors ReconciliationBucket in server/services/docking.service.ts (design §6.2). */
export type ReconciliationBucket =
  | "at_home"
  | "checked_out"
  | "returned_unverified"
  | "returned_away"
  | "misplaced_at_station"
  | "missing"
  | "unassigned"
  | "no_station";

/** A single item in the P3 Room Sweep expected list (design §5, §6.2/§6.3). */
export interface RoomSweepItem {
  id: string;
  name: string;
  assetTypeId: string | null;
  custodyState: string;
  checkedOutById: string | null;
  checkedOutByEmail: string | null;
  checkedOutAt?: string | null;
  homeDockId: string | null;
  homeDockName: string | null;
  atStation: boolean;
  bucket: ReconciliationBucket;
}

/** GET /api/docking/rooms/:roomId/sweep response — the expected list for the UI. */
export interface RoomSweepList {
  roomId: string;
  items: RoomSweepItem[];
}

/** POST /api/docking/rooms/:roomId/sweep response — the commit result. */
export interface RoomSweepResult {
  roomId: string;
  confirmedCount: number;
  missingCount: number;
  sweptById: string;
  sweptAt: string;
}

/** Mirrors CoordinatorStatus in server/services/equipment-coordinator.service.ts. */
export type EquipmentCoordinatorStatus = "auto" | "confirmed" | "fallback_senior" | "needs_confirmation" | "unresolved";

export interface EquipmentCoordinatorCandidate {
  userId: string;
  name: string;
}

/** GET /api/docking/coordinator response — this shift date's derived Equipment Coordinator. */
export interface ShiftCoordinatorResult {
  shiftDate: string;
  status: EquipmentCoordinatorStatus;
  coordinatorUserId: string | null;
  coordinatorName: string | null;
  candidates: EquipmentCoordinatorCandidate[];
  seniorTechUserId: string | null;
}

/** POST /api/docking/coordinator response — the stored confirmation row. */
export interface ShiftCoordinatorConfirmation {
  id: string;
  clinicId: string;
  shiftDate: string;
  coordinatorUserId: string;
  source: "auto" | "confirmed" | "fallback_senior";
  assignedByUserId: string | null;
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

/** vt_damage_events row (T-24a schema · R-EQ-F3) — POST /api/equipment/:id/damage (T-24b/c). */
export interface DamageReport {
  id: string;
  clinicId: string;
  equipmentId: string;
  reportedBy: string;
  at: string;
  note: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface CreateDamageReportRequest {
  equipmentId: string;
  note?: string;
}

export interface CreateDamageReportResponse {
  /** The route returns a subset of the row (no clinicId/resolvedAt/createdAt). */
  damageEvent: Pick<DamageReport, "id" | "equipmentId" | "reportedBy" | "at" | "note">;
  conditionStatus: string;
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
