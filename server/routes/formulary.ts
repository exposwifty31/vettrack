import { randomUUID } from "crypto";
import { Router } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, drugFormulary } from "../db.js";
import { normalizeJsonStringArray, syncFormularyFromSeed } from "../lib/formulary-seed-sync.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";

const router = Router();

const createOrUpsertFormularySchema = z.object({
  name: z.string().trim().min(1).max(200),
  genericName: z.string().trim().min(1).max(200),
  brandNames: z.array(z.string().trim().min(1)).max(50).optional(),
  targetSpecies: z.array(z.string().trim().min(1)).max(20).optional(),
  category: z.string().trim().max(120).optional().nullable(),
  dosageNotes: z.string().trim().max(2000).optional().nullable(),
  concentrationMgMl: z.number().finite().positive(),
  standardDose: z.number().finite().positive(),
  minDose: z.number().finite().positive().optional().nullable(),
  maxDose: z.number().finite().positive().optional().nullable(),
  doseUnit: z.enum(["mg_per_kg", "mcg_per_kg", "mEq_per_kg", "tablet"]),
  defaultRoute: z.string().trim().max(100).optional().nullable(),
  unitType: z.enum(["vial", "ampule", "tablet", "capsule", "bag"]).optional().nullable(),
  unitVolumeMl: z.number().finite().positive().optional().nullable(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  genericName: z.string().trim().min(1).max(200).optional(),
  brandNames: z.array(z.string().trim().min(1)).max(50).optional(),
  targetSpecies: z.array(z.string().trim().min(1)).max(20).optional().nullable(),
  category: z.string().trim().max(120).optional().nullable(),
  dosageNotes: z.string().trim().max(2000).optional().nullable(),
  concentrationMgMl: z.number().finite().positive().optional(),
  standardDose: z.number().finite().positive().optional(),
  minDose: z.number().finite().positive().optional().nullable(),
  maxDose: z.number().finite().positive().optional().nullable(),
  doseUnit: z.enum(["mg_per_kg", "mcg_per_kg", "mEq_per_kg", "tablet"]).optional(),
  defaultRoute: z.string().trim().max(100).optional().nullable(),
  unitType: z.enum(["vial", "ampule", "tablet", "capsule", "bag"]).optional().nullable(),
  unitVolumeMl: z.number().finite().positive().optional().nullable(),
});

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

function toResponseRow(row: typeof drugFormulary.$inferSelect) {
  return {
    id: row.id,
    clinicId: row.clinicId,
    name: row.name,
    genericName: row.genericName,
    brandNames: normalizeJsonStringArray(row.brandNames),
    targetSpecies: row.targetSpecies == null ? null : normalizeJsonStringArray(row.targetSpecies),
    category: row.category ?? null,
    dosageNotes: row.dosageNotes ?? null,
    concentrationMgMl: Number(row.concentrationMgMl),
    standardDose: Number(row.standardDose),
    minDose: row.minDose != null ? Number(row.minDose) : null,
    maxDose: row.maxDose != null ? Number(row.maxDose) : null,
    doseUnit: row.doseUnit as "mg_per_kg" | "mcg_per_kg" | "mEq_per_kg" | "tablet",
    defaultRoute: row.defaultRoute ?? null,
    unitType: row.unitType ?? null,
    unitVolumeMl: row.unitVolumeMl != null ? Number(row.unitVolumeMl) : null,
    version: row.version,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function seedDefaultsIfClinicHasNoRows(clinicId: string): Promise<void> {
  await syncFormularyFromSeed(clinicId);
}

router.get("/", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;

  try {
    try {
      await syncFormularyFromSeed(clinicId);
    } catch (err) {
      console.warn("[formulary] initial seed failed", {
        clinicId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const rows = await db
      .select()
      .from(drugFormulary)
      .where(
        and(
          eq(drugFormulary.clinicId, clinicId),
          isNull(drugFormulary.deletedAt),
          eq(drugFormulary.isActive, true),
        ),
      )
      .orderBy(asc(drugFormulary.name));

    return res.json(rows.map(toResponseRow));
  } catch (err) {
    console.error("[formulary] list failed", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "FORMULARY_LIST_FAILED",
        message: "Failed to list formulary",
        requestId,
      }),
    );
  }
});

router.post("/", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const parsed = createOrUpsertFormularySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "INVALID_FORMULARY_PAYLOAD",
        message: "Invalid formulary payload",
        requestId,
      }),
    );
  }

  const payload = parsed.data;
  const now = new Date();
  const normalizedName = payload.name.trim();
  const normalizedGeneric = payload.genericName.trim();
  const normalizedLowerGeneric = normalizedGeneric.toLowerCase();

  try {
    const [existing] = await db
      .select()
      .from(drugFormulary)
      .where(
        and(
          eq(drugFormulary.clinicId, clinicId),
          sql`lower(trim(${drugFormulary.genericName})) = ${normalizedLowerGeneric}`,
          eq(drugFormulary.concentrationMgMl, String(payload.concentrationMgMl)),
          isNull(drugFormulary.deletedAt),
        ),
      )
      .limit(1);

    if (existing && existing.isActive) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "FORMULARY_DUPLICATE_GENERIC_CONCENTRATION",
          message: "An active formulary entry already exists for this generic name and concentration",
          requestId,
        }),
      );
    }

    // Reactivate a soft-deleted entry by creating a new version
    const startVersion = existing ? existing.version + 1 : 1;

    const [created] = await db
      .insert(drugFormulary)
      .values({
        id: randomUUID(),
        clinicId,
        name: normalizedName,
        genericName: normalizedGeneric,
        brandNames: payload.brandNames ?? [],
        targetSpecies: payload.targetSpecies ?? null,
        category: payload.category ?? null,
        dosageNotes: payload.dosageNotes ?? null,
        concentrationMgMl: String(payload.concentrationMgMl),
        standardDose: String(payload.standardDose),
        minDose: payload.minDose != null ? String(payload.minDose) : null,
        maxDose: payload.maxDose != null ? String(payload.maxDose) : null,
        doseUnit: payload.doseUnit,
        defaultRoute: payload.defaultRoute ?? null,
        unitType: payload.unitType ?? null,
        unitVolumeMl: payload.unitVolumeMl != null ? String(payload.unitVolumeMl) : null,
        version: startVersion,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .returning();

    logAudit({
      clinicId,
      actionType: "formulary_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      actorRole: resolveAuditActorRole(req),
      targetId: created.id,
      targetType: "formulary",
      metadata: {
        genericName: normalizedGeneric,
        concentrationMgMl: payload.concentrationMgMl,
        standardDose: payload.standardDose,
        doseUnit: payload.doseUnit,
        version: created.version,
      },
    });

    return res.status(201).json(toResponseRow(created));
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "23505") {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "FORMULARY_DUPLICATE_GENERIC_CONCENTRATION",
          message: "An active formulary entry already exists for this generic name and concentration",
          requestId,
        }),
      );
    }
    console.error("[formulary] create failed", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "FORMULARY_UPSERT_FAILED",
        message: "Failed to save formulary entry",
        requestId,
      }),
    );
  }
});

/**
 * PATCH /:id — create a new version of a formulary entry.
 *
 * Fix E (versioning): the existing row is set to isActive=false; a new row is
 * inserted with version = old.version + 1, isActive = true, and all updated fields.
 * Old versions remain immutable and are never overwritten.
 */
router.patch("/:id", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const id = req.params.id?.trim();
  if (!id) {
    return res.status(400).json(
      apiError({ code: "VALIDATION_FAILED", reason: "MISSING_ID_PARAM", message: "id param is required", requestId }),
    );
  }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(
      apiError({ code: "VALIDATION_FAILED", reason: "INVALID_FORMULARY_PAYLOAD", message: "Invalid patch payload", requestId }),
    );
  }

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return res.status(400).json(
      apiError({ code: "VALIDATION_FAILED", reason: "EMPTY_PATCH", message: "No fields to update", requestId }),
    );
  }

  try {
    const [existing] = await db
      .select()
      .from(drugFormulary)
      .where(and(eq(drugFormulary.id, id), eq(drugFormulary.clinicId, clinicId), isNull(drugFormulary.deletedAt), eq(drugFormulary.isActive, true)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "FORMULARY_NOT_FOUND", message: "Formulary entry not found", requestId }),
      );
    }

    const now = new Date();
    const newRow = await db.transaction(async (tx) => {
      // Retire current version
      await tx
        .update(drugFormulary)
        .set({ isActive: false, updatedAt: now })
        .where(and(eq(drugFormulary.id, id), eq(drugFormulary.clinicId, clinicId)));

      // Insert new version with updated fields
      const [newEntry] = await tx
        .insert(drugFormulary)
        .values({
          id: randomUUID(),
          clinicId,
          name: patch.name?.trim() ?? existing.name,
          genericName: patch.genericName?.trim() ?? existing.genericName,
          brandNames: patch.brandNames ?? (existing.brandNames as string[]),
          targetSpecies: "targetSpecies" in patch ? (patch.targetSpecies ?? null) : existing.targetSpecies,
          category: "category" in patch ? (patch.category ?? null) : existing.category,
          dosageNotes: "dosageNotes" in patch ? (patch.dosageNotes ?? null) : existing.dosageNotes,
          concentrationMgMl: patch.concentrationMgMl !== undefined
            ? String(patch.concentrationMgMl)
            : existing.concentrationMgMl,
          standardDose: patch.standardDose !== undefined ? String(patch.standardDose) : existing.standardDose,
          minDose: "minDose" in patch
            ? (patch.minDose != null ? String(patch.minDose) : null)
            : existing.minDose,
          maxDose: "maxDose" in patch
            ? (patch.maxDose != null ? String(patch.maxDose) : null)
            : existing.maxDose,
          doseUnit: patch.doseUnit ?? existing.doseUnit,
          defaultRoute: "defaultRoute" in patch ? (patch.defaultRoute ?? null) : existing.defaultRoute,
          unitType: "unitType" in patch ? (patch.unitType ?? null) : existing.unitType,
          unitVolumeMl: "unitVolumeMl" in patch
            ? (patch.unitVolumeMl != null ? String(patch.unitVolumeMl) : null)
            : existing.unitVolumeMl,
          version: existing.version + 1,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .returning();

      return newEntry;
    });

    logAudit({
      clinicId,
      actionType: "formulary_version_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      actorRole: resolveAuditActorRole(req),
      targetId: newRow.id,
      targetType: "formulary",
      metadata: {
        supersededId: id,
        previousVersion: existing.version,
        newVersion: newRow.version,
        previousValues: {
          standardDose: existing.standardDose,
          concentrationMgMl: existing.concentrationMgMl,
          minDose: existing.minDose,
          maxDose: existing.maxDose,
          doseUnit: existing.doseUnit,
          defaultRoute: existing.defaultRoute,
        },
        patchedFields: Object.keys(patch),
      },
    });

    return res.json(toResponseRow(newRow));
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "23505") {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "FORMULARY_DUPLICATE_GENERIC_CONCENTRATION",
          message: "Update would duplicate generic name and concentration",
          requestId,
        }),
      );
    }
    console.error("[formulary] patch failed", err);
    return res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "FORMULARY_PATCH_FAILED", message: "Failed to update formulary entry", requestId }),
    );
  }
});

router.delete("/:id", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const id = req.params.id?.trim();
  if (!id) {
    return res.status(400).json(
      apiError({ code: "VALIDATION_FAILED", reason: "MISSING_ID_PARAM", message: "id param is required", requestId }),
    );
  }

  try {
    const [deleted] = await db
      .update(drugFormulary)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(drugFormulary.id, id),
          eq(drugFormulary.clinicId, clinicId),
          isNull(drugFormulary.deletedAt),
          eq(drugFormulary.isActive, true),
        ),
      )
      .returning({ id: drugFormulary.id, genericName: drugFormulary.genericName, version: drugFormulary.version });

    if (!deleted) {
      return res.status(404).json(
        apiError({ code: "NOT_FOUND", reason: "FORMULARY_NOT_FOUND", message: "Formulary entry not found", requestId }),
      );
    }

    logAudit({
      clinicId,
      actionType: "formulary_deleted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      actorRole: resolveAuditActorRole(req),
      targetId: id,
      targetType: "formulary",
      metadata: {
        genericName: deleted.genericName,
        version: deleted.version,
      },
    });

    return res.status(204).send();
  } catch (err) {
    console.error("[formulary] delete failed", err);
    return res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "FORMULARY_DELETE_FAILED", message: "Failed to delete formulary entry", requestId }),
    );
  }
});

export default router;
