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
import { referencedIdsBelongToClinic } from "../lib/clinic-scoped-refs.js";
import { resolveHomeDock, dockExpectedFill } from "../services/docking.service.js";
import { createAnchor, invalidateCurrentAnchor } from "../services/equipment-anchor.service.js";

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

    if (!(await referencedIdsBelongToClinic(clinicId, homeRoomId, assetTypeId))) {
      return apiError(req, res, "errors.docking.invalidReference", undefined, 400);
    }

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

    // Dedupe — a client resubmitting the same id twice should not be treated
    // as a partial-bulk failure below.
    const uniqueIds = Array.from(new Set(ids));

    if (!(await referencedIdsBelongToClinic(clinicId, homeRoomId, assetTypeId))) {
      return apiError(req, res, "errors.docking.invalidReference", undefined, 400);
    }

    let updatedCount = 0;
    try {
      await db.transaction(async (tx) => {
        const updatedRows = await tx
          .update(equipment)
          .set({
            homeRoomId: homeRoomId ?? null,
            ...(assetTypeId !== undefined && { assetTypeId: assetTypeId ?? null }),
            version: sql`${equipment.version} + 1`,
          })
          .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.id, uniqueIds), isNull(equipment.deletedAt)))
          .returning({ id: equipment.id });

        // A short count means some ids don't exist, are deleted, or belong
        // to another clinic (the WHERE above is clinic-scoped, so a
        // cross-clinic id simply doesn't match). Roll back the whole batch
        // instead of silently applying a partial update.
        if (updatedRows.length !== uniqueIds.length) {
          throw new Error("PARTIAL_BULK");
        }
        updatedCount = updatedRows.length;
      });
    } catch (err) {
      if (err instanceof Error && err.message === "PARTIAL_BULK") {
        return apiError(req, res, "errors.docking.invalidEquipmentIds", undefined, 409);
      }
      throw err;
    }

    logAudit({
      clinicId,
      actionType: "equipment_home_assigned",
      performedBy: userId,
      performedByEmail: email,
      targetId: null,
      metadata: { homeRoomId, assetTypeId, count: updatedCount },
    });

    res.json({ updated: updatedCount });
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

/**
 * POST /api/docking/equipment/:id/citizen-anchor
 *
 * P2 T2.5 — "Not taking, confirming it's here": anyone can assert a resting
 * item is at its home station, healing the map. Requires the item to be
 * resting (custodyState !== "checked_out") and to have a resolvable home
 * dock (T1.2 resolveHomeDock) — both failure modes collapse to the same 409
 * (there is nowhere to anchor it).
 */
router.post("/equipment/:id/citizen-anchor", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { id } = req.params;

  const [item] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, id), isNull(equipment.deletedAt)));

  if (!item) return apiError(req, res, "errors.notFound", undefined, 404);

  if (item.custodyState === "checked_out") {
    return apiError(req, res, "errors.docking.noHomeStation", undefined, 409);
  }

  const clinicDocks = await db.select().from(docks).where(eq(docks.clinicId, clinicId));
  const homeDock = resolveHomeDock({ homeRoomId: item.homeRoomId, assetTypeId: item.assetTypeId }, clinicDocks);

  if (!homeDock) {
    return apiError(req, res, "errors.docking.noHomeStation", undefined, 409);
  }

  const anchor = await createAnchor(db, {
    clinicId,
    equipmentId: id,
    dockId: homeDock.id,
    roomId: homeDock.roomId,
    assertedById: userId,
    source: "citizen",
  });

  logAudit({
    clinicId,
    actionType: "equipment_anchor_created",
    performedBy: userId,
    performedByEmail: email,
    targetId: id,
    metadata: { dockId: homeDock.id, roomId: homeDock.roomId, source: "citizen" },
  });

  res.json(anchor);
});

/**
 * POST /api/docking/equipment/:id/not-found-here
 *
 * P2 T2.5 — a seeker reports a claimed/expected item is missing: a
 * contradiction that invalidates the item's current open anchor
 * (T2.2 invalidateCurrentAnchor, reason "not_found_here"). Idempotent — a
 * no-op (still 200) when no anchor is currently open.
 */
router.post("/equipment/:id/not-found-here", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { id } = req.params;

  await invalidateCurrentAnchor(db, { clinicId, equipmentId: id, reason: "not_found_here" });

  logAudit({
    clinicId,
    actionType: "equipment_anchor_contradicted",
    performedBy: userId,
    performedByEmail: email,
    targetId: id,
    metadata: { reason: "not_found_here" },
  });

  res.json({ ok: true });
});

export default router;
