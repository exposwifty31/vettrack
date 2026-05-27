/**
 * Automation Rules Engine — evaluates task state and enqueues work; DB mutations run in worker jobs only.
 * Idempotency: DATABASE guards (.returning()); Redis is optional cache only, never sole authority.
 * ENABLE_AUTOMATION_ENGINE=true to run.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, gte, notInArray, sql } from "drizzle-orm";
import { appointments, db, users } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { checkIdempotentAsync, markIdempotentAsync } from "../lib/idempotency.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";
import { incrementMetric } from "../lib/metrics.js";
import { broadcast } from "../lib/realtime.js";
import {
  enqueueAutomationExecuteJob,
  enqueueAutomationNotificationJobs,
  type AutomationExecutePayload,
} from "../lib/queue.js";

export const AUTOMATION_ACTOR_ID = "system_automation";
export const AUTOMATION_ACTOR_EMAIL = "automation@vettrack.internal";

export const BATCH = 25;
const PENDING_MIN_AGE_MS = 5 * 60 * 1000;

/** Explicit 30-minute stuck threshold (wall-clock) */
export const THIRTY_MIN_MS = 30 * 60 * 1000;

export function getStuckUpdatedBeforeCutoff(): Date {
  return new Date(Date.now() - THIRTY_MIN_MS);
}

const PRESTART_MS = 10 * 60 * 1000;

const TERMINAL = ["completed", "cancelled"] as const;
const NOT_STARTED = ["pending", "assigned", "scheduled", "arrived"] as const;

export function isAutomationEngineEnabled(): boolean {
  return process.env.ENABLE_AUTOMATION_ENGINE?.trim() === "true";
}

function automationDebugLog(...args: unknown[]): void {
  if (process.env.ENABLE_AUTOMATION_DEBUG === "true") {
    console.log(...args);
  }
}

/** Pick first active admin in clinic (escalation notify target — does not replace vet_id). */
export async function getAdminUserIdForClinic(clinicId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.clinicId, clinicId), eq(users.role, "admin"), eq(users.status, "active"), isNull(users.deletedAt)))
    .orderBy(asc(users.id))
    .limit(1);
  return row?.id ?? null;
}

/** Lowest active-task-load technician in clinic (bounded scan). */
export async function getAvailableTechnician(clinicId: string): Promise<string | null> {
  const techs = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.clinicId, clinicId),
        eq(users.role, "technician"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(users.id))
    .limit(40);

  if (techs.length === 0) return null;
  const ids = techs.map((t) => t.id);
  const activeStatuses = ["pending", "assigned", "scheduled", "arrived", "in_progress"] as const;

  const counts = await db
    .select({ vetId: appointments.vetId, c: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(eq(appointments.clinicId, clinicId), inArray(appointments.vetId, ids), inArray(appointments.status, [...activeStatuses])),
    )
    .groupBy(appointments.vetId);

  const load = new Map<string, number>();
  for (const row of counts) {
    if (row.vetId) load.set(row.vetId, Number(row.c));
  }

  let bestId = ids[0]!;
  let bestLoad = load.get(bestId) ?? 0;
  for (const id of ids) {
    const l = load.get(id) ?? 0;
    if (l < bestLoad) {
      bestLoad = l;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Scheduler tick: find candidates and enqueue automation_execute jobs (no direct DB writes).
 * Candidate sets use DB columns so behavior is correct without Redis.
 */
export async function scanAndEnqueueAutomationJobs(): Promise<void> {
  if (!isAutomationEngineEnabled()) {
    automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: "scan", reason: "ENABLE_AUTOMATION_ENGINE not true", clinicId: "" });
    return;
  }

  await enqueueOverdueEscalations();
  await enqueueUnassignedAutoAssign();
  await enqueueStuckRecovery();
  await enqueuePrestartReminders();
}

async function enqueueOverdueEscalations(): Promise<void> {
  const rows = await db
    .select({ id: appointments.id, clinicId: appointments.clinicId })
    .from(appointments)
    .where(
      and(
        lt(appointments.endTime, sql`now()`),
        notInArray(appointments.status, [...TERMINAL]),
        isNull(appointments.escalatedAt),
      ),
    )
    .orderBy(asc(appointments.endTime))
    .limit(BATCH);

  for (const row of rows) {
    automationDebugLog("AUTOMATION_RULE_TRIGGERED", { rule: "overdue_escalation", taskId: row.id, clinicId: row.clinicId, reason: "candidate" });
    incrementMetric("automation_triggered");
    broadcast(row.clinicId, {
      type: "AUTOMATION_TRIGGERED",
      payload: { rule: "overdue_escalation", taskId: row.id, clinicId: row.clinicId, reason: "candidate" },
    });
    await enqueueAutomationExecuteJob({ kind: "escalate_overdue", taskId: row.id, clinicId: row.clinicId });
  }
}

async function enqueueUnassignedAutoAssign(): Promise<void> {
  const createdBefore = new Date(Date.now() - PENDING_MIN_AGE_MS);
  const rows = await db
    .select({ id: appointments.id, clinicId: appointments.clinicId })
    .from(appointments)
    .where(
      and(
        eq(appointments.status, "pending"),
        isNull(appointments.vetId),
        lt(appointments.createdAt, createdBefore),
      ),
    )
    .orderBy(asc(appointments.createdAt))
    .limit(BATCH);

  for (const row of rows) {
    automationDebugLog("AUTOMATION_RULE_TRIGGERED", { rule: "auto_assign_unassigned", taskId: row.id, clinicId: row.clinicId, reason: "candidate" });
    incrementMetric("automation_triggered");
    broadcast(row.clinicId, {
      type: "AUTOMATION_TRIGGERED",
      payload: { rule: "auto_assign_unassigned", taskId: row.id, clinicId: row.clinicId, reason: "candidate" },
    });
    await enqueueAutomationExecuteJob({ kind: "auto_assign_unassigned", taskId: row.id, clinicId: row.clinicId });
  }
}

async function enqueueStuckRecovery(): Promise<void> {
  const cutoff = getStuckUpdatedBeforeCutoff();
  const rows = await db
    .select({ id: appointments.id, clinicId: appointments.clinicId })
    .from(appointments)
    .where(
      and(
        inArray(appointments.status, ["assigned", "in_progress", "scheduled", "arrived"]),
        lt(appointments.updatedAt, cutoff),
        notInArray(appointments.status, [...TERMINAL]),
        isNull(appointments.stuckNotifiedAt),
      ),
    )
    .orderBy(asc(appointments.updatedAt))
    .limit(BATCH);

  for (const row of rows) {
    automationDebugLog("AUTOMATION_RULE_TRIGGERED", { rule: "stuck_recovery", taskId: row.id, clinicId: row.clinicId, reason: "candidate" });
    incrementMetric("automation_triggered");
    broadcast(row.clinicId, {
      type: "AUTOMATION_TRIGGERED",
      payload: { rule: "stuck_recovery", taskId: row.id, clinicId: row.clinicId, reason: "candidate" },
    });
    await enqueueAutomationExecuteJob({ kind: "stuck_recovery", taskId: row.id, clinicId: row.clinicId });
  }
}

async function enqueuePrestartReminders(): Promise<void> {
  const t0 = new Date();
  const t1 = new Date(Date.now() + PRESTART_MS);
  const rows = await db
    .select({ id: appointments.id, clinicId: appointments.clinicId })
    .from(appointments)
    .where(
      and(
        gte(appointments.startTime, t0),
        lte(appointments.startTime, t1),
        inArray(appointments.status, [...NOT_STARTED]),
        isNotNull(appointments.vetId),
        isNull(appointments.prestartReminderAt),
      ),
    )
    .orderBy(asc(appointments.startTime))
    .limit(BATCH);

  for (const row of rows) {
    automationDebugLog("AUTOMATION_RULE_TRIGGERED", { rule: "prestart_reminder", taskId: row.id, clinicId: row.clinicId, reason: "candidate" });
    incrementMetric("automation_triggered");
    broadcast(row.clinicId, {
      type: "AUTOMATION_TRIGGERED",
      payload: { rule: "prestart_reminder", taskId: row.id, clinicId: row.clinicId, reason: "candidate" },
    });
    await enqueueAutomationExecuteJob({ kind: "prestart_reminder", taskId: row.id, clinicId: row.clinicId });
  }
}

/** Runs inside BullMQ worker — DB-atomic updates + audit + enqueue notifications. */
export async function executeAutomationJob(payload: AutomationExecutePayload): Promise<void> {
  incrementMetric("automation_executed");
  const { taskId, clinicId } = payload;
  const idempotencyKey = `auto:${payload.kind}:${taskId}`;
  if (await checkIdempotentAsync(idempotencyKey)) {
    automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId, reason: "idempotent_duplicate" });
    return;
  }
  const c = clinicId.trim();
  if (!taskId?.trim() || !c) {
    automationDebugLog("AUTOMATION_ERROR", { rule: payload.kind, taskId, clinicId, reason: "invalid_payload" });
    return;
  }

  const [task] = await db.select().from(appointments).where(and(eq(appointments.id, taskId), eq(appointments.clinicId, c))).limit(1);
  if (!task) {
    automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "task_not_found" });
    return;
  }

  const stuckCutoff = getStuckUpdatedBeforeCutoff();

  try {
    switch (payload.kind) {
      case "escalate_overdue": {
        const end = new Date(task.endTime).getTime();
        if (end >= Date.now()) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "not_overdue" });
          return;
        }
        if (task.status === "completed" || task.status === "cancelled") {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "terminal" });
          return;
        }
        const adminId = await getAdminUserIdForClinic(c);
        if (!adminId) {
          automationDebugLog("AUTOMATION_ERROR", { rule: payload.kind, taskId, clinicId: c, reason: "no_admin_user" });
          return;
        }
        const now = new Date();
        const [updated] = await db
          .update(appointments)
          .set({
            escalatedTo: adminId,
            escalatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(appointments.id, taskId),
              eq(appointments.clinicId, c),
              isNull(appointments.escalatedAt),
              lt(appointments.endTime, sql`now()`),
              notInArray(appointments.status, [...TERMINAL]),
            ),
          )
          .returning({ id: appointments.id });

        if (!updated) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "db_idempotent_noop" });
          return;
        }
        logAudit({
          clinicId: c,
          actionType: "TASK_ESCALATED",
          performedBy: AUTOMATION_ACTOR_ID,
          performedByEmail: AUTOMATION_ACTOR_EMAIL,
          actorRole: "system",
          targetId: taskId,
          targetType: "task",
          metadata: { escalatedTo: adminId, vetIdPreserved: task.vetId, reason: "overdue_escalation" },
        });
        await enqueueAutomationNotificationJobs({
          clinicId: c,
          userId: adminId,
          title: "Task escalated",
          body: "An overdue task was escalated for admin visibility (technician assignee unchanged).",
          tag: "automation-escalation",
          rateLimitAs: "escalation",
        });
        postSystemMessage(c, "task_escalated", {
          taskId,
          escalatedTo: adminId,
          animalId: task.animalId ?? null,
          taskType: task.taskType ?? null,
        }).catch(() => {});
        await markIdempotentAsync(idempotencyKey);
        return;
      }

      case "auto_assign_unassigned": {
        if (task.status !== "pending" || task.vetId != null) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "not_unassigned_pending" });
          return;
        }
        const age = Date.now() - new Date(task.createdAt).getTime();
        if (age < PENDING_MIN_AGE_MS) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "too_young" });
          return;
        }
        const techId = await getAvailableTechnician(c);
        if (!techId) {
          automationDebugLog("AUTOMATION_ERROR", { rule: payload.kind, taskId, clinicId: c, reason: "no_technician" });
          return;
        }
        const now = new Date();
        const [assigned] = await db
          .update(appointments)
          .set({ vetId: techId, status: "assigned", updatedAt: now })
          .where(
            and(
              eq(appointments.id, taskId),
              eq(appointments.clinicId, c),
              eq(appointments.status, "pending"),
              isNull(appointments.vetId),
            ),
          )
          .returning({ id: appointments.id });

        if (!assigned) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "db_idempotent_noop" });
          return;
        }
        logAudit({
          clinicId: c,
          actionType: "TASK_AUTO_ASSIGNED",
          performedBy: AUTOMATION_ACTOR_ID,
          performedByEmail: AUTOMATION_ACTOR_EMAIL,
          actorRole: "system",
          targetId: taskId,
          targetType: "task",
          metadata: { assignee: techId },
        });
        await enqueueAutomationNotificationJobs({
          clinicId: c,
          userId: techId,
          title: "Task assigned to you",
          body: "An unassigned task was auto-assigned to you.",
          tag: "automation-auto-assign",
          rateLimitAs: "default",
        });
        await markIdempotentAsync(idempotencyKey);
        return;
      }

      case "stuck_recovery": {
        if (!["assigned", "in_progress", "scheduled", "arrived"].includes(task.status)) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "wrong_status" });
          return;
        }
        if (new Date(task.updatedAt).getTime() >= stuckCutoff.getTime()) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "not_stuck_yet" });
          return;
        }
        const now = new Date();
        const [marked] = await db
          .update(appointments)
          .set({ stuckNotifiedAt: now, updatedAt: now })
          .where(
            and(
              eq(appointments.id, taskId),
              eq(appointments.clinicId, c),
              inArray(appointments.status, ["assigned", "in_progress", "scheduled", "arrived"]),
              lt(appointments.updatedAt, stuckCutoff),
              isNull(appointments.stuckNotifiedAt),
            ),
          )
          .returning({ id: appointments.id });

        if (!marked) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "db_idempotent_noop" });
          return;
        }
        logAudit({
          clinicId: c,
          actionType: "TASK_STUCK_NOTIFIED",
          performedBy: AUTOMATION_ACTOR_ID,
          performedByEmail: AUTOMATION_ACTOR_EMAIL,
          actorRole: "system",
          targetId: taskId,
          targetType: "task",
          metadata: { reason: "idle_threshold" },
        });
        await enqueueAutomationNotificationJobs({
          clinicId: c,
          role: "admin",
          title: "Stuck task",
          body: `Task ${taskId.slice(0, 8)}… may need attention (no update for 30+ minutes).`,
          tag: "automation-stuck",
          rateLimitAs: "default",
        });
        await markIdempotentAsync(idempotencyKey);
        return;
      }

      case "prestart_reminder": {
        const st = new Date(task.startTime).getTime();
        const nowMs = Date.now();
        if (st < nowMs || st > nowMs + PRESTART_MS) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "outside_prestart_window" });
          return;
        }
        if (!NOT_STARTED.includes(task.status as (typeof NOT_STARTED)[number]) || !task.vetId) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "no_vet_or_started" });
          return;
        }
        const t0 = new Date();
        const t1 = new Date(Date.now() + PRESTART_MS);
        const now = new Date();
        const [rem] = await db
          .update(appointments)
          .set({ prestartReminderAt: now, updatedAt: now })
          .where(
            and(
              eq(appointments.id, taskId),
              eq(appointments.clinicId, c),
              isNotNull(appointments.vetId),
              inArray(appointments.status, [...NOT_STARTED]),
              gte(appointments.startTime, t0),
              lte(appointments.startTime, t1),
              isNull(appointments.prestartReminderAt),
            ),
          )
          .returning({ id: appointments.id });

        if (!rem) {
          automationDebugLog("AUTOMATION_RULE_SKIPPED", { rule: payload.kind, taskId, clinicId: c, reason: "db_idempotent_noop" });
          return;
        }
        await enqueueAutomationNotificationJobs({
          clinicId: c,
          userId: task.vetId,
          title: "Task starting soon",
          body: "You have a task starting within 10 minutes.",
          tag: "automation-prestart",
          rateLimitAs: "default",
        });
        await markIdempotentAsync(idempotencyKey);
        return;
      }

      default: {
        const _exhaustive: never = payload;
        void _exhaustive;
      }
    }
  } catch (err) {
    console.error("AUTOMATION_ERROR", {
      rule: payload.kind,
      taskId,
      clinicId: c,
      reason: (err as Error).message,
    });
    throw err;
  }
}
