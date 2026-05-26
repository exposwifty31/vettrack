import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, eq, desc, inArray } from "drizzle-orm";
import { purchaseOrders, poLines, containerItems, inventoryLogs, inventoryItems, db } from "../db.js";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import {
  handleCheckViolation,
  isCheckViolation,
  isInventoryConstraintError,
  toInventoryConstraintError,
} from "../lib/db-constraint-errors.js";

const router = Router();

function resolveRequestId(
  res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void },
  incoming: unknown,
): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
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

    await db
      .update(purchaseOrders)
      .set({ status: "ordered", orderedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id));

    const [updated] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id)))
      .limit(1);
    if (!updated) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "PO_NOT_FOUND", message: "Purchase order not found", requestId }));
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

    const allLines = await db.select().from(poLines).where(eq(poLines.purchaseOrderId, req.params.id));

    // Collect per-line delta for audit metadata
    const receiveAuditLines: Array<{ itemId: string; quantityReceivedBefore: number; quantityReceivedAfter: number; delta: number }> = [];

    await db.transaction(async (tx) => {
      for (const incoming of b.lines) {
        const line = allLines.find((l) => l.id === incoming.lineId);
        if (!line) continue;
        if (incoming.quantityReceived <= 0) continue;

        const before = line.quantityReceived;
        const after = before + incoming.quantityReceived;

        // Update line received quantity
        await tx
          .update(poLines)
          .set({ quantityReceived: after })
          .where(eq(poLines.id, line.id));

        receiveAuditLines.push({
          itemId: line.itemId,
          quantityReceivedBefore: before,
          quantityReceivedAfter: after,
          delta: incoming.quantityReceived,
        });

        // Upsert containerItems quantity
        const [existingCi] = await tx
          .select()
          .from(containerItems)
          .where(and(eq(containerItems.containerId, incoming.containerId), eq(containerItems.itemId, line.itemId)))
          .limit(1);

        if (existingCi) {
          try {
            await tx
              .update(containerItems)
              .set({ quantity: existingCi.quantity + incoming.quantityReceived, updatedAt: new Date() })
              .where(eq(containerItems.id, existingCi.id));
          } catch (ciErr) {
            if (isCheckViolation(ciErr)) {
              throw toInventoryConstraintError(ciErr);
            }
            throw ciErr;
          }

          await tx.insert(inventoryLogs).values({
            id: randomUUID(),
            clinicId,
            containerId: incoming.containerId,
            logType: "restock",
            quantityBefore: existingCi.quantity,
            quantityAdded: incoming.quantityReceived,
            quantityAfter: existingCi.quantity + incoming.quantityReceived,
            note: `Received via PO ${req.params.id}`,
            createdByUserId: userId,
          });
        } else {
          try {
            await tx.insert(containerItems).values({
              id: randomUUID(),
              clinicId,
              containerId: incoming.containerId,
              itemId: line.itemId,
              quantity: incoming.quantityReceived,
            });
          } catch (ciErr) {
            if (isCheckViolation(ciErr)) {
              throw toInventoryConstraintError(ciErr);
            }
            throw ciErr;
          }

          await tx.insert(inventoryLogs).values({
            id: randomUUID(),
            clinicId,
            containerId: incoming.containerId,
            logType: "restock",
            quantityBefore: 0,
            quantityAdded: incoming.quantityReceived,
            quantityAfter: incoming.quantityReceived,
            note: `Received via PO ${req.params.id}`,
            createdByUserId: userId,
          });
        }
      }

      // Refresh lines and determine new PO status
      const refreshedLines = await tx.select().from(poLines).where(eq(poLines.purchaseOrderId, req.params.id));
      const allFullyReceived = refreshedLines.every((l) => l.quantityReceived >= l.quantityOrdered);
      const anyReceived = refreshedLines.some((l) => l.quantityReceived > 0);
      const newStatus = allFullyReceived ? "received" : anyReceived ? "partial" : existing.status;

      await tx
        .update(purchaseOrders)
        .set({ status: newStatus as "received" | "partial" | "ordered", updatedAt: new Date() })
        .where(eq(purchaseOrders.id, req.params.id));
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

    // Fix C: block cancellation if any line has already been received
    const allPoLines = await db.select({ quantityReceived: poLines.quantityReceived }).from(poLines).where(eq(poLines.purchaseOrderId, req.params.id));
    const anyReceived = allPoLines.some((l) => l.quantityReceived > 0);
    if (anyReceived) {
      return res.status(409).json(apiError({
        code: "PARTIAL_RECEIPT_CANNOT_CANCEL",
        reason: "PARTIAL_RECEIPT_CANNOT_CANCEL",
        message: "Cannot cancel a purchase order that has already received stock. Some lines have quantityReceived > 0.",
        requestId,
      }));
    }

    await db
      .update(purchaseOrders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(purchaseOrders.id, req.params.id));

    const [updated] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.clinicId, clinicId), eq(purchaseOrders.id, req.params.id)))
      .limit(1);
    if (!updated) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "PO_NOT_FOUND", message: "Purchase order not found", requestId }));
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
