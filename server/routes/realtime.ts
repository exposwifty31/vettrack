import type { Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "crypto";
import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { requireAuth, requireDisplayOrUser, resolveDisplayAuth } from "../middleware/auth.js";
import { db, eventOutbox } from "../db.js";
import { outboxEmitter, type PublishedOutboxRow } from "../lib/event-publisher.js";
import { incrementMetric } from "../lib/metrics.js";
import { subscribe, unsubscribe } from "../lib/realtime.js";
import { recordStreamConnect, startKeepalive } from "../lib/code-blue-keepalive.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const MAX_OUTBOX_REPLAY = 1000;

// How often a display-authed SSE connection re-checks that its token is still
// active (F6). Bounds how long a revoked kiosk can keep streaming before the
// server closes its live connection. Kiosks are few, so a light DB read at this
// cadence is negligible; aligned with the ~10 s keepalive.
const DISPLAY_REVOCATION_RECHECK_MS = 10_000;
// Fail-closed after this many CONSECUTIVE failed re-checks (owner decision). A
// transient blip keeps the board alive, but a sustained resolver/DB outage lasting
// ~this×interval (5 × 10 s ≈ 50 s) closes the stream so a token revoked mid-outage
// cannot keep streaming until the DB recovers. A single successful recheck resets
// the streak. Accepted tradeoff: a genuine sustained outage also drops live boards
// after the cap, which then reconnect via the client's /board/pair path.
const DISPLAY_REVOCATION_MAX_CONSECUTIVE_ERRORS = 5;

/** Reject `promise` after `ms` if it hasn't settled, clearing the timer either way.
 *  Used to bound the revocation resolver so a HANGING lookup becomes a counted
 *  error instead of pinning `inFlight` forever (which would silently stop all
 *  future re-checks and let a revoked token stream indefinitely). */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * F6 — periodic revocation watch for a display-authed SSE connection. Every
 * `intervalMs`, re-validate the display token; on revocation (`resolveDisplay`
 * returns `!ok`) it invokes `onRevoked` (which closes the stream so the client's
 * existing 401 → /board/pair reconnect path takes over). Each recheck is bounded by
 * `timeoutMs` (defaults to `intervalMs`) so a hung resolver rejects into the error
 * path rather than pinning the in-flight flag forever. A transient resolver error
 * keeps the stream open and bumps a bounded counter — a rising count flags a
 * persistently-stuck recheck without flooding logs. After `maxConsecutiveErrors`
 * re-checks fail in a row (sustained outage OR sustained hang) the watch fails
 * CLOSED: it bumps `display_revocation_recheck_failclosed` and invokes `onRevoked`,
 * bounding how long a token revoked during the outage can survive. Any single
 * success resets the error streak. `resolveDisplay`, `intervalMs`,
 * `maxConsecutiveErrors`, and `timeoutMs` are injectable for tests. Returns a stop
 * function.
 *
 * ONLY display-authed connections are watched: a user (Clerk) connection is
 * re-authenticated per request, not here, so this returns a no-op stop for it (the
 * gate lives in the function so it is unit-testable, not only at the call site).
 * Overlapping checks are prevented with an in-flight flag — if a lookup outlasts
 * `intervalMs`, the next tick is skipped rather than piling up concurrent queries.
 */
export function startDisplayRevocationWatch(
  req: Request,
  onRevoked: () => void,
  resolveDisplay: (r: Request) => Promise<{ ok: boolean }> = resolveDisplayAuth,
  intervalMs: number = DISPLAY_REVOCATION_RECHECK_MS,
  maxConsecutiveErrors: number = DISPLAY_REVOCATION_MAX_CONSECUTIVE_ERRORS,
  timeoutMs: number = intervalMs,
): () => void {
  if (!req.isDisplayAuth) return () => {};
  let inFlight = false;
  let consecutiveErrors = 0;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void withTimeout(resolveDisplay(req), timeoutMs, "display revocation recheck timed out")
      .then((check) => {
        consecutiveErrors = 0; // a successful recheck clears the outage streak
        if (!check.ok) {
          stopped = true;
          onRevoked();
        }
      })
      .catch(() => {
        // A throw OR a timeout (hung resolver) lands here.
        consecutiveErrors += 1;
        incrementMetric("display_revocation_recheck_error");
        if (consecutiveErrors >= maxConsecutiveErrors) {
          // Sustained outage — fail closed so a revoked-during-outage token cannot
          // keep streaming indefinitely (distinct counter for ops separation).
          stopped = true;
          incrementMetric("display_revocation_recheck_failclosed");
          onRevoked();
        }
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

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

// Phase 9 PR 9.4 — code blue propagation latency buckets accepted via the
// existing telemetry endpoint. The set of allowed values is a closed enum;
// anything else is silently rejected (no new metric series).
const ALLOWED_CB_PROPAGATION_BUCKETS = ["lt_1s", "lt_3s", "lt_15s", "gte_15s"] as const;
type CbPropagationBucket = (typeof ALLOWED_CB_PROPAGATION_BUCKETS)[number];

function isAllowedPropagationBucket(value: unknown): value is CbPropagationBucket {
  return typeof value === "string" && (ALLOWED_CB_PROPAGATION_BUCKETS as readonly string[]).includes(value);
}

// T-30a2-i — nudge telemetry accepted via the existing telemetry endpoint.
// The set of allowed values is a closed enum; anything else is silently
// rejected (no new metric series) — mirrors ALLOWED_CB_PROPAGATION_BUCKETS.
const ALLOWED_NUDGE_SHOWN = ["expiry", "restock"] as const;
type NudgeShown = (typeof ALLOWED_NUDGE_SHOWN)[number];

function isAllowedNudgeShown(value: unknown): value is NudgeShown {
  return typeof value === "string" && (ALLOWED_NUDGE_SHOWN as readonly string[]).includes(value);
}

// R-BDF-1.3 — board anomaly activation telemetry accepted via the existing
// endpoint. The set of allowed types is a CLOSED enum (mirrors the shared
// BoardAnomalyType); each in-enum type maps 1:1 to a fixed metric id. Anything
// else is rejected via the shared enum-mismatch counter — no new metric series.
const ALLOWED_BOARD_ANOMALY_TYPES = ["battery_critical", "cart_unverified", "rfid_reader_offline"] as const;
type BoardAnomalyTelemetryType = (typeof ALLOWED_BOARD_ANOMALY_TYPES)[number];

function isAllowedBoardAnomalyType(value: unknown): value is BoardAnomalyTelemetryType {
  return typeof value === "string" && (ALLOWED_BOARD_ANOMALY_TYPES as readonly string[]).includes(value);
}

// Phase 9 PR 9.5 — offline emergency mutation blocking. Bounded enum; the
// sessionStorage buffer itself is never posted, only the endpoint class.
const ALLOWED_EMERGENCY_BLOCKED_CLASSES = ["start", "log", "end", "presence"] as const;
type EmergencyBlockedClass = (typeof ALLOWED_EMERGENCY_BLOCKED_CLASSES)[number];

function isAllowedEmergencyBlockedClass(value: unknown): value is EmergencyBlockedClass {
  return typeof value === "string" && (ALLOWED_EMERGENCY_BLOCKED_CLASSES as readonly string[]).includes(value);
}

// Phase 9 PR 9.7 — bounded enums for the remaining §3.9 telemetry surfaces.
const ALLOWED_FORCED_RESYNC_TRIGGERS = [
  "visibility",
  "pageshow",
  "online",
  "version_mismatch",
  "gap",
  "peer_ahead",
  "emergency_uncertain",
] as const;
type ForcedResyncTrigger = (typeof ALLOWED_FORCED_RESYNC_TRIGGERS)[number];
function isAllowedForcedResyncTrigger(value: unknown): value is ForcedResyncTrigger {
  return (
    typeof value === "string" &&
    (ALLOWED_FORCED_RESYNC_TRIGGERS as readonly string[]).includes(value)
  );
}

const ALLOWED_SW_RELOAD_SURFACES = ["active", "idle", "kiosk"] as const;
type SwReloadSurface = (typeof ALLOWED_SW_RELOAD_SURFACES)[number];
function isAllowedSwReloadSurface(value: unknown): value is SwReloadSurface {
  return (
    typeof value === "string" &&
    (ALLOWED_SW_RELOAD_SURFACES as readonly string[]).includes(value)
  );
}

// OFF-08 — bounded offline Dexie queue telemetry (closed enums only).
const ALLOWED_OFFLINE_SYNC_PENDING_BUCKETS = ["0", "1", "2_5", "6_plus"] as const;
type OfflineSyncPendingBucket = (typeof ALLOWED_OFFLINE_SYNC_PENDING_BUCKETS)[number];
function isAllowedOfflineSyncPendingBucket(value: unknown): value is OfflineSyncPendingBucket {
  return (
    typeof value === "string" &&
    (ALLOWED_OFFLINE_SYNC_PENDING_BUCKETS as readonly string[]).includes(value)
  );
}

const ALLOWED_OFFLINE_SYNC_OLDEST_AGE_BUCKETS = [
  "none",
  "lt_60s",
  "lt_5m",
  "lt_1h",
  "gte_1h",
] as const;
type OfflineSyncOldestAgeBucket = (typeof ALLOWED_OFFLINE_SYNC_OLDEST_AGE_BUCKETS)[number];
function isAllowedOfflineSyncOldestAgeBucket(value: unknown): value is OfflineSyncOldestAgeBucket {
  return (
    typeof value === "string" &&
    (ALLOWED_OFFLINE_SYNC_OLDEST_AGE_BUCKETS as readonly string[]).includes(value)
  );
}

const ALLOWED_OFFLINE_SYNC_DEAD_LETTER_BUCKETS = ["0", "1", "2_plus"] as const;
type OfflineSyncDeadLetterBucket = (typeof ALLOWED_OFFLINE_SYNC_DEAD_LETTER_BUCKETS)[number];
function isAllowedOfflineSyncDeadLetterBucket(value: unknown): value is OfflineSyncDeadLetterBucket {
  return (
    typeof value === "string" &&
    (ALLOWED_OFFLINE_SYNC_DEAD_LETTER_BUCKETS as readonly string[]).includes(value)
  );
}

const ALLOWED_OFFLINE_SYNC_CONFLICT_BUCKETS = ["0", "1_plus"] as const;
type OfflineSyncConflictBucket = (typeof ALLOWED_OFFLINE_SYNC_CONFLICT_BUCKETS)[number];
function isAllowedOfflineSyncConflictBucket(value: unknown): value is OfflineSyncConflictBucket {
  return (
    typeof value === "string" &&
    (ALLOWED_OFFLINE_SYNC_CONFLICT_BUCKETS as readonly string[]).includes(value)
  );
}

const ALLOWED_OFFLINE_SYNC_SESSION_BUCKETS = ["0", "1_5", "6_plus"] as const;
type OfflineSyncSessionBucket = (typeof ALLOWED_OFFLINE_SYNC_SESSION_BUCKETS)[number];
function isAllowedOfflineSyncSessionBucket(value: unknown): value is OfflineSyncSessionBucket {
  return (
    typeof value === "string" &&
    (ALLOWED_OFFLINE_SYNC_SESSION_BUCKETS as readonly string[]).includes(value)
  );
}

/** Best-effort client telemetry for duplicate sequence drops and gap-driven resyncs (see admin outbox-health). */
router.post("/telemetry", requireAuth, (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    // Phase 9 PR 9.7 — basic shape validation. The body must be a JSON
    // object; anything else (null, array, primitive) is silently rejected
    // and recorded in the bounded shape-rejection counter.
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      incrementMetric("telemetry_payload_rejected_shape");
      return res.status(200).json({ ok: true, requestId });
    }
    // All recognized fields are declared in a single type assertion so we
    // never re-cast `body` to read additional fields. Each field is
    // narrowed against its own bounded enum (or boolean) below; unknown
    // values are dropped silently into the bounded
    // `telemetry_payload_rejected_*` counters.
    const body = req.body as {
      duplicateDrop?: unknown;
      gapResync?: unknown;
      codeBluePropagationBucket?: unknown;
      nudgeShown?: unknown;
      codeBlueWakeRecovery?: unknown;
      codeBlueSnapshotFallback?: unknown;
      emergencyDegradedEntered?: unknown;
      emergencyDegradedRecovered?: unknown;
      offlineEmergencyMutationBlocked?: unknown;
      displayForcedResyncTrigger?: unknown;
      splitVersionClientDetected?: unknown;
      swUpdateConflict?: unknown;
      swForcedReloadSurface?: unknown;
      swForcedReloadLoopSuppressed?: unknown;
      displayWakeLockReacquireExhausted?: unknown;
      offlineSyncPendingCountBucket?: unknown;
      offlineSyncOldestPendingAgeBucket?: unknown;
      offlineSyncDeadLetterBucket?: unknown;
      offlineSyncConflictBucket?: unknown;
      offlineSyncSessionSuccessBucket?: unknown;
      offlineSyncSessionConflictBucket?: unknown;
      offlineSyncSessionDeadBucket?: unknown;
      syncPermanentFailure?: unknown;
      syncCircuitOpen?: unknown;
      boardAnomalyActivated?: unknown;
    };
    if (body?.duplicateDrop === true) {
      incrementMetric("realtime_duplicate_drops");
    }
    if (body?.gapResync === true) {
      incrementMetric("realtime_gap_resync");
    }
    // Phase 9 PR 9.4 — bounded enum validation. Invalid bucket values are
    // dropped without creating new metric series; the mismatch is recorded
    // in the bounded `telemetry_payload_rejected_enum_mismatch` counter so
    // there's an observability signal (matches the contract of every other
    // bounded-enum field in this handler).
    if (body?.codeBluePropagationBucket !== undefined) {
      if (isAllowedPropagationBucket(body.codeBluePropagationBucket)) {
        const bucket = body.codeBluePropagationBucket;
        if (bucket === "lt_1s") incrementMetric("code_blue_propagation_observed_lt_1s");
        else if (bucket === "lt_3s") incrementMetric("code_blue_propagation_observed_lt_3s");
        else if (bucket === "lt_15s") incrementMetric("code_blue_propagation_observed_lt_15s");
        else if (bucket === "gte_15s") incrementMetric("code_blue_propagation_observed_gte_15s");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    // T-30a2-i — bounded enum validation for nudge telemetry. Invalid
    // nudgeShown values are dropped without creating new metric series;
    // the mismatch is recorded in the same shared enum-mismatch counter
    // as every other bounded-enum field in this handler.
    if (body?.nudgeShown !== undefined) {
      if (isAllowedNudgeShown(body.nudgeShown)) {
        const bucket = body.nudgeShown;
        if (bucket === "expiry") incrementMetric("nudge_shown_expiry");
        else if (bucket === "restock") incrementMetric("nudge_shown_restock");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    if (body?.codeBlueWakeRecovery === true) incrementMetric("code_blue_wake_recovery");
    if (body?.codeBlueSnapshotFallback === true) incrementMetric("code_blue_snapshot_fallback");
    if (body?.emergencyDegradedEntered === true) incrementMetric("realtime_emergency_degraded");
    if (body?.emergencyDegradedRecovered === true) incrementMetric("realtime_emergency_degraded_recovered");
    // Phase 9 PR 9.5 — bounded enum validation. Invalid endpoint_class values
    // are dropped silently without creating new metric series.
    if (body?.offlineEmergencyMutationBlocked !== undefined) {
      if (isAllowedEmergencyBlockedClass(body.offlineEmergencyMutationBlocked)) {
        const blockedClass = body.offlineEmergencyMutationBlocked;
        if (blockedClass === "start") incrementMetric("offline_emergency_mutation_blocked_start");
        else if (blockedClass === "log") incrementMetric("offline_emergency_mutation_blocked_log");
        else if (blockedClass === "end") incrementMetric("offline_emergency_mutation_blocked_end");
        else if (blockedClass === "presence") incrementMetric("offline_emergency_mutation_blocked_presence");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }

    // Phase 9 PR 9.7 — display forced-resync triggers (bounded enum).
    if (body?.displayForcedResyncTrigger !== undefined) {
      if (isAllowedForcedResyncTrigger(body.displayForcedResyncTrigger)) {
        const trigger = body.displayForcedResyncTrigger;
        if (trigger === "visibility") incrementMetric("display_forced_resync_visibility");
        else if (trigger === "pageshow") incrementMetric("display_forced_resync_pageshow");
        else if (trigger === "online") incrementMetric("display_forced_resync_online");
        else if (trigger === "version_mismatch") incrementMetric("display_forced_resync_version_mismatch");
        else if (trigger === "gap") incrementMetric("display_forced_resync_gap");
        else if (trigger === "peer_ahead") incrementMetric("display_forced_resync_peer_ahead");
        else if (trigger === "emergency_uncertain") incrementMetric("display_forced_resync_emergency_uncertain");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }

    if (body?.splitVersionClientDetected === true) {
      incrementMetric("split_version_client_detected");
    }
    if (body?.swUpdateConflict === true) {
      incrementMetric("sw_update_conflict");
    }
    if (body?.swForcedReloadLoopSuppressed === true) {
      incrementMetric("sw_forced_reload_loop_suppressed");
    }
    if (body?.displayWakeLockReacquireExhausted === true) {
      incrementMetric("display_wake_lock_reacquire_exhausted");
    }
    const swReloadSurface = body?.swForcedReloadSurface;
    if (swReloadSurface !== undefined) {
      if (isAllowedSwReloadSurface(swReloadSurface)) {
        if (swReloadSurface === "active") incrementMetric("sw_forced_reload_active");
        else if (swReloadSurface === "idle") incrementMetric("sw_forced_reload_idle");
        else if (swReloadSurface === "kiosk") incrementMetric("sw_forced_reload_kiosk");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }

    // OFF-08 — offline queue aggregate buckets (one counter per field per report).
    if (body?.offlineSyncPendingCountBucket !== undefined) {
      const bucket = body.offlineSyncPendingCountBucket;
      if (isAllowedOfflineSyncPendingBucket(bucket)) {
        if (bucket === "0") incrementMetric("offline_sync_pending_reported_zero");
        else if (bucket === "1") incrementMetric("offline_sync_pending_reported_one");
        else if (bucket === "2_5") incrementMetric("offline_sync_pending_reported_two_to_five");
        else incrementMetric("offline_sync_pending_reported_six_plus");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    if (body?.offlineSyncOldestPendingAgeBucket !== undefined) {
      const bucket = body.offlineSyncOldestPendingAgeBucket;
      if (isAllowedOfflineSyncOldestAgeBucket(bucket)) {
        if (bucket === "none") incrementMetric("offline_sync_oldest_pending_none");
        else if (bucket === "lt_60s") incrementMetric("offline_sync_oldest_pending_lt_60s");
        else if (bucket === "lt_5m") incrementMetric("offline_sync_oldest_pending_lt_5m");
        else if (bucket === "lt_1h") incrementMetric("offline_sync_oldest_pending_lt_1h");
        else incrementMetric("offline_sync_oldest_pending_gte_1h");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    if (body?.offlineSyncDeadLetterBucket !== undefined) {
      const bucket = body.offlineSyncDeadLetterBucket;
      if (isAllowedOfflineSyncDeadLetterBucket(bucket)) {
        if (bucket === "0") incrementMetric("offline_sync_dead_letter_zero");
        else if (bucket === "1") incrementMetric("offline_sync_dead_letter_one");
        else incrementMetric("offline_sync_dead_letter_two_plus");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    if (body?.offlineSyncConflictBucket !== undefined) {
      const bucket = body.offlineSyncConflictBucket;
      if (isAllowedOfflineSyncConflictBucket(bucket)) {
        if (bucket === "0") incrementMetric("offline_sync_conflict_zero");
        else incrementMetric("offline_sync_conflict_one_plus");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    if (body?.offlineSyncSessionSuccessBucket !== undefined) {
      const bucket = body.offlineSyncSessionSuccessBucket;
      if (isAllowedOfflineSyncSessionBucket(bucket)) {
        if (bucket === "0") incrementMetric("offline_sync_session_success_zero");
        else if (bucket === "1_5") incrementMetric("offline_sync_session_success_one_to_five");
        else incrementMetric("offline_sync_session_success_six_plus");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    if (body?.offlineSyncSessionConflictBucket !== undefined) {
      const bucket = body.offlineSyncSessionConflictBucket;
      if (isAllowedOfflineSyncSessionBucket(bucket)) {
        if (bucket === "0") incrementMetric("offline_sync_session_conflict_zero");
        else if (bucket === "1_5") incrementMetric("offline_sync_session_conflict_one_to_five");
        else incrementMetric("offline_sync_session_conflict_six_plus");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    if (body?.offlineSyncSessionDeadBucket !== undefined) {
      const bucket = body.offlineSyncSessionDeadBucket;
      if (isAllowedOfflineSyncSessionBucket(bucket)) {
        if (bucket === "0") incrementMetric("offline_sync_session_dead_zero");
        else if (bucket === "1_5") incrementMetric("offline_sync_session_dead_one_to_five");
        else incrementMetric("offline_sync_session_dead_six_plus");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }

    // SYNC-TEL — sync engine permanent failure + circuit breaker (strict booleans).
    if (body?.syncPermanentFailure !== undefined) {
      if (body.syncPermanentFailure === true) {
        incrementMetric("offline_sync_permanent_failure");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }
    if (body?.syncCircuitOpen !== undefined) {
      if (body.syncCircuitOpen === true) {
        incrementMetric("offline_sync_circuit_open");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
    }

    // R-BDF-1.3 — board anomaly activation (closed enum → 1:1 metric id). The
    // client fires this once per (type,unitId) activation via the R-BDF-1.2
    // state-machine seam. Out-of-enum types bump the shared enum-mismatch
    // counter without creating a new metric series.
    if (body?.boardAnomalyActivated !== undefined) {
      if (isAllowedBoardAnomalyType(body.boardAnomalyActivated)) {
        const anomalyType = body.boardAnomalyActivated;
        if (anomalyType === "battery_critical") incrementMetric("board_anomaly_battery_critical");
        else if (anomalyType === "rfid_reader_offline") incrementMetric("board_anomaly_reader_offline");
        else if (anomalyType === "cart_unverified") incrementMetric("board_anomaly_cart_unverified");
      } else {
        incrementMetric("telemetry_payload_rejected_enum_mismatch");
      }
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
router.get("/stream", requireDisplayOrUser, async (req, res) => {
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

    // Phase 9 PR 9.4 — record this connect for reconnect-storm detection and
    // start the structured KEEPALIVE emitter for this connection. The
    // keepalive carries `activeCodeBlueSessionId` so the client can detect
    // missed CODE_BLUE_STARTED / CODE_BLUE_ENDED events and force a snapshot
    // refetch when its local view disagrees with the server.
    recordStreamConnect(clinicId);
    const stopKeepalive = startKeepalive(res, clinicId);

    // Phase 10 (F6) — enforce display-token revocation on the LIVE stream, not only
    // at connect. A revoked kiosk would otherwise keep receiving operational data on
    // its already-open SSE connection until it happened to reconnect. Additive auth
    // re-check — no transport, envelope, or keepalive change; user (non-display)
    // connections are unaffected. See startDisplayRevocationWatch above (tested).
    // Self-gates on req.isDisplayAuth (no-op stop for user connections).
    const stopRevocationWatch = startDisplayRevocationWatch(req, () => finalize());

    finalize = () => {
      if (cleaned) return;
      cleaned = true;
      stopKeepalive();
      stopRevocationWatch();
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
