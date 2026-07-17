import type { RfidRead } from "./adapter";
import { DirectionTracker } from "./direction";
import { noopLogger, type Logger } from "./logger";
import { RFID_LIMITS, type RfidDirection } from "./contract";

/**
 * Module 4 — movement aggregation.
 *
 * Turns a stream of reads into MOVEMENT events (one per crossing), coalescing
 * latest-per-tag within a flush window — the same coalescing the server ingest
 * performs (`coalesceLatestPerTag`). This is what keeps a busy gate under the
 * 200-events/batch + 120-req/min ceilings (ADR-005): a flood of repeat reads of
 * one crossing collapses to a single event; same-gateway re-reads produce no new
 * movement. Floods are split into <=200-event batches and LOGGED — never
 * silently dropped. The controller is NOT the room-change authority; the server
 * re-derives it, so latest-per-tag coalescing is safe.
 */
export interface MovementEvent {
  tagEpc: string;
  /** Destination gateway (where the tag now is) — the wire-facing gatewayCode. */
  gatewayCode: string;
  readAt: Date;
  /**
   * Origin gateway of a resolved crossing, or null on a first sighting (no
   * known origin). When non-null it is SERIALIZED as the `fromGateway`/`toGateway`
   * pair (R-M1.2a movement evidence, both-or-neither) — see envelope.ts.
   */
  fromGateway: string | null;
  /**
   * Optional classified crossing direction (entered|exited). The time/sequence
   * tracker CANNOT derive this (no gateway-role geometry — ADR-004/006), so the
   * synthetic/file/stdin pipeline leaves it undefined; a hardware direction
   * source may supply it, and the envelope serializes it when present. Advisory
   * evidence only — never custody/authority.
   */
  direction?: RfidDirection;
}

export interface AggregatorOptions {
  maxEventsPerBatch?: number;
  logger?: Logger;
}

export class MovementAggregator {
  private readonly tracker = new DirectionTracker();
  private readonly pending = new Map<string, MovementEvent>();
  private readonly maxEventsPerBatch: number;
  private readonly logger: Logger;

  constructor(opts: AggregatorOptions = {}) {
    this.maxEventsPerBatch = opts.maxEventsPerBatch ?? RFID_LIMITS.maxEventsPerBatch;
    this.logger = opts.logger ?? noopLogger;
  }

  /** Feed one read; records a pending movement only when the tag crosses. */
  ingest(read: RfidRead): void {
    const movement = this.tracker.observe(read);
    if (movement.kind !== "moved") return; // same-gateway re-read → no new movement
    this.pending.set(movement.tagEpc, {
      tagEpc: movement.tagEpc,
      gatewayCode: movement.toGateway,
      readAt: movement.readAt,
      fromGateway: movement.fromGateway,
    });
  }

  /** Count of undrained pending movements. */
  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Drain pending movements into wire-ready batches of <= maxEventsPerBatch,
   * coalesced latest-per-tag. Clears the pending buffer. Splits (never drops)
   * under flood and logs when it has to split.
   */
  drainBatches(): MovementEvent[][] {
    if (this.pending.size === 0) return [];
    const events = [...this.pending.values()];
    this.pending.clear();

    const batches: MovementEvent[][] = [];
    for (let i = 0; i < events.length; i += this.maxEventsPerBatch) {
      batches.push(events.slice(i, i + this.maxEventsPerBatch));
    }
    if (batches.length > 1) {
      this.logger.warn("flush_flood_split", {
        totalEvents: events.length,
        batches: batches.length,
        maxEventsPerBatch: this.maxEventsPerBatch,
      });
    }
    return batches;
  }
}

/**
 * Token-bucket rate governor. Governs batch POSTs to stay <= 120/min/clinic
 * (ADR-005) without dropping: when empty, the caller waits/buffers rather than
 * discarding. `now` is injectable for deterministic tests.
 */
export interface TokenBucketOptions {
  capacity: number;
  refillPerSec: number;
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;
  private lastRefillMs: number;

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.now = opts.now ?? Date.now;
    this.tokens = opts.capacity;
    this.lastRefillMs = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    const gained = elapsedSec * this.refillPerSec;
    if (gained <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + gained);
    this.lastRefillMs = t;
  }

  /** Remove `n` tokens if available; returns false (no drop) when exhausted. */
  tryRemove(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** Current token count (post-refill) — for observability. */
  available(): number {
    this.refill();
    return this.tokens;
  }
}
