/**
 * ADR-011 — the server→client seam: the SSE envelope must carry `clinicSeq`.
 *
 * WHY THIS EXISTS. ADR-011 moved gap detection from the global `vt_event_outbox.id`
 * onto a per-clinic sequence. Two suites already cover the ends of that change:
 * `tests/migrations/event-outbox-clinic-seq.test.ts` proves the database assigns the
 * sequence, and `tests/realtime-per-clinic-sequence.test.ts` proves `EventIngestor`
 * uses it. Nothing covered the wire between them — `outboxRowToSse`, the one function
 * that puts `clinicSeq` into the frame the browser actually receives.
 *
 * That gap matters more than an ordinary uncovered function, because its failure is
 * SILENT BY DESIGN. ADR-011 §3 requires the client to apply an event and skip the
 * contiguity check when `clinicSeq` is absent — the rolling-deploy and pre-backfill
 * path. So if this field ever stops being emitted, the browser does not error, does
 * not resync, and does not report a gap: it quietly stops gap-detecting altogether,
 * and every other test in the repo stays green. The safety valve that makes a rolling
 * deploy safe is the same mechanism that would hide the regression.
 *
 * These assertions therefore pin the field itself, not the behaviour downstream of it.
 */
import { describe, expect, it } from "vitest";

import { outboxRowToSse } from "../server/routes/realtime.js";
import type { PublishedOutboxRow } from "../server/lib/event-publisher.js";

function row(overrides: Partial<PublishedOutboxRow> = {}): PublishedOutboxRow {
  return {
    id: 107,
    clinicId: "clinic-a",
    clinicSeq: 3,
    type: "TASK_CREATED",
    payload: { taskId: "t-1" },
    occurredAt: new Date("2026-08-19T12:00:00.000Z"),
    publishedAt: new Date("2026-08-19T12:00:01.000Z"),
    eventVersion: 1,
    level: "INFO",
    category: "TASK",
    ...overrides,
  };
}

/** Parse the `data:` line of an SSE frame back into the envelope the browser sees. */
function envelopeOf(frame: string): Record<string, unknown> {
  const line = frame.split("\n").find((l) => l.startsWith("data: "));
  if (!line) throw new Error(`no data line in frame: ${JSON.stringify(frame)}`);
  return JSON.parse(line.slice("data: ".length));
}

describe("ADR-011 — the SSE envelope carries the per-clinic sequence", () => {
  it("emits clinicSeq, so the client has something to check contiguity on", () => {
    const envelope = envelopeOf(outboxRowToSse(row({ clinicSeq: 3 })));

    // The load-bearing assertion. Without this field the client silently stops
    // gap-detecting instead of failing.
    expect(envelope).toHaveProperty("clinicSeq");
    expect(envelope.clinicSeq).toBe(3);
  });

  it("leaves the global id doing resume and ordering, unchanged", () => {
    // ADR-011 §2 and §4: `id` keeps Last-Event-ID resume and replay ordering. A
    // change that "fixed" gap detection by moving the id line would break replay.
    const frame = outboxRowToSse(row({ id: 107, clinicSeq: 3 }));

    expect(frame.startsWith("id: 107\n")).toBe(true);
    const envelope = envelopeOf(frame);
    expect(envelope.id).toBe(107);
    expect(envelope.outboxId).toBe(107);
  });

  it("carries clinicSeq null for a pre-migration-186 row rather than dropping the key", () => {
    // The rolling-deploy path the client's fallback is written for. `null` present is
    // the contract; the key vanishing is what this file exists to catch.
    const envelope = envelopeOf(outboxRowToSse(row({ clinicSeq: null })));

    expect(Object.hasOwn(envelope, "clinicSeq")).toBe(true);
    expect(envelope.clinicSeq).toBeNull();
  });

  it("keeps clinicSeq independent of the global id — the whole point of ADR-011", () => {
    // One clinic's view of the shared BIGSERIAL: ids 100, 103, 107 with its own
    // sequence 1, 2, 3. If the envelope ever derived clinicSeq from id, this fails.
    const frames = [
      outboxRowToSse(row({ id: 100, clinicSeq: 1 })),
      outboxRowToSse(row({ id: 103, clinicSeq: 2 })),
      outboxRowToSse(row({ id: 107, clinicSeq: 3 })),
    ].map(envelopeOf);

    expect(frames.map((e) => e.id)).toEqual([100, 103, 107]);
    expect(frames.map((e) => e.clinicSeq)).toEqual([1, 2, 3]);
  });
});
