/**
 * @vitest-environment happy-dom
 *
 * IPAD-1 regression (pre-resubmission 4-flow audit 2026-07-18). On the iPad
 * combined `/equipment/:id?` master-detail route, equipment filters live in the
 * URL query while the open detail lives in the `:id` path param. The two must
 * stay independent:
 *   1. Changing a filter/search must preserve the current path (keep the detail
 *      pane open) — `useEquipmentFilters` navigates to the current `location`,
 *      not a hardcoded `/equipment`.
 *   2. Selecting a row must preserve the active query — `EquipmentTriageList`
 *      appends the current search to the row href.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Equipment } from "@/types";
import { useEquipmentFilters } from "@/features/equipment/hooks/use-equipment-filters";

// useDirection pulls settings context; the direction is irrelevant to the href
// under test, so stub it to avoid mounting the settings provider.
vi.mock("@/hooks/useDirection", () => ({ useDirection: () => "ltr" }));

import { EquipmentTriageList } from "@/components/equipment/EquipmentTriageList";

afterEach(cleanup);

function FilterProbe() {
  const { setSearch, setStatusFilter } = useEquipmentFilters();
  return (
    <>
      <button onClick={() => setSearch("pump")}>set-search</button>
      <button onClick={() => setStatusFilter("maintenance")}>set-status</button>
    </>
  );
}

describe("IPAD-1 · useEquipmentFilters preserves the current path", () => {
  it("keeps the open detail (:id path) when a search is typed", () => {
    const mem = memoryLocation({
      path: "/equipment/eq-1",
      searchPath: "status=maintenance",
      record: true,
    });
    render(
      <Router hook={mem.hook}>
        <FilterProbe />
      </Router>,
    );

    fireEvent.click(screen.getByText("set-search"));

    const last = mem.history!.at(-1)!;
    const [path, query] = last.split("?");
    // Path stays on the detail — before the fix this reset to "/equipment".
    expect(path).toBe("/equipment/eq-1");
    // Both the pre-existing filter and the new search survive.
    expect(query).toContain("status=maintenance");
    expect(query).toContain("q=pump");
  });

  it("keeps the open detail (:id path) when a status chip is toggled", () => {
    const mem = memoryLocation({ path: "/equipment/eq-1", record: true });
    render(
      <Router hook={mem.hook}>
        <FilterProbe />
      </Router>,
    );

    fireEvent.click(screen.getByText("set-status"));

    const last = mem.history!.at(-1)!;
    expect(last.split("?")[0]).toBe("/equipment/eq-1");
    expect(last).toContain("status=maintenance");
  });

  it("still works from the bare list route (no :id)", () => {
    const mem = memoryLocation({ path: "/equipment", record: true });
    render(
      <Router hook={mem.hook}>
        <FilterProbe />
      </Router>,
    );

    fireEvent.click(screen.getByText("set-search"));

    const last = mem.history!.at(-1)!;
    expect(last.split("?")[0]).toBe("/equipment");
    expect(last).toContain("q=pump");
  });
});

describe("IPAD-1 · EquipmentTriageList row href preserves the active query", () => {
  const items: Equipment[] = [
    { id: "eq-1", name: "Ventilator ICU-2", status: "ok" } as unknown as Equipment,
  ];

  it("appends the current search to the detail link", () => {
    const mem = memoryLocation({ path: "/equipment", searchPath: "status=maintenance" });
    render(
      <Router hook={mem.hook}>
        <EquipmentTriageList items={items} />
      </Router>,
    );

    const row = screen.getByTestId("equipment-triage-row-eq-1");
    expect(row.getAttribute("href")).toBe("/equipment/eq-1?status=maintenance");
  });

  it("emits a clean link when no filter is active", () => {
    const mem = memoryLocation({ path: "/equipment" });
    render(
      <Router hook={mem.hook}>
        <EquipmentTriageList items={items} />
      </Router>,
    );

    const row = screen.getByTestId("equipment-triage-row-eq-1");
    expect(row.getAttribute("href")).toBe("/equipment/eq-1");
  });
});
