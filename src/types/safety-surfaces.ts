/** Ward display snapshot (`GET /api/display/snapshot`). */
export interface DisplaySnapshotEquipment {
  id: string;
  name: string;
  status: string;
  /** Legacy — true when checked out. */
  inUse: boolean;
  /** Staff holding the unit (display name or email), if checked out. */
  heldBy: string | null;
  /** Last NFC/scan sighting (`vt_equipment.last_seen`). */
  lastCheckInAt: string | null;
  /** Best-effort location: usually-found-here → room → checkout note → static location. */
  probableLocation: string | null;
  /** Docked + ready + available (operational state). */
  isDeployable: boolean;
  custodyState: string;
  readinessState: string;
  usageState: string;
}

export interface DisplaySnapshotTask {
  id: string;
  startTime: string;
  taskType: string | null;
  notes: string | null;
  status?: string;
  animalName?: string | null;
}

export interface DisplaySnapshotCodeBlueSession {
  id: string;
  startedAt: string;
  managerUserName: string;
  preCheckPassed: boolean | null;
  pushSentAt: string;
  linkedEquipment: Array<{ id: string; name: string }>;
  logEntries: Array<{
    elapsedMs: number;
    label: string;
    category: string;
    equipmentId?: string | null;
    loggedByName: string;
  }>;
  presence: Array<{ userId: string; userName: string; lastSeenAt: string }>;
}

export interface DisplaySnapshotHospitalization {
  id: string;
  status: string;
  ward: string | null;
  bay: string | null;
  admittedAt: string;
  admittingVetName?: string | null;
  overdueTaskCount?: number;
  overdueTaskLabel?: string | null;
  animalId?: string;
  animal: {
    name: string;
    species?: string | null;
    breed?: string | null;
    weightKg?: string | null;
  };
}

export interface DisplaySnapshot {
  currentTime: string;
  currentShift: Array<{ employeeName: string; role: string }>;
  hospitalizations: DisplaySnapshotHospitalization[];
  equipment: DisplaySnapshotEquipment[];
  upcomingTasks: DisplaySnapshotTask[];
  overdueTasks: DisplaySnapshotTask[];
  activeAlertCount: number;
  totalOverdueCount: number;
  crashCartStatus: {
    lastCheckedAt: string;
    allPassed: boolean;
    performedByName: string;
  } | null;
  codeBlueSession: DisplaySnapshotCodeBlueSession | null;
}

export interface CrashCartItem {
  id: string;
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

export interface StartCodeBlueRequest {
  patientId?: string | null;
  hospitalizationId?: string | null;
  preCheckPassed?: boolean;
}

export interface StartCodeBlueResponse {
  sessionId: string;
}

export interface EndCodeBlueRequest {
  outcome: "rosc" | "died" | "transferred" | "ongoing";
}

export interface CodeBlueDispense {
  id: string;
  sessionId: string;
  itemName: string;
  quantity: number;
  dispensedAt: string;
}
