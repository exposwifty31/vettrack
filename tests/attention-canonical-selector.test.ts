/**
 * Track C / Phase 4 — ONE canonical "needs attention" definition.
 *
 * Four definitions existed, two of them on `/home` alone. The reported symptom —
 * `/home` showing 100% while `/dashboard` showed 65 — came from `/home`'s coverage
 * ring counting `equipmentTriageTier(eq) === "attention"`, which never reads
 * `lastSeen` and returns `in_use` for anything checked out before it looks at status
 * at all. `/dashboard` meanwhile counted `issues + missing`, where missing is a
 * `lastSeen` age test. A fleet whose problem is staleness therefore read 100% and 65
 * simultaneously.
 *
 * Owner decision 2026-09-01: staleness DOES count as attention; acknowledgement does
 * NOT clear it. Acking changes inbox noise, not fleet truth — the ack-aware count
 * stays on `/alerts`, where inbox semantics belong.
 */
import { describe, it, expect } from "vitest";
import type { Equipment } from "@/types";
import {
  needsAttention,
  countNeedsAttention,
  STALE_THRESHOLD_MS,
} from "@/lib/attention";

const NOW = new Date("2026-09-01T12:00:00.000Z").getTime();
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - STALE_THRESHOLD_MS - 60_000).toISOString();

function eq({
  id = "e",
  name = "n",
  status = "ok",
  createdAt = FRESH,
  lastSeen = FRESH,
  ...rest
}: Partial<Equipment> = {}): Equipment {
  return { id, name, status, createdAt, lastSeen, ...rest };
}

describe("needsAttention — the canonical definition", () => {
  it("counts every problem status, not just `issue`", () => {
    for (const status of ["issue", "maintenance", "critical", "needs_attention"] as const) {
      expect(needsAttention(eq({ status }), NOW)).toBe(true);
    }
  });

  it("leaves a healthy, recently-seen item alone", () => {
    expect(needsAttention(eq({ status: "ok", lastSeen: FRESH }), NOW)).toBe(false);
    expect(needsAttention(eq({ status: "sterilized", lastSeen: FRESH }), NOW)).toBe(false);
  });

  it("counts an item not seen within the staleness threshold — the case the coverage ring missed", () => {
    expect(needsAttention(eq({ status: "ok", lastSeen: STALE }), NOW)).toBe(true);
    expect(needsAttention(eq({ status: "ok", lastSeen: null }), NOW)).toBe(true);
  });

  it("does not call a checked-out item stale — someone is accountable for it", () => {
    expect(needsAttention(eq({ status: "ok", lastSeen: STALE, checkedOutById: "u1" }), NOW)).toBe(false);
  });

  it("still counts a checked-out item whose STATUS is a problem — broken is broken whoever holds it", () => {
    expect(needsAttention(eq({ status: "issue", checkedOutById: "u1" }), NOW)).toBe(true);
  });

  it("counts a fleet", () => {
    expect(
      countNeedsAttention(
        [
          eq({ id: "a", status: "ok", lastSeen: FRESH }),
          eq({ id: "b", status: "issue" }),
          eq({ id: "c", status: "ok", lastSeen: STALE }),
        ],
        NOW,
      ),
    ).toBe(2);
  });
});
