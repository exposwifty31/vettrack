/**
 * R-CBF-1.1 — Code Blue one-tap ORCHESTRATION (compose, don't rebuild).
 *
 * A single server action that COMPOSES the already-built, already-tested pieces
 * in the pinned order (frozen Code Blue surface — see CLAUDE.md §"Code Blue
 * runtime guarantees" + §"Operational doctrine"):
 *
 *   1. claim/look up the `(clinicId, token)` idempotency record — the FIRST step,
 *      before any cart lookup or reservation. The claim's state decides the reply:
 *        - `committed`   → REPLAY the stored session + the CURRENT durable paging
 *                          state, with NO cart/session side effects;
 *        - `active_lease`→ a retryable CONFLICT (the in-flight owner is presumed
 *                          still working) — NO reclaim, NO replay, NO side effects;
 *        - `claimed`/`reclaimed` → we hold the fence; proceed.
 *   2. resolve the SERVER-AUTHORITATIVE nearest-ready cart (1.1b resolver);
 *   3. CAS soft-reserve it (1.2 — the loser re-resolves to the next ready cart);
 *   4. create the session (server/routes/code-blue.ts semantics);
 *   5. insert the realtime OUTBOX paging event in the SAME commit and flip the
 *      claim to `committed`; then enqueue the team page.
 *
 * Steps 3–5 (reservation + session + outbox insert + claim-commit) are ONE atomic
 * database transaction: they commit together or roll back together. The claim
 * (step 1) is a SEPARATE prior durable write, so a session-transaction abort
 * leaves the claim `claimed` (nothing about the session persists) and its lease
 * lets a later retry reclaim it. A fence-holder whose lease was superseded is
 * REJECTED on commit — never mints a second session.
 *
 * This module owns the COMPOSITION only. The claim lifecycle (1.1a
 * `code-blue-start-claim.ts`), the nearest-cart resolver (1.1b
 * `code-blue-nearest-cart.ts`) and the CAS soft-reserve (1.2
 * `code-blue-soft-reserve.ts`) are injected ports — the real Drizzle wiring lives
 * in `server/routes/code-blue.ts`, and tests inject faithful in-memory models.
 *
 * Durable paging state (`queued | processing | sent | failed`) is DERIVED from the
 * team-page outbox row and delivered by the EXISTING `startEventOutboxPublisher`
 * (the sole outbox reader) — no second drain loop is introduced. A replay returns
 * the CURRENT state (never a static "success"); an exhausted-retry `failed` never
 * deletes the committed session (end is server-confirmed only).
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, codeBlueSessions, codeBlueLogEntries, equipment } from "../db.js";
import {
  claimStart,
  commitClaim,
  DrizzleStartClaimStore,
  type StartClaimStore,
  type ClaimStartResult,
} from "./code-blue-start-claim.js";
import type { ClientLocationHint, NearestReadyCartResolution } from "./code-blue-nearest-cart.js";
import {
  reserveNearestReadyCart,
  DrizzleCartReservationStore,
} from "./code-blue-soft-reserve.js";
import { insertRealtimeDomainEvent } from "./realtime-outbox.js";

/** Outbox event type carrying the durable team-page delivery state. */
export const CODE_BLUE_PAGE_EVENT_TYPE = "NOTIFICATION_REQUESTED";

/** Bounded durable delivery state of the team-page outbox row. */
export type PagingState = "queued" | "processing" | "sent" | "failed";

/**
 * Derive the bounded paging state from a team-page outbox row's delivery
 * metadata. Mirrors `startEventOutboxPublisher`'s semantics: a published row is
 * `sent`; a DLQ'd row (`error_type = 'permanent'`) is `failed`; a row that has
 * been attempted but not yet published is `processing`; an untouched row is
 * `queued`.
 */
export function deriveOutboxPagingState(row: {
  publishedAt: Date | null;
  errorType: string | null;
  retryCount: number;
  lastAttemptAt: Date | null;
}): PagingState {
  if (row.publishedAt) return "sent";
  if (row.errorType === "permanent") return "failed";
  if (row.retryCount > 0 || row.lastAttemptAt) return "processing";
  return "queued";
}

/**
 * Read the CURRENT durable paging state for a committed session's team-page
 * outbox row. Clinic-scoped; returns null when no paging row exists (e.g. a
 * session created before paging rode the outbox). The Drizzle implementation
 * derives the state from `vt_event_outbox`; tests inject an in-memory model.
 */
export interface PagingStateStore {
  readStateForSession(clinicId: string, sessionId: string): Promise<PagingState | null>;
}

/** Input to the atomic session transaction (steps 3–5). */
export interface OneTapSessionTxInput {
  clinicId: string;
  token: string;
  /** The claim fence the caller holds; only the current fence-holder may commit. */
  fence: number;
  initiatingUserId: string;
  /** Nearest-first candidate carts from the 1.1b resolver; the CAS loop tries each. */
  orderedCartIds: readonly string[];
  now: Date;
}

/** Result of a COMMITTED atomic session transaction. */
export interface OneTapSessionTxResult {
  sessionId: string;
  reservedCartId: string | null;
  /** The outbox row id of the enqueued team page (durable paging handle). */
  pagingOutboxId: number | null;
  /** Freshly created rows start `queued`. */
  pagingState: PagingState;
}

/**
 * The atomic session transaction (steps 3–5): CAS soft-reserve → session insert
 * → outbox paging insert → fenced `commitClaim`, committed or rolled back
 * together. A superseded fence throws {@link FenceSupersededError}; a
 * pre-existing active session throws {@link ActiveSessionExistsError}; any other
 * throw is a genuine abort that rolls the transaction back and leaves the claim
 * `claimed`.
 */
export interface OneTapSessionTransaction {
  run(input: OneTapSessionTxInput): Promise<OneTapSessionTxResult>;
}

/** Thrown by the session transaction when a superseded fence-holder tries to commit. */
export class FenceSupersededError extends Error {
  constructor(token: string) {
    super(`code-blue one-tap claim fence superseded for token ${token}`);
    this.name = "FenceSupersededError";
  }
}

/** Thrown by the session transaction when the clinic already has an active session. */
export class ActiveSessionExistsError extends Error {
  constructor(clinicId: string) {
    super(`an active Code Blue session already exists for clinic ${clinicId}`);
    this.name = "ActiveSessionExistsError";
  }
}

export interface OneTapDeps {
  claimStore: StartClaimStore;
  /** SERVER-AUTHORITATIVE nearest-ready-cart resolution (1.1b). */
  resolveCart: (
    clinicId: string,
    initiatingUserId: string,
    clientHint?: ClientLocationHint,
  ) => Promise<NearestReadyCartResolution>;
  sessionTx: OneTapSessionTransaction;
  pagingStateStore: PagingStateStore;
  /** Injected clock for deterministic lease math; defaults to `new Date()`. */
  now?: () => Date;
  /** Claim lease window; defaults to the claim module's `DEFAULT_LEASE_MS`. */
  leaseMs?: number;
}

export interface OneTapRequest {
  clinicId: string;
  token: string;
  initiatingUserId: string;
  /** Optional optimistic location hint — re-validated server-side, never trusted to steer. */
  clientHint?: ClientLocationHint;
}

export type OneTapConflictReason = "active_lease" | "fence_superseded" | "active_session_exists";

export type OneTapOutcome =
  | {
      kind: "created";
      sessionId: string;
      reservedCartId: string | null;
      pagingOutboxId: number | null;
      pagingState: PagingState;
      /** True when no ready cart could be reserved — the session still starts (advisory). */
      noCartAvailable: boolean;
    }
  | {
      kind: "replay";
      sessionId: string;
      /** CURRENT durable paging state, or null if no paging row exists. */
      pagingState: PagingState | null;
    }
  | { kind: "conflict"; reason: OneTapConflictReason };

/**
 * Compose the one-tap Code Blue start. See the module doc for the pinned order
 * and the frozen doctrine it obeys.
 */
export async function orchestrateOneTapCodeBlue(
  deps: OneTapDeps,
  req: OneTapRequest,
): Promise<OneTapOutcome> {
  // Step 1 — the idempotency claim is the FIRST transactional step.
  const claim: ClaimStartResult = await claimStart(deps.claimStore, req.clinicId, req.token, {
    ...(deps.now ? { now: deps.now() } : {}),
    ...(deps.leaseMs !== undefined ? { leaseMs: deps.leaseMs } : {}),
  });

  // A committed claim REPLAYS — never re-resolves, never re-reserves.
  if (claim.outcome === "committed") {
    const sessionId = claim.sessionId;
    if (!sessionId) {
      // A committed claim with no bound session is a broken invariant (an illegal
      // session delete) — fail loud rather than replay an empty result.
      throw new Error(
        `code-blue one-tap: committed claim for (${req.clinicId}, ${req.token}) has no session id`,
      );
    }
    const pagingState = await deps.pagingStateStore.readStateForSession(req.clinicId, sessionId);
    return { kind: "replay", sessionId, pagingState };
  }

  // A still-active lease is a retryable conflict: NO reclaim, NO replay, and NO
  // cart/session/outbox side effect.
  if (claim.outcome === "active_lease") {
    return { kind: "conflict", reason: "active_lease" };
  }

  // `claimed` (brand-new) or `reclaimed` (expired/released) — we hold claim.fence.
  const resolution = await deps.resolveCart(req.clinicId, req.initiatingUserId, req.clientHint);

  const now = deps.now?.() ?? new Date();
  try {
    const result = await deps.sessionTx.run({
      clinicId: req.clinicId,
      token: req.token,
      fence: claim.fence,
      initiatingUserId: req.initiatingUserId,
      orderedCartIds: resolution.orderedCartIds,
      now,
    });
    return {
      kind: "created",
      sessionId: result.sessionId,
      reservedCartId: result.reservedCartId,
      pagingOutboxId: result.pagingOutboxId,
      pagingState: result.pagingState,
      noCartAvailable: result.reservedCartId === null,
    };
  } catch (err) {
    // A superseded fence-holder is rejected on commit — its transaction rolled
    // back, nothing persists; surface a retryable conflict.
    if (err instanceof FenceSupersededError) {
      return { kind: "conflict", reason: "fence_superseded" };
    }
    // The clinic already has an active session — the frozen single-active-session
    // guarantee. The transaction rolled back; the claim stays `claimed`.
    if (err instanceof ActiveSessionExistsError) {
      return { kind: "conflict", reason: "active_session_exists" };
    }
    // A genuine abort: propagate so the caller returns an error. The claim stays
    // `claimed` (we NEVER release here) and becomes reclaimable once its lease
    // lapses — a later retry reclaims and starts a fresh session.
    throw err;
  }
}

// ─── Drizzle-backed ports (the real wiring the endpoint composes) ─────────────

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reads the CURRENT durable paging state for a committed session from its
 * team-page outbox row. Clinic-scoped; matches the `NOTIFICATION_REQUESTED` row
 * carrying this session id and derives the bounded state from its delivery
 * metadata (the same fields `startEventOutboxPublisher` maintains).
 */
export class DrizzlePagingStateStore implements PagingStateStore {
  private readonly executor: typeof db | DbExecutor;
  constructor(executor: typeof db | DbExecutor = db) {
    this.executor = executor;
  }

  async readStateForSession(clinicId: string, sessionId: string): Promise<PagingState | null> {
    const result = await this.executor.execute(sql`
      SELECT published_at, error_type, retry_count, last_attempt_at
      FROM vt_event_outbox
      WHERE clinic_id = ${clinicId}
        AND type = ${CODE_BLUE_PAGE_EVENT_TYPE}
        AND payload->>'sessionId' = ${sessionId}
      ORDER BY id DESC
      LIMIT 1
    `);
    const row = (result.rows as Array<{
      published_at: Date | string | null;
      error_type: string | null;
      retry_count: number | string | null;
      last_attempt_at: Date | string | null;
    }>)[0];
    if (!row) return null;
    return deriveOutboxPagingState({
      publishedAt: row.published_at ? new Date(row.published_at) : null,
      errorType: row.error_type ?? null,
      retryCount: Number(row.retry_count ?? 0),
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
    });
  }
}

/** Static session metadata the endpoint captures BEFORE the transaction opens. */
export interface OneTapSessionTxConfig {
  startedByUserId: string;
  startedByName: string;
  managerUserId: string;
  managerUserName: string;
  preCheckPassed: boolean | null;
}

/**
 * The REAL atomic session transaction (steps 3–5): one `db.transaction` that
 * takes the per-clinic advisory lock, enforces the single-active-session
 * guarantee, CAS soft-reserves the nearest-ready cart, inserts the session (+ a
 * link log entry for the reserved cart), writes the team-page + status outbox
 * events, and flips the claim to `committed` under the caller's fence — all
 * committed or rolled back together. Clinic-scoped on every statement.
 */
export class DrizzleOneTapSessionTransaction implements OneTapSessionTransaction {
  constructor(private readonly config: OneTapSessionTxConfig) {}

  async run(input: OneTapSessionTxInput): Promise<OneTapSessionTxResult> {
    const { clinicId, token, fence } = input;
    return db.transaction(async (tx) => {
      // Serialize with concurrent starts (matches POST /sessions).
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`code-blue-active-session:${clinicId}`}, 0))
      `);

      const [existingActive] = await tx
        .select({ id: codeBlueSessions.id })
        .from(codeBlueSessions)
        .where(and(eq(codeBlueSessions.clinicId, clinicId), eq(codeBlueSessions.status, "active")))
        .limit(1);
      if (existingActive) throw new ActiveSessionExistsError(clinicId);

      const sessionId = randomUUID();
      const startedAt = input.now;

      // Step 3 — CAS soft-reserve the nearest-ready cart (loser advances).
      const reservationStore = new DrizzleCartReservationStore(tx);
      const reservation = await reserveNearestReadyCart(
        reservationStore,
        clinicId,
        sessionId,
        input.orderedCartIds,
      );
      const reservedCartId = reservation.reserved ? reservation.cartId : null;

      // Step 4 — create the session.
      await tx.insert(codeBlueSessions).values({
        id: sessionId,
        clinicId,
        startedAt,
        startedBy: this.config.startedByUserId,
        startedByName: this.config.startedByName,
        managerUserId: this.config.managerUserId,
        managerUserName: this.config.managerUserName,
        preCheckPassed: this.config.preCheckPassed,
        status: "active",
      });

      // Link the reserved cart onto the timed log (elapsed 0), matching the
      // primary-equipment link POST /sessions writes.
      if (reservedCartId) {
        const [cartRow] = await tx
          .select({ name: equipment.name })
          .from(equipment)
          .where(and(eq(equipment.id, reservedCartId), eq(equipment.clinicId, clinicId)))
          .limit(1);
        await tx.insert(codeBlueLogEntries).values({
          id: randomUUID(),
          sessionId,
          clinicId,
          idempotencyKey: randomUUID(),
          elapsedMs: 0,
          label: cartRow?.name ?? "Crash cart",
          category: "equipment",
          equipmentId: reservedCartId,
          loggedByUserId: this.config.startedByUserId,
          loggedByName: this.config.startedByName,
        });
      }

      // Step 5 — team-page + status outbox events (durable paging rides the
      // existing publisher — no second drain loop).
      const pagingOutboxId = await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: CODE_BLUE_PAGE_EVENT_TYPE,
        payload: {
          channel: "code_blue_role_broadcast",
          sessionId,
          tag: `code-blue-${sessionId}`,
        },
        occurredAt: startedAt,
      });
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "CODE_BLUE_STATUS_CHANGED",
        payload: { sessionId, status: "active" },
        occurredAt: startedAt,
      });

      // Flip the claim to `committed` under the caller's fence, IN THE SAME
      // commit. A superseded fence-holder is rejected → roll back everything.
      const claimStore = new DrizzleStartClaimStore(tx);
      const committed = await commitClaim(claimStore, clinicId, token, fence, sessionId, {
        now: startedAt,
      });
      if (!committed.committed) {
        if (committed.reason === "fence_superseded") throw new FenceSupersededError(token);
        throw new Error(`code-blue one-tap: claim not committable (${committed.reason})`);
      }

      return {
        sessionId,
        reservedCartId,
        pagingOutboxId: pagingOutboxId ?? null,
        pagingState: "queued",
      } satisfies OneTapSessionTxResult;
    });
  }
}
