/**
 * @vitest-environment happy-dom
 *
 * T-22c — LocateSearch UI (R-EQ-F1). Fails before `LocateSearch` exists.
 * Locks in the three RED requirements from the card: the empty state (no
 * query yet) must read differently from the zero-results state (query
 * typed, nothing matched); the result count is announced via an aria-live
 * region; and the search input carries a real `<label>`, not just a
 * placeholder. Also covers the result-row deep link since it's the point
 * of the feature.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const navigateMock = vi.fn();
const locateMock = vi.fn();

vi.mock("wouter", () => ({ useLocation: () => ["/home", navigateMock] }));
vi.mock("@/lib/api", () => ({ api: { equipment: { locate: (q: string) => locateMock(q) } } }));

import { LocateSearch } from "@/features/equipment/LocateSearch";

function renderLocateSearch() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocateSearch />
    </QueryClientProvider>,
  );
}

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: t.locateSearch.openButtonLabel }));
}

function resultRow(overrides: Partial<{ equipmentId: string; name: string }> = {}) {
  return {
    equipmentId: overrides.equipmentId ?? "e1",
    name: overrides.name ?? "Infusion Pump",
    location: { summary: "ICU · Room 2", claims: [], unknowns: [] },
    custodian: { claims: [], unknowns: [], lastCorroboratedAt: null },
    readiness: "ready",
  };
}

describe("LocateSearch", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("gives the search input a real label, not just a placeholder", () => {
    renderLocateSearch();
    openSheet();
    const input = screen.getByLabelText(t.locateSearch.label);
    expect(input.tagName).toBe("INPUT");
  });

  it("shows an empty-state prompt distinct from the zero-results message before any query is entered", () => {
    renderLocateSearch();
    openSheet();
    expect(screen.getByText(t.locateSearch.emptyPrompt)).toBeTruthy();
    expect(screen.queryByText(t.locateSearch.noResults)).toBeNull();
  });

  it("shows a zero-results message distinct from the empty state when a search matches nothing", async () => {
    locateMock.mockResolvedValue({ query: "zzz", results: [] });
    renderLocateSearch();
    openSheet();
    fireEvent.change(screen.getByLabelText(t.locateSearch.label), { target: { value: "zzz" } });
    await waitFor(() => expect(locateMock).toHaveBeenCalledWith("zzz"));
    expect(await screen.findByText(t.locateSearch.noResults)).toBeTruthy();
    expect(screen.queryByText(t.locateSearch.emptyPrompt)).toBeNull();
  });

  it("announces the result count via an aria-live region", async () => {
    locateMock.mockResolvedValue({
      query: "pump",
      results: [resultRow(), resultRow({ equipmentId: "e2", name: "Vital Monitor" })],
    });
    renderLocateSearch();
    openSheet();
    fireEvent.change(screen.getByLabelText(t.locateSearch.label), { target: { value: "pump" } });
    await screen.findByText("Infusion Pump");
    const live = screen.getByRole("status");
    expect(live.textContent).toBe(t.locateSearch.resultsCount(2));
  });

  it("deep-links to the equipment detail when a result row is clicked", async () => {
    locateMock.mockResolvedValue({ query: "pump", results: [resultRow()] });
    renderLocateSearch();
    openSheet();
    fireEvent.change(screen.getByLabelText(t.locateSearch.label), { target: { value: "pump" } });
    fireEvent.click(await screen.findByText("Infusion Pump"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/equipment/e1"));
  });
});
