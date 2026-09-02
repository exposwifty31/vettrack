/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 2 — the `/admin` folders tab must serve the dense `FoldersTable`
 * at lg+ and keep the card row stack below it. Asserts the branch only; the table's
 * own behaviour is covered by `admin-folders-table-desktop.test.tsx`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockIsDesktop = vi.fn<() => boolean>();
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => mockIsDesktop() }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1", isAdmin: true }) }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn(async () => true) }));

const { FOLDERS } = vi.hoisted(() => ({
  FOLDERS: [
    { id: "f1", name: "Imaging", type: "manual", createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "f2", name: "Surgery", type: "manual", createdAt: "2026-08-01T00:00:00.000Z" },
  ],
}));
vi.mock("@/lib/api", () => ({
  api: {
    folders: {
      list: vi.fn(async () => FOLDERS),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { FoldersSection } from "@/pages/admin/FoldersSection";

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FoldersSection />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("/admin folders tab — desktop table vs narrow card rows", () => {
  it("renders the dense table on desktop", async () => {
    mockIsDesktop.mockReturnValue(true);
    renderSection();

    await waitFor(() => expect(document.querySelector("table")).toBeTruthy());
    // Row actions survive the swap.
    expect(screen.getByTestId("btn-edit-folder-f1")).toBeTruthy();
    expect(screen.getByTestId("btn-delete-folder-f1")).toBeTruthy();
  });

  it("renders the card rows and no table below the desktop breakpoint", async () => {
    mockIsDesktop.mockReturnValue(false);
    renderSection();

    await waitFor(() => expect(screen.getByTestId("btn-edit-folder-f1")).toBeTruthy());
    expect(document.querySelector("table")).toBeNull();
  });
});
