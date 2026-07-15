/**
 * @vitest-environment happy-dom
 *
 * Docking P3 cleanup (Fix 1) — ReadinessTile's copy must describe
 * present-vs-expected readiness (T3.3: at_home / expected_fill), not the
 * old "% verified in the last 24 hours" scan-verification copy it was
 * still borrowing from `roomsListPage.healthRing*`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import { ReadinessTile } from "@/features/today/surfaces/ops/ReadinessTile";
import type { Room } from "@/types";

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

function renderTile(props: Parameters<typeof ReadinessTile>[0]) {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <ReadinessTile {...props} />
    </Router>,
  );
}

afterEach(() => cleanup());

describe("ReadinessTile — present-vs-expected copy (P3 cleanup Fix 1)", () => {
  it("titles each room row with the present-vs-expected tooltip, not the old 24h-verified copy", () => {
    renderTile({ worstRooms: [{ room: room(), pct: 67 }], isLoading: false });

    expect(screen.getByTitle(t.homeSurface.readinessTileTitle(67))).toBeTruthy();
    expect(screen.queryByTitle(/verified in the last 24/i)).toBeNull();
  });

  it("shows the present-vs-expected help copy in the empty state, not the old health-ring copy", () => {
    renderTile({ worstRooms: [], isLoading: false });

    expect(screen.getByText(t.homeSurface.readinessTileHelp)).toBeTruthy();
    expect(screen.queryByText(/verified in the last 24 hours/i)).toBeNull();
  });

  it("renders no room rows or empty-state copy while loading", () => {
    renderTile({ worstRooms: [], isLoading: true });
    expect(screen.queryByTitle(/%/)).toBeNull();
    expect(screen.queryByText(t.homeSurface.readinessTileHelp)).toBeNull();
  });
});
