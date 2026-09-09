/**
 * @vitest-environment happy-dom
 *
 * Track A / Phase 2 — `/rooms` serves the dense `RoomsTable` at lg+ and keeps the
 * two-column card grid below it. Asserts the branch only.
 *
 * NOTE: happy-dom's default viewport is exactly 1024px, so `useIsDesktop()` is TRUE
 * unless mocked — every branch test in this family must set it explicitly rather
 * than rely on the environment default.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import React from "react";

const mockIsDesktop = vi.fn<() => boolean>();
vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => mockIsDesktop() }));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAdmin: true, userId: "u1" }) }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("react-helmet-async", () => ({ Helmet: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { ROOMS } = vi.hoisted(() => ({
  ROOMS: [
    {
      id: "r1",
      name: "ICU 1",
      syncStatus: "synced",
      totalEquipment: 10,
      availableCount: 7,
      inUseCount: 2,
      issueCount: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
}));
vi.mock("@/lib/api", () => ({
  api: { rooms: { list: vi.fn(async () => ROOMS), create: vi.fn() } },
}));

import RoomsListPage from "@/pages/rooms-list";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={memoryLocation({ path: "/rooms" }).hook}>
        <RoomsListPage />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("/rooms — desktop readiness table vs narrow card grid", () => {
  it("renders the readiness table on desktop", async () => {
    mockIsDesktop.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(document.querySelector("table")).toBeTruthy());
    expect(screen.getByTestId("room-row-r1")).toBeTruthy();
  });

  it("renders the card grid and no table below the desktop breakpoint", async () => {
    mockIsDesktop.mockReturnValue(false);
    renderPage();

    await waitFor(() => expect(screen.getByText("ICU 1")).toBeTruthy());
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByTestId("room-row-r1")).toBeNull();
  });
});
