/**
 * Task notification orchestration — enqueue-only from API paths; worker executes pushes.
 * "Manager" visibility: DB roles are admin | vet | technician | student — TASK_STARTED/COMPLETED
 * notify admin + vet (no `manager` role string in schema).
 */
import { logAudit } from "./audit.js";
import { incrementMetric } from "./metrics.js";
import { enqueueNotificationJob } from "./queue.js";
import { checkDedupe, sendPushToRole, sendPushToUser } from "./push.js";

/** Task lifecycle events that trigger web push orchestration (not DB enums). */
export type TaskNotificationEvent = "TASK_CREATED" | "TASK_STARTED" | "TASK_COMPLETED" | "TASK_CANCELLED";

/** Minimal task snapshot from appointments serialization — clinic-scoped. */
export interface TaskNotificationTask {
  id: string;
  clinicId: string;
  vetId: string | null;
  priority: string;
  animalId?: string | null;
  taskType?: string | null;
  status: string;
  startTime: string;
  endTime: string;
}

export interface TaskNotificationActor {
  userId: string;
  email: string;
  role?: string;
}

function taskTag(event: TaskNotificationEvent, taskId: string): string {
  return `task-${event}-${taskId}`;
}

function formatWindow(startIso: string, endIso: string): string {
  try {
    const s = new Date(startIso);
    const e = new Date(endIso);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
    return `${s.toISOString().slice(0, 16).replace("T", " ")}–${e.toISOString().slice(11, 16)} UTC`;
  } catch {
    return "";
  }
}

/**
 * Executes pushes + audit (runs in BullMQ worker only).
 */
export async function dispatchTaskNotificationSync(
  event: TaskNotificationEvent,
  task: TaskNotificationTask,
  actor?: TaskNotificationActor | null,
): Promise<void> {
  const clinicId = task.clinicId?.trim();
  if (!clinicId) return;

  const priority = task.priority ?? "normal";
  const isCritical = priority === "critical";

  const windowLabel = formatWindow(task.startTime, task.endTime);
  const asset = task.animalId?.trim() || "Unassigned asset";
  const typeLabel = task.taskType?.trim() || "task";
  const taskUrl = "/appointments";

  const payloadFor = (title: string, body: string) => ({
    title,
    body,
    tag: taskTag(event, task.id),
    url: taskUrl,
  });

  try {
    if (event === "TASK_CREATED") {
      if (isCritical) {
        await sendPushToRole(
          clinicId,
          "technician",
          payloadFor(
            "Critical task created",
            `${typeLabel} · ${asset}${windowLabel ? ` · ${windowLabel}` : ""} · ${task.id.slice(0, 8)}…`,
          ),
        );
        logAudit({
          clinicId,
          actionType: "CRITICAL_NOTIFICATION_SENT",
          performedBy: actor?.userId ?? "system",
          performedByEmail: actor?.email ?? "system@vettrack.internal",
          actorRole: actor?.role ?? "system",
          targetId: task.id,
          targetType: "task",
          metadata: {
            event: "TASK_CREATED",
            priority: "critical",
            audience: "technician_role",
          },
        });
        if (process.env.NODE_ENV !== "production") console.log("NOTIFICATION_SENT", { userId: null, clinicId, type: event });
        return;
      }
      if (task.vetId) {
        await sendPushToUser(
          clinicId,
          task.vetId,
          payloadFor(
            "New task assigned",
            `${typeLabel} · ${asset}${windowLabel ? ` · ${windowLabel}` : ""}`,
          ),
        );
        if (process.env.NODE_ENV !== "production") console.log("NOTIFICATION_SENT", { userId: task.vetId, clinicId, type: event });
      }
      return;
    }

    if (event === "TASK_STARTED") {
      const body = `${typeLabel} · ${asset} · ${task.vetId ?? "tech"}${windowLabel ? ` · ${windowLabel}` : ""}`;
      await sendPushToRole(clinicId, "admin", payloadFor("Task started", body));
      await sendPushToRole(clinicId, "vet", payloadFor("Task started", body));
      if (process.env.NODE_ENV !== "production") console.log("NOTIFICATION_SENT", { userId: task.vetId ?? null, clinicId, type: event });
      return;
    }

    if (event === "TASK_COMPLETED") {
      const body = `${typeLabel} · ${asset} · ${task.vetId ?? "tech"}${windowLabel ? ` · ${windowLabel}` : ""}`;
      await sendPushToRole(clinicId, "admin", payloadFor("Task completed", body));
      await sendPushToRole(clinicId, "vet", payloadFor("Task completed", body));
      if (process.env.NODE_ENV !== "production") console.log("NOTIFICATION_SENT", { userId: task.vetId ?? null, clinicId, type: event });
      return;
    }

    if (event === "TASK_CANCELLED") {
      if (task.vetId) {
        await sendPushToUser(
          clinicId,
          task.vetId,
          payloadFor("Task cancelled", `${typeLabel} · ${asset}${windowLabel ? ` · ${windowLabel}` : ""}`),
        );
      }
      return;
    }
  } catch (err) {
    incrementMetric("notifications_failed");
    console.error("[task-notification] dispatch failed:", err);
    throw err;
  }
}

/**
 * Enqueues task notification (no I/O push in request path).
 * Uses {@link checkDedupe} with key `${taskId}:${event}` unless priority is critical (bypass).
 */
export async function sendTaskNotification(
  event: TaskNotificationEvent,
  task: TaskNotificationTask,
  actor?: TaskNotificationActor | null,
): Promise<void> {
  const clinicId = task.clinicId?.trim();
  if (!clinicId) return;

  const priority = task.priority ?? "normal";
  const isCritical = priority === "critical";

  if (!isCritical && checkDedupe(task.id, event)) {
    return;
  }

  await enqueueNotificationJob({
    type: "task_notification",
    event,
    task,
    actor: actor ?? null,
  });
}
