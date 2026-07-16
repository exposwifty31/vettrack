/**
 * R-CBF-1.1 · Orchestration ENDPOINT that COMPOSES the already-built pieces.
 *
 * This sub-card owns ONLY the composition (claim → cart → CAS reserve → session
 * → outbox paging → commit). The claim lifecycle (1.1a), the nearest-ready-cart
 * resolver (1.1b) and the CAS soft-reserve (1.2) are separate, already-tested
 * cards; this suite proves they are wired together in the pinned order with the
 * pinned retry/replay/reclaim semantics.
 *
 * The composition runs against faithful in-memory models of the same durable
 * ports the real Drizzle wiring uses (mirroring the 1.1a suite's approach): the
 * REAL `claimStart` / `commitClaim` fencing, the REAL `reserveNearestReadyCart`
 * CAS loop, and the REAL `resolveNearestReadyCart` ordering are exercised — only
 * the storage + the atomic-transaction boundary are modelled in memory.
 *
 * Pinned RED coverage:
 *  - one call → reserved nearest-ready cart + session + outbox paging + enqueue;
 *  - committed-replay reuses the same session with NO second reservation;
 *  - an ACTIVE-LEASE retry is a retryable conflict with NO cart/session/outbox
 *    side effect (neither replay nor reclaim);
 *  - two concurrent same-token starts → exactly ONE committed session;
 *  - an aborted session transaction leaves the claim `claimed` + no partial;
 *  - an expired/aborted claim reclaims and creates a FRESH committed session;
 *  - a replay reports the CURRENT durable paging state;
 *  - an exhausted-retry `failed` is reported WITHOUT deleting the session;
 *  - cross-clinic isolation.
 *
 * Frozen Code Blue doctrine: the endpoint is an emergency mutation — it MUST be
 * offline-blocked via `classifyEmergencyEndpoint` and reached only through the
 * typed `src/lib/api.ts` guard.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  orchestrateOneTapCodeBlue,
  FenceSupersededError,
  ActiveSessionExistsError,
  deriveOutboxPagingState,
  DrizzleOneTapSessionTransaction,
  DrizzlePagingStateStore,
  type PagingState,
  type PagingStateStore,
  type OneTapSessionTransaction,
  type OneTapSessionTxInput,
  type OneTapSessionTxResult,
  type OneTapDeps,
} from "../server/lib/code-blue-one-tap.js";
import {
  claimStart,
  commitClaim,
  DrizzleStartClaimStore,
  DEFAULT_LEASE_MS,
  type StartClaimStore,
  type StartClaimRow,
} from "../server/lib/code-blue-start-claim.js";
import { insertRealtimeDomainEvent } from "../server/lib/realtime-outbox.js";
import {
  db,
  pool,
  clinics,
  equipment as equipmentTable,
  codeBlueSessions,
  codeBlueLogEntries,
  codeBlueStartClaims,
  eventOutbox,
} from "../server/db.js";
import {
  reserveNearestReadyCart,
  clearReservationForSession,
  type CartReservationStore,
} from "../server/lib/code-blue-soft-reserve.js";
import {
  resolveNearestReadyCart,
  SAME_ROOM_DISTANCE_MODEL,
  type ReadyCartCandidate,
  type InitiatingLocationSource,
  type ReadyCartCandidateSource,
  type ClientLocationHint,
  type NearestReadyCartResolution,
} from "../server/lib/code-blue-nearest-cart.js";
import { classifyEmergencyEndpoint } from "../src/lib/offline-emergency-block";

const CLINIC = "clinic-1";
const OTHER_CLINIC = "clinic-2";
const USER = "user-1";
const T0 = new Date("2026-07-16T10:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

// ─── faithful in-memory port models ──────────────────────────────────────────

class InMemoryStartClaimStore implements StartClaimStore {
  readonly rows = new Map<string, StartClaimRow>();
  private key(clinicId: string, token: string) {
    return `${clinicId}|${token}`;
  }
  peek(clinicId: string, token: string): StartClaimRow | undefined {
    const r = this.rows.get(this.key(clinicId, token));
    return r ? { ...r } : undefined;
  }
  async read(clinicId: string, token: string): Promise<StartClaimRow | null> {
    const r = this.rows.get(this.key(clinicId, token));
    return r ? { ...r } : null;
  }
  async insertClaimed(row: StartClaimRow): Promise<boolean> {
    const k = this.key(row.clinicId, row.token);
    if (this.rows.has(k)) return false;
    this.rows.set(k, { ...row });
    return true;
  }
  async casReclaim(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
    newFence: number;
    leaseUntil: Date;
    asOf: Date;
  }): Promise<boolean> {
    const k = this.key(input.clinicId, input.token);
    const r = this.rows.get(k);
    if (!r || r.fence !== input.expectedFence) return false;
    const reclaimable =
      r.state === "released" ||
      (r.state === "claimed" && r.leaseUntil.getTime() <= input.asOf.getTime());
    if (!reclaimable) return false;
    this.rows.set(k, {
      ...r,
      state: "claimed",
      fence: input.newFence,
      leaseUntil: input.leaseUntil,
      sessionId: null,
    });
    return true;
  }
  async casCommit(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
    sessionId: string;
    updatedAt: Date;
  }): Promise<boolean> {
    const k = this.key(input.clinicId, input.token);
    const r = this.rows.get(k);
    if (!r || r.fence !== input.expectedFence || r.state !== "claimed") return false;
    this.rows.set(k, { ...r, state: "committed", sessionId: input.sessionId });
    return true;
  }
  async casRelease(input: {
    clinicId: string;
    token: string;
    expectedFence: number;
    updatedAt: Date;
  }): Promise<boolean> {
    const k = this.key(input.clinicId, input.token);
    const r = this.rows.get(k);
    if (!r || r.fence !== input.expectedFence || r.state !== "claimed") return false;
    this.rows.set(k, { ...r, state: "released" });
    return true;
  }
}

class InMemoryCartReservationStore implements CartReservationStore {
  readonly reserved = new Map<string, string>(); // clinic|cart -> sessionId
  private key(clinicId: string, cartId: string) {
    return `${clinicId}|${cartId}`;
  }
  reservationFor(clinicId: string, cartId: string): string | undefined {
    return this.reserved.get(this.key(clinicId, cartId));
  }
  count(clinicId: string): number {
    let n = 0;
    for (const k of this.reserved.keys()) if (k.startsWith(`${clinicId}|`)) n++;
    return n;
  }
  async compareAndReserve(clinicId: string, cartId: string, sessionId: string): Promise<boolean> {
    const k = this.key(clinicId, cartId);
    if (this.reserved.has(k)) return false;
    this.reserved.set(k, sessionId);
    return true;
  }
  async clearBySession(clinicId: string, sessionId: string): Promise<void> {
    for (const [k, v] of this.reserved) {
      if (v === sessionId && k.startsWith(`${clinicId}|`)) this.reserved.delete(k);
    }
  }
}

/**
 * Faithful in-memory model of the DURABLE paging-state derivation the Drizzle
 * store performs — it does NOT store a `PagingState` directly. Instead it models
 * the two real signals and routes them through the SHARED `deriveOutboxPagingState`:
 *
 *   1. the `NOTIFICATION_REQUESTED` outbox row's OWN delivery metadata
 *      (`publishedAt` = fanned out to the realtime bus / picked up by the
 *      notification worker — NOT "team page delivered"), and
 *   2. the correlated terminal outcome carried on a SEPARATE
 *      `NOTIFICATION_SENT` / `NOTIFICATION_FAILED` row (the ACTUAL Web-Push
 *      delivery result, back-pointing via `requestedOutboxId`).
 *
 * Modelling both signals — rather than poking a `PagingState` enum directly —
 * is what proves the fix: `sent` MUST come from a terminal `NOTIFICATION_SENT`
 * row, never from the requested row's `publishedAt`; a DLQ'd page is `failed`,
 * never replayed as `sent`.
 */
interface RequestedRowModel {
  publishedAt: Date | null;
  errorType: string | null;
  retryCount: number;
  lastAttemptAt: Date | null;
  terminal: "sent" | "failed" | null;
}
class InMemoryPagingStateStore implements PagingStateStore {
  readonly rows = new Map<string, RequestedRowModel>(); // clinic|session -> requested-row model
  private key(clinicId: string, sessionId: string) {
    return `${clinicId}|${sessionId}`;
  }
  get size(): number {
    return this.rows.size;
  }
  /** The atomic session transaction wrote a queued NOTIFICATION_REQUESTED outbox row. */
  recordRequested(clinicId: string, sessionId: string): void {
    this.rows.set(this.key(clinicId, sessionId), {
      publishedAt: null,
      errorType: null,
      retryCount: 0,
      lastAttemptAt: null,
      terminal: null,
    });
  }
  /** The outbox publisher fanned the requested row out to the bus (NOT delivery). */
  markRequestedPublished(clinicId: string, sessionId: string, at: Date): void {
    const r = this.rows.get(this.key(clinicId, sessionId));
    if (r) r.publishedAt = at;
  }
  /** A correlated NOTIFICATION_SENT / NOTIFICATION_FAILED terminal row recorded the delivery outcome. */
  recordTerminal(clinicId: string, sessionId: string, terminal: "sent" | "failed"): void {
    const r = this.rows.get(this.key(clinicId, sessionId));
    if (r) r.terminal = terminal;
  }
  async readStateForSession(clinicId: string, sessionId: string): Promise<PagingState | null> {
    const r = this.rows.get(this.key(clinicId, sessionId));
    if (!r) return null;
    return deriveOutboxPagingState({
      requested: {
        publishedAt: r.publishedAt,
        errorType: r.errorType,
        retryCount: r.retryCount,
        lastAttemptAt: r.lastAttemptAt,
      },
      terminal: r.terminal,
    });
  }
}

/** In-memory candidate + location sources for the REAL resolver. */
function makeCandidateSource(map: Record<string, ReadyCartCandidate[]>): ReadyCartCandidateSource {
  return {
    async listReadyCandidates(clinicId: string) {
      // Filter out already-reserved carts to mirror the Drizzle source.
      return (map[clinicId] ?? []).map((c) => ({ ...c }));
    },
  };
}
function makeLocationSource(room: string | null): InitiatingLocationSource {
  return { async resolveInitiatingRoom() { return room; } };
}

/**
 * Faithful in-memory model of the atomic session transaction: reservation (REAL
 * CAS loop) + session insert + outbox paging insert + REAL fenced commitClaim,
 * committed together or rolled back together. A superseded fence throws
 * {@link FenceSupersededError}; an injected failure models a mid-transaction
 * abort; a pre-existing active session throws {@link ActiveSessionExistsError}.
 */
class InMemoryOneTapSessionTransaction implements OneTapSessionTransaction {
  readonly sessions = new Map<string, { clinicId: string; reservedCartId: string | null }>();
  private outboxSeq = 1000;
  failNext = false;
  readonly activeClinics = new Set<string>();

  constructor(
    private readonly claimStore: StartClaimStore,
    private readonly reservationStore: InMemoryCartReservationStore,
    private readonly pagingStore: InMemoryPagingStateStore,
  ) {}

  async run(input: OneTapSessionTxInput): Promise<OneTapSessionTxResult> {
    if (this.activeClinics.has(input.clinicId)) {
      throw new ActiveSessionExistsError(input.clinicId);
    }
    const sessionId = `sess-${input.clinicId}-${input.token}-${input.fence}`;
    const reservation = await reserveNearestReadyCart(
      this.reservationStore,
      input.clinicId,
      sessionId,
      input.orderedCartIds,
    );
    const reservedCartId = reservation.reserved ? reservation.cartId : null;
    try {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("simulated session insert failure");
      }
      const commit = await commitClaim(
        this.claimStore,
        input.clinicId,
        input.token,
        input.fence,
        sessionId,
        { now: input.now },
      );
      if (!commit.committed) {
        if (commit.reason === "fence_superseded") throw new FenceSupersededError(input.token);
        throw new Error(`claim not committable: ${commit.reason}`);
      }
      this.sessions.set(sessionId, { clinicId: input.clinicId, reservedCartId });
      this.activeClinics.add(input.clinicId);
      const pagingOutboxId = this.outboxSeq++;
      this.pagingStore.recordRequested(input.clinicId, sessionId);
      return { sessionId, reservedCartId, pagingOutboxId, pagingState: "queued" };
    } catch (err) {
      // Model transaction rollback: the reservation write is undone.
      await clearReservationForSession(this.reservationStore, input.clinicId, sessionId);
      throw err;
    }
  }
}

// ─── harness ─────────────────────────────────────────────────────────────────

interface Harness {
  claimStore: InMemoryStartClaimStore;
  reservationStore: InMemoryCartReservationStore;
  pagingStore: InMemoryPagingStateStore;
  sessionTx: InMemoryOneTapSessionTransaction;
  resolveCart: ReturnType<typeof vi.fn>;
  deps: OneTapDeps;
  clock: { now: Date };
}

function makeHarness(candidatesByClinic: Record<string, ReadyCartCandidate[]>, room: string | null): Harness {
  const claimStore = new InMemoryStartClaimStore();
  const reservationStore = new InMemoryCartReservationStore();
  const pagingStore = new InMemoryPagingStateStore();
  const sessionTx = new InMemoryOneTapSessionTransaction(claimStore, reservationStore, pagingStore);
  const candidateSource = makeCandidateSource(candidatesByClinic);
  const locationSource = makeLocationSource(room);
  const clock = { now: T0 };

  const resolveCart = vi.fn(
    (clinicId: string, userId: string, clientHint?: ClientLocationHint): Promise<NearestReadyCartResolution> =>
      resolveNearestReadyCart(
        clinicId,
        userId,
        { locationSource, candidateSource, distanceModel: SAME_ROOM_DISTANCE_MODEL },
        clientHint,
      ),
  );

  const deps: OneTapDeps = {
    claimStore,
    resolveCart,
    sessionTx,
    pagingStateStore: pagingStore,
    now: () => clock.now,
    leaseMs: DEFAULT_LEASE_MS,
  };
  return { claimStore, reservationStore, pagingStore, sessionTx, resolveCart, deps, clock };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("R-CBF-1.1 · one call → nearest cart + session + outbox paging", () => {
  it("reserves the nearest-ready cart, creates a session, and records a queued page", async () => {
    const h = makeHarness(
      { [CLINIC]: [{ id: "cart-b", roomId: "room-2" }, { id: "cart-a", roomId: "room-1" }] },
      "room-1",
    );

    const out = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });

    expect(out.kind).toBe("created");
    if (out.kind !== "created") throw new Error("unreachable");
    // Nearest ready cart (same-room 0-distance) is deterministically chosen.
    expect(out.reservedCartId).toBe("cart-a");
    // The cart is reserved to THIS session (advisory soft-reserve).
    expect(h.reservationStore.reservationFor(CLINIC, "cart-a")).toBe(out.sessionId);
    // A durable outbox paging row was written and starts `queued`.
    expect(out.pagingOutboxId).toBeGreaterThan(0);
    expect(out.pagingState).toBe("queued");
    // Session persisted + claim committed.
    expect(h.sessionTx.sessions.has(out.sessionId)).toBe(true);
    expect(h.claimStore.peek(CLINIC, "tok-1")?.state).toBe("committed");
    expect(h.claimStore.peek(CLINIC, "tok-1")?.sessionId).toBe(out.sessionId);
  });
});

describe("R-CBF-1.1 · committed-token REPLAY (no second reservation)", () => {
  it("a duplicate token after commit replays the same session and reserves no second cart", async () => {
    const h = makeHarness(
      { [CLINIC]: [{ id: "cart-a", roomId: "room-1" }, { id: "cart-b", roomId: "room-1" }] },
      "room-1",
    );

    const first = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    expect(first.kind).toBe("created");
    if (first.kind !== "created") throw new Error("unreachable");
    const reservedAfterFirst = h.reservationStore.count(CLINIC);
    h.resolveCart.mockClear();

    const replay = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });

    expect(replay.kind).toBe("replay");
    if (replay.kind !== "replay") throw new Error("unreachable");
    expect(replay.sessionId).toBe(first.sessionId);
    expect(replay.pagingState).toBe("queued");
    // No cart resolution and no second reservation on a committed replay.
    expect(h.resolveCart).not.toHaveBeenCalled();
    expect(h.reservationStore.count(CLINIC)).toBe(reservedAfterFirst);
    // Exactly one session ever created.
    expect(h.sessionTx.sessions.size).toBe(1);
  });
});

describe("R-CBF-1.1 · ACTIVE-LEASE retry is a retryable conflict (no side effects)", () => {
  it("an in-flight claim's retry returns conflict without touching cart/session/outbox", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");

    // An owner is mid-flight: it holds a `claimed` lease but has NOT committed.
    const owner = await claimStart(h.claimStore, CLINIC, "tok-1", { now: T0 });
    expect(owner.outcome).toBe("claimed");
    h.clock.now = later(DEFAULT_LEASE_MS - 1); // still within the lease

    const out = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });

    expect(out.kind).toBe("conflict");
    if (out.kind !== "conflict") throw new Error("unreachable");
    expect(out.reason).toBe("active_lease");
    // NO side effects: no cart resolution, no reservation, no session, no outbox.
    expect(h.resolveCart).not.toHaveBeenCalled();
    expect(h.reservationStore.count(CLINIC)).toBe(0);
    expect(h.sessionTx.sessions.size).toBe(0);
    // The in-flight owner's claim is untouched (no reclaim / fence bump).
    expect(h.claimStore.peek(CLINIC, "tok-1")?.fence).toBe(owner.fence);
    expect(h.claimStore.peek(CLINIC, "tok-1")?.state).toBe("claimed");
  });
});

describe("R-CBF-1.1 · two concurrent same-token starts → exactly ONE committed session", () => {
  it("the second observes the active claim (conflict); once committed a later retry replays", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");

    // Owner A wins the durable claim (in-flight).
    const a = await claimStart(h.claimStore, CLINIC, "tok-1", { now: T0 });
    expect(a.outcome).toBe("claimed");

    // Concurrent B arrives while A's lease is live → retryable conflict, no session.
    h.clock.now = later(1);
    const b = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    expect(b.kind).toBe("conflict");
    expect(h.sessionTx.sessions.size).toBe(0);

    // A completes its atomic session transaction with its own fence.
    const aResult = await h.sessionTx.run({
      clinicId: CLINIC,
      token: "tok-1",
      fence: a.fence,
      initiatingUserId: USER,
      orderedCartIds: ["cart-a"],
      now: later(1),
    });
    expect(h.sessionTx.sessions.size).toBe(1);

    // A later retry of the same token replays the single committed session.
    h.clock.now = later(2);
    const retry = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    expect(retry.kind).toBe("replay");
    if (retry.kind !== "replay") throw new Error("unreachable");
    expect(retry.sessionId).toBe(aResult.sessionId);
    expect(h.sessionTx.sessions.size).toBe(1);
  });
});

describe("R-CBF-1.1 · aborted session transaction leaves claim `claimed` + no partial", () => {
  it("a mid-transaction failure rolls back the reservation and never commits the claim", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");
    h.sessionTx.failNext = true;

    await expect(
      orchestrateOneTapCodeBlue(h.deps, {
        clinicId: CLINIC,
        token: "tok-1",
        initiatingUserId: USER,
      }),
    ).rejects.toThrow(/simulated session insert failure/);

    // No partial: no session, no lingering reservation, no outbox paging state.
    expect(h.sessionTx.sessions.size).toBe(0);
    expect(h.reservationStore.count(CLINIC)).toBe(0);
    expect(h.pagingStore.size).toBe(0);
    // The durable claim survives in `claimed` (reclaimable once its lease lapses).
    const claim = h.claimStore.peek(CLINIC, "tok-1");
    expect(claim?.state).toBe("claimed");
    expect(claim?.sessionId).toBeNull();
  });
});

describe("R-CBF-1.1 · an ActiveSessionExists conflict frees the token immediately (releases the claim)", () => {
  it("a pre-existing active session yields `active_session_exists` AND releases the claim (no full-lease wait)", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");
    // A Code Blue session is already active for this clinic — the real blocker is
    // a pre-existing session, NOT an in-flight owner of THIS token.
    h.sessionTx.activeClinics.add(CLINIC);

    const out = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });

    expect(out.kind).toBe("conflict");
    if (out.kind !== "conflict") throw new Error("unreachable");
    expect(out.reason).toBe("active_session_exists");
    // The claim is RELEASED (freed immediately) — NOT left `claimed` for the full
    // lease — so a retry with the same token is not forced to wait out the lease.
    expect(h.claimStore.peek(CLINIC, "tok-1")?.state).toBe("released");
    // No partial: no session, no lingering reservation.
    expect(h.sessionTx.sessions.size).toBe(0);
    expect(h.reservationStore.count(CLINIC)).toBe(0);
  });
});

describe("R-CBF-1.1 · expired/aborted claim RECLAIMS and creates a fresh session", () => {
  it("a retry after the lease lapses reclaims (higher fence) and commits a new session", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");
    h.sessionTx.failNext = true;

    // First attempt aborts mid-transaction → claim left `claimed`, lease running.
    await expect(
      orchestrateOneTapCodeBlue(h.deps, { clinicId: CLINIC, token: "tok-1", initiatingUserId: USER }),
    ).rejects.toThrow();
    const abortedFence = h.claimStore.peek(CLINIC, "tok-1")?.fence;

    // The lease lapses; a retry with the SAME token reclaims and creates a fresh
    // session — never an empty replay, never a permanent rejection.
    h.clock.now = later(DEFAULT_LEASE_MS + 1);
    const out = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });

    expect(out.kind).toBe("created");
    if (out.kind !== "created") throw new Error("unreachable");
    expect(out.reservedCartId).toBe("cart-a");
    expect(h.sessionTx.sessions.has(out.sessionId)).toBe(true);
    // Reclaimed under a strictly higher fence, then committed.
    const claim = h.claimStore.peek(CLINIC, "tok-1");
    expect(claim?.state).toBe("committed");
    expect(claim?.fence).toBeGreaterThan(abortedFence ?? 0);
  });
});

describe("R-CBF-1.1 · replay reports the CURRENT durable paging state", () => {
  it("a replay reflects a `sent` page (from a correlated NOTIFICATION_SENT row), not a static success", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");
    const first = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    if (first.kind !== "created") throw new Error("unreachable");

    // Web Push actually delivered the page → a correlated NOTIFICATION_SENT
    // terminal row (back-pointing via requestedOutboxId) records the outcome.
    h.pagingStore.recordTerminal(CLINIC, first.sessionId, "sent");

    const replay = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    if (replay.kind !== "replay") throw new Error("unreachable");
    expect(replay.pagingState).toBe("sent");
  });

  it("a fanned-out page with NO terminal delivery outcome replays as `processing`, NEVER `sent`", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");
    const first = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    if (first.kind !== "created") throw new Error("unreachable");

    // The requested outbox row was fanned out to the realtime bus / picked up by
    // the notification worker (publishedAt set) — but Web-Push delivery has NOT
    // completed, so there is NO NOTIFICATION_SENT / NOTIFICATION_FAILED row yet.
    // A replay must report `processing` (in-flight), NOT `sent` — the requested
    // row's own publishedAt is "fanned out", not "delivered".
    h.pagingStore.markRequestedPublished(CLINIC, first.sessionId, new Date());

    const replay = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    if (replay.kind !== "replay") throw new Error("unreachable");
    expect(replay.pagingState).toBe("processing");
    expect(replay.pagingState).not.toBe("sent");
  });
});

describe("R-CBF-1.1 · exhausted-retry `failed` is reported WITHOUT deleting the session", () => {
  it("a DLQ'd page replays as `failed` while the committed session survives", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");
    const first = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    if (first.kind !== "created") throw new Error("unreachable");

    // The page job exhausted its retries / had no active subscription and landed
    // in the DLQ → a correlated NOTIFICATION_FAILED terminal row records `failed`.
    h.pagingStore.recordTerminal(CLINIC, first.sessionId, "failed");

    const replay = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    if (replay.kind !== "replay") throw new Error("unreachable");
    expect(replay.pagingState).toBe("failed");
    // Server-confirmed end only: the committed session is NEVER deleted.
    expect(h.sessionTx.sessions.has(first.sessionId)).toBe(true);
  });
});

describe("R-CBF-1.1 · cross-clinic isolation", () => {
  it("the same token in two clinics yields two independent committed sessions", async () => {
    const h = makeHarness(
      {
        [CLINIC]: [{ id: "cart-a", roomId: "room-1" }],
        [OTHER_CLINIC]: [{ id: "cart-x", roomId: "room-1" }],
      },
      "room-1",
    );

    const one = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-shared",
      initiatingUserId: USER,
    });
    const two = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: OTHER_CLINIC,
      token: "tok-shared",
      initiatingUserId: USER,
    });

    expect(one.kind).toBe("created");
    expect(two.kind).toBe("created");
    if (one.kind !== "created" || two.kind !== "created") throw new Error("unreachable");
    expect(one.sessionId).not.toBe(two.sessionId);
    expect(one.reservedCartId).toBe("cart-a");
    expect(two.reservedCartId).toBe("cart-x");
    // Each clinic's claim is independent.
    expect(h.claimStore.peek(CLINIC, "tok-shared")?.sessionId).toBe(one.sessionId);
    expect(h.claimStore.peek(OTHER_CLINIC, "tok-shared")?.sessionId).toBe(two.sessionId);
  });
});

// ─── paging-state derivation (outbox row → durable state) ─────────────────────

describe("R-CBF-1.1 · outbox paging-state derivation (terminal-row-aware)", () => {
  const req = (over: Partial<{ publishedAt: Date | null; errorType: string | null; retryCount: number; lastAttemptAt: Date | null }> = {}) => ({
    publishedAt: null,
    errorType: null,
    retryCount: 0,
    lastAttemptAt: null,
    ...over,
  });

  it("queued: requested row untouched, no terminal outcome", () => {
    expect(deriveOutboxPagingState({ requested: req(), terminal: null })).toBe("queued");
  });

  it("processing: requested row FANNED OUT to the bus (publishedAt) but NO terminal outcome — NOT `sent`", () => {
    // The HIGH regression guard: the requested row's own publishedAt means
    // "fanned out to the realtime bus", NOT "team page delivered".
    expect(deriveOutboxPagingState({ requested: req({ publishedAt: new Date() }), terminal: null })).toBe(
      "processing",
    );
  });

  it("processing: requested row attempted (retry) but no terminal outcome", () => {
    expect(
      deriveOutboxPagingState({ requested: req({ errorType: "transient", retryCount: 2, lastAttemptAt: new Date() }), terminal: null }),
    ).toBe("processing");
  });

  it("sent ONLY from a correlated NOTIFICATION_SENT terminal row", () => {
    expect(deriveOutboxPagingState({ requested: req({ publishedAt: new Date() }), terminal: "sent" })).toBe("sent");
  });

  it("failed from a correlated NOTIFICATION_FAILED terminal row (even though the requested row published)", () => {
    expect(deriveOutboxPagingState({ requested: req({ publishedAt: new Date() }), terminal: "failed" })).toBe(
      "failed",
    );
  });

  it("failed when the requested row itself DLQ'd (permanent) before any delivery could be attempted", () => {
    expect(
      deriveOutboxPagingState({ requested: req({ errorType: "permanent", retryCount: 50, lastAttemptAt: new Date() }), terminal: null }),
    ).toBe("failed");
  });
});

// ─── frozen doctrine: offline-block + typed guard registration ────────────────

describe("R-CBF-1.1 · frozen Code Blue doctrine — emergency-mutation guard", () => {
  it("classifyEmergencyEndpoint blocks the one-tap endpoint as a `start` mutation", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/one-tap", "POST")).toBe("start");
    // Trailing slash / query normalize the same way.
    expect(classifyEmergencyEndpoint("/api/code-blue/one-tap/?retry=1", "POST")).toBe("start");
  });

  it("the one-tap endpoint is reached only through the typed src/lib/api.ts guard", () => {
    const apiSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/api.ts"), "utf8");
    expect(apiSrc).toContain("/api/code-blue/one-tap");
    expect(apiSrc).toContain("OneTapCodeBlueRequest");
    expect(apiSrc).toContain("OneTapCodeBlueResponse");
  });
});

// ─── OPT-IN DB integration — the REAL emergency-critical DB path ──────────────
//
// Exercises the shipped `DrizzleOneTapSessionTransaction` (advisory lock →
// single-active-session guard → CAS soft-reserve → session insert → dual outbox
// insert → fenced commitClaim) AND `DrizzlePagingStateStore` against real
// Postgres — the paging-state derivation the in-memory model only approximates.
// This is the guard the reviewer required: it proves, against real rows, that a
// fanned-out (published) NOTIFICATION_REQUESTED row with NO correlated terminal
// row reads `processing` — NOT `sent` — and that `sent`/`failed` come only from
// the correlated NOTIFICATION_SENT / NOTIFICATION_FAILED rows.
//
// Skipped by default (the unit run has no real DB). Run with:
//
//   CBF_ONETAP_DB_IT=1 DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack \
//     pnpm exec vitest run tests/code-blue-one-tap-orchestration.test.ts
//
// Uses a per-run throwaway clinic (random id) and deletes exactly its own rows.
describe.skipIf(!process.env.CBF_ONETAP_DB_IT)(
  "R-CBF-1.1 · DB integration — real session transaction + paging-state derivation",
  () => {
    const clinicId = `cbf11c-it-${randomUUID()}`;
    const cartId = `cart-${randomUUID()}`;
    const token = `cbf11c-tok-${randomUUID()}`;
    const userId = `user-${randomUUID()}`;
    const store = new DrizzlePagingStateStore(db);
    let sessionId = "";
    let pagingOutboxId: number | null = null;

    beforeAll(async () => {
      await db.insert(clinics).values({ id: clinicId }).onConflictDoNothing();
      await db.insert(equipmentTable).values({ id: cartId, clinicId, name: "IT Crash Cart" });

      // Step 1 (the orchestrator's job): write the durable claim so the atomic
      // transaction can fence-commit it in the same commit.
      const claim = await claimStart(new DrizzleStartClaimStore(db), clinicId, token, { now: new Date() });
      expect(claim.outcome).toBe("claimed");

      const tx = new DrizzleOneTapSessionTransaction({
        startedByUserId: userId,
        startedByName: "IT Initiator",
        managerUserId: userId,
        managerUserName: "IT Manager",
        preCheckPassed: true,
      });
      const result = await tx.run({
        clinicId,
        token,
        fence: claim.fence,
        initiatingUserId: userId,
        orderedCartIds: [cartId],
        now: new Date(),
      });
      sessionId = result.sessionId;
      pagingOutboxId = result.pagingOutboxId;
    });

    afterAll(async () => {
      await db.delete(codeBlueLogEntries).where(eq(codeBlueLogEntries.clinicId, clinicId));
      await db.delete(codeBlueSessions).where(eq(codeBlueSessions.clinicId, clinicId));
      await db.delete(codeBlueStartClaims).where(eq(codeBlueStartClaims.clinicId, clinicId));
      await db.delete(eventOutbox).where(eq(eventOutbox.clinicId, clinicId));
      await db.delete(equipmentTable).where(eq(equipmentTable.clinicId, clinicId));
      await db.delete(clinics).where(eq(clinics.id, clinicId));
      await pool.end();
    });

    it("commits the session, reserves the cart, writes the paging outbox row, and fence-commits the claim", async () => {
      const [session] = await db
        .select({ status: codeBlueSessions.status })
        .from(codeBlueSessions)
        .where(eq(codeBlueSessions.id, sessionId));
      expect(session?.status).toBe("active");

      // Advisory soft-reserve set to THIS session.
      const [cart] = await db
        .select({ reservedForSessionId: equipmentTable.reservedForSessionId })
        .from(equipmentTable)
        .where(eq(equipmentTable.id, cartId));
      expect(cart?.reservedForSessionId).toBe(sessionId);

      // The NOTIFICATION_REQUESTED row exists and is the returned paging handle.
      const reqRows = await db.execute(sql`
        SELECT id FROM vt_event_outbox
        WHERE clinic_id = ${clinicId} AND type = 'NOTIFICATION_REQUESTED'
          AND payload->>'sessionId' = ${sessionId}
      `);
      expect(reqRows.rows.length).toBe(1);
      expect(Number((reqRows.rows[0] as { id: number | string }).id)).toBe(pagingOutboxId);

      // Claim fence-committed and bound to the session.
      const [claim] = await db
        .select({ state: codeBlueStartClaims.state, sessionId: codeBlueStartClaims.sessionId })
        .from(codeBlueStartClaims)
        .where(and(eq(codeBlueStartClaims.clinicId, clinicId), eq(codeBlueStartClaims.token, token)));
      expect(claim?.state).toBe("committed");
      expect(claim?.sessionId).toBe(sessionId);
    });

    it("derives `queued` from a pristine requested row (not fanned out, no terminal outcome)", async () => {
      await db.execute(sql`
        UPDATE vt_event_outbox
        SET published_at = NULL, error_type = NULL, retry_count = 0, last_attempt_at = NULL
        WHERE id = ${pagingOutboxId}
      `);
      expect(await store.readStateForSession(clinicId, sessionId)).toBe("queued");
    });

    it("derives `processing`, NOT `sent`, from a FANNED-OUT requested row with no terminal outcome (HIGH regression guard)", async () => {
      // published_at set = fanned out to the realtime bus / worker — NOT delivered.
      await db.execute(sql`UPDATE vt_event_outbox SET published_at = NOW() WHERE id = ${pagingOutboxId}`);
      const state = await store.readStateForSession(clinicId, sessionId);
      expect(state).toBe("processing");
      expect(state).not.toBe("sent");
    });

    it("derives `sent` ONLY from a correlated NOTIFICATION_SENT row (requestedOutboxId back-pointer)", async () => {
      await insertRealtimeDomainEvent(db, {
        clinicId,
        type: "NOTIFICATION_SENT",
        payload: { requestedOutboxId: pagingOutboxId, scope: "aggregate" },
      });
      expect(await store.readStateForSession(clinicId, sessionId)).toBe("sent");
    });

    it("derives `failed` from a later correlated NOTIFICATION_FAILED row — and NEVER deletes the committed session", async () => {
      await insertRealtimeDomainEvent(db, {
        clinicId,
        type: "NOTIFICATION_FAILED",
        payload: { requestedOutboxId: pagingOutboxId, reason: "no_active_subscription" },
      });
      // The latest terminal row (FAILED, higher id) wins.
      expect(await store.readStateForSession(clinicId, sessionId)).toBe("failed");
      // Server-confirmed end only: a DLQ'd page must not delete the session.
      const [session] = await db
        .select({ status: codeBlueSessions.status })
        .from(codeBlueSessions)
        .where(eq(codeBlueSessions.id, sessionId));
      expect(session?.status).toBe("active");
    });
  },
);
