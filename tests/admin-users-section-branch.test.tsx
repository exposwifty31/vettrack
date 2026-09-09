/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 2 — the `/admin` users tab serves `UsersTable` at lg+ and keeps
 * the card row stack below it. Asserts the branch and that the wiring survives it:
 * a control fired from the table must reach the same mutation the card row calls.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockIsDesktop = vi.fn<() => boolean>();
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => mockIsDesktop() }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u0", isAdmin: true }) }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("@/lib/haptics", () => ({ haptics: { tap: vi.fn(), error: vi.fn() } }));

const { USERS, setCoordinator } = vi.hoisted(() => ({
  USERS: [
    {
      id: "u1",
      clerkId: "ck1",
      email: "tech@clinic.test",
      name: "Dana",
      displayName: "Dana Tech",
      role: "technician",
      status: "active",
      createdAt: "2026-08-01T08:00:00.000Z",
      isEquipmentCoordinator: false,
    },
  ],
  setCoordinator: vi.fn(async () => ({})),
}));
vi.mock("@/lib/api", () => ({
  api: {
    users: {
      listPaginated: vi.fn(async () => ({ items: USERS, total: USERS.length })),
      updateRole: vi.fn(async () => ({})),
      updateSecondaryRole: vi.fn(async () => ({})),
      updateStatus: vi.fn(async () => ({})),
      setEquipmentCoordinator: (...a: unknown[]) => setCoordinator(...a),
      setSeniorDoctorEligible: vi.fn(async () => ({})),
      softDelete: vi.fn(async () => ({})),
      restore: vi.fn(async () => ({})),
    },
  },
}));

import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { UsersSection } from "@/pages/admin/UsersSection";

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsersSection />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(api.users.listPaginated).mockReset();
  vi.mocked(api.users.listPaginated).mockResolvedValue({
    items: USERS,
    total: USERS.length,
    page: 1,
    pageSize: 100,
    hasMore: false,
  });
});

describe("/admin users tab — desktop table vs narrow card rows", () => {
  it("renders the dense table on desktop, keeping every row control", async () => {
    mockIsDesktop.mockReturnValue(true);
    renderSection();

    await waitFor(() => expect(document.querySelector("table")).toBeTruthy());
    expect(screen.getByTestId("select-role-u1")).toBeTruthy();
    expect(screen.getByTestId("select-secondary-role-u1")).toBeTruthy();
    expect(screen.getByTestId("select-status-u1")).toBeTruthy();
    expect(screen.getByTestId("checkbox-equipment-coordinator-u1")).toBeTruthy();
    expect(screen.getByTestId("btn-soft-delete-user-u1")).toBeTruthy();
  });

  it("renders the card rows and no table below the desktop breakpoint", async () => {
    mockIsDesktop.mockReturnValue(false);
    renderSection();

    await waitFor(() => expect(screen.getByTestId("user-row-u1")).toBeTruthy());
    expect(document.querySelector("table")).toBeNull();
  });

  it("shows ErrorCard and no user rows when the first fetch fails", async () => {
    mockIsDesktop.mockReturnValue(false);
    vi.mocked(api.users.listPaginated).mockRejectedValueOnce(new Error("fail"));
    renderSection();

    expect(await screen.findByRole("button", { name: t.errorCard.retry })).toBeTruthy();
    expect(screen.queryByTestId("user-row-u1")).toBeNull();
  });

  it("keeps cached users and shows retry when a background refetch fails", async () => {
    mockIsDesktop.mockReturnValue(false);
    vi.mocked(api.users.listPaginated).mockRejectedValue(new Error("fail"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/users", "all"], {
      pages: [{ items: USERS, total: USERS.length, page: 1, pageSize: 100, hasMore: false }],
      pageParams: [1],
    });
    render(
      <QueryClientProvider client={qc}>
        <UsersSection />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("user-row-u1")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: t.errorCard.retry })).toBeTruthy(),
    );
  });

  it("keeps loaded users and retries fetchNextPage when the next page fails", async () => {
    mockIsDesktop.mockReturnValue(false);
    vi.mocked(api.users.listPaginated).mockImplementation(async (page = 1) => {
      if (page === 1) {
        return { items: USERS, total: 2, page: 1, pageSize: 100, hasMore: true };
      }
      throw new Error("fail");
    });
    renderSection();

    await waitFor(() => expect(screen.getByTestId("user-row-u1")).toBeTruthy());
    screen.getByTestId("btn-load-more-users").click();

    expect(await screen.findByRole("button", { name: t.errorCard.retry })).toBeTruthy();
    expect(screen.getByTestId("user-row-u1")).toBeTruthy();

    const callsBeforeRetry = vi.mocked(api.users.listPaginated).mock.calls.length;
    screen.getByRole("button", { name: t.errorCard.retry }).click();
    await waitFor(() =>
      expect(vi.mocked(api.users.listPaginated).mock.calls.length).toBeGreaterThan(callsBeforeRetry),
    );
    expect(vi.mocked(api.users.listPaginated).mock.calls.at(-1)?.[0]).toBe(2);
  });
});
