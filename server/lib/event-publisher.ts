import { EventEmitter } from "node:events";
import { inArray, sql } from "drizzle-orm";
import { db, eventOutbox } from "../db.js";
import { incrementMetric } from "./metrics.js";
import { classifyOutboxPublishError } from "./outbox-error-classification.js";

const POLL_MS = 750;
const BATCH_SIZE = 100;

/** First backoff delay after a failed publish (ms); delay scales as `base * 2^retry_count` (post-increment). */
const OUTBOX_BACKOFF_BASE_MS = 500;
/** Maximum delay before the next publish attempt (5 minutes). */
const OUTBOX_BACKOFF_MAX_MS = 5 * 60 * 1000;

/** After this many recorded failures, row is auto-DLQ (`error_type = permanent`, no backoff). */
export const OUTBOX_MAX_RETRY_COUNT = 50;

/** Event type string stored on `vt_event_outbox.type` for audit-derived rows. */
export const OUTBOX_TYPE_AUDIT_LOG = "audit_log";

export type PublishedOutboxRow = {
  /** Monotonic BIGSERIAL — deterministic processing order with ORDER BY id ASC. */
  id: number;
  clinicId: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
  publishedAt: Date;
  eventVersion: number;
  /** Severity for client-side prioritisation: INFO | WARNING | CRITICAL */
  level: string;
  /** Domain category for filtering: TASK | PATIENT | INVENTORY | ALERT | SYSTEM */
  category: string;
};

/** Emits after rows are committed as published (`published` / row.type / clinic-scoped). */
export const outboxEmitter = new EventEmitter();
/** Many concurrent SSE clients may listen per clinic; avoid MaxListenersExceededWarning. */
outboxEmitter.setMaxListeners(0);

let publisherStarted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Prevents overlapping batches from the poll interval firing during a slow/failed publish. */
let publishBatchInFlight = false;

function parseOccurredAt(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return new Date();
}

async function publishOneBatch(): Promise<void> {
  if (publishBatchInFlight) return;
  publishBatchInFlight = true;

  /** Set while a batch is in-flight; if the transaction fails, these rows get retry metadata. Cleared after commit. */
  let failedBatchIds: number[] = [];

  try {
    const rows = await db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id, clinic_id, type, payload, occurred_at, event_version, level, category
        FROM vt_event_outbox
        WHERE published_at IS NULL
          AND (error_type IS NULL OR error_type <> 'permanent')
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY id ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);

      const raw = locked.rows as Array<{
        id: string | number;
        clinic_id: string;
        type: string;
        payload: unknown;
        occurred_at: Date | string;
        event_version: number;
        level: string;
        category: string;
      }>;

      if (raw.length === 0) return [];

      const ids = raw.map((r) => Number(r.id));
      failedBatchIds = ids;
      const publishedAt = new Date();

      await tx
        .update(eventOutbox)
        .set({ publishedAt })
        .where(inArray(eventOutbox.id, ids));

      return raw.map((r) => ({
        id: Number(r.id),
        clinicId: r.clinic_id,
        type: r.type,
        payload: r.payload,
        occurredAt: parseOccurredAt(r.occurred_at),
        publishedAt,
        eventVersion: Number(r.event_version ?? 1),
        level: r.level ?? "INFO",
        category: r.category ?? "SYSTEM",
      })) satisfies PublishedOutboxRow[];
    });

    failedBatchIds = [];

    for (const row of rows) {
      try {
        outboxEmitter.emit("published", row);
        outboxEmitter.emit(row.type, row);
        outboxEmitter.emit(`clinic:${row.clinicId}`, row);
      } catch (err) {
        console.error("[event-outbox] listener error (row already marked published):", {
          id: row.id,
          err: err instanceof Error ? err.message : err,
        });
      }
    }
  } catch (err) {
    if (failedBatchIds.length > 0) {
      const errorType = classifyOutboxPublishError(err);
      const classifiedPermanent = errorType === "permanent";
      try {
        await db.execute(sql`
          UPDATE vt_event_outbox AS o
          SET
            last_attempt_at = NOW(),
            retry_count = CASE
              WHEN o.retry_count >= ${OUTBOX_MAX_RETRY_COUNT} THEN o.retry_count
              ELSE o.retry_count + 1
            END,
            error_type = CASE
              WHEN o.retry_count >= ${OUTBOX_MAX_RETRY_COUNT} THEN 'permanent'
              WHEN ${classifiedPermanent} THEN 'permanent'
              ELSE 'transient'
            END,
            next_attempt_at = CASE
              WHEN o.retry_count >= ${OUTBOX_MAX_RETRY_COUNT} THEN NULL
              WHEN ${classifiedPermanent} THEN NULL
              ELSE NOW() + (
                LEAST(
                  ${OUTBOX_BACKOFF_MAX_MS},
                  (${OUTBOX_BACKOFF_BASE_MS} * POWER(2::double precision, (o.retry_count + 1)::double precision))::bigint
                )::double precision * (0.5 + random())
              ) * INTERVAL '1 millisecond'
            END
          WHERE o.id IN (${sql.join(
            failedBatchIds.map((id) => sql`${id}`),
            sql`, `,
          )})
        `);
      } catch (metaErr) {
        console.error("[event-outbox] failed to record retry metadata:", {
          ids: failedBatchIds,
          err: metaErr instanceof Error ? metaErr.message : metaErr,
        });
      }
      // Yield so retries cannot stack synchronously in the same turn as metadata writes;
      // the next attempt runs after the poll interval / microtask queue drains.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw err;
  } finally {
    publishBatchInFlight = false;
  }
}

/**
 * Polls unpublished outbox rows, marks them published, and emits on {@link outboxEmitter}.
 * Safe across processes via `FOR UPDATE SKIP LOCKED`.
 */
export function startEventOutboxPublisher(): void {
  if (process.env.NODE_ENV === "test") return;
  if (publisherStarted) return;
  publisherStarted = true;

  const tick = (): void => {
    void publishOneBatch().catch((err) => {
      incrementMetric("outbox_failed_publish_attempts");
      console.error("[event-outbox] publish batch failed:", err instanceof Error ? err.message : err);
    });
  };

  tick();
  pollTimer = setInterval(tick, POLL_MS);
}

/** Test hooks / graceful shutdown (optional). */
export function stopEventOutboxPublisherForTests(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  publisherStarted = false;
  publishBatchInFlight = false;
}
