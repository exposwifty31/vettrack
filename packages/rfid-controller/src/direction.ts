import type { RfidRead } from "./adapter";

/**
 * Module 3 — direction inference (internal movement evidence).
 *
 * R-M1 HAS landed: the ingest `RfidBatchSchema` (server/routes/rfid.ts) now
 * accepts optional directional fields — `direction` (enum entered|exited) plus a
 * both-or-neither `fromGateway`/`toGateway` pair — and the controller's Module 0
 * contract validates that same shape (pinned by `tests/contract-parity.test.ts`).
 *
 * This tracker computes movement from time/sequence ONLY (last gateway a tag was
 * seen at → new gateway). That movement is EVIDENCE: it drives Module 4's "is
 * this a crossing?" decision, and its `fromGateway`/`toGateway` pair is now
 * SERIALIZED by Module 5 whenever the crossing has a known origin (R-M1.2a
 * movement evidence, both-or-neither). What this tracker does NOT produce is a
 * classified `entered`/`exited` direction: that needs gateway-role geometry
 * (antenna-geometry / RSSI / loiter/tailgate inference is hardware-track,
 * ADR-004/006, out of this core). So a first sighting (`fromGateway === null`)
 * still emits the minimal `{tagEpc, gatewayCode, readAt}` triple, and the
 * `direction` enum is emitted only when an upstream hardware source supplies it.
 *
 * All of this stays ADVISORY-ONLY (ADR-006): the controller emits movement
 * evidence, never custody or authority — the server resolver owns precedence.
 */
export type Movement =
  | { kind: "same"; tagEpc: string; gatewayCode: string; readAt: Date }
  | {
      kind: "moved";
      tagEpc: string;
      /** Origin gateway (null on a first sighting). Serialized as the
       *  fromGateway/toGateway pair when non-null — see envelope.ts. */
      fromGateway: string | null;
      toGateway: string;
      /** Wire-facing gateway = destination (where the tag now is). */
      gatewayCode: string;
      readAt: Date;
    };

/**
 * Ceiling on distinct tags held in `lastGatewayByTag`. A long-running controller
 * fed noisy or hostile reader input would otherwise grow this map without bound
 * and eventually terminate the process. Well above any real clinic's tag
 * population, so recently active tags are always retained; only long-idle EPCs
 * are evicted (LRU), degrading their next read to a first-sighting crossing —
 * advisory only, the server re-derives room state.
 */
const MAX_TRACKED_TAGS = 100_000;

export class DirectionTracker {
  private readonly lastGatewayByTag = new Map<string, string>();
  private readonly maxTrackedTags: number;

  constructor(maxTrackedTags: number = MAX_TRACKED_TAGS) {
    // Hard ceiling: a NaN cap would disable eviction (`size > NaN` is always
    // false → unbounded growth), and Infinity / an over-MAX value would defeat
    // the claimed bound. Reject anything outside the integer range 1..MAX.
    if (
      !Number.isInteger(maxTrackedTags) ||
      maxTrackedTags < 1 ||
      maxTrackedTags > MAX_TRACKED_TAGS
    ) {
      throw new RangeError(
        `DirectionTracker: maxTrackedTags must be an integer in 1..${MAX_TRACKED_TAGS}`,
      );
    }
    this.maxTrackedTags = maxTrackedTags;
  }

  /** Last gateway a tag was seen at, or null if never seen. */
  lastGateway(tagEpc: string): string | null {
    return this.lastGatewayByTag.get(tagEpc) ?? null;
  }

  /** Classify a read as a same-gateway presence or a crossing to a new gateway. */
  observe(read: RfidRead): Movement {
    const prev = this.lastGatewayByTag.get(read.tagEpc) ?? null;
    // Delete first so re-inserting below moves this tag to the most-recent
    // (insertion-order) slot — eviction then targets the least-recently-observed EPC.
    this.lastGatewayByTag.delete(read.tagEpc);
    // Hard ceiling: evict oldest entries until there is room for exactly one more,
    // BEFORE inserting. The map never exceeds maxTrackedTags — not even transiently
    // across the set below. (A stable-cap map only ever needs one eviction here, but
    // the loop keeps the ceiling invariant robust regardless of prior state.)
    while (this.lastGatewayByTag.size >= this.maxTrackedTags) {
      const oldest = this.lastGatewayByTag.keys().next().value;
      if (oldest === undefined) break;
      this.lastGatewayByTag.delete(oldest);
    }
    this.lastGatewayByTag.set(read.tagEpc, read.gatewayCode);

    if (prev === read.gatewayCode) {
      return { kind: "same", tagEpc: read.tagEpc, gatewayCode: read.gatewayCode, readAt: read.readAt };
    }
    return {
      kind: "moved",
      tagEpc: read.tagEpc,
      fromGateway: prev,
      toGateway: read.gatewayCode,
      gatewayCode: read.gatewayCode,
      readAt: read.readAt,
    };
  }
}
