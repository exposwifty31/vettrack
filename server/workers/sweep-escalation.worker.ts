/**
 * Docking P3 T3.4-ii — Room Sweep escalation ladder worker.
 *
 * Scheduled, role-aware progressive escalation (Coordinator → Senior Tech →
 * all techs + manager) when a shift's Room Sweep isn't done as the shift
 * nears its end. Mirrors staleCheckoutSweepWorker.ts / stale-returned-sweep.worker.ts's
 * BullMQ + `runX(now)` + `__test` + `QUEUE_DISABLED_NO_REDIS` shape.
 *
 * Shift-end = the Coordinator's OWN active shift (resolved via
 * `resolveCurrentRole`, reusing role-resolution.ts's roster window + shift-
 * adjustment handling), not the roster slot that first surfaced the clinic
 * as "has an active shift". If the Coordinator is `unresolved` (nobody
 * on shift) — or ambiguous (`needs_confirmation`, nobody confirmed yet) —
 * there is no single identity to escalate from, so the clinic is skipped.
 *
 * Idempotency: `vt_shift_equipment_coordinator.escalation_stage` only ever
 * advances (`targetStage > current`) — a stage's notification never re-fires
 * once reached. The row is UPSERTed because auto/fallback_senior coordinators
 * (derived, never confirmed) may not have a stored row yet.
 */
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { db, shifts, users, shiftEquipmentCoordinator } from "../db.js";
import { resolveShiftCoordinator } from "../services/equipment-coordinator.service.js";
import { resolveCurrentRole, type PermanentVetTrackRole } from "../lib/role-resolution.js";
import { timeToMinutes } from "../lib/shift-adjustment-window.js";
import {
  computeEscalationStage,
  isShiftSweepComplete,
  type EscalationStage,
} from "../services/sweep-escalation.service.js";
import { loadLocale } from "../../lib/i18n/loader.js";
import { resolve as resolveI18nKey } from "../../lib/i18n/index.js";
import { INITIAL_LOCALE } from "../../lib/i18n/types.js";
import type { Locale } from "../../lib/i18n/types.js";
import { resolveUserLocale } from "../lib/resolve-user-locale.js";
import { logAudit } from "../lib/audit.js";
import { incrementMetric } from "../lib/metrics.js";
import { sendPushToRole, sendPushToUser } from "../lib/push.js";
import { createRedisConnection } from "../lib/redis.js";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 min TICK — mirrors the brief's "~ every 10 min" cadence
const SYSTEM_USER_ID = "system:sweep-escalation";
const SYSTEM_USER_EMAIL = "sweep-escalation@vettrack.system";
// "Manager" visibility mirrors stale-returned-sweep.worker.ts: DB roles are
// admin | vet | technician | student (no `manager` role string in schema).
const MANAGER_ROLES = ["admin", "vet"] as const;

export const SWEEP_ESCALATION_QUEUE_NAME = "room-sweep-escalation";
export const SWEEP_ESCALATION_JOB_NAME = "sweep-room-escalation";
export const SWEEP_ESCALATION_CRON = "*/10 * * * *"; // every 10 minutes — matches SWEEP_INTERVAL_MS
export const SWEEP_ESCALATION_REPEAT_JOB_ID = "repeat-sweep-room-escalation";

const STAGE_METRIC = {
  1: "sweep_escalation_stage_1_fired",
  2: "sweep_escalation_stage_2_fired",
  3: "sweep_escalation_stage_3_fired",
  4: "sweep_escalation_stage_4_fired",
} as const;

const FALLBACK_COPY: Record<1 | 2 | 3 | 4, { title: string; body: string }> = {
  1: {
    title: "Room Sweep due soon",
    body: "Your shift ends in about an hour and the Room Sweep isn't done yet.",
  },
  2: {
    title: "Room Sweep needs a follow-up",
    body: "The Coordinator's Room Sweep still isn't done — please follow up.",
  },
  3: {
    title: "You're now responsible for the Room Sweep",
    body: "The shift is ending soon and the Room Sweep wasn't completed — it's been transferred to you.",
  },
  4: {
    title: "Room Sweep still open",
    body: "The shift has ended with the Room Sweep incomplete. It's now open to any tech to finish.",
  },
};

function sweepEscalationCopyForLocale(locale: Locale, stage: 1 | 2 | 3 | 4): { title: string; body: string } {
  const dict = loadLocale(locale);
  const fallback = FALLBACK_COPY[stage];
  const title = resolveI18nKey(dict, `sweepEscalation.stage${stage}Title`) ?? fallback.title;
  const body = resolveI18nKey(dict, `sweepEscalation.stage${stage}Body`) ?? fallback.body;
  return { title, body };
}

async function resolveStageCopy(
  clinicId: string,
  stage: 1 | 2 | 3 | 4,
  recipientUserId: string | null,
): Promise<{ title: string; body: string }> {
  const locale = recipientUserId ? await resolveUserLocale(clinicId, recipientUserId) : INITIAL_LOCALE;
  return sweepEscalationCopyForLocale(locale, stage);
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/** Combines a roster `date` (YYYY-MM-DD) + clock-time (`HH:MM:SS`) into a local-time Date, same frame `shiftWindowContains` uses. */
function combineLocalDateTime(shiftDate: string, time: string, rollToNextDay: boolean): Date {
  const [year, month, day] = shiftDate.split("-").map(Number);
  const [h, m, s] = time.split(":").map(Number);
  return new Date(year, month - 1, day + (rollToNextDay ? 1 : 0), h, m, s || 0, 0);
}

function shiftStartAsDate(shiftDate: string, startTime: string): Date {
  return combineLocalDateTime(shiftDate, startTime, false);
}

/** Overnight shifts (end clock-time at/before start) roll the end onto the next calendar day. */
function shiftEndAsDate(shiftDate: string, startTime: string, endTime: string): Date {
  const overnight = timeToMinutes(endTime) <= timeToMinutes(startTime);
  return combineLocalDateTime(shiftDate, endTime, overnight);
}

interface ActiveShiftClinicDate {
  clinicId: string;
  shiftDate: string;
}

/**
 * Distinct (clinic, date) pairs with at least one roster shift active right
 * now — the same window predicate `resolveCurrentRole` uses for its own
 * roster match (server/lib/role-resolution.ts), duplicated locally (as
 * role-notification-scheduler.ts's own `getActiveShiftRows` already does)
 * since role-resolution.ts doesn't export its local time helpers.
 */
async function findActiveShiftClinicDates(now: Date): Promise<ActiveShiftClinicDate[]> {
  const currentDate = toLocalDateString(now);
  const currentTime = toLocalTimeString(now);
  const previousDate = new Date(now);
  previousDate.setDate(now.getDate() - 1);
  const yesterday = toLocalDateString(previousDate);

  const rows = await db
    .selectDistinct({ clinicId: shifts.clinicId, shiftDate: shifts.date })
    .from(shifts)
    .where(
      sql`(
        (${shifts.date} = ${currentDate}::date AND (
          (${shifts.startTime} <= ${shifts.endTime} AND ${shifts.startTime} <= ${currentTime}::time AND ${shifts.endTime} > ${currentTime}::time)
          OR
          (${shifts.startTime} > ${shifts.endTime} AND ${currentTime}::time >= ${shifts.startTime})
        ))
        OR
        (${shifts.date} = ${yesterday}::date AND ${shifts.startTime} > ${shifts.endTime} AND ${currentTime}::time < ${shifts.endTime})
      )`,
    );

  return rows.map((r) => ({ clinicId: r.clinicId, shiftDate: r.shiftDate }));
}

interface FireStageParams {
  clinicId: string;
  shiftDate: string;
  targetStage: EscalationStage;
  coordinatorUserId: string;
  seniorTechUserId: string | null;
  source: "auto" | "confirmed" | "fallback_senior";
  now: Date;
}

/** Fires the stage's notification, then upserts the escalation row. */
async function fireEscalationStage(params: FireStageParams): Promise<void> {
  const { clinicId, shiftDate, targetStage, coordinatorUserId, seniorTechUserId, source, now } = params;
  if (targetStage === 0) return;

  const currentResponsibleUserId = targetStage === 3 ? seniorTechUserId : null;

  if (targetStage === 1) {
    const copy = await resolveStageCopy(clinicId, 1, coordinatorUserId);
    await sendPushToUser(clinicId, coordinatorUserId, {
      title: copy.title,
      body: copy.body,
      tag: `sweep-escalation:${clinicId}:${shiftDate}:1`,
      url: "/docking",
    });
  } else if (targetStage === 2) {
    if (seniorTechUserId) {
      const copy = await resolveStageCopy(clinicId, 2, seniorTechUserId);
      await sendPushToUser(clinicId, seniorTechUserId, {
        title: copy.title,
        body: copy.body,
        tag: `sweep-escalation:${clinicId}:${shiftDate}:2`,
        url: "/docking",
      });
    }
  } else if (targetStage === 3) {
    if (seniorTechUserId) {
      const copy = await resolveStageCopy(clinicId, 3, seniorTechUserId);
      await sendPushToUser(clinicId, seniorTechUserId, {
        title: copy.title,
        body: copy.body,
        tag: `sweep-escalation:${clinicId}:${shiftDate}:3`,
        url: "/docking",
      });
    }
  } else {
    const copy = await resolveStageCopy(clinicId, 4, null);
    for (const role of MANAGER_ROLES) {
      await sendPushToRole(clinicId, role, {
        title: copy.title,
        body: copy.body,
        tag: `sweep-escalation:${clinicId}:${shiftDate}:4`,
        url: "/docking",
      });
    }
  }

  await db
    .insert(shiftEquipmentCoordinator)
    .values({
      id: randomUUID(),
      clinicId,
      shiftDate,
      coordinatorUserId,
      source,
      escalationStage: targetStage,
      currentResponsibleUserId,
      escalatedAt: now,
    })
    .onConflictDoUpdate({
      target: [shiftEquipmentCoordinator.clinicId, shiftEquipmentCoordinator.shiftDate],
      set: {
        escalationStage: targetStage,
        currentResponsibleUserId,
        escalatedAt: now,
      },
    });

  incrementMetric(STAGE_METRIC[targetStage]);
  logAudit({
    clinicId,
    actionType: "room_sweep_escalated",
    performedBy: SYSTEM_USER_ID,
    performedByEmail: SYSTEM_USER_EMAIL,
    targetId: coordinatorUserId,
    metadata: { stage: targetStage, shiftDate },
  });
  if (targetStage === 3 && seniorTechUserId) {
    logAudit({
      clinicId,
      actionType: "room_sweep_responsibility_transferred",
      performedBy: SYSTEM_USER_ID,
      performedByEmail: SYSTEM_USER_EMAIL,
      targetId: seniorTechUserId,
      metadata: { shiftDate },
    });
  }
}

export async function runSweepEscalation(now = new Date()): Promise<{ shiftsChecked: number; escalated: number }> {
  const activeShiftDates = await findActiveShiftClinicDates(now);
  let escalated = 0;

  for (const { clinicId, shiftDate } of activeShiftDates) {
    const resolution = await resolveShiftCoordinator(clinicId, shiftDate);
    // `unresolved` (nobody on shift) and `needs_confirmation` (ambiguous,
    // nobody confirmed) both leave coordinatorUserId null — no single
    // identity to escalate from, so skip.
    if (!resolution.coordinatorUserId) continue;

    const [coordinatorUser] = await db
      .select({ id: users.id, name: users.name, displayName: users.displayName, role: users.role })
      .from(users)
      .where(and(eq(users.id, resolution.coordinatorUserId), eq(users.clinicId, clinicId)))
      .limit(1);
    if (!coordinatorUser) continue;

    const coordinatorRole = await resolveCurrentRole({
      clinicId,
      userId: coordinatorUser.id,
      userName: coordinatorUser.displayName || coordinatorUser.name,
      fallbackRole: (coordinatorUser.role as PermanentVetTrackRole) || "technician",
      now,
    });
    const activeShift = coordinatorRole.activeShift;
    if (!activeShift) continue; // the Coordinator's own shift can't be located — nothing to time against

    const shiftEnd = shiftEndAsDate(activeShift.date, activeShift.startTime, activeShift.endTime);
    const shiftStart = shiftStartAsDate(activeShift.date, activeShift.startTime);
    const minutesToEnd = (shiftEnd.getTime() - now.getTime()) / 60_000;

    const complete = await isShiftSweepComplete(clinicId, { shiftStart, now });
    if (complete) continue; // sweep done — escalation stops (never rolls a reached stage back down)

    const targetStage = computeEscalationStage(minutesToEnd);
    if (targetStage === 0) continue;

    const [existingRow] = await db
      .select({ escalationStage: shiftEquipmentCoordinator.escalationStage })
      .from(shiftEquipmentCoordinator)
      .where(
        and(
          eq(shiftEquipmentCoordinator.clinicId, clinicId),
          eq(shiftEquipmentCoordinator.shiftDate, shiftDate),
        ),
      )
      .limit(1);
    const currentStage = existingRow?.escalationStage ?? 0;
    if (targetStage <= currentStage) continue; // idempotent — never re-fire an already-reached stage

    await fireEscalationStage({
      clinicId,
      shiftDate,
      targetStage,
      coordinatorUserId: resolution.coordinatorUserId,
      seniorTechUserId: resolution.seniorTechUserId,
      source: resolution.status === "confirmed" || resolution.status === "fallback_senior" ? resolution.status : "auto",
      now,
    });
    escalated++;
  }

  return { shiftsChecked: activeShiftDates.length, escalated };
}

export const __test = {
  sweepEscalationCopyForLocale,
  findActiveShiftClinicDates,
  shiftStartAsDate,
  shiftEndAsDate,
  SWEEP_INTERVAL_MS,
};

let sweepQueueInitialized = false;

export function startSweepEscalationWorker(): void {
  if (sweepQueueInitialized) return;
  sweepQueueInitialized = true;

  void (async () => {
    const queueConnection = await createRedisConnection();
    const workerConnection = await createRedisConnection();

    if (!queueConnection || !workerConnection) {
      console.log("[sweep-room-escalation] queue disabled (Redis unavailable) — falling back to setInterval");
      // Fallback for environments without Redis (dev/test without REDIS_URL)
      setInterval(() => {
        runSweepEscalation().catch((e) => console.error("[sweep-room-escalation] failed:", e));
      }, SWEEP_INTERVAL_MS);
      runSweepEscalation().catch((e) => console.error("[sweep-room-escalation] startup failed:", e));
      return;
    }

    const sweepQueue = new Queue(SWEEP_ESCALATION_QUEUE_NAME, { connection: queueConnection });
    const sweepWorker = new Worker(
      SWEEP_ESCALATION_QUEUE_NAME,
      async (job) => {
        if (job.name !== SWEEP_ESCALATION_JOB_NAME) return;
        await runSweepEscalation();
      },
      { connection: workerConnection, concurrency: 1 },
    );

    sweepWorker.on("failed", (job, error) => {
      console.error("[sweep-room-escalation] job failed", {
        jobId: job?.id,
        name: job?.name,
        message: error.message,
      });
    });

    await sweepQueue.add(
      SWEEP_ESCALATION_JOB_NAME,
      {},
      {
        jobId: SWEEP_ESCALATION_REPEAT_JOB_ID,
        repeat: { pattern: SWEEP_ESCALATION_CRON },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );

    console.log("[sweep-room-escalation] scheduled via BullMQ", {
      queueName: SWEEP_ESCALATION_QUEUE_NAME,
      cron: SWEEP_ESCALATION_CRON,
    });

    // Run once at startup so the first sweep doesn't wait up to 10 minutes.
    runSweepEscalation().catch((e) => console.error("[sweep-room-escalation] startup sweep failed:", e));
  })();
}
