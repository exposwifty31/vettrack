import type { RfidRead } from "./adapter";

/**
 * Module 3 — direction inference (DESCOPED to internal evidence on this branch).
 *
 * DEVIATION FROM PLAN: the plan expected R-M1's M1.2 to have added
 * `direction`/`fromGateway`/`toGateway` to the ingest `RfidBatchSchema`. On this
 * branch R-M1 has NOT landed (the schema is still `{tagEpc, gatewayCode, readAt}`
 * — verified against `server/routes/rfid-batch.schema.ts` and ADR-006's
 * vendor-neutral contract). Because the route schema is non-`.strict()`, any
 * directional field the controller emitted would be SILENTLY STRIPPED — it
 * would never arrive, and an e2e "assert 202" would falsely pass.
 *
 * So this tracker computes movement direction from time/sequence ONLY (last
 * gateway a tag was seen at → new gateway), and that direction is treated as
 * INTERNAL evidence: it drives Module 4's "is this a crossing?" decision and is
 * available for logging, but it is NEVER serialized onto the wire. The envelope
 * (Module 5) carries only `{tagEpc, gatewayCode, readAt}` where `gatewayCode` is
 * the destination gateway. Antenna-geometry / RSSI / loiter/tailgate inference
 * is hardware-track (ADR-004/006) and explicitly out of this core.
 *
 * When R-M1's directional schema lands, Module 5 can additively surface
 * `fromGateway`/`toGateway` from this tracker without changing its logic.
 */
export type Movement =
  | { kind: "same"; tagEpc: string; gatewayCode: string; readAt: Date }
  | {
      kind: "moved";
      tagEpc: string;
      /** Internal evidence only — NOT serialized (see file header). */
      fromGateway: string | null;
      toGateway: string;
      /** Wire-facing gateway = destination (where the tag now is). */
      gatewayCode: string;
      readAt: Date;
    };

export class DirectionTracker {
  private readonly lastGatewayByTag = new Map<string, string>();

  /** Last gateway a tag was seen at, or null if never seen. */
  lastGateway(tagEpc: string): string | null {
    return this.lastGatewayByTag.get(tagEpc) ?? null;
  }

  /** Classify a read as a same-gateway presence or a crossing to a new gateway. */
  observe(read: RfidRead): Movement {
    const prev = this.lastGatewayByTag.get(read.tagEpc) ?? null;
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
