import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { drugFormulary, inventoryItemPrices, inventoryItems, db, users } from "../db.js";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";

// TODO(constraint-handler): unify with db-constraint-errors.ts when adding inventory_items mappings (post-PR #366)

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

export const createItemSchema = z.object({
  code: z.string().min(1).max(100).regex(/^[A-Z0-9_\-]+$/i, "Code must be alphanumeric with underscores/hyphens"),
  label: z.string().min(1).max(200),
  itemType: z.enum(["DRUG", "CONSUMABLE", "EQUIPMENT"]).default("CONSUMABLE"),
  unit: z.string().min(1).max(30).optional().nullable(),
  category: z.string().max(100).optional(),
  nfcTagId: z.string().max(200).optional().nullable(),
  /** Required when itemType = 'DRUG'. Must reference an active formulary entry. */
  formularyId: z.string().uuid().optional().nullable(),
}).strict();

export const updateItemSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  itemType: z.enum(["DRUG", "CONSUMABLE", "EQUIPMENT"]).optional(),
  unit: z.string().min(1).max(30).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  nfcTagId: z.string().max(200).optional().nullable(),
  isBillable: z.boolean().optional(),
  minimumDispenseToCapture: z.number().int().min(1).optional(),
  formularyId: z.string().uuid().optional().nullable(),
}).strict();

export const addPriceSchema = z.object({
  contextType: z.enum(["CONTAINER", "USAGE", "GLOBAL"]),
  contextId: z.string().max(200).optional().nullable(),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).default("ILS"),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
}).strict();

/** Enforce DRUG ↔ formulary coupling at service level. */
async function resolveFormularyVersion(
  clinicId: string,
  itemType: string,
  formularyId: string | null | undefined,
): Promise<{ formularyId: string; formularyVersion: number } | null> {
  if (itemType === "DRUG") {
    if (!formularyId) {
      throw Object.assign(new Error("DRUG items must have a formularyId."), { statusCode: 400, code: "DRUG_REQUIRES_FORMULARY" });
    }
    const [formularyRow] = await db
      .select({ id: drugFormulary.id, version: drugFormulary.version, isActive: drugFormulary.isActive })
      .from(drugFormulary)
      .where(and(eq(drugFormulary.id, formularyId), eq(drugFormulary.clinicId, clinicId), isNull(drugFormulary.deletedAt)))
      .limit(1);
    if (!formularyRow) {
      throw Object.assign(new Error("Formulary entry not found."), { statusCode: 404, code: "FORMULARY_NOT_FOUND" });
    }
    if (!formularyRow.isActive) {
      throw Object.assign(new Error("Formulary entry is not active. Reference an active formulary version."), { statusCode: 409, code: "FORMULARY_INACTIVE" });
    }
    return { formularyId: formularyRow.id, formularyVersion: formularyRow.version };
  }
  if (formularyId) {
    throw Object.assign(new Error("formularyId must be null for non-DRUG items."), { statusCode: 400, code: "NON_DRUG_CANNOT_HAVE_FORMULARY" });
  }
  return null;
}

// GET /api/inventory-items — list active items for the clinic
router.get("/", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const includeInactive = req.query.includeInactive === "true";

    const conditions = [eq(inventoryItems.clinicId, clinicId)];
    if (!includeInactive) {
      conditions.push(eq(inventoryItems.isActive, true));
    }

    const rows = await db
      .select()
      .from(inventoryItems)
      .where(and(...conditions))
      .orderBy(asc(inventoryItems.label));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ITEMS_LIST_FAILED", message: "Failed to list inventory items", requestId }),
    );
  }
});

// POST /api/inventory-items — create item
router.post("/", requireAuth, requireAdmin, validateBody(createItemSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const b = req.body as z.infer<typeof createItemSchema>;
    const id = randomUUID();

    const formularyRef = await resolveFormularyVersion(clinicId, b.itemType, b.formularyId).catch((err) => {
      const e = err as { statusCode?: number; code?: string; message?: string };
      res.status(e.statusCode ?? 400).json(
        apiError({ code: e.code ?? "VALIDATION_ERROR", reason: e.code ?? "VALIDATION_ERROR", message: e.message ?? "Validation failed", requestId }),
      );
      return undefined;
    });
    if (formularyRef === undefined && b.itemType === "DRUG") return;

    await db.insert(inventoryItems).values({
      id,
      clinicId,
      code: b.code.trim().toUpperCase(),
      label: b.label.trim(),
      itemType: b.itemType,
      unit: b.unit?.trim() || null,
      category: b.category?.trim() || null,
      nfcTagId: b.nfcTagId?.trim() || null,
      formularyId: formularyRef?.formularyId ?? null,
      formularyVersion: formularyRef?.formularyVersion ?? null,
      isActive: true,
    });

    const [row] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "inventory_item_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: id,
      targetType: "inventory_item",
      metadata: {
        code: b.code.trim().toUpperCase(),
        label: b.label.trim(),
        itemType: b.itemType,
        unit: b.unit ?? null,
        formularyId: formularyRef?.formularyId ?? null,
        formularyVersion: formularyRef?.formularyVersion ?? null,
      },
    });

    res.status(201).json(row);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === "23505") {
      return res.status(409).json(
        apiError({ code: "CONFLICT", reason: "CODE_EXISTS", message: "An item with this code already exists", requestId }),
      );
    }
    if (pgErr?.code === "23514") {
      return res.status(400).json(
        apiError({ code: "DRUG_FORMULARY_CONSTRAINT", reason: "DRUG_FORMULARY_CONSTRAINT", message: "DRUG items require formularyId and formularyVersion; non-DRUG items must not have them", requestId }),
      );
    }
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ITEM_CREATE_FAILED", message: "Failed to create inventory item", requestId }),
    );
  }
});

// PATCH /api/inventory-items/:id — update fields
router.patch("/:id", requireAuth, requireAdmin, validateUuid("id"), validateBody(updateItemSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const b = req.body as z.infer<typeof updateItemSchema>;

    const [existing] = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, req.params.id)))
      .limit(1);

    if (!existing) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ITEM_NOT_FOUND", message: "Inventory item not found", requestId }));

    const resolvedType = b.itemType ?? existing.itemType;
    const resolvedFormuaryId = b.formularyId !== undefined ? b.formularyId : existing.formularyId;

    const formularyRef = await resolveFormularyVersion(clinicId, resolvedType, resolvedFormuaryId).catch((err) => {
      const e = err as { statusCode?: number; code?: string; message?: string };
      res.status(e.statusCode ?? 400).json(
        apiError({ code: e.code ?? "VALIDATION_ERROR", reason: e.code ?? "VALIDATION_ERROR", message: e.message ?? "Validation failed", requestId }),
      );
      return undefined;
    });
    if (formularyRef === undefined && resolvedType === "DRUG") return;

    const updates: Record<string, unknown> = {};
    if (b.label !== undefined) updates.label = b.label.trim();
    if (b.itemType !== undefined) updates.itemType = b.itemType;
    if (b.unit !== undefined) updates.unit = b.unit?.trim() || null;
    if (b.category !== undefined) updates.category = b.category?.trim() || null;
    if (b.nfcTagId !== undefined) updates.nfcTagId = b.nfcTagId?.trim() || null;
    if (b.isBillable !== undefined) updates.isBillable = b.isBillable;
    if (b.minimumDispenseToCapture !== undefined) updates.minimumDispenseToCapture = b.minimumDispenseToCapture;
    if (formularyRef != null) {
      updates.formularyId = formularyRef.formularyId;
      updates.formularyVersion = formularyRef.formularyVersion;
    } else if (resolvedType !== "DRUG") {
      updates.formularyId = null;
      updates.formularyVersion = null;
    }

    await db.update(inventoryItems).set(updates).where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, req.params.id)));
    const [updated] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, req.params.id)).limit(1);

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "inventory_item_updated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "inventory_item",
      metadata: { changes: updates, code: existing.code },
    });

    res.json(updated);
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === "23514") {
      return res.status(400).json(
        apiError({ code: "DRUG_FORMULARY_CONSTRAINT", reason: "DRUG_FORMULARY_CONSTRAINT", message: "DRUG items require formularyId; non-DRUG items must not have one", requestId }),
      );
    }
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ITEM_UPDATE_FAILED", message: "Failed to update inventory item", requestId }),
    );
  }
});

/**
 * PATCH /api/inventory-items/:id/deactivate — soft-delete (Fix A).
 * Replaces the previous hard DELETE endpoint.
 * Inactive items remain in history but cannot be used in new operations.
 */
router.patch("/:id/deactivate", requireAuth, requireAdmin, validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, req.params.id)))
      .limit(1);

    if (!existing) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ITEM_NOT_FOUND", message: "Inventory item not found", requestId }));
    if (!existing.isActive) return res.status(409).json(apiError({ code: "ALREADY_INACTIVE", reason: "ALREADY_INACTIVE", message: "Item is already inactive", requestId }));

    await db.update(inventoryItems).set({ isActive: false }).where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, req.params.id)));

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "inventory_item_deactivated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "inventory_item",
      metadata: { code: existing.code, label: existing.label, itemType: existing.itemType },
    });

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ITEM_DEACTIVATE_FAILED", message: "Failed to deactivate inventory item", requestId }),
    );
  }
});

/**
 * POST /api/inventory-items/:id/prices — add a context-specific price entry.
 * Supports context types: CONTAINER, USAGE, GLOBAL.
 */
router.post("/:id/prices", requireAuth, requireAdmin, validateUuid("id"), validateBody(addPriceSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const b = req.body as z.infer<typeof addPriceSchema>;

    const [item] = await db
      .select({ id: inventoryItems.id, isActive: inventoryItems.isActive })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, req.params.id)))
      .limit(1);

    if (!item) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ITEM_NOT_FOUND", message: "Inventory item not found", requestId }));

    const priceId = randomUUID();
    await db.insert(inventoryItemPrices).values({
      id: priceId,
      clinicId,
      itemId: req.params.id,
      contextType: b.contextType,
      contextId: b.contextId?.trim() || null,
      priceCents: b.priceCents,
      currency: b.currency,
      effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom) : new Date(),
      createdBy: req.authUser!.id,
      createdAt: new Date(),
    });

    const [price] = await db.select().from(inventoryItemPrices).where(eq(inventoryItemPrices.id, priceId)).limit(1);

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "inventory_item_price_added",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: priceId,
      targetType: "inventory_item_price",
      metadata: {
        itemId: req.params.id,
        contextType: b.contextType,
        contextId: b.contextId ?? null,
        priceCents: b.priceCents,
        currency: b.currency,
      },
    });

    res.status(201).json(price);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "PRICE_ADD_FAILED", message: "Failed to add price", requestId }),
    );
  }
});

// GET /api/inventory-items/:id/prices — list all prices for an item
router.get("/:id/prices", requireAuth, requireEffectiveRole("technician"), validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const prices = await db
      .select()
      .from(inventoryItemPrices)
      .where(and(eq(inventoryItemPrices.clinicId, clinicId), eq(inventoryItemPrices.itemId, req.params.id)));
    res.json(prices);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "PRICES_LIST_FAILED", message: "Failed to list prices", requestId }),
    );
  }
});

export default router;
