import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  billingItems,
  billingLedger,
  containerItems,
  containers,
  db,
  idempotencyKeys,
  inventoryItems,
  inventoryLogs,
  operationalTasks,
  users,
} from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { seedDefaultContainersIfEmpty } from "../lib/ensure-clinic-phase2-defaults.js";
import { restockContainerInTx } from "../services/inventory.service.js";
import { resolveBlueprintEntryForContainerName } from "../config/inventoryBlueprint.js";
import { enqueueBillingWebhookJob } from "../lib/queue.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import {
  evaluateDispenseAgainstOrders,
  loadInventoryItemLabelCode,
  type DispenseLineForValidation,
} from "../lib/dispense-order-validation.js";
import { captureConsumableBillingForDispenseLine } from "../lib/container-consumable-billing.js";
import {
  DISPENSE_IDEMPOTENCY_ENDPOINT,
  dispenseIdempotencyMiddleware,
} from "../middleware/container-dispense-idempotency.js";
import { hashDispenseRequestBody } from "../lib/dispense-idempotency-hash.js";

const router = Router();

const createContainerSchema = z.object({
  name: z.string().min(1).max(200),
  department: z.string().max(200).optional(),
  targetQuantity: z.number().int().min(0),
  currentQuantity: z.number().int().min(0).optional(),
  roomId: z.string().uuid().optional().nullable(),
  nfcTagId: z.string().max(200).optional().nullable(),
});

const restockSchema = z.object({
  addedQuantity: z.number().int().min(0),
});

const blindAuditSchema = z.object({
  physicalCount: z.number().int().min(0),
  note: z.string().max(500).optional(),
});

function resolveRequestId(res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void }, incoming: unknown): string {
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

router.post("/bootstrap-defaults", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const inserted = await seedDefaultContainersIfEmpty(clinicId);
    res.json({ inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CONTAINERS_BOOTSTRAP_FAILED",
        message: "Failed to seed default containers",
        requestId,
      }),
    );
  }
});

router.get("/", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const nfcTagId = typeof req.query.nfcTagId === "string" ? req.query.nfcTagId.trim() : null;

    if (nfcTagId) {
      // Lookup by NFC tag — return single container with items or 404
      const [container] = await db
        .select()
        .from(containers)
        .where(and(eq(containers.clinicId, clinicId), eq(containers.nfcTagId, nfcTagId)))
        .limit(1);

      if (!container) {
        return res.status(404).json(
          apiError({ code: "NOT_FOUND", reason: "CONTAINER_NOT_FOUND", message: "No container found for this NFC tag", requestId }),
        );
      }

      const items = await db
        .select({
          id: containerItems.id,
          itemId: containerItems.itemId,
          quantity: containerItems.quantity,
          label: inventoryItems.label,
          code: inventoryItems.code,
        })
        .from(containerItems)
        .leftJoin(inventoryItems, eq(containerItems.itemId, inventoryItems.id))
        .where(and(eq(containerItems.clinicId, clinicId), eq(containerItems.containerId, container.id)));

      return res.json({ ...container, items });
    }

    const rows = await db
      .select()
      .from(containers)
      .where(eq(containers.clinicId, clinicId))
      .orderBy(asc(containers.name));
    const ids = rows.map((row) => row.id);
    const aggregateRows = ids.length
      ? await db
          .select({
            containerId: containerItems.containerId,
            quantity: sql<number>`COALESCE(SUM(${containerItems.quantity}), 0)`,
          })
          .from(containerItems)
          .where(and(eq(containerItems.clinicId, clinicId), inArray(containerItems.containerId, ids)))
          .groupBy(containerItems.containerId)
      : [];
    const qtyByContainerId = new Map(aggregateRows.map((row) => [row.containerId, Number(row.quantity)]));
    const withBlueprintTargets = rows.map((row) => {
      const entry = resolveBlueprintEntryForContainerName(row.name);
      const currentQuantity = qtyByContainerId.get(row.id) ?? row.currentQuantity;
      return {
        ...row,
        currentQuantity,
        supplyTargets: entry?.supplyTargets ?? [],
      };
    });
    res.json(withBlueprintTargets);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CONTAINERS_LIST_FAILED",
        message: "Failed to list containers",
        requestId,
      }),
    );
  }
});

router.post(
  "/",
  requireAuth,
  requireEffectiveRole("admin"),
  validateBody(createContainerSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const b = req.body as z.infer<typeof createContainerSchema>;
      const id = randomUUID();
      const current = b.currentQuantity ?? b.targetQuantity;
      await db.insert(containers).values({
        id,
        clinicId,
        name: b.name.trim(),
        department: b.department?.trim() ?? "",
        targetQuantity: b.targetQuantity,
        currentQuantity: current,
        roomId: b.roomId ?? null,
        nfcTagId: b.nfcTagId?.trim() || null,
      });
      const [row] = await db.select().from(containers).where(eq(containers.id, id)).limit(1);
      res.status(201).json(row);
    } catch (err) {
      console.error(err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "CONTAINER_CREATE_FAILED",
          message: "Failed to create container",
          requestId,
        }),
      );
    }
  },
);

router.post(
  "/:id/restock",
  requireAuth,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  validateBody(restockSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    return res.status(409).json(
      apiError({
        code: "LEGACY_RESTOCK_DISABLED",
        reason: "LEGACY_RESTOCK_DISABLED",
        message: "Legacy restock endpoint is disabled. Use restock sessions.",
        requestId,
      }),
    );
  },
);

router.post(
  "/:id/blind-audit",
  requireAuth,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  validateBody(blindAuditSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    return res.status(409).json(
      apiError({
        code: "LEGACY_RESTOCK_DISABLED",
        reason: "LEGACY_RESTOCK_DISABLED",
        message: "Legacy blind-audit endpoint is disabled. Use restock sessions.",
        requestId,
      }),
    );
  },
);

// ─── Dispense schemas ─────────────────────────────────────────────────────────

const dispenseSchema = z
  .object({
    items: z.array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().int().min(1),
      }),
    ),
    /** Legacy field; prefer `patientId` for new clients. */
    animalId: z.string().nullable().optional(),
    patientId: z.string().uuid().optional(),
    isEmergency: z.boolean().default(false),
    bypassReason: z.enum(["EMERGENCY_CPR", "PROTOCOL_OVERRIDE", "TECH_ERROR"]).optional(),
  })
  .refine((d) => !d.isEmergency || !!d.bypassReason, {
    message: "bypassReason is required when isEmergency is true",
    path: ["bypassReason"],
  });

const completeEmergencySchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string().min(1),
      quantity: z.number().int().min(1),
    }),
  ),
  animalId: z.string().nullable().optional(),
});

// POST /api/containers/:id/dispense
router.post(
  "/:id/dispense",
  requireAuth,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  dispenseIdempotencyMiddleware,
  validateBody(dispenseSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const actorUserId = req.authUser!.id;
      const actorDisplayName = req.authUser!.name || req.authUser!.email;
      const containerId = req.params.id;
      const body = req.body as z.infer<typeof dispenseSchema>;
      const { isEmergency } = body;
      const animalId = body.animalId ?? body.patientId ?? null;
      const requestIdempotencyKey = res.locals.dispenseIdempotencyKey;
      const takenAt = new Date();
      const allowTestBillingFail =
        process.env.VETTRACK_TEST_FORCE_BILLING_FAIL === "1" &&
        typeof req.headers["x-test-force-billing-fail"] === "string" &&
        req.headers["x-test-force-billing-fail"].trim() === "1";

      const dispenseRequestHash = hashDispenseRequestBody(req.body);

      if (isEmergency && body.items.length === 0) {
        // Standalone emergency tap: log event only, no stock changes (complete later)
        const emergencyEventId = randomUUID();
        const bypassReason = body.bypassReason;
        await db.transaction(async (tx) => {
          const [container] = await tx
            .select()
            .from(containers)
            .where(and(eq(containers.clinicId, clinicId), eq(containers.id, containerId)))
            .limit(1);
          if (!container) throw Object.assign(new Error("CONTAINER_NOT_FOUND"), { statusCode: 404 });

          await tx.insert(inventoryLogs).values({
            id: emergencyEventId,
            clinicId,
            containerId,
            taskId: null,
            logType: "adjustment",
            quantityBefore: 0,
            quantityAdded: 0,
            quantityAfter: 0,
            animalId: null,
            roomId: container.roomId,
            note: "emergency",
            metadata: {
              isEmergency: true,
              containerId,
              pendingCompletion: true,
              ...(bypassReason ? { bypassReason } : {}),
            },
            createdByUserId: actorUserId,
          });
        });

        return res.json({
          success: true,
          emergencyEventId,
          takenBy: { userId: actorUserId, displayName: actorDisplayName },
          takenAt: takenAt.toISOString(),
        });
      }

      // Normal dispense — stock, logs, billing, idempotency replay row (single transaction).
      const dispensedItems: Array<{ itemId: string; label: string; quantity: number; newStock: number }> = [];
      const billingIds: string[] = [];
      let autoBilledCents = 0;

      const responsePayload = await db.transaction(async (tx) => {
        const [container] = await tx
          .select()
          .from(containers)
          .where(and(eq(containers.clinicId, clinicId), eq(containers.id, containerId)))
          .limit(1);
        if (!container) throw Object.assign(new Error("CONTAINER_NOT_FOUND"), { statusCode: 404 });

        if (!body.isEmergency) {
          const validationLines: DispenseLineForValidation[] = [];
          for (const lineItem of body.items) {
            const inv = await loadInventoryItemLabelCode(tx, clinicId, lineItem.itemId);
            if (!inv) {
              throw Object.assign(new Error("INVENTORY_ITEM_NOT_FOUND"), { statusCode: 404, itemId: lineItem.itemId });
            }
            validationLines.push({
              itemId: lineItem.itemId,
              quantity: lineItem.quantity,
              label: inv.label,
              code: inv.code,
            });
          }

          const { orphanLines } = await evaluateDispenseAgainstOrders(tx, {
            clinicId,
            animalId: animalId ?? null,
            containerId,
            lines: validationLines,
          });

          if (orphanLines.length > 0 && !body.bypassReason) {
            throw Object.assign(new Error("ORPHAN_DISPENSE_BLOCKED"), {
              statusCode: 400,
              reason: "ORPHAN_DISPENSE_BLOCKED",
              orphanLines,
            });
          }
        }

        for (const lineItem of body.items) {
          // Verify container item exists and has sufficient quantity
          const [ci] = await tx
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

          if (!ci) {
            throw Object.assign(new Error("ITEM_NOT_IN_CONTAINER"), {
              statusCode: 409,
              code: "INSUFFICIENT_STOCK",
              itemId: lineItem.itemId,
              available: 0,
              requested: lineItem.quantity,
            });
          }

          if (ci.quantity < lineItem.quantity) {
            throw Object.assign(new Error("INSUFFICIENT_STOCK"), {
              statusCode: 409,
              code: "INSUFFICIENT_STOCK",
              itemId: lineItem.itemId,
              available: ci.quantity,
              requested: lineItem.quantity,
            });
          }

          // Get item label
          const [item] = await tx
            .select({ label: inventoryItems.label })
            .from(inventoryItems)
            .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, lineItem.itemId)))
            .limit(1);

          const newQty = ci.quantity - lineItem.quantity;

          // Decrement container item quantity
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

          // Insert inventory log
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
            animalId: animalId ?? null,
            roomId: container.roomId,
            note: null,
            metadata: {
              isEmergency: Boolean(body.bypassReason) || Boolean(body.isEmergency),
              itemId: lineItem.itemId,
              ...(body.bypassReason ? { bypassReason: body.bypassReason } : {}),
            },
            createdByUserId: actorUserId,
          });

          dispensedItems.push({
            itemId: lineItem.itemId,
            label: item?.label ?? lineItem.itemId,
            quantity: lineItem.quantity,
            newStock: newQty,
          });

          const ledgerIdempotencyKey =
            requestIdempotencyKey && requestIdempotencyKey.length > 0
              ? `${requestIdempotencyKey}:adj:${inventoryLogId}`
              : `adjustment_${inventoryLogId}`;

          const capture = await captureConsumableBillingForDispenseLine(tx, {
            clinicId,
            containerId,
            inventoryLogId,
            itemId: lineItem.itemId,
            patientId: animalId ?? null,
            qty: lineItem.quantity,
            idempotencyKey: ledgerIdempotencyKey,
            testForceBillingFail: allowTestBillingFail,
          });
          if (capture.billingEventId) {
            billingIds.push(capture.billingEventId);
            await tx
              .update(inventoryLogs)
              .set({ billingEventId: capture.billingEventId })
              .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, inventoryLogId)));
          }
          autoBilledCents += capture.rowTotalCents;
        }

        if (body.isEmergency && body.bypassReason) {
          await tx.insert(operationalTasks).values({
            id: randomUUID(),
            clinicId,
            patientId: animalId ?? null,
            type: "SYSTEM",
            tag: "BILLING_RECONCILIATION_REQUIRED",
            title: "Emergency dispense — billing reconciliation required",
          });
        }

        const payload: Record<string, unknown> = {
          success: true,
          dispensed: dispensedItems,
          takenBy: { userId: actorUserId, displayName: actorDisplayName },
          takenAt: takenAt.toISOString(),
          billingIds,
          autoBilledCents,
        };

        await tx
          .insert(idempotencyKeys)
          .values({
            clinicId,
            key: requestIdempotencyKey!,
            endpoint: DISPENSE_IDEMPOTENCY_ENDPOINT,
            requestHash: dispenseRequestHash,
            statusCode: 200,
            responseBody: payload,
          })
          .onConflictDoUpdate({
            target: [idempotencyKeys.clinicId, idempotencyKeys.key],
            set: {
              endpoint: DISPENSE_IDEMPOTENCY_ENDPOINT,
              requestHash: dispenseRequestHash,
              statusCode: 200,
              responseBody: payload,
            },
          });

        return payload;
      });

      res.locals.dispenseIdempotencyPersistedInTransaction = true;

      // Fire billing webhooks for all billed entries (config lookup handled inside)
      try {
        for (const billingId of billingIds) {
          const [entry] = await db.select().from(billingLedger).where(eq(billingLedger.id, billingId)).limit(1);
          if (entry) {
            await enqueueBillingWebhookJob({
              clinicId,
              entry: {
                id: entry.id,
                animalId: entry.animalId,
                itemType: entry.itemType,
                itemId: entry.itemId,
                quantity: entry.quantity,
                unitPriceCents: entry.unitPriceCents,
                totalAmountCents: entry.totalAmountCents,
                status: entry.status,
                createdAt: entry.createdAt,
              },
            });
          }
        }
      } catch (webhookErr) {
        console.error("[billing-webhook] Failed to enqueue webhook for dispense, continuing:", webhookErr);
      }

      logAudit({
        clinicId,
        actionType: "inventory_dispensed",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email ?? "",
        targetId: containerId,
        targetType: "container",
        actorRole: resolveAuditActorRole(req),
        metadata: {
          dispensedItemCount: dispensedItems.length,
          autoBilledCents,
          animalId: animalId ?? null,
          isEmergency: Boolean(body.bypassReason) || Boolean(body.isEmergency),
          ...(body.bypassReason ? { bypassReason: body.bypassReason } : {}),
        },
      });

      return res.json(responsePayload);
    } catch (err: unknown) {
      const e = err as Record<string, unknown> & { statusCode?: number; reason?: string; orphanLines?: unknown; itemId?: string };
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
      if (e.reason === "ORPHAN_DISPENSE_BLOCKED" || (err as Error).message === "ORPHAN_DISPENSE_BLOCKED") {
        return res.status(400).json({
          code: "ORPHAN_DISPENSE_BLOCKED",
          error: "ORPHAN_DISPENSE_BLOCKED",
          reason: "ORPHAN_DISPENSE_BLOCKED",
          message: "Dispense blocked: lines do not align with active orders or patient context.",
          orphanLines: e.orphanLines ?? [],
          requestId,
        });
      }
      if ((err as Error).message === "INVENTORY_ITEM_NOT_FOUND") {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "INVENTORY_ITEM_NOT_FOUND",
            message: "Inventory item not found for dispense line",
            requestId,
          }),
        );
      }
      if (e.statusCode === 404 || (err as Error).message === "CONTAINER_NOT_FOUND") {
        return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "CONTAINER_NOT_FOUND", message: "Container not found", requestId }));
      }
      console.error(err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "DISPENSE_FAILED", message: "Failed to process dispense", requestId }));
    }
  },
);

// PATCH /api/containers/emergency/:eventId/complete
router.patch(
  "/emergency/:eventId/complete",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(completeEmergencySchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const actorUserId = req.authUser!.id;
      const actorDisplayName = req.authUser!.name || req.authUser!.email;
      const eventId = req.params.eventId;
      const body = req.body as z.infer<typeof completeEmergencySchema>;
      const { animalId } = body;
      const takenAt = new Date();

      const dispensedItems: Array<{ itemId: string; label: string; quantity: number; newStock: number }> = [];
      const billingIds: string[] = [];
      // Collect auto-billing candidates to insert after the transaction commits
      const autoBillingCandidates: Array<{ inventoryLogId: string; billingItemId: string; quantity: number; itemId: string }> = [];

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
          const [ci] = await tx
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

          if (!ci || ci.quantity < lineItem.quantity) {
            throw Object.assign(new Error("INSUFFICIENT_STOCK"), {
              statusCode: 409,
              code: "INSUFFICIENT_STOCK",
              itemId: lineItem.itemId,
              available: ci?.quantity ?? 0,
              requested: lineItem.quantity,
            });
          }

          const [item] = await tx
            .select({ label: inventoryItems.label })
            .from(inventoryItems)
            .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, lineItem.itemId)))
            .limit(1);

          const newQty = ci.quantity - lineItem.quantity;

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
            animalId: animalId ?? null,
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

          // Billing is handled by the auto-billing block below via billingItems.
          // containerItems has no unitPriceCents — direct billing here would produce ₪0 entries.

          // Queue auto-billing candidate for post-transaction insert
          if (container.billingItemId) {
            autoBillingCandidates.push({ inventoryLogId, billingItemId: container.billingItemId, quantity: lineItem.quantity, itemId: lineItem.itemId });
          }
        }

        // Mark original emergency log as completed
        await tx
          .update(inventoryLogs)
          .set({
            metadata: { ...meta, pendingCompletion: false },
          })
          .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, eventId)));
      });

      // Auto-billing: insert billing ledger rows after the transaction commits
      // Failures must NOT fail the dispense — log and continue
      for (const candidate of autoBillingCandidates) {
        try {
          const [item] = await db
            .select({ isBillable: inventoryItems.isBillable, minimumDispenseToCapture: inventoryItems.minimumDispenseToCapture })
            .from(inventoryItems)
            .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, candidate.itemId)))
            .limit(1);
          if (!item?.isBillable) continue;
          if (candidate.quantity < (item.minimumDispenseToCapture ?? 1)) continue;
          const [bi] = await db
            .select({ id: billingItems.id, unitPriceCents: billingItems.unitPriceCents })
            .from(billingItems)
            .where(and(eq(billingItems.id, candidate.billingItemId), eq(billingItems.clinicId, clinicId)))
            .limit(1);
          if (bi && bi.unitPriceCents > 0) {
            const autoBillingId = randomUUID();
            await db.insert(billingLedger).values({
              id: autoBillingId,
              clinicId,
              animalId: null, // emergencies are unregistered animals by definition
              itemType: "CONSUMABLE",
              itemId: bi.id,
              quantity: candidate.quantity,
              unitPriceCents: bi.unitPriceCents,
              totalAmountCents: bi.unitPriceCents * candidate.quantity,
              idempotencyKey: `adjustment_${candidate.inventoryLogId}`,
              status: "pending",
            }).onConflictDoNothing();
            billingIds.push(autoBillingId);
          }
        } catch (autoBillingErr) {
          console.error("[auto-billing] Failed to insert billing ledger row for emergency dispense, continuing:", autoBillingErr);
        }
      }

      // Fire billing webhooks for all billed entries (config lookup handled inside)
      try {
        for (const billingId of billingIds) {
          const [entry] = await db.select().from(billingLedger).where(eq(billingLedger.id, billingId)).limit(1);
          if (entry) {
            await enqueueBillingWebhookJob({
              clinicId,
              entry: {
                id: entry.id,
                animalId: entry.animalId,
                itemType: entry.itemType,
                itemId: entry.itemId,
                quantity: entry.quantity,
                unitPriceCents: entry.unitPriceCents,
                totalAmountCents: entry.totalAmountCents,
                status: entry.status,
                createdAt: entry.createdAt,
              },
            });
          }
        }
      } catch (webhookErr) {
        console.error("[billing-webhook] Failed to enqueue webhook for emergency dispense, continuing:", webhookErr);
      }

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
          autoBilledCents: billingIds.length,
          animalId: animalId ?? null,
          isEmergency: true,
        },
      });

      return res.json({
        success: true,
        dispensed: dispensedItems,
        takenBy: { userId: actorUserId, displayName: actorDisplayName },
        takenAt: takenAt.toISOString(),
        billingIds,
      });
    } catch (err: unknown) {
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
  },
);

export default router;
