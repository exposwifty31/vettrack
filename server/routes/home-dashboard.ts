import { Router } from "express";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { apiError } from "../lib/apiError.js";
import { appointments, db, scanLogs, shiftSessions } from "../db.js";

/*
 * GET /api/home/dashboard — aggregate "pulse" for the magnetic home dashboard.
 * Read-only. Composes data that no existing endpoint exposes: the open shift
 * session, a no-overdue streak, and today's completion counters. Every query
 * is clinic-scoped and bounded.
 */

const router = Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  const clinicId = req.clinicId?.trim();
  const userId = req.authUser?.id;

  if (!clinicId || !userId) {
    return apiError(req, res, "errors.validation", undefined, 400);
  }

  try {
    const [openSession, completedRows, scanRows, streakRows] = await Promise.all([
      // Latest still-open clinic shift session.
      db
        .select({ startedAt: shiftSessions.startedAt })
        .from(shiftSessions)
        .where(and(eq(shiftSessions.clinicId, clinicId), isNull(shiftSessions.endedAt)))
        .orderBy(sql`${shiftSessions.startedAt} desc`)
        .limit(1),

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

    return res.json({
      shift: openSession[0]
        ? { startedAt: new Date(openSession[0].startedAt).toISOString() }
        : null,
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
