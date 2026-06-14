import { and, desc, eq, or, sql } from "drizzle-orm";
import { db, shifts, users } from "../db.js";

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

  if (!activeShift) {
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
    effectiveRole: activeShift.role,
    permanentRole: input.fallbackRole,
    source: "shift",
    activeShift,
    resolvedAt: now,
  };
}
