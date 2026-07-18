import { describe, expect, it, vi } from "vitest";

import { SyntheticAdapter, type RawRead } from "../src/adapter";
import { loadConfig, type ControllerConfigInput } from "../src/config";
import { RfidController, type RfidControllerDeps } from "../src/controller";
import { StaticSecretSource } from "../src/secret-source";
import { HttpSender, type PreparedRequest } from "../src/sender";
import { exitCodeFor } from "../src/cli";

const SECRET = "clinic-secret";

function req(batchId = "b1"): PreparedRequest {
  return {
    body: Buffer.from(JSON.stringify({ batchId, events: [] }), "utf8"),
    clinicId: "clinic-a",
    signature: "sha256=deadbeef",
  };
}

function buildController(
  fetchFn: typeof fetch,
  configOverrides: Partial<ControllerConfigInput> = {},
  depsOverrides: Partial<RfidControllerDeps> = {},
) {
  const config = loadConfig({
    apiOrigin: "https://api.test",
    clinicId: "clinic-a",
    controllerVersion: "vettrack-rfid/test",
    debounceMs: 0,
    ...configOverrides,
  });
  const sender = new HttpSender({ apiOrigin: config.apiOrigin, clinicId: config.clinicId, fetchFn });
  return new RfidController({
    config,
    secretSource: new StaticSecretSource(SECRET),
    sender,
    ...depsOverrides,
  });
}

/** One first-sighting crossing per distinct tag → one movement event each. */
function crossings(tags: string[]): RawRead[] {
  const base = 1_800_000_000_000;
  return tags.map((tagEpc, i) => ({ tagEpc, gatewayCode: "GW-1", readAt: new Date(base + i * 10_000) }));
}

describe("HttpSender — 429 is re-buffered on the primary send (not dropped)", () => {
  it("enqueues a 429'd batch so the retry pass can re-send it (mirrors flush)", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: "slow down" }), { status: 429, headers: { "retry-after": "1" } }),
    ) as unknown as typeof fetch;
    const sender = new HttpSender({ apiOrigin: "https://api.test", clinicId: "clinic-a", fetchFn });
    const out = await sender.send(req());
    expect(out.kind).toBe("backoff");
    // The bug: 429 used to be tallied but never buffered → silent data loss.
    expect(sender.bufferedCount()).toBe(1);
  });
});

describe("RfidController — a 429'd batch is retried, not silently dropped", () => {
  it("re-sends the batch on the flush pass after a primary-send 429", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: "slow down" }), {
          status: 429,
          headers: { "retry-after": "1" },
        });
      }
      return new Response(JSON.stringify({ ok: true, accepted: 1, updated: 1 }), { status: 202 });
    }) as unknown as typeof fetch;

    const summary = await buildController(fetchFn).run(new SyntheticAdapter(crossings(["E1"])));

    expect(summary.batches).toBe(1);
    expect(summary.backoff).toBe(1); // primary send got 429
    expect(summary.accepted).toBe(1); // flush pass delivered it
    expect(summary.undelivered).toBe(0);
    expect(exitCodeFor(summary)).toBe(0);
  });
});

describe("RfidController — undelivered batches are a NON-ZERO exit", () => {
  it("counts a batch that stays 429 through the flush pass as undelivered", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: "slow down" }), { status: 429, headers: { "retry-after": "1" } }),
    ) as unknown as typeof fetch;

    const summary = await buildController(fetchFn).run(new SyntheticAdapter(crossings(["E1"])));

    expect(summary.accepted).toBe(0);
    expect(summary.undelivered).toBe(1); // still buffered after the flush pass
    expect(exitCodeFor(summary)).toBe(1); // CLI must report failure
  });

  it("counts a batch stuck on 5xx as undelivered too", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    ) as unknown as typeof fetch;

    const summary = await buildController(fetchFn).run(new SyntheticAdapter(crossings(["E1"])));

    expect(summary.undelivered).toBe(1);
    expect(exitCodeFor(summary)).toBe(1);
  });

  it("a clean run reports zero undelivered and a zero exit", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, accepted: 1, updated: 1 }), { status: 202 }),
    ) as unknown as typeof fetch;

    const summary = await buildController(fetchFn).run(new SyntheticAdapter(crossings(["E1"])));

    expect(summary.accepted).toBe(1);
    expect(summary.undelivered).toBe(0);
    expect(exitCodeFor(summary)).toBe(0);
  });
});

describe("RfidController — TokenBucket throttles POSTs below the ceiling", () => {
  it("waits (never drops) when the client rate budget is exhausted", async () => {
    let clock = 0;
    const now = () => clock;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });

    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, accepted: 1, updated: 1 }), { status: 202 }),
    ) as unknown as typeof fetch;

    // rateLimitPerMinute=1 → capacity 1: first POST fires, the next two must wait
    // for refill. maxEventsPerBatch=1 → 3 distinct crossings become 3 batches/POSTs.
    const controller = buildController(
      fetchFn,
      { rateLimitPerMinute: 1, maxEventsPerBatch: 1 },
      { now, sleep },
    );

    const summary = await controller.run(new SyntheticAdapter(crossings(["E1", "E2", "E3"])));

    expect(summary.batches).toBe(3);
    expect(summary.accepted).toBe(3); // nothing dropped — the governor waits
    expect(sleep).toHaveBeenCalledTimes(2); // 2nd and 3rd POST each waited for a token
    // Waited ~a minute per token (1/min budget) — throttled, not bursted.
    expect((sleep.mock.calls[0]?.[0] as number) ?? 0).toBeGreaterThanOrEqual(60_000);
  });

  it("does not throttle when the budget covers the burst", async () => {
    const sleep = vi.fn(async () => {});
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, accepted: 1, updated: 1 }), { status: 202 }),
    ) as unknown as typeof fetch;

    const controller = buildController(
      fetchFn,
      { rateLimitPerMinute: 120, maxEventsPerBatch: 1 },
      { sleep },
    );
    const summary = await controller.run(new SyntheticAdapter(crossings(["E1", "E2", "E3"])));

    expect(summary.accepted).toBe(3);
    expect(sleep).not.toHaveBeenCalled();
  });
});
