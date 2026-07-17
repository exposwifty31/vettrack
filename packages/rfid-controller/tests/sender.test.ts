import { describe, expect, it, vi } from "vitest";

import { HttpSender, type PreparedRequest } from "../src/sender";
import { createStderrLogger } from "../src/logger";

function req(batchId = "b1"): PreparedRequest {
  return {
    body: Buffer.from(JSON.stringify({ batchId, events: [] }), "utf8"),
    clinicId: "clinic-a",
    signature: "sha256=deadbeef",
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function senderWith(fetchFn: typeof fetch, extra: Partial<ConstructorParameters<typeof HttpSender>[0]> = {}) {
  return new HttpSender({ apiOrigin: "https://api.test", clinicId: "clinic-a", fetchFn, ...extra });
}

describe("HttpSender — response classifier", () => {
  it("202 → accepted (parses RfidIngestResult)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, { ok: true, accepted: 3, updated: 1 })) as unknown as typeof fetch;
    const out = await senderWith(fetchFn).send(req());
    expect(out.kind).toBe("accepted");
    if (out.kind === "accepted") expect((out.result as { accepted: number }).accepted).toBe(3);
  });

  it("sends canonical two-`t` headers + raw body", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, { ok: true })) as unknown as typeof fetch;
    const sender = senderWith(fetchFn);
    const r = req();
    await sender.send(r);
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("https://api.test/api/rfid/events");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("x-vettrack-clinic")).toBe("clinic-a");
    expect(headers.get("x-vettrack-signature")).toBe("sha256=deadbeef");
    expect((init as RequestInit).body).toBe(r.body);
  });

  it("400 INVALID_SCHEMA → dropped, never buffered", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(400, { ok: false, code: "INVALID_SCHEMA" })) as unknown as typeof fetch;
    const sender = senderWith(fetchFn);
    const out = await sender.send(req());
    expect(out.kind).toBe("dropped");
    if (out.kind === "dropped") expect(out.code).toBe("INVALID_SCHEMA");
    expect(sender.bufferedCount()).toBe(0);
  });

  it("401 INVALID_SIGNATURE → dropped (retrying a bad signature is a footgun)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { ok: false, code: "INVALID_SIGNATURE" })) as unknown as typeof fetch;
    const sender = senderWith(fetchFn);
    const out = await sender.send(req());
    expect(out.kind).toBe("dropped");
    expect(sender.bufferedCount()).toBe(0);
  });

  it("403 RFID_INGEST_DISABLED → stopped", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(403, { ok: false, code: "RFID_INGEST_DISABLED" })) as unknown as typeof fetch;
    const out = await senderWith(fetchFn).send(req());
    expect(out.kind).toBe("stopped");
    if (out.kind === "stopped") expect(out.code).toBe("RFID_INGEST_DISABLED");
  });

  it("403 WITHOUT RFID_INGEST_DISABLED → dropped (not stopped)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(403, { ok: false, code: "FORBIDDEN" })) as unknown as typeof fetch;
    const sender = senderWith(fetchFn);
    const out = await sender.send(req());
    expect(out.kind).toBe("dropped");
    if (out.kind === "dropped") expect(out.code).toBe("FORBIDDEN");
    expect(sender.bufferedCount()).toBe(0);
  });

  it("bounds each POST with an AbortSignal (a hung request cannot wedge the flush)", async () => {
    let seenSignal: unknown;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      seenSignal = init.signal;
      return jsonResponse(202, { ok: true });
    }) as unknown as typeof fetch;
    await senderWith(fetchFn).send(req());
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("actually aborts a hung request at requestTimeoutMs and buffers the outcome", async () => {
    // A `toBeInstanceOf(AbortSignal)` check alone passes even for a signal that
    // never fires. Prove the timeout genuinely aborts: fetch resolves ONLY when
    // the sender's own AbortSignal fires, so the buffered-network outcome is
    // reachable only if the request was aborted at the configured deadline.
    let seenSignal: AbortSignal | undefined;
    const fetchFn = vi.fn((_url: string, init: RequestInit) => {
      seenSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const sender = senderWith(fetchFn, { requestTimeoutMs: 20 });
    const out = await sender.send(req());

    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(true);
    expect(out.kind).toBe("buffered");
    if (out.kind === "buffered") expect(out.reason).toBe("network");
    expect(sender.bufferedCount()).toBe(1);
  });

  it("429 → backoff, honoring Retry-After seconds", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(429, { error: "slow down" }, { "retry-after": "5" })) as unknown as typeof fetch;
    const out = await senderWith(fetchFn).send(req());
    expect(out.kind).toBe("backoff");
    if (out.kind === "backoff") expect(out.retryAfterMs).toBe(5000);
  });

  it("5xx → buffered (transient, retryable)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(503, { error: "unavailable" })) as unknown as typeof fetch;
    const sender = senderWith(fetchFn);
    const out = await sender.send(req());
    expect(out.kind).toBe("buffered");
    expect(sender.bufferedCount()).toBe(1);
  });

  it("network error (fetch throws) → buffered", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const sender = senderWith(fetchFn);
    const out = await sender.send(req());
    expect(out.kind).toBe("buffered");
    expect(sender.bufferedCount()).toBe(1);
  });
});

describe("HttpSender — bounded FIFO buffer", () => {
  it("caps the buffer and drops the OLDEST with a logged counter (never silent)", async () => {
    const logs: string[] = [];
    const logger = createStderrLogger((c) => logs.push(c));
    const fetchFn = vi.fn(async () => jsonResponse(503, {})) as unknown as typeof fetch;
    const sender = senderWith(fetchFn, { bufferCap: 2, logger });
    await sender.send(req("b1"));
    await sender.send(req("b2"));
    await sender.send(req("b3")); // overflow → oldest (b1) dropped
    expect(sender.bufferedCount()).toBe(2);
    expect(sender.droppedFromBuffer()).toBe(1);
    expect(logs.some((l) => l.includes("buffer_overflow_drop_oldest"))).toBe(true);
  });

  it("flush re-sends buffered requests in FIFO order and clears the accepted ones", async () => {
    let failing = true;
    const seen: string[] = [];
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const parsed = JSON.parse(String(init.body)) as { batchId: string };
      seen.push(parsed.batchId);
      return failing ? jsonResponse(503, {}) : jsonResponse(202, { ok: true });
    }) as unknown as typeof fetch;
    const sender = senderWith(fetchFn);
    await sender.send(req("b1"));
    await sender.send(req("b2"));
    expect(sender.bufferedCount()).toBe(2);

    failing = false;
    const outcomes = await sender.flush();
    expect(outcomes.every((o) => o.kind === "accepted")).toBe(true);
    expect(sender.bufferedCount()).toBe(0);
    // FIFO order preserved across the two initial sends + the flush retries.
    expect(seen).toEqual(["b1", "b2", "b1", "b2"]);
  });
});
