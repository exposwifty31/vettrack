// Barrel re-export. appointments.service.ts was split per ADR-002 (corrected
// two-way split — see docs/architecture/adr-002-appointments-service-split.md
// and docs/architecture/adr-002-correct-stale-medication-split; the original
// ADR's three-way plan, including a medication-execution.service.ts, was
// stale — the medication-execution domain and vetApproveTask were removed by
// e5d5ac8ed five weeks after the ADR was written and never came back) into:
//   - scheduling.service.ts — create/update/cancel, conflict detection, the
//     status state machine, and range/day/vet appointment queries.
//   - task-lifecycle.service.ts — start/complete, technician task queries,
//     and the task-assignment / stale-task-ownership authority wiring.
//
// This file exists only so existing `from ".../appointments.service.js"`
// imports keep working unchanged. Prefer importing directly from the two
// files above in new code. The full export surface below is unchanged from
// the pre-split file — nothing was added, removed, or renamed.

export type { AppointmentInput, AppointmentUpdateInput, AppointmentStatus } from "./scheduling.service.js";
export {
  AppointmentServiceError,
  toUtcDate,
  assertWithinVetShift,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  getAppointmentsByDay,
  getAppointmentsByVet,
  listAppointmentsByRange,
} from "./scheduling.service.js";

export type { TaskAuditActor, TaskPriority, TaskType } from "./task-lifecycle.service.js";
export {
  startTask,
  completeTask,
  getTasksForTechnician,
  getTasksForTechnicianToday,
  getTasksByPriority,
  getActiveTasks,
  getTodayTasks,
  applyTaskAssignmentEvaluator,
  applyStaleTaskOwnershipObservation,
} from "./task-lifecycle.service.js";
