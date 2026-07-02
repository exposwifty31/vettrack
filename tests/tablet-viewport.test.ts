import { describe, it, expect } from "vitest";
import {
  isTabletViewport,
  TABLET_MEDIA_QUERY,
  TABLET_MIN_WIDTH,
  TABLET_MIN_HEIGHT,
} from "../src/lib/use-tablet-viewport";

describe("isTabletViewport — device-class matrix", () => {
  it("classifies phones as non-tablet in BOTH orientations (the #5 fix)", () => {
    // iPhone 15 Pro Max — the largest phone; its short side (~430) is the reason
    // width-only detection wrongly flipped it to tablet in landscape.
    expect(isTabletViewport(430, 932)).toBe(false); // portrait
    expect(isTabletViewport(932, 430)).toBe(false); // landscape — width ≥768 but height <500
    // iPhone SE
    expect(isTabletViewport(375, 667)).toBe(false);
    expect(isTabletViewport(667, 375)).toBe(false);
    // Large Android (Galaxy S Ultra-ish)
    expect(isTabletViewport(915, 412)).toBe(false); // landscape
  });

  it("classifies tablets as tablet without regressing iPad mini", () => {
    // iPad mini (short side 744): portrait 744 is < 768 → phone shell, SAME as
    // the previous width-only behavior (not a regression). Landscape stays tablet.
    expect(isTabletViewport(744, 1133)).toBe(false); // portrait (unchanged)
    expect(isTabletViewport(1133, 744)).toBe(true); // landscape — 744 ≥ 500, no regression
    // Standard + Pro iPads: tablet in both orientations
    expect(isTabletViewport(820, 1180)).toBe(true);
    expect(isTabletViewport(1180, 820)).toBe(true);
    expect(isTabletViewport(1024, 1366)).toBe(true);
  });

  it("treats the thresholds as inclusive floors", () => {
    expect(isTabletViewport(TABLET_MIN_WIDTH, TABLET_MIN_HEIGHT)).toBe(true);
    expect(isTabletViewport(TABLET_MIN_WIDTH - 1, TABLET_MIN_HEIGHT)).toBe(false);
    expect(isTabletViewport(TABLET_MIN_WIDTH, TABLET_MIN_HEIGHT - 1)).toBe(false);
  });

  it("builds the media query from the same constants (no drift)", () => {
    expect(TABLET_MEDIA_QUERY).toBe("(min-width: 768px) and (min-height: 500px)");
    expect(TABLET_MEDIA_QUERY).toContain(`${TABLET_MIN_WIDTH}px`);
    expect(TABLET_MEDIA_QUERY).toContain(`${TABLET_MIN_HEIGHT}px`);
  });
});
