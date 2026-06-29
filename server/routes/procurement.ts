import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, eq, desc, inArray, notInArray, sql } from "drizzle-orm";
import { purchaseOrders, poLines, containerItems, containers, inventoryLogs, inventoryItems, db } from "../db.js";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import {
  handleCheckViolation,
  isCheckViolation,
  isInventoryConstraintError,
  toInventoryConstraintError,
} from "../lib/db-constraint-errors.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const router = Router();

export const createPoSchema = z.object({
  supplierName: z.string().min(1).max(200),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantityOrdered: z.number().int().min(1),
        unitPriceCents: z.number().int().min(0).optional(),
      }),
    )
    .min(1),
  notes: z.string().max(1000).optional(),
}).strict();

export const receivePoSchema = z.object({
  lines: z.array(
    z.object({
      lineId: z.string().min(1),
      quantityReceived: z.number().int().min(0),
      containerId: z.string().min(1),
    }),
  ),
}).strict();

// GET /api/procurement — list POs for the clinic
router.get("/", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { status } = req.query as Record<string, string>;

    const conditions = [eq(purchaseOrders.clinicId, clinicId)];
    if (status) conditions.push(eq(purchaseOrders.status, status as "draft" | "ordered" | "partial" | "received" | "cancelled"));

    const orders = await db
      .select()
      .from(purchaseOrders)
      .where(and(...conditions))
      .orderBy(desc(purchaseOrders.createdAt));

    const orderIds = orders.map((o) => o.id);
    const lines =
      orderIds.length > 0
        ? await db
            .select({
              id: poLines.id,
              purchaseOrderId: poLines.purchaseOrderId,
              clinicId: poLines.clinicId,
              itemId: poLines.itemId,
              itemLabel: inventoryItems.label,
              quantityOrdered: poLines.quantityOrdered,
              quantityReceived: poLines.quantityReceived,
              unitPriceCents: poLines.unitPriceCents,
              createdAt: poLines.createdAt,
            })
            .from(poLines)
            .leftJoin(inventoryItems, eq(poLines.itemId, inventoryItems.id))
            .where(inArray(poLines.purchaseOrderId, orderIds))
        : [];

    const linesByPo = new Map<string, typeof lines>();
    for (const line of lines) {
      const arr = linesByPo.get(line.purchaseOrderId) ?? [];
      arr.push(line);
      linesByPo.set(line.purchaseOrderId, arr);
    }

    res.json(orders.map((o) => ({ ...o, lines: linesByPo.get(o.id) ?? [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "PO_LIST_FAILED", message: "Failed to list purchase orders", requestId }),
    );
  }
});

// GET /api/procurement/:id — get single PO with lines
router.get("/:id", requireAuth, requireEffectiveRole("technician"), validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id)))
      .limit(1);

    if (!order) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "PO_NOT_FOUND", message: "Purchase order not found", requestId }));

    const lines = await db
      .select({
        id: poLines.id,
        purchaseOrderId: poLines.purchaseOrderId,
        clinicId: poLines.clinicId,
        itemId: poLines.itemId,
        itemLabel: inventoryItems.label,
        quantityOrdered: poLines.quantityOrdered,
        quantityReceived: poLines.quantityReceived,
        unitPriceCents: poLines.unitPriceCents,
        createdAt: poLines.createdAt,
      })
      .from(poLines)
      .leftJoin(inventoryItems, eq(poLines.itemId, inventoryItems.id))
      .where(eq(poLines.purchaseOrderId, order.id));

    res.json({ ...order, lines });
  } catch (err) {
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PO_GET_FAILED", message: "Failed to get purchase order", requestId }));
  }
});

// POST /api/procurement — create PO
router.post("/", requireAuth, requireAdmin, validateBody(createPoSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const b = req.body as z.infer<typeof createPoSchema>;
    const orderId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(purchaseOrders).values({
        id: orderId,
        clinicId,
        supplierName: b.supplierName.trim(),
        status: "draft",
        notes: b.notes?.trim() || null,
        createdBy: userId,
      });

      for (const line of b.lines) {
        await tx.insert(poLines).values({
          id: randomUUID(),
          clinicId,
          purchaseOrderId: orderId,
          itemId: line.itemId,
          quantityOrdered: line.quantityOrdered,
          unitPriceCents: line.unitPriceCents ?? 0,
        });
      }
    });

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, orderId)))
      .limit(1);
    const lines = await db
      .select({
        id: poLines.id,
        purchaseOrderId: poLines.purchaseOrderId,
        clinicId: poLines.clinicId,
        itemId: poLines.itemId,
        itemLabel: inventoryItems.label,
        quantityOrdered: poLines.quantityOrdered,
        quantityReceived: poLines.quantityReceived,
        unitPriceCents: poLines.unitPriceCents,
        createdAt: poLines.createdAt,
      })
      .from(poLines)
      .leftJoin(inventoryItems, eq(poLines.itemId, inventoryItems.id))
      .where(eq(poLines.purchaseOrderId, orderId));

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "purchase_order_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: orderId,
      targetType: "purchase_order",
      metadata: { supplierName: b.supplierName, lineCount: b.lines.length },
    });
    res.status(201).json({ ...order, lines });
  } catch (err) {
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PO_CREATE_FAILED", message: "Failed to create purchase order", requestId }));
  }
});

// PATCH /api/procurement/:id/submit — mark as ordered
router.patch("/:id/submit", requireAuth, requireAdmin, validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id)))
      .limit(1);

    if (!existing) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "PO_NOT_FOUND", message: "Purchase order not found", requestId }));
    if (existing.status !== "draft") return res.status(409).json(apiError({ code: "CONFLICT", reason: "INVALID_STATUS", message: "Only draft orders can be submitted", requestId }));

    const [updated] = await db
      .update(purchaseOrders)
      .set({ status: "ordered", orderedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.status, "draft")))
      .returning();
    if (!updated) {
      return res.status(409).json(apiError({ code: "CONFLICT", reason: "INVALID_STATUS", message: "Only draft orders can be submitted", requestId }));
    }
    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "purchase_order_submitted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: req.params.id,
      targetType: "purchase_order",
      metadata: {
        previousStatus: existing.status,
        newStatus: updated.status,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PO_SUBMIT_FAILED", message: "Failed to submit purchase order", requestId }));
  }
});

// PATCH /api/procurement/:id/receive — receive stock
router.patch("/:id/receive", requireAuth, requireEffectiveRole("technician"), validateUuid("id"), validateBody(receivePoSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const b = req.body as z.infer<typeof receivePoSchema>;

    const [existing] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id)))
      .limit(1);

    if (!existing) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "PO_NOT_FOUND", message: "Purchase order not found", requestId }));
    if (existing.status === "cancelled" || existing.status === "received") {
      return res.status(409).json(apiError({ code: "CONFLICT", reason: "INVALID_STATUS", message: `Cannot receive a ${existing.status} order`, requestId }));
    }

    // Collect per-line delta for audit metadata
    const receiveAuditLines: Array<{ itemId: string; quantityReceivedBefore: number; quantityReceivedAfter: number; delta: number }> = [];

    await db.transaction(async (tx) => {
      for (const incoming of b.lines) {
        if (incoming.quantityReceived <= 0) continue;

        // Lock the row and read current state — FOR UPDATE prevents concurrent
        // over-receives and gives us the before value for the audit log.
        const [currentLine] = await tx
          .select({ quantityReceived: poLines.quantityReceived, quantityOrdered: poLines.quantityOrdered, itemId: poLines.itemId })
          .from(poLines)
          .where(and(
            eq(poLines.id, incoming.lineId),
            eq(poLines.clinicId, clinicId),
            eq(poLines.purchaseOrderId, req.params.id),
          ))
          .limit(1)
          .for("update");
        if (!currentLine) {
          throw new Error("PO_LINE_NOT_FOUND");
        }

        const remaining = currentLine.quantityOrdered - currentLine.quantityReceived;
        if (remaining <= 0) continue; // line already fully received

        const effectiveDelta = Math.min(incoming.quantityReceived, remaining);
        const before = currentLine.quantityReceived;
        const after = before + effectiveDelta;

        await tx
          .update(poLines)
          .set({ quantityReceived: sql`${poLines.quantityReceived} + ${effectiveDelta}` })
          .where(and(
            eq(poLines.id, incoming.lineId),
            eq(poLines.clinicId, clinicId),
            eq(poLines.purchaseOrderId, req.params.id),
          ));

        receiveAuditLines.push({
          itemId: currentLine.itemId,
          quantityReceivedBefore: before,
          quantityReceivedAfter: after,
          delta: effectiveDelta,
        });

        // Tenant fence: prevents a line in one clinic from writing inventory into a container owned by another.
        const [targetContainer] = await tx
          .select({ id: containers.id })
          .from(containers)
          .where(and(eq(containers.id, incoming.containerId), eq(containers.clinicId, clinicId)))
          .limit(1);
        if (!targetContainer) {
          throw Object.assign(new Error("CONTAINER_NOT_FOUND"), { containerId: incoming.containerId });
        }

        // Atomic upsert — avoids the update-then-insert race on the unique key
        // (containerId, itemId). Returns the final row so we can derive quantityBefore.
        const [ciRow] = await tx
          .insert(containerItems)
          .values({
            id: randomUUID(),
            clinicId,
            containerId: incoming.containerId,
            itemId: currentLine.itemId,
            quantity: effectiveDelta,
          })
          .onConflictDoUpdate({
            target: [containerItems.containerId, containerItems.itemId],
            set: {
              quantity: sql`${containerItems.quantity} + ${effectiveDelta}`,
              updatedAt: new Date(),
            },
            setWhere: eq(containerItems.clinicId, clinicId),
          })
          .returning();

        await tx.insert(inventoryLogs).values({
          id: randomUUID(),
          clinicId,
          containerId: incoming.containerId,
          logType: "restock",
          quantityBefore: ciRow.quantity - effectiveDelta,
          quantityAdded: effectiveDelta,
          quantityAfter: ciRow.quantity,
          note: `Received via PO ${req.params.id}`,
          createdByUserId: userId,
        });
      }

      if (receiveAuditLines.length === 0) {
        throw new Error("NO_EFFECTIVE_DELTA");
      }

      // Serialize concurrent receives: lock the parent PO before re-reading lines
      // so two simultaneous partial receives can't both snapshot a stale set and
      // each compute "partial", leaving the order stuck after all lines are full.
      await tx.select({ id: purchaseOrders.id }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id)))
        .for("update");

      // Refresh lines and determine new PO status.
      // "draft" is promoted to "ordered" when a receive starts; "cancelled"/"received" are
      // rejected at the top of the handler so existing.status ∈ {draft, ordered, partial} here.
      const refreshedLines = await tx.select().from(poLines)
        .where(and(eq(poLines.purchaseOrderId, req.params.id), eq(poLines.clinicId, clinicId)));
      const allFullyReceived = refreshedLines.every((l) => l.quantityReceived >= l.quantityOrdered);
      const anyReceived = refreshedLines.some((l) => l.quantityReceived > 0);
      const newStatus = allFullyReceived ? "received" : anyReceived ? "partial" : existing.status === "draft" ? "ordered" : existing.status;

      const [poAfter] = await tx
        .update(purchaseOrders)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id), notInArray(purchaseOrders.status, ["received", "cancelled"])))
        .returning();
      if (!poAfter) throw new Error("CONCURRENT_MODIFICATION");
    });

    const [updated] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id)))
      .limit(1);
    if (!updated) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "PO_NOT_FOUND", message: "Purchase order not found", requestId }));
    }
    const updatedLines = await db
      .select({
        id: poLines.id,
        purchaseOrderId: poLines.purchaseOrderId,
        clinicId: poLines.clinicId,
        itemId: poLines.itemId,
        itemLabel: inventoryItems.label,
        quantityOrdered: poLines.quantityOrdered,
        quantityReceived: poLines.quantityReceived,
        unitPriceCents: poLines.unitPriceCents,
        createdAt: poLines.createdAt,
      })
      .from(poLines)
      .leftJoin(inventoryItems, eq(poLines.itemId, inventoryItems.id))
      .where(eq(poLines.purchaseOrderId, req.params.id));

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "purchase_order_received",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: req.params.id,
      targetType: "purchase_order",
      metadata: {
        previousStatus: existing.status,
        newStatus: updated.status,
        receiveLineCount: b.lines.length,
        lines: receiveAuditLines,
      },
    });
    res.json({ ...updated, lines: updatedLines });
  } catch (err) {
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
    if (err instanceof Error && err.message === "PO_LINE_NOT_FOUND") {
      return res.status(422).json(apiError({ code: "INVALID_INPUT", reason: "PO_LINE_NOT_FOUND", message: "Purchase order line not found for this order and clinic", requestId }));
    }
    if (err instanceof Error && err.message === "NO_EFFECTIVE_DELTA") {
      return res.status(422).json(apiError({ code: "INVALID_INPUT", reason: "NO_EFFECTIVE_DELTA", message: "No receivable quantity applied; all lines were zero, already full, or not found", requestId }));
    }
    if (err instanceof Error && err.message === "CONCURRENT_MODIFICATION") {
      return res.status(409).json(apiError({ code: "CONFLICT", reason: "CONCURRENT_MODIFICATION", message: "Order status changed concurrently", requestId }));
    }
    if (err instanceof Error && err.message === "CONTAINER_NOT_FOUND") {
      return res.status(422).json(apiError({ code: "INVALID_INPUT", reason: "CONTAINER_NOT_FOUND", message: "Destination container not found or does not belong to this clinic", requestId }));
    }
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PO_RECEIVE_FAILED", message: "Failed to receive purchase order", requestId }));
  }
});

// PATCH /api/procurement/:id/cancel — cancel PO
router.patch("/:id/cancel", requireAuth, requireAdmin, validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id)))
      .limit(1);

    if (!existing) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "PO_NOT_FOUND", message: "Purchase order not found", requestId }));
    if (existing.status === "received") return res.status(409).json(apiError({ code: "CONFLICT", reason: "ALREADY_RECEIVED", message: "Cannot cancel a received order", requestId }));
    if (existing.status === "cancelled") return res.status(409).json(apiError({ code: "CONFLICT", reason: "ALREADY_CANCELLED", message: "Order is already cancelled", requestId }));

    // Block cancellation if any line has already been received
    const allPoLines = await db.select({ quantityReceived: poLines.quantityReceived }).from(poLines)
      .where(and(eq(poLines.purchaseOrderId, req.params.id), eq(poLines.clinicId, clinicId)));
    const anyReceived = allPoLines.some((l) => l.quantityReceived > 0);
    if (anyReceived) {
      return res.status(409).json(apiError({
        code: "PARTIAL_RECEIPT_CANNOT_CANCEL",
        reason: "PARTIAL_RECEIPT_CANNOT_CANCEL",
        message: "Cannot cancel a purchase order that has already received stock. Some lines have quantityReceived > 0.",
        requestId,
      }));
    }

    const [updated] = await db
      .update(purchaseOrders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id), inArray(purchaseOrders.status, ["draft", "ordered"])))
      .returning();
    if (!updated) {
      return res.status(409).json(apiError({ code: "CONFLICT", reason: "CONCURRENT_MODIFICATION", message: "Order status changed concurrently", requestId }));
    }
    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "purchase_order_cancelled",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: req.params.id,
      targetType: "purchase_order",
      metadata: {
        previousStatus: existing.status,
        newStatus: updated.status,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "PO_CANCEL_FAILED", message: "Failed to cancel purchase order", requestId }));
  }
});

export default router;
