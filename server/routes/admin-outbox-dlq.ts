import { Router, type Response } from "express";
import { randomUUID } from "crypto";
import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { deadLetterConditionForClinic } from "../lib/outbox-health.js";
import { db, eventOutbox } from "../db.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";

const router = Router();

const MAX_DROP_IDS = 500;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function parseDlqListLimit(raw: unknown): { ok: true; limit: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, limit: DEFAULT_LIST_LIMIT };
  }
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: "limit must be a positive integer" };
  }
  if (n > MAX_LIST_LIMIT) {
    return { ok: false, error: `limit must be at most ${MAX_LIST_LIMIT}` };
  }
  return { ok: true, limit: n };
}

function parseDlqListCursor(raw: unknown): { ok: true; cursor?: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true };
  }
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: "cursor must be a positive integer" };
  }
  return { ok: true, cursor: n };
}

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

function parsePositiveIntIds(body: unknown): { ok: false; error: string } | { ok: true; ids: number[] } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const raw = (body as Record<string, unknown>).ids;
  if (!Array.isArray(raw)) {
    return { ok: false, error: "ids must be a non-empty array of positive integers" };
  }
  const ids: number[] = [];
  for (const x of raw) {
    if (typeof x !== "number" || !Number.isInteger(x) || x <= 0) {
      return { ok: false, error: "Each id must be a positive integer" };
    }
    ids.push(x);
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return { ok: false, error: "ids must be a non-empty array of positive integers" };
  }
  if (unique.length > MAX_DROP_IDS) {
    return { ok: false, error: `At most ${MAX_DROP_IDS} ids per request` };
  }
  return { ok: true, ids: unique };
}

/**
 * GET /api/admin/outbox/dlq
 * Paginated dead-letter rows for the clinic (no full payload).
 */
router.get("/outbox/dlq", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      res.status(400).json({
        code: "MISSING_CLINIC_ID",
        error: "MISSING_CLINIC_ID",
        reason: "MISSING_CLINIC_ID",
        message: "clinicId is required",
        requestId,
      });
      return;
    }

    const limitParsed = parseDlqListLimit(req.query.limit);
    if (!limitParsed.ok) {
      res.status(400).json({
        code: "INVALID_QUERY",
        error: "INVALID_QUERY",
        reason: "INVALID_QUERY",
        message: limitParsed.error,
        requestId,
      });
      return;
    }

    const cursorParsed = parseDlqListCursor(req.query.cursor);
    if (!cursorParsed.ok) {
      res.status(400).json({
        code: "INVALID_QUERY",
        error: "INVALID_QUERY",
        reason: "INVALID_QUERY",
        message: cursorParsed.error,
        requestId,
      });
      return;
    }

    const limit = limitParsed.limit;
    const dlqWhere = deadLetterConditionForClinic(clinicId);
    const whereClause =
      cursorParsed.cursor != null
        ? and(dlqWhere, lt(eventOutbox.id, cursorParsed.cursor))
        : dlqWhere;

    const rows = await db
      .select({
        id: eventOutbox.id,
        type: eventOutbox.type,
        occurredAt: eventOutbox.occurredAt,
        retryCount: eventOutbox.retryCount,
        errorType: eventOutbox.errorType,
        lastAttemptAt: eventOutbox.lastAttemptAt,
        nextAttemptAt: eventOutbox.nextAttemptAt,
      })
      .from(eventOutbox)
      .where(whereClause)
      .orderBy(desc(eventOutbox.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : undefined;

    res.status(200).json({
      clinicId,
      items: page.map((row) => ({
        id: row.id,
        type: row.type,
        occurredAt: row.occurredAt,
        retryCount: row.retryCount,
        errorType: row.errorType,
        lastAttemptAt: row.lastAttemptAt,
        nextAttemptAt: row.nextAttemptAt,
      })),
      ...(nextCursor != null ? { nextCursor } : {}),
      requestId,
    });
  } catch (err) {
    console.error("[admin-outbox-dlq] list failed", err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      reason: "INTERNAL_ERROR",
      message: "Failed to list dead letter outbox rows",
      requestId,
    });
  }
});

/**
 * POST /api/admin/outbox/dlq/retry
 * Reset retry metadata on all clinic dead-letter outbox rows so the publisher will retry them.
 */
router.post("/outbox/dlq/retry", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      res.status(400).json({
        code: "MISSING_CLINIC_ID",
        error: "MISSING_CLINIC_ID",
        reason: "MISSING_CLINIC_ID",
        message: "clinicId is required",
        requestId,
      });
      return;
    }

    const force =
      req.body !== null &&
      typeof req.body === "object" &&
      !Array.isArray(req.body) &&
      (req.body as Record<string, unknown>).force === true;

    const permanentDlq = await db
      .select({ n: count() })
      .from(eventOutbox)
      .where(and(deadLetterConditionForClinic(clinicId), eq(eventOutbox.errorType, "permanent")));
    const permanentCount = Number(permanentDlq[0]?.n ?? 0);

    if (permanentCount > 0 && !force) {
      res.status(400).json({
        code: "PERMANENT_DLQ_REQUIRES_FORCE",
        error: "PERMANENT_DLQ_REQUIRES_FORCE",
        reason: "PERMANENT_DLQ_REQUIRES_FORCE",
        message:
          "Dead letter queue contains permanent (terminal) publish failures. Set force: true to retry them anyway.",
        permanentCount,
        requestId,
      });
      return;
    }

    const auth = req.authUser!;
    const updated = await db
      .update(eventOutbox)
      .set({ retryCount: 0, lastAttemptAt: null, errorType: null, nextAttemptAt: null })
      .where(deadLetterConditionForClinic(clinicId))
      .returning({ id: eventOutbox.id });

    const resetCount = updated.length;
    const allIds = updated.map((r) => r.id).sort((a, b) => a - b);
    const AUDIT_ID_CAP = 500;
    const resetIdsTruncated = allIds.length > AUDIT_ID_CAP;

    logAudit({
      clinicId,
      actionType: "outbox_dlq_retry_all",
      performedBy: auth.id,
      performedByEmail: auth.email,
      targetType: "vt_event_outbox",
      metadata: {
        resetCount,
        requestId,
        force: Boolean(force),
        resetIds: resetIdsTruncated ? allIds.slice(0, AUDIT_ID_CAP) : allIds,
        resetIdsTruncated,
      },
      actorRole: resolveAuditActorRole(req),
    });

    res.status(200).json({
      clinicId,
      resetCount,
      requestId,
    });
  } catch (err) {
    console.error("[admin-outbox-dlq] retry failed", err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      reason: "INTERNAL_ERROR",
      message: "Failed to reset dead letter outbox rows",
      requestId,
    });
  }
});

/**
 * POST /api/admin/outbox/dlq/drop
 * Permanently delete specific dead-letter rows by id (toxic payloads). Non-DLQ ids are skipped.
 */
router.post("/outbox/dlq/drop", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      res.status(400).json({
        code: "MISSING_CLINIC_ID",
        error: "MISSING_CLINIC_ID",
        reason: "MISSING_CLINIC_ID",
        message: "clinicId is required",
        requestId,
      });
      return;
    }

    const parsed = parsePositiveIntIds(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        code: "INVALID_BODY",
        error: "INVALID_BODY",
        reason: "INVALID_BODY",
        message: parsed.error,
        requestId,
      });
      return;
    }

    const auth = req.authUser!;
    const dlqIdsQuery = and(deadLetterConditionForClinic(clinicId), inArray(eventOutbox.id, parsed.ids));

    const deleted = await db.delete(eventOutbox).where(dlqIdsQuery).returning({ id: eventOutbox.id });

    const deletedIds = deleted.map((r) => r.id);
    const deletedSet = new Set(deletedIds);
    const skippedIds = parsed.ids.filter((id) => !deletedSet.has(id));

    logAudit({
      clinicId,
      actionType: "outbox_dlq_drop",
      performedBy: auth.id,
      performedByEmail: auth.email,
      targetType: "vt_event_outbox",
      metadata: {
        requestedIds: parsed.ids,
        deletedIds,
        skippedIds,
        deletedCount: deletedIds.length,
        requestId,
      },
      actorRole: resolveAuditActorRole(req),
    });

    res.status(200).json({
      clinicId,
      deletedCount: deletedIds.length,
      deletedIds,
      skippedIds,
      requestId,
    });
  } catch (err) {
    console.error("[admin-outbox-dlq] drop failed", err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      reason: "INTERNAL_ERROR",
      message: "Failed to delete dead letter outbox rows",
      requestId,
    });
  }
});

export default router;
