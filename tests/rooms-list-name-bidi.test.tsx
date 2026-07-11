/**
 * @vitest-environment happy-dom
 *
 * T10 (RTL/bidi audit, MEDIUM) — the rooms-card name must bidi-isolate an
 * LTR room name (e.g. "ICU Bay 2") so it truncates on its own logical
 * trailing edge inside the Hebrew (RTL) page context, instead of the
 * surrounding RTL paragraph direction reordering it or clipping the
 * leading edge. Fix is `<Bdi>` (native `<bdi dir="auto">`,
 * `unicode-bidi: isolate`) wrapping the name text — never a forced `dir`
 * on the card itself. This locks in the existing production markup at
 * src/pages/rooms-list.tsx (RoomCard's name paragraph); no render test
 * previously asserted it directly. `RoomCard` was exported (previously
 * file-local) solely to make this test possible — no behavior change.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Room } from "@/types";
import { RoomCard } from "@/pages/rooms-list";

const LTR_NAME = "ICU Bay 2";

function baseRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    name: LTR_NAME,
    floor: null,
    syncStatus: "synced",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    totalEquipment: 4,
    availableCount: 3,
    inUseCount: 1,
    issueCount: 0,
    recentlyVerifiedCount: 2,
    ...overrides,
  };
}

describe("RoomCard — name bidi isolation (T10)", () => {
  afterEach(() => cleanup());

  it("wraps an LTR room name in a <bdi dir='auto'> isolate", () => {
    render(<RoomCard room={baseRoom()} />);

    const nameEl = screen.getByText(LTR_NAME);
    const bdi = nameEl.closest("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.getAttribute("dir")).toBe("auto");
  });

  it("keeps the truncation class on the paragraph wrapping the isolated name", () => {
    render(<RoomCard room={baseRoom()} />);

    const nameEl = screen.getByText(LTR_NAME);
    const p = nameEl.closest("p");
    expect(p).not.toBeNull();
    expect(p?.className).toContain("truncate");
  });

  it("does not force a direction on the card itself (isolation is scoped to the name run)", () => {
    render(<RoomCard room={baseRoom()} />);

    const nameEl = screen.getByText(LTR_NAME);
    const bdi = nameEl.closest("bdi")!;
    // Walk from the bdi's parent up — nothing above the isolate should carry
    // a forced dir attribute.
    expect(bdi.parentElement?.closest("[dir]")).toBeNull();
  });

  it("still isolates a Hebrew room name the same way (direction is content-derived, not hardcoded LTR)", () => {
    render(<RoomCard room={baseRoom({ name: "חדר טיפול נמרץ" })} />);

    const nameEl = screen.getByText("חדר טיפול נמרץ");
    const bdi = nameEl.closest("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.getAttribute("dir")).toBe("auto");
  });
});
