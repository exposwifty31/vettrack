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
export function recordRoom(clinicId: string, type: RecordType, id: string): string {
  return `clinic:${clinicId}:record:${type}:${id}`;
}

/** A join request as the client asks for it (before authorization). */
export type JoinRequest =
  | { kind: "chat" }
  | { kind: "board" }
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
  req: JoinRequest,
  recordAccess: RecordAccessCheck,
): Promise<JoinDecision> {
  if (req.kind === "chat") return { ok: true, room: chatRoom(identity.clinicId) };
  if (req.kind === "board") return { ok: true, room: boardRoom(identity.clinicId) };

  // record
  if (!isRecordType(req.recordType)) return { ok: false, reason: "UNKNOWN_RECORD_TYPE" };
  const id = sanitizeId(req.recordId);
  if (!id) return { ok: false, reason: "INVALID_RECORD_ID" };
  const allowed = await recordAccess(identity, req.recordType, id);
  if (!allowed) return { ok: false, reason: "RECORD_ACCESS_DENIED" };
  return { ok: true, room: recordRoom(identity.clinicId, req.recordType, id) };
}
