import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, crashCartChecks, crashCartItems, hospitalizations, animals } from "../db.js";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();

function apiError(p: { code: string; reason: string; message: string; requestId: string }) {
  return { code: p.code, error: p.code, reason: p.reason, message: p.message, requestId: p.requestId };
}

function resolveRequestId(
  res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

const checkItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  checked: z.boolean(),
});

const submitCheckSchema = z.object({
  items: z.array(checkItemSchema).min(1).max(50),
  notes: z.string().max(500).optional(),
});

const createItemSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, "key must be lowercase alphanumeric with underscores"),
  label: z.string().min(1).max(300),
  requiredQty: z.number().int().min(1).optional().default(1),
  expiryWarnDays: z.number().int().min(1).optional().nullable(),
});

const updateItemSchema = z.object({
  label: z.string().min(1).max(300).optional(),
  requiredQty: z.number().int().min(1).optional(),
  expiryWarnDays: z.number().int().min(1).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

const DEFAULT_ITEMS = [
  { key: "defibrillator", label: "דפיברילטור — טעון ומוכן",    sortOrder: 0 },
  { key: "oxygen",        label: "חמצן — מחובר ופתוח",          sortOrder: 1 },
  { key: "iv_line",       label: "עירוי IV — מוכן (קו פתוח)",   sortOrder: 2 },
  { key: "epinephrine",   label: "אפינפרין — זמין ולא פג תוקף", sortOrder: 3 },
  { key: "atropine",      label: "אטרופין — זמין ולא פג תוקף",  sortOrder: 4 },
  { key: "vasopressin",   label: "וזופרסין — זמין ולא פג תוקף", sortOrder: 5 },
  { key: "ambu",          label: "אמבו — מוכן ונקי",            sortOrder: 6 },
  { key: "suction",       label: "ציוד שאיבה — תקין",           sortOrder: 7 },
];

// GET /api/crash-cart/items — list active items for clinic (auto-seeds if empty)
router.get("/items", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    // Auto-seed if no items exist yet for this clinic
    const existing = await db
      .select()
      .from(crashCartItems)
      .where(eq(crashCartItems.clinicId, clinicId))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(crashCartItems).values(
        DEFAULT_ITEMS.map((item) => ({
          id: randomUUID(),
          clinicId,
          key: item.key,
          label: item.label,
          requiredQty: 1,
          expiryWarnDays: null,
          sortOrder: item.sortOrder,
          active: true,
        }))
      ).onConflictDoNothing();
    }

    const items = await db
      .select()
      .from(crashCartItems)
      .where(and(eq(crashCartItems.clinicId, clinicId), eq(crashCartItems.active, true)))
      .orderBy(asc(crashCartItems.sortOrder));

    res.json(items);
  } catch (err) {
    console.error("[crash-cart] list items failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "LIST_ITEMS_FAILED", message: "Failed to list items", requestId }));
  }
});

// POST /api/crash-cart/items — create a new item (admin only)
router.post("/items", requireAuth, requireAdmin, validateBody(createItemSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const body = req.body as z.infer<typeof createItemSchema>;

    // Determine next sort_order
    const rows = await db
      .select({ sortOrder: crashCartItems.sortOrder })
      .from(crashCartItems)
      .where(eq(crashCartItems.clinicId, clinicId))
      .orderBy(desc(crashCartItems.sortOrder))
      .limit(1);
    const nextOrder = rows.length > 0 ? rows[0].sortOrder + 1 : 0;

    const id = randomUUID();
    const [created] = await db.insert(crashCartItems).values({
      id,
      clinicId,
      key: body.key,
      label: body.label,
      requiredQty: body.requiredQty ?? 1,
      expiryWarnDays: body.expiryWarnDays ?? null,
      sortOrder: nextOrder,
      active: true,
    }).returning();

    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("uq_crash_cart_item_key")) {
      return res.status(409).json(apiError({ code: "KEY_EXISTS", reason: "KEY_EXISTS", message: "An item with that key already exists", requestId }));
    }
    console.error("[crash-cart] create item failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "CREATE_ITEM_FAILED", message: "Failed to create item", requestId }));
  }
});

// PATCH /api/crash-cart/items/:id — update item (admin only)
router.patch("/items/:id", requireAuth, requireAdmin, validateBody(updateItemSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id } = req.params;
    const body = req.body as z.infer<typeof updateItemSchema>;

    const [updated] = await db
      .update(crashCartItems)
      .set({
        ...(body.label !== undefined && { label: body.label }),
        ...(body.requiredQty !== undefined && { requiredQty: body.requiredQty }),
        ...(body.expiryWarnDays !== undefined && { expiryWarnDays: body.expiryWarnDays }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      })
      .where(and(eq(crashCartItems.id, id), eq(crashCartItems.clinicId, clinicId)))
      .returning();

    if (!updated) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ITEM_NOT_FOUND", message: "Item not found", requestId }));
    }
    res.json(updated);
  } catch (err) {
    console.error("[crash-cart] update item failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "UPDATE_ITEM_FAILED", message: "Failed to update item", requestId }));
  }
});

// DELETE /api/crash-cart/items/:id — soft-delete item (admin only)
router.delete("/items/:id", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { id } = req.params;

    const [deactivated] = await db
      .update(crashCartItems)
      .set({ active: false })
      .where(and(eq(crashCartItems.id, id), eq(crashCartItems.clinicId, clinicId)))
      .returning();

    if (!deactivated) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ITEM_NOT_FOUND", message: "Item not found", requestId }));
    }
    res.status(204).send();
  } catch (err) {
    console.error("[crash-cart] delete item failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "DELETE_ITEM_FAILED", message: "Failed to delete item", requestId }));
  }
});

// POST /api/crash-cart/checks — submit a daily check
router.post("/checks", requireAuth, validateBody(submitCheckSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { items, notes } = req.body as z.infer<typeof submitCheckSchema>;

    const allPassed = items.every((item) => item.checked);

    const id = randomUUID();
    await db.insert(crashCartChecks).values({
      id,
      clinicId,
      performedByUserId: req.authUser!.id,
      performedByName: req.authUser!.name,
      itemsChecked: items,
      allPassed,
      notes: notes ?? null,
    });

    res.status(201).json({ id, allPassed });
  } catch (err) {
    console.error("[crash-cart] submit check failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "CRASH_CART_SUBMIT_FAILED", message: "Failed to save check", requestId }));
  }
});

// GET /api/crash-cart/checks/latest — last check + recent history + high-risk patients
router.get("/checks/latest", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    // Last 7 checks
    const recentChecks = await db
      .select()
      .from(crashCartChecks)
      .where(eq(crashCartChecks.clinicId, clinicId))
      .orderBy(desc(crashCartChecks.performedAt))
      .limit(7);

    // High-risk patients: active hospitalizations with status='critical'
    const criticalPatients = await db
      .select({
        hospitalizationId: hospitalizations.id,
        ward: hospitalizations.ward,
        bay: hospitalizations.bay,
        animalId: animals.id,
        animalName: animals.name,
        species: animals.species,
        weightKg: animals.weightKg,
      })
      .from(hospitalizations)
      .innerJoin(animals, eq(animals.id, hospitalizations.animalId))
      .where(
        and(
          eq(hospitalizations.clinicId, clinicId),
          sql`${hospitalizations.status} = 'critical'`,
          sql`${hospitalizations.dischargedAt} IS NULL`,
        ),
      )
      .orderBy(hospitalizations.admittedAt);

    const latest = recentChecks[0] ?? null;
    const checkedToday = latest
      ? new Date(latest.performedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000
      : false;

    res.json({ latest, checkedToday, recentChecks, criticalPatients });
  } catch (err) {
    console.error("[crash-cart] get latest failed", err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "CRASH_CART_GET_FAILED", message: "Failed to get latest check", requestId }));
  }
});

export default router;
