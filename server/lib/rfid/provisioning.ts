/**
 * R-M1.1c — server-side RFID HMAC secret provisioning + rotation contract.
 *
 * Replaces the manual `scripts/rfid/provision-secret.ts`. The per-clinic HMAC secret
 * (and, during a rotation, its previous value) lives ONLY in the encrypted credential
 * blob (credential-manager, adapter "rfid": `webhook_secret` + `previous_webhook_secret`).
 * This module owns the durable rotation STATE (`vt_rfid_secret_rotations`) — never the
 * plaintext — so the flow is retry-safe and concurrency-safe:
 *
 *   - The secret is delivered EXACTLY ONCE, in the first successful rotate response. A
 *     same-key retry replays the original envelope WITHOUT the secret (the record stores
 *     status, not the plaintext); a lost response recovers via a NEW rotation, not re-delivery.
 *   - AT MOST ONE in-flight (previous-retained) rotation per clinic — the DB partial unique
 *     index is the concurrency gate; a second concurrent rotation is rejected before it can
 *     touch the shared credential blob (insert-first ordering).
 *   - Ingest verifies current OR previous during the grace window (`rotationStartedAt`
 *     → `+graceTTL`). On grace expiry OR all-snapshot-readers-acked (whichever first) the
 *     previous is invalidated AND rollback becomes unavailable at that same instant.
 *   - Rollback is valid ONLY while `previous` is retained: it restores previous as current
 *     and invalidates the newly issued secret. Once invalidated, recovery is a fresh rotation.
 *
 * clinicId is always caller-supplied from the AUTHENTICATED context (the route derives it
 * from `req.clinicId`, never request input). Every query is clinic-scoped. RFID is
 * advisory-only (ADR-006): this module never touches custody.
 */
import { randomBytes, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, rfidReaders, rfidSecretRotations } from "../../db.js";
import type { RfidSecretRotation } from "../../schema/equipment.js";
import { getCredentials, storeCredentials } from "../../integrations/credential-manager.js";
import { incrementMetric } from "../metrics.js";

const DEFAULT_GRACE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SECRET_BYTES = 32;
const ONE_INFLIGHT_INDEX = "vt_rfid_secret_rotations_one_inflight_uq";

export type RotationStatus = "grace" | "completed" | "rolled_back";

export interface RotationEnvelope {
  rotationId: string;
  status: RotationStatus;
  /** Delivered exactly once (first success). Absent on every replay/rollback envelope. */
  secret?: string;
  secretDelivered: boolean;
  graceExpiresAt: string;
  rollbackAvailable: boolean;
  snapshotReaderIds: string[];
}

export class RfidRotationError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "RfidRotationError";
    this.code = code;
    this.status = status;
  }
}

interface RotationOpts {
  graceTtlMs?: number;
  now?: number;
}

function toEnvelope(row: RfidSecretRotation, secret?: string): RotationEnvelope {
  return {
    rotationId: row.id,
    status: row.status as RotationStatus,
    secret,
    secretDelivered: row.secretDelivered,
    graceExpiresAt: new Date(row.graceExpiresAt).toISOString(),
    rollbackAvailable: row.status === "grace" && row.previousRetained,
    snapshotReaderIds: row.snapshotReaderIds ?? [],
  };
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string; message?: string; cause?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.cause?.code;
  if (code !== "23505") return false;
  const cons = e?.constraint ?? e?.cause?.constraint;
  if (cons === constraint) return true;
  return typeof e?.message === "string" && e.message.includes(constraint);
}

async function getRotationRow(
  clinicId: string,
  sel: { id?: string; idempotencyKey?: string },
): Promise<RfidSecretRotation | null> {
  const where = sel.id
    ? and(eq(rfidSecretRotations.clinicId, clinicId), eq(rfidSecretRotations.id, sel.id))
    : and(eq(rfidSecretRotations.clinicId, clinicId), eq(rfidSecretRotations.idempotencyKey, sel.idempotencyKey!));
  const [row] = await db.select().from(rfidSecretRotations).where(where).limit(1);
  return row ?? null;
}

/** Public accessor (route/test): a cross-clinic rotationId resolves to null. */
export async function getRotation(clinicId: string, rotationId: string): Promise<RfidSecretRotation | null> {
  return getRotationRow(clinicId, { id: rotationId });
}

async function getActiveReaderIds(clinicId: string): Promise<string[]> {
  const rows = await db
    .select({ id: rfidReaders.id })
    .from(rfidReaders)
    .where(and(eq(rfidReaders.clinicId, clinicId), eq(rfidReaders.status, "active")));
  return rows.map((r) => r.id);
}

/**
 * Compensating transition: return a rotation row to its retained-grace state after a
 * post-CAS credential mutation fails. This keeps the durable rotation STATE consistent with
 * the (unchanged) credential blob — `previous` is still retained and accepted — so a later
 * verify/ack/rollback retries the transition cleanly instead of being stranded on a terminal
 * `completed`/`rolled_back` row that no longer matches the stored secrets.
 */
async function revertRotationToGrace(clinicId: string, rotationId: string, now: number): Promise<void> {
  await db
    .update(rfidSecretRotations)
    .set({ status: "grace", previousRetained: true, completedAt: null, updatedAt: new Date(now) })
    .where(and(eq(rfidSecretRotations.clinicId, clinicId), eq(rfidSecretRotations.id, rotationId)));
}

/**
 * Invalidate the retained previous secret for a rotation (grace expiry OR all-acked).
 * CAS on `previous_retained = true` so exactly one caller drops the blob key; concurrent
 * callers no-op. Idempotent. If the credential drop fails AFTER the state flip, the row is
 * rolled back to grace so the flow is recoverable (never a terminal `completed` row that still
 * carries `previous_webhook_secret`).
 *
 * Returns whether THIS call won the CAS and finalized the row. `false` means a concurrent
 * caller already claimed it (another finalize → `completed`, or a rollback → `rolled_back`);
 * the caller must NOT assume `completed` and should re-read the committed status instead.
 */
async function finalizeRotation(clinicId: string, rot: RfidSecretRotation, now: number): Promise<boolean> {
  const claimed = await db
    .update(rfidSecretRotations)
    .set({ status: "completed", previousRetained: false, completedAt: new Date(now), updatedAt: new Date(now) })
    .where(
      and(
        eq(rfidSecretRotations.clinicId, clinicId),
        eq(rfidSecretRotations.id, rot.id),
        eq(rfidSecretRotations.previousRetained, true),
      ),
    )
    .returning();
  if (claimed.length === 0) return false; // already finalized/rolled_back by a concurrent caller

  try {
    const creds = await getCredentials(clinicId, "rfid");
    if (creds?.previous_webhook_secret) {
      const next = { ...creds };
      delete next.previous_webhook_secret;
      await storeCredentials(clinicId, "rfid", next);
    }
  } catch (err) {
    await revertRotationToGrace(clinicId, rot.id, now);
    throw err;
  }
  return true;
}

/**
 * Provision (first time) or rotate the per-clinic RFID HMAC secret. Returns the secret
 * exactly once; a same-key retry replays the original envelope without a secret.
 * Concurrent rotations resolve to one winner (loser → ROTATION_IN_PROGRESS).
 */
export async function rotateRfidSecret(
  clinicId: string,
  idempotencyKey: string,
  opts: RotationOpts = {},
): Promise<RotationEnvelope> {
  const now = opts.now ?? Date.now();
  const graceTtlMs = opts.graceTtlMs ?? DEFAULT_GRACE_TTL_MS;

  // 1. Idempotent replay — a same-key retry never issues a second secret.
  const existing = await getRotationRow(clinicId, { idempotencyKey });
  if (existing) return toEnvelope(existing);

  // 2. Snapshot state at rotation start.
  const creds = await getCredentials(clinicId, "rfid");
  const currentSecret = creds?.webhook_secret?.trim() || null;
  const newSecret = randomBytes(SECRET_BYTES).toString("hex");
  const snapshot = await getActiveReaderIds(clinicId);
  const retainPrevious = Boolean(currentSecret) && snapshot.length > 0;

  const rotationId = randomUUID();
  const status: RotationStatus = retainPrevious ? "grace" : "completed";

  // 3. Acquire the concurrency gate BEFORE mutating the shared credential blob.
  let insertedRow: RfidSecretRotation | undefined;
  try {
    const rows = await db
      .insert(rfidSecretRotations)
      .values({
        clinicId,
        id: rotationId,
        idempotencyKey,
        status,
        rotationStartedAt: new Date(now),
        graceExpiresAt: new Date(now + graceTtlMs),
        snapshotReaderIds: snapshot,
        ackedReaderIds: [],
        previousRetained: retainPrevious,
        secretDelivered: true,
        completedAt: retainPrevious ? null : new Date(now),
      })
      .onConflictDoNothing({
        target: [rfidSecretRotations.clinicId, rfidSecretRotations.idempotencyKey],
      })
      .returning();
    insertedRow = rows[0];
  } catch (err) {
    if (isUniqueViolation(err, ONE_INFLIGHT_INDEX)) {
      incrementMetric("rfid_secret_rotation_conflict");
      throw new RfidRotationError(
        "ROTATION_IN_PROGRESS",
        "Another RFID secret rotation is already in progress for this clinic",
        409,
      );
    }
    throw err;
  }

  if (!insertedRow) {
    // PK conflict = a concurrent same-key request already won: replay, no secret.
    const dup = await getRotationRow(clinicId, { idempotencyKey });
    if (dup) return toEnvelope(dup);
    throw new RfidRotationError("ROTATION_CONFLICT", "Rotation record could not be persisted", 409);
  }

  // 4. Mutate the credential blob (secret change is now gated by the persisted row). If the
  //    durable store fails, the row is a bricked "delivered" record (secret never returned to
  //    the caller, gate still held) — compensate by deleting it so the same key re-runs cleanly
  //    and a fresh rotation is not blocked by the one-in-flight gate.
  // `retainPrevious` already implies `currentSecret` is a non-empty string
  // (`Boolean(currentSecret) && snapshot.length > 0`). Re-testing `currentSecret`
  // in the condition narrows it to `string` for TypeScript — no non-null assertion.
  const nextBlob =
    retainPrevious && currentSecret
      ? { ...(creds ?? {}), webhook_secret: newSecret, previous_webhook_secret: currentSecret }
      : { webhook_secret: newSecret };
  try {
    await storeCredentials(clinicId, "rfid", nextBlob);
  } catch (err) {
    await db
      .delete(rfidSecretRotations)
      .where(and(eq(rfidSecretRotations.clinicId, clinicId), eq(rfidSecretRotations.id, insertedRow.id)));
    throw err;
  }

  incrementMetric("rfid_secret_rotated");
  return toEnvelope(insertedRow, newSecret);
}

/**
 * The set of HMAC secrets ingest must accept, most-current first. Common case (no rotation
 * in flight) returns exactly `[current]` — byte-for-byte identical to the pre-rotation path,
 * with no extra query. During grace it returns `[current, previous]`; an expired grace window
 * is finalized lazily (previous invalidated) before returning `[current]`.
 */
export async function getRfidVerificationSecrets(
  clinicId: string,
  now: number = Date.now(),
): Promise<string[]> {
  const creds = await getCredentials(clinicId, "rfid");
  const current = creds?.webhook_secret?.trim() || null;
  const previous = creds?.previous_webhook_secret?.trim() || null;
  if (!current) return [];
  if (!previous) return [current];

  // A previous secret exists → there is (or was) an in-flight rotation. At most one exists
  // (partial unique index).
  const [rot] = await db
    .select()
    .from(rfidSecretRotations)
    .where(and(eq(rfidSecretRotations.clinicId, clinicId), eq(rfidSecretRotations.previousRetained, true)))
    .limit(1);
  if (!rot || rot.status !== "grace") return [current];
  if (now > new Date(rot.graceExpiresAt).getTime()) {
    await finalizeRotation(clinicId, rot, now);
    incrementMetric("rfid_secret_grace_expired");
    return [current];
  }
  return [current, previous];
}

/**
 * Acknowledge that a snapshot reader has adopted the new secret. When every snapshot reader
 * has acked, the previous is invalidated immediately (and rollback becomes unavailable).
 */
export async function ackRotationReader(
  clinicId: string,
  rotationId: string,
  readerId: string,
  now: number = Date.now(),
): Promise<{ status: RotationStatus; rollbackAvailable: boolean }> {
  // The ack is a read-modify-write of the `ackedReaderIds` set. Concurrent acks from two readers
  // must NOT clobber each other (a lost append can leave `allAcked` permanently false). Serialize
  // per-rotation with a row lock so the merge + completion test see a consistent, committed set.
  type AckOutcome =
    | { kind: "not_found" }
    | { kind: "settled"; status: RotationStatus }
    | { kind: "finalize"; rot: RfidSecretRotation }
    | { kind: "grace" };

  const outcome = await db.transaction<AckOutcome>(async (tx) => {
    const [rot] = await tx
      .select()
      .from(rfidSecretRotations)
      .where(and(eq(rfidSecretRotations.clinicId, clinicId), eq(rfidSecretRotations.id, rotationId)))
      .limit(1)
      .for("update");
    if (!rot) return { kind: "not_found" };

    if (rot.status !== "grace" || !rot.previousRetained) {
      return { kind: "settled", status: rot.status as RotationStatus };
    }
    if (now > new Date(rot.graceExpiresAt).getTime()) {
      return { kind: "finalize", rot };
    }

    const snapshot = rot.snapshotReaderIds ?? [];
    const acked = new Set(rot.ackedReaderIds ?? []);
    acked.add(readerId);

    await tx
      .update(rfidSecretRotations)
      .set({ ackedReaderIds: [...acked], updatedAt: new Date(now) })
      .where(and(eq(rfidSecretRotations.clinicId, clinicId), eq(rfidSecretRotations.id, rotationId)));

    const allAcked = snapshot.length > 0 && snapshot.every((id) => acked.has(id));
    return allAcked ? { kind: "finalize", rot } : { kind: "grace" };
  });

  if (outcome.kind === "not_found") {
    throw new RfidRotationError("ROTATION_NOT_FOUND", "RFID secret rotation not found", 404);
  }
  if (outcome.kind === "settled") {
    return { status: outcome.status, rollbackAvailable: false };
  }
  if (outcome.kind === "finalize") {
    // finalize runs its own CAS + credential mutation AFTER the ack transaction commits (never
    // nested inside it), so the two never contend for the same locked row.
    const finalized = await finalizeRotation(clinicId, outcome.rot, now);
    if (finalized) {
      return { status: "completed", rollbackAvailable: false };
    }
    // A concurrent rollback claimed the row between the ack commit and the finalize CAS: the
    // rotation is NOT completed. Report the actually-committed outcome (re-read the post-CAS
    // state) so a rolled-back rotation never surfaces as `completed`.
    const current = await getRotationRow(clinicId, { id: rotationId });
    const status = (current?.status ?? "completed") as RotationStatus;
    return {
      status,
      rollbackAvailable: status === "grace" && (current?.previousRetained ?? false),
    };
  }
  return { status: "grace", rollbackAvailable: true };
}

/**
 * Roll back a rotation while its previous secret is still retained: restores the previous as
 * current and invalidates the newly issued secret. Rejected once previous is invalidated
 * (grace expiry / all-acked) — recovery is then a fresh rotation.
 */
export async function rollbackRfidSecret(
  clinicId: string,
  rotationId: string,
  now: number = Date.now(),
): Promise<RotationEnvelope> {
  const rot = await getRotationRow(clinicId, { id: rotationId });
  if (!rot) throw new RfidRotationError("ROTATION_NOT_FOUND", "RFID secret rotation not found", 404);

  const isGrace = rot.status === "grace" && rot.previousRetained;
  if (isGrace && now > new Date(rot.graceExpiresAt).getTime()) {
    await finalizeRotation(clinicId, rot, now);
    throw new RfidRotationError("ROLLBACK_UNAVAILABLE", "Grace window has expired; previous secret invalidated", 409);
  }
  if (!isGrace) {
    throw new RfidRotationError("ROLLBACK_UNAVAILABLE", "No retained previous secret to roll back to", 409);
  }

  // CAS claim: flip previous_retained → false so exactly one rollback runs.
  const [claimed] = await db
    .update(rfidSecretRotations)
    .set({ status: "rolled_back", previousRetained: false, completedAt: new Date(now), updatedAt: new Date(now) })
    .where(
      and(
        eq(rfidSecretRotations.clinicId, clinicId),
        eq(rfidSecretRotations.id, rotationId),
        eq(rfidSecretRotations.status, "grace"),
        eq(rfidSecretRotations.previousRetained, true),
      ),
    )
    .returning();
  if (!claimed) {
    throw new RfidRotationError("ROLLBACK_UNAVAILABLE", "Rotation is no longer rollback-eligible", 409);
  }

  // The row is now terminally `rolled_back`, but the blob still holds the NEW secret as current.
  // If restoring `previous` as current fails, revert the row to grace so the (unchanged) blob and
  // the state agree and the rollback stays retryable — never a terminal row whose rollback
  // silently did not take effect.
  try {
    const creds = await getCredentials(clinicId, "rfid");
    const previous = creds?.previous_webhook_secret?.trim();
    if (previous) {
      await storeCredentials(clinicId, "rfid", { webhook_secret: previous });
    }
  } catch (err) {
    await revertRotationToGrace(clinicId, rotationId, now);
    throw err;
  }
  incrementMetric("rfid_secret_rolled_back");
  return toEnvelope(claimed);
}
