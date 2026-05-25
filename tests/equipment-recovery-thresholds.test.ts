import { describe, expect, it } from "vitest";
import {
  CHECKED_OUT_TOO_LONG_MS,
  EQUIPMENT_RECOVERY_THRESHOLDS,
  RECENTLY_CONFIRMED_MS,
  STALE_MS,
  VERY_STALE_MS,
  getEquipmentStalenessLevel,
  isCheckedOutTooLong,
  isEquipmentStale,
} from "../src/lib/equipment-recovery-thresholds";

const NOW = new Date("2026-05-25T12:00:00.000Z");

function atOffsetMs(offsetMs: number): Date {
  return new Date(NOW.getTime() - offsetMs);
}

describe("equipment-recovery-thresholds constants", () => {
  it("exports a single bundled thresholds object", () => {
    expect(EQUIPMENT_RECOVERY_THRESHOLDS).toEqual({
      recentlyConfirmedMs: RECENTLY_CONFIRMED_MS,
      staleMs: STALE_MS,
      veryStaleMs: VERY_STALE_MS,
      checkedOutTooLongMs: CHECKED_OUT_TOO_LONG_MS,
    });
  });

  it("orders staleness thresholds for predictable tiers", () => {
    expect(RECENTLY_CONFIRMED_MS).toBeLessThan(STALE_MS);
    expect(STALE_MS).toBeLessThan(VERY_STALE_MS);
  });
});

describe("getEquipmentStalenessLevel", () => {
  it("returns recent below recently confirmed threshold", () => {
    expect(getEquipmentStalenessLevel(atOffsetMs(RECENTLY_CONFIRMED_MS - 1), NOW)).toBe("recent");
  });

  it("returns stale at recently confirmed boundary", () => {
    expect(getEquipmentStalenessLevel(atOffsetMs(RECENTLY_CONFIRMED_MS), NOW)).toBe("stale");
  });

  it("returns stale between stale and very stale thresholds", () => {
    const between = STALE_MS + (VERY_STALE_MS - STALE_MS) / 2;
    expect(getEquipmentStalenessLevel(atOffsetMs(between), NOW)).toBe("stale");
  });

  it("returns very_stale at very stale boundary", () => {
    expect(getEquipmentStalenessLevel(atOffsetMs(VERY_STALE_MS), NOW)).toBe("very_stale");
  });

  it("returns very_stale for missing or invalid timestamps", () => {
    expect(getEquipmentStalenessLevel(null, NOW)).toBe("very_stale");
    expect(getEquipmentStalenessLevel(undefined, NOW)).toBe("very_stale");
    expect(getEquipmentStalenessLevel("not-a-date", NOW)).toBe("very_stale");
  });

  it("returns very_stale for future timestamps", () => {
    expect(getEquipmentStalenessLevel(new Date(NOW.getTime() + 60_000), NOW)).toBe("very_stale");
  });
});

describe("isEquipmentStale", () => {
  it("is false just below stale threshold", () => {
    expect(isEquipmentStale(atOffsetMs(STALE_MS - 1), NOW)).toBe(false);
  });

  it("is true at stale threshold", () => {
    expect(isEquipmentStale(atOffsetMs(STALE_MS), NOW)).toBe(true);
  });

  it("is true for missing timestamp", () => {
    expect(isEquipmentStale(null, NOW)).toBe(true);
  });

  it("is false for future timestamp", () => {
    expect(isEquipmentStale(new Date(NOW.getTime() + 1), NOW)).toBe(false);
  });
});

describe("isCheckedOutTooLong", () => {
  it("is false without checkout timestamp", () => {
    expect(isCheckedOutTooLong(null, NOW)).toBe(false);
    expect(isCheckedOutTooLong(undefined, NOW)).toBe(false);
  });

  it("is false just below checked-out-too-long threshold", () => {
    expect(isCheckedOutTooLong(atOffsetMs(CHECKED_OUT_TOO_LONG_MS - 1), NOW)).toBe(false);
  });

  it("is true at checked-out-too-long threshold", () => {
    expect(isCheckedOutTooLong(atOffsetMs(CHECKED_OUT_TOO_LONG_MS), NOW)).toBe(true);
  });

  it("is false for future checkout time", () => {
    expect(isCheckedOutTooLong(new Date(NOW.getTime() + 1), NOW)).toBe(false);
  });
});
