import { Router } from "express";
import { randomUUID } from "crypto";
import { db, scanLogs, transferLogs, equipment, users } from "../db.js";
import { and, desc, eq, count, lt } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { sql } from "drizzle-orm";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

/*
 * PERMISSIONS MATRIX — /api/activity
 * ─────────────────────────────────────────────────────
 * GET  /               student+  Combined scan/transfer activity feed
 * GET  /my-scan-count  student+  Count of scans made by the current user
 * ─────────────────────────────────────────────────────
 * Viewer read access is intentional — all authenticated users should
 * be able to see activity history for transparency and onboarding.
 */

const router = Router();



const PAGE_SIZE = 30;

router.get("/", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const rawCursor = typeof req.query.cursor === "string" ? req.query.cursor : "";
    let cursorDate: Date | null = null;
    if (rawCursor) {
      const parsed = new Date(rawCursor);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json(
          apiError({
            code: "VALIDATION_FAILED",
            reason: "INVALID_CURSOR",
            message: "Invalid cursor",
            requestId,
          }),
        );
      }
      cursorDate = parsed;
    }

    const scans = await db
      .select({
        id: scanLogs.id,
        equipmentId: scanLogs.equipmentId,
        equipmentName: equipment.name,
        userId: scanLogs.userId,
        userEmail: scanLogs.userEmail,
        status: scanLogs.status,
        note: scanLogs.note,
        timestamp: scanLogs.timestamp,
        type: sql<string>`'scan'`,
        fromFolder: sql<string>`null::text`,
        toFolder: sql<string>`null::text`,
      })
      .from(scanLogs)
      .leftJoin(equipment, and(eq(scanLogs.equipmentId, equipment.id), eq(equipment.clinicId, clinicId)))
      .where(and(eq(scanLogs.clinicId, clinicId), cursorDate ? lt(scanLogs.timestamp, cursorDate) : undefined))
      .orderBy(desc(scanLogs.timestamp))
      .limit(PAGE_SIZE + 1);

    const transfers = await db
      .select({
        id: transferLogs.id,
        equipmentId: transferLogs.equipmentId,
        equipmentName: equipment.name,
        userId: transferLogs.userId,
        userEmail: sql<string>`COALESCE(${users.email}, '')`,
        userDisplayName: sql<string>`COALESCE(${users.name}, ${users.email}, '')`,
        status: sql<string>`null::text`,
        note: transferLogs.note,
        timestamp: transferLogs.timestamp,
        type: sql<string>`'transfer'`,
        fromFolder: transferLogs.fromFolderName,
        toFolder: transferLogs.toFolderName,
      })
      .from(transferLogs)
      .leftJoin(equipment, and(eq(transferLogs.equipmentId, equipment.id), eq(equipment.clinicId, clinicId)))
      .leftJoin(users, and(eq(transferLogs.userId, users.id), eq(users.clinicId, clinicId)))
      .where(and(eq(transferLogs.clinicId, clinicId), cursorDate ? lt(transferLogs.timestamp, cursorDate) : undefined))
      .orderBy(desc(transferLogs.timestamp))
      .limit(PAGE_SIZE + 1);

    const combined = [
      ...scans.map((s) => ({
        id: s.id,
        type: "scan" as const,
        equipmentId: s.equipmentId,
        equipmentName: s.equipmentName || "Unknown",
        status: s.status,
        note: s.note,
        userId: s.userId,
        userEmail: s.userEmail,
        timestamp: new Date(s.timestamp).toISOString(),
      })),
      ...transfers.map((t) => ({
        id: t.id,
        type: "transfer" as const,
        equipmentId: t.equipmentId,
        equipmentName: t.equipmentName || "Unknown",
        fromFolder: t.fromFolder,
        toFolder: t.toFolder,
        note: t.note ?? null,
        userId: t.userId,
        userEmail: t.userEmail,
        timestamp: new Date(t.timestamp).toISOString(),
      })),
    ]
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, PAGE_SIZE + 1);

    const hasMore = combined.length > PAGE_SIZE;
    const items = combined.slice(0, PAGE_SIZE);
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].timestamp : null;

    res.json({ items, nextCursor });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ACTIVITY_FEED_FETCH_FAILED",
        message: "הבאת הפעילות נכשלה",
        requestId,
      }),
    );
  }
});

// GET /api/activity/my-scan-count — reliable check for onboarding eligibility
router.get("/my-scan-count", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [row] = await db
      .select({ scanCount: count() })
      .from(scanLogs)
      .where(and(eq(scanLogs.clinicId, clinicId), eq(scanLogs.userId, req.authUser!.id)));
    res.json({ count: row?.scanCount ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "MY_SCAN_COUNT_FETCH_FAILED",
        message: "הבאת כמות הסריקות נכשלה",
        requestId,
      }),
    );
  }
});

export default router;
