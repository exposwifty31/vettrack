import { createHash } from "node:crypto";

import type { MovementEvent } from "./aggregate";
import {
  RFID_LIMITS,
  validateRfidBatch,
  type RfidBatch,
  type RfidBatchEvent,
} from "./contract";

/**
 * Module 5 — envelope builder.
 *
 * Wraps movement events into the signed `{batchId, controllerVersion, events}`
 * body. Two invariants matter:
 *   1. `readAt` is serialized via `Date.toISOString()` (RFC-3339 `Z`), never
 *      `Date.toString()` — the route's strict `z.string().datetime()` 400s
 *      otherwise.
 *   2. Only `{tagEpc, gatewayCode, readAt}` reach the wire. Directional emission
 *      is DELIBERATELY DEFERRED. Post-R-M1 the route schema DOES accept optional
 *      directional fields (`direction` enum + a both-or-neither `fromGateway`/
 *      `toGateway` pair; a partial pair is a HARD reject, not a silent strip) —
 *      and the Module 0 contract validates that same shape for parity. But the
 *      controller has no gateway-role geometry to classify entered vs exited
 *      (hardware-track, ADR-004/006), so emitting a partial directional payload
 *      would be incomplete evidence. It therefore emits the minimal safe subset
 *      and leaves directional emission to the hardware direction track; the
 *      internal `MovementEvent.fromGateway` is retained for logging only. This
 *      is a documented deferral, not an accidental gap: the schema/contract are
 *      already ready, so `toWireEvent` can additively surface the gateway pair
 *      later without touching validation.
 *
 * The body is serialized ONCE and returned as the exact bytes to sign and send
 * (Module 6 must sign THIS buffer and Module 8 must POST THIS buffer — any
 * re-serialization between sign and send breaks the HMAC).
 */
export interface EnvelopeOptions {
  controllerVersion?: string;
  /** Override the derived deterministic batchId. */
  batchId?: string;
}

export interface Envelope {
  batch: RfidBatch;
  /** Canonical UTF-8 bytes of `batch` — sign and send exactly these. */
  body: Buffer;
}

function toWireEvent(m: MovementEvent): RfidBatchEvent {
  return {
    tagEpc: m.tagEpc,
    gatewayCode: m.gatewayCode,
    readAt: m.readAt.toISOString(),
  };
}

/** Deterministic 64-char batchId from event content (idempotent retries). */
function deriveBatchId(events: RfidBatchEvent[]): string {
  const hash = createHash("sha256").update(JSON.stringify(events)).digest("hex");
  // sha256 hex is exactly 64 chars — the batchId max.
  return hash.slice(0, RFID_LIMITS.batchId.max);
}

export function buildEnvelope(events: MovementEvent[], opts: EnvelopeOptions = {}): Envelope {
  const wireEvents = events.map(toWireEvent);
  const batchId = opts.batchId ?? deriveBatchId(wireEvents);

  const batch: RfidBatch = {
    batchId,
    ...(opts.controllerVersion !== undefined ? { controllerVersion: opts.controllerVersion } : {}),
    events: wireEvents,
  };

  const validation = validateRfidBatch(batch);
  if (!validation.ok) {
    throw new Error(
      `buildEnvelope: batch failed the canonical contract: ${validation.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ")}`,
    );
  }

  const body = Buffer.from(JSON.stringify(batch), "utf8");
  if (body.length > RFID_LIMITS.maxBodyBytes) {
    throw new Error(
      `buildEnvelope: body ${body.length}B exceeds ${RFID_LIMITS.maxBodyBytes}B cap`,
    );
  }

  return { batch, body };
}
