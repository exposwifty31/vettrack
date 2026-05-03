import type { Response } from "express";
import { Router } from "express";
import { randomUUID } from "crypto";
import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { db, eventOutbox } from "../db.js";
import { outboxEmitter, type PublishedOutboxRow } from "../lib/event-publisher.js";
import { incrementMetric } from "../lib/metrics.js";
import { subscribe, unsubscribe } from "../lib/realtime.js";

const MAX_OUTBOX_REPLAY = 1000;

function parseLastEventId(header: unknown): number | undefined {
  if (typeof header !== "string") return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined;
  return n;
}

function parseFromIdQuery(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/** SSE JSON: `id` matches `vt_event_outbox.id` / SSE `id:` for resume and client ordering. */
function outboxRowToSse(row: PublishedOutboxRow): string {
  const envelope = {
    type: row.type,
    payload: row.payload,
    timestamp: row.occurredAt.toISOString(),
    id: row.id,
    outboxId: row.id,
    eventVersion: row.eventVersion,
    level: row.level ?? "INFO",
    category: row.category ?? "SYSTEM",
  };
  return `id: ${row.id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/** Client resume cursor points at a pruned row — force full snapshot resync (no SSE `id:` line). */
function resetStateSse(reason: "last_event_unknown" | "last_event_pruned"): string {
  const envelope = {
    type: "RESET_STATE" as const,
    payload: { reason },
    timestamp: new Date().toISOString(),
  };
  return `data: ${JSON.stringify(envelope)}\n\n`;
}

function safeWriteSse(res: Response, chunk: string): boolean {
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

async function replayPublishedOutboxAfter(
  clinicId: string,
  afterId: number,
  res: Response,
): Promise<boolean> {
  const rows = await db
    .select({
      id: eventOutbox.id,
      clinicId: eventOutbox.clinicId,
      type: eventOutbox.type,
      payload: eventOutbox.payload,
      occurredAt: eventOutbox.occurredAt,
      publishedAt: eventOutbox.publishedAt,
      eventVersion: eventOutbox.eventVersion,
      level: eventOutbox.level,
      category: eventOutbox.category,
    })
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.clinicId, clinicId),
        gt(eventOutbox.id, afterId),
        isNotNull(eventOutbox.publishedAt),
      ),
    )
    .orderBy(asc(eventOutbox.id))
    .limit(MAX_OUTBOX_REPLAY);

  for (const row of rows) {
    const publishedAt = row.publishedAt;
    if (publishedAt === null) continue;
    const published: PublishedOutboxRow = {
      id: row.id,
      clinicId: row.clinicId,
      type: row.type,
      payload: row.payload,
      occurredAt: row.occurredAt,
      publishedAt,
      eventVersion: row.eventVersion,
      level: row.level ?? "INFO",
      category: row.category ?? "SYSTEM",
    };
    if (!safeWriteSse(res, outboxRowToSse(published))) return false;
    incrementMetric("realtime_events_sent");
  }
  return true;
}

async function outboxRowExistsForClinic(clinicId: string, outboxId: number): Promise<boolean> {
  const rows = await db
    .select({ id: eventOutbox.id })
    .from(eventOutbox)
    .where(and(eq(eventOutbox.clinicId, clinicId), eq(eventOutbox.id, outboxId)))
    .limit(1);
  return rows.length > 0;
}

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

/** JSON batch replay — **published** outbox rows only (`published_at IS NOT NULL`), ordered by `id`. */
router.get("/replay", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      res.status(400).json(
        apiError({
          code: "MISSING_CLINIC_ID",
          reason: "MISSING_CLINIC_ID",
          message: "clinicId is required",
          requestId,
        }),
      );
      return;
    }

    const fromId = parseFromIdQuery(req.query["from_id"]);
    if (fromId === undefined) {
      res.status(400).json(
        apiError({
          code: "BAD_REQUEST",
          reason: "INVALID_FROM_ID",
          message: "from_id is required (non-negative integer)",
          requestId,
        }),
      );
      return;
    }

    const rows = await db
      .select({
        id: eventOutbox.id,
        clinicId: eventOutbox.clinicId,
        type: eventOutbox.type,
        payload: eventOutbox.payload,
        occurredAt: eventOutbox.occurredAt,
        publishedAt: eventOutbox.publishedAt,
        eventVersion: eventOutbox.eventVersion,
        level: eventOutbox.level,
        category: eventOutbox.category,
      })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.clinicId, clinicId),
          gt(eventOutbox.id, fromId),
          isNotNull(eventOutbox.publishedAt),
        ),
      )
      .orderBy(asc(eventOutbox.id))
      .limit(MAX_OUTBOX_REPLAY);

    const events = rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      timestamp: row.occurredAt.toISOString(),
      outboxId: row.id,
      eventVersion: row.eventVersion,
      level: row.level ?? "INFO",
      category: row.category ?? "SYSTEM",
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    }));

    res.status(200).json({
      events,
      hasMore: rows.length >= MAX_OUTBOX_REPLAY,
      requestId,
    });
  } catch (err) {
    console.error("[realtime-route] replay failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "REALTIME_REPLAY_FAILED",
        message: "Failed to load replay batch",
        requestId: resolveRequestId(res, req.headers["x-request-id"]),
      }),
    );
  }
});

/** Latest published monotonic id for this clinic (ward/ER cursor baseline after resync). */
router.get("/outbox-head", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      res.status(400).json(
        apiError({
          code: "MISSING_CLINIC_ID",
          reason: "MISSING_CLINIC_ID",
          message: "clinicId is required",
          requestId,
        }),
      );
      return;
    }

    const rows = await db
      .select({
        maxPublishedId: sql<number>`coalesce(max(${eventOutbox.id}), 0)::int`,
      })
      .from(eventOutbox)
      .where(and(eq(eventOutbox.clinicId, clinicId), isNotNull(eventOutbox.publishedAt)));

    const maxPublishedId = Number(rows[0]?.maxPublishedId ?? 0);
    res.status(200).json({ maxPublishedId, requestId });
  } catch (err) {
    console.error("[realtime-route] outbox-head failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "OUTBOX_HEAD_FAILED",
        message: "Failed to load outbox head",
        requestId,
      }),
    );
  }
});

/** Best-effort client telemetry for duplicate sequence drops and gap-driven resyncs (see admin outbox-health). */
router.post("/telemetry", requireAuth, (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const body = req.body as { duplicateDrop?: unknown; gapResync?: unknown };
    if (body?.duplicateDrop === true) {
      incrementMetric("realtime_duplicate_drops");
    }
    if (body?.gapResync === true) {
      incrementMetric("realtime_gap_resync");
    }
    res.status(200).json({ ok: true, requestId });
  } catch (err) {
    console.error("[realtime-route] telemetry failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "REALTIME_TELEMETRY_FAILED",
        message: "Failed to record telemetry",
        requestId,
      }),
    );
  }
});

/** Outbox-backed SSE; all domain events use monotonic `vt_event_outbox.id` (`Last-Event-ID` resume). */
router.get("/stream", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      res.status(400).json(
        apiError({
          code: "MISSING_CLINIC_ID",
          reason: "MISSING_CLINIC_ID",
          message: "clinicId is required",
          requestId,
        }),
      );
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const lastEventId = parseLastEventId(req.headers["last-event-id"]);
    if (lastEventId !== undefined && lastEventId > 0) {
      try {
        const exists = await outboxRowExistsForClinic(clinicId, lastEventId);
        if (!exists) {
          if (!safeWriteSse(res, resetStateSse("last_event_pruned"))) return;
        }
        const ok = await replayPublishedOutboxAfter(clinicId, lastEventId, res);
        if (!ok) return;
      } catch (replayErr) {
        console.error("[realtime-route] outbox replay failed", replayErr);
        try {
          res.end();
        } catch {
          // Ignore close errors.
        }
        return;
      }
    }

    let cleaned = false;
    let finalize: () => void;
    const onOutbox = (row: PublishedOutboxRow) => {
      if (!safeWriteSse(res, outboxRowToSse(row))) finalize();
      else incrementMetric("realtime_events_sent");
    };

    finalize = () => {
      if (cleaned) return;
      cleaned = true;
      outboxEmitter.off(`clinic:${clinicId}`, onOutbox);
      unsubscribe(res);
      try {
        res.end();
      } catch {
        // Ignore close errors.
      }
    };

    subscribe(clinicId, res);
    outboxEmitter.on(`clinic:${clinicId}`, onOutbox);

    req.on("close", finalize);
  } catch (err) {
    console.error("[realtime-route] stream failed", err);
    if (!res.headersSent) {
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "REALTIME_STREAM_FAILED",
          message: "Failed to open realtime stream",
          requestId,
        }),
      );
    }
  }
});

router.get("/", requireAuth, (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      res.status(400).json(
        apiError({
          code: "MISSING_CLINIC_ID",
          reason: "MISSING_CLINIC_ID",
          message: "clinicId is required",
          requestId,
        }),
      );
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    subscribe(clinicId, res);

    req.on("close", () => {
      unsubscribe(res);
      try {
        res.end();
      } catch {
        // Ignore close errors.
      }
    });
  } catch (err) {
    console.error("[realtime-route] failed to subscribe", err);
    if (!res.headersSent) {
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "REALTIME_SUBSCRIBE_FAILED",
          message: "Failed to subscribe to realtime stream",
          requestId,
        }),
      );
    }
  }
});

export default router;
