/**
 * Docking ownership routes (T1.4) — Home Room (+ Category) assignment and
 * a reconciliation read exposing the two ownership-derivable buckets:
 * unassigned (homeRoomId or assetTypeId missing) and noStation (both set,
 * but no dock exists for that (room, category) pair).
 *
 * Consumes T1.2 pure derivation (server/services/docking.service.ts) —
 * resolveHomeDock / dockExpectedFill — rather than reimplementing the
 * (room, category) → dock lookup or expected-fill counting here.
 */
import { Router } from "express";
import { z } from "zod";
import { db, equipment, docks } from "../db.js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logAudit } from "../lib/audit.js";
import { apiError } from "../lib/apiError.js";
import { resolveHomeDock, dockExpectedFill } from "../services/docking.service.js";

const router = Router();

const assignHomeSchema = z.object({
  homeRoomId: z.string().nullable(),
  assetTypeId: z.string().nullable().optional(),
});

/**
 * PATCH /api/docking/equipment/:id/home
 *
 * Admin-gated metadata write. Scoped by clinicId + id (and excludes
 * soft-deleted rows). This is not a full optimistic-concurrency endpoint —
 * there is no client-supplied `version` to compare against — but every
 * write still bumps `version` so downstream optimistic-concurrency writers
 * (e.g. the main equipment PATCH) observe the change.
 */
router.patch(
  "/equipment/:id/home",
  requireAuth,
  requireAdmin,
  validateBody(assignHomeSchema),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const { id: userId, email } = req.authUser!;
    const { id } = req.params;
    const { homeRoomId, assetTypeId } = req.body as z.infer<typeof assignHomeSchema>;

    const [updated] = await db
      .update(equipment)
      .set({
        homeRoomId: homeRoomId ?? null,
        ...(assetTypeId !== undefined && { assetTypeId: assetTypeId ?? null }),
        version: sql`${equipment.version} + 1`,
      })
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, id), isNull(equipment.deletedAt)))
      .returning();

    if (!updated) return apiError(req, res, "errors.notFound", undefined, 404);

    logAudit({
      clinicId,
      actionType: "equipment_home_assigned",
      performedBy: userId,
      performedByEmail: email,
      targetId: id,
      metadata: { homeRoomId, assetTypeId },
    });

    res.json(updated);
  },
);

const bulkAssignHomeSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  homeRoomId: z.string().nullable(),
  assetTypeId: z.string().nullable().optional(),
});

/** POST /api/docking/equipment/home/bulk — same home to every id, one UPDATE, one audit row. */
router.post(
  "/equipment/home/bulk",
  requireAuth,
  requireAdmin,
  validateBody(bulkAssignHomeSchema),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const { id: userId, email } = req.authUser!;
    const { ids, homeRoomId, assetTypeId } = req.body as z.infer<typeof bulkAssignHomeSchema>;

    const updatedRows = await db
      .update(equipment)
      .set({
        homeRoomId: homeRoomId ?? null,
        ...(assetTypeId !== undefined && { assetTypeId: assetTypeId ?? null }),
        version: sql`${equipment.version} + 1`,
      })
      .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.id, ids), isNull(equipment.deletedAt)))
      .returning({ id: equipment.id });

    logAudit({
      clinicId,
      actionType: "equipment_home_assigned",
      performedBy: userId,
      performedByEmail: email,
      targetId: null,
      metadata: { homeRoomId, assetTypeId, count: updatedRows.length },
    });

    res.json({ updated: updatedRows.length });
  },
);

/**
 * GET /api/docking/reconciliation
 *
 * Loads this clinic's docks + a small equipment projection once, then
 * derives all three buckets in memory via the T1.2 pure functions —
 * no per-item queries.
 */
router.get("/reconciliation", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;

  const [clinicDocks, clinicEquipment] = await Promise.all([
    db.select().from(docks).where(eq(docks.clinicId, clinicId)),
    db
      .select({
        id: equipment.id,
        name: equipment.name,
        homeRoomId: equipment.homeRoomId,
        assetTypeId: equipment.assetTypeId,
      })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt))),
  ]);

  const unassigned = clinicEquipment.filter((item) => item.homeRoomId === null || item.assetTypeId === null);
  const noStation = clinicEquipment.filter(
    (item) =>
      item.homeRoomId !== null &&
      item.assetTypeId !== null &&
      resolveHomeDock(item, clinicDocks) === null,
  );
  const byDock = clinicDocks.map((dock) => ({
    dock,
    expectedFill: dockExpectedFill(dock, clinicEquipment),
    capacity: dock.capacity,
  }));

  res.json({ unassigned, noStation, byDock });
});

export default router;
