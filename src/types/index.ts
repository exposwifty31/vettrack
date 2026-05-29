export * from "./platform.js";
export * from "./patients.js";
export * from "./equipment.js";
export * from "./tasks.js";
export * from "./billing.js";
export * from "./inventory.js";
export * from "./forecast.js";
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
