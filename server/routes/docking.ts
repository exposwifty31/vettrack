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
import { db, equipment, docks, rooms, equipmentAnchors } from "../db.js";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limiters.js";
import { validateBody } from "../middleware/validate.js";
import { logAudit } from "../lib/audit.js";
import { apiError } from "../lib/apiError.js";
import { referencedIdsBelongToClinic } from "../lib/clinic-scoped-refs.js";
import {
  resolveHomeDock,
  dockExpectedFill,
  classifyReconciliationBucket,
  type ClassifierCtx,
} from "../services/docking.service.js";
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
router.post("/equipment/:id/citizen-anchor", requireAuth, writeLimiter, async (req, res) => {
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

  const anchor = await db.transaction(async (tx) =>
    createAnchor(tx, {
      clinicId,
      equipmentId: id,
      dockId: homeDock.id,
      roomId: homeDock.roomId,
      assertedById: userId,
      source: "citizen",
    }),
  );

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
router.post("/equipment/:id/not-found-here", requireAuth, writeLimiter, async (req, res) => {
  const clinicId = req.clinicId!;
  const { id: userId, email } = req.authUser!;
  const { id } = req.params;

  const [item] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, id), isNull(equipment.deletedAt)));

  if (!item) return apiError(req, res, "errors.notFound", undefined, 404);

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

/**
 * GET /api/docking/rooms/:roomId/sweep
 *
 * P3 T3.2a — the expected list for a per-shift Room Sweep (design §5,
 * §6.2/§6.3): every item HOMED to this room (resting + checked-out —
 * checked-out items are shown but D-9 accounted, never swept/missing),
 * each classified via the T3.1 reconciliation ladder. One anchors query
 * for the room's item ids (not per-item) to avoid N+1.
 */
router.get("/rooms/:roomId/sweep", requireAuth, async (req, res) => {
  const clinicId = req.clinicId!;
  const { roomId } = req.params;

  const [room] = await db.select().from(rooms).where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, roomId)));
  if (!room) return apiError(req, res, "errors.notFound", undefined, 404);

  const [clinicDocks, expectedItems] = await Promise.all([
    db.select().from(docks).where(eq(docks.clinicId, clinicId)),
    db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.homeRoomId, roomId), isNull(equipment.deletedAt))),
  ]);

  const itemIds = expectedItems.map((item) => item.id);
  const anchorRows = itemIds.length
    ? await db
        .select()
        .from(equipmentAnchors)
        .where(and(eq(equipmentAnchors.clinicId, clinicId), inArray(equipmentAnchors.equipmentId, itemIds)))
        .orderBy(desc(equipmentAnchors.assertedAt))
    : [];

  const anchorsByEquipmentId = new Map<string, typeof anchorRows>();
  for (const anchor of anchorRows) {
    const bucket = anchorsByEquipmentId.get(anchor.equipmentId);
    if (bucket) bucket.push(anchor);
    else anchorsByEquipmentId.set(anchor.equipmentId, [anchor]);
  }

  const items = expectedItems.map((item) => {
    const homeDock = resolveHomeDock({ homeRoomId: item.homeRoomId, assetTypeId: item.assetTypeId }, clinicDocks);
    const anchorsForItem = anchorsByEquipmentId.get(item.id) ?? []; // already ordered assertedAt DESC
    const currentAnchor = anchorsForItem.find((a) => a.invalidatedAt === null) ?? null;
    const lastContradictionReason: ClassifierCtx["lastContradictionReason"] = currentAnchor
      ? null
      : (anchorsForItem[0]?.invalidatedReason ?? null) as ClassifierCtx["lastContradictionReason"];

    const bucket = classifyReconciliationBucket(
      {
        checkedOutById: item.checkedOutById,
        homeRoomId: item.homeRoomId,
        assetTypeId: item.assetTypeId,
        roomId: item.roomId,
        lastRfidRoomId: item.lastRfidRoomId,
      },
      { homeDock: homeDock ? { id: homeDock.id } : null, currentAnchor, lastContradictionReason },
    );

    return {
      id: item.id,
      name: item.name,
      assetTypeId: item.assetTypeId,
      custodyState: item.custodyState,
      checkedOutById: item.checkedOutById,
      checkedOutByEmail: item.checkedOutByEmail,
      homeDockId: homeDock?.id ?? null,
      homeDockName: homeDock?.name ?? null,
      atStation: currentAnchor !== null && homeDock !== null && currentAnchor.dockId === homeDock.id,
      bucket,
    };
  });

  res.json({ roomId, items });
});

const roomSweepCommitSchema = z.object({
  confirmedEquipmentIds: z.array(z.string()).max(1000),
});

/**
 * POST /api/docking/rooms/:roomId/sweep
 *
 * P3 T3.2a — commits a Room Sweep. Confirmed expected-resting items get a
 * fresh source:"sweep" anchor at their home dock; unconfirmed
 * expected-resting items are contradicted (reason:"sweep_missing").
 * Checked-out items are D-9 accounted — never swept or marked missing.
 * A confirmed id that is checked-out or foreign to this room's expected-
 * resting set is silently ignored, not errored. One transaction.
 */
router.post(
  "/rooms/:roomId/sweep",
  requireAuth,
  writeLimiter,
  validateBody(roomSweepCommitSchema),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const { id: userId, email } = req.authUser!;
    const { roomId } = req.params;
    const { confirmedEquipmentIds } = req.body as z.infer<typeof roomSweepCommitSchema>;

    const [room] = await db.select().from(rooms).where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, roomId)));
    if (!room) return apiError(req, res, "errors.notFound", undefined, 404);

    const confirmedSet = new Set(confirmedEquipmentIds);
    let confirmedCount = 0;
    let missingCount = 0;

    await db.transaction(async (tx) => {
      const [clinicDocks, expectedResting] = await Promise.all([
        tx.select().from(docks).where(eq(docks.clinicId, clinicId)),
        tx
          .select()
          .from(equipment)
          .where(
            and(
              eq(equipment.clinicId, clinicId),
              eq(equipment.homeRoomId, roomId),
              isNull(equipment.deletedAt),
              ne(equipment.custodyState, "checked_out"),
            ),
          ),
      ]);

      for (const item of expectedResting) {
        if (confirmedSet.has(item.id)) {
          const homeDock = resolveHomeDock({ homeRoomId: item.homeRoomId, assetTypeId: item.assetTypeId }, clinicDocks);
          if (!homeDock) continue; // no resolvable home dock — nothing to anchor to; neither swept nor missing
          await createAnchor(tx, {
            clinicId,
            equipmentId: item.id,
            dockId: homeDock.id,
            roomId: homeDock.roomId,
            assertedById: userId,
            source: "sweep",
          });
          confirmedCount++;
        } else {
          await invalidateCurrentAnchor(tx, { clinicId, equipmentId: item.id, reason: "sweep_missing" });
          missingCount++;
        }
      }
    });

    const sweptAt = new Date().toISOString();

    logAudit({
      clinicId,
      actionType: "room_swept",
      performedBy: userId,
      performedByEmail: email,
      targetId: roomId,
      metadata: { confirmed: confirmedCount, missing: missingCount },
    });

    res.json({ roomId, confirmedCount, missingCount, sweptById: userId, sweptAt });
  },
);

export default router;
