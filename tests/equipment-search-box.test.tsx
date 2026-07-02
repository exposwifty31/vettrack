/**
 * @vitest-environment happy-dom
 *
 * Drives the shared equipment typeahead: filtered results appear as you type,
 * a click routes to the detail, and Enter (no active row) opens the filtered
 * list. The dropdown stays hidden when nothing matches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigateMock = vi.fn();
const listMock = vi.fn();

vi.mock("wouter", () => ({ useLocation: () => ["/", navigateMock] }));
vi.mock("@/lib/api", () => ({ api: { equipment: { list: () => listMock() } } }));

import { EquipmentSearchBox } from "@/components/search/EquipmentSearchBox";

const items = [
  { id: "e1", name: "Infusion Pump", serialNumber: "SN-1", model: "Alaris", location: "ICU", status: "ok" },
  { id: "e2", name: "Vital Monitor", serialNumber: "SN-2", model: "Philips", location: "OR", status: "ok" },
];

function renderBox() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EquipmentSearchBox tone="surface" />
    </QueryClientProvider>,
  );
}

describe("EquipmentSearchBox typeahead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue(items);
  });
  afterEach(() => cleanup());

  it("shows only matching results as you type", async () => {
    renderBox();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pump" } });
    expect(await screen.findByText("Infusion Pump")).toBeTruthy();
    expect(screen.queryByText("Vital Monitor")).toBeNull();
  });

  it("navigates to the equipment detail when a result is clicked", async () => {
    renderBox();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pump" } });
    fireEvent.click(await screen.findByText("Infusion Pump"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/equipment/e1"));
  });

  it("opens the filtered list on Enter with no active row", async () => {
    renderBox();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "vital" } });
    await screen.findByText("Vital Monitor");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/equipment?q=vital"));
  });

  it("keeps the dropdown hidden when nothing matches", async () => {
    renderBox();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzzz" } });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
