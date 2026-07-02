import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, shiftAdjustments, shifts, users } from "../db.js";
import { shiftWindowContains } from "./shift-adjustment-window.js";

export type PermanentVetTrackRole = "admin" | "vet" | "technician" | "senior_technician" | "student";
export type ShiftRole = "technician" | "senior_technician" | "admin";
export type EffectiveRole = PermanentVetTrackRole | ShiftRole;

export interface RoleResolutionInput {
  clinicId: string;
  userId?: string;
  userName: string;
  fallbackRole: PermanentVetTrackRole;
  secondaryRole?: string | null;
  now?: Date;
}

export interface ActiveShiftSnapshot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  role: ShiftRole;
}

export interface RoleResolutionResult {
  effectiveRole: EffectiveRole;
  permanentRole: PermanentVetTrackRole;
  source: "shift" | "permanent";
  activeShift: ActiveShiftSnapshot | null;
  resolvedAt: Date;
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

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeNameKey(name: string): string {
  return normalizeName(name)
    .toLowerCase()
    .replace(/[.\-_/\\,]+/g, "")
    .replace(/\s+/g, "");
}

/**
 * Apply approved shift-adjustments (Phase 1) to the roster shift result.
 *
 * ADDITIVE + FAIL-SAFE: when the caller has no userId, or no approved adjustment
 * applies, this returns the roster `activeShift` unchanged — so the Strategy A
 * snapshot stays byte-for-byte identical for the existing (no-adjustment) path.
 * Any error degrades to the pure roster result (a bug here can never break core
 * authority). The role never changes; only the effective end time moves.
 *
 * - leave_early: shortens an active roster shift; once `now` passes the earlier
 *   effective end, the person is off-shift (returns null).
 * - extend: keeps the person on-shift past their rostered end when the extended
 *   window still covers `now`.
 */
async function resolveEffectiveShift(
  input: RoleResolutionInput,
  now: Date,
  today: string,
  yesterday: string,
  activeShift: ActiveShiftSnapshot | undefined,
): Promise<ActiveShiftSnapshot | null> {
  const userId = input.userId?.trim();
  if (!userId) return activeShift ?? null;

  try {
    if (activeShift) {
      const [leaveEarly] = await db
        .select({ requestedEndTime: shiftAdjustments.requestedEndTime })
        .from(shiftAdjustments)
        .where(
          and(
            eq(shiftAdjustments.clinicId, input.clinicId),
            eq(shiftAdjustments.requesterUserId, userId),
            eq(shiftAdjustments.baseShiftId, activeShift.id),
            eq(shiftAdjustments.kind, "leave_early"),
            eq(shiftAdjustments.status, "approved"),
          ),
        )
        .orderBy(desc(shiftAdjustments.createdAt))
        .limit(1);
      if (!leaveEarly) return activeShift;
      return shiftWindowContains(now, activeShift.date, activeShift.startTime, leaveEarly.requestedEndTime)
        ? { ...activeShift, endTime: leaveEarly.requestedEndTime }
        : null;
    }

    const extensions = await db
      .select({
        requestedEndTime: shiftAdjustments.requestedEndTime,
        shiftId: shifts.id,
        shiftDate: shifts.date,
        startTime: shifts.startTime,
        employeeName: shifts.employeeName,
        role: shifts.role,
      })
      .from(shiftAdjustments)
      .innerJoin(shifts, eq(shifts.id, shiftAdjustments.baseShiftId))
      .where(
        and(
          eq(shiftAdjustments.clinicId, input.clinicId),
          eq(shiftAdjustments.requesterUserId, userId),
          eq(shiftAdjustments.kind, "extend"),
          eq(shiftAdjustments.status, "approved"),
          inArray(shiftAdjustments.baseShiftDate, [today, yesterday]),
        ),
      )
      .orderBy(desc(shiftAdjustments.createdAt));

    for (const ext of extensions) {
      if (shiftWindowContains(now, ext.shiftDate, ext.startTime, ext.requestedEndTime)) {
        return {
          id: ext.shiftId,
          date: ext.shiftDate,
          startTime: ext.startTime,
          endTime: ext.requestedEndTime,
          employeeName: ext.employeeName,
          role: ext.role,
        };
      }
    }
    return null;
  } catch (err) {
    console.error("role-resolution:adjustments", err);
    return activeShift ?? null;
  }
}

export async function resolveCurrentRole(input: RoleResolutionInput): Promise<RoleResolutionResult> {
  const now = input.now ?? new Date();
  let normalizedName = normalizeName(input.userName);
  if (input.userId?.trim()) {
    const [userRow] = await db
      .select({ name: users.name, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, input.userId.trim()), eq(users.clinicId, input.clinicId)))
      .limit(1);
    const canonical = normalizeName(userRow?.displayName || userRow?.name || "");
    if (canonical) normalizedName = canonical;
  }

  if (!normalizedName) {
    return {
      effectiveRole: input.fallbackRole,
      permanentRole: input.fallbackRole,
      source: "permanent",
      activeShift: null,
      resolvedAt: now,
    };
  }
  const normalizedNameKey = normalizeNameKey(normalizedName);
  if (!normalizedNameKey) {
    return {
      effectiveRole: input.fallbackRole,
      permanentRole: input.fallbackRole,
      source: "permanent",
      activeShift: null,
      resolvedAt: now,
    };
  }

  const today = toLocalDateString(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = toLocalDateString(yesterdayDate);
  const currentTime = toLocalTimeString(now);

  const [activeShift] = await db
    .select({
      id: shifts.id,
      date: shifts.date,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      employeeName: shifts.employeeName,
      role: shifts.role,
    })
    .from(shifts)
    .where(
      and(
        sql`replace(replace(replace(replace(replace(lower(trim(${shifts.employeeName})), ' ', ''), '.', ''), '-', ''), '_', ''), '/', '') = ${normalizedNameKey}`,
        eq(shifts.clinicId, input.clinicId),
        or(
          and(
            eq(shifts.date, today),
            or(
              and(
                sql`${shifts.startTime} <= ${shifts.endTime}`,
                sql`${shifts.startTime} <= ${currentTime}::time`,
                sql`${shifts.endTime} > ${currentTime}::time`
              ),
              and(
                sql`${shifts.startTime} > ${shifts.endTime}`,
                sql`${currentTime}::time >= ${shifts.startTime}`
              )
            )
          ),
          and(
            eq(shifts.date, yesterday),
            sql`${shifts.startTime} > ${shifts.endTime}`,
            sql`${currentTime}::time < ${shifts.endTime}`
          )
        )
      )
    )
    .orderBy(desc(shifts.date), desc(shifts.startTime))
    .limit(1);

  // Additive, fail-safe: approved shift-adjustments move the effective end.
  // Byte-identical to the roster result when none apply.
  const effectiveShift = await resolveEffectiveShift(input, now, today, yesterday, activeShift);

  if (!effectiveShift) {
    const ROLE_LEVELS: Record<string, number> = {
      admin: 40,
      vet: 30,
      senior_technician: 25,
      lead_technician: 22,
      vet_tech: 20,
      technician: 20,
      student: 10,
    };
    const primaryLevel = ROLE_LEVELS[input.fallbackRole] ?? 0;
    const secondaryLevel = input.secondaryRole ? (ROLE_LEVELS[input.secondaryRole] ?? 0) : 0;
    const effectiveRole: EffectiveRole =
      secondaryLevel > primaryLevel
        ? (input.secondaryRole as EffectiveRole)
        : input.fallbackRole;
    return {
      effectiveRole,
      permanentRole: input.fallbackRole,
      source: "permanent",
      activeShift: null,
      resolvedAt: now,
    };
  }

  return {
    effectiveRole: effectiveShift.role,
    permanentRole: input.fallbackRole,
    source: "shift",
    activeShift: effectiveShift,
    resolvedAt: now,
  };
}
