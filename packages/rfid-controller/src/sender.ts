import { RFID_HEADERS } from "./contract";
import { noopLogger, type Logger } from "./logger";

/**
 * Module 8 — HTTP sender + error classifier.
 *
 * POSTs the exact signed body to `/api/rfid/events` and classifies the result:
 *   - 202                                   → accepted
 *   - 4xx validation (400/401/413/…)        → DROPPED + surfaced, never retried
 *       (retrying a bad signature/schema forever is a footgun)
 *   - 403 RFID_INGEST_DISABLED              → STOPPED + surfaced (flag off)
 *   - 429                                    → BACKOFF (honor Retry-After)
 *   - 5xx / network error                    → BUFFERED into a bounded FIFO
 *       (cap + oldest-drop with a LOGGED counter), flushed in order
 *
 * Server-side idempotency (stale-read rejection keyed on readAt, plus the
 * deterministic batchId) makes buffered retries safe.
 */
export interface PreparedRequest {
  /** Exact bytes to POST — signed by Module 6, unchanged since. */
  body: Buffer;
  clinicId: string;
  /** `sha256=<hex>` header value. */
  signature: string;
}

export type SendOutcome =
  | { kind: "accepted"; status: number; result: unknown }
  | { kind: "dropped"; status: number; code: string }
  | { kind: "stopped"; status: number; code: string }
  | { kind: "backoff"; status: number; retryAfterMs: number }
  | { kind: "buffered"; reason: "server_error" | "network" };

export interface HttpSenderOptions {
  apiOrigin: string;
  clinicId: string;
  fetchFn?: typeof fetch;
  bufferCap?: number;
  defaultRetryAfterMs?: number;
  /** Per-POST operational deadline; a hung request aborts and is buffered. */
  requestTimeoutMs?: number;
  logger?: Logger;
}

const DEFAULT_BUFFER_CAP = 10_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class HttpSender {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly bufferCap: number;
  private readonly defaultRetryAfterMs: number;
  private readonly requestTimeoutMs: number;
  private readonly logger: Logger;
  private buffer: PreparedRequest[] = [];
  private dropped = 0;

  constructor(opts: HttpSenderOptions) {
    this.url = `${opts.apiOrigin.replace(/\/+$/, "")}/api/rfid/events`;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.bufferCap = opts.bufferCap ?? DEFAULT_BUFFER_CAP;
    this.defaultRetryAfterMs = opts.defaultRetryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.logger = opts.logger ?? noopLogger;
  }

  /**
   * POST one prepared batch, classify, and buffer on transient failure.
   * A 429 `backoff` is re-buffered here — mirroring `flush()` — so the caller's
   * retry pass re-sends the batch instead of silently dropping it (the per-
   * crossing directional/possible_egress evidence is NOT re-derivable later).
   */
  async send(request: PreparedRequest): Promise<SendOutcome> {
    const outcome = await this.attempt(request);
    if (outcome.kind === "buffered" || outcome.kind === "backoff") this.enqueue(request);
    return outcome;
  }

  bufferedCount(): number {
    return this.buffer.length;
  }

  droppedFromBuffer(): number {
    return this.dropped;
  }

  /** Re-send buffered requests in FIFO order; re-buffer any still-undelivered. */
  async flush(): Promise<SendOutcome[]> {
    const pending = this.buffer;
    this.buffer = [];
    const outcomes: SendOutcome[] = [];
    for (const request of pending) {
      const outcome = await this.attempt(request);
      outcomes.push(outcome);
      if (outcome.kind === "buffered" || outcome.kind === "backoff") {
        this.enqueue(request);
      }
    }
    return outcomes;
  }

  private enqueue(request: PreparedRequest): void {
    if (this.buffer.length >= this.bufferCap) {
      this.buffer.shift();
      this.dropped += 1;
      this.logger.warn("buffer_overflow_drop_oldest", {
        bufferCap: this.bufferCap,
        droppedTotal: this.dropped,
      });
    }
    this.buffer.push(request);
  }

  private async attempt(request: PreparedRequest): Promise<SendOutcome> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: "POST",
        headers: {
          [RFID_HEADERS.clinic]: request.clinicId,
          [RFID_HEADERS.signature]: request.signature,
          "content-type": "application/json",
        },
        body: request.body,
        // Bound the POST: a hung server/socket must not wedge the flush pass and
        // strand buffered evidence. A timeout aborts → caught below → buffered.
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      this.logger.warn("send_network_error", {
        clinicId: request.clinicId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { kind: "buffered", reason: "network" };
    }
    return this.classify(res, request);
  }

  private async classify(res: Response, request: PreparedRequest): Promise<SendOutcome> {
    const status = res.status;

    if (status === 202) {
      return { kind: "accepted", status, result: await safeJson(res) };
    }
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(res) ?? this.defaultRetryAfterMs;
      this.logger.warn("send_rate_limited", { clinicId: request.clinicId, retryAfterMs });
      return { kind: "backoff", status, retryAfterMs };
    }
    if (status >= 500) {
      this.logger.warn("send_server_error", { clinicId: request.clinicId, status });
      return { kind: "buffered", reason: "server_error" };
    }

    // 4xx: validation / auth / disabled — none of these succeed on retry.
    const body = (await safeJson(res)) as { code?: unknown } | undefined;
    const code = typeof body?.code === "string" ? body.code : `HTTP_${status}`;
    // Only the ingest-disabled flag stops the controller. Other 403s (a
    // permission/tenant/authorization failure) are non-retryable but must NOT be
    // misclassified as feature-disablement — drop them like any other 4xx.
    if (status === 403 && code === "RFID_INGEST_DISABLED") {
      this.logger.error("send_stopped_ingest_disabled", { clinicId: request.clinicId, status, code });
      return { kind: "stopped", status, code };
    }
    this.logger.error("send_dropped_validation", { clinicId: request.clinicId, status, code });
    return { kind: "dropped", status, code };
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** Parse `Retry-After` (delta-seconds or HTTP-date) into milliseconds. */
function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}
