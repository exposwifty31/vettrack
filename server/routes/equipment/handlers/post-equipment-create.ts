import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, equipment } from "../../../db.js";
import { invalidateAnalyticsCache } from "../../../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

/** POST /api/equipment */
export const postEquipmentCreateHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const {
      name,
      nameHe,
      serialNumber,
      model,
      manufacturer,
      purchaseDate,
      expiryDate,
      location,
      folderId,
      roomId,
      nfcTagId,
      rfidTagEpc,
      maintenanceIntervalDays,
      expectedReturnMinutes,
      imageUrl,
      usuallyFoundHere,
      searchAlias,
      staffNote,
    } = req.body as {
      name: string;
      nameHe?: string | null;
      serialNumber?: string;
      model?: string;
      manufacturer?: string;
      purchaseDate?: string | null;
      expiryDate?: string | null;
      location?: string;
      folderId?: string | null;
      roomId?: string | null;
      nfcTagId?: string | null;
      rfidTagEpc?: string | null;
      maintenanceIntervalDays?: number | null;
      expectedReturnMinutes?: number | null;
      imageUrl?: string | null;
      usuallyFoundHere?: string | null;
      searchAlias?: string | null;
      staffNote?: string | null;
    };

    if (expectedReturnMinutes !== undefined && req.authUser?.role !== "admin") {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "EXPECTED_RETURN_MINUTES_ADMIN_ONLY",
          message: "Only admins can set expected return minutes",
          requestId,
        }),
      );
    }

    const createdAt = new Date();
    const [item] = await db
      .insert(equipment)
      .values({
        id: randomUUID(),
        clinicId,
        name: name.trim(),
        nameHe: nameHe?.trim() || null,
        serialNumber: serialNumber ?? null,
        model: model ?? null,
        manufacturer: manufacturer ?? null,
        purchaseDate: purchaseDate ?? null,
        expiryDate: expiryDate ?? null,
        expiryNotifiedAt: null,
        location: location ?? null,
        folderId: folderId ?? null,
        roomId: roomId ?? null,
        nfcTagId: nfcTagId ?? null,
        rfidTagEpc: rfidTagEpc?.trim() || null,
        maintenanceIntervalDays: maintenanceIntervalDays ?? null,
        expectedReturnMinutes: expectedReturnMinutes ?? null,
        imageUrl: imageUrl ?? null,
        usuallyFoundHere: usuallyFoundHere ?? null,
        searchAlias: searchAlias ?? null,
        staffNote: staffNote ?? null,
        status: "ok",
        custodyState: "returned",
        custodyStateSince: createdAt,
        readinessState: "unknown",
        readinessStateSince: createdAt,
      })
      .returning();

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: item.id,
      targetType: "equipment",
      metadata: { name: item.name, serialNumber: item.serialNumber },
    });

    invalidateAnalyticsCache(clinicId);
    res.status(201).json(item);
  } catch (err) {
    console.error("Validation error:", err);
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_CREATE_FAILED",
        message: "Failed to create equipment",
        requestId,
      }),
    );
  }
};
