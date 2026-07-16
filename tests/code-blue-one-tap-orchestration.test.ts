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
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  orchestrateOneTapCodeBlue,
  FenceSupersededError,
  ActiveSessionExistsError,
  deriveOutboxPagingState,
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
  DEFAULT_LEASE_MS,
  type StartClaimStore,
  type StartClaimRow,
} from "../server/lib/code-blue-start-claim.js";
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

class InMemoryPagingStateStore implements PagingStateStore {
  readonly states = new Map<string, PagingState>(); // clinic|session -> state
  private key(clinicId: string, sessionId: string) {
    return `${clinicId}|${sessionId}`;
  }
  set(clinicId: string, sessionId: string, state: PagingState): void {
    this.states.set(this.key(clinicId, sessionId), state);
  }
  async readStateForSession(clinicId: string, sessionId: string): Promise<PagingState | null> {
    return this.states.get(this.key(clinicId, sessionId)) ?? null;
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
      this.pagingStore.set(input.clinicId, sessionId, "queued");
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
    expect(h.pagingStore.states.size).toBe(0);
    // The durable claim survives in `claimed` (reclaimable once its lease lapses).
    const claim = h.claimStore.peek(CLINIC, "tok-1");
    expect(claim?.state).toBe("claimed");
    expect(claim?.sessionId).toBeNull();
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
  it("a replay reflects a `sent` page, not a static success", async () => {
    const h = makeHarness({ [CLINIC]: [{ id: "cart-a", roomId: "room-1" }] }, "room-1");
    const first = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    if (first.kind !== "created") throw new Error("unreachable");

    // The outbox publisher delivered the page since the create.
    h.pagingStore.set(CLINIC, first.sessionId, "sent");

    const replay = await orchestrateOneTapCodeBlue(h.deps, {
      clinicId: CLINIC,
      token: "tok-1",
      initiatingUserId: USER,
    });
    if (replay.kind !== "replay") throw new Error("unreachable");
    expect(replay.pagingState).toBe("sent");
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

    // The page job exhausted its retries and landed in the DLQ.
    h.pagingStore.set(CLINIC, first.sessionId, "failed");

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

describe("R-CBF-1.1 · outbox paging-state derivation", () => {
  it("maps an outbox row's delivery metadata onto the bounded paging enum", () => {
    expect(
      deriveOutboxPagingState({ publishedAt: null, errorType: null, retryCount: 0, lastAttemptAt: null }),
    ).toBe("queued");
    expect(
      deriveOutboxPagingState({ publishedAt: null, errorType: "transient", retryCount: 2, lastAttemptAt: new Date() }),
    ).toBe("processing");
    expect(
      deriveOutboxPagingState({ publishedAt: new Date(), errorType: null, retryCount: 0, lastAttemptAt: null }),
    ).toBe("sent");
    expect(
      deriveOutboxPagingState({ publishedAt: null, errorType: "permanent", retryCount: 50, lastAttemptAt: new Date() }),
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
