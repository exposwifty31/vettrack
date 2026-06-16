import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { db, equipment, folders, rooms, users } from "../../../db.js";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";
import { equipmentLinkedAnimalSelect } from "../equipment-linked-animal-select.js";
import { equipmentOperationalStateSelect } from "../equipment-operational-select.js";
import { equipmentRfidSelect } from "../equipment-rfid-select.js";

/** Mirrors `EQUIPMENT_STATUS_VALUES` in `server/routes/equipment.ts` (PATCH/scan schemas). */
const EQUIPMENT_STATUS_VALUES = [
  "ok",
  "issue",
  "maintenance",
  "sterilized",
  "overdue",
  "inactive",
  "critical",
  "needs_attention",
] as const;

const EQUIPMENT_DEFAULT_PAGE_SIZE = 100;
const EQUIPMENT_MAX_PAGE_SIZE = 1000;

function buildEquipmentListEtag(parts: Record<string, string | number | null | undefined>): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
  return `W/"eq-${digest}"`;
}

function etagTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** GET /api/equipment — paginated list */
export const getEquipmentListHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawPage = parseInt(req.query.page as string, 10);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const folder = typeof req.query.folder === "string" ? req.query.folder.trim() : "";
    const location = typeof req.query.location === "string" ? req.query.location.trim() : "";

    const limit = (!isNaN(rawLimit) && rawLimit > 0)
      ? Math.min(rawLimit, EQUIPMENT_MAX_PAGE_SIZE)
      : EQUIPMENT_DEFAULT_PAGE_SIZE;
    const page = (!isNaN(rawPage) && rawPage > 1) ? rawPage : 1;
    const offset = (page - 1) * limit;

    const whereClauses = [eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)];

    if (q) {
      const pattern = `%${q}%`;
      const searchCondition = or(
        ilike(equipment.name, pattern),
        ilike(equipment.serialNumber, pattern),
        ilike(equipment.model, pattern),
        ilike(equipment.manufacturer, pattern),
        ilike(equipment.location, pattern),
        ilike(equipment.usuallyFoundHere, pattern),
        ilike(equipment.searchAlias, pattern),
      );
      if (searchCondition) whereClauses.push(searchCondition);
    }

    if (status && status !== "all" && EQUIPMENT_STATUS_VALUES.includes(status as typeof EQUIPMENT_STATUS_VALUES[number])) {
      whereClauses.push(eq(equipment.status, status as typeof EQUIPMENT_STATUS_VALUES[number]));
    }

    if (folder && folder !== "all") {
      if (folder === "unfiled") {
        whereClauses.push(isNull(equipment.folderId));
      } else {
        whereClauses.push(eq(equipment.folderId, folder));
      }
    }

    if (location && location !== "all") {
      const locationCondition = or(
        eq(equipment.location, location),
        eq(equipment.checkedOutLocation, location),
      );
      if (locationCondition) whereClauses.push(locationCondition);
    }

    const whereClause = and(...whereClauses);

    const baseQuery = db
      .select({
        id: equipment.id,
        name: equipment.name,
        serialNumber: equipment.serialNumber,
        model: equipment.model,
        manufacturer: equipment.manufacturer,
        purchaseDate: equipment.purchaseDate,
        expiryDate: equipment.expiryDate,
        expiryNotifiedAt: equipment.expiryNotifiedAt,
        location: equipment.location,
        folderId: equipment.folderId,
        folderName: folders.name,
        roomId: equipment.roomId,
        roomName: rooms.name,
        nfcTagId: equipment.nfcTagId,
        lastVerifiedAt: equipment.lastVerifiedAt,
        lastVerifiedById: equipment.lastVerifiedById,
        lastVerifiedByName: users.name,
        status: equipment.status,
        lastSeen: equipment.lastSeen,
        lastStatus: equipment.lastStatus,
        lastMaintenanceDate: equipment.lastMaintenanceDate,
        lastSterilizationDate: equipment.lastSterilizationDate,
        maintenanceIntervalDays: equipment.maintenanceIntervalDays,
        imageUrl: equipment.imageUrl,
        checkedOutById: equipment.checkedOutById,
        checkedOutByEmail: equipment.checkedOutByEmail,
        checkedOutAt: equipment.checkedOutAt,
        checkedOutLocation: equipment.checkedOutLocation,
        expectedReturnMinutes: equipment.expectedReturnMinutes,
        createdAt: equipment.createdAt,
        usuallyFoundHere: equipment.usuallyFoundHere,
        searchAlias: equipment.searchAlias,
        staffNote: equipment.staffNote,
        ...equipmentLinkedAnimalSelect,
        ...equipmentOperationalStateSelect,
        ...equipmentRfidSelect(clinicId),
      })
      .from(equipment)
      .leftJoin(folders, and(eq(equipment.folderId, folders.id), eq(folders.clinicId, clinicId), isNull(folders.deletedAt)))
      .leftJoin(rooms, and(eq(equipment.roomId, rooms.id), eq(rooms.clinicId, clinicId)))
      .leftJoin(users, and(eq(equipment.lastVerifiedById, users.id), eq(users.clinicId, clinicId)))
      .where(whereClause)
      // Stable sort key for pagination so pages do not duplicate/drop rows on equal createdAt.
      .orderBy(desc(equipment.createdAt), desc(equipment.id));

    const [aggregate] = await db
      .select({
        total: sql<number>`count(*)::int`,
        maxVersion: sql<number>`coalesce(max(${equipment.version}), 0)::int`,
        maxCreatedAt: sql<Date | null>`max(${equipment.createdAt})`,
        maxLastSeen: sql<Date | null>`max(${equipment.lastSeen})`,
      })
      .from(equipment)
      .where(whereClause);

    const total = aggregate?.total ?? 0;
    const etag = buildEquipmentListEtag({
      clinicId,
      q,
      status,
      folder,
      location,
      page,
      limit,
      total,
      maxVersion: aggregate?.maxVersion ?? 0,
      maxCreatedAt: etagTimestamp(aggregate?.maxCreatedAt),
      maxLastSeen: etagTimestamp(aggregate?.maxLastSeen),
    });

    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.setHeader("ETag", etag);
      res.status(304).end();
      return;
    }

    const items = await baseQuery.limit(limit).offset(offset);
    // Manual weak ETag — setHeader before res.json() prevents Express auto-etag on the body.
    res.setHeader("ETag", etag);
    res.json({ items, total, page, pageSize: limit, hasMore: offset + items.length < total });
  } catch (err) {
    console.error("[equipment-list] EQUIPMENT_LIST_FAILED", {
      requestId,
      clinicId: req.clinicId,
      err,
    });
    if (res.headersSent) return;
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_LIST_FAILED",
        message: "Failed to list equipment",
        requestId,
      }),
    );
  }
};
