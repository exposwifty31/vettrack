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
 * seen at → new gateway). That movement is INTERNAL evidence: it drives Module
 * 4's "is this a crossing?" decision and is available for logging. `fromGateway`
 * is carried on the internal Movement/MovementEvent but is NOT serialized onto
 * the wire — directional emission is a DELIBERATE DEFERRAL documented on the
 * envelope (Module 5). The controller has no gateway-role geometry to classify a
 * crossing as entered vs exited (antenna-geometry / RSSI / loiter/tailgate
 * inference is hardware-track, ADR-004/006, out of this core), so it emits the
 * minimal safe `{tagEpc, gatewayCode, readAt}` where `gatewayCode` is the
 * destination gateway, and leaves directional emission to the hardware track.
 *
 * When that hardware track lands, Module 5 can additively surface
 * `fromGateway`/`toGateway` from this tracker without changing its logic — the
 * schema and contract already accept them.
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
