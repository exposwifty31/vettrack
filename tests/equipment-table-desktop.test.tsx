/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 1 — the desktop console body for `/equipment`. The legacy page
 * renders one `<Card>` per item at every width; on a management browser that is
 * the mobile chrome leaking onto the console. `EquipmentTable` is the dense
 * counterpart: the shared `DataTable` (`src/desktop/management/DataTable.tsx`)
 * driven by column defs, reusing the existing display/status/relative-time
 * helpers so the two bodies cannot drift in what they say about a row.
 *
 * Column headers come from the pre-existing `t.console.col*` keys — the console
 * vocabulary was already defined for the Phase 6 pages, so this adds no i18n.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

// Write affordances are capability-gated; default to NO grant so the read-only
// assertions below describe the plain console.
const mockCan = vi.fn<(cap: string) => boolean>(() => false);
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: new Set(), can: mockCan }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: { equipment: { update: vi.fn(async () => ({})) } } }));

import { EquipmentTable } from "@/features/equipment/desktop/EquipmentTable";

function eq(over: Partial<Equipment> & Pick<Equipment, "id" | "name">): Equipment {
  return {
    status: "available",
    createdAt: "2026-08-01T08:00:00.000Z",
    ...over,
  } as Equipment;
}

const ROWS: Equipment[] = [
  eq({
    id: "e1",
    name: "Ultrasound A",
    nameHe: "אולטרסאונד א",
    folderName: "Imaging",
    roomName: "Room 3",
    lastSeen: "2026-08-31T08:00:00.000Z",
  }),
  eq({ id: "e2", name: "Infusion Pump", status: "maintenance", roomName: "Room 1" }),
  eq({ id: "e3", name: "Monitor B", status: "in_use" }),
];

function renderTable(rows: Equipment[] | undefined) {
  const { hook, history } = memoryLocation({ path: "/equipment", record: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <EquipmentTable equipment={rows} />
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, history };
}

afterEach(() => {
  cleanup();
  mockCan.mockReset();
  mockCan.mockReturnValue(false);
});

describe("EquipmentTable — desktop console body for /equipment", () => {
  it("renders a real table carrying the five console column headers", () => {
    renderTable(ROWS);

    expect(document.querySelector("table")).toBeTruthy();
    for (const header of [
      t.console.colName,
      t.console.colType,
      t.console.colStatus,
      t.console.colRoom,
      t.console.colLastSeen,
    ]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeTruthy();
    }
    expect(screen.getAllByRole("row")).toHaveLength(ROWS.length + 1); // + header row
  });

  it("shows the Hebrew display name, not the canonical name, when one is set", () => {
    renderTable(ROWS);
    expect(screen.getByText("אולטרסאונד א")).toBeTruthy();
    expect(screen.queryByText("Ultrasound A")).toBeNull();
  });

  it("navigates to the equipment detail route when a row is clicked", () => {
    const { history } = renderTable(ROWS);

    fireEvent.click(screen.getByText("Infusion Pump"));

    expect(history[history.length - 1]).toBe("/equipment/e2");
  });

  // Same guard tests/equipment-list-name-bidi.test.tsx applies to the card path: LTR
  // text inside the Hebrew (RTL) console must be bidi-isolated, or the surrounding
  // paragraph direction reorders it. EVERY user-authored cell needs it, not just the
  // name — an earlier name-only version of this test let a `<Bdi>`→`<span>` mutation
  // in the type cell survive, so it is table-driven on purpose.
  it.each([
    ["name", "אולטרסאונד א"],
    ["type", "Imaging"],
    ["room", "Room 3"],
  ])("bidi-isolates the %s cell in the RTL console", (_col, text) => {
    renderTable(ROWS);

    const bdi = screen.getByText(text).closest("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.getAttribute("dir")).toBe("auto");
  });

  it("offers no write affordance without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderTable(ROWS);

    expect(screen.queryByRole("columnheader", { name: t.console.colActions })).toBeNull();
    expect(screen.queryByTestId("equipment-status-trigger-e1")).toBeNull();
  });

  it("adds an actions column with a per-row status control when the capability is held", () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    renderTable(ROWS);

    expect(screen.getByRole("columnheader", { name: t.console.colActions })).toBeTruthy();
    for (const id of ["e1", "e2", "e3"]) {
      expect(screen.getByTestId(`equipment-status-trigger-${id}`)).toBeTruthy();
    }
  });

  // Caught by looking at the running app, not by a test: the actions column was
  // rendering between "room" and "last seen" because the column was spliced in at the
  // lastSeen anchor. Both sibling console tables (FoldersTable, UsersTable) end with
  // actions, and nothing here asserted ORDER.
  it("puts the actions column last, like the other console tables", () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    renderTable(ROWS);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual([
      t.console.colName,
      t.console.colType,
      t.console.colStatus,
      t.console.colRoom,
      t.console.colLastSeen,
      t.console.colActions,
    ]);
  });

  it("opens the status sheet from the row control without navigating away", () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    const { history } = renderTable(ROWS);
    const before = history.length;

    fireEvent.click(screen.getByTestId("equipment-status-trigger-e2"));

    expect(screen.getByText(t.equipmentDetail.updateStatusTitle)).toBeTruthy();
    // The row-click navigation must not also fire — that would yank the manager to
    // the detail page the instant they reach for the status control.
    expect(history.length).toBe(before);
  });

  it("renders the empty state instead of a table when there are no rows", () => {
    renderTable([]);

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByText(t.equipmentList.empty.message)).toBeTruthy();
  });
});
