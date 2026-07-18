/**
 * Module 0 — the vendor-neutral RFID contract (ADR-006), zero runtime deps.
 *
 * This is the controller's single source of truth for what it emits: the
 * canonical header names, the `sha256=<hex>` signature format, the ingest
 * limits, and a hand-rolled batch validator that mirrors the server's zod
 * `RfidBatchSchema` byte-for-byte. `tests/contract-parity.test.ts` imports the
 * real route schema as a drift oracle so any divergence fails CI.
 *
 * Why hand-rolled and not zod: the controller ships with NO runtime deps
 * (HTTP via global fetch), so it cannot depend on zod. The parity test is the
 * safety net that keeps this validator honest against the real schema.
 */

/** Canonical, brand-cased header names. Node lowercases these on the wire to
 *  `x-vettrack-*` (two `t`s) — the spelling the route now authenticates on. */
export const RFID_HEADERS = {
  clinic: "X-VetTrack-Clinic",
  signature: "X-VetTrack-Signature",
} as const;

/** Signature header value prefix: `sha256=<lowercase-hex>`. */
export const SIGNATURE_PREFIX = "sha256=" as const;

/** Ingest limits, mirrored from `server/routes/rfid.ts` + `rate-limiters.ts`. */
export const RFID_LIMITS = {
  maxEventsPerBatch: 200,
  maxRequestsPerMinute: 120,
  maxBodyBytes: 512 * 1024,
  batchId: { min: 1, max: 64 },
  controllerVersion: { max: 32 },
  tagEpc: { min: 1, max: 128 },
  gatewayCode: { min: 1, max: 64 },
  // R-M1.2a — fromGateway/toGateway share gatewayCode's 1..64 bound.
  fromGateway: { min: 1, max: 64 },
  toGateway: { min: 1, max: 64 },
} as const;

/** R-M1.2a — the closed movement-direction enum (mirrors the route's zod enum). */
export const RFID_DIRECTIONS = ["entered", "exited"] as const;
export type RfidDirection = (typeof RFID_DIRECTIONS)[number];

/**
 * One movement event as it travels on the wire (readAt = RFC-3339 UTC string).
 *
 * R-M1.2a directional evidence is OPTIONAL: a payload MAY carry `direction`, the
 * `fromGateway`/`toGateway` pair, both, or neither. The gateway pair is
 * BOTH-or-NEITHER — a partial pair is invalid (never a silent downgrade). These
 * mirror the exported `RfidBatchSchema`; `tests/contract-parity.test.ts` pins it.
 */
export interface RfidBatchEvent {
  tagEpc: string;
  gatewayCode: string;
  readAt: string;
  direction?: RfidDirection;
  fromGateway?: string;
  toGateway?: string;
}

/** The signed batch body POSTed to `/api/rfid/events`. */
export interface RfidBatch {
  batchId: string;
  controllerVersion?: string;
  events: RfidBatchEvent[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export type RfidBatchValidation =
  | { ok: true; value: RfidBatch }
  | { ok: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// RFC-3339 UTC validation — copied verbatim from zod v3's `datetimeRegex`
// construction for the default (no offset, no local, no fixed precision) so
// `readAt` acceptance matches `z.string().datetime()` exactly. The parity test
// pins this against the live schema; if zod's regex ever changes, it fails.
// ---------------------------------------------------------------------------
const RFC3339_DATE =
  "((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|" +
  "\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))";
const RFC3339_TIME = "([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?";
const RFC3339_UTC = new RegExp(`^${RFC3339_DATE}T${RFC3339_TIME}Z$`);

/** True iff `s` is an RFC-3339 UTC (`...Z`) instant the ingest will accept. */
export function isValidReadAt(s: string): boolean {
  return RFC3339_UTC.test(s);
}

/** `sha256=<hex>` — the signature header value from a hex digest. */
export function formatSignature(hex: string): string {
  return `${SIGNATURE_PREFIX}${hex}`;
}

function inRange(s: string, min: number, max: number): boolean {
  return s.length >= min && s.length <= max;
}

function validateEvent(
  raw: unknown,
  index: number,
  errors: ValidationError[],
): RfidBatchEvent | null {
  if (typeof raw !== "object" || raw === null) {
    errors.push({ path: `events[${index}]`, message: "expected object" });
    return null;
  }
  const e = raw as Record<string, unknown>;
  let ok = true;

  const { tagEpc, gatewayCode, readAt, direction, fromGateway, toGateway } = e;
  if (typeof tagEpc !== "string" || !inRange(tagEpc, RFID_LIMITS.tagEpc.min, RFID_LIMITS.tagEpc.max)) {
    errors.push({ path: `events[${index}].tagEpc`, message: "string 1..128" });
    ok = false;
  }
  if (
    typeof gatewayCode !== "string" ||
    !inRange(gatewayCode, RFID_LIMITS.gatewayCode.min, RFID_LIMITS.gatewayCode.max)
  ) {
    errors.push({ path: `events[${index}].gatewayCode`, message: "string 1..64" });
    ok = false;
  }
  if (typeof readAt !== "string" || !isValidReadAt(readAt)) {
    errors.push({ path: `events[${index}].readAt`, message: "RFC-3339 UTC (…Z) string" });
    ok = false;
  }

  // R-M1.2a directional fields (each OPTIONAL). `!== undefined` treats an
  // explicit `null` as present-and-invalid, matching zod's `.optional()` (which
  // rejects null). The gateway pair is BOTH-or-NEITHER.
  if (
    direction !== undefined &&
    !(typeof direction === "string" && (RFID_DIRECTIONS as readonly string[]).includes(direction))
  ) {
    errors.push({ path: `events[${index}].direction`, message: "one of entered|exited" });
    ok = false;
  }
  if (
    fromGateway !== undefined &&
    !(typeof fromGateway === "string" && inRange(fromGateway, RFID_LIMITS.fromGateway.min, RFID_LIMITS.fromGateway.max))
  ) {
    errors.push({ path: `events[${index}].fromGateway`, message: "string 1..64" });
    ok = false;
  }
  if (
    toGateway !== undefined &&
    !(typeof toGateway === "string" && inRange(toGateway, RFID_LIMITS.toGateway.min, RFID_LIMITS.toGateway.max))
  ) {
    errors.push({ path: `events[${index}].toGateway`, message: "string 1..64" });
    ok = false;
  }
  if ((fromGateway === undefined) !== (toGateway === undefined)) {
    errors.push({
      path: `events[${index}].fromGateway`,
      message: "fromGateway and toGateway must be supplied together",
    });
    ok = false;
  }

  if (!ok) return null;
  // Only known fields survive — mirrors zod's non-`.strict()` field stripping.
  const event: RfidBatchEvent = {
    tagEpc: tagEpc as string,
    gatewayCode: gatewayCode as string,
    readAt: readAt as string,
  };
  if (direction !== undefined) event.direction = direction as RfidDirection;
  if (fromGateway !== undefined) event.fromGateway = fromGateway as string;
  if (toGateway !== undefined) event.toGateway = toGateway as string;
  return event;
}

/**
 * Validate an unknown value against the vendor-neutral batch contract. Unknown
 * fields are silently stripped (never rejected) to match the route's
 * non-`.strict()` zod schema.
 */
export function validateRfidBatch(input: unknown): RfidBatchValidation {
  const errors: ValidationError[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: [{ path: "", message: "expected object" }] };
  }
  const obj = input as Record<string, unknown>;

  const batchId = obj.batchId;
  if (typeof batchId !== "string") {
    errors.push({ path: "batchId", message: "required string" });
  } else if (!inRange(batchId, RFID_LIMITS.batchId.min, RFID_LIMITS.batchId.max)) {
    errors.push({ path: "batchId", message: "length 1..64" });
  }

  let controllerVersion: string | undefined;
  if (obj.controllerVersion !== undefined) {
    if (typeof obj.controllerVersion !== "string") {
      errors.push({ path: "controllerVersion", message: "string" });
    } else if (obj.controllerVersion.length > RFID_LIMITS.controllerVersion.max) {
      errors.push({ path: "controllerVersion", message: "max 32" });
    } else {
      controllerVersion = obj.controllerVersion;
    }
  }

  const rawEvents = obj.events;
  const events: RfidBatchEvent[] = [];
  if (!Array.isArray(rawEvents)) {
    errors.push({ path: "events", message: "required array" });
  } else {
    if (rawEvents.length < 1) errors.push({ path: "events", message: "min 1 event" });
    if (rawEvents.length > RFID_LIMITS.maxEventsPerBatch) {
      errors.push({ path: "events", message: "max 200 events" });
    }
    rawEvents.forEach((ev, i) => {
      const parsed = validateEvent(ev, i, errors);
      if (parsed) events.push(parsed);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      batchId: batchId as string,
      ...(controllerVersion !== undefined ? { controllerVersion } : {}),
      events,
    },
  };
}
