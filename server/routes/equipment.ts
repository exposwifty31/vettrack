// TODO(arch): file exceeds 1100 lines. Split into handler modules following
// the equipment-route-utils.ts / handlers/ pattern already started in this directory.
import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { z } from "zod";
import { db, equipment, equipmentReturns, folders, rooms, scanLogs, transferLogs, undoTokens, users, stagingQueue, assetTypeConditions, unitConditionStates } from "../db.js";
import { eq, inArray, desc, asc, and, or, ilike, lt, gte, sql, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { scanLimiter, checkoutLimiter, writeLimiter } from "../middleware/rate-limiters.js";
import { checkDedupe, sendPushToAll, shouldSendPilotEnglishEquipmentPush } from "../lib/push.js";
import { invalidateAnalyticsCache } from "../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { trackSyncSuccess, trackSyncFail } from "../lib/sync-metrics.js";
import { scheduleSmartReturnReminder, cancelSmartReturnReminder } from "../lib/role-notification-scheduler.js";
import { recordEquipmentSeen } from "../lib/equipment-seen.js";
import { computeBundleReadinessGate } from "../services/equipment-operational-state.service.js";
import { recordOperationalMetric } from "../services/operational-metrics.service.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { apiError as apiErrorI18n } from "../lib/apiError.js";
import { enqueueChargeAlertJob } from "../jobs/charge-alert-enqueue.js";
import { promoteStagingQueueNext } from "../lib/staging-promotion.js";
import { notifyWaitlistPromoted } from "../lib/equipment-waitlist-promotion.js";
import {
  assertCheckoutAllowedForWaitlist,
  EquipmentWaitlistError,
  fulfillWaitlistOnCheckout,
  getActiveNotifiedUserId,
  promoteNextWaitlistInTx,
} from "../services/equipment-waitlist.service.js";
import type { EquipmentWaitlistRow } from "../db.js";
import { mountEquipmentWaitlistRoutes } from "./equipment-waitlist.js";
import { EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS } from "../lib/equipment-replay-idempotency.js";
import { equipmentReplayIdempotency } from "../middleware/equipment-replay-idempotency.js";
import { apiError, resolveRequestId } from "./equipment/equipment-route-utils.js";
import { getCriticalEquipmentHandler } from "./equipment/handlers/get-critical-equipment.js";
import { getDeletedEquipmentHandler } from "./equipment/handlers/get-deleted-equipment.js";
import { getEquipmentByIdHandler } from "./equipment/handlers/get-equipment-by-id.js";
import { getEquipmentTruthHandler } from "./equipment/handlers/get-equipment-truth.js";
import { postEquipmentConfirmInRoomHandler } from "./equipment/handlers/post-equipment-confirm-in-room.js";
import { getEquipmentLogsHandler } from "./equipment/handlers/get-equipment-logs.js";
import { getMyEquipmentHandler } from "./equipment/handlers/get-my-equipment.js";
import { getEquipmentTransfersHandler } from "./equipment/handlers/get-equipment-transfers.js";
import { getEquipmentListHandler } from "./equipment/handlers/get-equipment-list.js";
import { postEquipmentRestoreHandler } from "./equipment/handlers/post-equipment-restore.js";
import { postEquipmentRevertHandler } from "./equipment/handlers/post-equipment-revert.js";
import { deleteEquipmentHandler } from "./equipment/handlers/delete-equipment.js";
import { postEquipmentBulkVerifyRoomHandler } from "./equipment/handlers/post-equipment-bulk-verify-room.js";
import { postEquipmentBulkMoveHandler } from "./equipment/handlers/post-equipment-bulk-move.js";
import { postEquipmentImportHandler } from "./equipment/handlers/post-equipment-import.js";
import { postEquipmentBulkDeleteHandler } from "./equipment/handlers/post-equipment-bulk-delete.js";
import { postEquipmentCreateHandler } from "./equipment/handlers/post-equipment-create.js";
import { patchEquipmentHandler } from "./equipment/handlers/patch-equipment.js";
import type { EquipmentPreviousState } from "./equipment/equipment-undo-tokens.js";

const EQUIPMENT_STATUS_VALUES = [
  "ok",
  "issue",
  "maintenance",
  "sterilized",
  "overdue",
  "inactive",
  "critical",
  "needs_attention",
] as const;

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isoDateOnlySchema = z.string().refine((value) => {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}, "Date must be a valid ISO date string (YYYY-MM-DD)");

const createEquipmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(500),
  serialNumber: z.string().max(500).optional(),
  model: z.string().max(500).optional(),
  manufacturer: z.string().max(500).optional(),
  purchaseDate: z.string().optional().nullable(),
  expiryDate: isoDateOnlySchema.optional().nullable(),
  location: z.string().max(500).optional(),
  folderId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  nfcTagId: z.string().max(500).optional().nullable(),
  rfidTagEpc: z.string().max(128).optional().nullable(),
  maintenanceIntervalDays: z.number().int().positive().optional().nullable(),
  expectedReturnMinutes: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().max(500).optional().nullable(),
  usuallyFoundHere: z.string().max(200).optional().nullable(),
  searchAlias: z.string().max(200).optional().nullable(),
  staffNote: z.string().max(500).optional().nullable(),
});

const patchEquipmentSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  serialNumber: z.string().max(500).optional(),
  model: z.string().max(500).optional(),
  manufacturer: z.string().max(500).optional(),
  purchaseDate: z.string().optional().nullable(),
  expiryDate: isoDateOnlySchema.optional().nullable(),
  location: z.string().max(500).optional(),
  folderId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  nfcTagId: z.string().max(500).optional().nullable(),
  rfidTagEpc: z.string().max(128).optional().nullable(),
  maintenanceIntervalDays: z.number().int().positive().optional().nullable(),
  expectedReturnMinutes: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().max(500).optional().nullable(),
  usuallyFoundHere: z.string().max(200).optional().nullable(),
  searchAlias: z.string().max(200).optional().nullable(),
  staffNote: z.string().max(500).optional().nullable(),
  status: z.enum(EQUIPMENT_STATUS_VALUES).optional(),
  /** Optimistic concurrency: the row `version` the client last loaded.
   *  When supplied, the PATCH is rejected 409 if the row moved on. */
  version: z.number().int().nonnegative().optional(),
}).strict();

const bulkVerifyRoomSchema = z.object({
  roomId: z.string().min(1, "roomId is required"),
});

const confirmInRoomSchema = z.object({
  roomId: z.string().min(1, "roomId is required"),
});

export const checkoutSchema = z.object({
  location: z.string().max(500).optional(),
  emergencyReason: z.string().min(1).max(500).optional(),
}).strict();

export const scanSchema = z.object({
  status: z.enum(EQUIPMENT_STATUS_VALUES),
  note: z.string().trim().max(500).optional(),
  photoUrl: z.string().max(500).optional(),
}).strict();

const PLUG_IN_DEADLINE_MAX_MINUTES = 1440;
const PLUG_IN_DEADLINE_DEFAULT_MINUTES = 30;

/** Optional body for POST /:id/return — enables offline replay of plug-in charge tracking. */
export const equipmentReturnBodySchema = z.object({
  isPluggedIn: z.boolean().optional(),
  plugInDeadlineMinutes: z.number().int().min(1).max(PLUG_IN_DEADLINE_MAX_MINUTES).optional(),
}).strict();

const revertSchema = z.object({
  undoToken: z.string().min(1, "undoToken is required"),
});

const seenSchema = z.object({
  roomId: z.string().uuid().optional().nullable(),
  packageCode: z.enum(["fluid_protocol"]).optional().nullable(),
  /** Caller may pass the scanLogId from a checkout scan to link billing back to the care event. */
  scanLogId: z.string().uuid().optional().nullable(),
});

// Body schema for the top-level POST /scan alias (accepts any string ID, not UUID-only).
const quickScanBodySchema = z.object({
  equipmentId: z.string().min(1).max(100),
});

const bulkIdsSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

const bulkMoveSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  folderId: z.string().optional().nullable(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.mimetype === "text/plain" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
});

/*
 * PERMISSIONS MATRIX — /api/equipment
 * ─────────────────────────────────────────────────────
 * GET  /                  student+      List all equipment
 * GET  /critical          student+      List critical/needs-attention equipment
 * GET  /my                student+      List equipment checked out by current user
 * GET  /:id               student+      Get single equipment item
 * GET  /:id/logs          student+      Scan log history for item
 * GET  /:id/transfers     student+      Transfer log history for item
 * POST /                  technician+   Create new equipment
 * POST /import            admin-only    Bulk CSV import
 * POST /bulk-delete       admin-only    Bulk delete
 * POST /bulk-move         technician+   Bulk folder move
 * POST /:id/scan          student+      Record a scan/status update (student baseline per stabilization plan)
 * POST /:id/checkout      student+      Check out equipment (authenticated; student role allowed)
 * POST /:id/return        student+      Return equipment
 * POST /:id/revert        vet+          Undo last scan within window
 * PATCH /:id              technician+   Edit equipment metadata
 * DELETE /:id             admin-only    Delete single equipment item
 * ─────────────────────────────────────────────────────
 */

const router = Router();

const _parsedUndoTtl = parseInt(process.env.UNDO_TTL_MS ?? "", 10);
const UNDO_TTL_MS = Number.isFinite(_parsedUndoTtl) && _parsedUndoTtl > 0 ? _parsedUndoTtl : 90_000;
const FIELD_MAX_LENGTH = 500;

type EquipmentRow = typeof equipment.$inferSelect;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function cleanExpiredUndoTokens(): Promise<void> {
  try {
    await db.delete(undoTokens).where(lt(undoTokens.expiresAt, new Date()));
  } catch {
  }
}

async function insertUndoToken(
  tx: Tx,
  params: {
    clinicId: string;
    equipmentId: string;
    actorId: string;
    scanLogId: string;
    previousState: EquipmentPreviousState;
  }
): Promise<string> {
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + UNDO_TTL_MS);
  await tx.insert(undoTokens).values({
    id: tokenId,
    clinicId: params.clinicId,
    equipmentId: params.equipmentId,
    actorId: params.actorId,
    scanLogId: params.scanLogId,
    previousState: JSON.stringify(params.previousState),
    expiresAt,
  });
  return tokenId;
}

function snapshotState(row: EquipmentRow): EquipmentPreviousState {
  return {
    status: row.status,
    lastSeen: row.lastSeen,
    lastStatus: row.lastStatus,
    lastMaintenanceDate: row.lastMaintenanceDate,
    lastSterilizationDate: row.lastSterilizationDate,
    checkedOutById: row.checkedOutById,
    checkedOutByEmail: row.checkedOutByEmail,
    checkedOutAt: row.checkedOutAt,
    checkedOutLocation: row.checkedOutLocation,
  };
}

class CheckoutConflictError extends Error {
  checkedOutByEmail: string;
  constructor(email: string) {
    super("CHECKOUT_CONFLICT");
    this.checkedOutByEmail = email;
  }
}

// GET /api/equipment/my
router.get("/my", requireAuth, getMyEquipmentHandler);

router.get("/", requireAuth, getEquipmentListHandler);

// GET /api/equipment/deleted — admin only, list soft-deleted equipment
router.get("/deleted", requireAuth, requireAdmin, getDeletedEquipmentHandler);

// GET /api/equipment/critical
router.get("/critical", requireAuth, getCriticalEquipmentHandler);

router.get("/:id/truth", requireAuth, getEquipmentTruthHandler);

router.post(
  "/:id/confirm-in-room",
  requireAuth,
  scanLimiter,
  requireEffectiveRole("student"),
  validateBody(confirmInRoomSchema),
  postEquipmentConfirmInRoomHandler,
);

router.get("/:id", requireAuth, getEquipmentByIdHandler);

router.post(
  "/",
  requireAuth,
  writeLimiter,
  requireEffectiveRole("technician"),
  validateBody(createEquipmentSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.create),
  postEquipmentCreateHandler,
);

router.patch(
  "/:id",
  requireAuth,
  writeLimiter,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  validateBody(patchEquipmentSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.update),
  patchEquipmentHandler,
);

router.delete(
  "/:id",
  requireAuth,
  writeLimiter,
  requireAdmin,
  validateUuid("id"),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.delete),
  deleteEquipmentHandler,
);

// POST /api/equipment/:id/restore — admin only, restore a soft-deleted equipment record
router.post("/:id/restore", requireAuth, requireAdmin, validateUuid("id"), postEquipmentRestoreHandler);

// POST /api/equipment/scan — quick-scan alias for pilot/demo flows.
// Body: { equipmentId: string }  (accepts plain string IDs like "eq1", not UUID-only)
// Toggle semantics: available → checkout · held by caller → return · held by other → 409
router.post("/scan", requireAuth, checkoutLimiter, requireEffectiveRole("student"), validateBody(quickScanBodySchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { equipmentId } = req.body as z.infer<typeof quickScanBodySchema>;
    const now = new Date();

    // Object ref avoids TypeScript narrowing `action` to its initial literal
    // through control flow analysis across the async transaction callback.
    const scan = { action: "checkout" as "checkout" | "return" | "blocked" };
    let updatedEquipment: EquipmentRow | null = null;
    let scanLogId = "";
    let undoToken = "";

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
        .limit(1);

      if (!existing) return;

      if (existing.checkedOutById && existing.checkedOutById !== req.authUser!.id) {
        scan.action = "blocked";
        updatedEquipment = existing;
        return;
      }

      if (!existing.checkedOutById) {
        scan.action = "checkout";
        const [updatedRow] = await tx
          .update(equipment)
          .set({
            checkedOutById: req.authUser!.id,
            checkedOutByEmail: req.authUser!.email,
            checkedOutAt: now,
            checkedOutLocation: null,
            lastSeen: now,
            lastStatus: existing.status,
          })
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)))
          .returning();
        updatedEquipment = updatedRow;
        const logId = randomUUID();
        await tx.insert(scanLogs).values({
          id: logId,
          clinicId,
          equipmentId,
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          status: existing.status,
          note: "Quick scan — checked out",
          timestamp: now,
        });
        undoToken = await insertUndoToken(tx, {
          clinicId,
          equipmentId,
          actorId: req.authUser!.id,
          scanLogId: logId,
          previousState: snapshotState(existing),
        });
        scanLogId = logId;
      } else {
        scan.action = "return";
        const [updatedRow] = await tx
          .update(equipment)
          .set({
            checkedOutById: null,
            checkedOutByEmail: null,
            checkedOutAt: null,
            checkedOutLocation: null,
            status: "ok",
            lastSeen: now,
            lastStatus: "ok",
          })
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)))
          .returning();
        updatedEquipment = updatedRow;
        const logId = randomUUID();
        await tx.insert(scanLogs).values({
          id: logId,
          clinicId,
          equipmentId,
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          status: "ok",
          note: "Quick scan — returned",
          timestamp: now,
        });
        undoToken = await insertUndoToken(tx, {
          clinicId,
          equipmentId,
          actorId: req.authUser!.id,
          scanLogId: logId,
          previousState: snapshotState(existing),
        });
        await tx.insert(equipmentReturns).values({
          id: randomUUID(),
          clinicId,
          equipmentId,
          returnedById: req.authUser!.id,
          returnedByEmail: req.authUser!.email,
          returnedAt: now,
          isPluggedIn: true,
          plugInDeadlineMinutes: 30,
          plugInAlertSentAt: null,
          chargeAlertJobId: null,
        });
        scanLogId = logId;
      }
    });

    if (!updatedEquipment) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    if (scan.action === "blocked") {
      const held = updatedEquipment as EquipmentRow;
      return res.status(409).json({
        ...apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_ALREADY_CHECKED_OUT",
          message: "Equipment is currently checked out by another user",
          requestId,
        }),
        checkedOutByEmail: held.checkedOutByEmail,
      });
    }

    const u = updatedEquipment as EquipmentRow;

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: scan.action === "checkout" ? "equipment_checked_out" : "equipment_returned",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: equipmentId,
      targetType: "equipment",
      metadata: { name: u.name, via: "quick_scan" },
    });

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({ equipment: updatedEquipment, action: scan.action, scanLogId, undoToken });
  } catch (err) {
    console.error(err);
    trackSyncFail();
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_SCAN_FAILED",
        message: "Scan failed",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/:id/checkout
router.post(
  "/:id/checkout",
  requireAuth,
  checkoutLimiter,
  requireEffectiveRole("student"),
  validateUuid("id"),
  validateBody(checkoutSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.checkout),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { location, emergencyReason } = req.body as z.infer<typeof checkoutSchema>;
    const isEmergency = req.headers["x-emergency-checkout"] === "true";
    const clientTimestamp = parseInt(req.headers["x-client-timestamp"] as string || "0", 10);

    let updated: EquipmentRow | null = null;
    let reminderBaseTime: Date | null = null;
    let undoToken = "";

    // ── Operational State V1 pre-checks (A–F) ──────────────────────────
    const checkoutStart = Date.now();
    let v1StageClaimId: string | null = null;
    let v1NewUsageState: "in_use" | "emergency_use" = "in_use";

    const [snap] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
      .limit(1);

    if (snap) {
      // A. untracked → 422 (NFC scan not possible — also blocks emergency)
      if (snap.custodyState === "untracked") {
        void recordOperationalMetric({ clinicId, equipmentId: snap.id, userId: req.authUser!.id, eventType: "custody_chain_broken" });
        return res.status(422).json({ code: "CUSTODY_CHAIN_BROKEN", error: "Equipment custody chain is broken" });
      }

      // B. checked_out → 422 (no double-checkout — also blocks emergency)
      if (snap.custodyState === "checked_out") {
        return res.status(409).json({ code: "ALREADY_CHECKED_OUT", error: "Equipment is already checked out" });
      }

      // C. Emergency — must be before usageState checks to bypass staged
      if (isEmergency) {
        if (!emergencyReason) {
          return res.status(422).json({ code: "EMERGENCY_REASON_REQUIRED", error: "emergencyReason is required for emergency checkout" });
        }
        const capturedVersion = snap.version;
        const now = new Date();
        try {
          await db.transaction(async (tx) => {
            // Cancel all active staging claims
            await tx.update(stagingQueue)
              .set({ status: "cancelled", updatedAt: now })
              .where(and(eq(stagingQueue.equipmentId, snap.id), eq(stagingQueue.status, "active")));

            // Set emergency state
            const emergencyUpdate = await tx
              .update(equipment)
              .set({
                custodyState: "checked_out",
                custodyStateSince: now,
                readinessState: "unknown",
                readinessStateSince: now,
                usageState: "emergency_use",
                usageStateSince: now,
                emergencyOverrideAt: now,
                emergencyOverrideById: req.authUser!.id,
                checkedOutById: req.authUser!.id,
                checkedOutByEmail: req.authUser!.email,
                checkedOutAt: now,
                checkedOutLocation: location ?? null,
                lastSeen: now,
                lastStatus: snap.status,
                version: sql`${equipment.version} + 1`,
              })
              .where(and(
                eq(equipment.clinicId, clinicId),
                eq(equipment.id, snap.id),
                inArray(equipment.custodyState, ["docked", "returned"]),
                eq(equipment.version, capturedVersion),
              ));

            if ((emergencyUpdate as unknown as { rowCount?: number }).rowCount === 0) {
              throw new Error("VERSION_CONFLICT");
            }

            await insertRealtimeDomainEvent(tx, {
              clinicId,
              type: "EQUIPMENT_EMERGENCY_CHECKOUT",
              payload: { equipmentId: snap.id, emergencyReason },
            });
          });
        } catch (err) {
          if (err instanceof Error && err.message === "VERSION_CONFLICT") {
            return res.status(409).json({ code: "VERSION_CONFLICT", error: "Version conflict, please retry" });
          }
          throw err;
        }

        logAudit({
          clinicId,
          actionType: "equipment_emergency_checkout",
          performedBy: req.authUser!.id,
          performedByEmail: req.authUser!.email,
          targetId: snap.id,
          metadata: { emergencyReason },
        });
        void recordOperationalMetric({ clinicId, equipmentId: snap.id, userId: req.authUser!.id, eventType: "emergency_override", metadata: { emergencyReason } });

        const [freshEq] = await db.select().from(equipment).where(eq(equipment.id, snap.id));
        return res.json({ equipment: freshEq, undoToken: "" });
      }

      // D. staged + top-claim-holder
      if (snap.usageState === "staged") {
        const claims = await db
          .select()
          .from(stagingQueue)
          .where(and(eq(stagingQueue.equipmentId, snap.id), eq(stagingQueue.clinicId, clinicId), eq(stagingQueue.status, "active")))
          .orderBy(
            sql`CASE ${stagingQueue.clinicalPriority} WHEN 'emergency' THEN 3 WHEN 'urgent' THEN 2 WHEN 'routine' THEN 1 ELSE 0 END DESC`,
            stagingQueue.stagedAt,
          );

        const topClaim = claims[0];
        if (!topClaim || topClaim.requestedById !== req.authUser!.id) {
          return res.status(409).json({ code: "STAGING_CONFLICT", error: "You are not the top priority claim holder", queue: claims });
        }

        const allConditions = snap.assetTypeId
          ? await db.select().from(assetTypeConditions).where(eq(assetTypeConditions.assetTypeId, snap.assetTypeId))
          : [];
        const condStates = snap.assetTypeId
          ? await db.select().from(unitConditionStates).where(eq(unitConditionStates.equipmentId, snap.id))
          : [];
        const gateResult = computeBundleReadinessGate(snap, condStates, allConditions, new Date());
        if (!gateResult.ok) {
          void recordOperationalMetric({ clinicId, equipmentId: snap.id, userId: req.authUser!.id, eventType: "bundle_failed", metadata: { reason: gateResult.reason, failedConditions: gateResult.failedConditions, staleConditions: gateResult.staleConditions, unknownConditions: gateResult.unknownConditions } });
          return res.status(422).json({ code: "BUNDLE_INCOMPLETE", ...gateResult });
        }

        v1StageClaimId = topClaim.id;
      } else if (snap.usageState === "available") {
        // E. available — bundle gate only when asset type defines conditions
        if (snap.assetTypeId) {
          const allConditions = await db
            .select()
            .from(assetTypeConditions)
            .where(eq(assetTypeConditions.assetTypeId, snap.assetTypeId));
          const condStates = await db
            .select()
            .from(unitConditionStates)
            .where(eq(unitConditionStates.equipmentId, snap.id));
          const gateResult = computeBundleReadinessGate(snap, condStates, allConditions, new Date());
          if (!gateResult.ok) {
            void recordOperationalMetric({ clinicId, equipmentId: snap.id, userId: req.authUser!.id, eventType: "bundle_failed", metadata: { reason: gateResult.reason, failedConditions: gateResult.failedConditions, staleConditions: gateResult.staleConditions, unknownConditions: gateResult.unknownConditions } });
            return res.status(422).json({ code: "BUNDLE_INCOMPLETE", ...gateResult });
          }
        } else if (!["returned", "docked"].includes(snap.custodyState)) {
          return res.status(422).json({
            code: "EQUIPMENT_UNAVAILABLE",
            error: `Equipment custody state ${snap.custodyState} blocks checkout`,
          });
        }
      } else {
        // F. any other usageState
        return res.status(422).json({ code: "EQUIPMENT_UNAVAILABLE", error: `Equipment usage state ${snap.usageState} blocks checkout` });
      }
    }

    // ─────────────────────────────────────────────────────────────────

    const preCheckoutNotifiedUserId = await getActiveNotifiedUserId(clinicId, req.params.id);
    if (
      !isEmergency &&
      preCheckoutNotifiedUserId &&
      preCheckoutNotifiedUserId !== req.authUser!.id
    ) {
      return apiErrorI18n(
        req,
        res,
        "equipmentWaitlist.WAITLIST_RESERVATION_HELD_BY_OTHER",
        undefined,
        409,
      );
    }

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
        .limit(1);

      if (!existing) return;

      const checkoutTime = clientTimestamp ? new Date(clientTimestamp) : new Date();
      reminderBaseTime = checkoutTime;

      const checkoutSet = {
        checkedOutById: req.authUser!.id,
        checkedOutByEmail: req.authUser!.email,
        checkedOutAt: checkoutTime,
        checkedOutLocation: location ?? null,
        lastSeen: checkoutTime,
        lastStatus: existing.status,
        // V1 operational state additions
        custodyState: "checked_out" as const,
        custodyStateSince: checkoutTime,
        usageState: v1NewUsageState,
        usageStateSince: checkoutTime,
        version: sql`${equipment.version} + 1`,
      };

      let updatedRow: EquipmentRow | undefined;

      if (!existing.checkedOutById) {
        [updatedRow] = await tx
          .update(equipment)
          .set(checkoutSet)
          .where(
            and(
              eq(equipment.clinicId, clinicId),
              eq(equipment.id, req.params.id),
              isNull(equipment.checkedOutById),
            ),
          )
          .returning();

        if (!updatedRow) {
          const [winner] = await tx
            .select()
            .from(equipment)
            .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id)))
            .limit(1);
          throw new CheckoutConflictError(winner?.checkedOutByEmail ?? "unknown");
        }
      } else {
        const existingTimestamp = existing.checkedOutAt
          ? new Date(existing.checkedOutAt).getTime()
          : 0;
        if (!clientTimestamp || clientTimestamp <= existingTimestamp) {
          throw new CheckoutConflictError(existing.checkedOutByEmail ?? "unknown");
        }

        const overrideWhere =
          existing.checkedOutAt == null
            ? and(
                eq(equipment.clinicId, clinicId),
                eq(equipment.id, req.params.id),
                isNull(equipment.checkedOutAt),
              )
            : and(
                eq(equipment.clinicId, clinicId),
                eq(equipment.id, req.params.id),
                eq(equipment.checkedOutAt, existing.checkedOutAt),
              );

        [updatedRow] = await tx
          .update(equipment)
          .set(checkoutSet)
          .where(overrideWhere)
          .returning();

        if (!updatedRow) {
          throw new CheckoutConflictError(existing.checkedOutByEmail ?? "unknown");
        }
      }

      updated = updatedRow;
      const checkoutLogId = randomUUID();

      await tx.insert(scanLogs).values({
        id: checkoutLogId,
        clinicId,
        equipmentId: req.params.id,
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        status: existing.status,
        note: `Checked out${location ? ` — ${location}` : ""}`,
        timestamp: checkoutTime,
      });

      undoToken = await insertUndoToken(tx, {
        clinicId,
        equipmentId: req.params.id,
        actorId: req.authUser!.id,
        scanLogId: checkoutLogId,
        previousState: snapshotState(existing),
      });

      // V1: fulfill staging claim if path D
      if (v1StageClaimId) {
        await tx
          .update(stagingQueue)
          .set({ status: "fulfilled", updatedAt: checkoutTime })
          .where(and(eq(stagingQueue.id, v1StageClaimId), eq(stagingQueue.equipmentId, req.params.id)));
      }

      await fulfillWaitlistOnCheckout(tx, clinicId, req.params.id, req.authUser!.id, checkoutTime);

      // V1: realtime event
      await insertRealtimeDomainEvent(tx, {
          clinicId,
          type: "EQUIPMENT_CUSTODY_STATE_CHANGED",
          payload: { equipmentId: req.params.id, custodyState: "checked_out", usageState: v1NewUsageState },
        });
    });

    if (v1StageClaimId) {
      void promoteStagingQueueNext(req.params.id, clinicId);
    }

    if (!updated) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    const u = updated as EquipmentRow;

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_checked_out",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: u.name, location: req.body?.location ?? null },
    });

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({ equipment: updated, undoToken });

    void scheduleSmartReturnReminder({
      clinicId,
      equipmentId: u.id,
      equipmentName: u.name,
      expectedReturnMinutes: u.expectedReturnMinutes,
      userId: req.authUser!.id,
      checkedOutAt: reminderBaseTime ?? u.checkedOutAt,
    });

    if (shouldSendPilotEnglishEquipmentPush() && !checkDedupe(u.id, "checkout")) {
      sendPushToAll(clinicId, {
        title: "Equipment Checked Out",
        body: `${u.name} checked out${req.body?.location ? ` — ${req.body.location}` : ""}`,
        tag: `checkout:${u.id}`,
        url: `/equipment/${u.id}`,
      });
    }
  } catch (err) {
    if (err instanceof CheckoutConflictError) {
      return res.status(409).json({
        ...apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_ALREADY_CHECKED_OUT",
          message: "Already checked out",
          requestId,
        }),
        checkedOutByEmail: err.checkedOutByEmail,
        conflictInfo: `Checked out by ${err.checkedOutByEmail}`,
      });
    }
    if (err instanceof EquipmentWaitlistError) {
      const status = err.code === "WAITLIST_RESERVATION_HELD_BY_OTHER" ? 409 : 422;
      return apiErrorI18n(req, res, `equipmentWaitlist.${err.code}`, undefined, status);
    }
    console.error(err);
    trackSyncFail();
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_CHECKOUT_FAILED",
        message: "Checkout failed",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/:id/return
router.post(
  "/:id/return",
  requireAuth,
  checkoutLimiter,
  requireEffectiveRole("student"),
  validateUuid("id"),
  validateBody(equipmentReturnBodySchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.return),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const clientTimestamp = parseInt(req.headers["x-client-timestamp"] as string || "0", 10);
    const { isPluggedIn, plugInDeadlineMinutes } = req.body as z.infer<typeof equipmentReturnBodySchema>;

    let updated: EquipmentRow | null = null;
    let undoToken = "";
    let alreadyReturned = false;
    let didTransitionCustody = false;
    let waitlistPromotedOnReturn: EquipmentWaitlistRow | null = null;

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
        .limit(1);

      if (!existing) return;

      if (!existing.checkedOutById) {
        const existingTimestamp = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
        if (clientTimestamp && clientTimestamp <= existingTimestamp) {
          alreadyReturned = true;
          updated = existing;
          return;
        }
      }

      const returnTime = clientTimestamp ? new Date(clientTimestamp) : new Date();
      const transitionCustody = existing.custodyState === "checked_out";
      if (transitionCustody) didTransitionCustody = true;

      let hasActiveClaims = false;
      if (transitionCustody) {
        const [activeClaims] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(stagingQueue)
          .where(and(
            eq(stagingQueue.equipmentId, req.params.id),
            eq(stagingQueue.clinicId, clinicId),
            eq(stagingQueue.status, "active"),
          ));
        hasActiveClaims = Number(activeClaims?.count ?? 0) > 0;
      }

      const returnSet = {
        checkedOutById: null,
        checkedOutByEmail: null,
        checkedOutAt: null,
        checkedOutLocation: null,
        status: "ok" as const,
        lastSeen: returnTime,
        lastStatus: "ok" as const,
        ...(transitionCustody
          ? {
              custodyState: "returned" as const,
              custodyStateSince: returnTime,
              readinessState: "unknown" as const,
              readinessStateSince: returnTime,
              usageState: hasActiveClaims ? ("staged" as const) : ("available" as const),
              usageStateSince: returnTime,
              version: sql`${equipment.version} + 1`,
            }
          : {}),
      };

      const returnWhere = transitionCustody
        ? and(
            eq(equipment.clinicId, clinicId),
            eq(equipment.id, req.params.id),
            eq(equipment.custodyState, "checked_out"),
            eq(equipment.version, existing.version),
          )
        : and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id));

      const [updatedRow] = await tx
        .update(equipment)
        .set(returnSet)
        .where(returnWhere)
        .returning();

      if (!updatedRow) {
        if (transitionCustody) {
          throw new Error("CUSTODY_RETURN_VERSION_CONFLICT");
        }
        throw new Error("EQUIPMENT_RETURN_UPDATE_FAILED");
      }

      updated = updatedRow;
      const returnLogId = randomUUID();

      await tx.insert(scanLogs).values({
        id: returnLogId,
        clinicId,
        equipmentId: req.params.id,
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        status: "ok",
        note: "Returned — available",
        timestamp: returnTime,
      });

      undoToken = await insertUndoToken(tx, {
        clinicId,
        equipmentId: req.params.id,
        actorId: req.authUser!.id,
        scanLogId: returnLogId,
        previousState: snapshotState(existing),
      });

      if (transitionCustody) {
        await insertRealtimeDomainEvent(tx, {
          clinicId,
          type: "EQUIPMENT_CUSTODY_STATE_CHANGED",
          payload: { equipmentId: req.params.id, custodyState: "returned", hasActiveClaims },
        });
        waitlistPromotedOnReturn = await promoteNextWaitlistInTx(
          tx,
          clinicId,
          req.params.id,
          returnTime,
        );
      }
    });

    if (waitlistPromotedOnReturn) {
      void notifyWaitlistPromoted(clinicId, req.params.id, waitlistPromotedOnReturn);
    }

    if (!updated) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }
    if (alreadyReturned) {
      return res.json({
        equipment: updated,
        undoToken: "",
        returnRecord: null,
      });
    }

    const u = updated as EquipmentRow;

    let returnRecord: (typeof equipmentReturns.$inferSelect) | null = null;
    if (isPluggedIn === false) {
      const deadlineMinutes = plugInDeadlineMinutes ?? PLUG_IN_DEADLINE_DEFAULT_MINUTES;
      const returnId = randomUUID();
      const chargeAlertJobId = await enqueueChargeAlertJob({
        returnId,
        clinicId,
        equipmentId: req.params.id,
        plugInDeadlineMinutes: deadlineMinutes,
      });
      const [created] = await db
        .insert(equipmentReturns)
        .values({
          id: returnId,
          clinicId,
          equipmentId: req.params.id,
          returnedById: req.authUser!.id,
          returnedByEmail: req.authUser!.email,
          returnedAt: new Date(),
          isPluggedIn: false,
          plugInDeadlineMinutes: deadlineMinutes,
          plugInAlertSentAt: null,
          chargeAlertJobId,
        })
        .returning();
      returnRecord = created ?? null;
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_returned",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: {
        name: u.name,
        ...(returnRecord
          ? {
              returnId: returnRecord.id,
              isPluggedIn: returnRecord.isPluggedIn,
              plugInDeadlineMinutes: returnRecord.plugInDeadlineMinutes,
            }
          : {}),
      },
    });

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({
      equipment: updated,
      undoToken,
      returnRecord,
    });

    await cancelSmartReturnReminder(clinicId, u.id, req.authUser!.id);

    if (shouldSendPilotEnglishEquipmentPush() && !checkDedupe(u.id, "return")) {
      sendPushToAll(clinicId, {
        title: "Equipment Returned",
        body: `${u.name} has been returned and is available`,
        tag: `return:${u.id}`,
        url: `/equipment/${u.id}`,
      });
    }
  } catch (err) {
    if (err instanceof Error && err.message === "CUSTODY_RETURN_VERSION_CONFLICT") {
      trackSyncFail();
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "VERSION_CONFLICT",
          message: "Equipment was updated concurrently; please retry the return",
          requestId,
        }),
      );
    }
    console.error(err);
    trackSyncFail();
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_RETURN_FAILED",
        message: "Return failed",
        requestId,
      }),
    );
  }
},
);

// POST /api/equipment/:id/seen — idempotent billing + usage session (Phase 2)
router.post(
  "/:id/seen",
  requireAuth,
  writeLimiter,
  validateUuid("id"),
  validateBody(seenSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.seen),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const { roomId, scanLogId } = req.body as z.infer<typeof seenSchema>;
      const result = await recordEquipmentSeen({
        clinicId,
        equipmentId: req.params.id,
        roomId: roomId ?? null,
        scanLogId: scanLogId ?? null,
      });
      if (!result.ok) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "EQUIPMENT_NOT_FOUND",
            message: "Equipment not found",
            requestId,
          }),
        );
      }
      res.json({
        linked: result.linked,
        roomId: result.roomId,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "EQUIPMENT_SEEN_FAILED",
          message: "Failed to record equipment seen",
          requestId,
        }),
      );
    }
  },
);

// POST /api/equipment/:id/scan
router.post(
  "/:id/scan",
  requireAuth,
  scanLimiter,
  requireEffectiveRole("student"),
  validateUuid("id"),
  validateBody(scanSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.scan),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { status, note, photoUrl } = req.body as z.infer<typeof scanSchema>;
    if (status === "issue" && !note?.trim()) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "ISSUE_NOTE_REQUIRED",
          message: "Note is required when reporting an issue",
          requestId,
        }),
      );
    }

    const clientTimestamp = parseInt(req.headers["x-client-timestamp"] as string || "0", 10);
    const scanTime = clientTimestamp ? new Date(clientTimestamp) : new Date();

    let updatedEquipment: EquipmentRow | null = null;
    let scanLog: typeof scanLogs.$inferSelect | null = null;
    let undoToken = "";

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
        .limit(1);

      if (!existing) return;

      const serverLastSeen = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
      const isNewerWrite = !clientTimestamp || clientTimestamp >= serverLastSeen;

      if (isNewerWrite) {
        const updates: Partial<typeof equipment.$inferInsert> = {
          lastSeen: scanTime,
          lastStatus: status,
          status,
        };
        if (status === "ok") {
          updates.lastVerifiedAt = scanTime;
          updates.lastVerifiedById = req.authUser!.id;
        }
        if (status === "maintenance") updates.lastMaintenanceDate = scanTime;
        if (status === "sterilized") updates.lastSterilizationDate = scanTime;

        const [result] = await tx
          .update(equipment)
          .set(updates)
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id)))
          .returning();
        updatedEquipment = result;
      } else {
        updatedEquipment = existing;
      }

      const [log] = await tx
        .insert(scanLogs)
        .values({
          id: randomUUID(),
          clinicId,
          equipmentId: req.params.id,
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          status,
          note: note ?? null,
          photoUrl: photoUrl ?? null,
          timestamp: scanTime,
        })
        .returning();

      scanLog = log;

      undoToken = await insertUndoToken(tx, {
        clinicId,
        equipmentId: req.params.id,
        actorId: req.authUser!.id,
        scanLogId: log.id,
        previousState: snapshotState(existing),
      });
    });

    if (!updatedEquipment) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    const eq2 = updatedEquipment as EquipmentRow;

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_scanned",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: eq2.name, status, note: note ?? null },
    });

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({ equipment: updatedEquipment, scanLog, undoToken });
    if (shouldSendPilotEnglishEquipmentPush() && status === "issue" && !checkDedupe(eq2.id, "issue")) {
      sendPushToAll(clinicId, {
        title: "Equipment Issue Reported",
        body: `${eq2.name} needs attention${note ? ` — ${note}` : ""}`,
        tag: `issue:${eq2.id}`,
        url: `/equipment/${eq2.id}`,
      });
    }

    const now = new Date();
    if (
      eq2.maintenanceIntervalDays &&
      eq2.lastMaintenanceDate &&
      !checkDedupe(eq2.id, "overdue")
    ) {
      const dueDate = new Date(eq2.lastMaintenanceDate);
      dueDate.setDate(dueDate.getDate() + eq2.maintenanceIntervalDays);
      if (now > dueDate && shouldSendPilotEnglishEquipmentPush()) {
        const daysOverdue = Math.ceil((now.getTime() - dueDate.getTime()) / 86_400_000);
        sendPushToAll(clinicId, {
          title: "Maintenance Overdue",
          body: `${eq2.name} is ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue for maintenance`,
          tag: `overdue:${eq2.id}`,
          url: `/equipment/${eq2.id}`,
        });
      }
    }

    if (eq2.lastSterilizationDate && !checkDedupe(eq2.id, "sterilization_due")) {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
      if (shouldSendPilotEnglishEquipmentPush() && new Date(eq2.lastSterilizationDate) < sevenDaysAgo) {
        sendPushToAll(clinicId, {
          title: "Sterilization Due",
          body: `${eq2.name} has not been sterilized in 7+ days`,
          tag: `sterilization_due:${eq2.id}`,
          url: `/equipment/${eq2.id}`,
        });
      }
    }
  } catch (err) {
    console.error(err);
    trackSyncFail();
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_SCAN_FAILED",
        message: "Scan failed",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/:id/revert
router.post("/:id/revert", requireAuth, requireEffectiveRole("vet"), validateUuid("id"), validateBody(revertSchema), postEquipmentRevertHandler);

router.get("/:id/logs", requireAuth, getEquipmentLogsHandler);

router.get("/:id/transfers", requireAuth, getEquipmentTransfersHandler);

// POST /api/equipment/import — accepts multipart/form-data with a "file" field
// or JSON body with a "csv" string field (backwards-compatible)
router.post("/import", requireAuth, writeLimiter, requireAdmin, upload.single("file"), postEquipmentImportHandler);

router.post("/bulk-delete", requireAuth, writeLimiter, requireAdmin, validateBody(bulkIdsSchema), postEquipmentBulkDeleteHandler);

router.post("/bulk-move", requireAuth, writeLimiter, requireEffectiveRole("technician"), validateBody(bulkMoveSchema), postEquipmentBulkMoveHandler);

// POST /api/equipment/bulk-verify-room — Marks every item in a room as verified and sets sync status to 'synced'.
router.post(
  "/bulk-verify-room",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(bulkVerifyRoomSchema),
  postEquipmentBulkVerifyRoomHandler,
);

mountEquipmentWaitlistRoutes(router);

export default router;
