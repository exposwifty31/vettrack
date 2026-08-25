import type { RequestHandler } from "express";
import { db, codeBlueSessions, codeBlueLogEntries, codeBluePresence, crashCartChecks } from "../../../db.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { fetchLinkedEquipmentForSession } from "../../../lib/code-blue-linked-equipment.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

// GET /api/code-blue/sessions/active — poll: session + log entries + presence + cart status
export const getSessionsActiveHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    // Active session — order by startedAt desc so the most recent is returned
    const [session] = await db
      .select()
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.clinicId, clinicId), eq(codeBlueSessions.status, "active")))
      .orderBy(desc(codeBlueSessions.startedAt))
      .limit(1);

    // Latest crash cart check (last 24h)
    const [latestCheck] = await db
      .select()
      .from(crashCartChecks)
      .where(
        and(
          eq(crashCartChecks.clinicId, clinicId),
          sql`${crashCartChecks.performedAt} > NOW() - INTERVAL '24 hours'`,
        ),
      )
      .orderBy(desc(crashCartChecks.performedAt))
      .limit(1);

    const cartStatus = latestCheck
      ? { lastCheckedAt: latestCheck.performedAt.toISOString(), allPassed: latestCheck.allPassed, performedByName: latestCheck.performedByName }
      : null;

    if (!session) {
      return res.json({ session: null, logEntries: [], presence: [], cartStatus, linkedEquipment: [] });
    }

    // Log entries ordered by elapsed time
    const logEntries = await db
      .select()
      .from(codeBlueLogEntries)
      .where(and(eq(codeBlueLogEntries.clinicId, clinicId), eq(codeBlueLogEntries.sessionId, session.id)))
      .orderBy(codeBlueLogEntries.elapsedMs);

    // Presence — filter stale (>30s)
    const presence = await db
      .select()
      .from(codeBluePresence)
      .where(
        and(
          eq(codeBluePresence.sessionId, session.id),
          sql`${codeBluePresence.lastSeenAt} > NOW() - INTERVAL '30 seconds'`,
        ),
      );

    const linkedEquipment = await fetchLinkedEquipmentForSession(clinicId, logEntries);

    res.json({
      session,
      logEntries,
      presence,
      cartStatus,
      linkedEquipment,
    });
  } catch (err) {
    console.error("[code-blue] poll failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_POLL_FAILED", message: "Poll failed", requestId }),
    );
  }
};
