/**
 * Docking P3 T3.3 (client) — room readiness stops being "24h scan-verification
 * %" and becomes present-vs-expected: at_home / expected_fill (design §6.4).
 *
 * `roomPct` CHANGES MEANING here to present-vs-expected. The old scan metric
 * is preserved as `roomScanPct` (the previous body of `roomPct`).
 *
 * Pure unit test — no DB, no React render.
 * Run: pnpm test tests/room-readiness-present-expected.test.ts
 */

import { describe, expect, it } from "vitest";
import { roomPct, roomScanPct } from "../src/features/today/surfaces/ops/ops-tile-helpers";
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
});

describe("roomScanPct — preserved old scan-verification metric", () => {
  it("returns Math.round(recentlyVerifiedCount / totalEquipment * 100)", () => {
    expect(roomScanPct(room({ totalEquipment: 4, recentlyVerifiedCount: 2 }))).toBe(50);
  });

  it("returns null when totalEquipment is 0", () => {
    expect(roomScanPct(room({ totalEquipment: 0, recentlyVerifiedCount: 0 }))).toBeNull();
  });
});
