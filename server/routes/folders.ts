import { Router } from "express";
import { randomUUID } from "crypto";
import { db, folders, equipment } from "../db.js";
import { eq, desc, and, isNull, lte } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { subDays } from "date-fns";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const router = Router();



router.get("/", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const allFolders = await db
      .select()
      .from(folders)
      .where(and(eq(folders.clinicId, clinicId), isNull(folders.deletedAt)))
      .orderBy(desc(folders.createdAt));

    const sevenDaysAgo = subDays(new Date(), 7);
    const sterilizationDueCount = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          lte(equipment.lastSterilizationDate, sevenDaysAgo),
          isNull(equipment.deletedAt),
        )
      );

    const smartFolders = [
      {
        id: "smart-sterilization-due",
        name: "Sterilization Due",
        type: "smart",
        color: "#14b8a6",
        count: sterilizationDueCount.length,
        createdAt: new Date().toISOString(),
      },
    ];

    res.json([...smartFolders, ...allFolders]);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "FOLDERS_LIST_FAILED",
        message: "טעינת התיקיות נכשלה",
        requestId,
      }),
    );
  }
});

router.post("/", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "FOLDER_NAME_REQUIRED",
          message: "שם הוא שדה חובה",
          requestId,
        }),
      );
    }

    const [folder] = await db
      .insert(folders)
      .values({ id: randomUUID(), clinicId, name: name.trim() })
      .returning();

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "folder_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: folder.id,
      targetType: "folder",
      metadata: { name: folder.name },
    });

    res.status(201).json(folder);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "FOLDER_CREATE_FAILED",
        message: "יצירת התיקייה נכשלה",
        requestId,
      }),
    );
  }
});

router.patch("/:id", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "FOLDER_NAME_REQUIRED",
          message: "שם הוא שדה חובה",
          requestId,
        }),
      );
    }

    const [existing] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, req.params.id), eq(folders.clinicId, clinicId)))
      .limit(1);

    const [folder] = await db
      .update(folders)
      .set({ name: name.trim() })
      .where(and(eq(folders.id, req.params.id), eq(folders.clinicId, clinicId), isNull(folders.deletedAt)))
      .returning();

    if (!folder) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "FOLDER_NOT_FOUND",
          message: "Folder not found",
          requestId,
        }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "folder_updated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: folder.id,
      targetType: "folder",
      metadata: { previousName: existing?.name, newName: folder.name },
    });

    res.json(folder);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "FOLDER_UPDATE_FAILED",
        message: "Failed to update folder",
        requestId,
      }),
    );
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, req.params.id), eq(folders.clinicId, clinicId)))
      .limit(1);

    const [deleted] = await db
      .update(folders)
      .set({ deletedAt: new Date(), deletedBy: req.authUser!.id })
      .where(and(eq(folders.id, req.params.id), eq(folders.clinicId, clinicId), isNull(folders.deletedAt)))
      .returning({ id: folders.id });

    if (!deleted) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "FOLDER_NOT_FOUND",
          message: "Folder not found",
          requestId,
        }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "folder_deleted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "folder",
      metadata: { name: existing?.name },
    });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "FOLDER_DELETE_FAILED",
        message: "Failed to delete folder",
        requestId,
      }),
    );
  }
});

export default router;
