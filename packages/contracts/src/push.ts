/**
 * Shared native-push contract (ADR-009).
 *
 * Consumed by the VetTrack server AND the RN mobile repo (via a VETTRACK_SHA
 * bump). Framework-free — no zod, no runtime deps — so it stays portable across
 * both consumers.
 *
 * ADR-009 §2 (binding, Clinical Safety Officer doctrine): a push is an ALERT,
 * never a state channel. A push payload may carry user-visible alert copy plus
 * an OPAQUE reference id (a pointer such as sessionId/equipmentId) ONLY — never
 * authoritative domain/emergency state the client would treat as truth. The
 * client learns truth from SSE/API; push just says "something happened, go
 * look". This module enforces that structurally: the allowlist below is the
 * complete set of keys a push may carry, and `assertAlertOnlyPayload` rejects
 * anything else.
 */

/** Transports a subscription can be delivered through. */
export const PUSH_PLATFORMS = ["web", "ios", "android", "expo"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/**
 * The ONLY keys a push payload may carry. `referenceId` is an opaque pointer,
 * NOT authoritative state — the client dereferences it against SSE/API.
 */
export const PUSH_ALERT_ALLOWED_KEYS = ["title", "body", "tag", "url", "silent", "referenceId"] as const;
export type PushAlertKey = (typeof PUSH_ALERT_ALLOWED_KEYS)[number];

export interface PushAlertEnvelope {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  silent?: boolean;
  /** Opaque reference (e.g. code-blue sessionId, equipmentId) — NOT domain state. */
  referenceId?: string;
}

/**
 * Structural guard for ADR-009 §2. Throws if the payload carries any key outside
 * the alert allowlist (i.e. would turn push into a state channel). Runtime, so a
 * test can prove it rejects a smuggled `status`/`sessionState` field.
 */
export function assertAlertOnlyPayload(payload: Record<string, unknown>): void {
  const allowed = new Set<string>(PUSH_ALERT_ALLOWED_KEYS);
  const forbidden = Object.keys(payload).filter((key) => !allowed.has(key));
  if (forbidden.length > 0) {
    throw new Error(
      `Push payload carries non-alert field(s) — ADR-009 forbids push as a state channel: ${forbidden.join(", ")}`,
    );
  }
}

/**
 * Whitelist-construct an alert envelope: copies ONLY allowlisted keys, dropping
 * anything a caller tries to smuggle through. The result always passes
 * `assertAlertOnlyPayload`.
 */
export function buildPushAlertEnvelope(input: PushAlertEnvelope): PushAlertEnvelope {
  const out: PushAlertEnvelope = { title: input.title, body: input.body };
  if (input.tag !== undefined) out.tag = input.tag;
  if (input.url !== undefined) out.url = input.url;
  if (input.silent !== undefined) out.silent = input.silent;
  if (input.referenceId !== undefined) out.referenceId = input.referenceId;
  return out;
}
