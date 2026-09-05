/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 2 — `/rooms`. The page renders a two-column card grid at every
 * width; on a management browser the useful shape is a readiness table you can sort
 * by issues or availability. Mobile/native keep the grid.
 *
 * Headers reuse the existing `roomsListPage.summary*` copy, so this adds no i18n.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import type { Room } from "@/types";

import { RoomsTable } from "@/pages/rooms/desktop/RoomsTable";

function room({
  syncStatus = "synced",
  createdAt = "2026-08-01T00:00:00.000Z",
  updatedAt = "2026-08-01T00:00:00.000Z",
  ...rest
}: Partial<Room> & Pick<Room, "id" | "name">): Room {
  return { syncStatus, createdAt, updatedAt, ...rest };
}

const ROOMS: Room[] = [
  room({ id: "r1", name: "ICU 1", floor: "Floor 2", totalEquipment: 10, availableCount: 7, inUseCount: 2, issueCount: 1 }),
  room({ id: "r2", name: "חדר ניתוח", totalEquipment: 4, availableCount: 4, inUseCount: 0, issueCount: 0 }),
];

function renderTable(rooms: Room[] | undefined) {
  const { hook, history } = memoryLocation({ path: "/rooms", record: true });
  return { history, ...render(<Router hook={hook}><RoomsTable rooms={rooms} /></Router>) };
}

afterEach(() => cleanup());

describe("RoomsTable — dense desktop body for /rooms", () => {
  it("renders a readiness table with the existing summary headers", () => {
    renderTable(ROOMS);

    expect(document.querySelector("table")).toBeTruthy();
    for (const header of [
      t.console.colName,
      t.roomsListPage.summaryAvailable,
      t.roomsListPage.summaryInUse,
      t.roomsListPage.summaryIssues,
      t.roomsListPage.summarySynced,
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeTruthy();
    }
    expect(screen.getAllByRole("row")).toHaveLength(ROOMS.length + 1);
  });

  it("shows availability as available-of-total", () => {
    renderTable(ROOMS);
    expect(screen.getByTestId("rooms-table-availability-r1").textContent).toContain("7");
    expect(screen.getByTestId("rooms-table-availability-r1").textContent).toContain("10");
  });

  it("navigates to the room detail route when a row is clicked", () => {
    const { history } = renderTable(ROOMS);

    fireEvent.click(screen.getByText("ICU 1"));

    expect(history[history.length - 1]).toBe("/rooms/r1");
  });

  it("bidi-isolates the room name so an LTR name survives the RTL console", () => {
    renderTable(ROOMS);
    expect(screen.getByText("ICU 1").closest("bdi")?.getAttribute("dir")).toBe("auto");
  });

  it("renders the existing empty copy instead of a table when there are no rooms", () => {
    renderTable([]);

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByText(t.roomsListPage.emptyRooms)).toBeTruthy();
  });
});
