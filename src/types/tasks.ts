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
export type TaskType = "maintenance" | "repair" | "inspection";

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
  /** Current roster shift (vt_shifts), if the caller is on shift now. */
  shift: { startedAt: string; endsAt: string; role: string } | null;
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
