import { Router } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { apiError } from "../lib/apiError.js";
import { appointments, db, scanLogs } from "../db.js";
import {
  resolveCurrentRole,
  type ActiveShiftSnapshot,
} from "../lib/role-resolution.js";

/*
 * GET /api/home/dashboard — aggregate "pulse" for the magnetic home dashboard.
 * Read-only. Composes data that no existing endpoint exposes: the caller's
 * current roster shift, a no-overdue streak, and today's completion counters.
 * Every query is clinic-scoped and bounded.
 *
 * "On shift" is roster-derived — resolved from `vt_shifts` via
 * `resolveCurrentRole`, the same source authority Strategy A and the display
 * board read. The legacy `vt_shift_sessions` clock-in table is orphaned (no
 * code ever writes it) and is no longer consulted here; a roster window is
 * self-bounding, so the client no longer needs a staleness guard.
 */

const router = Router();

/** Combine a roster `YYYY-MM-DD` date + `HH:MM[:SS]` time into a server-local instant. */
function combineLocal(dateStr: string, timeStr: string, dayOffset: number): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = timeStr.split(":").map(Number);
  return new Date(year, month - 1, day + dayOffset, hours, minutes, seconds);
}

/**
 * Resolve a roster shift's absolute start/end instants. An overnight shift
 * (start clock-time later than end clock-time) ends on the following day —
 * matching the overnight window logic in `role-resolution.ts`.
 */
function buildShiftWindow(shift: ActiveShiftSnapshot): {
  startedAt: string;
  endsAt: string;
  role: string;
} {
  const overnight = shift.startTime > shift.endTime;
  const startedAt = combineLocal(shift.date, shift.startTime, 0);
  const endsAt = combineLocal(shift.date, shift.endTime, overnight ? 1 : 0);
  return {
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString(),
    role: shift.role,
  };
}

router.get("/dashboard", requireAuth, async (req, res) => {
  const clinicId = req.clinicId?.trim();
  const authUser = req.authUser;

  if (!clinicId || !authUser?.id) {
    return apiError(req, res, "errors.validation", undefined, 400);
  }
  const userId = authUser.id;

  try {
    const [roleResult, completedRows, scanRows, streakRows] = await Promise.all([
      // Current on-shift state, roster-derived (vt_shifts), overnight-aware.
      resolveCurrentRole({
        clinicId,
        userId,
        userName: authUser.name,
        fallbackRole: authUser.role,
        secondaryRole: authUser.secondaryRole ?? null,
      }),

      // Tasks marked completed today (UTC calendar day).
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            eq(appointments.status, "completed"),
            sql`(${appointments.completedAt} at time zone 'UTC')::date = (now() at time zone 'UTC')::date`,
          ),
        ),

      // Scans logged by this user today (UTC calendar day).
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(scanLogs)
        .where(
          and(
            eq(scanLogs.clinicId, clinicId),
            eq(scanLogs.userId, userId),
            sql`(${scanLogs.timestamp} at time zone 'UTC')::date = (now() at time zone 'UTC')::date`,
          ),
        ),

      // Per-day overdue counts for completed past days, newest first.
      db
        .select({
          day: sql<string>`(${appointments.endTime} at time zone 'UTC')::date`,
          overdue: sql<number>`count(*) filter (where ${appointments.completedAt} is null or ${appointments.completedAt} > ${appointments.endTime})::int`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            // Bounded lookback keeps the per-day grouping cheap.
            gte(appointments.endTime, sql`now() - interval '45 days'`),
            sql`(${appointments.endTime} at time zone 'UTC')::date < (now() at time zone 'UTC')::date`,
          ),
        )
        .groupBy(sql`(${appointments.endTime} at time zone 'UTC')::date`)
        .orderBy(sql`(${appointments.endTime} at time zone 'UTC')::date desc`),
    ]);

    // Streak = consecutive most-recent days with zero overdue tasks.
    let streak = 0;
    for (const row of streakRows) {
      if (Number(row.overdue) === 0) {
        streak += 1;
      } else {
        break;
      }
    }

    const activeShift =
      roleResult.source === "shift" ? roleResult.activeShift : null;

    return res.json({
      shift: activeShift ? buildShiftWindow(activeShift) : null,
      streak,
      tasksCompletedToday: Number(completedRows[0]?.n ?? 0),
      scansToday: Number(scanRows[0]?.n ?? 0),
    });
  } catch (err) {
    console.error("home:dashboard", err);
    return apiError(req, res, "errors.server.internalError", undefined, 500);
  }
});

export default router;
