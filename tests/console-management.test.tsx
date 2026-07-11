/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Boxes } from "lucide-react";

// Mock the experience hook so the capability gates can be driven per-test.
const mockCan = vi.fn<(cap: string) => boolean>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: new Set(), can: mockCan }),
}));
// AppShell pulls in the real Topbar (useAuth/useQuery/etc.) — every console test
// in this suite stubs it to a passthrough (see integrations-console.test.tsx etc.);
// ManagementGuard's denial state now wraps its content in AppShell too (T22).
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ManagementGuard } from "@/desktop/management/ManagementGuard";
import { DataTable, type Column } from "@/desktop/management/DataTable";

beforeEach(() => mockCan.mockReset());
afterEach(() => cleanup());

// Renders the current wouter location so a redirect's absence/presence is
// assertable directly, not inferred from content disappearing.
function LocationProbe() {
  const [loc] = useLocation();
  return <div data-testid="location">{loc}</div>;
}

function renderRouted(ui: React.ReactNode, path = "/admin/integrations") {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      {ui}
      <LocationProbe />
    </Router>,
  );
}

describe("ManagementGuard", () => {
  it("renders children when the user has management.web", () => {
    mockCan.mockImplementation((cap) => cap === "management.web");
    renderRouted(
      <ManagementGuard>
        <div>CONSOLE_CONTENT</div>
      </ManagementGuard>,
    );
    expect(screen.getByText("CONSOLE_CONTENT")).toBeTruthy();
  });

  it("shows the explicit not-authorized state (no children, no redirect) when the user lacks management.web", () => {
    // T22: this used to <Redirect to="/home"> silently. It now renders the
    // shared ManagementAccessDenied state in place, so the URL never changes —
    // this is the SAME unified pattern every other management surface uses.
    mockCan.mockReturnValue(false);
    renderRouted(
      <ManagementGuard>
        <div>CONSOLE_CONTENT</div>
      </ManagementGuard>,
      "/admin/integrations",
    );
    expect(screen.queryByText("CONSOLE_CONTENT")).toBeNull();
    expect(screen.getByTestId("management-access-denied")).toBeTruthy();
    // Not a redirect — the URL stays exactly where the user landed.
    expect(screen.getByTestId("location").textContent).toBe("/admin/integrations");
  });
});

describe("DataTable — states", () => {
  interface Row {
    id: string;
    name: string;
  }
  const columns: Column<Row>[] = [{ key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name }];
  const base = { columns, rowKey: (r: Row) => r.id, emptyIcon: Boxes, emptyMessage: "EMPTY_MSG" as const };

  it("shows skeletons while loading", () => {
    const { container } = render(<DataTable<Row> {...base} rows={undefined} isLoading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("shows the empty state for zero rows", () => {
    render(<DataTable<Row> {...base} rows={[]} />);
    expect(screen.getByText("EMPTY_MSG")).toBeTruthy();
  });

  it("renders rows when data is present", () => {
    render(<DataTable<Row> {...base} rows={[{ id: "1", name: "Alpha" }, { id: "2", name: "Beta" }]} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("shows the error affordance (not the empty state) and wires onRetry", () => {
    const onRetry = vi.fn();
    render(<DataTable<Row> {...base} rows={undefined} isError onRetry={onRetry} />);
    // Error branch renders ErrorCard, not the zero-rows EmptyState.
    expect(screen.queryByText("EMPTY_MSG")).toBeNull();
    const retryButton = screen.getByRole("button");
    expect(retryButton).toBeTruthy();
    // ErrorCard invokes onRetry synchronously inside its retry handler.
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
