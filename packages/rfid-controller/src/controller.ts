import type { ReaderAdapter } from "./adapter";
import { MovementAggregator, TokenBucket } from "./aggregate";
import type { ControllerConfig } from "./config";
import { ReadDebouncer } from "./debounce";
import { buildEnvelope } from "./envelope";
import { noopLogger, type Logger } from "./logger";
import type { SecretSource } from "./secret-source";
import { HttpSender, type SendOutcome } from "./sender";
import { signBody } from "./signer";

/**
 * The composition root: adapter → debounce → aggregate → envelope → sign → send.
 * Advisory-only (ADR-006) — this produces movement EVIDENCE; it never asserts
 * custody or authority. The server resolver owns precedence (human room > RFID).
 */
export interface RfidControllerDeps {
  config: ControllerConfig;
  secretSource: SecretSource;
  sender: HttpSender;
  logger?: Logger;
  /** Injectable clock for the client rate governor (deterministic tests). */
  now?: () => number;
  /** Injectable sleep for rate-governor waits (deterministic tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface RunSummary {
  readsProcessed: number;
  batches: number;
  accepted: number;
  dropped: number;
  stopped: number;
  backoff: number;
  buffered: number;
  /**
   * Batches STILL in the retry buffer after the flush pass (bufferedCount()>0)
   * — a 429/5xx that never landed. Undelivered evidence, not "success".
   */
  undelivered: number;
  /** Batches evicted from the bounded retry buffer on overflow — lost. */
  bufferDropped: number;
  outcomes: SendOutcome[];
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const SECONDS_PER_MINUTE = 60;

export class RfidController {
  private readonly config: ControllerConfig;
  private readonly secretSource: SecretSource;
  private readonly sender: HttpSender;
  private readonly logger: Logger;
  private readonly now?: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: RfidControllerDeps) {
    this.config = deps.config;
    this.secretSource = deps.secretSource;
    this.sender = deps.sender;
    this.logger = deps.logger ?? noopLogger;
    this.now = deps.now;
    this.sleep = deps.sleep ?? DEFAULT_SLEEP;
  }

  /**
   * Drain a (finite) adapter through the pipeline. For synthetic/file/stdin
   * adapters the aggregator is drained at end-of-stream; a long-running reader
   * would drain on a windowed flush instead (future enhancement).
   */
  async run(adapter: ReaderAdapter): Promise<RunSummary> {
    const debouncer = new ReadDebouncer({ windowMs: this.config.debounceMs });
    const aggregator = new MovementAggregator({
      maxEventsPerBatch: this.config.maxEventsPerBatch,
      logger: this.logger,
    });

    const summary: RunSummary = {
      readsProcessed: 0,
      batches: 0,
      accepted: 0,
      dropped: 0,
      stopped: 0,
      backoff: 0,
      buffered: 0,
      undelivered: 0,
      bufferDropped: 0,
      outcomes: [],
    };

    // Client-side rate governor: stay <= rateLimitPerMinute POSTs/min (ADR-005)
    // so the server 120/min limiter rarely fires a 429. Empty bucket → WAIT for
    // refill, never drop.
    const governor = new TokenBucket({
      capacity: this.config.rateLimitPerMinute,
      refillPerSec: this.config.rateLimitPerMinute / SECONDS_PER_MINUTE,
      ...(this.now ? { now: this.now } : {}),
    });

    for await (const read of adapter.reads()) {
      summary.readsProcessed += 1;
      const kept = debouncer.accept(read);
      if (kept) aggregator.ingest(kept);
    }

    const batches = aggregator.drainBatches();
    let maxRetryAfterMs = 0;
    for (const events of batches) {
      await this.acquireToken(governor);
      const { body } = buildEnvelope(events, {
        ...(this.config.controllerVersion !== undefined
          ? { controllerVersion: this.config.controllerVersion }
          : {}),
      });
      const signature = signBody(body, this.secretSource.current());
      const outcome = await this.sender.send({ body, clinicId: this.config.clinicId, signature });
      summary.batches += 1;
      this.tally(summary, outcome);
      if (outcome.kind === "backoff") {
        maxRetryAfterMs = Math.max(maxRetryAfterMs, outcome.retryAfterMs);
      }
      if (outcome.kind === "stopped") {
        // Ingest is disabled for this clinic — stop; the operator must re-enable.
        this.logger.error("run_stopped_ingest_disabled", { clinicId: this.config.clinicId });
        break;
      }
    }

    // One retry pass for anything buffered by transient 5xx/network/429 failures.
    // The main loop is rate-governed; the retry pass must be too — honor the
    // largest Retry-After the server asked for, then acquire a governor token per
    // buffered batch so re-sends stay within rateLimitPerMinute rather than
    // bursting immediately.
    if (this.sender.bufferedCount() > 0) {
      if (maxRetryAfterMs > 0) await this.sleep(maxRetryAfterMs);
      const toRetry = this.sender.bufferedCount();
      for (let i = 0; i < toRetry; i += 1) await this.acquireToken(governor);
      for (const outcome of await this.sender.flush()) this.tally(summary, outcome);
    }

    // Anything still buffered (or evicted on overflow) never landed — surface it
    // so the CLI exit code reports undelivered evidence as a failure.
    summary.undelivered = this.sender.bufferedCount();
    summary.bufferDropped = this.sender.droppedFromBuffer();
    if (summary.undelivered > 0 || summary.bufferDropped > 0) {
      this.logger.error("run_undelivered_batches", {
        clinicId: this.config.clinicId,
        undelivered: summary.undelivered,
        bufferDropped: summary.bufferDropped,
      });
    }

    return summary;
  }

  /** Block until the governor grants a token; waits (never drops) when empty. */
  private async acquireToken(governor: TokenBucket): Promise<void> {
    let waitMs = governor.msUntilAvailable(1);
    while (waitMs > 0 && Number.isFinite(waitMs)) {
      await this.sleep(waitMs);
      waitMs = governor.msUntilAvailable(1);
    }
    governor.tryRemove(1);
  }

  private tally(summary: RunSummary, outcome: SendOutcome): void {
    summary.outcomes.push(outcome);
    switch (outcome.kind) {
      case "accepted":
        summary.accepted += 1;
        break;
      case "dropped":
        summary.dropped += 1;
        break;
      case "stopped":
        summary.stopped += 1;
        break;
      case "backoff":
        summary.backoff += 1;
        break;
      case "buffered":
        summary.buffered += 1;
        break;
    }
  }
}
