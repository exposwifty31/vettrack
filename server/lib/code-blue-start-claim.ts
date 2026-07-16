/**
 * R-CBF-1.1a — Code Blue one-tap durable idempotency CLAIM + fencing lifecycle.
 *
 * The FIRST transactional step of R-CBF-1.1's orchestration (the endpoint and
 * the nearest-ready cart resolver are OTHER sub-cards — this module owns ONLY
 * the claim record + its fenced lifecycle). The claim is a SEPARATE durable
 * record, written in its own durable write BEFORE any cart lookup or the
 * atomic session transaction, so that a session-txn abort leaves the claim
 * intact and its lease lets a later retry reclaim it.
 *
 * States: `claimed(fence, leaseUntil) → committed → released`.
 *
 * Fencing (pinned): a short TTL alone is unsafe against a slow-but-still-active
 * owner, so the claim carries a MONOTONIC fence. Reclaiming an expired/released
 * claim issues a strictly HIGHER fence, and every mutation is a compare-and-set
 * guarded by the CURRENT fence — an owner whose fence was superseded is REJECTED
 * on commit (and on release), so a retry can never create a second session that
 * then races the original's commit.
 *
 * Retry resolution (the endpoint maps these outcomes to REPLAY / conflict /
 * RECLAIM):
 *   - `committed`                         → REPLAY the stored session id.
 *   - `active_lease` (claimed, not expired) → retryable conflict; never reclaimed,
 *                                             never replayed (owner still working).
 *   - `reclaimed` (expired lease or released) → fresh higher fence, caller proceeds.
 *   - `claimed`   (brand-new token)          → fresh claim, caller proceeds.
 *
 * Frozen Code Blue doctrine: every query is clinic-scoped; the committed claim
 * is bound to a committed session and is never deleted.
 */
import { and, eq, lte, or } from "drizzle-orm";
import { db, codeBlueStartClaims } from "../db.js";
import type { AuditDbExecutor } from "./audit.js";

/** Accepts the app pool or an open transaction (compose inside R-CBF-1.1's txn). */
type DbExecutor = AuditDbExecutor | typeof db;

/** Default lease a claim holds before an unattended in-flight start is reclaimable. */
export const DEFAULT_LEASE_MS = 10_000;

/** Initial fence for a brand-new claim; reclamation issues a strictly higher one. */
export const INITIAL_FENCE = 1;

export type StartClaimState = "claimed" | "committed" | "released";

/** The durable shape shared by the store implementations. */
export interface StartClaimRow {
  clinicId: string;
  token: string;
  fence: number;
  leaseUntil: Date;
  state: StartClaimState;
  sessionId: string | null;
}

/**
 * `claimStart` outcome — the claim-layer verdict the endpoint turns into a
 * REPLAY / retryable-conflict / RECLAIM response.
 */
export type ClaimStartOutcome = "claimed" | "reclaimed" | "active_lease" | "committed";

export interface ClaimStartResult {
  outcome: ClaimStartOutcome;
  state: StartClaimState;
  /** The fence the caller holds when `outcome` is `claimed`/`reclaimed`. */
  fence: number;
  sessionId: string | null;
  leaseUntil: Date;
}

export interface CommitClaimResult {
  committed: boolean;
  reason?: "fence_superseded" | "not_claimable";
  fence: number;
  sessionId: string | null;
}

export interface ReleaseClaimResult {
  released: boolean;
  reason?: "fence_superseded" | "not_claimable";
}

export interface ClaimStartOptions {
  /** Lease window; defaults to {@link DEFAULT_LEASE_MS}. */
  leaseMs?: number;
  /** Injected clock for deterministic lease math; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Durable storage port for the claim record. The Drizzle implementation issues
 * the clinic-scoped, fence-guarded compare-and-set SQL; tests inject a faithful
 * in-memory model of the same semantics.
 */
export interface StartClaimStore {
  /** Read the claim for `(clinicId, token)`, or null if none exists. */
  read(clinicId: string, token: string): Promise<StartClaimRow | null>;
  /**
   * Insert a fresh `claimed` row. Returns false if a row already exists for
   * `(clinicId, token)` (the durable unique key loses a concurrent race).
   */
  insertClaimed(row: StartClaimRow): Promise<boolean>;
  /**
   * Compare-and-set reclaim: only where the row still carries `expectedFence`
   * AND is reclaimable (`released`, or `claimed` with `leaseUntil <= asOf`).
   * Sets `state='claimed'`, `fence=newFence`, `leaseUntil`, `sessionId=NULL`.
   * Returns true iff THIS call reclaimed.
   */
  casReclaim(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
    newFence: number;
    leaseUntil: Date;
    asOf: Date;
  }): Promise<boolean>;
  /**
   * Compare-and-set commit: only where the row carries `expectedFence` AND is
   * still `claimed`. Sets `state='committed'`, `sessionId`. Returns true iff
   * THIS call committed (a superseded fence or non-`claimed` state fails).
   */
  casCommit(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
    sessionId: string;
  }): Promise<boolean>;
  /**
   * Compare-and-set release: only where the row carries `expectedFence` AND is
   * still `claimed`. Sets `state='released'`. Returns true iff THIS call
   * released.
   */
  casRelease(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
  }): Promise<boolean>;
}

/**
 * Drizzle-backed store — every statement is clinic-scoped and every mutation is
 * a fence-guarded compare-and-set. Accepts the app pool or an open transaction,
 * so R-CBF-1.1's endpoint can flip the claim to `committed` inside the same
 * session-creation transaction.
 */
export class DrizzleStartClaimStore implements StartClaimStore {
  private readonly executor: DbExecutor;

  constructor(executor: DbExecutor = db) {
    this.executor = executor;
  }

  async read(clinicId: string, token: string): Promise<StartClaimRow | null> {
    const rows = await this.executor
      .select()
      .from(codeBlueStartClaims)
      .where(
        and(eq(codeBlueStartClaims.clinicId, clinicId), eq(codeBlueStartClaims.token, token)),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      clinicId: r.clinicId,
      token: r.token,
      fence: r.fence,
      leaseUntil: r.leaseUntil,
      state: r.state,
      sessionId: r.sessionId,
    };
  }

  async insertClaimed(row: StartClaimRow): Promise<boolean> {
    const inserted = await this.executor
      .insert(codeBlueStartClaims)
      .values({
        clinicId: row.clinicId,
        token: row.token,
        fence: row.fence,
        leaseUntil: row.leaseUntil,
        state: row.state,
        sessionId: row.sessionId,
      })
      .onConflictDoNothing({ target: [codeBlueStartClaims.clinicId, codeBlueStartClaims.token] })
      .returning({ token: codeBlueStartClaims.token });
    return inserted.length > 0;
  }

  async casReclaim(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
    newFence: number;
    leaseUntil: Date;
    asOf: Date;
  }): Promise<boolean> {
    const { clinicId, token, expectedFence, newFence, leaseUntil, asOf } = input;
    const updated = await this.executor
      .update(codeBlueStartClaims)
      .set({ state: "claimed", fence: newFence, leaseUntil, sessionId: null, updatedAt: asOf })
      .where(
        and(
          eq(codeBlueStartClaims.clinicId, clinicId),
          eq(codeBlueStartClaims.token, token),
          eq(codeBlueStartClaims.fence, expectedFence),
          or(
            eq(codeBlueStartClaims.state, "released"),
            and(
              eq(codeBlueStartClaims.state, "claimed"),
              lte(codeBlueStartClaims.leaseUntil, asOf),
            ),
          ),
        ),
      )
      .returning({ token: codeBlueStartClaims.token });
    return updated.length > 0;
  }

  async casCommit(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
    sessionId: string;
  }): Promise<boolean> {
    const { clinicId, token, expectedFence, sessionId } = input;
    const updated = await this.executor
      .update(codeBlueStartClaims)
      .set({ state: "committed", sessionId, updatedAt: new Date() })
      .where(
        and(
          eq(codeBlueStartClaims.clinicId, clinicId),
          eq(codeBlueStartClaims.token, token),
          eq(codeBlueStartClaims.fence, expectedFence),
          eq(codeBlueStartClaims.state, "claimed"),
        ),
      )
      .returning({ token: codeBlueStartClaims.token });
    return updated.length > 0;
  }

  async casRelease(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
  }): Promise<boolean> {
    const { clinicId, token, expectedFence } = input;
    const updated = await this.executor
      .update(codeBlueStartClaims)
      .set({ state: "released", updatedAt: new Date() })
      .where(
        and(
          eq(codeBlueStartClaims.clinicId, clinicId),
          eq(codeBlueStartClaims.token, token),
          eq(codeBlueStartClaims.fence, expectedFence),
          eq(codeBlueStartClaims.state, "claimed"),
        ),
      )
      .returning({ token: codeBlueStartClaims.token });
    return updated.length > 0;
  }
}

/**
 * Step 1 of R-CBF-1.1: write/read the `(clinicId, token)` claim as its OWN
 * durable write. Resolves a duplicate by claim state and, on an expired/released
 * claim, RECLAIMS it under a strictly higher fence. Never touches carts or
 * sessions — that is the endpoint's job, guarded by the returned fence.
 */
export async function claimStart(
  store: StartClaimStore,
  clinicId: string,
  token: string,
  options: ClaimStartOptions = {},
): Promise<ClaimStartResult> {
  const asOf = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const leaseUntil = new Date(asOf.getTime() + leaseMs);

  let existing = await store.read(clinicId, token);

  // Brand-new token: try to win the durable insert.
  if (!existing) {
    const fresh: StartClaimRow = {
      clinicId,
      token,
      fence: INITIAL_FENCE,
      leaseUntil,
      state: "claimed",
      sessionId: null,
    };
    if (await store.insertClaimed(fresh)) {
      return {
        outcome: "claimed",
        state: "claimed",
        fence: INITIAL_FENCE,
        sessionId: null,
        leaseUntil,
      };
    }
    // Lost the insert race — a concurrent start created the row first; re-read.
    existing = await store.read(clinicId, token);
    if (!existing) {
      // The row vanished between a losing insert and the re-read — only possible
      // if the committed session was (illegally) deleted. Fail loud rather than
      // silently minting a second session.
      throw new Error(
        `code-blue start claim for (${clinicId}, ${token}) disappeared after an insert conflict`,
      );
    }
  }

  // A committed claim always REPLAYS — never reclaimed, never re-reserved.
  if (existing.state === "committed") {
    return {
      outcome: "committed",
      state: "committed",
      fence: existing.fence,
      sessionId: existing.sessionId,
      leaseUntil: existing.leaseUntil,
    };
  }

  // `claimed` (lease may or may not be live) or `released`.
  const leaseExpired = existing.leaseUntil.getTime() <= asOf.getTime();
  const reclaimable = existing.state === "released" || leaseExpired;

  if (!reclaimable) {
    // A still-active lease is a retryable conflict: the in-flight owner is
    // presumed still working. Never reclaimed, never replayed.
    return {
      outcome: "active_lease",
      state: "claimed",
      fence: existing.fence,
      sessionId: existing.sessionId,
      leaseUntil: existing.leaseUntil,
    };
  }

  // Reclaim under a strictly higher fence, guarded by the observed fence so a
  // concurrent reclaimer/committer cannot both win.
  const newFence = existing.fence + 1;
  if (await store.casReclaim({ clinicId, token, expectedFence: existing.fence, newFence, leaseUntil, asOf })) {
    return { outcome: "reclaimed", state: "claimed", fence: newFence, sessionId: null, leaseUntil };
  }

  // Lost the reclaim race — reflect whatever the winner left behind.
  const after = await store.read(clinicId, token);
  if (after?.state === "committed") {
    return {
      outcome: "committed",
      state: "committed",
      fence: after.fence,
      sessionId: after.sessionId,
      leaseUntil: after.leaseUntil,
    };
  }
  return {
    outcome: "active_lease",
    state: "claimed",
    fence: after?.fence ?? existing.fence,
    sessionId: after?.sessionId ?? null,
    leaseUntil: after?.leaseUntil ?? existing.leaseUntil,
  };
}

/**
 * Step 2 (the commit half of R-CBF-1.1's atomic session transaction): flip
 * `claimed → committed` ONLY if the caller still holds the CURRENT fence. A
 * superseded fence-holder is REJECTED so it can never bind a second session to
 * the token.
 */
export async function commitClaim(
  store: StartClaimStore,
  clinicId: string,
  token: string,
  fence: number,
  sessionId: string,
): Promise<CommitClaimResult> {
  if (await store.casCommit({ clinicId, token, expectedFence: fence, sessionId })) {
    return { committed: true, fence, sessionId };
  }
  const reason = await rejectionReason(store, clinicId, token, fence);
  return { committed: false, reason, fence, sessionId: null };
}

/**
 * Release a claim the caller owns (an aborted session transaction), making it
 * reclaimable immediately rather than only after its lease elapses. Fence-guarded:
 * a superseded owner cannot release the now-reclaimed claim.
 */
export async function releaseClaim(
  store: StartClaimStore,
  clinicId: string,
  token: string,
  fence: number,
): Promise<ReleaseClaimResult> {
  if (await store.casRelease({ clinicId, token, expectedFence: fence })) {
    return { released: true };
  }
  const reason = await rejectionReason(store, clinicId, token, fence);
  return { released: false, reason };
}

/**
 * Classify why a fence-guarded CAS failed: a higher current fence means the
 * caller was superseded; anything else (missing row, or a non-`claimed` state
 * at the same fence) is `not_claimable`.
 */
async function rejectionReason(
  store: StartClaimStore,
  clinicId: string,
  token: string,
  fence: number,
): Promise<"fence_superseded" | "not_claimable"> {
  const row = await store.read(clinicId, token);
  if (row && row.fence !== fence) return "fence_superseded";
  return "not_claimable";
}
