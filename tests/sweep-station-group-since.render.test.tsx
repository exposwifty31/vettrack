/**
 * @vitest-environment happy-dom
 *
 * Docking P3 cleanup (Fix 4) — the Room Sweep shows checked-out items "with
 * ⟨holder⟩" but was missing "since ⟨time⟩" because `RoomSweepItem` omitted
 * the checkout timestamp. Covers `SweepStationGroup` rendering the composed
 * "with holder · since relative" copy once `checkedOutAt` is present, and
 * falling back to the plain "with holder" copy when it's not (e.g. legacy
 * data or a race before the timestamp is set).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/utils";
import { SweepStationGroup } from "@/features/equipment/sweep/SweepStationGroup";
import type { RoomSweepItem } from "@/types";

function checkedOutItem(overrides: Partial<RoomSweepItem> = {}): RoomSweepItem {
  return {
    id: "eq-1",
    name: "Infusion Pump",
    assetTypeId: "at-1",
    custodyState: "checked_out",
    checkedOutById: "user-1",
    checkedOutByEmail: "dana@ops.local",
    checkedOutAt: null,
    homeDockId: "dock-1",
    homeDockName: "ICU Pump Dock",
    atStation: false,
    bucket: "checked_out",
    ...overrides,
  };
}

function renderGroup(items: RoomSweepItem[]) {
  return render(
    <SweepStationGroup
      groupKey="dock-1"
      label="ICU Pump Dock"
      items={items}
      confirmedIds={new Set()}
      onToggle={() => {}}
      onMarkGroupPresent={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("SweepStationGroup — checked-out 'since' (P3 cleanup Fix 4)", () => {
  it("shows 'with holder · since relative' when checkedOutAt is present", () => {
    const checkedOutAt = "2026-07-15T10:00:00.000Z"; // 2h before mocked now
    renderGroup([checkedOutItem({ checkedOutAt })]);

    const expected = t.roomSweep.withHolderSince("dana", formatRelativeTime(checkedOutAt));
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText(t.roomSweep.withHolder("dana"))).toBeNull();
  });

  it("falls back to plain 'with holder' when checkedOutAt is absent", () => {
    renderGroup([checkedOutItem({ checkedOutAt: null })]);

    expect(screen.getByText(t.roomSweep.withHolder("dana"))).toBeTruthy();
  });
});
