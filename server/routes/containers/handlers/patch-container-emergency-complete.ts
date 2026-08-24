import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { containerItems, containers, db, inventoryItems, inventoryLogs } from "../../../db.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { apiError, resolveRequestId } from "../../../lib/route-utils.js";
import {
  handleCheckViolation,
  isCheckViolation,
  isInventoryConstraintError,
  toInventoryConstraintError,
} from "../../../lib/db-constraint-errors.js";

type CompleteEmergencyBody = {
  items: Array<{ itemId: string; quantity: number }>;
};

// PATCH /api/containers/emergency/:eventId/complete
// Completes a consumables emergency dispense initiated via POST /:id/dispense —
// the second half of the same non-clinical dispense flow, so it shares the
// student floor (a student who taps emergency must be able to complete it).
export const patchContainerEmergencyCompleteHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const actorUserId = req.authUser!.id;
    const actorDisplayName = req.authUser!.name || req.authUser!.email;
    const eventId = req.params.eventId;
    const body = req.body as CompleteEmergencyBody;
    const takenAt = new Date();

    const dispensedItems: Array<{ itemId: string; label: string; quantity: number; newStock: number }> = [];
    await db.transaction(async (tx) => {
      // Find the emergency event log
      const [origLog] = await tx
        .select()
        .from(inventoryLogs)
        .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, eventId)))
        .limit(1);

      if (!origLog) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404 });

      const meta = origLog.metadata as Record<string, unknown> | null;
      if (!meta?.isEmergency || !meta?.pendingCompletion) {
        throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404 });
      }

      const containerId = origLog.containerId;

      const [container] = await tx
        .select()
        .from(containers)
        .where(and(eq(containers.clinicId, clinicId), eq(containers.id, containerId)))
        .limit(1);
      if (!container) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404 });

      for (const lineItem of body.items) {
        let ci: (typeof containerItems.$inferSelect) | undefined;
        let item: { label: string } | undefined;
        let newQty = 0;
        try {
        const [ciRow] = await tx
          .select()
          .from(containerItems)
          .where(
            and(
              eq(containerItems.clinicId, clinicId),
              eq(containerItems.containerId, containerId),
              eq(containerItems.itemId, lineItem.itemId),
            ),
          )
          .limit(1);
        ci = ciRow;

        if (!ci || ci.quantity < lineItem.quantity) {
          throw Object.assign(new Error("INSUFFICIENT_STOCK"), {
            statusCode: 409,
            code: "INSUFFICIENT_STOCK",
            itemId: lineItem.itemId,
            available: ci?.quantity ?? 0,
            requested: lineItem.quantity,
          });
        }

        const [itemRow] = await tx
          .select({ label: inventoryItems.label })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, lineItem.itemId)))
          .limit(1);
        item = itemRow;

        newQty = ci.quantity - lineItem.quantity;

        await tx
          .update(containerItems)
          .set({ quantity: newQty, updatedAt: new Date() })
          .where(
            and(
              eq(containerItems.clinicId, clinicId),
              eq(containerItems.containerId, containerId),
              eq(containerItems.itemId, lineItem.itemId),
            ),
          );
        } catch (lineErr) {
          if (isCheckViolation(lineErr)) {
            throw toInventoryConstraintError(lineErr);
          }
          throw lineErr;
        }

        const inventoryLogId = randomUUID();
        await tx.insert(inventoryLogs).values({
          id: inventoryLogId,
          clinicId,
          containerId,
          taskId: null,
          logType: "adjustment",
          quantityBefore: ci.quantity,
          quantityAdded: -lineItem.quantity,
          quantityAfter: newQty,
          roomId: container.roomId,
          note: null,
          metadata: { isEmergency: true, emergencyEventId: eventId, itemId: lineItem.itemId },
          createdByUserId: origLog.createdByUserId,
        });

        dispensedItems.push({
          itemId: lineItem.itemId,
          label: item?.label ?? lineItem.itemId,
          quantity: lineItem.quantity,
          newStock: newQty,
        });

      }

      // Mark original emergency log as completed
      await tx
        .update(inventoryLogs)
        .set({
          metadata: { ...meta, pendingCompletion: false },
        })
        .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, eventId)));
    });

    logAudit({
      clinicId,
      actionType: "inventory_dispensed",
      performedBy: actorUserId,
      performedByEmail: req.authUser!.email ?? "",
      targetId: eventId,
      targetType: "emergency_event",
      actorRole: resolveAuditActorRole(req),
      metadata: {
        dispensedItemCount: dispensedItems.length,
        autoBilledCents: 0,
        isEmergency: true,
      },
    });

    return res.json({
      success: true,
      dispensed: dispensedItems,
      takenBy: { userId: actorUserId, displayName: actorDisplayName },
      takenAt: takenAt.toISOString(),
      billingIds: [] as string[],
    });
  } catch (err: unknown) {
    if (isInventoryConstraintError(err)) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
        constraint: err.constraint,
      });
    }
    if (isCheckViolation(err) && handleCheckViolation(err, res)) {
      return;
    }
    const e = err as Record<string, unknown>;
    if (e.code === "INSUFFICIENT_STOCK") {
      return res.status(409).json({
        code: "INSUFFICIENT_STOCK",
        error: "INSUFFICIENT_STOCK",
        reason: "Insufficient stock",
        message: "Insufficient stock for requested item",
        itemId: e.itemId,
        available: e.available,
        requested: e.requested,
        requestId,
      });
    }
    if ((e as { statusCode?: number }).statusCode === 404) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "EVENT_NOT_FOUND", message: "Emergency event not found", requestId }));
    }
    console.error(err);
    return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "COMPLETE_EMERGENCY_FAILED", message: "Failed to complete emergency", requestId }));
  }
};
