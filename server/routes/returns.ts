import { Router } from "express";
import { randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, equipment, equipmentReturns } from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { checkoutLimiter } from "../middleware/rate-limiters.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { enqueueChargeAlertJob } from "../jobs/charge-alert-enqueue.js";
import { cancelChargeAlertJob } from "../workers/chargeAlertWorker.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";

const router = Router();

const DEFAULT_DEADLINE_MINUTES = 30;
const MAX_DEADLINE_MINUTES = 1440;

const createReturnSchema = z.object({
  equipmentId: z.string().uuid(),
  isPluggedIn: z.boolean(),
  plugInDeadlineMinutes: z.number().int().min(1).max(MAX_DEADLINE_MINUTES).optional(),
});

const patchReturnSchema = z.object({
  isPluggedIn: z.boolean().optional(),
  plugInDeadlineMinutes: z.number().int().min(1).max(MAX_DEADLINE_MINUTES).optional(),
});

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

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

async function ensureEquipmentInClinic(clinicId: string, equipmentId: string) {
  const [row] = await db
    .select({
      id: equipment.id,
      clinicId: equipment.clinicId,
    })
    .from(equipment)
    .where(
      and(
        eq(equipment.id, equipmentId),
        eq(equipment.clinicId, clinicId),
        isNull(equipment.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

router.post(
  "/",
  requireAuth,
  checkoutLimiter,
  requireEffectiveRole("technician"),
  idempotencyMiddleware("returns:create"),
  validateBody(createReturnSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const { equipmentId, isPluggedIn, plugInDeadlineMinutes } = req.body as z.infer<typeof createReturnSchema>;

    try {
      const equipmentRow = await ensureEquipmentInClinic(clinicId, equipmentId);
      if (!equipmentRow) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "EQUIPMENT_NOT_FOUND",
            message: "Equipment not found",
            requestId,
          }),
        );
      }

      const deadlineMinutes = plugInDeadlineMinutes ?? DEFAULT_DEADLINE_MINUTES;
      const returnId = randomUUID();
      const chargeAlertJobId = !isPluggedIn
        ? await enqueueChargeAlertJob({
            returnId,
            clinicId,
            equipmentId,
            plugInDeadlineMinutes: deadlineMinutes,
          })
        : null;
      const [created] = await db
        .insert(equipmentReturns)
        .values({
          id: returnId,
          clinicId,
          equipmentId,
          returnedById: userId,
          returnedByEmail: req.authUser!.email,
          isPluggedIn,
          plugInDeadlineMinutes: deadlineMinutes,
          plugInAlertSentAt: null,
          chargeAlertJobId,
        })
        .returning();

      logAudit({
        clinicId,
        actionType: "equipment_returned",
        performedBy: userId,
        performedByEmail: req.authUser!.email,
        actorRole: resolveAuditActorRole(req),
        targetId: equipmentId,
        targetType: "equipment",
        metadata: {
          returnId: created.id,
          isPluggedIn: created.isPluggedIn,
          plugInDeadlineMinutes: created.plugInDeadlineMinutes,
          chargeAlertJobId: created.chargeAlertJobId,
        },
      });

      res.status(201).json(created);
    } catch (error) {
      console.error("[returns] create failed", error);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "RETURN_CREATE_FAILED",
          message: "Failed to create return",
          requestId,
        }),
      );
    }
  },
);

router.patch(
  "/:id",
  requireAuth,
  checkoutLimiter,
  requireEffectiveRole("technician"),
  idempotencyMiddleware("returns:patch"),
  validateUuid("id"),
  validateBody(patchReturnSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const clinicId = req.clinicId!;
    const returnId = req.params.id;
    const { isPluggedIn, plugInDeadlineMinutes } = req.body as z.infer<typeof patchReturnSchema>;

    try {
      const [existing] = await db
        .select()
        .from(equipmentReturns)
        .where(and(eq(equipmentReturns.id, returnId), eq(equipmentReturns.clinicId, clinicId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "RETURN_NOT_FOUND",
            message: "Return not found",
            requestId,
          }),
        );
      }

      if (plugInDeadlineMinutes !== undefined && existing.plugInAlertSentAt) {
        return res.status(409).json(
          apiError({
            code: "CONFLICT",
            reason: "RETURN_ALERT_ALREADY_SENT",
            message: "Cannot update plug-in deadline after alert was sent",
            requestId,
          }),
        );
      }

      const shouldCancelPendingJob =
        isPluggedIn === true &&
        existing.isPluggedIn === false &&
        existing.plugInAlertSentAt === null;

      const shouldEnqueueJob =
        isPluggedIn === false &&
        (existing.isPluggedIn === true || (plugInDeadlineMinutes !== undefined && existing.isPluggedIn === false)) &&
        existing.plugInAlertSentAt === null;

      const deadlineMinutes = plugInDeadlineMinutes ?? existing.plugInDeadlineMinutes;

      let [updated] = await db
        .update(equipmentReturns)
        .set({
          ...(isPluggedIn !== undefined && { isPluggedIn }),
          ...(plugInDeadlineMinutes !== undefined && { plugInDeadlineMinutes }),
          ...(isPluggedIn === true && { chargeAlertJobId: null }),
          updatedAt: new Date(),
        })
        .where(and(eq(equipmentReturns.id, returnId), eq(equipmentReturns.clinicId, clinicId)))
        .returning();

      if (shouldCancelPendingJob) {
        await cancelChargeAlertJob(returnId);
      } else if (shouldEnqueueJob) {
        const nextJobId = await enqueueChargeAlertJob({
          returnId,
          clinicId,
          equipmentId: existing.equipmentId,
          plugInDeadlineMinutes: deadlineMinutes,
        });
        if (nextJobId) {
          updated = {
            ...updated,
            chargeAlertJobId: nextJobId,
          };
        }
      }

      logAudit({
        clinicId,
        actionType: "equipment_updated",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        actorRole: resolveAuditActorRole(req),
        targetId: existing.equipmentId,
        targetType: "equipment",
        metadata: {
          returnId,
          previousState: {
            isPluggedIn: existing.isPluggedIn,
            plugInDeadlineMinutes: existing.plugInDeadlineMinutes,
            chargeAlertJobId: existing.chargeAlertJobId,
          },
          newState: {
            isPluggedIn: updated.isPluggedIn,
            plugInDeadlineMinutes: updated.plugInDeadlineMinutes,
            chargeAlertJobId: updated.chargeAlertJobId,
          },
        },
      });

      res.json(updated);
    } catch (error) {
      console.error("[returns] patch failed", error);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "RETURN_UPDATE_FAILED",
          message: "Failed to update return",
          requestId,
        }),
      );
    }
  },
);

export default router;
