import type { RfidRead } from "./adapter";

/**
 * Module 2 — read debounce/dedup.
 *
 * Collapses a burst of repeat reads of the SAME tag at the SAME gateway within
 * a window down to one logical presence, so the controller never forwards raw
 * per-read chatter (ADR-005: aggregate to movement, never raw reads). This is
 * NOT the room-change authority — the server re-derives room changes; this only
 * throttles duplicates on the reader side. Debounce is keyed on event time
 * (`readAt`), not wall clock, so it is deterministic and replayable.
 */
export interface DebounceOptions {
  windowMs: number;
}

/**
 * Dedup key. `normalizeRead` does NOT forbid separator characters inside an EPC
 * or gateway code, so a `${tag}<sep>${gateway}` scheme is not provably
 * injective — an adversarial pair could embed the separator and collide with a
 * distinct pair, suppressing a valid read. JSON.stringify of the tuple is
 * unambiguous (quoting + escaping guarantee distinct pairs map to distinct
 * keys) and stays pure-ASCII / diffable.
 */
function key(read: RfidRead): string {
  return JSON.stringify([read.tagEpc, read.gatewayCode]);
}

export class ReadDebouncer {
  private readonly windowMs: number;
  private readonly lastAcceptedMs = new Map<string, number>();

  constructor(opts: DebounceOptions) {
    this.windowMs = opts.windowMs;
  }

  /**
   * Returns the read when it opens a NEW logical presence at (tag, gateway),
   * or null when it is a repeat suppressed inside the debounce window.
   */
  accept(read: RfidRead): RfidRead | null {
    const k = key(read);
    const t = read.readAt.getTime();
    const last = this.lastAcceptedMs.get(k);
    if (last !== undefined && t - last <= this.windowMs) {
      return null;
    }
    this.lastAcceptedMs.set(k, t);
    return read;
  }
}
