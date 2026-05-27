import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { z } from "zod";
import { db, equipment, equipmentReturns, folders, rooms, scanLogs, transferLogs, undoTokens, users, stagingQueue, assetTypeConditions, unitConditionStates } from "../db.js";
import { eq, inArray, desc, asc, and, or, ilike, lt, gte, sql, isNull, isNotNull } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { scanLimiter, checkoutLimiter, writeLimiter } from "../middleware/rate-limiters.js";
import { checkDedupe, sendPushToAll } from "../lib/push.js";
import { invalidateAnalyticsCache } from "../lib/analytics-cache.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { trackSyncSuccess, trackSyncFail } from "../lib/sync-metrics.js";
import { scheduleSmartReturnReminder, cancelSmartReturnReminder } from "../lib/role-notification-scheduler.js";
import { recordEquipmentSeen } from "../lib/equipment-seen.js";
import { getPilotStaleMs } from "../lib/pilot-config.js";
import { computeBundleReadinessGate } from "../services/equipment-operational-state.service.js";
import { recordOperationalMetric } from "../services/operational-metrics.service.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { apiError as apiErrorI18n } from "../lib/apiError.js";
import { enqueueChargeAlertJob } from "../workers/chargeAlertWorker.js";
import { promoteStagingQueueNext } from "../lib/staging-promotion.js";
import { notifyWaitlistPromoted } from "../lib/equipment-waitlist-promotion.js";
import {
  assertCheckoutAllowedForWaitlist,
  EquipmentWaitlistError,
  fulfillWaitlistOnCheckout,
  getActiveNotifiedUserId,
  promoteNextWaitlistInTx,
} from "../services/equipment-waitlist.service.js";
import type { EquipmentWaitlistRow } from "../db.js";
import { mountEquipmentWaitlistRoutes } from "./equipment-waitlist.js";
import { EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS } from "../lib/equipment-replay-idempotency.js";
import { equipmentReplayIdempotency } from "../middleware/equipment-replay-idempotency.js";

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

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isoDateOnlySchema = z.string().refine((value) => {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}, "Date must be a valid ISO date string (YYYY-MM-DD)");

const createEquipmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(500),
  serialNumber: z.string().max(500).optional(),
  model: z.string().max(500).optional(),
  manufacturer: z.string().max(500).optional(),
  purchaseDate: z.string().optional().nullable(),
  expiryDate: isoDateOnlySchema.optional().nullable(),
  location: z.string().max(500).optional(),
  folderId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  nfcTagId: z.string().max(500).optional().nullable(),
  rfidTagEpc: z.string().max(128).optional().nullable(),
  maintenanceIntervalDays: z.number().int().positive().optional().nullable(),
  expectedReturnMinutes: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().max(500).optional().nullable(),
  usuallyFoundHere: z.string().max(200).optional().nullable(),
  searchAlias: z.string().max(200).optional().nullable(),
  staffNote: z.string().max(500).optional().nullable(),
});

const patchEquipmentSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  serialNumber: z.string().max(500).optional(),
  model: z.string().max(500).optional(),
  manufacturer: z.string().max(500).optional(),
  purchaseDate: z.string().optional().nullable(),
  expiryDate: isoDateOnlySchema.optional().nullable(),
  location: z.string().max(500).optional(),
  folderId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  nfcTagId: z.string().max(500).optional().nullable(),
  rfidTagEpc: z.string().max(128).optional().nullable(),
  maintenanceIntervalDays: z.number().int().positive().optional().nullable(),
  expectedReturnMinutes: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().max(500).optional().nullable(),
  usuallyFoundHere: z.string().max(200).optional().nullable(),
  searchAlias: z.string().max(200).optional().nullable(),
  staffNote: z.string().max(500).optional().nullable(),
  status: z.enum(EQUIPMENT_STATUS_VALUES).optional(),
  /** Optimistic concurrency: the row `version` the client last loaded.
   *  When supplied, the PATCH is rejected 409 if the row moved on. */
  version: z.number().int().nonnegative().optional(),
});

const bulkVerifyRoomSchema = z.object({
  roomId: z.string().min(1, "roomId is required"),
});

export const checkoutSchema = z.object({
  location: z.string().max(500).optional(),
  emergencyReason: z.string().min(1).max(500).optional(),
}).strict();

export const scanSchema = z.object({
  status: z.enum(EQUIPMENT_STATUS_VALUES),
  note: z.string().trim().max(500).optional(),
  photoUrl: z.string().max(500).optional(),
}).strict();

const PLUG_IN_DEADLINE_MAX_MINUTES = 1440;
const PLUG_IN_DEADLINE_DEFAULT_MINUTES = 30;

/** Optional body for POST /:id/return — enables offline replay of plug-in charge tracking. */
export const equipmentReturnBodySchema = z.object({
  isPluggedIn: z.boolean().optional(),
  plugInDeadlineMinutes: z.number().int().min(1).max(PLUG_IN_DEADLINE_MAX_MINUTES).optional(),
}).strict();

const revertSchema = z.object({
  undoToken: z.string().min(1, "undoToken is required"),
});

const seenSchema = z.object({
  roomId: z.string().uuid().optional().nullable(),
  packageCode: z.enum(["fluid_protocol"]).optional().nullable(),
  /** Caller may pass the scanLogId from a checkout scan to link billing back to the care event. */
  scanLogId: z.string().uuid().optional().nullable(),
});

// Body schema for the top-level POST /scan alias (accepts any string ID, not UUID-only).
const quickScanBodySchema = z.object({
  equipmentId: z.string().min(1).max(100),
});

const bulkIdsSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

const bulkMoveSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  folderId: z.string().optional().nullable(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.mimetype === "text/plain" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
});

/*
 * PERMISSIONS MATRIX — /api/equipment
 * ─────────────────────────────────────────────────────
 * GET  /                  student+      List all equipment
 * GET  /critical          student+      List critical/needs-attention equipment
 * GET  /my                student+      List equipment checked out by current user
 * GET  /:id               student+      Get single equipment item
 * GET  /:id/logs          student+      Scan log history for item
 * GET  /:id/transfers     student+      Transfer log history for item
 * POST /                  technician+   Create new equipment
 * POST /import            admin-only    Bulk CSV import
 * POST /bulk-delete       admin-only    Bulk delete
 * POST /bulk-move         technician+   Bulk folder move
 * POST /:id/scan          student+      Record a scan/status update (student baseline per stabilization plan)
 * POST /:id/checkout      student+      Check out equipment (authenticated; student role allowed)
 * POST /:id/return        student+      Return equipment
 * POST /:id/revert        vet+          Undo last scan within window
 * PATCH /:id              technician+   Edit equipment metadata
 * DELETE /:id             admin-only    Delete single equipment item
 * ─────────────────────────────────────────────────────
 */

const router = Router();

function resolveRequestId(
  res: { getHeader: (name: string) => unknown; setHeader?: (name: string, value: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }
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

const _parsedUndoTtl = parseInt(process.env.UNDO_TTL_MS ?? "", 10);
const UNDO_TTL_MS = Number.isFinite(_parsedUndoTtl) && _parsedUndoTtl > 0 ? _parsedUndoTtl : 90_000;
const FIELD_MAX_LENGTH = 500;

type EquipmentRow = typeof equipment.$inferSelect;

interface EquipmentPreviousState {
  status: string;
  lastSeen: Date | string | null;
  lastStatus: string | null;
  lastMaintenanceDate: Date | string | null;
  lastSterilizationDate: Date | string | null;
  checkedOutById: string | null;
  checkedOutByEmail: string | null;
  checkedOutAt: Date | string | null;
  checkedOutLocation: string | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function cleanExpiredUndoTokens(): Promise<void> {
  try {
    await db.delete(undoTokens).where(lt(undoTokens.expiresAt, new Date()));
  } catch {
  }
}

async function insertUndoToken(
  tx: Tx,
  params: {
    clinicId: string;
    equipmentId: string;
    actorId: string;
    scanLogId: string;
    previousState: EquipmentPreviousState;
  }
): Promise<string> {
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + UNDO_TTL_MS);
  await tx.insert(undoTokens).values({
    id: tokenId,
    clinicId: params.clinicId,
    equipmentId: params.equipmentId,
    actorId: params.actorId,
    scanLogId: params.scanLogId,
    previousState: JSON.stringify(params.previousState),
    expiresAt,
  });
  return tokenId;
}

async function consumeUndoToken(
  clinicId: string,
  tokenId: string,
  equipmentId: string,
  actorId: string
): Promise<{ scanLogId: string; previousState: EquipmentPreviousState } | null> {
  const [entry] = await db
    .update(undoTokens)
    .set({ consumed: true } as Partial<typeof undoTokens.$inferInsert>)
    .where(
      and(
        eq(undoTokens.clinicId, clinicId),
        eq(undoTokens.id, tokenId),
        eq(undoTokens.equipmentId, equipmentId),
        eq(undoTokens.actorId, actorId),
        sql`consumed = false`,
        sql`expires_at > NOW()`
      )
    )
    .returning();

  if (!entry) return null;

  return {
    scanLogId: entry.scanLogId,
    previousState: JSON.parse(entry.previousState) as EquipmentPreviousState,
  };
}

function snapshotState(row: EquipmentRow): EquipmentPreviousState {
  return {
    status: row.status,
    lastSeen: row.lastSeen,
    lastStatus: row.lastStatus,
    lastMaintenanceDate: row.lastMaintenanceDate,
    lastSterilizationDate: row.lastSterilizationDate,
    checkedOutById: row.checkedOutById,
    checkedOutByEmail: row.checkedOutByEmail,
    checkedOutAt: row.checkedOutAt,
    checkedOutLocation: row.checkedOutLocation,
  };
}

class CheckoutConflictError extends Error {
  checkedOutByEmail: string;
  constructor(email: string) {
    super("CHECKOUT_CONFLICT");
    this.checkedOutByEmail = email;
  }
}

/** V1 operational state columns returned on list/detail reads for deployability UI. */
const equipmentOperationalStateSelect = {
  custodyState: equipment.custodyState,
  readinessState: equipment.readinessState,
  usageState: equipment.usageState,
  assetTypeId: equipment.assetTypeId,
  dockId: equipment.dockId,
} as const;

/** Advisory RFID doorway fields (read-only signal; never mutates authoritative roomId). */
function equipmentRfidSelect(clinicId: string) {
  return {
    rfidTagEpc: equipment.rfidTagEpc,
    lastRfidSeenAt: equipment.lastRfidSeenAt,
    lastRfidRoomId: equipment.lastRfidRoomId,
    lastRfidGatewayCode: equipment.lastRfidGatewayCode,
    lastRfidRoomName: sql<string | null>`(
      SELECT r.name FROM vt_rooms r
      WHERE r.id = ${equipment.lastRfidRoomId} AND r.clinic_id = ${clinicId}
      LIMIT 1
    )`.as("lastRfidRoomName"),
    lastRfidRoomIsDock: sql<boolean>`EXISTS (
      SELECT 1 FROM vt_docks d
      WHERE d.room_id = ${equipment.lastRfidRoomId} AND d.clinic_id = ${clinicId}
    )`.as("lastRfidRoomIsDock"),
  };
}

// GET /api/equipment/my
router.get("/my", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const items = await db
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
        linkedAnimalId: sql<string | null>`(
          SELECT a.id
          FROM vt_patient_room_assignments pra
          INNER JOIN vt_animals a ON a.id = pra.animal_id
          WHERE pra.clinic_id = ${clinicId}
            AND pra.room_id = ${equipment.roomId}
            AND pra.ended_at IS NULL
            AND a.clinic_id = ${clinicId}
          LIMIT 1
        )`.as("linkedAnimalId"),
        linkedAnimalName: sql<string | null>`(
          SELECT a.name
          FROM vt_patient_room_assignments pra
          INNER JOIN vt_animals a ON a.id = pra.animal_id
          WHERE pra.clinic_id = ${clinicId}
            AND pra.room_id = ${equipment.roomId}
            AND pra.ended_at IS NULL
            AND a.clinic_id = ${clinicId}
          LIMIT 1
        )`.as("linkedAnimalName"),
        ...equipmentOperationalStateSelect,
      })
      .from(equipment)
      .leftJoin(folders, and(eq(equipment.folderId, folders.id), eq(folders.clinicId, clinicId), isNull(folders.deletedAt)))
      .leftJoin(rooms, and(eq(equipment.roomId, rooms.id), eq(rooms.clinicId, clinicId)))
      .leftJoin(users, and(eq(equipment.lastVerifiedById, users.id), eq(users.clinicId, clinicId)))
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.checkedOutById, req.authUser!.id), isNull(equipment.deletedAt)))
      .orderBy(desc(equipment.checkedOutAt));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "MY_EQUIPMENT_FETCH_FAILED",
        message: "Failed to fetch my equipment",
        requestId,
      }),
    );
  }
});

const EQUIPMENT_DEFAULT_PAGE_SIZE = 100;
const EQUIPMENT_MAX_PAGE_SIZE = 1000;

router.get("/", requireAuth, async (req, res) => {
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
        ilike(equipment.searchAlias, pattern)
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
        eq(equipment.checkedOutLocation, location)
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
        linkedAnimalId: sql<string | null>`(
          SELECT a.id
          FROM vt_patient_room_assignments pra
          INNER JOIN vt_animals a ON a.id = pra.animal_id
          WHERE pra.clinic_id = ${clinicId}
            AND pra.room_id = ${equipment.roomId}
            AND pra.ended_at IS NULL
            AND a.clinic_id = ${clinicId}
          LIMIT 1
        )`.as("linkedAnimalId"),
        linkedAnimalName: sql<string | null>`(
          SELECT a.name
          FROM vt_patient_room_assignments pra
          INNER JOIN vt_animals a ON a.id = pra.animal_id
          WHERE pra.clinic_id = ${clinicId}
            AND pra.room_id = ${equipment.roomId}
            AND pra.ended_at IS NULL
            AND a.clinic_id = ${clinicId}
          LIMIT 1
        )`.as("linkedAnimalName"),
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

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(equipment)
      .where(whereClause);
    const items = await baseQuery.limit(limit).offset(offset);
    res.json({ items, total, page, pageSize: limit, hasMore: offset + items.length < total });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_LIST_FAILED",
        message: "Failed to list equipment",
        requestId,
      }),
    );
  }
});

// GET /api/equipment/deleted — admin only, list soft-deleted equipment
router.get("/deleted", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const items = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        serialNumber: equipment.serialNumber,
        model: equipment.model,
        manufacturer: equipment.manufacturer,
        status: equipment.status,
        deletedAt: equipment.deletedAt,
        deletedBy: equipment.deletedBy,
        createdAt: equipment.createdAt,
      })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), isNotNull(equipment.deletedAt)))
      .orderBy(desc(equipment.deletedAt));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "DELETED_EQUIPMENT_LIST_FAILED",
        message: "Failed to list deleted equipment",
        requestId,
      }),
    );
  }
});

// GET /api/equipment/critical
router.get("/critical", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const items = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        category: sql<string>`COALESCE(${equipment.model}, 'General')`,
        status: equipment.status,
        lastSeenLocation: sql<string | null>`COALESCE(${equipment.checkedOutLocation}, ${equipment.location})`,
        lastSeenTimestamp: equipment.lastSeen,
      })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          inArray(equipment.status, ["critical", "needs_attention"]),
          isNull(equipment.deletedAt),
        ),
      )
      // Stabilization plan: Proximity > Accessibility > Functional status
      // Proximity: most recently seen first (operational "nearness" without GPS).
      // Accessibility: known last/checked-out location before unknown.
      // Functional: critical before needs_attention.
      .orderBy(
        desc(equipment.lastSeen),
        sql`(CASE WHEN COALESCE(TRIM(${equipment.checkedOutLocation}), TRIM(${equipment.location})) IS NOT NULL AND LENGTH(TRIM(COALESCE(${equipment.checkedOutLocation}, ${equipment.location}, ''))) > 0 THEN 0 ELSE 1 END) ASC`,
        sql`(CASE WHEN ${equipment.nfcTagId} IS NOT NULL OR ${equipment.roomId} IS NOT NULL THEN 0 ELSE 1 END) ASC`,
        sql`CASE WHEN ${equipment.status} = 'critical' THEN 0 ELSE 1 END ASC`,
      );

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CRITICAL_EQUIPMENT_FETCH_FAILED",
        message: "Failed to fetch critical equipment",
        requestId,
      }),
    );
  }
});

router.get("/pilot-coverage", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    const rows = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        location: equipment.location,
        usuallyFoundHere: equipment.usuallyFoundHere,
        folderName: folders.name,
        lastSeen: equipment.lastSeen,
        confirmCount: sql<number>`count(${scanLogs.id})::int`,
      })
      .from(equipment)
      .leftJoin(folders, eq(equipment.folderId, folders.id))
      .leftJoin(
        scanLogs,
        and(eq(scanLogs.equipmentId, equipment.id), eq(scanLogs.clinicId, clinicId)),
      )
      .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)))
      .groupBy(equipment.id, folders.name)
      .orderBy(sql`${equipment.lastSeen} ASC NULLS FIRST`, asc(equipment.name));

    const now = Date.now();
    const staleMs = await getPilotStaleMs();
    const summary = {
      total: rows.length,
      everConfirmed: rows.filter((r) => r.lastSeen != null).length,
      confirmedToday: rows.filter(
        (r) => r.lastSeen != null && now - new Date(r.lastSeen as Date).getTime() <= staleMs,
      ).length,
      neverConfirmed: rows.filter((r) => r.lastSeen == null).length,
    };

    res.json({ summary, items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PILOT_COVERAGE_FETCH_FAILED",
        message: "Failed to fetch pilot coverage",
        requestId,
      }),
    );
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [item] = await db
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
        linkedAnimalId: sql<string | null>`(
          SELECT a.id
          FROM vt_patient_room_assignments pra
          INNER JOIN vt_animals a ON a.id = pra.animal_id
          WHERE pra.clinic_id = ${clinicId}
            AND pra.room_id = ${equipment.roomId}
            AND pra.ended_at IS NULL
            AND a.clinic_id = ${clinicId}
          LIMIT 1
        )`.as("linkedAnimalId"),
        linkedAnimalName: sql<string | null>`(
          SELECT a.name
          FROM vt_patient_room_assignments pra
          INNER JOIN vt_animals a ON a.id = pra.animal_id
          WHERE pra.clinic_id = ${clinicId}
            AND pra.room_id = ${equipment.roomId}
            AND pra.ended_at IS NULL
            AND a.clinic_id = ${clinicId}
          LIMIT 1
        )`.as("linkedAnimalName"),
        ...equipmentOperationalStateSelect,
        ...equipmentRfidSelect(clinicId),
      })
      .from(equipment)
      .leftJoin(folders, and(eq(equipment.folderId, folders.id), eq(folders.clinicId, clinicId), isNull(folders.deletedAt)))
      .leftJoin(rooms, and(eq(equipment.roomId, rooms.id), eq(rooms.clinicId, clinicId)))
      .leftJoin(users, and(eq(equipment.lastVerifiedById, users.id), eq(users.clinicId, clinicId)))
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
      .limit(1);
    if (!item) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_FETCH_FAILED",
        message: "Failed to get equipment",
        requestId,
      }),
    );
  }
});

router.post(
  "/",
  requireAuth,
  writeLimiter,
  requireEffectiveRole("technician"),
  validateBody(createEquipmentSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.create),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const {
      name,
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
    } = req.body as z.infer<typeof createEquipmentSchema>;

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
});

router.patch(
  "/:id",
  requireAuth,
  writeLimiter,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  validateBody(patchEquipmentSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.update),
  async (req, res) => {
const requestId = resolveRequestId(res, req.headers["x-request-id"]);
try {
    const clinicId = req.clinicId!;
    const {
      name,
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
      status,
      version: expectedVersion,
    } = req.body as z.infer<typeof patchEquipmentSchema>;

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

    let result: EquipmentRow | null = null;
    let versionConflict = false;

    await db.transaction(async (tx) => {
      const [oldItem] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
        .limit(1);

      // Not found — leave result null so the handler returns 404.
      if (!oldItem) return;

      // Optimistic concurrency: if the client declared the version it
      // loaded and the row has since moved on, reject before writing.
      if (expectedVersion !== undefined && oldItem.version !== expectedVersion) {
        versionConflict = true;
        return;
      }

      const [item] = await tx
        .update(equipment)
        .set({
          ...(name !== undefined && { name }),
          ...(serialNumber !== undefined && { serialNumber }),
          ...(model !== undefined && { model }),
          ...(manufacturer !== undefined && { manufacturer }),
          ...(purchaseDate !== undefined && { purchaseDate }),
          ...(expiryDate !== undefined && { expiryDate, expiryNotifiedAt: null }),
          ...(location !== undefined && { location }),
          ...(folderId !== undefined && { folderId: folderId ?? null }),
          ...(roomId !== undefined && { roomId: roomId ?? null }),
          ...(nfcTagId !== undefined && { nfcTagId: nfcTagId ?? null }),
          ...(rfidTagEpc !== undefined && { rfidTagEpc: rfidTagEpc?.trim() || null }),
          ...(maintenanceIntervalDays !== undefined && { maintenanceIntervalDays }),
          ...(expectedReturnMinutes !== undefined && { expectedReturnMinutes }),
          ...(imageUrl !== undefined && { imageUrl }),
          ...(usuallyFoundHere !== undefined && { usuallyFoundHere }),
          ...(searchAlias !== undefined && { searchAlias }),
          ...(staffNote !== undefined && { staffNote }),
          ...(status !== undefined && { status }),
          // Always bump the row version so concurrent loaders can detect drift.
          version: sql`${equipment.version} + 1`,
        })
        .where(and(
          eq(equipment.clinicId, clinicId),
          eq(equipment.id, req.params.id),
          isNull(equipment.deletedAt),
          ...(expectedVersion !== undefined ? [eq(equipment.version, expectedVersion)] : []),
        ))
        .returning();

      // No row updated despite oldItem existing — a concurrent writer won
      // the version race between the SELECT and the UPDATE.
      if (!item) {
        versionConflict = expectedVersion !== undefined;
        return;
      }
      result = item;

      if (folderId !== undefined && oldItem && oldItem.folderId !== (folderId ?? null)) {
        const [oldFolder] = oldItem.folderId
          ? await tx.select().from(folders).where(and(eq(folders.clinicId, clinicId), eq(folders.id, oldItem.folderId))).limit(1)
          : [null];
        const targetFolderId = folderId ?? null;
        const [newFolder] = targetFolderId
          ? await tx.select().from(folders).where(and(eq(folders.clinicId, clinicId), eq(folders.id, targetFolderId))).limit(1)
          : [null];
        await tx.insert(transferLogs).values({
          id: randomUUID(),
          clinicId,
          equipmentId: req.params.id,
          fromFolderId: oldItem.folderId ?? null,
          fromFolderName: oldFolder?.name ?? null,
          toFolderId: targetFolderId,
          toFolderName: newFolder?.name ?? null,
          userId: req.authUser!.id,
        });

        const itemName = result?.name ?? oldItem.name;
        if (!checkDedupe(req.params.id, "transfer")) {
          const toLabel = newFolder?.name ?? "unassigned";
          sendPushToAll(clinicId, {
            title: "Equipment Transferred",
            body: `${itemName} moved to ${toLabel}`,
            tag: `transfer:${req.params.id}`,
            url: `/equipment/${req.params.id}`,
          });
        }
      }
    });

    if (versionConflict) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_VERSION_CONFLICT",
          message: "Equipment was modified by someone else — reload and retry",
          requestId,
        }),
      );
    }

    if (!result) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_updated",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: (result as EquipmentRow).name, changes: req.body },
    });

    invalidateAnalyticsCache(clinicId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_UPDATE_FAILED",
        message: "Failed to update equipment",
        requestId,
      }),
    );
  }
});

router.delete(
  "/:id",
  requireAuth,
  writeLimiter,
  requireAdmin,
  validateUuid("id"),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.delete),
  async (req, res) => {
const requestId = resolveRequestId(res, req.headers["x-request-id"]);
try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    await db
      .update(equipment)
      .set({ deletedAt: new Date(), deletedBy: req.authUser!.id })
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)));

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_deleted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: existing.name, serialNumber: existing.serialNumber },
    });
    invalidateAnalyticsCache(clinicId);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_DELETE_FAILED",
        message: "Failed to delete equipment",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/:id/restore — admin only, restore a soft-deleted equipment record
router.post("/:id/restore", requireAuth, requireAdmin, validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [existing] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNotNull(equipment.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND_OR_NOT_DELETED",
          message: "Equipment not found or not deleted",
          requestId,
        }),
      );
    }

    const [restored] = await db
      .update(equipment)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id)))
      .returning();

    if (restored) {
      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "equipment_restored",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email ?? "",
        targetId: req.params.id,
        targetType: "equipment",
        metadata: { equipmentName: restored.name },
      });
    }

    invalidateAnalyticsCache(clinicId);
    res.json(restored);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_RESTORE_FAILED",
        message: "Failed to restore equipment",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/scan — quick-scan alias for pilot/demo flows.
// Body: { equipmentId: string }  (accepts plain string IDs like "eq1", not UUID-only)
// Toggle semantics: available → checkout · held by caller → return · held by other → 409
router.post("/scan", requireAuth, checkoutLimiter, requireEffectiveRole("student"), validateBody(quickScanBodySchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { equipmentId } = req.body as z.infer<typeof quickScanBodySchema>;
    const now = new Date();

    // Object ref avoids TypeScript narrowing `action` to its initial literal
    // through control flow analysis across the async transaction callback.
    const scan = { action: "checkout" as "checkout" | "return" | "blocked" };
    let updatedEquipment: EquipmentRow | null = null;
    let scanLogId = "";
    let undoToken = "";

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
        .limit(1);

      if (!existing) return;

      if (existing.checkedOutById && existing.checkedOutById !== req.authUser!.id) {
        scan.action = "blocked";
        updatedEquipment = existing;
        return;
      }

      if (!existing.checkedOutById) {
        scan.action = "checkout";
        const [updatedRow] = await tx
          .update(equipment)
          .set({
            checkedOutById: req.authUser!.id,
            checkedOutByEmail: req.authUser!.email,
            checkedOutAt: now,
            checkedOutLocation: null,
            lastSeen: now,
            lastStatus: existing.status,
          })
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)))
          .returning();
        updatedEquipment = updatedRow;
        const logId = randomUUID();
        await tx.insert(scanLogs).values({
          id: logId,
          clinicId,
          equipmentId,
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          status: existing.status,
          note: "Quick scan — checked out",
          timestamp: now,
        });
        undoToken = await insertUndoToken(tx, {
          clinicId,
          equipmentId,
          actorId: req.authUser!.id,
          scanLogId: logId,
          previousState: snapshotState(existing),
        });
        scanLogId = logId;
      } else {
        scan.action = "return";
        const [updatedRow] = await tx
          .update(equipment)
          .set({
            checkedOutById: null,
            checkedOutByEmail: null,
            checkedOutAt: null,
            checkedOutLocation: null,
            status: "ok",
            lastSeen: now,
            lastStatus: "ok",
          })
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId)))
          .returning();
        updatedEquipment = updatedRow;
        const logId = randomUUID();
        await tx.insert(scanLogs).values({
          id: logId,
          clinicId,
          equipmentId,
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          status: "ok",
          note: "Quick scan — returned",
          timestamp: now,
        });
        undoToken = await insertUndoToken(tx, {
          clinicId,
          equipmentId,
          actorId: req.authUser!.id,
          scanLogId: logId,
          previousState: snapshotState(existing),
        });
        await tx.insert(equipmentReturns).values({
          id: randomUUID(),
          clinicId,
          equipmentId,
          returnedById: req.authUser!.id,
          returnedByEmail: req.authUser!.email,
          returnedAt: now,
          isPluggedIn: true,
          plugInDeadlineMinutes: 30,
          plugInAlertSentAt: null,
          chargeAlertJobId: null,
        });
        scanLogId = logId;
      }
    });

    if (!updatedEquipment) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    if (scan.action === "blocked") {
      const held = updatedEquipment as EquipmentRow;
      return res.status(409).json({
        ...apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_ALREADY_CHECKED_OUT",
          message: "Equipment is currently checked out by another user",
          requestId,
        }),
        checkedOutByEmail: held.checkedOutByEmail,
      });
    }

    const u = updatedEquipment as EquipmentRow;

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: scan.action === "checkout" ? "equipment_checked_out" : "equipment_returned",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: equipmentId,
      targetType: "equipment",
      metadata: { name: u.name, via: "quick_scan" },
    });

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({ equipment: updatedEquipment, action: scan.action, scanLogId, undoToken });
  } catch (err) {
    console.error(err);
    trackSyncFail();
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_SCAN_FAILED",
        message: "Scan failed",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/:id/checkout
router.post(
  "/:id/checkout",
  requireAuth,
  checkoutLimiter,
  requireEffectiveRole("student"),
  validateUuid("id"),
  validateBody(checkoutSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.checkout),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { location, emergencyReason } = req.body as z.infer<typeof checkoutSchema>;
    const isEmergency = req.headers["x-emergency-checkout"] === "true";
    const clientTimestamp = parseInt(req.headers["x-client-timestamp"] as string || "0", 10);

    let updated: EquipmentRow | null = null;
    let reminderBaseTime: Date | null = null;
    let undoToken = "";

    // ── Operational State V1 pre-checks (A–F) ──────────────────────────
    const checkoutStart = Date.now();
    let v1StageClaimId: string | null = null;
    let v1NewUsageState: "in_use" | "emergency_use" = "in_use";

    const [snap] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
      .limit(1);

    if (snap) {
      // A. untracked → 422 (NFC scan not possible — also blocks emergency)
      if (snap.custodyState === "untracked") {
        void recordOperationalMetric({ clinicId, equipmentId: snap.id, userId: req.authUser!.id, eventType: "custody_chain_broken" });
        return res.status(422).json({ code: "CUSTODY_CHAIN_BROKEN", error: "Equipment custody chain is broken" });
      }

      // B. checked_out → 422 (no double-checkout — also blocks emergency)
      if (snap.custodyState === "checked_out") {
        return res.status(409).json({ code: "ALREADY_CHECKED_OUT", error: "Equipment is already checked out" });
      }

      // C. Emergency — must be before usageState checks to bypass staged
      if (isEmergency) {
        if (!emergencyReason) {
          return res.status(422).json({ code: "EMERGENCY_REASON_REQUIRED", error: "emergencyReason is required for emergency checkout" });
        }
        const capturedVersion = snap.version;
        const now = new Date();
        try {
          await db.transaction(async (tx) => {
            // Cancel all active staging claims
            await tx.update(stagingQueue)
              .set({ status: "cancelled", updatedAt: now })
              .where(and(eq(stagingQueue.equipmentId, snap.id), eq(stagingQueue.status, "active")));

            // Set emergency state
            const emergencyUpdate = await tx
              .update(equipment)
              .set({
                custodyState: "checked_out",
                custodyStateSince: now,
                readinessState: "unknown",
                readinessStateSince: now,
                usageState: "emergency_use",
                usageStateSince: now,
                emergencyOverrideAt: now,
                emergencyOverrideById: req.authUser!.id,
                checkedOutById: req.authUser!.id,
                checkedOutByEmail: req.authUser!.email,
                checkedOutAt: now,
                checkedOutLocation: location ?? null,
                lastSeen: now,
                lastStatus: snap.status,
                version: sql`${equipment.version} + 1`,
              })
              .where(and(
                eq(equipment.clinicId, clinicId),
                eq(equipment.id, snap.id),
                inArray(equipment.custodyState, ["docked", "returned"]),
                eq(equipment.version, capturedVersion),
              ));

            if ((emergencyUpdate as unknown as { rowCount?: number }).rowCount === 0) {
              throw new Error("VERSION_CONFLICT");
            }

            await insertRealtimeDomainEvent(tx, {
              clinicId,
              type: "EQUIPMENT_EMERGENCY_CHECKOUT",
              payload: { equipmentId: snap.id, emergencyReason },
            });
          });
        } catch (err) {
          if (err instanceof Error && err.message === "VERSION_CONFLICT") {
            return res.status(409).json({ code: "VERSION_CONFLICT", error: "Version conflict, please retry" });
          }
          throw err;
        }

        logAudit({
          clinicId,
          actionType: "equipment_emergency_checkout",
          performedBy: req.authUser!.id,
          performedByEmail: req.authUser!.email,
          targetId: snap.id,
          metadata: { emergencyReason },
        });
        void recordOperationalMetric({ clinicId, equipmentId: snap.id, userId: req.authUser!.id, eventType: "emergency_override", metadata: { emergencyReason } });

        const [freshEq] = await db.select().from(equipment).where(eq(equipment.id, snap.id));
        return res.json({ equipment: freshEq, undoToken: "" });
      }

      // D. staged + top-claim-holder
      if (snap.usageState === "staged") {
        const claims = await db
          .select()
          .from(stagingQueue)
          .where(and(eq(stagingQueue.equipmentId, snap.id), eq(stagingQueue.clinicId, clinicId), eq(stagingQueue.status, "active")))
          .orderBy(
            sql`CASE ${stagingQueue.clinicalPriority} WHEN 'emergency' THEN 3 WHEN 'urgent' THEN 2 WHEN 'routine' THEN 1 ELSE 0 END DESC`,
            stagingQueue.stagedAt,
          );

        const topClaim = claims[0];
        if (!topClaim || topClaim.requestedById !== req.authUser!.id) {
          return res.status(409).json({ code: "STAGING_CONFLICT", error: "You are not the top priority claim holder", queue: claims });
        }

        const allConditions = snap.assetTypeId
          ? await db.select().from(assetTypeConditions).where(eq(assetTypeConditions.assetTypeId, snap.assetTypeId))
          : [];
        const condStates = snap.assetTypeId
          ? await db.select().from(unitConditionStates).where(eq(unitConditionStates.equipmentId, snap.id))
          : [];
        const gateResult = computeBundleReadinessGate(snap, condStates, allConditions, new Date());
        if (!gateResult.ok) {
          void recordOperationalMetric({ clinicId, equipmentId: snap.id, userId: req.authUser!.id, eventType: "bundle_failed", metadata: { reason: gateResult.reason, failedConditions: gateResult.failedConditions, staleConditions: gateResult.staleConditions, unknownConditions: gateResult.unknownConditions } });
          return res.status(422).json({ code: "BUNDLE_INCOMPLETE", ...gateResult });
        }

        v1StageClaimId = topClaim.id;
      } else if (snap.usageState === "available") {
        // E. available — bundle gate only when asset type defines conditions
        if (snap.assetTypeId) {
          const allConditions = await db
            .select()
            .from(assetTypeConditions)
            .where(eq(assetTypeConditions.assetTypeId, snap.assetTypeId));
          const condStates = await db
            .select()
            .from(unitConditionStates)
            .where(eq(unitConditionStates.equipmentId, snap.id));
          const gateResult = computeBundleReadinessGate(snap, condStates, allConditions, new Date());
          if (!gateResult.ok) {
            void recordOperationalMetric({ clinicId, equipmentId: snap.id, userId: req.authUser!.id, eventType: "bundle_failed", metadata: { reason: gateResult.reason, failedConditions: gateResult.failedConditions, staleConditions: gateResult.staleConditions, unknownConditions: gateResult.unknownConditions } });
            return res.status(422).json({ code: "BUNDLE_INCOMPLETE", ...gateResult });
          }
        } else if (!["returned", "docked"].includes(snap.custodyState)) {
          return res.status(422).json({
            code: "EQUIPMENT_UNAVAILABLE",
            error: `Equipment custody state ${snap.custodyState} blocks checkout`,
          });
        }
      } else {
        // F. any other usageState
        return res.status(422).json({ code: "EQUIPMENT_UNAVAILABLE", error: `Equipment usage state ${snap.usageState} blocks checkout` });
      }
    }

    // ─────────────────────────────────────────────────────────────────

    const preCheckoutNotifiedUserId = await getActiveNotifiedUserId(clinicId, req.params.id);
    if (
      !isEmergency &&
      preCheckoutNotifiedUserId &&
      preCheckoutNotifiedUserId !== req.authUser!.id
    ) {
      return apiErrorI18n(
        req,
        res,
        "equipmentWaitlist.WAITLIST_RESERVATION_HELD_BY_OTHER",
        undefined,
        409,
      );
    }

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
        .limit(1);

      if (!existing) return;

      const checkoutTime = clientTimestamp ? new Date(clientTimestamp) : new Date();
      reminderBaseTime = checkoutTime;

      const checkoutSet = {
        checkedOutById: req.authUser!.id,
        checkedOutByEmail: req.authUser!.email,
        checkedOutAt: checkoutTime,
        checkedOutLocation: location ?? null,
        lastSeen: checkoutTime,
        lastStatus: existing.status,
        // V1 operational state additions
        custodyState: "checked_out" as const,
        custodyStateSince: checkoutTime,
        usageState: v1NewUsageState,
        usageStateSince: checkoutTime,
        version: sql`${equipment.version} + 1`,
      };

      let updatedRow: EquipmentRow | undefined;

      if (!existing.checkedOutById) {
        [updatedRow] = await tx
          .update(equipment)
          .set(checkoutSet)
          .where(
            and(
              eq(equipment.clinicId, clinicId),
              eq(equipment.id, req.params.id),
              isNull(equipment.checkedOutById),
            ),
          )
          .returning();

        if (!updatedRow) {
          const [winner] = await tx
            .select()
            .from(equipment)
            .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id)))
            .limit(1);
          throw new CheckoutConflictError(winner?.checkedOutByEmail ?? "unknown");
        }
      } else {
        const existingTimestamp = existing.checkedOutAt
          ? new Date(existing.checkedOutAt).getTime()
          : 0;
        if (!clientTimestamp || clientTimestamp <= existingTimestamp) {
          throw new CheckoutConflictError(existing.checkedOutByEmail ?? "unknown");
        }

        const overrideWhere =
          existing.checkedOutAt == null
            ? and(
                eq(equipment.clinicId, clinicId),
                eq(equipment.id, req.params.id),
                isNull(equipment.checkedOutAt),
              )
            : and(
                eq(equipment.clinicId, clinicId),
                eq(equipment.id, req.params.id),
                eq(equipment.checkedOutAt, existing.checkedOutAt),
              );

        [updatedRow] = await tx
          .update(equipment)
          .set(checkoutSet)
          .where(overrideWhere)
          .returning();

        if (!updatedRow) {
          throw new CheckoutConflictError(existing.checkedOutByEmail ?? "unknown");
        }
      }

      updated = updatedRow;
      const checkoutLogId = randomUUID();

      await tx.insert(scanLogs).values({
        id: checkoutLogId,
        clinicId,
        equipmentId: req.params.id,
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        status: existing.status,
        note: `Checked out${location ? ` — ${location}` : ""}`,
        timestamp: checkoutTime,
      });

      undoToken = await insertUndoToken(tx, {
        clinicId,
        equipmentId: req.params.id,
        actorId: req.authUser!.id,
        scanLogId: checkoutLogId,
        previousState: snapshotState(existing),
      });

      // V1: fulfill staging claim if path D
      if (v1StageClaimId) {
        await tx
          .update(stagingQueue)
          .set({ status: "fulfilled", updatedAt: checkoutTime })
          .where(and(eq(stagingQueue.id, v1StageClaimId), eq(stagingQueue.equipmentId, req.params.id)));
      }

      await fulfillWaitlistOnCheckout(tx, clinicId, req.params.id, req.authUser!.id, checkoutTime);

      // V1: realtime event
      await insertRealtimeDomainEvent(tx, {
          clinicId,
          type: "EQUIPMENT_CUSTODY_STATE_CHANGED",
          payload: { equipmentId: req.params.id, custodyState: "checked_out", usageState: v1NewUsageState },
        });
    });

    if (v1StageClaimId) {
      void promoteStagingQueueNext(req.params.id, clinicId);
    }

    if (!updated) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    const u = updated as EquipmentRow;

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_checked_out",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: u.name, location: req.body?.location ?? null },
    });

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({ equipment: updated, undoToken });

    void scheduleSmartReturnReminder({
      clinicId,
      equipmentId: u.id,
      equipmentName: u.name,
      expectedReturnMinutes: u.expectedReturnMinutes,
      userId: req.authUser!.id,
      checkedOutAt: reminderBaseTime ?? u.checkedOutAt,
    });

    if (!checkDedupe(u.id, "checkout")) {
      sendPushToAll(clinicId, {
        title: "Equipment Checked Out",
        body: `${u.name} checked out${req.body?.location ? ` — ${req.body.location}` : ""}`,
        tag: `checkout:${u.id}`,
        url: `/equipment/${u.id}`,
      });
    }
  } catch (err) {
    if (err instanceof CheckoutConflictError) {
      return res.status(409).json({
        ...apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_ALREADY_CHECKED_OUT",
          message: "Already checked out",
          requestId,
        }),
        checkedOutByEmail: err.checkedOutByEmail,
        conflictInfo: `Checked out by ${err.checkedOutByEmail}`,
      });
    }
    if (err instanceof EquipmentWaitlistError) {
      const status = err.code === "WAITLIST_RESERVATION_HELD_BY_OTHER" ? 409 : 422;
      return apiErrorI18n(req, res, `equipmentWaitlist.${err.code}`, undefined, status);
    }
    console.error(err);
    trackSyncFail();
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_CHECKOUT_FAILED",
        message: "Checkout failed",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/:id/return
router.post(
  "/:id/return",
  requireAuth,
  checkoutLimiter,
  requireEffectiveRole("student"),
  validateUuid("id"),
  validateBody(equipmentReturnBodySchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.return),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const clientTimestamp = parseInt(req.headers["x-client-timestamp"] as string || "0", 10);
    const { isPluggedIn, plugInDeadlineMinutes } = req.body as z.infer<typeof equipmentReturnBodySchema>;

    let updated: EquipmentRow | null = null;
    let undoToken = "";
    let alreadyReturned = false;
    let didTransitionCustody = false;
    let waitlistPromotedOnReturn: EquipmentWaitlistRow | null = null;

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
        .limit(1);

      if (!existing) return;

      if (!existing.checkedOutById) {
        const existingTimestamp = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
        if (clientTimestamp && clientTimestamp <= existingTimestamp) {
          alreadyReturned = true;
          updated = existing;
          return;
        }
      }

      const returnTime = clientTimestamp ? new Date(clientTimestamp) : new Date();
      const transitionCustody = existing.custodyState === "checked_out";
      if (transitionCustody) didTransitionCustody = true;

      let hasActiveClaims = false;
      if (transitionCustody) {
        const [activeClaims] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(stagingQueue)
          .where(and(
            eq(stagingQueue.equipmentId, req.params.id),
            eq(stagingQueue.clinicId, clinicId),
            eq(stagingQueue.status, "active"),
          ));
        hasActiveClaims = Number(activeClaims?.count ?? 0) > 0;
      }

      const returnSet = {
        checkedOutById: null,
        checkedOutByEmail: null,
        checkedOutAt: null,
        checkedOutLocation: null,
        status: "ok" as const,
        lastSeen: returnTime,
        lastStatus: "ok" as const,
        ...(transitionCustody
          ? {
              custodyState: "returned" as const,
              custodyStateSince: returnTime,
              readinessState: "unknown" as const,
              readinessStateSince: returnTime,
              usageState: hasActiveClaims ? ("staged" as const) : ("available" as const),
              usageStateSince: returnTime,
              version: sql`${equipment.version} + 1`,
            }
          : {}),
      };

      const returnWhere = transitionCustody
        ? and(
            eq(equipment.clinicId, clinicId),
            eq(equipment.id, req.params.id),
            eq(equipment.custodyState, "checked_out"),
            eq(equipment.version, existing.version),
          )
        : and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id));

      const [updatedRow] = await tx
        .update(equipment)
        .set(returnSet)
        .where(returnWhere)
        .returning();

      if (!updatedRow) {
        if (transitionCustody) {
          throw new Error("CUSTODY_RETURN_VERSION_CONFLICT");
        }
        throw new Error("EQUIPMENT_RETURN_UPDATE_FAILED");
      }

      updated = updatedRow;
      const returnLogId = randomUUID();

      await tx.insert(scanLogs).values({
        id: returnLogId,
        clinicId,
        equipmentId: req.params.id,
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        status: "ok",
        note: "Returned — available",
        timestamp: returnTime,
      });

      undoToken = await insertUndoToken(tx, {
        clinicId,
        equipmentId: req.params.id,
        actorId: req.authUser!.id,
        scanLogId: returnLogId,
        previousState: snapshotState(existing),
      });

      if (transitionCustody) {
        await insertRealtimeDomainEvent(tx, {
          clinicId,
          type: "EQUIPMENT_CUSTODY_STATE_CHANGED",
          payload: { equipmentId: req.params.id, custodyState: "returned", hasActiveClaims },
        });
        waitlistPromotedOnReturn = await promoteNextWaitlistInTx(
          tx,
          clinicId,
          req.params.id,
          returnTime,
        );
      }
    });

    if (waitlistPromotedOnReturn) {
      void notifyWaitlistPromoted(clinicId, req.params.id, waitlistPromotedOnReturn);
    }

    if (!updated) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }
    if (alreadyReturned) {
      return res.json({
        equipment: updated,
        undoToken: "",
        returnRecord: null,
      });
    }

    const u = updated as EquipmentRow;

    let returnRecord: (typeof equipmentReturns.$inferSelect) | null = null;
    if (isPluggedIn === false) {
      const deadlineMinutes = plugInDeadlineMinutes ?? PLUG_IN_DEADLINE_DEFAULT_MINUTES;
      const returnId = randomUUID();
      const chargeAlertJobId = await enqueueChargeAlertJob({
        returnId,
        clinicId,
        equipmentId: req.params.id,
        plugInDeadlineMinutes: deadlineMinutes,
      });
      const [created] = await db
        .insert(equipmentReturns)
        .values({
          id: returnId,
          clinicId,
          equipmentId: req.params.id,
          returnedById: req.authUser!.id,
          returnedByEmail: req.authUser!.email,
          returnedAt: new Date(),
          isPluggedIn: false,
          plugInDeadlineMinutes: deadlineMinutes,
          plugInAlertSentAt: null,
          chargeAlertJobId,
        })
        .returning();
      returnRecord = created ?? null;
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_returned",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: {
        name: u.name,
        ...(returnRecord
          ? {
              returnId: returnRecord.id,
              isPluggedIn: returnRecord.isPluggedIn,
              plugInDeadlineMinutes: returnRecord.plugInDeadlineMinutes,
            }
          : {}),
      },
    });

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({
      equipment: updated,
      undoToken,
      returnRecord,
    });

    await cancelSmartReturnReminder(clinicId, u.id, req.authUser!.id);

    if (!checkDedupe(u.id, "return")) {
      sendPushToAll(clinicId, {
        title: "Equipment Returned",
        body: `${u.name} has been returned and is available`,
        tag: `return:${u.id}`,
        url: `/equipment/${u.id}`,
      });
    }
  } catch (err) {
    if (err instanceof Error && err.message === "CUSTODY_RETURN_VERSION_CONFLICT") {
      trackSyncFail();
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "VERSION_CONFLICT",
          message: "Equipment was updated concurrently; please retry the return",
          requestId,
        }),
      );
    }
    console.error(err);
    trackSyncFail();
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_RETURN_FAILED",
        message: "Return failed",
        requestId,
      }),
    );
  }
},
);

// POST /api/equipment/:id/seen — idempotent billing + usage session (Phase 2)
router.post(
  "/:id/seen",
  requireAuth,
  writeLimiter,
  validateUuid("id"),
  validateBody(seenSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.seen),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const { roomId, packageCode, scanLogId } = req.body as z.infer<typeof seenSchema>;
      const result = await recordEquipmentSeen({
        clinicId,
        equipmentId: req.params.id,
        roomId: roomId ?? null,
        packageCode: packageCode ?? null,
        scanLogId: scanLogId ?? null,
      });
      if (!result.ok) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "EQUIPMENT_NOT_FOUND",
            message: "Equipment not found",
            requestId,
          }),
        );
      }
      if (!result.linked) {
        return res.json({
          linked: false,
          reason: result.reason,
          roomId: result.roomId,
        });
      }
      res.json({
        linked: true,
        animal: result.animal,
        roomId: result.roomId,
        usageSessionId: result.usageSessionId,
        ledgerId: result.ledgerId,
        packageLedgerIds: result.packageLedgerIds ?? [],
        idempotentReplay: result.idempotentReplay ?? false,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "EQUIPMENT_SEEN_FAILED",
          message: "Failed to record equipment seen",
          requestId,
        }),
      );
    }
  },
);

// POST /api/equipment/:id/scan
router.post(
  "/:id/scan",
  requireAuth,
  scanLimiter,
  requireEffectiveRole("student"),
  validateUuid("id"),
  validateBody(scanSchema),
  equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.scan),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { status, note, photoUrl } = req.body as z.infer<typeof scanSchema>;
    if (status === "issue" && !note?.trim()) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "ISSUE_NOTE_REQUIRED",
          message: "Note is required when reporting an issue",
          requestId,
        }),
      );
    }

    const clientTimestamp = parseInt(req.headers["x-client-timestamp"] as string || "0", 10);
    const scanTime = clientTimestamp ? new Date(clientTimestamp) : new Date();

    let updatedEquipment: EquipmentRow | null = null;
    let scanLog: typeof scanLogs.$inferSelect | null = null;
    let undoToken = "";

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
        .limit(1);

      if (!existing) return;

      const serverLastSeen = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
      const isNewerWrite = !clientTimestamp || clientTimestamp >= serverLastSeen;

      if (isNewerWrite) {
        const updates: Partial<typeof equipment.$inferInsert> = {
          lastSeen: scanTime,
          lastStatus: status,
          status,
        };
        if (status === "ok") {
          updates.lastVerifiedAt = scanTime;
          updates.lastVerifiedById = req.authUser!.id;
        }
        if (status === "maintenance") updates.lastMaintenanceDate = scanTime;
        if (status === "sterilized") updates.lastSterilizationDate = scanTime;

        const [result] = await tx
          .update(equipment)
          .set(updates)
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id)))
          .returning();
        updatedEquipment = result;
      } else {
        updatedEquipment = existing;
      }

      const [log] = await tx
        .insert(scanLogs)
        .values({
          id: randomUUID(),
          clinicId,
          equipmentId: req.params.id,
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          status,
          note: note ?? null,
          photoUrl: photoUrl ?? null,
          timestamp: scanTime,
        })
        .returning();

      scanLog = log;

      undoToken = await insertUndoToken(tx, {
        clinicId,
        equipmentId: req.params.id,
        actorId: req.authUser!.id,
        scanLogId: log.id,
        previousState: snapshotState(existing),
      });
    });

    if (!updatedEquipment) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    const eq2 = updatedEquipment as EquipmentRow;

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_scanned",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: eq2.name, status, note: note ?? null },
    });

    invalidateAnalyticsCache(clinicId);
    trackSyncSuccess();
    res.json({ equipment: updatedEquipment, scanLog, undoToken });
    if (status === "issue" && !checkDedupe(eq2.id, "issue")) {
      sendPushToAll(clinicId, {
        title: "Equipment Issue Reported",
        body: `${eq2.name} needs attention${note ? ` — ${note}` : ""}`,
        tag: `issue:${eq2.id}`,
        url: `/equipment/${eq2.id}`,
      });
    }

    const now = new Date();
    if (
      eq2.maintenanceIntervalDays &&
      eq2.lastMaintenanceDate &&
      !checkDedupe(eq2.id, "overdue")
    ) {
      const dueDate = new Date(eq2.lastMaintenanceDate);
      dueDate.setDate(dueDate.getDate() + eq2.maintenanceIntervalDays);
      if (now > dueDate) {
        const daysOverdue = Math.ceil((now.getTime() - dueDate.getTime()) / 86_400_000);
        sendPushToAll(clinicId, {
          title: "Maintenance Overdue",
          body: `${eq2.name} is ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue for maintenance`,
          tag: `overdue:${eq2.id}`,
          url: `/equipment/${eq2.id}`,
        });
      }
    }

    if (eq2.lastSterilizationDate && !checkDedupe(eq2.id, "sterilization_due")) {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
      if (new Date(eq2.lastSterilizationDate) < sevenDaysAgo) {
        sendPushToAll(clinicId, {
          title: "Sterilization Due",
          body: `${eq2.name} has not been sterilized in 7+ days`,
          tag: `sterilization_due:${eq2.id}`,
          url: `/equipment/${eq2.id}`,
        });
      }
    }
  } catch (err) {
    console.error(err);
    trackSyncFail();
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_SCAN_FAILED",
        message: "Scan failed",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/:id/revert
router.post("/:id/revert", requireAuth, requireEffectiveRole("vet"), validateUuid("id"), validateBody(revertSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { undoToken: tokenId } = req.body as z.infer<typeof revertSchema>;

    const [existingItem] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id), isNull(equipment.deletedAt)))
      .limit(1);

    if (!existingItem) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    const token = await consumeUndoToken(clinicId, tokenId, req.params.id, req.authUser!.id);
    if (!token) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "UNDO_TOKEN_INVALID_OR_EXPIRED",
          message: "Undo window expired or token invalid",
          requestId,
        }),
      );
    }

    const prev = token.previousState;

    let updated: EquipmentRow | null = null;

    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(equipment)
        .set({
          status: prev.status,
          lastSeen: prev.lastSeen ? new Date(prev.lastSeen) : null,
          lastStatus: prev.lastStatus,
          lastMaintenanceDate: prev.lastMaintenanceDate ? new Date(prev.lastMaintenanceDate) : null,
          lastSterilizationDate: prev.lastSterilizationDate ? new Date(prev.lastSterilizationDate) : null,
          checkedOutById: prev.checkedOutById,
          checkedOutByEmail: prev.checkedOutByEmail,
          checkedOutAt: prev.checkedOutAt ? new Date(prev.checkedOutAt) : null,
          checkedOutLocation: prev.checkedOutLocation,
        })
        .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, req.params.id)))
        .returning();

      updated = result;

      await tx
        .delete(scanLogs)
        .where(and(eq(scanLogs.clinicId, clinicId), eq(scanLogs.id, token.scanLogId), eq(scanLogs.equipmentId, req.params.id)));
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_reverted",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "equipment",
      metadata: { name: (updated as EquipmentRow | null)?.name ?? null },
    });

    invalidateAnalyticsCache(clinicId);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_REVERT_FAILED",
        message: "Revert failed",
        requestId,
      }),
    );
  }
});

const LOGS_DEFAULT_PAGE_SIZE = 50;
const LOGS_MAX_PAGE_SIZE = 200;

router.get("/:id/logs", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawPage = parseInt(req.query.page as string, 10);
    const limit = (!isNaN(rawLimit) && rawLimit > 0)
      ? Math.min(rawLimit, LOGS_MAX_PAGE_SIZE)
      : LOGS_DEFAULT_PAGE_SIZE;
    const page = (!isNaN(rawPage) && rawPage > 1) ? rawPage : 1;
    const offset = (page - 1) * limit;

    const rawSince = req.query.since as string | undefined;
    const sinceDate = rawSince ? new Date(rawSince) : null;
    const sinceFilter = sinceDate && !isNaN(sinceDate.getTime())
      ? gte(scanLogs.timestamp, sinceDate)
      : undefined;

    const baseWhere = and(
      eq(scanLogs.clinicId, clinicId),
      eq(scanLogs.equipmentId, req.params.id),
      sinceFilter,
    );

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(scanLogs)
      .where(baseWhere);

    const isAdmin = req.authUser?.role === "admin";

    const rows = await db
      .select({
        id: scanLogs.id,
        clinicId: scanLogs.clinicId,
        equipmentId: scanLogs.equipmentId,
        userId: scanLogs.userId,
        userEmail: scanLogs.userEmail,
        status: scanLogs.status,
        note: scanLogs.note,
        photoUrl: scanLogs.photoUrl,
        timestamp: scanLogs.timestamp,
        staffName: users.name,
        staffRole: users.role,
      })
      .from(scanLogs)
      .leftJoin(users, and(eq(scanLogs.userId, users.id), eq(users.clinicId, clinicId)))
      .where(baseWhere)
      .orderBy(desc(scanLogs.timestamp))
      .limit(limit)
      .offset(offset);

    // Attribution boundary: staff name/role only on admin (audit) surfaces.
    const items = isAdmin
      ? rows
      : rows.map(({ staffName: _sn, staffRole: _sr, ...rest }) => rest);

    res.json({ items, total, page, pageSize: limit, hasMore: offset + items.length < total });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_LOGS_FETCH_FAILED",
        message: "Failed to get logs",
        requestId,
      }),
    );
  }
});

router.get("/:id/transfers", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const transfers = await db
      .select()
      .from(transferLogs)
      .where(and(eq(transferLogs.clinicId, clinicId), eq(transferLogs.equipmentId, req.params.id)))
      .orderBy(desc(transferLogs.timestamp));
    res.json(transfers);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_TRANSFERS_FETCH_FAILED",
        message: "Failed to get transfers",
        requestId,
      }),
    );
  }
});

// ─── CSV helpers ────────────────────────────────────────────────────────────

const VALID_IMPORT_STATUSES = new Set(["ok", "issue", "maintenance", "sterilized"]);
const CSV_MAX_ROWS = 500;

interface CsvRow {
  name: string;
  serial: string;
  status: string;
  location: string;
  folder: string;
  maintenanceIntervalDays: string;
  notes: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const [headerLine, ...dataLines] = nonEmpty;
  const normalizeImportHeader = (value: string) =>
    value
      .replace(/^\uFEFF/, "") // strip UTF-8 BOM (Excel/Sheets exports)
      .trim()
      .toLowerCase()
      .replace(/^["']|["']$/g, "")
      .replace(/[\s_-]+/g, "")
      .replace(/[()[\]./\\]/g, "");
  const headers = parseCsvLine(headerLine).map((h) => normalizeImportHeader(h));
  const rows = dataLines.map((l) => parseCsvLine(l));
  return { headers, rows };
}

// POST /api/equipment/import — accepts multipart/form-data with a "file" field
// or JSON body with a "csv" string field (backwards-compatible)
router.post("/import", requireAuth, writeLimiter, requireAdmin, upload.single("file"), async (req, res) => {
const requestId = resolveRequestId(res, req.headers["x-request-id"]);
try {
    const clinicId = req.clinicId!;
    let csv: string;
    if (req.file) {
      // Multipart upload
      csv = req.file.buffer.toString("utf-8");
    } else {
      const body = req.body as { csv?: string };
      if (!body.csv || typeof body.csv !== "string") {
        return res.status(400).json(
          apiError({
            code: "VALIDATION_FAILED",
            reason: "CSV_INPUT_REQUIRED",
            message: "Provide a CSV file upload (multipart field 'file') or JSON body with 'csv' string",
            requestId,
          }),
        );
      }
      csv = body.csv;
    }

    const { headers, rows } = parseCsv(csv);

    const nameIdx = headers.indexOf("name");
    const serialIdx = headers.indexOf("serial");
    const statusIdx = headers.indexOf("status");
    const locationIdx = headers.indexOf("location");
    const folderIdx = headers.indexOf("folder");
    const maintIdx = headers.indexOf("maintenanceintervaldays");

    if (nameIdx === -1) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "CSV_NAME_COLUMN_REQUIRED",
          message: "CSV must have a 'name' column",
          requestId,
        }),
      );
    }

    if (rows.length > CSV_MAX_ROWS) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "CSV_ROW_LIMIT_EXCEEDED",
          message: `CSV exceeds max ${CSV_MAX_ROWS} rows`,
          requestId,
        }),
      );
    }

    // Load existing serial numbers to detect duplicates against DB (exclude soft-deleted)
    const existingSerials = new Set<string>(
      (await db.select({ s: equipment.serialNumber }).from(equipment).where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt))))
        .map((r) => r.s)
        .filter((s): s is string => !!s)
        .map((s) => s.toLowerCase())
    );

    // Load folders by name for lookup (exclude soft-deleted)
    const allFolders = await db.select().from(folders).where(and(eq(folders.clinicId, clinicId), isNull(folders.deletedAt)));
    const folderByName = new Map<string, string>(
      allFolders.map((f) => [f.name.toLowerCase(), f.id])
    );

    type SkipEntry = { row: number; reason: string; data: Partial<CsvRow> };
    const skipped: SkipEntry[] = [];

    type InsertRow = {
      id: string;
      clinicId: string;
      name: string;
      serialNumber: string | null;
      status: string;
      location: string | null;
      folderId: string | null;
      maintenanceIntervalDays: number | null;
    };
    const toInsert: InsertRow[] = [];
    const seenSerials = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // 1-indexed, +1 for header
      const cols = rows[i];
      const get = (idx: number) => (idx >= 0 ? (cols[idx] ?? "").trim() : "");

      const name = get(nameIdx);
      const serial = get(serialIdx);
      const status = (get(statusIdx) || "ok").toLowerCase();
      const location = get(locationIdx);
      const folderName = get(folderIdx);
      const maintStr = get(maintIdx);

      const rowData: Partial<CsvRow> = { name, serial, status, location, folder: folderName };

      if (!name) {
        skipped.push({ row: rowNum, reason: "Name is required", data: rowData });
        continue;
      }
      if (name.length > FIELD_MAX_LENGTH) {
        skipped.push({ row: rowNum, reason: `Name exceeds ${FIELD_MAX_LENGTH} chars`, data: rowData });
        continue;
      }
      if (serial && serial.length > FIELD_MAX_LENGTH) {
        skipped.push({ row: rowNum, reason: `Serial exceeds ${FIELD_MAX_LENGTH} chars`, data: rowData });
        continue;
      }
      if (!VALID_IMPORT_STATUSES.has(status)) {
        skipped.push({
          row: rowNum,
          reason: `Invalid status "${status}" — must be ok, issue, maintenance, or sterilized`,
          data: rowData,
        });
        continue;
      }

      const serialLower = serial ? serial.toLowerCase() : null;
      if (serialLower) {
        if (existingSerials.has(serialLower)) {
          skipped.push({ row: rowNum, reason: `Serial "${serial}" already exists in the database`, data: rowData });
          continue;
        }
        if (seenSerials.has(serialLower)) {
          skipped.push({ row: rowNum, reason: `Duplicate serial "${serial}" within this CSV`, data: rowData });
          continue;
        }
        seenSerials.add(serialLower);
      }

      let maintenanceIntervalDays: number | null = null;
      if (maintStr) {
        const parsed = parseInt(maintStr, 10);
        if (isNaN(parsed) || parsed < 1) {
          skipped.push({ row: rowNum, reason: `maintenanceIntervalDays must be a positive integer (got "${maintStr}")`, data: rowData });
          continue;
        }
        maintenanceIntervalDays = parsed;
      }

      const folderId = folderName ? (folderByName.get(folderName.toLowerCase()) ?? null) : null;

      toInsert.push({
        id: randomUUID(),
        clinicId,
        name: name.trim(),
        serialNumber: serial || null,
        status,
        location: location || null,
        folderId,
        maintenanceIntervalDays,
      });
    }

    if (toInsert.length === 0) {
      return res.status(200).json({ inserted: 0, skipped });
    }

    await db.transaction(async (tx) => {
      // Insert in batches of 50 to avoid overwhelming the DB
      const BATCH = 50;
      for (let b = 0; b < toInsert.length; b += BATCH) {
        await tx.insert(equipment).values(toInsert.slice(b, b + BATCH));
      }
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_imported",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: null,
      targetType: "equipment",
      metadata: { inserted: toInsert.length, skipped: skipped.length },
    });

    invalidateAnalyticsCache(clinicId);
    res.json({ inserted: toInsert.length, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_IMPORT_FAILED",
        message: "Import failed",
        requestId,
      }),
    );
  }
});

router.post("/bulk-delete", requireAuth, writeLimiter, requireAdmin, validateBody(bulkIdsSchema), async (req, res) => {
const requestId = resolveRequestId(res, req.headers["x-request-id"]);
try {
    const clinicId = req.clinicId!;
    const { ids: typedIds } = req.body as z.infer<typeof bulkIdsSchema>;
    const actorName = req.authUser!.name || req.authUser!.email;

    await db.transaction(async (tx) => {
      const items = await tx
        .select({ id: equipment.id, name: equipment.name, status: equipment.status })
        .from(equipment)
        .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.id, typedIds), isNull(equipment.deletedAt)));

      const now = new Date();
      if (items.length > 0) {
        await tx.insert(scanLogs).values(
          items.map((item) => ({
            id: randomUUID(),
            clinicId,
            equipmentId: item.id,
            userId: req.authUser!.id,
            userEmail: req.authUser!.email,
            status: item.status,
            note: `Bulk deleted by ${actorName}`,
            timestamp: now,
          }))
        );

        await tx
          .update(equipment)
          .set({ deletedAt: now, deletedBy: req.authUser!.id })
          .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.id, items.map((i) => i.id))));
      }

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "equipment_bulk_deleted",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetId: null,
        targetType: "equipment",
        metadata: { ids: typedIds, count: typedIds.length },
      });
    });

    invalidateAnalyticsCache(clinicId);
    res.json({ affected: typedIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_BULK_DELETE_FAILED",
        message: "Bulk delete failed",
        requestId,
      }),
    );
  }
});

router.post("/bulk-move", requireAuth, writeLimiter, requireEffectiveRole("technician"), validateBody(bulkMoveSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { ids: typedIds, folderId } = req.body as z.infer<typeof bulkMoveSchema>;
    const targetFolderId = folderId ?? null;

    let targetFolderName: string | null = null;

    await db.transaction(async (tx) => {
      const [targetFolder] = targetFolderId
        ? await tx.select().from(folders).where(and(eq(folders.clinicId, clinicId), eq(folders.id, targetFolderId))).limit(1)
        : [null];
      targetFolderName = targetFolder?.name ?? null;
      const moveNote = `Bulk moved to ${targetFolderName ?? "Unassigned"} (${typedIds.length} item${typedIds.length !== 1 ? "s" : ""})`;

      for (const id of typedIds) {
        const [item] = await tx
          .select()
          .from(equipment)
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, id), isNull(equipment.deletedAt)))
          .limit(1);
        if (!item) continue;

        const [oldFolder] = item.folderId
          ? await tx.select().from(folders).where(and(eq(folders.clinicId, clinicId), eq(folders.id, item.folderId))).limit(1)
          : [null];

        await tx
          .update(equipment)
          .set({ folderId: targetFolderId })
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, id)));

        await tx.insert(transferLogs).values({
          id: randomUUID(),
          clinicId,
          equipmentId: id,
          fromFolderId: item.folderId ?? null,
          fromFolderName: oldFolder?.name ?? null,
          toFolderId: targetFolderId,
          toFolderName: targetFolder?.name ?? null,
          userId: req.authUser!.id,
          note: moveNote,
        });
      }
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_bulk_moved",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: targetFolderId,
      targetType: "folder",
      metadata: { ids: typedIds, count: typedIds.length, targetFolderName },
    });

    invalidateAnalyticsCache(clinicId);
    res.json({ affected: typedIds.length });

    const toLabel = targetFolderName ?? "Unassigned";
    sendPushToAll(clinicId, {
      title: "Bulk Transfer",
      body: `${typedIds.length} item${typedIds.length !== 1 ? "s" : ""} moved to ${toLabel}`,
      tag: `bulk-move:${Date.now()}`,
      url: "/",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_BULK_MOVE_FAILED",
        message: "Bulk move failed",
        requestId,
      }),
    );
  }
});

// POST /api/equipment/bulk-verify-room
// Marks every item in a room as verified and sets the room's sync status to 'synced'.
router.post(
  "/bulk-verify-room",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(bulkVerifyRoomSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const { roomId: targetRoomId } = req.body as z.infer<typeof bulkVerifyRoomSchema>;

      let affected = 0;
      let roomName = "";

      await db.transaction(async (tx) => {
        // 1. Confirm the room exists
        const [room] = await tx
          .select()
          .from(rooms)
          .where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, targetRoomId)))
          .limit(1);

        if (!room) {
          throw Object.assign(new Error("Room not found"), { status: 404 });
        }
        roomName = room.name;

        // 2. Fetch all active equipment in the room
        const items = await tx
          .select({ id: equipment.id, name: equipment.name, status: equipment.status })
          .from(equipment)
          .where(and(eq(equipment.clinicId, clinicId), eq(equipment.roomId, targetRoomId), isNull(equipment.deletedAt)));

        if (items.length === 0) {
          // Nothing to verify — still mark room synced
          await tx
            .update(rooms)
            .set({ syncStatus: "synced", lastAuditAt: new Date(), updatedAt: new Date() })
            .where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, targetRoomId)));
          return;
        }

        const now = new Date();
        const itemIds = items.map((i) => i.id);

        // 3. Stamp every item with lastVerifiedAt + lastVerifiedById + lastSeen
        await tx
          .update(equipment)
          .set({
            lastVerifiedAt: now,
            lastVerifiedById: req.authUser!.id,
            lastSeen: now,
          })
          .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.id, itemIds)));

        // 4. Insert a scan log entry per item for audit trail
        await tx.insert(scanLogs).values(
          items.map((item) => ({
            id: randomUUID(),
            clinicId,
            equipmentId: item.id,
            userId: req.authUser!.id,
            userEmail: req.authUser!.email,
            status: item.status,
            note: `Room verified: ${room.name}`,
            timestamp: now,
          }))
        );

        // 5. Update the room's sync status
        await tx
          .update(rooms)
          .set({ syncStatus: "synced", lastAuditAt: now, updatedAt: now })
          .where(and(eq(rooms.clinicId, clinicId), eq(rooms.id, targetRoomId)));

        affected = items.length;
      });

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "room_bulk_verified",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetId: targetRoomId,
        targetType: "room",
        metadata: { roomName, count: affected },
      });

      res.json({ affected, roomName });
    } catch (err: unknown) {
      if (err instanceof Error && (err as Error & { status?: number }).status === 404) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "ROOM_NOT_FOUND",
            message: "Room not found",
            requestId,
          }),
        );
      }
      console.error(err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "EQUIPMENT_BULK_VERIFY_FAILED",
          message: "Bulk verify failed",
          requestId,
        }),
      );
    }
  }
);

mountEquipmentWaitlistRoutes(router);

export default router;
