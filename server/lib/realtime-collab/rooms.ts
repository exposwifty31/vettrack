/**
 * R-RTC-1.1 — clinic-scoped room names + join authorization.
 *
 * Rooms are pinned to three shapes; a socket may only join rooms for its OWN
 * clinicId (no cross-clinic join), and a record room additionally enforces the
 * same server-side record-level ACL the REST record-access path uses.
 */

/** Bounded set of record types that support co-presence (R-RTC-1.4). */
export const RECORD_TYPES = ["equipment", "task", "room"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export function isRecordType(value: unknown): value is RecordType {
  return typeof value === "string" && (RECORD_TYPES as readonly string[]).includes(value);
}

/** Sanitize an id used inside a room name: [a-zA-Z0-9_-], clamp 128. Returns null if invalid. */
export function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

export function chatRoom(clinicId: string): string {
  return `clinic:${clinicId}:chat`;
}
export function boardRoom(clinicId: string): string {
  return `clinic:${clinicId}:board`;
}
/**
 * VetTrack 2.0, Task 1.1 §1.5 (option 1, nudge-only) — advisory room for the
 * Shift Autopilot approval queue. Same auth shape as `boardRoom` (clinic
 * membership only, no record ACL): a joined socket receives ONLY a bare
 * "queue changed" ping (see `proposal-queue-nudge.ts`) and must refetch via
 * the authenticated REST path (`GET /api/action-proposals`) for content —
 * this room NEVER carries a proposal's id/summary/citations/status. The REST
 * route is always the authority; this channel only prompts a refetch.
 */
export function proposalQueueRoom(clinicId: string): string {
  return `clinic:${clinicId}:proposal-queue`;
}
export function recordRoom(clinicId: string, type: RecordType, id: string): string {
  return `clinic:${clinicId}:record:${type}:${id}`;
}

/** A join request as the client asks for it (before authorization). */
export type JoinRequest =
  | { kind: "chat" }
  | { kind: "board" }
  | { kind: "proposal-queue" }
  | { kind: "record"; recordType: string; recordId: string };

/** The authenticated identity attached by the handshake (from the DB session). */
export interface CollabIdentity {
  userId: string;
  clinicId: string;
  role: string;
  displayName: string;
}

/**
 * Record-level ACL: does `identity` may view/edit `type`/`id`? Injected so the
 * REST record-access rule is the single source of truth and tests can control it.
 * Must verify the record is in the identity's clinic AND the role may access it.
 */
export type RecordAccessCheck = (
  identity: CollabIdentity,
  type: RecordType,
  id: string,
) => Promise<boolean>;

export type JoinDecision =
  | { ok: true; room: string }
  | { ok: false; reason: string };

/**
 * Authorize a room join. Chat/board are clinic-scoped only; record rooms also run
 * the injected record ACL. Cross-clinic joins are impossible by construction (the
 * room name is built from the socket's own clinicId, never a client-supplied one).
 */
export async function authorizeRoomJoin(
  identity: CollabIdentity,
  req: unknown,
  recordAccess: RecordAccessCheck,
): Promise<JoinDecision> {
  // Guard first: socket.io delivers whatever the client sent (including `null`,
  // `undefined`, a bare string, or `{}`). Narrow before touching `.kind` so a
  // malformed request can never throw a TypeError into the async join listener
  // (which would surface as an unhandled promise rejection). — card H3.
  if (typeof req !== "object" || req === null || !("kind" in req)) {
    return { ok: false, reason: "INVALID_JOIN_REQUEST" };
  }
  const { kind } = req as { kind: unknown };
  if (kind === "chat") return { ok: true, room: chatRoom(identity.clinicId) };
  if (kind === "board") return { ok: true, room: boardRoom(identity.clinicId) };
  if (kind === "proposal-queue") return { ok: true, room: proposalQueueRoom(identity.clinicId) };
  if (kind !== "record") return { ok: false, reason: "INVALID_JOIN_REQUEST" };

  // record
  const { recordType, recordId } = req as { recordType?: unknown; recordId?: unknown };
  if (!isRecordType(recordType)) return { ok: false, reason: "UNKNOWN_RECORD_TYPE" };
  const id = sanitizeId(recordId);
  if (!id) return { ok: false, reason: "INVALID_RECORD_ID" };
  const allowed = await recordAccess(identity, recordType, id);
  if (!allowed) return { ok: false, reason: "RECORD_ACCESS_DENIED" };
  return { ok: true, room: recordRoom(identity.clinicId, recordType, id) };
}
