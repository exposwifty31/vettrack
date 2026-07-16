/**
 * R-CBF-1.1 (sub-card) — Nearest-ready-cart RESOLVER for Code Blue one-tap.
 *
 * Produces the deterministic, nearest-first ordered list of candidate crash
 * carts that R-CBF-1.1's orchestration feeds to the soft-reserve compare-and-set
 * loop (`reserveNearestReadyCart` in `code-blue-soft-reserve.ts`, R-CBF-1.2). The
 * loser of a CAS race simply advances to the next id in this ordering.
 *
 * SERVER-AUTHORITATIVE selection (frozen Code Blue doctrine — pinned in the
 * subspec): the initiating location is re-derived, inside the caller, from the
 * authenticated user's clinic-scoped signals — the open `vt_clinical_check_ins`
 * room → else the last equipment-scan room → else NONE (no distance; any ready
 * cart, id order). A client-submitted location is at most an optimistic HINT,
 * re-validated against the server source and NEVER trusted to steer selection: a
 * stale or tampered client value must not steer emergency-cart reservation. The
 * resolver always ranks by the server-derived room; the hint only sets the
 * `clientHintIgnored` flag (surfaced for telemetry/UX by the caller).
 *
 * Candidate set: READY crash-cart-type `vt_equipment` rows with
 * `reservedForSessionId IS NULL`, clinic-filtered. Distance uses R-M1.2's
 * adjacency model when injected, else the last-known-location (same-room)
 * fallback. Deterministic tie-break: ascending cart id.
 *
 * This module is pure composition over injectable ports — no endpoint, no claim
 * record, no reservation write (those are owned by sibling R-CBF-1.1a/1.1 cards).
 */
import { and, asc, desc, eq, ilike, isNull, isNotNull } from "drizzle-orm";
import { db, equipment, assetTypes, scanLogs } from "../db.js";
import type { AuditDbExecutor } from "./audit.js";

/** Accepts the app pool or an open transaction (compose inside R-CBF-1.1's txn). */
type DbExecutor = AuditDbExecutor | typeof db;

/** A ready crash-cart candidate: its unit id and last-known room (nullable). */
export interface ReadyCartCandidate {
  id: string;
  roomId: string | null;
}

/** An optimistic client-submitted location — re-validated, never trusted to steer. */
export interface ClientLocationHint {
  roomId: string | null;
}

/**
 * SERVER-AUTHORITATIVE source of the initiating user's location. The Drizzle
 * implementation re-reads the clinic-scoped signals; tests inject a faithful
 * in-memory model. Returns `null` when no locating signal is known.
 */
export interface InitiatingLocationSource {
  resolveInitiatingRoom(clinicId: string, userId: string): Promise<string | null>;
}

/**
 * SERVER-AUTHORITATIVE source of READY crash-cart candidates: clinic-scoped,
 * crash-cart asset type, `reservedForSessionId IS NULL`. Already-reserved and
 * other-clinic units are excluded at the source (never surfaced to selection).
 */
export interface ReadyCartCandidateSource {
  listReadyCandidates(clinicId: string): Promise<ReadyCartCandidate[]>;
}

/**
 * Room-adjacency distance model. R-M1.2 supplies the real graph; until then the
 * `SAME_ROOM_DISTANCE_MODEL` fallback is used. `distance` is a non-negative
 * number, or `null` when the pair is unknown/unreachable (ranked last).
 */
export interface RoomDistanceModel {
  distance(clinicId: string, fromRoomId: string, toRoomId: string): number | null;
}

export interface NearestReadyCartResolution {
  /**
   * Nearest-first, deterministic ordering (distance asc, unknown-distance last,
   * tie-break ascending cart id). Feeds `reserveNearestReadyCart`'s CAS loop.
   */
  orderedCartIds: string[];
  /** The server-derived initiating room; `null` → no distance used (any ready cart, id order). */
  initiatingRoomId: string | null;
  /** True when a client hint was supplied and did NOT match the server source (ignored). */
  clientHintIgnored: boolean;
}

export interface ResolveNearestReadyCartDeps {
  locationSource: InitiatingLocationSource;
  candidateSource: ReadyCartCandidateSource;
  /** Defaults to `SAME_ROOM_DISTANCE_MODEL` when R-M1.2's adjacency model is absent. */
  distanceModel?: RoomDistanceModel;
}

/**
 * Pre-adjacency fallback: the only computable distance without a room graph is
 * "same room" (0). Every other pair is unknown (`null`) and ranks after known
 * ones — so same-room carts sort first, everything else falls to id order.
 */
export const SAME_ROOM_DISTANCE_MODEL: RoomDistanceModel = {
  distance(_clinicId, fromRoomId, toRoomId) {
    return fromRoomId === toRoomId ? 0 : null;
  },
};

function byAscendingId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Resolve the nearest-first ordering of ready crash carts for an initiating
 * user, using ONLY the server-derived location. See the module doc for the
 * full doctrine.
 */
export async function resolveNearestReadyCart(
  clinicId: string,
  initiatingUserId: string,
  deps: ResolveNearestReadyCartDeps,
  clientHint?: ClientLocationHint,
): Promise<NearestReadyCartResolution> {
  const serverRoomId = await deps.locationSource.resolveInitiatingRoom(clinicId, initiatingUserId);
  const candidates = await deps.candidateSource.listReadyCandidates(clinicId);

  // Re-validate the client hint against the server source — never steer with it.
  const clientHintIgnored =
    clientHint !== undefined && (clientHint.roomId ?? null) !== serverRoomId;

  // No server location → no distance: any ready cart, deterministic id order.
  if (serverRoomId === null) {
    const orderedCartIds = candidates.map((c) => c.id).sort(byAscendingId);
    return { orderedCartIds, initiatingRoomId: null, clientHintIgnored };
  }

  const model = deps.distanceModel ?? SAME_ROOM_DISTANCE_MODEL;
  const ranked = candidates.map((c) => ({
    id: c.id,
    dist: c.roomId === null ? null : model.distance(clinicId, c.roomId, serverRoomId),
  }));

  ranked.sort((a, b) => {
    if (a.dist !== b.dist) {
      if (a.dist === null) return 1; // unknown distance ranks last
      if (b.dist === null) return -1;
      return a.dist - b.dist; // nearer first
    }
    return byAscendingId(a.id, b.id); // deterministic tie-break
  });

  return {
    orderedCartIds: ranked.map((r) => r.id),
    initiatingRoomId: serverRoomId,
    clientHintIgnored,
  };
}

/**
 * Crash-cart-type identification pattern. There is no first-class "is crash
 * cart" flag on `vt_equipment` yet, so the candidate source matches the unit's
 * asset-type name (case-insensitive, clinic-scoped). Swap to a first-class
 * marker here when one lands — the port keeps the resolver contract stable.
 */
export const CRASH_CART_ASSET_TYPE_NAME_PATTERN = "%crash%" as const;

/** Freshness bound on the last-scan location signal (mirrors location inference). */
const LAST_SCAN_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/**
 * Drizzle-backed SERVER-AUTHORITATIVE location read. Priority: the user's open
 * check-in room → else their last equipment-scan room → else null. The
 * check-in-room branch is reserved for the R-M1.2 / room-on-check-in model (no
 * room is modeled on `vt_clinical_check_ins` today), so it currently returns
 * null and the read falls through to the last-scan room. Every read is
 * clinic-scoped and keyed on the authenticated user id.
 */
export class DrizzleInitiatingLocationSource implements InitiatingLocationSource {
  private readonly executor: DbExecutor;

  constructor(executor: DbExecutor = db) {
    this.executor = executor;
  }

  async resolveInitiatingRoom(clinicId: string, userId: string): Promise<string | null> {
    const checkInRoom = await this.resolveOpenCheckInRoom(clinicId, userId);
    if (checkInRoom !== null) return checkInRoom;
    return this.resolveLastScanRoom(clinicId, userId);
  }

  /**
   * Room from the user's open `vt_clinical_check_ins` row. No room column is
   * modeled on the check-in yet (see R-M1.2); returns null until it lands, so
   * the caller degrades to the last-scan room.
   */
  private async resolveOpenCheckInRoom(_clinicId: string, _userId: string): Promise<string | null> {
    return null;
  }

  /** Room of the user's most recent (fresh) equipment scan, clinic-scoped. */
  private async resolveLastScanRoom(clinicId: string, userId: string): Promise<string | null> {
    const cutoff = new Date(Date.now() - LAST_SCAN_MAX_AGE_MS);
    const [row] = await this.executor
      .select({ roomId: equipment.roomId, timestamp: scanLogs.timestamp })
      .from(scanLogs)
      .innerJoin(
        equipment,
        and(eq(equipment.id, scanLogs.equipmentId), eq(equipment.clinicId, clinicId)),
      )
      .where(
        and(
          eq(scanLogs.clinicId, clinicId),
          eq(scanLogs.userId, userId),
          isNotNull(scanLogs.equipmentId),
        ),
      )
      .orderBy(desc(scanLogs.timestamp))
      .limit(1);

    if (!row) return null;
    if (row.timestamp && row.timestamp.getTime() < cutoff.getTime()) return null;
    return row.roomId ?? null;
  }
}

/**
 * Drizzle-backed candidate read: READY crash-cart-type equipment with
 * `reservedForSessionId IS NULL`, clinic-scoped, not soft-deleted, ordered by
 * ascending id for a stable base ordering. Crash-cart type is matched on the
 * asset-type name (see `CRASH_CART_ASSET_TYPE_NAME_PATTERN`).
 */
export class DrizzleReadyCartCandidateSource implements ReadyCartCandidateSource {
  private readonly executor: DbExecutor;

  constructor(executor: DbExecutor = db) {
    this.executor = executor;
  }

  async listReadyCandidates(clinicId: string): Promise<ReadyCartCandidate[]> {
    return this.executor
      .select({ id: equipment.id, roomId: equipment.roomId })
      .from(equipment)
      .innerJoin(
        assetTypes,
        and(eq(assetTypes.id, equipment.assetTypeId), eq(assetTypes.clinicId, clinicId)),
      )
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          eq(equipment.readinessState, "ready"),
          isNull(equipment.reservedForSessionId),
          isNull(equipment.deletedAt),
          ilike(assetTypes.name, CRASH_CART_ASSET_TYPE_NAME_PATTERN),
        ),
      )
      .orderBy(asc(equipment.id));
  }
}
