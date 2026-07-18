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
import { and, eq, lte, or } from "drizzle-orm";
import { db, rfidReaders, rfidSecretRotations } from "../../db.js";
import type { RfidSecretRotation } from "../../schema/equipment.js";
import { getCredentials, storeCredentials } from "../../integrations/credential-manager.js";
import { incrementMetric } from "../metrics.js";

const DEFAULT_GRACE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SECRET_BYTES = 32;
const ONE_INFLIGHT_INDEX = "vt_rfid_secret_rotations_one_inflight_uq";
// A legitimate finalize (Phase-1 CAS → credential delete → Phase-3 CAS) completes in milliseconds.
// A `finalizing` row that has sat untouched longer than this can only be a crash-stranded claim (the
// finalizing process was hard-killed — SIGKILL/OOM/deploy restart — between the Phase-1 commit and
// the Phase-2 revert / Phase-3 commit). Past this threshold the row is reclaimable so its held
// one-in-flight gate is not stranded forever. Kept well above any real finalize latency so a
// genuinely in-flight finalize is NEVER stomped by a concurrent reclaimer.
const FINALIZING_STALE_MS = 60 * 1000; // 60s

export type RotationStatus = "grace" | "finalizing" | "completed" | "rolled_back";

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
 * post-CAS credential mutation fails (a `finalizing` delete failure or a `rolled_back` restore
 * failure). This keeps the durable rotation STATE consistent with the (unchanged) credential
 * blob — `previous` is still retained and accepted — so a later verify/ack/rollback retries the
 * transition cleanly instead of being stranded on a `finalizing`/terminal row that no longer
 * matches the stored secrets.
 *
 * OWNERSHIP CAS (revert-stomp guard): the revert matches ONLY the exact row THIS caller claimed —
 * its `fromStatus` (`finalizing` for a finalize delete failure, `rolled_back` for a rollback
 * restore failure) AND the `claimedUpdatedAt` its own claiming CAS stamped. If a concurrent
 * reclaimer has since re-claimed the row (updated_at changed) or driven it terminal (status
 * changed) — e.g. finalizeRotation's Phase-1 was widened to reclaim a stale `finalizing` row, so a
 * slow-but-not-crashed finalize and a sweep can both act on the same row — the predicate matches 0
 * rows and this late/losing revert is a NO-OP. Without this guard a losing revert would stomp an
 * already-`completed` row back to `grace` + `previous_retained=true` with no `previous` in the blob,
 * bricking the one-in-flight gate forever (getRfidVerificationSecrets short-circuits on `!previous`
 * and the sweep only selects `finalizing`, so no backstop could ever reach it). The legitimate
 * non-raced revert (this caller still owns the row) still matches and restores grace.
 */
async function revertRotationToGrace(
  clinicId: string,
  rotationId: string,
  fromStatus: RotationStatus,
  claimedUpdatedAt: Date,
  now: number,
): Promise<void> {
  await db
    .update(rfidSecretRotations)
    .set({ status: "grace", previousRetained: true, completedAt: null, updatedAt: new Date(now) })
    .where(
      and(
        eq(rfidSecretRotations.clinicId, clinicId),
        eq(rfidSecretRotations.id, rotationId),
        eq(rfidSecretRotations.status, fromStatus),
        eq(rfidSecretRotations.updatedAt, claimedUpdatedAt),
      ),
    );
}

/**
 * Invalidate the retained previous secret for a rotation (grace expiry OR all-acked). TWO-PHASE
 * (FS-1) so the row is never observably `completed` until the external credential delete durably
 * commits:
 *
 *   1. CAS into the transient `finalizing` state (claim). `previous_retained` stays `true`, so the
 *      one-in-flight partial unique index still holds and ingest keeps accepting `previous` while
 *      the blob carries it. Two shapes are claimable:
 *        • a live `grace` row — the normal finalize; OR
 *        • a STRANDED `finalizing` row — one a prior finalize CAS'd into `finalizing` but never drove
 *          to `completed`/`grace` because the process was hard-killed mid-delete (SIGKILL/OOM/deploy
 *          restart). Such a row keeps `previous_retained=true` and would otherwise hold the
 *          one-in-flight gate FOREVER (bricking rotation for the clinic). We reclaim it ONLY once it
 *          is demonstrably stale (`updated_at <= now − FINALIZING_STALE_MS`) so an actively in-flight
 *          finalize is never stomped. The CAS re-stamps `updated_at = now`, which also serializes
 *          concurrent reclaimers: the first winner freshens the row and the losers' stale predicate
 *          no longer matches (they get 0 rows → `false`).
 *      If the CAS matches 0 rows the row was already claimed / terminal (a concurrent finalize, a
 *      rollback → `rolled_back`, or a not-yet-stale `finalizing`): return `false`.
 *   2. Delete the retained `previous_webhook_secret` from the credential blob (idempotent — a no-op
 *      if a prior stranded attempt already removed it). On FAILURE, revert `finalizing` → `grace`
 *      (previous still retained, blob unchanged) and surface the error, so the flow stays recoverable
 *      and no terminal `completed` row ever carries `previous_webhook_secret`.
 *   3. On delete SUCCESS, CAS `finalizing` → `completed` (`previous_retained = false`).
 *
 * Returns whether THIS call drove the row to a durable `completed`. `false` means it did not win
 * the claim; the caller must NOT assume `completed` and should re-read the committed status. The
 * transient `completed`-before-delete window the pre-FS-1 code exposed is gone: a concurrent
 * ack/reader can now only ever observe `grace`, `finalizing`, `completed`, or `rolled_back` — and
 * `completed` is reached ONLY after the durable delete.
 */
async function finalizeRotation(clinicId: string, rot: RfidSecretRotation, now: number): Promise<boolean> {
  // Phase 1 — claim a live `grace` row OR a crash-stranded (stale) `finalizing` row into `finalizing`.
  const staleBefore = new Date(now - FINALIZING_STALE_MS);
  const claimed = await db
    .update(rfidSecretRotations)
    .set({ status: "finalizing", updatedAt: new Date(now) })
    .where(
      and(
        eq(rfidSecretRotations.clinicId, clinicId),
        eq(rfidSecretRotations.id, rot.id),
        eq(rfidSecretRotations.previousRetained, true),
        or(
          eq(rfidSecretRotations.status, "grace"),
          and(
            eq(rfidSecretRotations.status, "finalizing"),
            lte(rfidSecretRotations.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning();
  if (claimed.length === 0) return false; // terminal, rolled_back, or an actively in-flight (fresh) finalize
  // The exact `updated_at` THIS claim stamped — threaded into the ownership CAS of both the Phase-2
  // revert and the Phase-3 commit so a concurrent reclaimer's row is never stomped/double-completed.
  const claimedRow = claimed[0];

  // Phase 2 — durable credential delete of the retained previous secret.
  try {
    const creds = await getCredentials(clinicId, "rfid");
    if (creds?.previous_webhook_secret) {
      const next = { ...creds };
      delete next.previous_webhook_secret;
      await storeCredentials(clinicId, "rfid", next);
    }
  } catch (err) {
    // Ownership revert: no-op if a concurrent reclaimer already re-claimed/completed this row.
    await revertRotationToGrace(clinicId, rot.id, "finalizing", claimedRow.updatedAt, now);
    throw err;
  }

  // Phase 3 — the delete durably committed; only now advance to the terminal `completed`. Scoped to
  // THIS claim (status + the claimed updated_at) and `.returning()`d so the win is observable: only
  // the call that still owns the claim matched a row → `true`; a call whose claim a concurrent
  // reclaimer already superseded matches 0 rows → `false`. This is the "returns whether THIS call
  // drove it to completed" contract (a blanket `return true` double-counted the reclaim metric).
  const completed = await db
    .update(rfidSecretRotations)
    .set({ status: "completed", previousRetained: false, completedAt: new Date(now), updatedAt: new Date(now) })
    .where(
      and(
        eq(rfidSecretRotations.clinicId, clinicId),
        eq(rfidSecretRotations.id, rot.id),
        eq(rfidSecretRotations.status, "finalizing"),
        eq(rfidSecretRotations.updatedAt, claimedRow.updatedAt),
      ),
    )
    .returning();
  return completed.length > 0;
}

/**
 * Time-bounded liveness backstop for crash-stranded `finalizing` rows (FS-1 re-attempt).
 *
 * A hard process kill (SIGKILL/OOM/deploy restart) between finalizeRotation's Phase-1 claim
 * (grace→finalizing, `previous_retained` still true) and its Phase-3 commit strands the row at
 * `status='finalizing'`, holding the one-in-flight gate (`UNIQUE (clinic_id) WHERE
 * previous_retained=true`). The lazy ingest reclaim in `getRfidVerificationSecrets` closes only
 * HALF of that window and only under continued traffic:
 *   - POST-delete sub-window (crash AFTER the Phase-2 blob delete durably committed): the blob no
 *     longer carries `previous`, so `getRfidVerificationSecrets` short-circuits at its `!previous`
 *     early return (frozen no-extra-query common path) and NEVER re-drives finalize; and
 *   - a clinic whose readers fall quiet right after stranding produces no ingest/ack traffic, so
 *     the lazy driver is never called at all.
 * In both cases the gate would be held with NO upper bound until traffic happens to resume.
 *
 * This scheduled sweep is the unbounded-wait backstop: it re-drives every STALE `finalizing` row
 * through the same two-phase finalize regardless of blob state (Phase-2's delete is idempotent — a
 * no-op when the blob already lacks `previous`), so a stranded row is reclaimed within one sweep
 * interval and its gate released. Cross-clinic system sweep (mirrors runRfidReaderOfflineSweep):
 * the staleness SELECT spans clinics, but every reclaim runs through the clinic-scoped
 * finalizeRotation, so no per-clinic state is ever crossed. The stale predicate (updated_at <= now
 * − FINALIZING_STALE_MS) guarantees an actively in-flight finalize is never stomped.
 */
export async function reclaimStrandedFinalizingRotations(
  now: number = Date.now(),
): Promise<{ scanned: number; reclaimed: number }> {
  const staleBefore = new Date(now - FINALIZING_STALE_MS);
  const stranded = await db
    .select()
    .from(rfidSecretRotations)
    .where(
      and(
        eq(rfidSecretRotations.status, "finalizing"),
        eq(rfidSecretRotations.previousRetained, true),
        lte(rfidSecretRotations.updatedAt, staleBefore),
      ),
    );

  let reclaimed = 0;
  for (const rot of stranded) {
    try {
      // finalizeRotation re-drives the two-phase finalize (Phase-1 CAS accepts a stale `finalizing`
      // row; Phase-2 delete is a no-op when `previous` is already gone; Phase-3 CAS → completed). A
      // `false` return means a concurrent reclaimer/finalize won the claim — not this call's job.
      const done = await finalizeRotation(rot.clinicId, rot, now);
      if (done) {
        reclaimed += 1;
        incrementMetric("rfid_secret_rotation_reclaimed");
      }
    } catch (err) {
      // A Phase-2 delete failure reverts the row to `grace` (recoverable, retried next sweep). One
      // clinic's transient failure must never abort the whole cross-clinic sweep.
      console.error(`[rfid-finalizing-sweep] reclaim failed for rotation ${rot.id}:`, err);
    }
  }
  return { scanned: stranded.length, reclaimed };
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
  // (partial unique index). A `finalizing` row (FS-1) is normally treated like `grace`: the delete
  // has not durably committed yet — the blob still carries `previous` (else the early `!previous`
  // return above would have fired) — so `previous` is still accepted while retained.
  const [rot] = await db
    .select()
    .from(rfidSecretRotations)
    .where(and(eq(rfidSecretRotations.clinicId, clinicId), eq(rfidSecretRotations.previousRetained, true)))
    .limit(1);
  if (!rot || (rot.status !== "grace" && rot.status !== "finalizing")) return [current];

  const graceExpired = now > new Date(rot.graceExpiresAt).getTime();
  // A `finalizing` row that is older than the stale threshold is a crash-stranded finalize (its
  // process died between the Phase-1 claim and the Phase-3 commit). Left alone it holds the
  // one-in-flight gate forever. Ingest is the natural liveness driver here (the finalizing state
  // only arises when the clinic has active readers, i.e. it is producing ingest traffic), so this
  // path re-drives the stranded finalize to release the gate.
  const finalizingStranded =
    rot.status === "finalizing" && now - new Date(rot.updatedAt).getTime() >= FINALIZING_STALE_MS;

  if (graceExpired || finalizingStranded) {
    // Lazy-finalize through the two-phase path. Its Phase-1 CAS now accepts `grace` OR a stale
    // `finalizing`, so this actually COMPLETES a crash-stranded finalize (previously a silent no-op)
    // and releases the gate. A no-op `false` (row freshly claimed by a concurrent finalize, or
    // already terminal) is fine: `previous` is on its way out either way.
    await finalizeRotation(clinicId, rot, now);
    incrementMetric(finalizingStranded ? "rfid_secret_rotation_reclaimed" : "rfid_secret_grace_expired");
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
      // Non-grace terminal (`completed`/`rolled_back`) OR the NON-TERMINAL `finalizing` transient
      // (FS-1): a concurrent finalize claimed the row but its durable delete is still in flight.
      // Return the honest committed status — NEVER coerce `finalizing` to `completed`.
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
    // A concurrent finalize/rollback claimed the row between the ack commit and this finalize CAS:
    // the rotation is NOT durably completed here. Report the actually-committed outcome (re-read the
    // post-CAS state) so a `rolled_back` — or a still-in-flight `finalizing` — never surfaces as
    // `completed`. The invariant: ack returns `completed` ONLY when THIS call drove the durable
    // delete. Fall back to the pre-finalize snapshot status (`grace`), never to `completed`.
    const current = await getRotationRow(clinicId, { id: rotationId });
    const status = (current?.status ?? outcome.rot.status) as RotationStatus;
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
 * (grace expiry / all-acked) — recovery is then a fresh rotation. Also rejected while a
 * finalization is already in progress (`finalizing`, FS-1): rollback is valid ONLY during `grace`.
 */
export async function rollbackRfidSecret(
  clinicId: string,
  rotationId: string,
  now: number = Date.now(),
): Promise<RotationEnvelope> {
  const rot = await getRotationRow(clinicId, { id: rotationId });
  if (!rot) throw new RfidRotationError("ROTATION_NOT_FOUND", "RFID secret rotation not found", 404);

  // A finalize has already claimed this row and its durable delete is in flight — rollback is no
  // longer eligible (it is valid only during `grace`, before finalize commits to dropping previous).
  if (rot.status === "finalizing") {
    throw new RfidRotationError("ROLLBACK_UNAVAILABLE", "A rotation finalization is in progress; rollback is unavailable", 409);
  }

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
    // Ownership revert of the row THIS rollback just CAS-claimed into `rolled_back` (no concurrent
    // path touches a `rolled_back` row, but the guard keeps the revert precise and symmetric).
    await revertRotationToGrace(clinicId, rotationId, "rolled_back", claimed.updatedAt, now);
    throw err;
  }
  incrementMetric("rfid_secret_rolled_back");
  return toEnvelope(claimed);
}

/**
 * Test-only surface. Exposes the two internal CAS transitions so the revert-stomp ownership guard
 * (finalizeRotation Phase-1 claim → the exact claimed `updated_at` → revertRotationToGrace /
 * Phase-3 commit) can be exercised directly at the concurrency boundary the DB tests otherwise
 * cannot reach. Never imported by production code.
 */
export const __test = { finalizeRotation, revertRotationToGrace };
