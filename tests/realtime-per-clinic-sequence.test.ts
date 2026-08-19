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
import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeEvent } from "@/types/realtime-events";

const telemetryCalls: Array<{ duplicateDrop?: boolean; gapResync?: boolean }> = [];
const outboxHeadCalls: number[] = [];
let outboxHeadResponse = { maxPublishedId: 0, maxPublishedClinicSeq: 0 };

vi.mock("@/lib/api", () => ({
  api: {
    realtime: {
      telemetry: (body: { duplicateDrop?: boolean; gapResync?: boolean }) => {
        telemetryCalls.push(body);
        return Promise.resolve({ ok: true });
      },
      outboxHead: () => {
        outboxHeadCalls.push(1);
        return Promise.resolve({ ...outboxHeadResponse });
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
  outboxHeadResponse = { maxPublishedId: 0, maxPublishedClinicSeq: 0 };
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
function event(
  id: number,
  clinicSeq: number | null,
  type: RealtimeEvent["type"] = "EQUIPMENT_STAGED",
): RealtimeEvent {
  return {
    type,
    payload: {},
    timestamp: new Date(0).toISOString(),
    id,
    outboxId: id,
    eventVersion: 1,
    // `null` is the legacy shape: a row written before migration 186, or a frame from a
    // server that predates it. Typed rather than cast, so a change to the envelope breaks
    // this test instead of slipping past an `as never`.
    clinicSeq,
  };
}

/**
 * The ingestor only ever calls `invalidateQueries` / `setQueryData` on this in the paths
 * under test, and the event reducer is mocked out above. A narrow stub typed through
 * `QueryClient` keeps that honest: widening what the ingestor touches fails to compile
 * here, which `{} as never` silently permitted.
 */
function stubQueryClient(): QueryClient {
  const noop = () => Promise.resolve();
  return {
    invalidateQueries: noop,
    setQueryData: () => undefined,
    getQueryData: () => undefined,
    removeQueries: () => undefined,
    cancelQueries: noop,
  } as unknown as QueryClient;
}

describe("ADR-011 — per-clinic sequence drives gap detection", () => {
  it("applies interleaved-clinic traffic with zero gapResync", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor(stubQueryClient(), null);

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
    const ingestor = new EventIngestor(stubQueryClient(), null);

    ingestor.ingest(event(100, 1));
    // clinicSeq 2 never arrives — this is a REAL drop and must be caught.
    ingestor.ingest(event(101, 3));

    expect(applied).toHaveLength(1);
    expect(telemetryCalls.filter((c) => c.gapResync)).toHaveLength(1);
    ingestor.dispose();
  });

  it("suppresses a duplicate by clinic sequence", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor(stubQueryClient(), null);

    ingestor.ingest(event(100, 1));
    ingestor.ingest(event(103, 2));
    ingestor.ingest(event(103, 2)); // redelivered

    expect(applied).toHaveLength(2);
    expect(telemetryCalls.filter((c) => c.duplicateDrop)).toHaveLength(1);
    ingestor.dispose();
  });

  it("applies an envelope with no clinicSeq without reporting a gap (rolling-deploy path)", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor(stubQueryClient(), null);

    ingestor.ingest(event(100, 1));
    // An old server, or a replayed pre-migration row: no clinicSeq at all.
    // The pre-186 shape is `clinicSeq` absent, which `RealtimeEvent` already models as
    // optional — no cast and no delete needed to express it.
    const legacy: RealtimeEvent = { ...event(105, null) };
    delete legacy.clinicSeq;
    ingestor.ingest(legacy);

    expect(applied).toHaveLength(2);
    expect(telemetryCalls.filter((c) => c.gapResync)).toHaveLength(0);
    ingestor.dispose();
  });

  /**
   * RESET_STATE, not the gap path. `establishBaselineAfterFullRefresh` (gap recovery)
   * already re-seeded both cursors; `handleResetState` — reached by
   * `reset_state:last_event_pruned` and by peer-prune gossip — cleared only
   * `lastAppliedEventId` and left the sequence cursor at its pre-reset value. The first
   * event after that failed `cseq === last + 1` and was DROPPED into gap recovery, so a
   * live event never reached the UI.
   *
   * Asserted on whether the event is APPLIED, deliberately not on the gapResync count:
   * `gapRecoveryInFlight` suppresses a second telemetry post, so a count-based assertion
   * passes with the bug present. It did, until this was rewritten.
   */
  it("re-seeds the clinic cursor from outbox-head on RESET_STATE", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor(stubQueryClient(), null);

    ingestor.ingest(event(100, 1));
    ingestor.ingest(event(101, 2));
    expect(applied).toHaveLength(2);

    // The server pruned; its head has since moved to clinic sequence 20.
    outboxHeadResponse = { maxPublishedId: 300, maxPublishedClinicSeq: 20 };
    ingestor.ingest({
      type: "RESET_STATE" as RealtimeEvent["type"],
      payload: {},
      timestamp: new Date(0).toISOString(),
    });
    await vi.waitFor(() => expect(outboxHeadCalls.length).toBeGreaterThan(0));

    // 21 continues from the head the reset adopted, so it must be applied.
    ingestor.ingest(event(301, 21));

    expect(
      applied,
      "the first event after RESET_STATE must apply, not fall into gap recovery",
    ).toHaveLength(3);
    ingestor.dispose();
  });

  /**
   * An unsequenced event advances clinic state the sequence cursor knows nothing about,
   * so the cursor is stale the moment one is applied. Leaving it set made the next
   * SEQUENCED event report a gap that never happened.
   */
  it("does not report a false gap on the first sequenced event after a legacy one", async () => {
    const { EventIngestor } = await import("@/lib/realtime");
    const ingestor = new EventIngestor(stubQueryClient(), null);

    ingestor.ingest(event(100, 1));
    ingestor.ingest(event(101, 2));

    const legacy: RealtimeEvent = { ...event(102, null) };
    delete legacy.clinicSeq;
    ingestor.ingest(legacy);

    // The server kept sequencing while the legacy frames flowed, so this is 7, not 3.
    ingestor.ingest(event(103, 7));

    expect(applied).toHaveLength(4);
    expect(
      telemetryCalls.filter((c) => c.gapResync),
      "the cursor must be invalidated by the legacy event, not compared against",
    ).toHaveLength(0);
    ingestor.dispose();
  });
});
