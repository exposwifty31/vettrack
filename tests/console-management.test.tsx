/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Boxes } from "lucide-react";

// Mock the experience hook so the capability gates can be driven per-test.
const mockCan = vi.fn<(cap: string) => boolean>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: new Set(), can: mockCan }),
}));

import { ManagementGuard } from "@/desktop/management/ManagementGuard";
import { WriteGate } from "@/desktop/management/WriteGate";
import { DataTable, type Column } from "@/desktop/management/DataTable";

beforeEach(() => mockCan.mockReset());
afterEach(() => cleanup());

function renderRouted(ui: React.ReactNode, path = "/admin/integrations") {
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}>{ui}</Router>);
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

  it("redirects (no children) when the user lacks management.web", () => {
    mockCan.mockReturnValue(false);
    renderRouted(
      <ManagementGuard>
        <div>CONSOLE_CONTENT</div>
      </ManagementGuard>,
    );
    expect(screen.queryByText("CONSOLE_CONTENT")).toBeNull();
  });
});

describe("WriteGate", () => {
  it("renders write affordances only for management.webWrite (admin/secondary-admin)", () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    render(<WriteGate fallback={<span>READONLY</span>}><button>EDIT</button></WriteGate>);
    expect(screen.getByText("EDIT")).toBeTruthy();
    expect(screen.queryByText("READONLY")).toBeNull();
  });

  it("renders the fallback for read-only users (lead — no webWrite)", () => {
    mockCan.mockReturnValue(false);
    render(<WriteGate fallback={<span>READONLY</span>}><button>EDIT</button></WriteGate>);
    expect(screen.queryByText("EDIT")).toBeNull();
    expect(screen.getByText("READONLY")).toBeTruthy();
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
});
