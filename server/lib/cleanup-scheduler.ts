import { and, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, users } from "../db.js";
import { logAudit } from "./audit.js";
import { countAnimalPurgeCandidates, purgeSoftDeletedAnimals } from "../services/patient-animal-lifecycle.service.js";

/**
 * PURGE_AFTER_DAYS controls how long a soft-deleted user row is retained before
 * it becomes eligible for permanent purging via the explicit admin purge endpoint.
 *
 * The automatic daily cleanup job NEVER hard-deletes rows — it only counts and
 * logs eligible rows so operators have visibility. Hard deletion requires an
 * explicit admin action via POST /api/users/purge-deleted.
 *
 * Root cause note: the previous implementation hard-deleted users after 7 days
 * with no audit trail, causing users who had been accidentally soft-deleted to
 * permanently lose their role, status, and history associations on re-login.
 */
export const PURGE_AFTER_DAYS = 90;
const PURGE_AFTER_MS = PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the number of soft-deleted users that have been deleted for longer
 * than PURGE_AFTER_DAYS. Does NOT perform any deletions — use
 * purgeDeletedUsers() for that, which requires explicit admin intent.
 */
export async function countPurgeCandidates(): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_MS);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, cutoff)));
  return count ?? 0;
}

/**
 * Hard-deletes soft-deleted users older than PURGE_AFTER_DAYS.
 * Must only be called via the explicit admin endpoint — NOT automatically.
 * Logs an audit entry for every deleted user.
 */
export async function purgeDeletedUsers(params: {
  actorId: string;
  actorEmail: string;
  actorRole: string;
  clinicId: string;
}): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_MS);

  // Fetch the rows first so we can log each one before deletion.
  const candidates = await db
    .select({ id: users.id, email: users.email, role: users.role, deletedAt: users.deletedAt })
    .from(users)
    .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, cutoff)));

  if (candidates.length === 0) return { purged: 0 };

  const ids = candidates.map((u) => u.id);

  await db.delete(users).where(inArray(users.id, ids));

  logAudit({
    actorRole: params.actorRole,
    clinicId: params.clinicId,
    actionType: "users_hard_purged",
    performedBy: params.actorId,
    performedByEmail: params.actorEmail,
    targetType: "user",
    metadata: {
      purgedCount: candidates.length,
      purgeCutoffDays: PURGE_AFTER_DAYS,
      purgedUserIds: ids,
      purgedEmails: candidates.map((u) => u.email),
    },
  });

  console.log(`[cleanup] admin purge: hard-deleted ${candidates.length} user(s) older than ${PURGE_AFTER_DAYS} days`);
  return { purged: candidates.length };
}

let cleanupSchedulerStarted = false;

/**
 * Starts the daily cleanup scheduler. Counts and logs eligible-for-purge users
 * so operators have visibility, but does NOT automatically hard-delete anyone.
 */
export function startCleanupScheduler(): void {
  if (cleanupSchedulerStarted) return;
  cleanupSchedulerStarted = true;

  const runCheck = () => {
    void countPurgeCandidates()
      .then((count) => {
        if (count > 0) {
          console.log(
            `[cleanup] ${count} soft-deleted user(s) are eligible for purge ` +
              `(deleted >${PURGE_AFTER_DAYS}d ago). Use POST /api/users/purge-deleted to remove them.`,
          );
        }
      })
      .catch((err) => {
        console.error("[cleanup] user purge candidate check failed:", err);
      });

    void countAnimalPurgeCandidates()
      .then(async (count) => {
        if (count > 0) {
          const { purged } = await purgeSoftDeletedAnimals();
          if (purged > 0) {
            console.log(`[cleanup] hard-purged ${purged} soft-deleted animal(s) after ${PURGE_AFTER_DAYS}d retention`);
          } else {
            console.log(
              `[cleanup] ${count} soft-deleted animal(s) passed retention but purge did not complete (check logs)`,
            );
          }
        }
      })
      .catch((err) => {
        console.error("[cleanup] animal purge failed:", err);
      });
  };

  runCheck();
  setInterval(runCheck, DAILY_INTERVAL_MS);
}
