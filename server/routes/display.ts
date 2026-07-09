// server/routes/display.ts
import type { RequestHandler } from "express";
import { Router } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { fetchLinkedEquipmentForSession } from "../lib/code-blue-linked-equipment.js";
import {
  db,
  appointments,
  codeBlueSessions,
  codeBlueLogEntries,
  codeBluePresence,
  crashCartChecks,
  displayDevices,
  equipment,
  rooms,
  shifts,
  users,
} from "../db.js";
import { requireAdmin, requireAuth, requireDisplayOrUser } from "../middleware/auth.js";
import { authSensitiveLimiter } from "../middleware/rate-limiters.js";
import { recordHeartbeat } from "../lib/display-heartbeat-store.js";
import {
  consumePairingCode,
  hashToken,
  issuePairingCode,
  mintToken,
} from "../lib/display-token.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { incrementMetric } from "../lib/metrics.js";
import { withTimeout } from "../lib/with-timeout.js";
import { isEquipmentFullyDeployable } from "../services/equipment-operational-state.service.js";
import {
  buildCommandBoardSnapshot,
  type BuildCommandBoardSnapshotFn,
} from "../services/equipment-command-board.service.js";
import type { EquipmentCommandBoardSnapshot } from "../../shared/equipment-board.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

export const COMMAND_BOARD_TIMEOUT_MS = 2500;

export type DisplayRouterDeps = {
  buildCommandBoardSnapshot?: BuildCommandBoardSnapshotFn;
  commandBoardTimeoutMs?: number;
};

function resolveProbableLocation(row: {
  usuallyFoundHere: string | null;
  roomName: string | null;
  checkedOutLocation: string | null;
  location: string | null;
}): string | null {
  const candidates = [row.usuallyFoundHere, row.roomName, row.checkedOutLocation, row.location];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function resolveHeldBy(row: {
  checkedOutById: string | null;
  checkedOutByEmail: string | null;
  holderDisplayName: string | null;
}): string | null {
  if (!row.checkedOutById && !row.checkedOutByEmail) return null;
  const name = row.holderDisplayName?.trim();
  if (name) return name;
  return row.checkedOutByEmail?.trim() || null;
}

export function createDisplaySnapshotHandler(deps: DisplayRouterDeps = {}): RequestHandler {
  const buildBoard = deps.buildCommandBoardSnapshot ?? buildCommandBoardSnapshot;
  const commandBoardTimeoutMs = deps.commandBoardTimeoutMs ?? COMMAND_BOARD_TIMEOUT_MS;

  return async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const now = new Date();
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const overdueRows = await db
        .select({
          id: appointments.id,
          startTime: appointments.startTime,
          notes: appointments.notes,
          taskType: appointments.taskType,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            inArray(appointments.status, ["pending", "assigned"]),
            lt(appointments.startTime, now),
          ),
        )
        .orderBy(appointments.startTime);

      const upcomingRows = await db
        .select({
          id: appointments.id,
          startTime: appointments.startTime,
          taskType: appointments.taskType,
          notes: appointments.notes,
          status: appointments.status,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            inArray(appointments.status, ["pending", "assigned", "scheduled"]),
            gte(appointments.startTime, now),
            lte(appointments.startTime, twoHoursLater),
          ),
        )
        .orderBy(appointments.startTime)
        .limit(20);

      const equipRows = await db
        .select({
          id: equipment.id,
          name: equipment.name,
          status: equipment.status,
          lastSeen: equipment.lastSeen,
          usuallyFoundHere: equipment.usuallyFoundHere,
          location: equipment.location,
          checkedOutLocation: equipment.checkedOutLocation,
          checkedOutById: equipment.checkedOutById,
          checkedOutByEmail: equipment.checkedOutByEmail,
          checkedOutAt: equipment.checkedOutAt,
          custodyState: equipment.custodyState,
          readinessState: equipment.readinessState,
          usageState: equipment.usageState,
          roomName: rooms.name,
          holderDisplayName: users.displayName,
        })
        .from(equipment)
        .leftJoin(rooms, and(eq(equipment.roomId, rooms.id), eq(rooms.clinicId, clinicId)))
        .leftJoin(users, and(eq(equipment.checkedOutById, users.id), eq(users.clinicId, clinicId)))
        .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)));

      const [alertCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(equipment)
        .where(
          and(
            eq(equipment.clinicId, clinicId),
            isNull(equipment.deletedAt),
            inArray(equipment.status, ["critical", "issue", "needs_attention"]),
          ),
        );

      const todayDate = now.toISOString().slice(0, 10);
      const nowTimeStr = now.toISOString().slice(11, 16);
      const shiftRows = await db
        .select()
        .from(shifts)
        .where(
          and(
            eq(shifts.clinicId, clinicId),
            eq(shifts.date, todayDate),
            lte(shifts.startTime, nowTimeStr),
            gte(shifts.endTime, nowTimeStr),
          ),
        );

      const [latestCart] = await db
        .select()
        .from(crashCartChecks)
        .where(eq(crashCartChecks.clinicId, clinicId))
        .orderBy(desc(crashCartChecks.performedAt))
        .limit(1);

      const [activeSession] = await db
        .select()
        .from(codeBlueSessions)
        .where(
          and(eq(codeBlueSessions.clinicId, clinicId), eq(codeBlueSessions.status, "active")),
        );

      let codeBluePayload = null;
      if (activeSession) {
        const logEntries = await db
          .select()
          .from(codeBlueLogEntries)
          .where(
            and(
              eq(codeBlueLogEntries.sessionId, activeSession.id),
              eq(codeBlueLogEntries.clinicId, clinicId),
            ),
          )
          .orderBy(codeBlueLogEntries.elapsedMs);

        const presence = await db
          .select()
          .from(codeBluePresence)
          .where(eq(codeBluePresence.sessionId, activeSession.id));

        const linkedEquipment = await fetchLinkedEquipmentForSession(clinicId, logEntries);

        codeBluePayload = {
          id: activeSession.id,
          startedAt: activeSession.startedAt.toISOString(),
          managerUserName: activeSession.managerUserName,
          preCheckPassed: activeSession.preCheckPassed,
          pushSentAt: activeSession.startedAt.toISOString(),
          linkedEquipment,
          logEntries: logEntries.map((e) => ({
            elapsedMs: e.elapsedMs,
            label: e.label,
            category: e.category,
            equipmentId: e.equipmentId,
            loggedByName: e.loggedByName,
          })),
          presence: presence.map((p) => ({
            userId: p.userId,
            userName: p.userName,
            lastSeenAt: p.lastSeenAt.toISOString(),
          })),
        };
      }

      let commandBoard: EquipmentCommandBoardSnapshot | null = null;
      try {
        commandBoard = await withTimeout(
          buildBoard({ clinicId }),
          commandBoardTimeoutMs,
        );
      } catch (error) {
        console.warn("[display snapshot] command_board_build_failed", {
          clinicId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      res.json({
        currentTime: now.toISOString(),
        currentShift: shiftRows.map((s) => ({
          employeeName: s.employeeName,
          role: s.role,
        })),
        hospitalizations: [],
        equipment: equipRows.map((e) => ({
          id: e.id,
          name: e.name,
          status: e.status,
          inUse: !!e.checkedOutAt,
          heldBy: resolveHeldBy(e),
          lastCheckInAt: e.lastSeen?.toISOString() ?? null,
          probableLocation: resolveProbableLocation(e),
          isDeployable: isEquipmentFullyDeployable(
            e.custodyState,
            e.readinessState,
            e.usageState,
          ),
          custodyState: e.custodyState,
          readinessState: e.readinessState,
          usageState: e.usageState,
        })),
        upcomingTasks: upcomingRows.map((r) => ({
          id: r.id,
          startTime: r.startTime.toISOString(),
          taskType: r.taskType,
          notes: r.notes,
          status: r.status,
        })),
        overdueTasks: overdueRows.map((r) => ({
          id: r.id,
          startTime: r.startTime.toISOString(),
          taskType: r.taskType,
          notes: r.notes,
        })),
        activeAlertCount: alertCountRow?.count ?? 0,
        totalOverdueCount: overdueRows.length,
        crashCartStatus: latestCart
          ? {
              lastCheckedAt: latestCart.performedAt.toISOString(),
              allPassed: latestCart.allPassed,
              performedByName: latestCart.performedByName,
            }
          : null,
        codeBlueSession: codeBluePayload,
        commandBoard,
      });
    } catch (err) {
      console.error("[display snapshot]", err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "SNAPSHOT_FAILED",
          message: "Failed to load display snapshot",
          requestId,
        }),
      );
    }
  };
}

function createDisplayHeartbeatHandler(): RequestHandler {
  return async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      // Phase 9 — paired display-device token branch (additive). Bump the
      // device's persistent lastSeenAt, clinic-scoped and revoked-filtered.
      // This is separate from the ephemeral session heartbeat store below.
      if (req.isDisplayAuth && req.displayDeviceId && req.clinicId) {
        const now = new Date();
        await db
          .update(displayDevices)
          .set({ lastSeenAt: now, updatedAt: now })
          .where(
            and(
              eq(displayDevices.id, req.displayDeviceId),
              eq(displayDevices.clinicId, req.clinicId),
              isNull(displayDevices.revokedAt),
            ),
          );
      }

      const body: unknown = req.body ?? {};
      const sessionId =
        typeof (body as { displaySessionId?: unknown }).displaySessionId === "string"
          ? (body as { displaySessionId: string }).displaySessionId
          : null;
      const kioskMode = (body as { kioskMode?: unknown }).kioskMode === true;

      if (!sessionId) {
        // A paired display-device heartbeat need not carry a session id — the
        // lastSeenAt bump above is the whole job. Only user/session heartbeats
        // require displaySessionId.
        if (req.isDisplayAuth) {
          return res.json({ ok: true });
        }
        return res.status(400).json(
          apiError({
            code: "INVALID_INPUT",
            reason: "MISSING_DISPLAY_SESSION_ID",
            message: "displaySessionId is required",
            requestId,
          }),
        );
      }

      const result = await recordHeartbeat({ rawSessionId: sessionId, kioskMode });

      if (result.accepted) {
        incrementMetric(
          result.kioskMode
            ? "display_heartbeats_received_kiosk"
            : "display_heartbeats_received_non_kiosk",
          1,
        );
      }

      res.json({ ok: true });
    } catch (err) {
      console.warn("[display:heartbeat]", (err as Error).message);
      res.json({ ok: true });
    }
  };
}

const MAX_DEVICE_NAME_LEN = 120;

function normalizeDeviceName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, MAX_DEVICE_NAME_LEN);
}

/** POST /pair/issue — admin mints a short-lived, clinic-bound pairing code. */
function createPairIssueHandler(): RequestHandler {
  return async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const issued = await issuePairingCode(clinicId);
      logAudit({
        clinicId,
        actionType: "display_pairing_code_issued",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetType: "display_pairing_code",
        metadata: { expiresAt: issued.expiresAt.toISOString() },
        actorRole: resolveAuditActorRole(req),
      });
      res.status(201).json({ code: issued.code, expiresAt: issued.expiresAt.toISOString() });
    } catch (err) {
      console.error("[display:pair/issue]", err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "PAIRING_CODE_ISSUE_FAILED",
          message: "Failed to issue pairing code",
          requestId,
        }),
      );
    }
  };
}

/**
 * POST /pair/claim — PUBLIC (no auth). A headless device redeems a pairing code
 * for a device token. The raw token is returned ONCE and never persisted; only
 * its hash is stored. Guarded by `authSensitiveLimiter` (5/min per IP).
 */
function createPairClaimHandler(): RequestHandler {
  return async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const body: unknown = req.body ?? {};
      const clinicId = await consumePairingCode((body as { code?: unknown }).code);
      if (!clinicId) {
        return res.status(400).json(
          apiError({
            code: "INVALID_PAIRING_CODE",
            reason: "INVALID_OR_EXPIRED_PAIRING_CODE",
            message: "Invalid or expired pairing code",
            requestId,
          }),
        );
      }

      const name = normalizeDeviceName((body as { name?: unknown }).name, "Display device");
      const id = randomUUID();
      const token = mintToken();
      await db.insert(displayDevices).values({
        id,
        clinicId,
        name,
        tokenHash: hashToken(token),
      });

      logAudit({
        clinicId,
        actionType: "display_device_paired",
        performedBy: id,
        performedByEmail: "display-device",
        targetId: id,
        targetType: "display_device",
        metadata: { name },
      });

      // Raw token returned exactly once — the device must persist it now.
      res.status(201).json({ id, token, name, clinicId });
    } catch (err) {
      console.error("[display:pair/claim]", err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "PAIRING_CLAIM_FAILED",
          message: "Failed to claim pairing code",
          requestId,
        }),
      );
    }
  };
}

/** GET /devices — admin, clinic-scoped device registry. NEVER returns token/hash. */
function createDevicesListHandler(): RequestHandler {
  return async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const rows = await db
        .select({
          id: displayDevices.id,
          name: displayDevices.name,
          lastSeenAt: displayDevices.lastSeenAt,
          revokedAt: displayDevices.revokedAt,
          createdAt: displayDevices.createdAt,
          updatedAt: displayDevices.updatedAt,
        })
        .from(displayDevices)
        .where(eq(displayDevices.clinicId, clinicId))
        .orderBy(desc(displayDevices.createdAt));

      res.json({
        devices: rows.map((d) => ({
          id: d.id,
          name: d.name,
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          revokedAt: d.revokedAt?.toISOString() ?? null,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error("[display:devices]", err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "DEVICE_LIST_FAILED",
          message: "Failed to load display devices",
          requestId,
        }),
      );
    }
  };
}

/** PATCH /devices/:id — admin rename, clinic-scoped. */
function createDeviceRenameHandler(): RequestHandler {
  return async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const id = req.params.id;
      const rawName = (req.body as { name?: unknown } | undefined)?.name;
      if (typeof rawName !== "string" || !rawName.trim()) {
        return res.status(400).json(
          apiError({
            code: "INVALID_INPUT",
            reason: "MISSING_DEVICE_NAME",
            message: "name is required",
            requestId,
          }),
        );
      }
      const name = rawName.trim().slice(0, MAX_DEVICE_NAME_LEN);

      const [updated] = await db
        .update(displayDevices)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(displayDevices.id, id), eq(displayDevices.clinicId, clinicId)))
        .returning({
          id: displayDevices.id,
          name: displayDevices.name,
          lastSeenAt: displayDevices.lastSeenAt,
          revokedAt: displayDevices.revokedAt,
          createdAt: displayDevices.createdAt,
          updatedAt: displayDevices.updatedAt,
        });

      if (!updated) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "DISPLAY_DEVICE_NOT_FOUND",
            message: "Display device not found",
            requestId,
          }),
        );
      }

      logAudit({
        clinicId,
        actionType: "display_device_renamed",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetId: id,
        targetType: "display_device",
        metadata: { name },
        actorRole: resolveAuditActorRole(req),
      });

      res.json({
        device: {
          id: updated.id,
          name: updated.name,
          lastSeenAt: updated.lastSeenAt?.toISOString() ?? null,
          revokedAt: updated.revokedAt?.toISOString() ?? null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
    } catch (err) {
      console.error("[display:devices/:id rename]", err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "DEVICE_RENAME_FAILED",
          message: "Failed to rename display device",
          requestId,
        }),
      );
    }
  };
}

/** POST /devices/:id/revoke — admin revoke, clinic-scoped. Idempotent-ish: an already-revoked/unknown id → 404. */
function createDeviceRevokeHandler(): RequestHandler {
  return async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const id = req.params.id;
      const now = new Date();

      const [revoked] = await db
        .update(displayDevices)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(displayDevices.id, id),
            eq(displayDevices.clinicId, clinicId),
            isNull(displayDevices.revokedAt),
          ),
        )
        .returning({ id: displayDevices.id });

      if (!revoked) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "DISPLAY_DEVICE_NOT_FOUND",
            message: "Active display device not found",
            requestId,
          }),
        );
      }

      logAudit({
        clinicId,
        actionType: "display_device_revoked",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetId: id,
        targetType: "display_device",
        actorRole: resolveAuditActorRole(req),
      });

      res.json({ ok: true, id });
    } catch (err) {
      console.error("[display:devices/:id/revoke]", err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "DEVICE_REVOKE_FAILED",
          message: "Failed to revoke display device",
          requestId,
        }),
      );
    }
  };
}

/** Factory — mount a fresh Router per path (never reuse the same instance). */
export function createDisplayRouter(deps: DisplayRouterDeps = {}): Router {
  const router = Router();

  // Pairing lifecycle.
  router.post("/pair/issue", requireAuth, requireAdmin, createPairIssueHandler());
  router.post("/pair/claim", authSensitiveLimiter, createPairClaimHandler());

  // Display-device OR user consumable surfaces (token reaches ONLY these).
  router.get("/snapshot", requireDisplayOrUser, createDisplaySnapshotHandler(deps));
  router.post("/heartbeat", requireDisplayOrUser, createDisplayHeartbeatHandler());

  // Admin device management (user-only; never accepts a display token).
  router.get("/devices", requireAuth, requireAdmin, createDevicesListHandler());
  router.patch("/devices/:id", requireAuth, requireAdmin, createDeviceRenameHandler());
  router.post("/devices/:id/revoke", requireAuth, requireAdmin, createDeviceRevokeHandler());

  return router;
}

/** @deprecated Prefer `createDisplayRouter()` at mount sites. */
const defaultRouter = createDisplayRouter();
export default defaultRouter;
