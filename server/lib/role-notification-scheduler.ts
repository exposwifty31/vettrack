import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, equipment, pushSubscriptions, scheduledNotifications, shifts, supportTickets, users } from "../db.js";
import { resolveCurrentRole, type PermanentVetTrackRole } from "./role-resolution.js";
import { sendPushToUser } from "./push.js";
import {
  getReturnReminderDelayMsPerUnit,
  getScheduledNotificationPollIntervalMs,
} from "./test-mode.js";
import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { translate } from "../../lib/i18n/index.js";
import { INITIAL_LOCALE } from "../../lib/i18n/types.js";

function requireClinicId(clinicId: string | null | undefined): string {
  const normalized = clinicId?.trim();
  if (!normalized) {
    throw new Error("Missing clinicId in role notification scheduler");
  }
  return normalized;
}

function parseScheduledNotificationPayload(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* invalid JSON → empty */
    }
  }
  return {};
}

function getAttemptsFromPayload(payload: Record<string, unknown>): number {
  const a = payload.attempts;
  if (typeof a === "number" && Number.isFinite(a) && a >= 0) return Math.floor(a);
  return 0;
}

/** After a failure, `attempts` has been incremented to this value. */
function backoffMsAfterFailure(attempts: number): number {
  if (attempts === 1) return 60_000;
  if (attempts === 2) return 5 * 60_000;
  if (attempts === 3) return 15 * 60_000;
  return 0;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getMinuteBucket(date = new Date()): string {
  return date.toISOString().slice(0, 16);
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

async function userAllowsReminder(
  userId: string,
  clinicId: string,
  settingField:
    | "technician_return_reminders_enabled"
    | "senior_own_return_reminders_enabled"
    | "senior_team_overdue_alerts_enabled"
    | "admin_hourly_summary_enabled"
): Promise<boolean> {
  const scopedClinicId = requireClinicId(clinicId);
  const [row] = await db
    .select({
      enabled: sql<boolean>`COALESCE(bool_or(${sql.raw(settingField)}), false)`,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.clinicId, scopedClinicId), eq(pushSubscriptions.userId, userId)));

  return Boolean(row?.enabled);
}

function isEquipmentOverdue(
  checkedOutAt: Date | string | null,
  expectedReturnMinutes: number | null,
  now: Date
): boolean {
  if (!checkedOutAt || !expectedReturnMinutes || expectedReturnMinutes <= 0) return false;
  const checkoutAtDate = typeof checkedOutAt === "string" ? new Date(checkedOutAt) : checkedOutAt;
  if (Number.isNaN(checkoutAtDate.getTime())) return false;
  return checkoutAtDate.getTime() + expectedReturnMinutes * 60_000 <= now.getTime();
}

function getRowScheduledAtDate(row: typeof scheduledNotifications.$inferSelect): Date | null {
  const value = row.scheduledAt;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// Phase 6 PR 6.11 CORRECTION 3: recipient-aware locale lookup.
// Mirrors the `getUserLocale` pattern in server/workers/notification.worker.ts —
// queries `users.preferredLocale` and falls back to INITIAL_LOCALE when the
// row is missing or the lookup fails (rather than "en", because INITIAL_LOCALE
// is the Phase 6 broadcast default per §19 locked decision 1).
async function getUserLocale(userId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ preferredLocale: users.preferredLocale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.preferredLocale ?? INITIAL_LOCALE;
  } catch (err) {
    console.warn(
      `[role-notif] getUserLocale failed, falling back to "${INITIAL_LOCALE}":`,
      (err as Error).message,
    );
    return INITIAL_LOCALE;
  }
}

async function buildReminderMessage(userId: string, equipmentName: string): Promise<string> {
  const locale = await getUserLocale(userId);
  const { primary, fallback, locale: lc } = getLocaleDictionaries(locale);
  return translate(primary, "push.role.reminderForEquipment", { equipmentName }, {
    fallbackDict: fallback,
    locale: lc,
  });
}

async function buildAdminSummaryMessage(userId: string, count: number): Promise<string> {
  const locale = await getUserLocale(userId);
  const { primary, fallback, locale: lc } = getLocaleDictionaries(locale);
  return translate(primary, "push.role.adminSummaryCount", { count }, {
    fallbackDict: fallback,
    locale: lc,
  });
}

function buildSeniorTeamHourlyMessage(
  overdue: Array<{ name: string; holderName: string }>,
  openIssues: Array<{ id: string; title: string }>
): string {
  const lines: string[] = [];
  if (overdue.length > 0) {
    lines.push(`צוות: ${overdue.length} פריטים באיחור`);
    for (const row of overdue.slice(0, 5)) {
      lines.push(`• ${row.name} — ${row.holderName}`);
    }
    if (overdue.length > 5) lines.push(`… +${overdue.length - 5}`);
  }
  if (openIssues.length > 0) {
    lines.push(`פניות פתוחות: ${openIssues.length}`);
    const titles = openIssues
      .slice(0, 5)
      .map((t) => (t.title.length > 50 ? `${t.title.slice(0, 47)}…` : t.title));
    for (const t of titles) lines.push(`• ${t}`);
    if (openIssues.length > 5) lines.push(`… +${openIssues.length - 5}`);
  }
  return lines.join("\n");
}

/** Checkout return reminder — same for every role; only the person who checked out receives it. */
async function sendScheduledCheckoutReturnReminder(
  clinicId: string,
  userId: string,
  equipmentId: string,
  equipmentName: string
): Promise<void> {
  await sendPushToUser(requireClinicId(clinicId), userId, {
    title: "VetTrack",
    body: await buildReminderMessage(userId, equipmentName),
    tag: `smart-reminder:${equipmentId}`,
    url: `/equipment/${equipmentId}`,
  });
}

async function processReturnReminderNotification(
  row: typeof scheduledNotifications.$inferSelect
): Promise<void> {
  if (!row.equipmentId) return;
  const equipmentId = row.equipmentId;
  const userId = row.userId;
  const payload = parseScheduledNotificationPayload(row.payload);
  const nameFromPayload =
    typeof payload.equipmentName === "string" ? payload.equipmentName : undefined;

  const [item] = await db
    .select({
      id: equipment.id,
      name: equipment.name,
      checkedOutById: equipment.checkedOutById,
    })
    .from(equipment)
    .where(and(eq(equipment.clinicId, row.clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
    .limit(1);

  if (!item) return;
  if (item.checkedOutById !== userId) return;
  const scheduledAt = getRowScheduledAtDate(row);
  if (!scheduledAt) return;
  if (scheduledAt.getTime() > Date.now()) return;

  const displayName = item.name || nameFromPayload || "ציוד";
  await sendScheduledCheckoutReturnReminder(row.clinicId, userId, equipmentId, displayName);
}

export async function scheduleSmartReturnReminder(params: {
  clinicId: string;
  equipmentId: string;
  equipmentName: string;
  expectedReturnMinutes: number | null;
  userId: string;
  checkedOutAt: Date | string | null;
}): Promise<void> {
  const clinicId = requireClinicId(params.clinicId);
  if (!params.expectedReturnMinutes || params.expectedReturnMinutes <= 0) return;
  if (!params.checkedOutAt) return;

  const checkoutDate = typeof params.checkedOutAt === "string" ? new Date(params.checkedOutAt) : params.checkedOutAt;
  if (Number.isNaN(checkoutDate.getTime())) return;

  const unitMs = getReturnReminderDelayMsPerUnit();
  const reminderAt = checkoutDate.getTime() + params.expectedReturnMinutes * unitMs;
  if (reminderAt <= Date.now()) return;

  await db
    .delete(scheduledNotifications)
    .where(
      and(
        eq(scheduledNotifications.clinicId, clinicId),
        eq(scheduledNotifications.type, "return_reminder"),
        eq(scheduledNotifications.userId, params.userId),
        eq(scheduledNotifications.equipmentId, params.equipmentId),
        isNull(scheduledNotifications.sentAt)
      )
    );

  await db.insert(scheduledNotifications).values({
    clinicId,
    type: "return_reminder",
    userId: params.userId,
    equipmentId: params.equipmentId,
    scheduledAt: new Date(reminderAt),
    payload: { equipmentName: params.equipmentName },
  });
}

export async function cancelSmartReturnReminder(
  clinicId: string,
  equipmentId: string,
  userId: string | null | undefined
): Promise<void> {
  if (!userId) return;
  const scopedClinicId = requireClinicId(clinicId);
  await db
    .delete(scheduledNotifications)
    .where(
      and(
        eq(scheduledNotifications.clinicId, scopedClinicId),
        eq(scheduledNotifications.type, "return_reminder"),
        eq(scheduledNotifications.userId, userId),
        eq(scheduledNotifications.equipmentId, equipmentId),
        isNull(scheduledNotifications.sentAt)
      )
    );
}

const isDevLog = process.env.NODE_ENV !== "production";

export async function runScheduledNotifications(): Promise<void> {
  const due = await db
    .select()
    .from(scheduledNotifications)
    .where(
      and(
        eq(scheduledNotifications.type, "return_reminder"),
        isNull(scheduledNotifications.sentAt),
        lte(scheduledNotifications.scheduledAt, sql`now()`)
      )
    )
    .orderBy(asc(scheduledNotifications.scheduledAt))
    .limit(100);

  for (const row of due) {
    if (isDevLog) {
      console.log("Processing scheduled notification:", {
        id: row.id,
        type: row.type,
        userId: row.userId,
      });
    }

    try {
      await processReturnReminderNotification(row);
      await db
        .update(scheduledNotifications)
        .set({ sentAt: new Date() })
        .where(
          and(
            eq(scheduledNotifications.clinicId, row.clinicId),
            eq(scheduledNotifications.id, row.id),
            isNull(scheduledNotifications.sentAt)
          )
        );
      if (isDevLog) {
        console.log("Notification sent:", {
          id: row.id,
          userId: row.userId,
        });
      }
    } catch (error) {
      const payloadObj = parseScheduledNotificationPayload(row.payload);
      const prevAttempts = getAttemptsFromPayload(payloadObj);
      const attempts = prevAttempts + 1;

      console.error("Notification failed:", {
        id: row.id,
        userId: row.userId,
        attempts,
        error,
      });

      if (attempts >= 4) {
        console.warn("Notification abandoned:", { id: row.id, attempts });
        await db
          .update(scheduledNotifications)
          .set({ sentAt: new Date() })
          .where(
            and(
              eq(scheduledNotifications.clinicId, row.clinicId),
              eq(scheduledNotifications.id, row.id),
              isNull(scheduledNotifications.sentAt)
            )
          );
      } else {
        const delayMs = backoffMsAfterFailure(attempts);
        await db
          .update(scheduledNotifications)
          .set({
            scheduledAt: new Date(Date.now() + delayMs),
            payload: { ...payloadObj, attempts },
          })
          .where(
            and(
              eq(scheduledNotifications.clinicId, row.clinicId),
              eq(scheduledNotifications.id, row.id),
              isNull(scheduledNotifications.sentAt)
            )
          );
      }
    }
  }
}

let scheduledNotificationProcessorStarted = false;

export function startScheduledNotificationProcessor(): void {
  if (scheduledNotificationProcessorStarted) return;
  scheduledNotificationProcessorStarted = true;
  const intervalMs = getScheduledNotificationPollIntervalMs();
  void runScheduledNotifications().catch((e) => console.error("runScheduledNotifications", e));
  setInterval(() => {
    runScheduledNotifications().catch((e) => console.error("runScheduledNotifications", e));
  }, intervalMs);
}

type ActiveShiftRow = {
  id: string;
  clinicId: string;
  date: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  role: "technician" | "senior_technician" | "admin";
};

async function getActiveShiftRows(now: Date): Promise<ActiveShiftRow[]> {
  const currentTime = toTimeString(now);
  const currentDate = toDateString(now);
  const previousDate = new Date(now);
  previousDate.setDate(now.getDate() - 1);
  const yesterdayDate = toDateString(previousDate);

  return db
    .select({
      id: shifts.id,
      clinicId: shifts.clinicId,
      date: shifts.date,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      employeeName: shifts.employeeName,
      role: shifts.role,
    })
    .from(shifts)
    .where(
      and(
        sql`(
          (${shifts.date} = ${currentDate}::date AND (
            (${shifts.startTime} <= ${shifts.endTime} AND ${shifts.startTime} <= ${currentTime}::time AND ${shifts.endTime} > ${currentTime}::time)
            OR
            (${shifts.startTime} > ${shifts.endTime} AND ${currentTime}::time >= ${shifts.startTime})
          ))
          OR
          (${shifts.date} = ${yesterdayDate}::date AND ${shifts.startTime} > ${shifts.endTime} AND ${currentTime}::time < ${shifts.endTime})
        )`
      )
    );
}

function sameShiftSlot(a: ActiveShiftRow, b: ActiveShiftRow): boolean {
  return a.date === b.date && a.startTime === b.startTime && a.endTime === b.endTime;
}

async function runSeniorHourlyTeamChecks(now: Date): Promise<void> {
  const activeShifts = await getActiveShiftRows(now);
  if (activeShifts.length === 0) return;

  const seniorSlots = activeShifts.filter((shift) => shift.role === "senior_technician");
  if (seniorSlots.length === 0) return;

  const seenSeniorSlot = new Set<string>();

  for (const seniorShift of seniorSlots) {
    const clinicUsers = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.clinicId, seniorShift.clinicId), isNull(users.deletedAt)));
    const userByNormalizedName = new Map<string, (typeof clinicUsers)[number]>();
    for (const user of clinicUsers) {
      userByNormalizedName.set(normalizeName(user.name), user);
    }

    const seniorUser = userByNormalizedName.get(normalizeName(seniorShift.employeeName));
    if (!seniorUser) continue;

    const seniorDedupeKey = `${seniorUser.id}::${seniorShift.id}`;
    if (seenSeniorSlot.has(seniorDedupeKey)) continue;
    seenSeniorSlot.add(seniorDedupeKey);

    const teamInSlot = activeShifts.filter((s) => sameShiftSlot(s, seniorShift));
    const teamUsers = teamInSlot
      .map((s) => userByNormalizedName.get(normalizeName(s.employeeName)))
      .filter((u): u is NonNullable<typeof u> => Boolean(u));

    if (teamUsers.length === 0) continue;
    const teamUserIds = teamUsers.map((u) => u.id);

    const overdueRows = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        checkedOutById: equipment.checkedOutById,
        checkedOutAt: equipment.checkedOutAt,
        expectedReturnMinutes: equipment.expectedReturnMinutes,
      })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, seniorShift.clinicId),
          inArray(equipment.checkedOutById, teamUserIds),
          isNotNull(equipment.checkedOutById),
          isNull(equipment.deletedAt)
        )
      );

    const currentlyOverdue = overdueRows.filter((item) =>
      isEquipmentOverdue(item.checkedOutAt, item.expectedReturnMinutes, now)
    );

    // userId = ticket author; only tickets opened by users on this shift slot.
    const openIssues = await db
      .select({
        id: supportTickets.id,
        title: supportTickets.title,
        userId: supportTickets.userId,
      })
      .from(supportTickets)
      .where(and(eq(supportTickets.clinicId, seniorShift.clinicId), eq(supportTickets.status, "open"), inArray(supportTickets.userId, teamUserIds)));

    if (currentlyOverdue.length === 0 && openIssues.length === 0) continue;

    const fallbackRole = (seniorUser.role as PermanentVetTrackRole) ?? "technician";
    const seniorRole = await resolveCurrentRole({
      clinicId: seniorShift.clinicId,
      userName: seniorUser.name,
      fallbackRole,
    });

    if (isDevLog) {
      console.log("Notification role:", {
        userId: seniorUser.id,
        effectiveRole: seniorRole.effectiveRole,
        source: seniorRole.source,
      });
    }

    if (seniorRole.effectiveRole !== "senior_technician") continue;

    const seniorEnabled = await userAllowsReminder(seniorUser.id, seniorShift.clinicId, "senior_team_overdue_alerts_enabled");
    if (!seniorEnabled) continue;

    const overdueLines = currentlyOverdue
      .map((item) => {
        if (!item.checkedOutById) return null;
        const holder = teamUsers.find((u) => u.id === item.checkedOutById);
        return {
          name: item.name,
          holderName: holder?.name ?? "לא ידוע",
        };
      })
      .filter((row): row is { name: string; holderName: string } => row !== null);

    const body = buildSeniorTeamHourlyMessage(overdueLines, openIssues);
    const tag = `smart-team-hourly:${seniorShift.date}:${seniorShift.startTime}:${seniorShift.endTime}:${seniorUser.id}:${getMinuteBucket(now)}`;

    await sendPushToUser(seniorShift.clinicId, seniorUser.id, {
      title: "VetTrack",
      body,
      tag,
      url: "/my-equipment",
    });
  }
}

async function runAdminHourlySummary(now: Date): Promise<void> {
  const items = await db
    .select({
      clinicId: equipment.clinicId,
      id: equipment.id,
      checkedOutAt: equipment.checkedOutAt,
      expectedReturnMinutes: equipment.expectedReturnMinutes,
    })
    .from(equipment)
    .where(and(isNotNull(equipment.checkedOutById), isNull(equipment.deletedAt)));

  const overdueByClinic = new Map<string, number>();
  for (const item of items) {
    if (!isEquipmentOverdue(item.checkedOutAt, item.expectedReturnMinutes, now)) continue;
    overdueByClinic.set(item.clinicId, (overdueByClinic.get(item.clinicId) ?? 0) + 1);
  }

  for (const [clinicId, overdueCount] of overdueByClinic.entries()) {
    if (overdueCount <= 0) continue;
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.role, "admin"), isNull(users.deletedAt)));

    for (const admin of admins) {
      const enabled = await userAllowsReminder(admin.id, clinicId, "admin_hourly_summary_enabled");
      if (!enabled) continue;
      await sendPushToUser(clinicId, admin.id, {
        title: "VetTrack",
        body: await buildAdminSummaryMessage(admin.id, overdueCount),
        tag: `smart-admin-summary:${getMinuteBucket(now)}`,
        url: "/my-equipment",
      });
    }
  }
}

/** @param force - when true (e.g. test runner), run senior/admin hourly checks regardless of clock minute. */
export async function runHourlySmartNotifications(options?: { force?: boolean }): Promise<void> {
  const now = new Date();
  if (!options?.force && now.getMinutes() !== 0) return;
  await runSeniorHourlyTeamChecks(now);
  await runAdminHourlySummary(now);
}

let smartSchedulerStarted = false;

export function startSmartRoleNotificationScheduler(): void {
  if (smartSchedulerStarted) return;
  smartSchedulerStarted = true;
  // Keep 60s: hourly logic keys off clock minute; a shorter TEST interval would re-fire the same hour bucket.
  setInterval(() => {
    runHourlySmartNotifications().catch((error) => {
      console.error("Failed smart hourly notifications", error);
    });
  }, 60_000);
}
