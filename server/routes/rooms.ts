import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, equipment, rooms, scanLogs, users, docks, equipmentAnchors } from "../db.js";
import { eq, and, isNull, isNotNull, inArray, sql, desc, gt } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { roomExpected, resolveHomeDock, classifyReconciliationBucket } from "../services/docking.service.js";

/*
 * PERMISSIONS MATRIX — /api/rooms
 * ─────────────────────────────────────────────────────
 * GET  /           student+      List rooms with equipment counts
 * GET  /:id        student+      Get single room
 * POST /           technician+   Create room
 * PATCH /:id       admin-only    Update room metadata
 * DELETE /:id      admin-only    Delete room (must be empty)
 * ─────────────────────────────────────────────────────
 */

const router = Router();

const createRoomSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  floor: z.string().max(100).optional(),
  masterNfcTagId: z.string().max(200).optional(),
  gatewayCode: z.string().max(64).optional(),
});

const patchRoomSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  floor: z.string().max(100).optional().nullable(),
  masterNfcTagId: z.string().max(200).optional().nullable(),
  gatewayCode: z.string().max(64).optional().nullable(),
  syncStatus: z.enum(["synced", "stale", "requires_audit"]).optional(),
});

type LastSweptRow = {
  home_room_id: string;
  asserted_at: Date | string;
  sweeper_name: string | null;
  sweeper_display_name: string | null;
};

/**
 * S2-1 (pre-PR review, MAJOR): per-room "last swept" (docking P3 T3.4-i-b
 * Part A) — the most recent sweep-derived anchor among items currently
 * homed to each room, plus the asserter's display name. ONE bounded
 * DISTINCT ON (home_room_id) query, not an unbounded full-history select
 * over every source:"sweep" anchor for the clinic deduped in JS. Shared by
 * both GET /api/rooms (roomId omitted — every room) and GET /api/rooms/:id
 * (roomId passed — scoped to that one room), so the derivation isn't
 * copy-pasted a third time. All-time, not shift-scoped.
 *
 * A2-7 (CodeRabbit PR #106): "swept" counts EITHER a `source:"sweep"`
 * anchor (a confirmed-present item — displayed at `asserted_at`) OR an
 * `invalidated_reason:"sweep_missing"` anchor (an unconfirmed item, A1-1 —
 * displayed at `invalidated_at`, the sweep's own timestamp, since that
 * anchor's `asserted_at` may predate this sweep entirely for an item that
 * had a prior open anchor from some other source). Without the second
 * branch, a sweep that confirms zero items present leaves no
 * `source:"sweep"` anchor at all, so the room falsely shows "never swept".
 */
async function lastSweptByRoom(
  clinicId: string,
  roomId?: string,
): Promise<Map<string, { lastSweptAt: string; lastSweptByName: string | null }>> {
  const result = await db.execute<LastSweptRow>(sql`
    SELECT DISTINCT ON (e.home_room_id)
      e.home_room_id,
      CASE WHEN a.invalidated_reason = 'sweep_missing' THEN a.invalidated_at ELSE a.asserted_at END AS asserted_at,
      u.name AS sweeper_name, u.display_name AS sweeper_display_name
    FROM vt_equipment_anchors a
    INNER JOIN vt_equipment e ON e.id = a.equipment_id AND e.clinic_id = ${clinicId}
    LEFT JOIN vt_users u ON u.id = a.asserted_by_id AND u.clinic_id = ${clinicId}
    WHERE a.clinic_id = ${clinicId}
      AND (a.source = 'sweep' OR a.invalidated_reason = 'sweep_missing')
      AND e.home_room_id IS NOT NULL
      AND e.deleted_at IS NULL
      ${roomId ? sql`AND e.home_room_id = ${roomId}` : sql``}
    ORDER BY e.home_room_id, asserted_at DESC
  `);

  const map = new Map<string, { lastSweptAt: string; lastSweptByName: string | null }>();
  for (const row of result.rows) {
    map.set(row.home_room_id, {
      lastSweptAt: new Date(row.asserted_at).toISOString(),
      lastSweptByName: row.sweeper_display_name || row.sweeper_name || null,
    });
  }
  return map;
}

// GET /api/rooms — list all rooms with per-room equipment counts
router.get("/", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const allRooms = await db
      .select()
      .from(rooms)
      .where(eq(rooms.clinicId, clinicId))
      .orderBy(rooms.name);

    if (allRooms.length === 0) {
      return res.json([]);
    }

    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [counts, homedEquipment, clinicDocks, lastSweptByRoomId] = await Promise.all([
      db
        .select({
          roomId: equipment.roomId,
          total: sql<number>`count(*)::int`,
          inUse: sql<number>`count(*) filter (where ${equipment.checkedOutById} is not null)::int`,
          issue: sql<number>`count(*) filter (where ${equipment.status} in ('issue', 'maintenance'))::int`,
          recentlyVerified: sql<number>`count(*) filter (where ${equipment.lastVerifiedAt} > ${cutoff24h})::int`,
        })
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), isNotNull(equipment.roomId), isNull(equipment.deletedAt)))
        .groupBy(equipment.roomId),
      // Present-vs-expected readiness (design §6.4) is homed-based, not
      // current-room-based — a room's expected fill is what's HOMED there,
      // regardless of where an item currently sits.
      db
        .select({
          id: equipment.id,
          homeRoomId: equipment.homeRoomId,
          assetTypeId: equipment.assetTypeId,
          checkedOutById: equipment.checkedOutById,
        })
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), isNotNull(equipment.homeRoomId), isNull(equipment.deletedAt))),
      db.select().from(docks).where(eq(docks.clinicId, clinicId)),
      lastSweptByRoom(clinicId),
    ]);

    const countMap = new Map(counts.map((c) => [c.roomId, c]));

    const homedIds = homedEquipment.map((item) => item.id);
    const anchorRows = homedIds.length
      ? await db
          .select({ equipmentId: equipmentAnchors.equipmentId, dockId: equipmentAnchors.dockId })
          .from(equipmentAnchors)
          .where(
            and(
              eq(equipmentAnchors.clinicId, clinicId),
              inArray(equipmentAnchors.equipmentId, homedIds),
              isNull(equipmentAnchors.invalidatedAt),
            ),
          )
      : [];
    const anchorDockByEquipmentId = new Map(anchorRows.map((a) => [a.equipmentId, a.dockId]));

    // T3.1 reconciliation ladder decides "at_home" before it ever needs
    // presence (roomId/lastRfidRoomId) or contradiction history, so those
    // are safe placeholders here — see docking.service.ts classifier order.
    const atHomeCountByRoomId = new Map<string, number>();
    for (const item of homedEquipment) {
      const homeDock = resolveHomeDock({ homeRoomId: item.homeRoomId, assetTypeId: item.assetTypeId }, clinicDocks);
      const hasAnchor = anchorDockByEquipmentId.has(item.id);
      const currentAnchor = hasAnchor ? { dockId: anchorDockByEquipmentId.get(item.id) ?? null } : null;
      const bucket = classifyReconciliationBucket(
        {
          checkedOutById: item.checkedOutById,
          homeRoomId: item.homeRoomId,
          assetTypeId: item.assetTypeId,
          roomId: null,
          lastRfidRoomId: null,
        },
        { homeDock: homeDock ? { id: homeDock.id } : null, currentAnchor, lastContradictionReason: null },
      );
      if (bucket === "at_home" && item.homeRoomId) {
        atHomeCountByRoomId.set(item.homeRoomId, (atHomeCountByRoomId.get(item.homeRoomId) ?? 0) + 1);
      }
    }

    const result = allRooms.map((room) => {
      const c = countMap.get(room.id);
      const total = c?.total ?? 0;
      const inUse = c?.inUse ?? 0;
      const issue = c?.issue ?? 0;
      const recentlyVerified = c?.recentlyVerified ?? 0;
      return {
        ...room,
        totalEquipment: total,
        availableCount: total - inUse,
        inUseCount: inUse,
        issueCount: issue,
        recentlyVerifiedCount: recentlyVerified,
        expectedFill: roomExpected(room.id, homedEquipment),
        atHomeCount: atHomeCountByRoomId.get(room.id) ?? 0,
        lastSweptAt: lastSweptByRoomId.get(room.id)?.lastSweptAt ?? null,
        lastSweptByName: lastSweptByRoomId.get(room.id)?.lastSweptByName ?? null,
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ROOMS_LIST_FAILED",
        message: "Failed to list rooms",
        requestId,
      }),
    );
  }
});

// GET /api/rooms/:id — single room with counts
router.get("/:id", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [room] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, req.params.id), eq(rooms.clinicId, clinicId)))
      .limit(1);

    if (!room) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "ROOM_NOT_FOUND",
          message: "Room not found",
          requestId,
        }),
      );
    }

    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        inUse: sql<number>`count(*) filter (where ${equipment.checkedOutById} is not null)::int`,
        issue: sql<number>`count(*) filter (where ${equipment.status} in ('issue', 'maintenance'))::int`,
        recentlyVerified: sql<number>`count(*) filter (where ${equipment.lastVerifiedAt} > ${cutoff24h})::int`,
      })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.roomId, room.id), isNull(equipment.deletedAt)));

    const total = counts?.total ?? 0;
    const inUse = counts?.inUse ?? 0;
    const issue = counts?.issue ?? 0;
    const recentlyVerified = counts?.recentlyVerified ?? 0;

    // "Last swept" (pre-PR review, MAJOR — mirrors the GET /api/rooms list
    // handler's derivation above, scoped to this one room via the shared
    // lastSweptByRoom helper): the most recent source:"sweep" anchor among
    // items currently HOMED to this room, joined to the asserting user's
    // name. All-time, not shift-scoped (the client's copy for this surface
    // is deliberately not "this shift").
    const lastSweptMap = await lastSweptByRoom(clinicId, room.id);
    const lastSweep = lastSweptMap.get(room.id);

    res.json({
      ...room,
      totalEquipment: total,
      availableCount: total - inUse,
      inUseCount: inUse,
      issueCount: issue,
      recentlyVerifiedCount: recentlyVerified,
      linkedPatientName: null,
      lastSweptAt: lastSweep?.lastSweptAt ?? null,
      lastSweptByName: lastSweep?.lastSweptByName ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ROOM_FETCH_FAILED",
        message: "Failed to fetch room",
        requestId,
      }),
    );
  }
});

// GET /api/rooms/:id/activity — last 5 scan_log entries for equipment in this room
router.get("/:id/activity", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const entries = await db
      .select({
        id: scanLogs.id,
        userId: scanLogs.userId,
        userEmail: scanLogs.userEmail,
        userName: users.name,
        equipmentId: scanLogs.equipmentId,
        equipmentName: equipment.name,
        status: scanLogs.status,
        note: scanLogs.note,
        timestamp: scanLogs.timestamp,
      })
      .from(scanLogs)
      .innerJoin(
        equipment,
        and(
          eq(scanLogs.equipmentId, equipment.id),
          eq(equipment.roomId, req.params.id),
          eq(equipment.clinicId, clinicId),
          eq(scanLogs.clinicId, clinicId)
        )
      )
      .leftJoin(users, and(eq(scanLogs.userId, users.id), eq(users.clinicId, clinicId)))
      .orderBy(desc(scanLogs.timestamp))
      .limit(5);

    const isAdmin = req.authUser?.role === "admin";
    res.json(
      entries.map(({ userName, ...e }) => ({
        ...(isAdmin ? { userName } : {}),
        ...e,
        timestamp: new Date(e.timestamp).toISOString(),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ROOM_ACTIVITY_FETCH_FAILED",
        message: "Failed to fetch room activity",
        requestId,
      }),
    );
  }
});

// POST /api/rooms — create room
router.post("/", requireAuth, requireEffectiveRole("technician"), validateBody(createRoomSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { name, floor, masterNfcTagId, gatewayCode } = req.body as z.infer<typeof createRoomSchema>;

    const [existing] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.clinicId, clinicId), eq(rooms.name, name.trim())))
      .limit(1);

    if (existing) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "ROOM_NAME_CONFLICT",
          message: "A room with that name already exists",
          requestId,
        }),
      );
    }

    const now = new Date();
    const [room] = await db
      .insert(rooms)
      .values({
        id: randomUUID(),
        clinicId,
        name: name.trim(),
        floor: floor?.trim() ?? null,
        masterNfcTagId: masterNfcTagId?.trim() ?? null,
        gatewayCode: gatewayCode?.trim() || null,
        syncStatus: "stale",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "room_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: room.id,
      targetType: "room",
      metadata: { name: room.name, floor: room.floor },
    });

    res.status(201).json(room);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ROOM_CREATE_FAILED",
        message: "Failed to create room",
        requestId,
      }),
    );
  }
});

// PATCH /api/rooms/:id — update room metadata
router.patch("/:id", requireAuth, requireAdmin, validateBody(patchRoomSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { name, floor, masterNfcTagId, gatewayCode, syncStatus } = req.body as z.infer<typeof patchRoomSchema>;

    const [existing] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, req.params.id), eq(rooms.clinicId, clinicId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "ROOM_NOT_FOUND",
          message: "Room not found",
          requestId,
        }),
      );
    }

    if (name !== undefined && name.trim() !== existing.name) {
      const [conflict] = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.clinicId, clinicId), eq(rooms.name, name.trim())))
        .limit(1);
      if (conflict) {
        return res.status(409).json(
          apiError({
            code: "CONFLICT",
            reason: "ROOM_NAME_CONFLICT",
            message: "A room with that name already exists",
            requestId,
          }),
        );
      }
    }

    const [updated] = await db
      .update(rooms)
      .set({
        ...(name !== undefined && { name: name.trim() }),
        ...(floor !== undefined && { floor: floor ?? null }),
        ...(masterNfcTagId !== undefined && { masterNfcTagId: masterNfcTagId ?? null }),
        ...(gatewayCode !== undefined && { gatewayCode: gatewayCode?.trim() || null }),
        ...(syncStatus !== undefined && { syncStatus }),
        updatedAt: new Date(),
      })
      .where(and(eq(rooms.id, req.params.id), eq(rooms.clinicId, clinicId)))
      .returning();

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "room_updated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "room",
      metadata: { previousName: existing.name, changes: req.body },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ROOM_UPDATE_FAILED",
        message: "Failed to update room",
        requestId,
      }),
    );
  }
});

// DELETE /api/rooms/:id — admin only, only if room has no equipment assigned
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, req.params.id), eq(rooms.clinicId, clinicId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "ROOM_NOT_FOUND",
          message: "Room not found",
          requestId,
        }),
      );
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.roomId, req.params.id), isNull(equipment.deletedAt)));

    if (count > 0) {
      return res.status(409).json({
        ...apiError({
          code: "CONFLICT",
          reason: "ROOM_NOT_EMPTY",
          message: `Cannot delete room — ${count} item${count !== 1 ? "s" : ""} still assigned to it`,
          requestId,
        }),
      });
    }

    await db.delete(rooms).where(and(eq(rooms.id, req.params.id), eq(rooms.clinicId, clinicId)));

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "room_deleted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "room",
      metadata: { name: existing.name },
    });

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ROOM_DELETE_FAILED",
        message: "Failed to delete room",
        requestId,
      }),
    );
  }
});

export default router;
