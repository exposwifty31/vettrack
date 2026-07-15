/**
 * Docking P3 T3.3 (client) — room readiness stops being "24h scan-verification
 * %" and becomes present-vs-expected: at_home / expected_fill (design §6.4).
 *
 * `roomPct` CHANGES MEANING here to present-vs-expected. The old scan metric
 * was preserved as `roomScanPct` (the previous body of `roomPct`) but had no
 * consumer; dropped as dead code (M-4, phase review — `recentlyVerifiedCount`
 * stays on the `Room` type / rooms GET, so the underlying data is still
 * available if a future surface wants it).
 *
 * Pure unit test — no DB, no React render.
 * Run: pnpm test tests/room-readiness-present-expected.test.ts
 */

import { describe, expect, it } from "vitest";
import { roomPct } from "../src/features/today/surfaces/ops/ops-tile-helpers";
import type { Room } from "../src/types";

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    name: "ICU",
    syncStatus: "synced",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("roomPct — present-vs-expected (T3.3)", () => {
  it("returns Math.round(atHomeCount / expectedFill * 100)", () => {
    expect(roomPct(room({ expectedFill: 3, atHomeCount: 2 }))).toBe(67);
  });

  it("returns 100 when at_home fully covers expected fill", () => {
    expect(roomPct(room({ expectedFill: 4, atHomeCount: 4 }))).toBe(100);
  });

  it("returns null (NOT 0) when expectedFill is 0 — no readiness signal", () => {
    expect(roomPct(room({ expectedFill: 0, atHomeCount: 0 }))).toBeNull();
  });

  it("returns null (NOT 0) when expectedFill is undefined", () => {
    expect(roomPct(room({ expectedFill: undefined, atHomeCount: 2 }))).toBeNull();
  });

  it("caps at 100 when atHomeCount exceeds expectedFill (transient data)", () => {
    expect(roomPct(room({ expectedFill: 4, atHomeCount: 5 }))).toBe(100);
  });
});
