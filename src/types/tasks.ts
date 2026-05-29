/**
 * Tasks / appointments / medication execution types (Slice 6d).
 * Unified task model (`Appointment`); no imports from ./index.ts.
 */
import type { ShiftRole, UserRole } from "./platform.js";

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
