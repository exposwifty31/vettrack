/**
 * Docking P3 T3.4-ii — Room Sweep escalation ladder worker.
 *
 * Scheduled, role-aware progressive escalation (Coordinator → Senior Tech →
 * all techs + manager) when a shift's Room Sweep isn't done as the shift
 * nears its end. Mirrors staleCheckoutSweepWorker.ts / stale-returned-sweep.worker.ts's
 * BullMQ + `runX(now)` + `__test` + `QUEUE_DISABLED_NO_REDIS` shape.
 *
 * Shift-end = the responsible identity's OWN shift row for (clinicId,
 * shiftDate), matched by normalized employee name directly against
 * `vt_shifts` (`findOwnShiftRow`) — NOT `resolveCurrentRole`, whose
 * active-shift query is `endTime > now` strict and would return
 * `activeShift: null` the instant the shift ends (phase-review I-1: that
 * gate made stage 4 unreachable in production, since `minutesToEnd` could
 * never go <= 0). The candidate scan (`findActiveShiftClinicDates`) also
 * includes shifts that ended within the last `SWEEP_INTERVAL_MS`, so the
 * first tick after shift-end still processes the clinic (a post-end grace
 * window for the terminal stage only — `isShiftSweepComplete` still
 * short-circuits a finished sweep before any stage fires).
 *
 * Responsible identity: normally the Coordinator (`resolveShiftCoordinator`
 * status `auto`/`confirmed`/`fallback_senior`), ladder starts at stage 1.
 * When status is `needs_confirmation` (multiple eligible, nobody confirmed)
 * AND a senior tech is on shift, the ladder still runs — with the senior as
 * the responsible identity, starting at stage 2 (phase-review I-2: this was
 * the highest-risk, most-diffuse-accountability case, and previously got
 * ZERO escalation). Only `unresolved` (no coordinator AND no senior — truly
 * nobody to escalate to) is skipped.
 *
 * Idempotency: `vt_shift_equipment_coordinator.escalation_stage` only ever
 * advances (`targetStage > current`) — a stage's notification never re-fires
 * once reached. The row is UPSERTed because auto/fallback_senior coordinators
 * (derived, never confirmed) may not have a stored row yet.
 */
import { randomUUID } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { db, shifts, users, shiftEquipmentCoordinator } from "../db.js";
import { resolveShiftCoordinator } from "../services/equipment-coordinator.service.js";
import { normalizeName, normalizeNameKey } from "../lib/role-resolution.js";
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
import { MANAGER_NOTIFY_ROLES } from "../lib/notification-roles.js";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 min TICK — mirrors the brief's "~ every 10 min" cadence
const SYSTEM_USER_ID = "system:sweep-escalation";
const SYSTEM_USER_EMAIL = "sweep-escalation@vettrack.system";

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

/**
 * S2-8 (pre-PR review, DOC): this file's shift day/time frame uses
 * server-local `Date` math (`getFullYear`/`getMonth`/`getDate` and the
 * `new Date(y, m, d, h, mi, s)` constructor below) DELIBERATELY, mirroring
 * `server/lib/role-resolution.ts`'s existing (merged, production)
 * shift-window convention — not an oversight, and not something to "fix"
 * here in isolation. Migrating both to clinic-timezone-aware helpers
 * (`getClinicTimezone`/`clinicTodayIsoDate`, already used elsewhere in
 * docking.ts) is a separate, cross-cutting change spanning both files and
 * is explicitly out of P3 scope.
 */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
 * Distinct (clinic, date) pairs with at least one roster shift EITHER active
 * right now OR that ended within the last `SWEEP_INTERVAL_MS` (I-1 fix —
 * the post-end grace window). Without the grace window, a clinic drops out
 * of this candidate scan at the exact instant its shift ends, and stage 4
 * (which only fires once `minutesToEnd <= 0`) can never be reached in
 * production. Restricted to shifts dated today/yesterday (mirrors the
 * roster window `resolveCurrentRole` uses for its own shift match,
 * server/lib/role-resolution.ts) to keep the scan bounded; overnight shifts
 * are resolved via `shiftStartAsDate`/`shiftEndAsDate` (defined above),
 * which already roll the end onto the next calendar day.
 */
async function findActiveShiftClinicDates(now: Date): Promise<ActiveShiftClinicDate[]> {
  const currentDate = toLocalDateString(now);
  const previousDate = new Date(now);
  previousDate.setDate(now.getDate() - 1);
  const yesterday = toLocalDateString(previousDate);
  const graceCutoff = new Date(now.getTime() - SWEEP_INTERVAL_MS);

  const rows = await db
    .select({ clinicId: shifts.clinicId, shiftDate: shifts.date, startTime: shifts.startTime, endTime: shifts.endTime })
    .from(shifts)
    .where(inArray(shifts.date, [currentDate, yesterday]));

  const seen = new Set<string>();
  const result: ActiveShiftClinicDate[] = [];
  for (const row of rows) {
    const start = shiftStartAsDate(row.shiftDate, row.startTime);
    const end = shiftEndAsDate(row.shiftDate, row.startTime, row.endTime);
    const activeNow = start <= now && now < end;
    const recentlyEnded = end <= now && end >= graceCutoff;
    if (!activeNow && !recentlyEnded) continue;

    const key = `${row.clinicId}:${row.shiftDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ clinicId: row.clinicId, shiftDate: row.shiftDate });
  }
  return result;
}

interface OwnShiftRow {
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * The responsible identity's OWN shift row for (clinicId, shiftDate),
 * matched by the same normalized-name key role-resolution.ts /
 * equipment-coordinator.service.ts use to bridge `vt_shifts.employee_name`
 * text rows to `vt_users` (first row wins, in start-time order, for
 * determinism when someone is double-booked — mirrors
 * equipment-coordinator.service.ts's `matchOnShiftUsers`).
 *
 * I-1 fix: unlike `resolveCurrentRole`, this does NOT gate on the shift
 * still being active — the caller needs the shift's end time even after it
 * has ended (the post-end escalation grace window), and
 * `resolveCurrentRole`'s own active-shift query (`endTime > now` strict)
 * would return `activeShift: null` at that point. This intentionally does
 * NOT apply approved shift-adjustments (leave_early/extend) the way
 * `resolveCurrentRole` does — a direct roster-row lookup is the simpler,
 * more reliable source for a shift-end that must still resolve post-end.
 *
 * S2-8 (pre-PR review, DOC): reading the raw roster startTime/endTime
 * without applying leave_early/extend shift-adjustments is a DELIBERATE,
 * reviewed trade-off from the I-1 fix — not an oversight. The alternative
 * (routing through `resolveCurrentRole`'s adjustment logic) was rejected
 * because that path can't resolve post-shift-end (see above). Consequence:
 * the escalation clock tracks ROSTERED hours, not adjusted hours — accepted
 * as the P3 behavior.
 */
async function findOwnShiftRow(clinicId: string, shiftDate: string, userName: string): Promise<OwnShiftRow | null> {
  const key = normalizeNameKey(normalizeName(userName));
  if (!key) return null;

  const rows = await db
    .select({ date: shifts.date, startTime: shifts.startTime, endTime: shifts.endTime, employeeName: shifts.employeeName })
    .from(shifts)
    .where(and(eq(shifts.clinicId, clinicId), eq(shifts.date, shiftDate)))
    .orderBy(asc(shifts.startTime));

  for (const row of rows) {
    if (normalizeNameKey(normalizeName(row.employeeName)) === key) {
      return { date: row.date, startTime: row.startTime, endTime: row.endTime };
    }
  }
  return null;
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
    // M-3: a coordinator-only shift (no senior tech on shift) has nobody to
    // notify at stage 2 — the row/audit/metric still advance (idempotency
    // must still hold), but the notification is a no-op. This is
    // intentional: the coordinator already got stage 1, and stage 4's
    // manager push (I-1 fix, now actually reachable) is the safety net.
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
    // M-3: same no-senior-to-notify case as stage 2 above.
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
    for (const role of MANAGER_NOTIFY_ROLES) {
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

    // `unresolved` (nobody on shift, no senior either) — no identity at all
    // to escalate from, skip. Every other status resolves a responsible
    // identity below, including `needs_confirmation` (I-2 fix, see the
    // else-if branch).
    if (resolution.status === "unresolved") continue;

    let responsibleUserId: string;
    let floorStage: 1 | 2;
    if (resolution.coordinatorUserId) {
      responsibleUserId = resolution.coordinatorUserId;
      floorStage = 1;
    } else if (resolution.status === "needs_confirmation" && resolution.seniorTechUserId) {
      // I-2: multiple eligible, nobody confirmed — no single coordinator to
      // remind (stage 1 is skipped below), but a senior tech IS on shift,
      // so the ladder still runs for them starting at stage 2.
      responsibleUserId = resolution.seniorTechUserId;
      floorStage = 2;
    } else {
      continue; // needs_confirmation with no senior on shift either — nobody to escalate to
    }

    const [responsibleUser] = await db
      .select({ id: users.id, name: users.name, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, responsibleUserId), eq(users.clinicId, clinicId)))
      .limit(1);
    if (!responsibleUser) continue;

    const shiftRow = await findOwnShiftRow(clinicId, shiftDate, responsibleUser.displayName || responsibleUser.name);
    if (!shiftRow) continue; // the responsible identity's own shift row can't be located — nothing to time against

    const shiftEnd = shiftEndAsDate(shiftRow.date, shiftRow.startTime, shiftRow.endTime);
    const shiftStart = shiftStartAsDate(shiftRow.date, shiftRow.startTime);
    const minutesToEnd = (shiftEnd.getTime() - now.getTime()) / 60_000;

    const complete = await isShiftSweepComplete(clinicId, { shiftStart, now });
    if (complete) continue; // sweep done — escalation stops (never rolls a reached stage back down)

    let targetStage = computeEscalationStage(minutesToEnd);
    // I-2: needs_confirmation has no single coordinator to remind — a raw
    // stage-1 reading is not escalated (floored back to 0, i.e. "not yet").
    if (floorStage === 2 && targetStage === 1) targetStage = 0;
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
      // needs_confirmation has no confirmed coordinator to store — the
      // senior fills that slot (I-2: "record the senior as the
      // coordinator/responsible for this shift when it starts escalating").
      coordinatorUserId: responsibleUserId,
      seniorTechUserId: resolution.seniorTechUserId,
      source: resolution.coordinatorUserId
        ? (resolution.status === "confirmed" || resolution.status === "fallback_senior" ? resolution.status : "auto")
        : "fallback_senior",
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
