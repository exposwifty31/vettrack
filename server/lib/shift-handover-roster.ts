/**
 * R-SH-F1.5 — Next-shift roster resolution (ONE definition, reused).
 *
 * A single shared helper over `vt_shifts` / `vt_shift_sessions` that resolves
 * the users rostered on the NEXT shift for a clinic — the next shift being the
 * EARLIEST shift for that `clinicId` starting strictly after the current
 * shift's end. The SAME clinic-scoped set drives BOTH:
 *   (a) push-target selection on generate (R-SH-F1.5 push), and
 *   (b) acknowledge authorization (server/services/shift-handover.service.ts),
 * so the users who may ack are exactly the users who were paged — a cross-clinic
 * user is never in the set.
 *
 * `vt_shifts` rows carry only `employeeName` (no `userId`), so roster↔user
 * mapping reuses the exact normalized-name match (`normalizeName` /
 * `normalizeNameKey`) used by the Equipment Coordinator derivation. Every DB
 * read carries an explicit `clinicId` predicate.
 */
import { eq } from "drizzle-orm";
import { db, shifts, users } from "../db.js";
import { normalizeName, normalizeNameKey } from "./role-resolution.js";
import { windowBounds } from "./shift-window.js";

export interface RosterShiftRow {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM[:SS]
  endTime: string; // HH:MM[:SS]
  employeeName: string;
}

export interface RosterUserRow {
  id: string;
  name: string | null;
  displayName: string | null;
}

/**
 * PURE core: the internal `vt_users.id` set rostered on the EARLIEST shift block
 * that starts strictly after `afterEnd`. Shift rows are grouped by their
 * absolute start instant (overnight-aware via `windowBounds`); the minimum start
 * after `afterEnd` is the next shift, and every roster row sharing that start
 * is matched to a user by normalized name. No DB access — unit-testable.
 */
export function pickNextShiftUserIds(
  shiftRows: RosterShiftRow[],
  clinicUsers: RosterUserRow[],
  afterEnd: Date,
): string[] {
  const afterMs = afterEnd.getTime();

  // The next shift is the earliest one starting AT OR AFTER the current shift's
  // end — contiguous rosters start exactly at the outgoing shift's end, and the
  // current shift always starts strictly before `afterEnd`, so it is never picked.
  let nextStartMs = Number.POSITIVE_INFINITY;
  for (const row of shiftRows) {
    const startMs = windowBounds(row).startedAt.getTime();
    if (startMs >= afterMs && startMs < nextStartMs) nextStartMs = startMs;
  }
  if (!Number.isFinite(nextStartMs)) return [];

  const userIdByNameKey = new Map<string, string>();
  for (const u of clinicUsers) {
    const key = normalizeNameKey(normalizeName(u.displayName || u.name || ""));
    if (key) userIdByNameKey.set(key, u.id);
  }

  const ids = new Set<string>();
  for (const row of shiftRows) {
    if (windowBounds(row).startedAt.getTime() !== nextStartMs) continue;
    const key = normalizeNameKey(normalizeName(row.employeeName));
    if (!key) continue;
    const id = userIdByNameKey.get(key);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * DB wrapper: resolve the next-shift roster user-ids for a clinic. Both reads
 * carry an explicit `clinicId` predicate, so a cross-clinic shift or user is
 * never considered.
 */
export async function resolveNextShiftRoster(clinicId: string, afterEnd: Date): Promise<string[]> {
  const [shiftRows, clinicUsers] = await Promise.all([
    db
      .select({
        date: shifts.date,
        startTime: shifts.startTime,
        endTime: shifts.endTime,
        employeeName: shifts.employeeName,
      })
      .from(shifts)
      .where(eq(shifts.clinicId, clinicId)),
    db
      .select({ id: users.id, name: users.name, displayName: users.displayName })
      .from(users)
      .where(eq(users.clinicId, clinicId)),
  ]);
  return pickNextShiftUserIds(shiftRows, clinicUsers, afterEnd);
}
