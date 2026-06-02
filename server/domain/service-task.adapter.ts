/**
 * Pure domain mapping: persisted appointments ↔ service-task vocabulary.
 * No DB imports; safe for serialized API objects.
 */

export type TaskPriority = "critical" | "high" | "normal";
export type TaskType = "maintenance" | "repair" | "inspection";

/** Canonical task status (execution engine). */
export type ServiceTaskStatus = "pending" | "assigned" | "in_progress" | "completed" | "cancelled";

/** All values persisted on vt_appointments.status */
export type DbAppointmentStatus =
  | ServiceTaskStatus
  | "scheduled"
  | "arrived"
  | "no_show";

export interface ServiceTask {
  id: string;
  clinicId: string;
  assetId: string | null;
  locationId: string | null;
  technicianId: string | null;
  startTime: string;
  endTime: string;
  status: ServiceTaskStatus;
  conflictOverride: boolean;
  overrideReason: string | null;
  notes: string | null;
  priority: TaskPriority;
  taskType: TaskType | null;
  createdAt: string;
  updatedAt: string;
}

/** Serialized appointment row (API / DB row shape). */
export type AppointmentLike = {
  id: string;
  clinicId: string;
  animalId?: string | null;
  ownerId?: string | null;
  vetId: string | null;
  startTime: string;
  endTime: string;
  scheduledAt?: string | null;
  completedAt?: string | null;
  status: DbAppointmentStatus;
  conflictOverride: boolean;
  overrideReason?: string | null;
  notes?: string | null;
  priority?: TaskPriority | null;
  taskType?: TaskType | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

/** Map persisted status → canonical task lifecycle status. */
export function dbStatusToServiceStatus(db: string): ServiceTaskStatus {
  switch (db) {
    case "pending":
      return "pending";
    case "assigned":
    case "scheduled":
    case "arrived":
      return "assigned";
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
    case "no_show":
      return "cancelled";
    default:
      return "assigned";
  }
}

export function isTaskActive(serviceStatus: ServiceTaskStatus): boolean {
  return serviceStatus !== "completed" && serviceStatus !== "cancelled";
}

export function toServiceTask(appointment: AppointmentLike): ServiceTask {
  return {
    id: appointment.id,
    clinicId: appointment.clinicId,
    assetId: appointment.animalId ?? null,
    locationId: appointment.ownerId ?? null,
    technicianId: appointment.vetId ?? null,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: dbStatusToServiceStatus(appointment.status),
    conflictOverride: appointment.conflictOverride,
    overrideReason: appointment.overrideReason ?? null,
    notes: appointment.notes ?? null,
    priority: appointment.priority ?? "normal",
    taskType: appointment.taskType ?? null,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

/** Map canonical task status → DB row (prefers new enum values over legacy). */
export function serviceStatusToDbStatus(status: ServiceTaskStatus): DbAppointmentStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "assigned":
      return "assigned";
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "assigned";
  }
}

export function toAppointment(serviceTask: ServiceTask): AppointmentLike {
  return {
    id: serviceTask.id,
    clinicId: serviceTask.clinicId,
    animalId: serviceTask.assetId,
    ownerId: serviceTask.locationId,
    vetId: serviceTask.technicianId,
    startTime: serviceTask.startTime,
    endTime: serviceTask.endTime,
    status: serviceStatusToDbStatus(serviceTask.status),
    conflictOverride: serviceTask.conflictOverride,
    overrideReason: serviceTask.overrideReason,
    notes: serviceTask.notes,
    priority: serviceTask.priority,
    taskType: serviceTask.taskType,
    createdAt: serviceTask.createdAt,
    updatedAt: serviceTask.updatedAt,
  };
}
