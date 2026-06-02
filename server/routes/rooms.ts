import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, equipment, rooms, scanLogs, users } from "../db.js";
import { eq, and, isNull, isNotNull, sql, desc, gt } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";

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

function resolveRequestId(
  res: { getHeader: (name: string) => unknown; setHeader?: (name: string, value: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }
  return requestId;
}

function apiError(params: {
  code: string;
  reason: string;
  message: string;
  requestId: string;
  details?: unknown;
}) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
    ...(params.details !== undefined ? { details: params.details } : {}),
  };
}

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

    const counts = await db
      .select({
        roomId: equipment.roomId,
        total: sql<number>`count(*)::int`,
        inUse: sql<number>`count(*) filter (where ${equipment.checkedOutById} is not null)::int`,
        issue: sql<number>`count(*) filter (where ${equipment.status} in ('issue', 'maintenance'))::int`,
        recentlyVerified: sql<number>`count(*) filter (where ${equipment.lastVerifiedAt} > ${cutoff24h})::int`,
      })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), isNotNull(equipment.roomId), isNull(equipment.deletedAt)))
      .groupBy(equipment.roomId);

    const countMap = new Map(counts.map((c) => [c.roomId, c]));

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

    res.json({
      ...room,
      totalEquipment: total,
      availableCount: total - inUse,
      inUseCount: inUse,
      issueCount: issue,
      recentlyVerifiedCount: recentlyVerified,
      linkedPatientName: null,
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
