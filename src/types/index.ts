export * from "./platform.js";
export * from "./patients.js";
export * from "./equipment.js";
export * from "./tasks.js";
export * from "./billing.js";
import type { ShiftRole } from "./platform.js";
import type { HospitalizationStatus } from "./patients.js";
import type { EquipmentStatus } from "./equipment.js";
import type { AppointmentStatus, TaskType } from "./tasks.js";

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

export interface PharmacyForecastExclusion {
  id: string;
  clinicId: string;
  matchSubstring: string;
  note?: string | null;
  createdAt: string;
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

export interface InventoryContainerWithItems extends InventoryContainer {
  items: Array<{
    id: string;
    itemId: string;
    quantity: number;
    label: string | null;
    code: string | null;
  }>;
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
