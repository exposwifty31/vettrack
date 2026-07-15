/**
 * @vitest-environment happy-dom
 *
 * Docking P3 T3.2b — mobile Room Sweep UI (component test).
 *
 * Covers the RED→GREEN contract for `RoomSweep`:
 *  1. Loads the expected list, groups items by station (homeDockName), and
 *     renders resting items as toggleable while a checked-out item is
 *     read-only with its holder shown — no toggle for it.
 *  2. "Mark all present" (overall) confirms every resting item and the
 *     commit summary reflects the present/missing counts.
 *  3. Confirm sweep posts exactly the present (confirmed) ids to
 *     `commitRoomSweep` — never the checked-out id, never an un-toggled
 *     (still-missing) id.
 *  4. An empty homed-items list renders the empty state with no commit bar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { RoomSweepItem, RoomSweepList, RoomSweepResult } from "@/types";

afterEach(() => cleanup());

const toastSuccess = vi.fn();
const toastError = vi.fn();
const roomSweepListMock = vi.fn();
const commitRoomSweepMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), error: vi.fn(), scanSuccess: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      docking: {
        ...actual.api.docking,
        roomSweepList: (...args: unknown[]) => roomSweepListMock(...args),
        commitRoomSweep: (...args: unknown[]) => commitRoomSweepMock(...args),
      },
    },
  };
});

import { RoomSweep } from "@/features/equipment/sweep/RoomSweep";

const ROOM_ID = "room-1";

function sweepItem(overrides: Partial<RoomSweepItem>): RoomSweepItem {
  return {
    id: "eq-x",
    name: "Item",
    assetTypeId: null,
    custodyState: "returned",
    checkedOutById: null,
    checkedOutByEmail: null,
    homeDockId: null,
    homeDockName: null,
    atStation: false,
    bucket: "at_home",
    ...overrides,
  };
}

const ITEM_A = sweepItem({ id: "eq-a", name: "Infusion Pump A", homeDockId: "dock-1", homeDockName: "Station 1" });
const ITEM_B = sweepItem({ id: "eq-b", name: "Infusion Pump B", homeDockId: "dock-1", homeDockName: "Station 1" });
const ITEM_C = sweepItem({ id: "eq-c", name: "Monitor C", homeDockId: null, homeDockName: null });
const ITEM_D_CHECKED_OUT = sweepItem({
  id: "eq-d",
  name: "Ventilator D",
  homeDockId: "dock-2",
  homeDockName: "Station 2",
  custodyState: "checked_out",
  checkedOutById: "u-9",
  checkedOutByEmail: "nurse@clinic.test",
  bucket: "checked_out",
});

function sweepList(items: RoomSweepItem[]): RoomSweepList {
  return { roomId: ROOM_ID, items };
}

function sweepResult(overrides: Partial<RoomSweepResult> = {}): RoomSweepResult {
  return {
    roomId: ROOM_ID,
    confirmedCount: 0,
    missingCount: 0,
    skippedNoStationCount: 0,
    sweptById: "u-1",
    sweptAt: "2026-07-15T10:00:00.000Z",
    ...overrides,
  };
}

function renderSweep() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RoomSweep roomId={ROOM_ID} roomName="ICU 1" open={true} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { client, onOpenChange };
}

describe("RoomSweep — mobile floor sweep UI (T3.2b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders expected items grouped by station: resting items toggleable, checked-out item read-only with holder and no toggle", async () => {
    roomSweepListMock.mockResolvedValue(sweepList([ITEM_A, ITEM_B, ITEM_C, ITEM_D_CHECKED_OUT]));
    renderSweep();

    expect(await screen.findByText("Station 1")).toBeTruthy();
    expect(screen.getByText("Station 2")).toBeTruthy();
    expect(screen.getByText(t.roomSweep.noStationGroup)).toBeTruthy();

    // Resting items get a toggle control.
    expect(screen.getByTestId("sweep-item-toggle-eq-a")).toBeTruthy();
    expect(screen.getByTestId("sweep-item-toggle-eq-b")).toBeTruthy();
    expect(screen.getByTestId("sweep-item-toggle-eq-c")).toBeTruthy();

    // Default: nothing is confirmed present yet (accuracy-first default).
    expect(screen.getByTestId("sweep-item-toggle-eq-a").getAttribute("aria-pressed")).toBe("false");

    // Checked-out item: read-only, no toggle, shows holder.
    expect(screen.queryByTestId("sweep-item-toggle-eq-d")).toBeNull();
    const checkedOutRow = screen.getByTestId("sweep-item-checked-out-eq-d");
    expect(checkedOutRow.textContent).toContain("nurse");

    // Commit bar summary starts at 0 present / 3 missing (3 resting items).
    expect(screen.getByTestId("sweep-commit-bar").textContent).toContain(t.roomSweep.summary(0, 3));
  });

  it('"Mark all present" confirms all resting items and updates the commit summary', async () => {
    roomSweepListMock.mockResolvedValue(sweepList([ITEM_A, ITEM_B, ITEM_C, ITEM_D_CHECKED_OUT]));
    renderSweep();

    await screen.findByTestId("sweep-item-toggle-eq-a");
    fireEvent.click(screen.getByTestId("sweep-mark-all-present"));

    await waitFor(() => {
      expect(screen.getByTestId("sweep-item-toggle-eq-a").getAttribute("aria-pressed")).toBe("true");
    });
    expect(screen.getByTestId("sweep-item-toggle-eq-b").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("sweep-item-toggle-eq-c").getAttribute("aria-pressed")).toBe("true");

    expect(screen.getByTestId("sweep-commit-bar").textContent).toContain(t.roomSweep.summary(3, 0));
  });

  it("Confirm sweep posts exactly the present ids — not the checked-out id, not an un-toggled (missing) id", async () => {
    roomSweepListMock.mockResolvedValue(sweepList([ITEM_A, ITEM_B, ITEM_C, ITEM_D_CHECKED_OUT]));
    commitRoomSweepMock.mockResolvedValue(sweepResult({ confirmedCount: 1, missingCount: 2 }));
    const { onOpenChange } = renderSweep();

    await screen.findByTestId("sweep-item-toggle-eq-a");
    // Confirm only eq-a present; eq-b and eq-c stay un-toggled (missing).
    fireEvent.click(screen.getByTestId("sweep-item-toggle-eq-a"));

    fireEvent.click(screen.getByTestId("sweep-confirm-button"));

    await waitFor(() => expect(commitRoomSweepMock).toHaveBeenCalledTimes(1));
    expect(commitRoomSweepMock).toHaveBeenCalledWith(ROOM_ID, { confirmedEquipmentIds: ["eq-a"] });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders the empty state (no commit bar) when the room has no homed items", async () => {
    roomSweepListMock.mockResolvedValue(sweepList([]));
    renderSweep();

    expect(await screen.findByText(t.roomSweep.noHomedItems)).toBeTruthy();
    expect(screen.queryByTestId("sweep-commit-bar")).toBeNull();
    expect(screen.queryByTestId("sweep-confirm-button")).toBeNull();
  });

  it("renders an error state with retry (not the empty state) when the expected-list fetch fails", async () => {
    roomSweepListMock.mockRejectedValueOnce(new Error("network down"));
    renderSweep();

    expect(await screen.findByText(t.roomSweep.loadError)).toBeTruthy();
    expect(screen.queryByText(t.roomSweep.noHomedItems)).toBeNull();
    expect(screen.queryByTestId("sweep-commit-bar")).toBeNull();

    roomSweepListMock.mockResolvedValueOnce(sweepList([ITEM_A]));
    fireEvent.click(screen.getByRole("button", { name: t.errorCard.retry }));

    await waitFor(() => expect(roomSweepListMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("sweep-item-toggle-eq-a")).toBeTruthy();
  });

  it('per-station "Mark all present" confirms only that station\'s resting items and commits the correct partial id set', async () => {
    const ITEM_STATION_2 = sweepItem({
      id: "eq-e",
      name: "Otoscope E",
      homeDockId: "dock-2",
      homeDockName: "Station 2",
    });
    roomSweepListMock.mockResolvedValue(sweepList([ITEM_A, ITEM_B, ITEM_STATION_2]));
    commitRoomSweepMock.mockResolvedValue(sweepResult({ confirmedCount: 2, missingCount: 1 }));
    renderSweep();

    await screen.findByTestId("sweep-item-toggle-eq-a");
    fireEvent.click(screen.getByTestId("sweep-group-mark-present-Station 1"));

    await waitFor(() => {
      expect(screen.getByTestId("sweep-item-toggle-eq-a").getAttribute("aria-pressed")).toBe("true");
    });
    expect(screen.getByTestId("sweep-item-toggle-eq-b").getAttribute("aria-pressed")).toBe("true");
    // Station 2's own item must be untouched by Station 1's bulk action.
    expect(screen.getByTestId("sweep-item-toggle-eq-e").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByTestId("sweep-confirm-button"));
    await waitFor(() => expect(commitRoomSweepMock).toHaveBeenCalledTimes(1));
    expect(commitRoomSweepMock).toHaveBeenCalledWith(ROOM_ID, { confirmedEquipmentIds: ["eq-a", "eq-b"] });
  });

  it("shows the commit-error toast and keeps the sheet open when commitRoomSweep rejects", async () => {
    roomSweepListMock.mockResolvedValue(sweepList([ITEM_A]));
    commitRoomSweepMock.mockRejectedValueOnce(new Error("server exploded"));
    const { onOpenChange } = renderSweep();

    await screen.findByTestId("sweep-item-toggle-eq-a");
    fireEvent.click(screen.getByTestId("sweep-confirm-button"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t.roomSweep.commitError));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
