import type { AuthoritySnapshot } from "../../shared/authority.js";

export type EquipmentStatus =
  | "ok"
  | "issue"
  | "maintenance"
  | "sterilized"
  | "critical"
  | "needs_attention";

export type UserRole = "admin" | "vet" | "technician" | "senior_technician" | "student";
export type ShiftRole = "technician" | "senior_technician" | "admin";

export type AlertType = "overdue" | "issue" | "inactive" | "sterilization_due";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export const ALERT_SEVERITY: Record<AlertType, AlertSeverity> = {
  issue: "critical",
  overdue: "high",
  sterilization_due: "medium",
  inactive: "low",
};

export type UserStatus = "pending" | "active" | "blocked";

export interface User {
  id: string;
  clerkId: string;
  email: string;
  name: string;
  displayName: string;
  role: UserRole;
  secondaryRole?: string | null;
  effectiveRole?: UserRole | ShiftRole;
  roleSource?: "shift" | "permanent";
  activeShift?: Shift | null;
  resolvedAt?: string;
  status: UserStatus;
  createdAt: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  authority?: AuthoritySnapshot;
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
}

export interface UpdateRoomRequest {
  name?: string;
  floor?: string | null;
  masterNfcTagId?: string | null;
  syncStatus?: RoomSyncStatus;
}

export interface BulkVerifyRoomResult {
  affected: number;
  roomName: string;
}

export interface Equipment {
  id: string;
  name: string;
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
}

export type CodeBlueStatus = "critical" | "needs_attention";

export interface CriticalEquipment {
  id: string;
  name: string;
  category: string;
  status: CodeBlueStatus;
  lastSeenLocation?: string | null;
  lastSeenTimestamp?: string | null;
}

export type CodeBlueOutcome = "rosc" | "died" | "transferred" | "ongoing";

export interface StartCodeBlueRequest {
  localStartedAt?: string;
}

export interface StartCodeBlueResponse {
  id: string;
  startedAt: string;
}

export interface EndCodeBlueRequest {
  outcome?: CodeBlueOutcome;
  notes?: string;
  timeline?: Array<{ elapsed: number; label: string }>;
}

export interface CodeBlueEvent {
  id: string;
  clinicId: string;
  startedAt: string;
  endedAt?: string | null;
  startedByUserId?: string | null;
  outcome?: CodeBlueOutcome | null;
  notes?: string | null;
  timeline: Array<{ elapsed: number; label: string }>;
  createdAt: string;
}

export interface CreateEquipmentRequest {
  name: string;
  serialNumber?: string;
  model?: string;
  manufacturer?: string;
  purchaseDate?: string | null;
  expiryDate?: string | null;
  location?: string;
  folderId?: string;
  roomId?: string;
  nfcTagId?: string;
  maintenanceIntervalDays?: number;
  expectedReturnMinutes?: number | null;
  imageUrl?: string;
  usuallyFoundHere?: string | null;
  searchAlias?: string | null;
  staffNote?: string | null;
}

export interface UpdateEquipmentRequest {
  name?: string;
  serialNumber?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  purchaseDate?: string | null;
  expiryDate?: string | null;
  location?: string | null;
  folderId?: string | null;
  roomId?: string | null;
  nfcTagId?: string | null;
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

export interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  role: ShiftRole;
}

export interface ShiftImport {
  id: string;
  importedAt: string;
  importedBy: string;
  importedByName?: string | null;
  importedByEmail?: string | null;
  filename: string;
  rowCount: number;
}

export interface ShiftCsvRow {
  rowNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  shiftName: string;
  role: ShiftRole;
}

export interface ShiftCsvIssue {
  rowNumber: number;
  reason: string;
  data: Record<string, string>;
}

export interface ShiftImportPreview {
  filename: string;
  summary: {
    totalRows: number;
    validRows: number;
    skippedRows: number;
  };
  rows: ShiftCsvRow[];
  issues: ShiftCsvIssue[];
}

export interface ShiftImportResult {
  importId: string;
  filename: string;
  insertedRows: number;
  skippedRows: number;
  issues: ShiftCsvIssue[];
}

export type AppointmentStatus =
  | "pending"
  | "assigned"
  | "scheduled"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type TaskPriority = "critical" | "high" | "normal";
export type TaskType = "maintenance" | "repair" | "inspection" | "medication";

export interface Appointment {
  id: string;
  clinicId: string;
  animalId?: string | null;
  ownerId?: string | null;
  vetId: string | null;
  startTime: string;
  endTime: string;
  scheduledAt?: string | null;
  completedAt?: string | null;
  status: AppointmentStatus;
  conflictOverride: boolean;
  overrideReason?: string | null;
  notes?: string | null;
  priority?: TaskPriority;
  taskType?: TaskType | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /** Set by task recall dashboard — end_time is before now. */
  isOverdue?: boolean;
}

export interface MedicationExecutionPayload {
  weightKg?: number;
  weightSourcedFromRecord?: boolean;
  prescribedDosePerKg?: number;
  concentrationMgPerMl?: number;
  formularyConcentrationMgPerMl?: number;
  doseUnit?: "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet";
  convertedDoseMgPerKg?: number;
  calculatedVolumeMl?: number;
  concentrationOverridden?: boolean;
  containerId?: string;
}

export interface MedicationExecutionTask extends Appointment {
  animalWeightKg: number | null;
}

export interface DrugFormularyEntry {
  id: string;
  clinicId: string;
  name: string;
  genericName: string;
  brandNames?: string[];
  targetSpecies?: string[] | null;
  category?: string | null;
  dosageNotes?: string | null;
  concentrationMgMl: number;
  standardDose: number;
  minDose?: number | null;
  maxDose?: number | null;
  doseUnit: "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet";
  defaultRoute?: string | null;
  unitType?: "vial" | "ampule" | "tablet" | "capsule" | "bag" | null;
  unitVolumeMl?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDrugFormularyRequest {
  name: string;
  genericName: string;
  brandNames?: string[];
  targetSpecies?: string[];
  category?: string | null;
  dosageNotes?: string | null;
  concentrationMgMl: number;
  standardDose: number;
  minDose?: number | null;
  maxDose?: number | null;
  doseUnit: "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet";
  defaultRoute?: string | null;
  unitType?: "vial" | "ampule" | "tablet" | "capsule" | "bag" | null;
  unitVolumeMl?: number | null;
}

export interface PharmacyForecastExclusion {
  id: string;
  clinicId: string;
  matchSubstring: string;
  note?: string | null;
  createdAt: string;
}

/** GET /api/tasks/dashboard — single payload for Daily Recall UI. */
export interface TaskDashboard {
  today: Appointment[];
  overdue: Appointment[];
  upcoming: Appointment[];
  myTasks: Appointment[];
  counts: {
    today: number;
    overdue: number;
    myTasks: number;
  };
}

/** GET /api/home/dashboard — aggregate "pulse" for the magnetic home dashboard. */
export interface HomeDashboardPulse {
  /** Open clinic shift session, if one is running. */
  shift: { startedAt: string } | null;
  /** Consecutive most-recent days with zero overdue tasks. */
  streak: number;
  /** Tasks marked completed today. */
  tasksCompletedToday: number;
  /** Scans logged by the current user today. */
  scansToday: number;
}

export type RecommendationSuggestionType = "OVERDUE_WARNING" | "START_NOW" | "OVERLOADED" | "PICK_FROM_QUEUE";

export interface RecommendationSuggestion {
  type: RecommendationSuggestionType;
  message: string;
  severity: "high" | "medium" | "low";
}

export interface RecommendedTask extends Appointment {
  reason: string;
  score: number;
  scoreBreakdown: {
    overdue: number;
    critical: number;
    startsSoon: number;
    assigned: number;
    inProgress: number;
  };
}

export interface TaskRecommendations {
  nextBestTask: RecommendedTask | null;
  urgentTasks: Appointment[];
  overloaded: boolean;
  suggestions: RecommendationSuggestion[];
}

export interface CreateAppointmentRequest {
  animalId?: string | null;
  ownerId?: string | null;
  vetId?: string | null;
  startTime: string;
  endTime: string;
  scheduledAt?: string | null;
  status?: AppointmentStatus;
  conflictOverride?: boolean;
  overrideReason?: string | null;
  notes?: string | null;
  priority?: TaskPriority;
  taskType?: TaskType | null;
  metadata?: (Record<string, unknown> & { containerId?: string }) | null;
}

export interface UpdateAppointmentRequest {
  animalId?: string | null;
  ownerId?: string | null;
  vetId?: string | null;
  startTime?: string;
  endTime?: string;
  scheduledAt?: string | null;
  status?: AppointmentStatus;
  conflictOverride?: boolean;
  overrideReason?: string | null;
  notes?: string | null;
  priority?: TaskPriority;
  taskType?: TaskType | null;
  metadata?: Record<string, unknown> | null;
}

export interface VetShiftWindow {
  id: string;
  employeeName: string;
  startTime: string;
  endTime: string;
  role: ShiftRole;
}

export interface AppointmentVetMeta {
  id: string;
  name: string;
  displayName: string;
  role: UserRole;
  shifts: VetShiftWindow[];
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

export interface InventoryContainer {
  id: string;
  clinicId: string;
  name: string;
  department: string;
  targetQuantity: number;
  currentQuantity: number;
  roomId: string | null;
  billingItemId: string | null;
  nfcTagId: string | null;
  supplyTargets?: Array<{
    code: string;
    label: string;
    targetUnits: number;
  }>;
}

export interface RestockSession {
  id: string;
  clinicId: string;
  containerId: string;
  ownedByUserId: string;
  status: "active" | "finished";
  startedAt: string;
  finishedAt: string | null;
}

export interface RestockContainerLine {
  itemId: string | null;
  code: string;
  label: string;
  nfcTagId: string | null;
  expected: number;
  actual: number;
  missing: number;
  sessionObservedQuantity: number | null;
}

export interface RestockContainerView {
  container: InventoryContainer;
  lines: RestockContainerLine[];
  activeSession: RestockSession | null;
}

export interface RestockFinishSummary {
  session: RestockSession;
  totalAdded: number;
  totalRemoved: number;
  itemsMissingCount: number;
}

export interface BillingLedgerEntry {
  id: string;
  clinicId: string;
  animalId: string;
  itemType: "EQUIPMENT" | "CONSUMABLE";
  itemId: string;
  quantity: number;
  unitPriceCents: number;
  totalAmountCents: number;
  idempotencyKey: string;
  status: "pending" | "synced" | "voided";
  createdAt: string;
}

export interface BillingItem {
  id: string;
  clinicId: string;
  code: string;
  description: string;
  unitPriceCents: number;
  chargeKind: "per_scan_hour" | "per_unit";
  createdAt: string;
}

export interface BillingSummary {
  totalCents: number;
  pendingCents: number;
  syncedCents: number;
  voidedCents: number;
  byType: {
    EQUIPMENT: number;
    CONSUMABLE: number;
  };
  byDay: Array<{
    date: string;
    totalCents: number;
  }>;
}

export const INVENTORY_ITEM_CATEGORIES = [
  "IV Access",
  "Syringes",
  "Fluid Lines",
  "Urinary",
  "Wound Care",
  "Monitoring",
  "Feeding",
  "Other",
] as const;

export type InventoryItemCategory = (typeof INVENTORY_ITEM_CATEGORIES)[number];

export interface InventoryItem {
  id: string;
  clinicId: string;
  code: string;
  label: string;
  nfcTagId: string | null;
  category: string | null;
  isBillable: boolean;
  minimumDispenseToCapture: number;
  createdAt: string;
}

export type PurchaseOrderStatus = "draft" | "ordered" | "partial" | "received" | "cancelled";

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  clinicId: string;
  itemId: string;
  itemLabel?: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPriceCents: number;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  clinicId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  orderedAt: string | null;
  expectedAt: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lines?: PurchaseOrderLine[];
}

export interface ShiftHandoverSession {
  id: string;
  clinicId: string;
  startedAt: string;
  endedAt: string | null;
  startedByUserId: string;
  note: string | null;
}

export interface ShiftHandoverSummaryCounts {
  patientCount: number;
  pendingTaskCount: number;
  overdueCount: number;
  unresolvedEmergencyCount: number;
}

export interface ShiftHandoverMedTask {
  id: string;
  status: string;
  drugId: string;
  dueAt: string | null;
}

export interface ShiftHandoverEmergencyDispense {
  id: string;
  createdAt: string;
}

export interface ShiftHandoverActiveAlert {
  alertType: string;
  ackStatus: string;
}

export interface ShiftHandoverPatient {
  hospitalizationId: string;
  animalId: string;
  animalName: string;
  status: string;
  ward: string | null;
  bay: string | null;
  pendingMedicationTasks: ShiftHandoverMedTask[];
  overdueMedicationCount: number;
  unresolvedEmergencyDispenses: ShiftHandoverEmergencyDispense[];
}

export interface ShiftHandoverPatientsResponse {
  patients: ShiftHandoverPatient[];
  activeAlerts: ShiftHandoverActiveAlert[];
  summaryCounts: ShiftHandoverSummaryCounts;
  generatedAt: string;
}

/** Raw snapshot row returned by GET /api/shift-handover/snapshot/latest.
 *  patientsPayload and summaryCounts are historical JSONB — treat as unknown. */
export interface ShiftHandoverSnapshotRecord {
  id: string;
  clinicId: string;
  shiftSessionId: string;
  generatedAt: string;
  patientsPayload: unknown;
  summaryCounts: unknown;
  createdBy: string;
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

export interface UploadUrlRequest {
  name: string;
  size: number;
  contentType: string;
}

export interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
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

export interface SystemMetrics {
  uptime: number;
  memoryMb: number;
  memoryTotalMb: number;
  activeSessions: number;
  pendingSyncCount?: number;
  syncMetrics?: {
    syncSuccessCount: number;
    syncFailCount: number;
  };
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

export type SupportTicketSeverity = "low" | "medium" | "high";
export type SupportTicketStatus = "open" | "in_progress" | "resolved";

export interface SupportTicket {
  id: string;
  title: string;
  description: string;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  userId: string;
  userEmail: string;
  pageUrl?: string | null;
  deviceInfo?: string | null;
  appVersion?: string | null;
  adminNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupportTicketRequest {
  title: string;
  description: string;
  severity: SupportTicketSeverity;
  pageUrl?: string;
  deviceInfo?: string;
  appVersion?: string;
}

export interface AuditLog {
  id: string;
  actionType: string;
  performedBy: string;
  performedByEmail: string;
  /** Resolved from vt_users when performedBy matches a user id in this clinic. */
  performedByName?: string | null;
  targetId: string | null;
  targetType: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface AuditLogResponse {
  items: AuditLog[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AuditLogFilters {
  actionType?: string;
  from?: string;
  to?: string;
  page?: number;
}

/** ICU pharmacy forecast (mirrors server `server/lib/forecast/types.ts`). */
export type ForecastDrugType = "regular" | "cri" | "prn" | "ld";

export type ForecastFlagReason =
  | "DOSE_HIGH"
  | "DOSE_LOW"
  | "FREQ_MISSING"
  | "DRUG_UNKNOWN"
  | "PRN_MANUAL"
  | "PATIENT_UNKNOWN"
  | "LOW_CONFIDENCE"
  | "LINE_AMBIGUOUS"
  | "FLUID_VS_DRUG_UNCLEAR"
  | "WEIGHT_UNKNOWN"
  | "WEIGHT_UNCERTAIN"
  | "DUPLICATE_LINE"
  | "ALL_DRUGS_EXCLUDED";

export interface ForecastDrugEntry {
  drugName: string;
  concentration: string;
  packDescription: string;
  route: string;
  type: ForecastDrugType;
  quantityUnits: number | null;
  unitLabel: string;
  flags: ForecastFlagReason[];
  /** Administrations per 24h used for quantity (parsed or inferred). */
  administrationsPer24h: number | null;
  /** Total administrations in the selected order window (24 or 72h). */
  administrationsInWindow: number | null;
}

export interface ForecastPatientEntry {
  recordNumber: string;
  name: string;
  species: string;
  breed: string;
  sex: string;
  age: string;
  color: string;
  weightKg: number;
  ownerName: string;
  ownerId: string;
  ownerPhone: string;
  drugs: ForecastDrugEntry[];
  flags: ForecastFlagReason[];
}

export interface ForecastResult {
  windowHours: 24 | 72;
  weekendMode: boolean;
  pdfSourceFormat?: "smartflow" | "generic";
  patients: ForecastPatientEntry[];
  totalFlags: number;
  parsedAt: string;
  parseFailures?: Array<{
    fileName: string;
    message: string;
  }>;
}

/** Response shape from POST /api/forecast/parse */
export type ForecastParseResponse = ForecastResult & { parseId: string };

export interface ForecastApproveResponse {
  orderId: string;
  deliveryMethod: "smtp" | "mailto";
  mailtoUrl?: string;
  /** True when the mailto body was truncated to keep the URL under client limits. */
  mailtoBodyTruncated?: boolean;
  /**
   * Short, sanitized summary of the SMTP failure when the server attempted SMTP and
   * fell back to mailto. Safe to show in UI (contains no credentials).
   */
  smtpFallbackReason?: string;
}

export interface ForecastKeepaliveResponse {
  parseId: string;
  expiresAt: string;
}

export interface DrugAuditEntry {
  forecastedQty: number | null;
  onHandQty: number;
  orderQty: number;
  confirmed: boolean;
}

export interface PatientAuditState {
  recordNumber: string;
  warningAcknowledgements: Record<string, boolean>;
  weightOverride: number | null;
  patientNameOverride: string | null;
  /** keyed by drug.drugName */
  drugs: Record<string, DrugAuditEntry>;
}

export interface AuditState {
  forecastRunId: string;
  patients: Record<string, PatientAuditState>;
}

export interface ForecastApprovePayload {
  parseId: string;
  manualQuantities: Record<string, number>;
  pharmacistDoseAcks: string[];
  auditTrace?: Record<string, { forecastedQty: number | null; onHandQty: number }>;
  patientWeightOverrides?: Record<string, number>;
}

export interface ConsumablesReportEvent {
  id: string;
  containerId: string;
  itemLabel: string;
  quantity: number;
  animalName: string | null;
  takenByDisplayName: string;
  takenAt: string;
  containerName: string;
  isEmergency: boolean;
  pendingCompletion: boolean;
}

export interface UserActivityEntry {
  userId: string;
  userName: string;
  dispensedCount: number;
  billedCount: number;
  captureRatePercent: number;
}

export interface ConsumablesReport {
  totalEvents: number;
  unlinkedCount: number;
  unlinkedPct: number;
  pendingEmergencies: number;
  /** Containers with dispenses in the window that have no matching billing entry. */
  unBilledCount: number;
  byItem: Array<{ itemId: string; label: string; totalQuantity: number }>;
  byAnimal: Array<{ animalId: string | null; animalName: string | null; totalEvents: number }>;
  byUser: Array<{ userId: string; displayName: string; totalEvents: number }>;
  userActivity: UserActivityEntry[];
  events: ConsumablesReportEvent[];
}

export interface LeakageReportItem {
  containerId: string;
  containerName: string;
  unitPriceCents: number;
  dispensedQty: number;
  billedQty: number;
  gapQty: number;
  gapValueCents: number;
  leakagePct: number;
}

export interface LeakageReport {
  from: string;
  to: string;
  summary: {
    totalDispensedQty: number;
    totalBilledQty: number;
    totalGapQty: number;
    totalGapValueCents: number;
    overallLeakagePct: number;
  };
  items: LeakageReportItem[];
}

export interface InventoryContainerWithItems extends InventoryContainer {
  items: Array<{
    id: string;
    itemId: string;
    quantity: number;
    label: string | null;
    code: string | null;
  }>;
}

export interface ActivePatient {
  animalId: string;
  animalName: string;
  species: string | null;
  breed: string | null;
}

// ─── Hospitalization / Active Patients ──────────────────────────────────────

export type HospitalizationStatus =
  | "admitted"
  | "observation"
  | "critical"
  | "recovering"
  | "discharged"
  | "deceased";

export interface Animal {
  id: string;
  clinicId: string;
  ownerId: string | null;
  name: string;
  species: string | null;
  recordNumber: string | null;
  breed: string | null;
  sex: string | null;
  color: string | null;
  weightKg: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Owner {
  id: string;
  clinicId: string;
  fullName: string;
  phone: string | null;
  nationalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Hospitalization {
  id: string;
  clinicId: string;
  animalId: string;
  animal: Animal;
  owner: Owner | null;
  admittedAt: string;
  dischargedAt: string | null;
  status: HospitalizationStatus;
  ward: string | null;
  bay: string | null;
  admissionReason: string | null;
  admittingVetId: string | null;
  admittingVetName: string | null;
  dischargeNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmitPatientRequest {
  animalId?: string;
  animalName?: string;
  species?: string;
  breed?: string;
  sex?: string;
  weightKg?: number;
  ownerName?: string;
  ownerPhone?: string;
  admissionReason?: string;
  ward?: string;
  bay?: string;
  admittingVetId?: string;
}

export interface UpdatePatientRequest {
  animalName?: string;
  species?: string | null;
  breed?: string | null;
  sex?: string | null;
  weightKg?: number | null;
  ward?: string | null;
  bay?: string | null;
  admissionReason?: string | null;
  status?: Exclude<HospitalizationStatus, "discharged">;
}

export interface AnimalSearchResult {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  ownerName: string | null;
}

export interface InventoryJob {
  id: string;
  clinicId: string;
  taskId: string;
  containerId: string;
  requiredVolumeMl: string;
  animalId: string | null;
  status: "pending" | "processing" | "resolved" | "failed";
  retryCount: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

// ─── Ward Display Snapshot ────────────────────────────────────────────────────

export type CodeBlueLogCategory = "drug" | "shock" | "cpr" | "note" | "equipment";

export interface DisplaySnapshotHospitalization {
  id: string;
  animalId: string;
  status: HospitalizationStatus;
  ward: string | null;
  bay: string | null;
  admittingVetName: string | null;
  admittedAt: string;
  animal: {
    name: string;
    species: string | null;
    breed: string | null;
    weightKg: number | null;
  };
  overdueTaskCount: number;
  overdueTaskLabel: string | null;
}

export interface DisplaySnapshotEquipment {
  id: string;
  name: string;
  status: EquipmentStatus;
  inUse: boolean;
  location: string | null;
}

export interface DisplaySnapshotTask {
  id: string;
  startTime: string;
  taskType: TaskType | null;
  notes: string | null;
  animalName: string;
  status: AppointmentStatus;
}

export interface DisplaySnapshotCodeBlueSession {
  id: string;
  startedAt: string;
  managerUserName: string;
  patientId: string | null;
  patientName: string | null;
  patientWeight: number | null;
  patientSpecies: string | null;
  ward: string | null;
  bay: string | null;
  preCheckPassed: boolean | null;
  pushSentAt: string | null;
  logEntries: Array<{
    elapsedMs: number;
    label: string;
    category: CodeBlueLogCategory;
    loggedByName: string;
  }>;
  presence: Array<{
    userId: string;
    userName: string;
    lastSeenAt: string;
  }>;
}

export interface CrashCartItem {
  id: string;
  clinicId: string;
  key: string;
  label: string;
  requiredQty: number;
  expiryWarnDays: number | null;
  sortOrder: number;
  active: boolean;
}

export interface CreateCrashCartItemRequest {
  key: string;
  label: string;
  requiredQty?: number;
  expiryWarnDays?: number | null;
}

export interface UpdateCrashCartItemRequest {
  label?: string;
  requiredQty?: number;
  expiryWarnDays?: number | null;
  sortOrder?: number;
}

export interface DisplaySnapshot {
  currentTime: string;
  currentShift: Array<{ employeeName: string; role: ShiftRole }>;
  hospitalizations: DisplaySnapshotHospitalization[];
  equipment: DisplaySnapshotEquipment[];
  upcomingTasks: DisplaySnapshotTask[];
  activeAlertCount: number;
  totalOverdueCount: number;
  crashCartStatus: {
    lastCheckedAt: string;
    allPassed: boolean;
    performedByName: string;
  } | null;
  codeBlueSession: DisplaySnapshotCodeBlueSession | null;
}

// Code Blue Reconciliation
export interface CodeBlueReconciliationSession {
  sessionId: string;
  patientId: string | null;
  patientName: string | null;
  startedAt: string;
  endedAt: string | null;
  isReconciled: boolean;
  reconciledAt: string | null;
  reconciledByUserId: string | null;
  dispenseCount: number;
  billedCount: number;
  totalBilledCents: number;
}

export interface CodeBlueDispense {
  inventoryLogId: string;
  itemId: string;
  itemName: string;
  quantityDispensed: number;
  dispensedAt: string;
  billingLedgerId: string | null;
  billedCents: number | null;
}

export interface ManualBillingRequest {
  inventoryLogId: string;
  itemId: string;
  quantity: number;
  unitPriceCents: number;
  animalId?: string;
}

// Shift Completion Leaderboard
export interface ShiftCompletionUser {
  userId: string;
  name: string;
  email: string;
  totalScans: number;
  shiftCount: number;
  avgScansPerShift: number;
  zeroCaptureShifts: number;
}

export interface ShiftCompletionResult {
  from: string;
  to: string;
  users: ShiftCompletionUser[];
}



export type {
  ShiftPatientHandoffStatus,
  ShiftPatientHandoffItemStatus,
  HandoffEligiblePatient,
  HandoffEligiblePatientsResponse,
  HandoffEligibleStaff,
  HandoffEligibleStaffResponse,
  CreateHandoffResponse,
  HandoffItemDetail,
  HandoffListItem,
  MyHandoffsResponse,
  HandoffDetailResponse,
  UpsertItemRequest,
  UpsertItemResponse,
  SubmitHandoffRequest,
  SubmitHandoffResponse,
  ReviewHandoffRequest,
  ReviewHandoffResponse,
  CancelHandoffRequest,
  CancelHandoffResponse,
  HandoffItemsInvalidatedError,
} from "../../shared/patient-handoff-types.js";
