/**
 * R-BDF-1.4 — acceptance lock: `/api/display/snapshot` stays UNCACHED.
 *
 * The ambient board-anomaly feature (R-BDF-1) derives anomalies from the
 * snapshot the board already fetches — it must NOT introduce any caching of
 * `/api/display/snapshot` to satisfy the feature. This test proves, behaviorally
 * against the real `public/sw.js`, that the snapshot endpoint is excluded from
 * Cache Storage **reads AND writes** and that the emergency denylist path is
 * untouched:
 *
 *   1. A `fetch` for `/api/display/snapshot` goes straight to the network — the
 *      SW never opens the cache (no read), never `put`s (no write), and the
 *      bypass short-circuits before any static/API branch.
 *   2. Positive control — a normal static asset DOES exercise the cache, proving
 *      the harness would cache when the denylist did not apply.
 *   3. On `activate`, a pre-seeded `/api/display/snapshot` cache entry is purged
 *      while a benign entry survives (belt-and-braces no-write invariant).
 *   4. Source-level: the canonical emergency denylist is present verbatim.
 *
 * Frozen surface — this test must never be satisfied by ADDING caching. It locks
 * the doctrine that the denylist stays a no-read / no-write bypass.
 */
import { readFileSync } from "fs";
import { join } from "path";
import vm from "vm";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EMERGENCY_CACHE_BYPASS_PATHS } from "../shared/emergency-surfaces.manifest";

const SW_PATH = join(process.cwd(), "public/sw.js");
const ORIGIN = "https://board.vettrack.local";
const SNAPSHOT_URL = `${ORIGIN}/api/display/snapshot`;

class MockResponse {
  ok: boolean;
  status: number;
  constructor(_body?: unknown, init?: { status?: number }) {
    this.status = init?.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  clone(): MockResponse {
    return this;
  }
}

interface SwEvent {
  request: { url: string; method: string; mode: string };
  responded?: Promise<unknown>;
  waited?: Promise<unknown>;
  respondWith(p: Promise<unknown>): void;
  waitUntil(p: Promise<unknown>): void;
}

interface Harness {
  listeners: Record<string, (event: unknown) => void>;
  fetchMock: ReturnType<typeof vi.fn>;
  cacheStore: Map<string, MockResponse>;
  counters: {
    open: number;
    match: number;
    put: number;
    delete: number;
  };
}

/**
 * Evaluate the real public/sw.js inside a sandbox with a mocked Cache Storage,
 * fetch, and `self`, capturing every cache read/write and the registered
 * lifecycle listeners.
 */
function loadServiceWorker(): Harness {
  const source = readFileSync(SW_PATH, "utf8");
  const listeners: Record<string, (event: unknown) => void> = {};
  const cacheStore = new Map<string, MockResponse>();
  const counters = { open: 0, match: 0, put: 0, delete: 0 };

  const fetchMock = vi.fn(() => Promise.resolve(new MockResponse(null, { status: 200 })));

  const cache = {
    async match(req: { url: string } | string) {
      counters.match += 1;
      const key = typeof req === "string" ? req : req.url;
      return cacheStore.get(key);
    },
    async put(req: { url: string } | string, res: MockResponse) {
      counters.put += 1;
      const key = typeof req === "string" ? req : req.url;
      cacheStore.set(key, res);
    },
    async delete(req: { url: string } | string) {
      counters.delete += 1;
      const key = typeof req === "string" ? req : req.url;
      return cacheStore.delete(key);
    },
    async add(url: string) {
      cacheStore.set(`${ORIGIN}${url}`, new MockResponse());
    },
    async keys() {
      return [...cacheStore.keys()].map((url) => ({ url }));
    },
  };

  const caches = {
    async open() {
      counters.open += 1;
      return cache;
    },
    async keys() {
      return ["vettrack-__VT_BUILD_TAG__"];
    },
    async delete() {
      return true;
    },
    async match(req: { url: string }) {
      counters.match += 1;
      return cacheStore.get(req.url);
    },
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners[type] = handler;
    },
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([]),
    },
    registration: {},
  };

  const sandbox = {
    self,
    caches,
    fetch: fetchMock,
    URL,
    Request: class {},
    Response: MockResponse,
    console: { warn: () => {}, info: () => {}, error: () => {}, log: () => {} },
    Promise,
  };

  vm.runInNewContext(source, sandbox, { filename: "sw.js" });
  return { listeners, fetchMock, cacheStore, counters };
}

function dispatchFetch(
  harness: Harness,
  url: string,
  method = "GET",
  mode = "cors",
): SwEvent {
  const event: SwEvent = {
    request: { url, method, mode },
    respondWith(p) {
      this.responded = p;
    },
    waitUntil(p) {
      this.waited = p;
    },
  };
  harness.listeners.fetch?.(event);
  return event;
}

describe("R-BDF-1.4 — /api/display/snapshot excluded from Cache Storage (reads AND writes)", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = loadServiceWorker();
  });

  it("goes straight to the network — never opens the cache, never reads, never writes", async () => {
    const event = dispatchFetch(harness, SNAPSHOT_URL);
    await event.responded;

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.fetchMock).toHaveBeenCalledWith(event.request);
    // No read: cache never opened, matched, or put.
    expect(harness.counters.open).toBe(0);
    expect(harness.counters.match).toBe(0);
    expect(harness.counters.put).toBe(0);
    // Nothing was written to Cache Storage for the snapshot.
    expect(harness.cacheStore.has(SNAPSHOT_URL)).toBe(false);
  });

  it("bypasses even when the request carries Vite-style ?v=/?t= params (unconditional)", async () => {
    const event = dispatchFetch(harness, `${SNAPSHOT_URL}?v=123&t=456`);
    await event.responded;

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.counters.open).toBe(0);
    expect(harness.counters.put).toBe(0);
  });

  it("positive control — a normal static asset DOES exercise the cache (proves the harness caches when the denylist does not apply)", async () => {
    const event = dispatchFetch(harness, `${ORIGIN}/app.js`);
    await event.responded;

    // A static asset is cache-first + background revalidate: the cache IS opened.
    expect(harness.counters.open).toBeGreaterThan(0);
  });

  it("activate purges a pre-seeded /api/display/snapshot cache entry while a benign entry survives", async () => {
    harness.cacheStore.set(SNAPSHOT_URL, new MockResponse());
    harness.cacheStore.set(`${ORIGIN}/app.js`, new MockResponse());

    const activateEvent = { waitUntil: vi.fn((p: Promise<unknown>) => p) };
    harness.listeners.activate?.(activateEvent as unknown);
    await activateEvent.waitUntil.mock.calls[0]?.[0];

    expect(harness.cacheStore.has(SNAPSHOT_URL)).toBe(false);
    expect(harness.cacheStore.has(`${ORIGIN}/app.js`)).toBe(true);
    expect(harness.counters.delete).toBeGreaterThan(0);
  });
});

describe("R-BDF-1.4 — emergency denylist source is untouched", () => {
  it("public/sw.js declares EMERGENCY_BYPASS_PATHS with every canonical path verbatim", () => {
    const source = readFileSync(SW_PATH, "utf8");
    expect(source).toContain("EMERGENCY_BYPASS_PATHS");
    for (const path of EMERGENCY_CACHE_BYPASS_PATHS) {
      expect(source).toContain(`"${path}"`);
    }
  });

  it("the snapshot path is one of the canonical emergency-bypass paths", () => {
    expect(EMERGENCY_CACHE_BYPASS_PATHS as readonly string[]).toContain(
      "/api/display/snapshot",
    );
  });
});
