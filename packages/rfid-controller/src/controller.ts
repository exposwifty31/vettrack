import type { ReaderAdapter } from "./adapter";
import { MovementAggregator } from "./aggregate";
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
}

export interface RunSummary {
  readsProcessed: number;
  batches: number;
  accepted: number;
  dropped: number;
  stopped: number;
  backoff: number;
  buffered: number;
  outcomes: SendOutcome[];
}

export class RfidController {
  private readonly config: ControllerConfig;
  private readonly secretSource: SecretSource;
  private readonly sender: HttpSender;
  private readonly logger: Logger;

  constructor(deps: RfidControllerDeps) {
    this.config = deps.config;
    this.secretSource = deps.secretSource;
    this.sender = deps.sender;
    this.logger = deps.logger ?? noopLogger;
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
      outcomes: [],
    };

    for await (const read of adapter.reads()) {
      summary.readsProcessed += 1;
      const kept = debouncer.accept(read);
      if (kept) aggregator.ingest(kept);
    }

    const batches = aggregator.drainBatches();
    for (const events of batches) {
      const { body } = buildEnvelope(events, {
        ...(this.config.controllerVersion !== undefined
          ? { controllerVersion: this.config.controllerVersion }
          : {}),
      });
      const signature = signBody(body, this.secretSource.current());
      const outcome = await this.sender.send({ body, clinicId: this.config.clinicId, signature });
      summary.batches += 1;
      this.tally(summary, outcome);
      if (outcome.kind === "stopped") {
        // Ingest is disabled for this clinic — stop; the operator must re-enable.
        this.logger.error("run_stopped_ingest_disabled", { clinicId: this.config.clinicId });
        break;
      }
    }

    // One retry pass for anything buffered by transient 5xx/network failures.
    if (this.sender.bufferedCount() > 0) {
      for (const outcome of await this.sender.flush()) this.tally(summary, outcome);
    }

    return summary;
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
