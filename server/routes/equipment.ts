// TODO(arch): file exceeds 1100 lines. Split into handler modules following
// the equipment-route-utils.ts / handlers/ pattern already started in this directory.
import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { z } from "zod";
import { db, equipment, equipmentReturns, folders, rooms, scanLogs, transferLogs, undoTokens, users, stagingQueue } from "../db.js";
import { eq, inArray, desc, asc, and, or, ilike, lt, gte, sql, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { scanLimiter, checkoutLimiter, writeLimiter } from "../middleware/rate-limiters.js";
import { checkDedupe, sendPushToAll, shouldSendPilotEnglishEquipmentPush } from "../lib/push.js";
import { invalidateAnalyticsCache } from "../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { trackSyncSuccess, trackSyncFail } from "../lib/sync-metrics.js";
import { recordEquipmentSeen } from "../lib/equipment-seen.js";
import { recordOperationalMetric } from "../services/operational-metrics.service.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { apiError as apiErrorI18n } from "../lib/apiError.js";
import {
  assertWaitlistCheckoutAllowed,
  CheckoutConflictError,
  CheckoutPreconditionError,
  CustodyReturnVersionConflictError,
  evaluateCheckoutV1Preconditions,
  finalizeCheckoutSideEffects,
  finalizeReturnSideEffects,
  performEquipmentCheckout,
  performEquipmentReturn,
  quickScanEquipmentCustody,
  toggleEquipmentCustody,
} from "../services/equipment-custody-toggle.service.js";
import { EquipmentWaitlistError } from "../services/equipment-waitlist.service.js";
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
import {
  insertEquipmentUndoToken,
  snapshotEquipmentState,
} from "./equipment/equipment-undo-tokens.js";

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

/** Optional body for POST /:id/toggle — NFC quick custody flip. */
const equipmentToggleBodySchema = z.object({
  isPluggedIn: z.boolean().optional(),
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

const FIELD_MAX_LENGTH = 500;

type EquipmentRow = typeof equipment.$inferSelect;

export async function cleanExpiredUndoTokens(): Promise<void> {
  try {
    await db.delete(undoTokens).where(lt(undoTokens.expiresAt, new Date()));
  } catch {
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

    const result = await quickScanEquipmentCustody({
      clinicId,
      equipmentId,
      actor: { id: req.authUser!.id, email: req.authUser!.email },
      actorRole: resolveAuditActorRole(req) ?? undefined,
      isPluggedIn: true,
    });

    if (result.kind === "not_found") {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    if (result.kind === "blocked") {
      return res.status(409).json({
        ...apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_ALREADY_CHECKED_OUT",
          message: "Equipment is currently checked out by another user",
          requestId,
        }),
        checkedOutByEmail: result.checkedOutByEmail,
      });
    }

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({
      equipment: result.equipment,
      action: result.kind,
      scanLogId: result.scanLogId,
      undoToken: result.undoToken,
    });
  } catch (err) {
    if (err instanceof CheckoutConflictError) {
      return res.status(409).json({
        ...apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_ALREADY_CHECKED_OUT",
          message: "Equipment is currently checked out by another user",
          requestId,
        }),
        checkedOutByEmail: err.checkedOutByEmail,
      });
    }
    if (err instanceof CustodyReturnVersionConflictError) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "CUSTODY_RETURN_VERSION_CONFLICT",
          message: "Concurrent update — please retry",
          requestId,
        }),
      );
    }
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

// POST /api/equipment/:id/toggle — NFC quick custody flip (online-only client)
router.post(
  "/:id/toggle",
  requireAuth,
  checkoutLimiter,
  requireEffectiveRole("student"),
  validateUuid("id"),
  validateBody(equipmentToggleBodySchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.toggle),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const { isPluggedIn } = req.body as z.infer<typeof equipmentToggleBodySchema>;

      const result = await toggleEquipmentCustody({
        clinicId,
        equipmentId: req.params.id,
        actor: { id: req.authUser!.id, email: req.authUser!.email },
        isPluggedIn: isPluggedIn ?? true,
        actorRole: resolveAuditActorRole(req) ?? undefined,
      });

      if (result.kind === "not_found") {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "EQUIPMENT_NOT_FOUND",
            message: "Equipment not found",
            requestId,
          }),
        );
      }

      if (result.kind === "blocked") {
        return res.json({
          equipment: result.equipment,
          action: "blocked",
          scanLogId: "",
          undoToken: "",
          checkedOutByEmail: result.checkedOutByEmail,
        });
      }

      return res.json({
        equipment: result.equipment,
        action: result.kind,
        scanLogId: result.scanLogId,
        undoToken: result.undoToken,
      });
    } catch (err) {
      if (err instanceof CheckoutPreconditionError) {
        if (err.code === "STAGING_CONFLICT") {
          return res.status(409).json({
            code: err.code,
            error: "You are not the top priority claim holder",
            queue: err.extra?.queue,
          });
        }
        if (err.code === "BUNDLE_INCOMPLETE") {
          return res.status(422).json({ code: err.code, ...err.extra });
        }
        return res.status(err.httpStatus).json({
          code: err.code,
          error:
            typeof err.extra?.error === "string"
              ? err.extra.error
              : err.message,
          ...err.extra,
        });
      }
      if (err instanceof CheckoutConflictError) {
        return res.status(409).json({
          code: "VERSION_CONFLICT",
          error: "Version conflict, please retry",
          checkedOutByEmail: err.checkedOutByEmail,
        });
      }
      if (err instanceof EquipmentWaitlistError) {
        const status = err.code === "WAITLIST_RESERVATION_HELD_BY_OTHER" ? 409 : 422;
        return apiErrorI18n(req, res, `equipmentWaitlist.${err.code}`, undefined, status);
      }
      if (err instanceof CustodyReturnVersionConflictError) {
        return res.status(409).json(
          apiError({
            code: "CONFLICT",
            reason: "VERSION_CONFLICT",
            message: "Equipment was updated concurrently; please retry",
            requestId,
          }),
        );
      }
      console.error(err);
      trackSyncFail();
      return res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "EQUIPMENT_TOGGLE_FAILED",
          message: "Toggle failed",
          requestId,
        }),
      );
    }
  },
);

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
    let undoToken = "";

    // ── Operational State V1 pre-checks (A–F) ──────────────────────────
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

      // D–F. standard checkout pre-checks (via shared service)
      try {
        const preCheck = await evaluateCheckoutV1Preconditions(
          clinicId,
          req.params.id,
          req.authUser!.id,
          snap,
        );
        v1StageClaimId = preCheck.v1StageClaimId;
        v1NewUsageState = preCheck.v1NewUsageState;
      } catch (err) {
        if (err instanceof CheckoutPreconditionError) {
          if (err.code === "STAGING_CONFLICT") {
            return res.status(409).json({
              code: err.code,
              error: "You are not the top priority claim holder",
              queue: err.extra?.queue,
            });
          }
          if (err.code === "BUNDLE_INCOMPLETE") {
            return res.status(422).json({ code: err.code, ...err.extra });
          }
          if (err.code === "EQUIPMENT_UNAVAILABLE") {
            return res.status(422).json({
              code: err.code,
              error:
                typeof err.extra?.error === "string"
                  ? err.extra.error
                  : "Equipment unavailable",
            });
          }
        }
        throw err;
      }
    }

    // ─────────────────────────────────────────────────────────────────

    if (!isEmergency) {
      try {
        await assertWaitlistCheckoutAllowed(clinicId, req.params.id, req.authUser!.id);
      } catch (err) {
        if (err instanceof EquipmentWaitlistError) {
          const status = err.code === "WAITLIST_RESERVATION_HELD_BY_OTHER" ? 409 : 422;
          return apiErrorI18n(req, res, `equipmentWaitlist.${err.code}`, undefined, status);
        }
        throw err;
      }
    }

    const txResult = await db.transaction(async (tx) =>
      performEquipmentCheckout(tx, {
        clinicId,
        equipmentId: req.params.id,
        actor: { id: req.authUser!.id, email: req.authUser!.email },
        location,
        clientTimestamp,
        v1StageClaimId,
        v1NewUsageState,
      }),
    );

    if (!txResult) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    updated = txResult.updated;
    undoToken = txResult.undoToken;

    await finalizeCheckoutSideEffects({
      clinicId,
      equipmentId: req.params.id,
      actor: { id: req.authUser!.id, email: req.authUser!.email },
      actorRole: resolveAuditActorRole(req) ?? undefined,
      equipment: txResult.updated,
      location,
      reminderBaseTime: txResult.reminderBaseTime,
      v1StageClaimId,
    });

    res.json({ equipment: updated, undoToken });
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

    const txResult = await db.transaction(async (tx) =>
      performEquipmentReturn(tx, {
        clinicId,
        equipmentId: req.params.id,
        actor: { id: req.authUser!.id, email: req.authUser!.email },
        clientTimestamp,
      }),
    );

    if (!txResult) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    if (txResult.alreadyReturned) {
      return res.json({
        equipment: txResult.updated,
        undoToken: "",
        returnRecord: null,
      });
    }

    const returnRecord = await finalizeReturnSideEffects({
      clinicId,
      equipmentId: req.params.id,
      actor: { id: req.authUser!.id, email: req.authUser!.email },
      actorRole: resolveAuditActorRole(req) ?? undefined,
      equipment: txResult.updated,
      isPluggedIn,
      plugInDeadlineMinutes,
      waitlistPromotedOnReturn: txResult.waitlistPromotedOnReturn,
    });

    res.json({
      equipment: txResult.updated,
      undoToken: txResult.undoToken,
      returnRecord,
    });
  } catch (err) {
    if (err instanceof CustodyReturnVersionConflictError) {
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

      undoToken = await insertEquipmentUndoToken(tx, {
        clinicId,
        equipmentId: req.params.id,
        actorId: req.authUser!.id,
        scanLogId: log.id,
        previousState: snapshotEquipmentState(existing),
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
