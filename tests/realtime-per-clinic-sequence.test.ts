/**
 * ADR-011 — gap detection runs on the per-clinic sequence, not the global outbox id.
 *
 * `vt_event_outbox.id` is a global BIGSERIAL shared by every clinic
 * (migrations/090_vt_event_outbox.sql:4), but the publisher fans out per clinic
 * (`outboxEmitter.emit("clinic:" + row.clinicId, …)`, server/lib/event-publisher.ts)
 * and every read is clinic-filtered. A connected client therefore observes only a
 * SUBSET of that sequence — and a subset of a shared monotonic sequence is not
 * contiguous. Asserting `oid === last + 1` on it means that as soon as a second
 * clinic writes, every event reads as a dropped one: gapResync telemetry, a full
 * cache resync, and an outbox-head refetch, per event, per connected client —
 * and the cursor that recovery re-establishes is itself clinic-scoped, so it
 * never converges.
 *
 * These tests are deliberately DB-free. They drive `EventIngestor` directly with
 * the envelope shape the server emits, which is where the defect lives.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const telemetryCalls: Array<{ duplicateDrop?: boolean; gapResync?: boolean }> = [];
const outboxHeadCalls: number[] = [];

vi.mock("@/lib/api", () => ({
  api: {
    realtime: {
      telemetry: (body: { duplicateDrop?: boolean; gapResync?: boolean }) => {
        telemetryCalls.push(body);
        return Promise.resolve({ ok: true });
      },
      outboxHead: () => {
        outboxHeadCalls.push(1);
        return Promise.resolve({ maxPublishedId: 0, maxPublishedClinicSeq: 0 });
      },
    },
  },
}));

const applied: string[] = [];

vi.mock("@/lib/event-reducer", () => ({
  applyEvent: (_qc: unknown, ev: { type: string }) => {
    applied.push(ev.type);
    return Promise.resolve();
  },
  forceResyncWardErCaches: () => Promise.resolve(),
  resetRealtimeCaches: () => Promise.resolve(),
  DISPLAY_SNAPSHOT_QUERY_KEY: ["display-snapshot"],
}));

vi.mock("@/lib/auth-store", () => ({ getCurrentClinicId: () => "clinic-a" }));
vi.mock("@/lib/display-token-store", () => ({
  getStoredDisplayToken: () => null,
  clearStoredDisplayToken: () => {},
}));

class FakeBroadcastChannel {
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

beforeEach(() => {
  telemetryCalls.length = 0;
  outboxHeadCalls.length = 0;
  applied.length = 0;
  // @ts-expect-error — test-only global stub
  globalThis.BroadcastChannel = FakeBroadcastChannel;
  const memory = new Map<string, string>();
  // @ts-expect-error — test-only global stub
  globalThis.localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: () => null,
    length: 0,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * One clinic's view of a shared sequence: global ids jump because OTHER clinics
 * wrote in between, while this clinic's own sequence stays contiguous.
 */
function event(id: number, clinicSeq: number, type = "EQUIPMENT_STAGED") {
  return {
    type,
    payload: {},
    timestamp: new Date(0).toISOString(),
    id,
    outboxId: id,
    eventVersion: 1,
    clinicSeq,
  } as never;
}

describe("ADR-011 — per-clinic sequence drives gap detection", () => {
  it("applies interleaved-clinic traffic with zero gapResync", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor({} as never, null);

    // Global ids 100, 103, 107 — this clinic's own sequence is 1, 2, 3.
    ingestor.ingest(event(100, 1));
    ingestor.ingest(event(103, 2));
    ingestor.ingest(event(107, 3));

    expect(applied).toHaveLength(3);
    expect(telemetryCalls.filter((c) => c.gapResync)).toHaveLength(0);
    ingestor.dispose();
  });

  it("still fires gapResync on a genuinely skipped clinic sequence", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor({} as never, null);

    ingestor.ingest(event(100, 1));
    // clinicSeq 2 never arrives — this is a REAL drop and must be caught.
    ingestor.ingest(event(101, 3));

    expect(applied).toHaveLength(1);
    expect(telemetryCalls.filter((c) => c.gapResync)).toHaveLength(1);
    ingestor.dispose();
  });

  it("suppresses a duplicate by clinic sequence", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor({} as never, null);

    ingestor.ingest(event(100, 1));
    ingestor.ingest(event(103, 2));
    ingestor.ingest(event(103, 2)); // redelivered

    expect(applied).toHaveLength(2);
    expect(telemetryCalls.filter((c) => c.duplicateDrop)).toHaveLength(1);
    ingestor.dispose();
  });

  it("applies an envelope with no clinicSeq without reporting a gap (rolling-deploy path)", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor({} as never, null);

    ingestor.ingest(event(100, 1));
    // An old server, or a replayed pre-migration row: no clinicSeq at all.
    const legacy = { ...(event(105, 0) as Record<string, unknown>) };
    delete legacy.clinicSeq;
    ingestor.ingest(legacy as never);

    expect(applied).toHaveLength(2);
    expect(telemetryCalls.filter((c) => c.gapResync)).toHaveLength(0);
    ingestor.dispose();
  });
});
