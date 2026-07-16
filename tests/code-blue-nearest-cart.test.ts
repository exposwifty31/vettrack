/**
 * R-CBF-1.1 (sub-card) · Nearest-ready-cart RESOLVER.
 *
 * `resolveNearestReadyCart(clinicId, initiatingUserId, deps, clientHint?)`
 * produces the deterministic, nearest-first ordered list of candidate crash
 * carts that R-CBF-1.1's orchestration then feeds to the soft-reserve CAS loop.
 *
 * Frozen Code Blue doctrine (this card): the initiating location is
 * SERVER-AUTHORITATIVE — re-derived from the authenticated user's clinic-scoped
 * open check-in room → else last equipment-scan room → else none. A
 * client-submitted location is at most a HINT, re-validated against the server
 * source and NEVER trusted to steer selection (a stale/tampered client value
 * must not steer emergency-cart reservation). The candidate set is READY
 * crash-cart-type equipment with `reservedForSessionId IS NULL`, clinic-scoped.
 * Distance uses the adjacency model when present, else the last-known-location
 * (same-room) fallback; deterministic tie-break by ascending cart id.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveNearestReadyCart,
  SAME_ROOM_DISTANCE_MODEL,
  DrizzleInitiatingLocationSource,
  DrizzleReadyCartCandidateSource,
  type ReadyCartCandidate,
  type InitiatingLocationSource,
  type ReadyCartCandidateSource,
  type RoomDistanceModel,
  type NearestReadyCartResolution,
} from "../server/lib/code-blue-nearest-cart.js";
import { equipment, scanLogs } from "../server/db.js";

const CLINIC = "clinic-1";
const OTHER_CLINIC = "clinic-2";
const USER = "user-1";

/**
 * Faithful in-memory model of the SERVER-AUTHORITATIVE location read: returns
 * ONLY the room the server derived for `(clinicId, userId)` — a client value is
 * never consulted here. Unknown → null (no distance).
 */
class InMemoryLocationSource implements InitiatingLocationSource {
  private readonly byUser = new Map<string, string | null>();

  set(clinicId: string, userId: string, roomId: string | null): void {
    this.byUser.set(`${clinicId}\0${userId}`, roomId);
  }

  async resolveInitiatingRoom(clinicId: string, userId: string): Promise<string | null> {
    return this.byUser.get(`${clinicId}\0${userId}`) ?? null;
  }
}

/**
 * Faithful in-memory model of the candidate read: READY crash-cart-type units
 * with `reservedForSessionId IS NULL`, clinic-scoped. Reserved units and
 * other-clinic units are excluded at the source, exactly like the SQL WHERE.
 */
class InMemoryCandidateSource implements ReadyCartCandidateSource {
  readonly carts: Array<{
    id: string;
    clinicId: string;
    roomId: string | null;
    reservedForSessionId: string | null;
    ready: boolean;
    crashCart: boolean;
  }> = [];

  seed(
    id: string,
    clinicId: string,
    roomId: string | null,
    opts: { reservedForSessionId?: string | null; ready?: boolean; crashCart?: boolean } = {},
  ): void {
    this.carts.push({
      id,
      clinicId,
      roomId,
      reservedForSessionId: opts.reservedForSessionId ?? null,
      ready: opts.ready ?? true,
      crashCart: opts.crashCart ?? true,
    });
  }

  async listReadyCandidates(clinicId: string): Promise<ReadyCartCandidate[]> {
    return this.carts
      .filter(
        (c) =>
          c.clinicId === clinicId &&
          c.ready &&
          c.crashCart &&
          c.reservedForSessionId === null,
      )
      .map((c) => ({ id: c.id, roomId: c.roomId }));
  }
}

/**
 * A stub adjacency model with an explicit distance table so a test can prove
 * the resolver ranks by server-derived distance (not by cart id, not by a
 * client hint). Unknown pairs → null (unreachable / unranked).
 */
class TableDistanceModel implements RoomDistanceModel {
  private readonly table = new Map<string, number>();

  set(fromRoomId: string, toRoomId: string, dist: number): void {
    this.table.set(`${fromRoomId}\0${toRoomId}`, dist);
    this.table.set(`${toRoomId}\0${fromRoomId}`, dist);
  }

  distance(_clinicId: string, fromRoomId: string, toRoomId: string): number | null {
    if (fromRoomId === toRoomId) return 0;
    return this.table.get(`${fromRoomId}\0${toRoomId}`) ?? null;
  }
}

describe("R-CBF-1.1 · nearest-ready-cart resolver (server-authoritative selection)", () => {
  it("orders candidates by server-derived room distance, nearest first", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA");

    const candidates = new InMemoryCandidateSource();
    candidates.seed("cartFar", CLINIC, "roomC");
    candidates.seed("cartNear", CLINIC, "roomB");
    candidates.seed("cartHere", CLINIC, "roomA");

    const distance = new TableDistanceModel();
    distance.set("roomA", "roomB", 1);
    distance.set("roomA", "roomC", 5);

    const result = await resolveNearestReadyCart(CLINIC, USER, {
      locationSource: location,
      candidateSource: candidates,
      distanceModel: distance,
    });

    expect(result.initiatingRoomId).toBe("roomA");
    expect(result.orderedCartIds).toEqual(["cartHere", "cartNear", "cartFar"]);
  });

  it("breaks ties by ascending cart id (deterministic)", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA");

    const candidates = new InMemoryCandidateSource();
    // Seeded in a non-sorted order; all equidistant (same room => distance 0).
    candidates.seed("cart-c", CLINIC, "roomA");
    candidates.seed("cart-a", CLINIC, "roomA");
    candidates.seed("cart-b", CLINIC, "roomA");

    const result = await resolveNearestReadyCart(CLINIC, USER, {
      locationSource: location,
      candidateSource: candidates,
    });

    expect(result.orderedCartIds).toEqual(["cart-a", "cart-b", "cart-c"]);
  });

  it("a tampered/stale client hint does NOT change the server-derived selection", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA"); // the ONLY authoritative truth

    const candidates = new InMemoryCandidateSource();
    candidates.seed("cartFar", CLINIC, "roomC");
    candidates.seed("cartNear", CLINIC, "roomB");

    const distance = new TableDistanceModel();
    distance.set("roomA", "roomB", 1);
    distance.set("roomA", "roomC", 5);
    // If the tampered hint (roomC) were trusted, cartFar would rank first.
    distance.set("roomC", "roomB", 9);

    const deps = { locationSource: location, candidateSource: candidates, distanceModel: distance };

    const trusted = await resolveNearestReadyCart(CLINIC, USER, deps);
    const tampered = await resolveNearestReadyCart(CLINIC, USER, deps, { roomId: "roomC" });

    // Selection is identical whether or not a (wrong) client hint is supplied.
    expect(tampered.orderedCartIds).toEqual(trusted.orderedCartIds);
    expect(tampered.orderedCartIds).toEqual(["cartNear", "cartFar"]);
    expect(tampered.initiatingRoomId).toBe("roomA");
    expect(tampered.clientHintIgnored).toBe(true);
  });

  it("a client hint matching the server source is accepted (not flagged ignored) and still does not steer", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA");

    const candidates = new InMemoryCandidateSource();
    candidates.seed("cartNear", CLINIC, "roomB");

    const distance = new TableDistanceModel();
    distance.set("roomA", "roomB", 1);

    const result = await resolveNearestReadyCart(
      CLINIC,
      USER,
      { locationSource: location, candidateSource: candidates, distanceModel: distance },
      { roomId: "roomA" },
    );

    expect(result.clientHintIgnored).toBe(false);
    expect(result.orderedCartIds).toEqual(["cartNear"]);
  });

  it("falls back to any ready cart (ascending id, no distance) when the server has no location", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, null); // no check-in room, no last-scan room

    const candidates = new InMemoryCandidateSource();
    candidates.seed("cart-z", CLINIC, "roomC");
    candidates.seed("cart-a", CLINIC, "roomB");
    candidates.seed("cart-m", CLINIC, null);

    const distance = new TableDistanceModel();
    distance.set("roomB", "roomC", 1); // must be ignored — no server location

    const result = await resolveNearestReadyCart(CLINIC, USER, {
      locationSource: location,
      candidateSource: candidates,
      distanceModel: distance,
    });

    expect(result.initiatingRoomId).toBeNull();
    expect(result.orderedCartIds).toEqual(["cart-a", "cart-m", "cart-z"]);
  });

  it("ranks carts with an unknown/unreachable distance AFTER known ones, then by id", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA");

    const candidates = new InMemoryCandidateSource();
    candidates.seed("cart-known", CLINIC, "roomB"); // distance 2
    candidates.seed("cart-x", CLINIC, "roomZ"); // unknown distance
    candidates.seed("cart-w", CLINIC, null); // no room => unknown

    const distance = new TableDistanceModel();
    distance.set("roomA", "roomB", 2);

    const result = await resolveNearestReadyCart(CLINIC, USER, {
      locationSource: location,
      candidateSource: candidates,
      distanceModel: distance,
    });

    // Known-distance cart first; the two unknowns follow, tie-broken by id.
    expect(result.orderedCartIds).toEqual(["cart-known", "cart-w", "cart-x"]);
  });

  it("excludes already-reserved carts (the source never surfaces them)", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA");

    const candidates = new InMemoryCandidateSource();
    candidates.seed("cartReserved", CLINIC, "roomA", { reservedForSessionId: "sess-existing" });
    candidates.seed("cartOpen", CLINIC, "roomA");

    const result = await resolveNearestReadyCart(CLINIC, USER, {
      locationSource: location,
      candidateSource: candidates,
    });

    expect(result.orderedCartIds).toEqual(["cartOpen"]);
    expect(result.orderedCartIds).not.toContain("cartReserved");
  });

  it("is clinic-scoped: another clinic's ready carts are never candidates", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA");

    const candidates = new InMemoryCandidateSource();
    candidates.seed("cartOurs", CLINIC, "roomA");
    candidates.seed("cartTheirs", OTHER_CLINIC, "roomA");

    const result = await resolveNearestReadyCart(CLINIC, USER, {
      locationSource: location,
      candidateSource: candidates,
    });

    expect(result.orderedCartIds).toEqual(["cartOurs"]);
    expect(result.orderedCartIds).not.toContain("cartTheirs");
  });

  it("returns an empty ordering (no throw) when no ready cart is available", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA");

    const result = await resolveNearestReadyCart(CLINIC, USER, {
      locationSource: new InMemoryLocationSource(),
      candidateSource: new InMemoryCandidateSource(),
    });

    expect(result.orderedCartIds).toEqual([]);
  });
});

describe("R-CBF-1.1 · SAME_ROOM_DISTANCE_MODEL (pre-adjacency fallback)", () => {
  it("scores same-room as 0 and every other pair as unknown (null)", () => {
    expect(SAME_ROOM_DISTANCE_MODEL.distance(CLINIC, "roomA", "roomA")).toBe(0);
    expect(SAME_ROOM_DISTANCE_MODEL.distance(CLINIC, "roomA", "roomB")).toBeNull();
  });

  it("is the default model — same-room carts sort ahead of everything else", async () => {
    const location = new InMemoryLocationSource();
    location.set(CLINIC, USER, "roomA");

    const candidates = new InMemoryCandidateSource();
    candidates.seed("cartOtherRoom", CLINIC, "roomB");
    candidates.seed("cartSameRoom", CLINIC, "roomA");

    const result = await resolveNearestReadyCart(CLINIC, USER, {
      locationSource: location,
      candidateSource: candidates,
    });

    expect(result.orderedCartIds).toEqual(["cartSameRoom", "cartOtherRoom"]);
  });
});

/** Minimal chainable stub of the Drizzle query builder for the port impls. */
function fakeSelect(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  builder.from = passthrough;
  builder.innerJoin = passthrough;
  builder.where = passthrough;
  builder.orderBy = passthrough;
  builder.limit = async () => rows;
  // Drizzle query builders are thenable (awaitable without .limit()).
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}

describe("R-CBF-1.1 · Drizzle port implementations (server-authoritative reads)", () => {
  it("DrizzleInitiatingLocationSource returns the last-scan room when no check-in room is modeled", async () => {
    const executor = { select: () => fakeSelect([{ roomId: "room-from-scan" }]) };
    const source = new DrizzleInitiatingLocationSource(executor as never);

    const room = await source.resolveInitiatingRoom(CLINIC, USER);
    expect(room).toBe("room-from-scan");
  });

  it("DrizzleInitiatingLocationSource returns null when the user has no locating signal", async () => {
    const executor = { select: () => fakeSelect([]) };
    const source = new DrizzleInitiatingLocationSource(executor as never);

    expect(await source.resolveInitiatingRoom(CLINIC, USER)).toBeNull();
  });

  it("DrizzleReadyCartCandidateSource maps rows to {id, roomId}", async () => {
    const executor = {
      select: () =>
        fakeSelect([
          { id: "cart-a", roomId: "roomA" },
          { id: "cart-b", roomId: null },
        ]),
    };
    const source = new DrizzleReadyCartCandidateSource(executor as never);

    const rows = await source.listReadyCandidates(CLINIC);
    expect(rows).toEqual([
      { id: "cart-a", roomId: "roomA" },
      { id: "cart-b", roomId: null },
    ]);
  });

  it("the resolver module is clinic-scoped and CAS-hint-aware on every server read", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "server/lib/code-blue-nearest-cart.ts"),
      "utf8",
    );
    // Candidate set is READY crash-cart-type with reservedForSessionId IS NULL.
    expect(source).toContain('eq(equipment.readinessState, "ready")');
    expect(source).toContain("isNull(equipment.reservedForSessionId)");
    // Clinic-scoped on the candidate + scan reads.
    expect(source).toContain("eq(equipment.clinicId, clinicId)");
    expect(source).toContain("eq(scanLogs.clinicId, clinicId)");
    // Server-authoritative: selection re-reads the user's last scan by user id.
    expect(source).toContain("eq(scanLogs.userId, userId)");
  });

  it("the schema tables the resolver reads exist (equipment.roomId / scanLogs.userId)", () => {
    expect(equipment.roomId).toBeDefined();
    expect(equipment.reservedForSessionId).toBeDefined();
    expect(scanLogs.userId).toBeDefined();
  });
});

// Type-only guard: the resolution shape is stable for R-CBF-1.1's consumer.
const _shape: NearestReadyCartResolution = {
  orderedCartIds: [],
  initiatingRoomId: null,
  clientHintIgnored: false,
};
void _shape;
